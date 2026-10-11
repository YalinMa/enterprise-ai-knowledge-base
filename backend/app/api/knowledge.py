"""知识库与文档管理接口。"""

import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import Chunk, Document, KnowledgeBase, QueryLog, get_db, kb_counts, utcnow
from app.rag import vectorstore
from app.rag.ingest import ingest_document
from app.rag.parsers import SUPPORTED_TYPES, detect_type
from app.schemas import (ChunkDetail, ChunkOut, DocumentOut, KBCreate, KBOut, KBUpdate,
                         StatsOut)

router = APIRouter(prefix="/api", tags=["knowledge"])


def _kb_out(db: Session, kb: KnowledgeBase) -> KBOut:
    docs, chunks = kb_counts(db, kb.id)
    return KBOut.model_validate(kb).model_copy(update={"document_count": docs,
                                                       "chunk_count": chunks})


def _get_kb(db: Session, kb_id: int) -> KnowledgeBase:
    kb = db.get(KnowledgeBase, kb_id)
    if kb is None:
        raise HTTPException(404, "知识库不存在")
    return kb


def _get_doc(db: Session, doc_id: int) -> Document:
    doc = db.get(Document, doc_id)
    if doc is None:
        raise HTTPException(404, "文档不存在")
    return doc


@router.get("/stats", response_model=StatsOut)
def stats(db: Session = Depends(get_db)):
    last_doc = db.scalar(select(func.max(Document.updated_at)))
    last_kb = db.scalar(select(func.max(KnowledgeBase.updated_at)))
    return StatsOut(
        kb_count=db.scalar(select(func.count(KnowledgeBase.id))) or 0,
        document_count=db.scalar(select(func.count(Document.id))) or 0,
        chunk_count=db.scalar(select(func.coalesce(func.sum(Document.chunk_count), 0))) or 0,
        query_count=db.scalar(select(func.count(QueryLog.id))) or 0,
        last_updated=max([t for t in (last_doc, last_kb) if t], default=None),
    )


# ---------------- 知识库 ----------------

@router.get("/knowledge-bases", response_model=list[KBOut])
def list_kbs(db: Session = Depends(get_db)):
    kbs = db.scalars(select(KnowledgeBase).order_by(KnowledgeBase.created_at)).all()
    return [_kb_out(db, kb) for kb in kbs]


@router.post("/knowledge-bases", response_model=KBOut, status_code=201)
def create_kb(body: KBCreate, db: Session = Depends(get_db)):
    kb = KnowledgeBase(name=body.name.strip(), description=body.description.strip(),
                       icon=body.icon)
    db.add(kb)
    db.commit()
    return _kb_out(db, kb)


@router.get("/knowledge-bases/{kb_id}", response_model=KBOut)
def get_kb(kb_id: int, db: Session = Depends(get_db)):
    return _kb_out(db, _get_kb(db, kb_id))


@router.patch("/knowledge-bases/{kb_id}", response_model=KBOut)
def update_kb(kb_id: int, body: KBUpdate, db: Session = Depends(get_db)):
    kb = _get_kb(db, kb_id)
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(kb, k, v)
    db.commit()
    return _kb_out(db, kb)


@router.delete("/knowledge-bases/{kb_id}", status_code=204)
def delete_kb(kb_id: int, db: Session = Depends(get_db)):
    kb = _get_kb(db, kb_id)
    for doc in kb.documents:
        Path(doc.storage_path).unlink(missing_ok=True)
    db.delete(kb)
    db.commit()
    vectorstore.drop_kb(kb_id)


# ---------------- 文档 ----------------

@router.get("/knowledge-bases/{kb_id}/documents", response_model=list[DocumentOut])
def list_documents(kb_id: int, db: Session = Depends(get_db)):
    _get_kb(db, kb_id)
    return db.scalars(select(Document).where(Document.kb_id == kb_id)
                      .order_by(Document.created_at.desc(), Document.id.desc())).all()


@router.post("/knowledge-bases/{kb_id}/documents", response_model=list[DocumentOut],
             status_code=201)
def upload_documents(kb_id: int, background: BackgroundTasks,
                     files: list[UploadFile] = File(...), db: Session = Depends(get_db)):
    settings = get_settings()
    kb = _get_kb(db, kb_id)
    created: list[Document] = []
    for f in files:
        name = Path(f.filename or "untitled").name
        ftype = detect_type(name)
        if ftype not in SUPPORTED_TYPES:
            raise HTTPException(400, f"不支持的文件类型：{name}（支持 {', '.join(SUPPORTED_TYPES)}）")
        dest_dir = settings.upload_dir / str(kb_id)
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / f"{uuid.uuid4().hex[:12]}_{name}"
        with dest.open("wb") as out:
            shutil.copyfileobj(f.file, out)
        size = dest.stat().st_size
        if size > settings.max_upload_mb * 1024 * 1024:
            dest.unlink()
            raise HTTPException(400, f"{name} 超过 {settings.max_upload_mb}MB 限制")
        doc = Document(kb_id=kb_id, filename=name, file_type=ftype, file_size=size,
                       storage_path=str(dest), status="pending")
        db.add(doc)
        created.append(doc)
    kb.updated_at = utcnow()
    db.commit()
    for doc in created:
        background.add_task(ingest_document, doc.id)
    return created


@router.delete("/documents/{doc_id}", status_code=204)
def delete_document(doc_id: int, db: Session = Depends(get_db)):
    doc = _get_doc(db, doc_id)
    vectorstore.delete_document(doc.kb_id, doc.id)
    Path(doc.storage_path).unlink(missing_ok=True)
    kb = db.get(KnowledgeBase, doc.kb_id)
    kb.updated_at = utcnow()
    db.delete(doc)
    db.commit()


@router.post("/documents/{doc_id}/reparse", response_model=DocumentOut)
def reparse_document(doc_id: int, background: BackgroundTasks, db: Session = Depends(get_db)):
    doc = _get_doc(db, doc_id)
    doc.status, doc.error = "pending", None
    db.commit()
    background.add_task(ingest_document, doc.id)
    return doc


@router.post("/knowledge-bases/{kb_id}/reparse", response_model=list[DocumentOut])
def reparse_kb(kb_id: int, background: BackgroundTasks, db: Session = Depends(get_db)):
    """切换 Embedding 模型后，整个知识库重建向量。"""
    kb = _get_kb(db, kb_id)
    vectorstore.drop_kb(kb_id)
    kb.embedding_signature = None
    for doc in kb.documents:
        doc.status, doc.error = "pending", None
        background.add_task(ingest_document, doc.id)
    db.commit()
    return kb.documents


@router.get("/documents/{doc_id}/chunks", response_model=list[ChunkOut])
def list_chunks(doc_id: int, db: Session = Depends(get_db)):
    _get_doc(db, doc_id)
    return db.scalars(select(Chunk).where(Chunk.document_id == doc_id)
                      .order_by(Chunk.chunk_index)).all()


@router.get("/chunks/{chunk_id}", response_model=ChunkDetail)
def get_chunk(chunk_id: str, db: Session = Depends(get_db)):
    c = db.get(Chunk, chunk_id)
    if c is None:
        raise HTTPException(404, "切片不存在（文档可能已被删除或重新解析）")
    return ChunkDetail(**ChunkOut.model_validate(c).model_dump(), kb_id=c.kb_id,
                       document_name=c.document.filename, file_type=c.document.file_type)


@router.get("/documents/{doc_id}/file")
def download_file(doc_id: int, db: Session = Depends(get_db)):
    doc = _get_doc(db, doc_id)
    path = Path(doc.storage_path)
    if not path.exists():
        raise HTTPException(404, "原文件不存在")
    media = {"pdf": "application/pdf", "md": "text/markdown; charset=utf-8",
             "txt": "text/plain; charset=utf-8"}.get(doc.file_type)
    # PDF / 文本直接在浏览器内打开（PDF 可配合 #page=N 跳转到引用页）
    return FileResponse(path, media_type=media, filename=doc.filename,
                        content_disposition_type="inline" if media else "attachment")
