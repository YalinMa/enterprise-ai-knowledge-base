"""Retriever：问题 → Top-K 切片。

    ┌─ 向量检索（语义） Top-N ─┐
问题 ┤                          ├─ RRF 融合 ─→ [Rerank 精排] ─→ 拒答闸门 ─→ Top-K
    └─ BM25 检索（字面）Top-N ─┘

- vector 模式：只走向量检索（v0.1 的行为）
- hybrid 模式：向量 + BM25，用 Reciprocal Rank Fusion 融合（只看排名，不需要对齐两种分数的量纲）
- rerank：对融合后的候选做交叉打分；开启后拒答闸门改用重排分数，比余弦相似度更可靠
- 权限过滤预留：vectorstore.query 的 where 参数可下推部门 / 角色条件
"""

import math
import time
from dataclasses import asdict, dataclass, field

from sqlalchemy import select

from app.db import Chunk, Document, SessionLocal
from app.providers import EmbeddingProvider, Reranker
from app.rag import bm25, vectorstore


@dataclass
class RetrievalOptions:
    top_k: int = 5
    mode: str = "hybrid"            # vector / hybrid
    rerank: bool = True             # 配置了 Reranker 时才生效
    candidate_k: int = 20
    rrf_k: int = 60
    min_score: float = 0.45         # 余弦相似度阈值（未重排时使用）
    rerank_min_score: float = 0.15  # 重排分数阈值（重排时使用）
    keep_similarity: float = 0.55   # 重排时，余弦相似度高于此值的切片同样放行


@dataclass
class RetrievedChunk:
    rank: int
    chunk_id: str
    document_id: int
    document_name: str
    page: int | None
    section: str | None
    content: str
    score: float                    # 与问题的余弦相似度
    passed_threshold: bool = True
    vector_rank: int | None = None
    bm25_rank: int | None = None
    bm25_score: float | None = None
    rrf_score: float | None = None
    rerank_score: float | None = None

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class RetrievalResult:
    query: str
    chunks: list[RetrievedChunk]
    timings: dict
    gate: str = "similarity"        # 拒答闸门依据：similarity / rerank
    threshold: float = 0.0
    reranked: bool = False
    candidates: int = 0
    extra: dict = field(default_factory=dict)


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na, nb = math.sqrt(sum(x * x for x in a)), math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def _ms(t: float) -> int:
    return round((time.perf_counter() - t) * 1000)


class Retriever:
    def __init__(self, embedder: EmbeddingProvider, reranker: Reranker | None = None):
        self.embedder, self.reranker = embedder, reranker

    def retrieve(self, kb_id: int, query: str, opt: RetrievalOptions) -> RetrievalResult:
        timings: dict[str, int] = {}
        n = max(opt.candidate_k, opt.top_k)

        t = time.perf_counter()
        qvec = self.embedder.embed_query(query)
        timings["embed_ms"] = _ms(t)

        t = time.perf_counter()
        vec_hits = vectorstore.query(kb_id, qvec, n)
        timings["search_ms"] = _ms(t)
        vector_rank = {h.chunk_id: i + 1 for i, h in enumerate(vec_hits)}
        similarity = {h.chunk_id: h.score for h in vec_hits}

        bm25_rank: dict[str, int] = {}
        bm25_score: dict[str, float] = {}
        if opt.mode == "hybrid":
            t = time.perf_counter()
            for i, (cid, s) in enumerate(bm25.search(kb_id, query, n)):
                bm25_rank[cid], bm25_score[cid] = i + 1, s
            timings["bm25_ms"] = _ms(t)

        # ---- RRF 融合：score = Σ 1 / (k + rank) ----
        rrf: dict[str, float] = {}
        for ranks in (vector_rank, bm25_rank):
            for cid, r in ranks.items():
                rrf[cid] = rrf.get(cid, 0.0) + 1.0 / (opt.rrf_k + r)
        candidates = sorted(rrf, key=lambda c: -rrf[c])[:n]

        # 只被 BM25 召回的切片没有向量分数，取回向量补算余弦相似度，保证每个切片都能展示 Similarity
        missing = [c for c in candidates if c not in similarity]
        for cid, emb in vectorstore.get_embeddings(kb_id, missing).items():
            similarity[cid] = round(_cosine(qvec, emb), 4)

        rows = self._load_chunks(candidates)
        candidates = [c for c in candidates if c in rows]  # 防御：切片已被删除

        # ---- Rerank ----
        rerank: dict[str, float] = {}
        use_rerank = opt.rerank and self.reranker is not None and bool(candidates)
        if use_rerank:
            t = time.perf_counter()
            scores = self.reranker.score(query, [rows[c]["content"] for c in candidates])
            rerank = {c: round(s, 4) for c, s in zip(candidates, scores)}
            timings["rerank_ms"] = _ms(t)
            candidates.sort(key=lambda c: -rerank[c])

        gate = "rerank" if use_rerank else "similarity"
        threshold = opt.rerank_min_score if use_rerank else opt.min_score
        chunks = []
        for i, cid in enumerate(candidates[:opt.top_k]):
            row = rows[cid]
            sim = similarity.get(cid, 0.0)
            if use_rerank:
                # Reranker 对口语化问法会偏保守（评测中相关切片最低 0.17，无关切片最高 0.14），
                # 所以高余弦相似度作为第二个独立信号：任一达标即放行
                passed = rerank[cid] >= threshold or sim >= opt.keep_similarity
            else:
                passed = sim >= threshold
            chunks.append(RetrievedChunk(
                rank=i + 1, chunk_id=cid, score=sim, passed_threshold=passed,
                vector_rank=vector_rank.get(cid), bm25_rank=bm25_rank.get(cid),
                bm25_score=round(bm25_score[cid], 3) if cid in bm25_score else None,
                rrf_score=round(rrf[cid], 5), rerank_score=rerank.get(cid), **row,
            ))
        return RetrievalResult(query, chunks, timings, gate, threshold, use_rerank, len(rrf))

    @staticmethod
    def _load_chunks(ids: list[str]) -> dict[str, dict]:
        if not ids:
            return {}
        db = SessionLocal()
        try:
            res = db.execute(
                select(Chunk.id, Chunk.content, Chunk.page, Chunk.section, Chunk.document_id,
                       Document.filename)
                .join(Document, Document.id == Chunk.document_id).where(Chunk.id.in_(ids))
            ).all()
        finally:
            db.close()
        return {r[0]: {"content": r[1], "page": r[2], "section": r[3], "document_id": r[4],
                       "document_name": r[5]} for r in res}
