"""Rerank Provider：对召回候选做 query-document 交叉打分，精排后再截取 Top-K。

向量检索把问题和文档分别编码，Reranker 把两者放在一起判断相关性，更准但更慢，
所以只对融合后的少量候选（candidate_k 条）调用。新增 Cohere / Jina / 本地 bge-reranker
只需实现 Reranker.score。
"""

from abc import ABC, abstractmethod

import httpx


class Reranker(ABC):
    provider: str
    model: str

    @property
    def signature(self) -> str:
        return f"{self.provider}:{self.model}"

    @abstractmethod
    def score(self, query: str, documents: list[str]) -> list[float]:
        """返回与 documents 一一对应的相关性分数（0~1，越大越相关）。"""


class QwenReranker(Reranker):
    URL = "https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank"

    def __init__(self, api_key: str, model: str):
        self.provider, self.model, self.api_key = "qwen", model, api_key
        self.client = httpx.Client(timeout=30)

    def score(self, query, documents):
        if not documents:
            return []
        resp = self.client.post(self.URL, headers={"Authorization": f"Bearer {self.api_key}"}, json={
            "model": self.model,
            "input": {"query": query, "documents": documents},
            "parameters": {"return_documents": False, "top_n": len(documents)},
        })
        resp.raise_for_status()
        scores = [0.0] * len(documents)
        for r in resp.json()["output"]["results"]:
            scores[r["index"]] = float(r["relevance_score"])
        return scores
