"""全局配置：全部来自环境变量 / .env，代码里不写死任何厂商。

LLM_PROVIDER 和 EMBEDDING_PROVIDER 可以填「预设名」（openai / deepseek / qwen …），
预设只是帮你补全 base_url 和默认模型；填 openai_compatible 则完全按你给的 BASE_URL / MODEL 走。
不填 Key 时自动降级为 mock，保证项目没有任何 Key 也能完整演示。
"""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_DIR = BACKEND_DIR.parent

# 预设：(base_url, 默认 chat 模型, 默认 embedding 模型)。None 表示该厂商不提供此能力。
PROVIDER_PRESETS: dict[str, dict] = {
    "openai": {"label": "OpenAI", "base_url": "https://api.openai.com/v1",
               "llm_model": "gpt-5.5", "embedding_model": "text-embedding-3-small"},
    # deepseek-flash 是推理模型（先思考再回答），评测中首字延迟 2.4s / P95 7.5s；
    # deepseek-chat 质量相同（评测 100%）而首字 0.6s，因此作为默认
    "deepseek": {"label": "DeepSeek", "base_url": "https://api.deepseek.com",
                 "llm_model": "deepseek-chat", "embedding_model": None},
    "qwen": {"label": "通义千问", "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
             "llm_model": "qwen-plus", "embedding_model": "text-embedding-v4"},
    "openai_compatible": {"label": "OpenAI 兼容接口", "base_url": None,
                          "llm_model": None, "embedding_model": None},
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", env_file_encoding="utf-8",
                                      extra="ignore")

    # ---- LLM ----
    llm_provider: str = "mock"          # openai / deepseek / qwen / openai_compatible / mock
    llm_api_key: str = ""
    llm_base_url: str = ""
    llm_model: str = ""
    llm_temperature: float = 0.1
    llm_extra_body: str = ""            # 可选：JSON 字符串，透传厂商私有参数

    # ---- Embedding ----
    embedding_provider: str = "mock"    # openai / qwen / openai_compatible / local / mock
    embedding_api_key: str = ""
    embedding_base_url: str = ""
    embedding_model: str = ""
    embedding_dimensions: int | None = None
    local_embedding_model: str = "BAAI/bge-small-zh-v1.5"

    # ---- Rerank ----
    rerank_provider: str = "none"       # qwen / none
    rerank_api_key: str = ""            # 不填时，若 Embedding 也用 qwen 则复用其 Key
    rerank_model: str = "gte-rerank-v2"
    rerank_min_score: float = 0.15      # 开启 Rerank 后，拒答闸门改用重排分数（基于评测集标定）
    rerank_keep_similarity: float = 0.55  # 重排分数偏低但余弦相似度很高的切片也放行（口语化问法）

    # ---- RAG 参数 ----
    chunk_size: int = 500               # 字符数；中文约 500~700 tokens
    chunk_overlap: int = 80             # 约 16%
    top_k: int = 5
    min_score: float | None = None      # 相似度阈值；不填则按 embedding 提供方取经验默认值
    history_turns: int = 3              # 带入 LLM 的历史轮数
    retrieval_mode: str = "hybrid"      # vector / hybrid（向量 + BM25，RRF 融合）
    candidate_k: int = 20               # 每路召回的候选数，融合 / 重排后再截到 top_k
    rrf_k: int = 60                     # RRF 平滑常数
    query_rewrite: bool = True          # 多轮对话时把追问改写成独立问题再检索
    rewrite_model: str = ""             # 追问改写用的模型（同一厂商），留空用 LLM_MODEL；建议用非推理的快模型

    # ---- 存储 ----
    data_dir: Path = BACKEND_DIR / "data"
    max_upload_mb: int = 20
    cors_origins: str = "http://localhost:3100,http://127.0.0.1:3100"

    @property
    def upload_dir(self) -> Path:
        return self.data_dir / "uploads"

    @property
    def chroma_dir(self) -> Path:
        return self.data_dir / "chroma"

    @property
    def db_url(self) -> str:
        return f"sqlite:///{self.data_dir / 'kb.sqlite3'}"


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    s.data_dir.mkdir(parents=True, exist_ok=True)
    s.upload_dir.mkdir(parents=True, exist_ok=True)
    return s
