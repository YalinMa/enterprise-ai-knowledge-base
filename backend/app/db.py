"""SQLite 元数据库：知识库、文档、切片、检索记录。

向量存在 Chroma，这里存的是「人能看懂的」那一份：切片原文、来源、页码。
这样引用溯源、切片浏览、以后加 BM25 / 权限过滤都不依赖向量库。
"""

from datetime import datetime, timezone

from sqlalchemy import (JSON, DateTime, ForeignKey, Integer, String, Text, create_engine,
                        event, func, select)
from sqlalchemy.orm import (DeclarativeBase, Mapped, Session, mapped_column, relationship,
                            sessionmaker)

from app.config import get_settings


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class KnowledgeBase(Base):
    __tablename__ = "knowledge_bases"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(Text, default="")
    icon: Mapped[str] = mapped_column(String(20), default="book")
    # 预留：部门 / 权限。第一版不做鉴权，但字段先放好。
    department: Mapped[str | None] = mapped_column(String(100), nullable=True)
    embedding_signature: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow,
                                                 onupdate=utcnow)

    documents: Mapped[list["Document"]] = relationship(back_populates="kb",
                                                       cascade="all, delete-orphan")


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(primary_key=True)
    kb_id: Mapped[int] = mapped_column(ForeignKey("knowledge_bases.id", ondelete="CASCADE"),
                                       index=True)
    filename: Mapped[str] = mapped_column(String(255))
    file_type: Mapped[str] = mapped_column(String(20))
    file_size: Mapped[int] = mapped_column(Integer)
    storage_path: Mapped[str] = mapped_column(String(500))
    # pending → parsing → embedding → ready / failed
    status: Mapped[str] = mapped_column(String(20), default="pending")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    page_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    char_count: Mapped[int] = mapped_column(Integer, default=0)
    chunk_count: Mapped[int] = mapped_column(Integer, default=0)
    source: Mapped[str] = mapped_column(String(50), default="upload")  # 预留：notion / feishu / web
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow,
                                                 onupdate=utcnow)

    kb: Mapped[KnowledgeBase] = relationship(back_populates="documents")
    chunks: Mapped[list["Chunk"]] = relationship(back_populates="document",
                                                 cascade="all, delete-orphan")


class Chunk(Base):
    __tablename__ = "chunks"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # 如 d12-c0003
    kb_id: Mapped[int] = mapped_column(Integer, index=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"),
                                             index=True)
    chunk_index: Mapped[int] = mapped_column(Integer)
    content: Mapped[str] = mapped_column(Text)
    page: Mapped[int | None] = mapped_column(Integer, nullable=True)
    section: Mapped[str | None] = mapped_column(String(500), nullable=True)
    char_count: Mapped[int] = mapped_column(Integer)

    document: Mapped[Document] = relationship(back_populates="chunks")


class QueryLog(Base):
    """每一次问答的完整检索轨迹 —— 「检索详情」页的数据来源，也是以后做 RAG 评测的原料。"""
    __tablename__ = "query_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    kb_id: Mapped[int] = mapped_column(Integer, index=True)
    kb_name: Mapped[str] = mapped_column(String(100))
    question: Mapped[str] = mapped_column(Text)
    retrieval_query: Mapped[str] = mapped_column(Text)   # 预留：Query Rewrite 后的检索语句
    retrieved: Mapped[list] = mapped_column(JSON, default=list)
    prompt: Mapped[list] = mapped_column(JSON, default=list)
    answer: Mapped[str] = mapped_column(Text, default="")
    citations: Mapped[list] = mapped_column(JSON, default=list)
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    timings: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(20), default="ok")  # ok / no_context / error
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


_settings = get_settings()
engine = create_engine(_settings.db_url, connect_args={"check_same_thread": False})


@event.listens_for(engine, "connect")
def _sqlite_pragmas(dbapi_conn, _):
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA foreign_keys=ON")
    cur.execute("PRAGMA journal_mode=WAL")
    cur.close()


SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def init_db() -> None:
    Base.metadata.create_all(engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def kb_counts(db: Session, kb_id: int) -> tuple[int, int]:
    docs = db.scalar(select(func.count(Document.id)).where(Document.kb_id == kb_id)) or 0
    chunks = db.scalar(select(func.coalesce(func.sum(Document.chunk_count), 0))
                       .where(Document.kb_id == kb_id)) or 0
    return docs, chunks
