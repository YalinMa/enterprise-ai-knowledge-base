"""RAG 问答主流程：Question → Retriever → Top-K → 阈值过滤 → Prompt → LLM → Answer + Citation。

以事件流的形式产出，API 层直接转成 SSE：
  retrieval → token × N → done      （或 error）
每次问答的完整轨迹（召回切片、分数、Prompt、耗时、引用）都写入 QueryLog。
"""

import logging
import re
import time
from collections.abc import Iterator

from sqlalchemy.orm.attributes import flag_modified

from app.config import get_settings
from app.db import KnowledgeBase, QueryLog, SessionLocal
from app.providers import get_embedder, get_llm
from app.rag.citations import resolve_citations
from app.rag.prompts import NOT_FOUND, build_messages
from app.rag.retriever import VectorRetriever

log = logging.getLogger("rag")


def _ms(t: float) -> int:
    return round((time.perf_counter() - t) * 1000)


def answer_stream(kb_id: int, question: str, history: list[dict] | None = None,
                  top_k: int | None = None) -> Iterator[dict]:
    settings, embedder, llm = get_settings(), get_embedder(), get_llm()
    top_k = top_k or settings.top_k
    min_score = settings.min_score if settings.min_score is not None else embedder.default_min_score
    history = (history or [])[-settings.history_turns * 2:]
    t_start = time.perf_counter()

    db = SessionLocal()
    try:
        kb = db.get(KnowledgeBase, kb_id)
        if kb is None:
            yield {"type": "error", "message": "知识库不存在"}
            return
        qlog = QueryLog(kb_id=kb_id, kb_name=kb.name, question=question, retrieval_query=question,
                        status="running", params={
                            "top_k": top_k, "min_score": min_score,
                            "embedding": embedder.signature,
                            "llm": f"{llm.provider}:{llm.model}",
                            "chunk_size": settings.chunk_size,
                            "chunk_overlap": settings.chunk_overlap,
                            "retriever": "vector",
                        })
        db.add(qlog)
        db.commit()

        warning = None
        if kb.embedding_signature and kb.embedding_signature != embedder.signature:
            warning = (f"该知识库的向量由 {kb.embedding_signature} 生成，当前 Embedding 为 "
                       f"{embedder.signature}，请在知识库详情页「全部重新解析」。")

        # ---- 检索 ----
        try:
            result = VectorRetriever(embedder, min_score).retrieve(kb_id, question, top_k)
        except Exception as e:  # noqa: BLE001
            log.exception("retrieval failed")
            msg = warning or f"检索失败：{type(e).__name__}: {e}"
            qlog.status, qlog.error = "error", msg
            db.commit()
            yield {"type": "error", "message": msg, "query_id": qlog.id}
            return
        used = [c for c in result.chunks if c.passed_threshold]
        timings = dict(result.timings)
        qlog.retrieved = [c.to_dict() for c in result.chunks]
        db.commit()
        yield {"type": "retrieval", "query_id": qlog.id,
               "chunks": [c.to_dict() for c in result.chunks],
               "used_count": len(used), "min_score": min_score, "warning": warning}

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
        try:
            context = [{"index": i, "content": c.content} for i, c in enumerate(used, 1)]
            for piece in llm.stream(messages, context=context):
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
        timings.update(llm_ms=_ms(t_llm), first_token_ms=first_token_ms, total_ms=_ms(t_start))
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
