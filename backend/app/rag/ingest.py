"""Ingestion Pipeline：Document → Parser → Cleaning → Chunking → Embedding → Vector DB。

在后台线程中运行，每一步都更新文档状态，前端轮询即可看到「解析中 → 向量化中 → 已完成」。
"""

import logging
import re
import time
from pathlib import Path

from sqlalchemy import delete, select

from app.config import get_settings
from app.db import Chunk, Document, KnowledgeBase, SessionLocal, utcnow
from app.providers import get_embedder
from app.rag import vectorstore
from app.rag.chunking import chunk_document, embedding_text
from app.rag.cleaning import clean_text
from app.rag.parsers import ParsedSection, parse_file

log = logging.getLogger("ingest")

# 文档开头出现这些字样时，自动标记为「已废止」（用户也可以在知识库页面手动切换）
_DEPRECATED = re.compile(r"(状态[：:]\s*\**\s*已废止|已于.{0,20}废止|[（(·]\s*已废止\s*[）)]?)")


def detect_deprecated(filename: str, head_text: str) -> bool:
    return bool(_DEPRECATED.search(filename) or _DEPRECATED.search(head_text[:800]))


def _set_status(db, doc: Document, status: str, **fields) -> None:
    doc.status = status
    for k, v in fields.items():
        setattr(doc, k, v)
    db.commit()


def ingest_document(document_id: int) -> None:
    settings, embedder = get_settings(), get_embedder()
    db = SessionLocal()
    try:
        doc = db.get(Document, document_id)
        if doc is None:
            return
        t0 = time.perf_counter()
        _set_status(db, doc, "parsing", error=None)

        # 1. Parse
        parsed = parse_file(Path(doc.storage_path), doc.file_type)
        # 2. Clean
        from_pdf = doc.file_type == "pdf"
        parsed.sections = [ParsedSection(clean_text(s.text, from_pdf), s.page) for s in parsed.sections]
        char_count = sum(len(s.text) for s in parsed.sections)
        if char_count == 0:
            raise ValueError("文件中没有可识别的文字内容")
        # 3. Chunk
        pieces = chunk_document(parsed, settings.chunk_size, settings.chunk_overlap)
        if not pieces:
            raise ValueError("切片结果为空")
        if detect_deprecated(doc.filename, parsed.sections[0].text if parsed.sections else ""):
            doc.lifecycle = "deprecated"
        _set_status(db, doc, "embedding", page_count=parsed.page_count, char_count=char_count)

        # 4. Embedding
        vectors = embedder.embed_documents([embedding_text(doc.filename, p) for p in pieces])

        # 5. 写入 Vector DB + 元数据库（先清掉旧切片，重新解析时幂等）
        vectorstore.delete_document(doc.kb_id, doc.id)
        db.execute(delete(Chunk).where(Chunk.document_id == doc.id))
        ids = [f"d{doc.id}-c{i:04d}" for i in range(len(pieces))]
        metas = []
        for i, p in enumerate(pieces):
            meta = {"document_id": doc.id, "document_name": doc.filename, "kb_id": doc.kb_id,
                    "chunk_index": i, "file_type": doc.file_type}
            if p.page is not None:
                meta["page"] = p.page
            if p.section:
                meta["section"] = p.section
            metas.append(meta)
            db.add(Chunk(id=ids[i], kb_id=doc.kb_id, document_id=doc.id, chunk_index=i,
                         content=p.content, page=p.page, section=p.section,
                         char_count=len(p.content)))
        vectorstore.upsert(doc.kb_id, ids, vectors, [p.content for p in pieces], metas)

        kb = db.get(KnowledgeBase, doc.kb_id)
        kb.embedding_signature = embedder.signature
        kb.updated_at = utcnow()
        _set_status(db, doc, "ready", chunk_count=len(pieces))
        log.info("ingested %s: %d chunks in %.1fs", doc.filename, len(pieces),
                 time.perf_counter() - t0)
    except Exception as e:  # noqa: BLE001 —— 任何失败都要落到文档状态上给用户看
        log.exception("ingest failed: %s", document_id)
        db.rollback()
        doc = db.get(Document, document_id)
        if doc is not None:
            _set_status(db, doc, "failed", error=f"{type(e).__name__}: {e}"[:1000])
    finally:
        db.close()


def reset_stuck_documents() -> None:
    """服务重启时，把上次没跑完的文档重新排队；顺便预热 jieba 词典，避免第一次检索多等 0.5 秒。

    必须先取出待处理文档再预热：否则预热期间新上传的文档也会被捞出来，与上传任务重复入库。
    """
    db = SessionLocal()
    try:
        ids = db.scalars(select(Document.id).where(
            Document.status.in_(["pending", "parsing", "embedding"]))).all()
    finally:
        db.close()
    from app.rag.bm25 import tokenize
    tokenize("预热")
    for i in ids:
        ingest_document(i)
