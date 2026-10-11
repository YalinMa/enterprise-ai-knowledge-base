"""Embedding Provider 层。

- OpenAICompatEmbedding：OpenAI / 通义 text-embedding / 任何 /v1/embeddings 兼容接口
- LocalEmbedding：fastembed + BAAI/bge-small-zh-v1.5（ONNX，本机 CPU 运行，无需 Key）
- MockEmbedding：字符 bigram 哈希向量，零依赖，仅用于离线演示

signature 用来标记「这个知识库的向量是用哪个模型算的」，换模型后提示重新解析，避免维度/语义错配。
"""

import hashlib
import math
import re
from abc import ABC, abstractmethod

from openai import OpenAI


class EmbeddingProvider(ABC):
    provider: str
    model: str
    default_min_score: float = 0.3  # 经验阈值：低于它的切片视为不相关
    is_mock: bool = False

    @property
    def signature(self) -> str:
        return f"{self.provider}:{self.model}"

    @abstractmethod
    def embed_documents(self, texts: list[str]) -> list[list[float]]: ...

    def embed_query(self, text: str) -> list[float]:
        return self.embed_documents([text])[0]


class OpenAICompatEmbedding(EmbeddingProvider):
    # 不同模型的相似度分布差异很大，阈值需按模型标定（数据来自 demo 知识库的相关 / 无关问题对比）
    MODEL_MIN_SCORES = {"text-embedding-v4": 0.45, "text-embedding-v3": 0.45,
                        "text-embedding-3-small": 0.3, "text-embedding-3-large": 0.3}

    def __init__(self, provider: str, api_key: str, base_url: str, model: str,
                 dimensions: int | None = None, batch_size: int = 10):
        self.provider, self.model, self.dimensions = provider, model, dimensions
        self.batch_size = batch_size
        self.default_min_score = self.MODEL_MIN_SCORES.get(model, 0.35)
        self.client = OpenAI(api_key=api_key, base_url=base_url, timeout=60, max_retries=2)

    def embed_documents(self, texts):
        out: list[list[float]] = []
        for i in range(0, len(texts), self.batch_size):
            kwargs = {"model": self.model, "input": texts[i:i + self.batch_size]}
            if self.dimensions:
                kwargs["dimensions"] = self.dimensions
            resp = self.client.embeddings.create(**kwargs)
            out.extend(d.embedding for d in sorted(resp.data, key=lambda d: d.index))
        return out


class LocalEmbedding(EmbeddingProvider):
    default_min_score = 0.4
    # BGE 中文模型推荐给 query 加检索指令，文档不加
    BGE_ZH_QUERY_PREFIX = "为这个句子生成表示以用于检索相关文章："

    def __init__(self, model: str):
        from fastembed import TextEmbedding  # 延迟导入：不用 local 就不加载 onnxruntime
        self.provider, self.model = "local", model
        self._model = TextEmbedding(model_name=model)

    def embed_documents(self, texts):
        return [v.tolist() for v in self._model.embed(texts, batch_size=32)]

    def embed_query(self, text):
        if "bge" in self.model.lower() and "zh" in self.model.lower():
            text = self.BGE_ZH_QUERY_PREFIX + text
        return next(iter(self._model.embed([text]))).tolist()


class MockEmbedding(EmbeddingProvider):
    provider, model, is_mock = "mock", "char-bigram-hash-512", True
    default_min_score = 0.12
    DIM = 512

    def _vec(self, text: str) -> list[float]:
        text = re.sub(r"\s+", "", text.lower())
        v = [0.0] * self.DIM
        for i in range(len(text) - 1):
            h = int(hashlib.md5(text[i:i + 2].encode()).hexdigest()[:8], 16)
            v[h % self.DIM] += 1.0
        norm = math.sqrt(sum(x * x for x in v)) or 1.0
        return [x / norm for x in v]

    def embed_documents(self, texts):
        return [self._vec(t) for t in texts]
