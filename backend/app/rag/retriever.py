"""Retriever：问题 → Top-K 切片。

第一版是纯向量检索（VectorRetriever）。接口刻意做成可组合的，后续升级在这里接入：
- HybridRetriever：向量 + BM25（切片原文已经在 SQLite 里，可直接建 FTS5 索引）后做 RRF 融合
- Reranker：对召回结果用 bge-reranker / Cohere Rerank 精排
- QueryRewriter / MultiQuery：先改写问题、生成多个子查询再检索
- 权限过滤：通过 where={"department": ...} 下推到向量库
"""

import time
from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass

from app.providers import EmbeddingProvider
from app.rag import vectorstore


@dataclass
class RetrievedChunk:
    rank: int
    chunk_id: str
    document_id: int
    document_name: str
    page: int | None
    section: str | None
    content: str
    score: float
    passed_threshold: bool = True

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class RetrievalResult:
    query: str
    chunks: list[RetrievedChunk]
    timings: dict


class BaseRetriever(ABC):
    @abstractmethod
    def retrieve(self, kb_id: int, query: str, top_k: int) -> RetrievalResult: ...


class VectorRetriever(BaseRetriever):
    def __init__(self, embedder: EmbeddingProvider, min_score: float):
        self.embedder, self.min_score = embedder, min_score

    def retrieve(self, kb_id, query, top_k):
        t0 = time.perf_counter()
        vec = self.embedder.embed_query(query)
        t1 = time.perf_counter()
        hits = vectorstore.query(kb_id, vec, top_k)
        t2 = time.perf_counter()
        chunks = [
            RetrievedChunk(
                rank=i + 1, chunk_id=h.chunk_id,
                document_id=int(h.metadata.get("document_id", 0)),
                document_name=h.metadata.get("document_name", ""),
                page=h.metadata.get("page"), section=h.metadata.get("section"),
                content=h.content, score=h.score, passed_threshold=h.score >= self.min_score,
            )
            for i, h in enumerate(hits)
        ]
        return RetrievalResult(query, chunks, {"embed_ms": round((t1 - t0) * 1000),
                                               "search_ms": round((t2 - t1) * 1000)})
