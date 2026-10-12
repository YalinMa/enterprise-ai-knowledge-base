from datetime import datetime, timezone
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field

# SQLite 不保存时区，读出来是 naive datetime；统一标记为 UTC，前端再转本地时间
UTCDateTime = Annotated[datetime, AfterValidator(
    lambda d: d.replace(tzinfo=timezone.utc) if d.tzinfo is None else d)]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class KBCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str = ""
    icon: str = "book"


class KBUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = None
    icon: str | None = None


class KBOut(ORM):
    id: int
    name: str
    description: str
    icon: str
    embedding_signature: str | None
    created_at: UTCDateTime
    updated_at: UTCDateTime
    document_count: int = 0
    chunk_count: int = 0


class DocumentOut(ORM):
    id: int
    kb_id: int
    filename: str
    file_type: str
    file_size: int
    status: str
    error: str | None
    page_count: int | None
    char_count: int
    chunk_count: int
    lifecycle: str = "active"
    created_at: UTCDateTime
    updated_at: UTCDateTime


class DocumentUpdate(BaseModel):
    lifecycle: str = Field(pattern="^(active|deprecated)$")


class ChunkOut(ORM):
    id: str
    document_id: int
    chunk_index: int
    content: str
    page: int | None
    section: str | None
    char_count: int


class ChunkDetail(ChunkOut):
    document_name: str
    file_type: str
    kb_id: int


class StatsOut(BaseModel):
    kb_count: int
    document_count: int
    chunk_count: int
    query_count: int
    last_updated: UTCDateTime | None


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    kb_id: int
    question: str = Field(min_length=1, max_length=2000)
    history: list[ChatMessage] = []
    top_k: int | None = Field(default=None, ge=1, le=20)
    # 检索策略覆盖（不填则用 .env 默认值），问答页的「检索设置」会传这几个字段
    retrieval_mode: str | None = Field(default=None, pattern="^(vector|hybrid)$")
    rerank: bool | None = None
    query_rewrite: bool | None = None
    stream: bool = True


class QueryLogSummary(ORM):
    id: int
    kb_id: int
    kb_name: str
    question: str
    status: str
    answer: str
    source: str = "chat"
    feedback: dict | None = None
    created_at: UTCDateTime
    timings: dict
    citations: list


class QueryLogOut(QueryLogSummary):
    retrieval_query: str
    retrieved: list
    prompt: list
    params: dict
    error: str | None


FEEDBACK_REASONS = ["答案错误", "引用不对", "没回答到点上", "不该拒答", "信息过时", "其他"]


class FeedbackIn(BaseModel):
    rating: int = Field(ge=-1, le=1)          # 1 赞 / -1 踩 / 0 取消
    reasons: list[str] = []
    comment: str = Field(default="", max_length=500)


class ToEvalCase(BaseModel):
    expected_docs: list[str] = []
    expected_keywords: list[str] = []
    should_refuse: bool = False
    category: str = "用户反馈"
