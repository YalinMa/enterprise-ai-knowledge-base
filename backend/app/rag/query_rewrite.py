"""Query Rewrite：多轮对话里，把依赖上下文的追问改写成可以独立检索的完整问题。

例：上一轮问「普通员工出差住宿标准」，这一轮问「那总监呢？」
    → 改写为「总监出差住宿标准是多少？」再去检索。
没有历史、或使用 Mock LLM 时直接返回原问题。
"""

from app.providers import LLMProvider

REWRITE_PROMPT = """你是检索查询改写器。根据对话历史，把用户最新的问题改写成一个不依赖上下文、可以独立用于知识库检索的完整问题。

规则：
- 补全省略的主语、对象和条件（如「那总监呢？」要补全为具体在问什么）
- 如果最新问题本身已经完整，原样输出
- 不要回答问题，不要添加历史中没有的信息
- 只输出改写后的问题，不要任何解释

## 对话历史
{history}

## 最新问题
{question}"""


def rewrite_query(llm: LLMProvider, question: str, history: list[dict]) -> str:
    if not history or llm.is_mock:
        return question
    lines = []
    for h in history[-4:]:
        role = "用户" if h["role"] == "user" else "助手"
        lines.append(f"{role}：{h['content'][:300]}")
    out = llm.complete([{"role": "user", "content": REWRITE_PROMPT.format(
        history="\n".join(lines), question=question)}]).strip().strip("「」\"'")
    # 模型偶尔会输出多行或过长内容，此时退回原问题
    if not out or "\n" in out or len(out) > max(80, len(question) * 4):
        return question
    return out
