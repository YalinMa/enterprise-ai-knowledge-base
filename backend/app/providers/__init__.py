"""根据配置创建 Provider。新增厂商：OpenAI 兼容的只需在 config.PROVIDER_PRESETS 加一项。"""

import logging
from functools import lru_cache

from app.config import PROVIDER_PRESETS, get_settings
from app.providers.embedding import (EmbeddingProvider, LocalEmbedding, MockEmbedding,
                                     OpenAICompatEmbedding)
from app.providers.llm import LLMProvider, MockLLM, OpenAICompatLLM, Thinking
from app.providers.rerank import QwenReranker, Reranker

log = logging.getLogger("providers")

__all__ = ["get_llm", "get_embedder", "get_reranker", "describe_providers", "LLMProvider",
           "EmbeddingProvider", "Reranker", "Thinking"]


def _resolve(provider: str, base_url: str, model: str, kind: str) -> tuple[str, str]:
    preset = PROVIDER_PRESETS.get(provider)
    if preset is None:
        raise ValueError(f"未知的 provider：{provider}，可选：{', '.join(PROVIDER_PRESETS)} / mock")
    base_url = base_url or preset["base_url"]
    model = model or preset[f"{kind}_model"]
    if not base_url or not model:
        raise ValueError(f"{provider} 需要配置 {kind.upper()}_BASE_URL 和 {kind.upper()}_MODEL")
    return base_url, model


@lru_cache
def get_llm(model: str | None = None) -> LLMProvider:
    """model 可覆盖默认模型（同一厂商），用于追问改写换快模型、评测对比不同模型。"""
    s = get_settings()
    if s.llm_provider == "mock" or not s.llm_api_key:
        return MockLLM()
    base_url, model = _resolve(s.llm_provider, s.llm_base_url, model or s.llm_model, "llm")
    return OpenAICompatLLM(s.llm_provider, s.llm_api_key, base_url, model,
                           s.llm_temperature, s.llm_extra_body)


@lru_cache
def get_embedder() -> EmbeddingProvider:
    s = get_settings()
    p = s.embedding_provider
    if p == "mock":
        return MockEmbedding()
    if p == "local":
        try:
            return LocalEmbedding(s.local_embedding_model)
        except Exception:  # noqa: BLE001 —— 首次需从 HuggingFace 下载模型，网络不通时降级
            log.exception("本地 Embedding 模型加载失败，降级为 mock")
            return MockEmbedding()
    # 远程 embedding 允许复用 LLM 的 Key（同一厂商时很常见）
    key = s.embedding_api_key or (s.llm_api_key if p == s.llm_provider else "")
    if not key:
        return MockEmbedding()
    base_url, model = _resolve(p, s.embedding_base_url, s.embedding_model, "embedding")
    batch = 10 if p == "qwen" else 64  # 通义 embedding 单批上限 10 条
    return OpenAICompatEmbedding(p, key, base_url, model, s.embedding_dimensions, batch)


@lru_cache
def get_reranker() -> Reranker | None:
    """未配置时返回 None，检索流程自动跳过重排。"""
    s = get_settings()
    if s.rerank_provider == "qwen":
        key = s.rerank_api_key or (s.embedding_api_key if s.embedding_provider == "qwen" else "")
        return QwenReranker(key, s.rerank_model) if key else None
    return None


def describe_providers() -> dict:
    s, llm, emb, rr = get_settings(), get_llm(), get_embedder(), get_reranker()
    return {
        "llm": {"provider": llm.provider, "model": llm.model, "is_mock": llm.is_mock,
                "configured_provider": s.llm_provider,
                "rewrite_model": get_llm(s.rewrite_model or None).model},
        "embedding": {"provider": emb.provider, "model": emb.model, "is_mock": emb.is_mock,
                      "configured_provider": s.embedding_provider,
                      "signature": emb.signature},
        "rerank": {"provider": rr.provider if rr else "none", "model": rr.model if rr else None,
                   "enabled": rr is not None, "configured_provider": s.rerank_provider},
    }
