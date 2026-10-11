"""BM25 关键词检索：补足向量检索对编号、电话、金额、专有名词等「字面匹配」的短板。

切片原文本来就在 SQLite 里，按知识库在内存里建 BM25 索引（jieba 搜索引擎模式分词），
文档有增删 / 重新解析时根据签名自动重建。演示规模（几千切片）重建只需几十毫秒；
规模更大时可换成 Elasticsearch / OpenSearch，接口不变。
"""

import re
import threading
from dataclasses import dataclass

import jieba
from rank_bm25 import BM25Okapi
from sqlalchemy import func, select

from app.db import Chunk, Document, SessionLocal

jieba.setLogLevel(60)  # 关掉 jieba 初始化日志

_STOPWORDS = set("的 了 是 在 和 与 或 及 等 吗 呢 吧 啊 有 我 你 他 我们 什么 怎么 怎样 如何 多少 哪些 哪个 "
                 "可以 能 需要 要 一个 这个 那个 请问 一下 是否 还是 就 都 也 会".split())
_TOKEN_OK = re.compile(r"[\w一-鿿]")


def tokenize(text: str) -> list[str]:
    return [t for t in (w.strip().lower() for w in jieba.lcut_for_search(text))
            if t and t not in _STOPWORDS and _TOKEN_OK.search(t)]


@dataclass
class _Index:
    signature: tuple
    ids: list[str]
    bm25: BM25Okapi | None


_cache: dict[int, _Index] = {}
_lock = threading.Lock()


def _signature(db, kb_id: int) -> tuple:
    count = db.scalar(select(func.count(Chunk.id)).where(Chunk.kb_id == kb_id))
    latest = db.scalar(select(func.max(Document.updated_at)).where(Document.kb_id == kb_id))
    return count, str(latest)


def _get_index(kb_id: int) -> _Index:
    db = SessionLocal()
    try:
        sig = _signature(db, kb_id)
        idx = _cache.get(kb_id)
        if idx and idx.signature == sig:
            return idx
        with _lock:
            rows = db.execute(
                select(Chunk.id, Chunk.content, Chunk.section, Document.filename)
                .join(Document, Document.id == Chunk.document_id)
                .where(Chunk.kb_id == kb_id, Document.status == "ready")
            ).all()
            corpus = [tokenize(f"{name} {section or ''} {content}") for _, content, section, name in rows]
            idx = _Index(sig, [r[0] for r in rows], BM25Okapi(corpus) if corpus else None)
            _cache[kb_id] = idx
            return idx
    finally:
        db.close()


def search(kb_id: int, query: str, top_n: int) -> list[tuple[str, float]]:
    """返回 [(chunk_id, bm25_score)]，按分数降序，只保留有词命中的结果。"""
    idx = _get_index(kb_id)
    q = tokenize(query)
    if idx.bm25 is None or not q:
        return []
    scores = idx.bm25.get_scores(q)
    order = sorted(range(len(scores)), key=lambda i: -scores[i])[:top_n]
    return [(idx.ids[i], float(scores[i])) for i in order if scores[i] > 0]
