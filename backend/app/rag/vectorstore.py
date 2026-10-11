"""Vector DB：Chroma 本地持久化，每个知识库一个 collection，余弦距离。

只在这里接触 Chroma API；以后换 Qdrant / Milvus / pgvector 只需要重写这个文件。
"""

from dataclasses import dataclass
from functools import lru_cache

import chromadb

from app.config import get_settings


@dataclass
class VectorHit:
    chunk_id: str
    score: float          # 余弦相似度，越大越相关
    metadata: dict
    content: str


@lru_cache
def _client():
    return chromadb.PersistentClient(path=str(get_settings().chroma_dir),
                                     settings=chromadb.Settings(anonymized_telemetry=False))


def _collection(kb_id: int):
    return _client().get_or_create_collection(
        name=f"kb_{kb_id}", configuration={"hnsw": {"space": "cosine"}}, embedding_function=None,
    )


def upsert(kb_id: int, ids: list[str], embeddings: list[list[float]], documents: list[str],
           metadatas: list[dict]) -> None:
    col = _collection(kb_id)
    for i in range(0, len(ids), 500):
        col.upsert(ids=ids[i:i + 500], embeddings=embeddings[i:i + 500],
                   documents=documents[i:i + 500], metadatas=metadatas[i:i + 500])


def delete_document(kb_id: int, document_id: int) -> None:
    _collection(kb_id).delete(where={"document_id": document_id})


def drop_kb(kb_id: int) -> None:
    try:
        _client().delete_collection(f"kb_{kb_id}")
    except Exception:
        pass


def query(kb_id: int, embedding: list[float], top_k: int, where: dict | None = None) -> list[VectorHit]:
    col = _collection(kb_id)
    if col.count() == 0:
        return []
    res = col.query(query_embeddings=[embedding], n_results=min(top_k, col.count()), where=where,
                    include=["metadatas", "documents", "distances"])
    hits = []
    for cid, dist, meta, doc in zip(res["ids"][0], res["distances"][0], res["metadatas"][0],
                                    res["documents"][0]):
        hits.append(VectorHit(cid, round(1 - float(dist), 4), meta or {}, doc or ""))
    return hits
