"""RAG 问答主流程：Question → Retriever → Top-K → 阈值过滤 → Prompt → LLM → Answer + Citation。

以事件流的形式产出，API 层直接转成 SSE：
  retrieval → token × N → done      （或 error）
每次问答的完整轨迹（召回切片、分数、Prompt、耗时、引用）都写入 QueryLog。
"""

import logging
import re
import time
from collections.abc import Iterator
from dataclasses import asdict, dataclass

from sqlalchemy.orm.attributes import flag_modified

from app.config import get_settings
from app.db import KnowledgeBase, QueryLog, SessionLocal
from app.providers import Thinking, get_embedder, get_llm, get_reranker
from app.rag.citations import resolve_citations
from app.rag.prompts import NOT_FOUND, build_messages
from app.rag.query_rewrite import needs_rewrite, rewrite_query
from app.rag.retriever import RetrievalOptions, RetrievalResult, Retriever

log = logging.getLogger("rag")


def _ms(t: float) -> int:
    return round((time.perf_counter() - t) * 1000)


@dataclass
class RAGOptions:
    """单次问答的策略参数。默认值来自 .env，问答页 / 评测可以按请求覆盖，便于现场对比。"""
    top_k: int
    retrieval_mode: str
    rerank: bool
    query_rewrite: bool
    llm_model: str | None = None        # 覆盖生成模型（同一厂商），用于评测对比

    @classmethod
    def from_settings(cls, **overrides) -> "RAGOptions":
        s = get_settings()
        base = cls(top_k=s.top_k, retrieval_mode=s.retrieval_mode,
                   rerank=s.rerank_provider != "none", query_rewrite=s.query_rewrite)
        for k, v in overrides.items():
            if v is not None and hasattr(base, k):
                setattr(base, k, v)
        return base


def retrieve(kb_id: int, question: str, history: list[dict], opt: RAGOptions
             ) -> tuple[str, RetrievalResult, dict]:
    """Query Rewrite + 检索。返回（实际检索用的 query, 检索结果, 耗时）。评测的「仅检索」模式也复用它。"""
    settings, embedder = get_settings(), get_embedder()
    timings: dict = {}
    query = question
    if opt.query_rewrite and needs_rewrite(question, history):
        t = time.perf_counter()
        try:
            rewriter = get_llm(settings.rewrite_model or opt.llm_model)
            query = rewrite_query(rewriter, question, history)
        except Exception:  # noqa: BLE001 —— 改写失败不影响问答，退回原问题
            log.exception("query rewrite failed")
        timings["rewrite_ms"] = _ms(t)
    min_score = settings.min_score if settings.min_score is not None else embedder.default_min_score
    ropt = RetrievalOptions(top_k=opt.top_k, mode=opt.retrieval_mode, rerank=opt.rerank,
                            candidate_k=settings.candidate_k, rrf_k=settings.rrf_k,
                            min_score=min_score, rerank_min_score=settings.rerank_min_score,
                            keep_similarity=settings.rerank_keep_similarity)
    result = Retriever(embedder, get_reranker()).retrieve(kb_id, query, ropt)
    timings.update(result.timings)
    return query, result, timings


def answer_stream(kb_id: int, question: str, history: list[dict] | None = None,
                  options: RAGOptions | None = None, source: str = "chat") -> Iterator[dict]:
    opt = options or RAGOptions.from_settings()
    settings, embedder, reranker = get_settings(), get_embedder(), get_reranker()
    llm = get_llm(opt.llm_model)
    history = (history or [])[-settings.history_turns * 2:]
    t_start = time.perf_counter()

    db = SessionLocal()
    try:
        kb = db.get(KnowledgeBase, kb_id)
        if kb is None:
            yield {"type": "error", "message": "知识库不存在"}
            return
        qlog = QueryLog(kb_id=kb_id, kb_name=kb.name, question=question, retrieval_query=question,
                        status="running", source=source, params={
                            **asdict(opt),
                            "embedding": embedder.signature,
                            "llm": f"{llm.provider}:{llm.model}",
                            "reranker": reranker.signature if reranker else None,
                            "rewrite_llm": (get_llm(settings.rewrite_model or opt.llm_model).model
                                            if opt.query_rewrite else None),
                            "chunk_size": settings.chunk_size,
                            "chunk_overlap": settings.chunk_overlap,
                            "candidate_k": settings.candidate_k,
                            "retriever": opt.retrieval_mode,
                        })
        db.add(qlog)
        db.commit()

        warning = None
        if kb.embedding_signature and kb.embedding_signature != embedder.signature:
            warning = (f"该知识库的向量由 {kb.embedding_signature} 生成，当前 Embedding 为 "
                       f"{embedder.signature}，请在知识库详情页「全部重新解析」。")

        # ---- Query Rewrite + 检索 ----
        try:
            query, result, timings = retrieve(kb_id, question, history, opt)
        except Exception as e:  # noqa: BLE001
            log.exception("retrieval failed")
            msg = warning or f"检索失败：{type(e).__name__}: {e}"
            qlog.status, qlog.error = "error", msg
            db.commit()
            yield {"type": "error", "message": msg, "query_id": qlog.id}
            return
        used = [c for c in result.chunks if c.passed_threshold]
        qlog.retrieval_query = query
        qlog.retrieved = [c.to_dict() for c in result.chunks]
        qlog.params = {**qlog.params, "gate": result.gate, "min_score": result.threshold,
                       "keep_similarity": settings.rerank_keep_similarity if result.reranked else None,
                       "reranked": result.reranked, "candidates": result.candidates}
        db.commit()
        yield {"type": "retrieval", "query_id": qlog.id, "query": query,
               "chunks": [c.to_dict() for c in result.chunks], "used_count": len(used),
               "min_score": result.threshold, "gate": result.gate, "warning": warning}

        # ---- 拒答闸门：没有足够相关的资料就不调用 LLM，从源头避免编造 ----
        if not used:
            answer = NOT_FOUND + "可以尝试换一种问法，或确认相关制度文档已上传到该知识库。"
            yield {"type": "token", "text": answer}
            timings.update(llm_ms=0, total_ms=_ms(t_start))
            qlog.answer, qlog.status, qlog.timings = answer, "no_context", timings
            db.commit()
            yield {"type": "done", "query_id": qlog.id, "answer": answer, "citations": [],
                   "status": "no_context", "timings": timings}
            return

        # ---- 生成 ----
        messages = build_messages(question, used, history)
        qlog.prompt = messages
        t_llm = time.perf_counter()
        parts: list[str] = []
        first_token_ms = None
        thinking_chars = 0
        try:
            context = [{"index": i, "content": c.content} for i, c in enumerate(used, 1)]
            for piece in llm.stream(messages, context=context):
                if isinstance(piece, Thinking):
                    # 推理模型先「思考」再输出正文：告诉前端正在思考，避免用户以为卡住了
                    if thinking_chars == 0:
                        yield {"type": "thinking"}
                    thinking_chars += len(piece)
                    continue
                if first_token_ms is None:
                    first_token_ms = _ms(t_llm)
                parts.append(piece)
                yield {"type": "token", "text": piece}
        except Exception as e:  # noqa: BLE001
            log.exception("llm failed")
            qlog.status, qlog.error = "error", f"{type(e).__name__}: {e}"
            qlog.answer = "".join(parts)
            db.commit()
            yield {"type": "error", "message": f"大模型调用失败：{type(e).__name__}: {e}",
                   "query_id": qlog.id}
            return

        raw = "".join(parts)
        answer, citations, invalid = resolve_citations(raw, used)
        status = "ok"
        if answer.startswith(NOT_FOUND[:10]):
            # 拒答时不展示引用：模型有时会引用资料来说明「资料里只有什么」，对用户反而是干扰
            answer, citations, status = re.sub(r"\[\d+\]", "", answer), [], "no_answer"
        timings.update(llm_ms=_ms(t_llm), first_token_ms=first_token_ms, total_ms=_ms(t_start),
                       thinking_chars=thinking_chars)
        cited_ids = {c["chunk_id"] for c in citations}
        for r in qlog.retrieved:
            r["cited"] = r["chunk_id"] in cited_ids
        flag_modified(qlog, "retrieved")  # 原地修改 JSON 字段需要手动标记
        qlog.answer, qlog.citations, qlog.status, qlog.timings = answer, citations, status, timings
        qlog.params = {**qlog.params, "invalid_citations": invalid, "raw_answer": raw}
        db.commit()
        yield {"type": "done", "query_id": qlog.id, "answer": answer, "citations": citations,
               "status": status, "timings": timings, "invalid_citations": invalid}
    finally:
        db.close()
