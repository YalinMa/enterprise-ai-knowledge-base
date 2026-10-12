"""Query Rewrite：多轮对话里，把依赖上下文的追问改写成可以独立检索的完整问题。

例：上一轮问「普通员工出差住宿标准」，这一轮问「那总监呢？」
    → 改写为「总监出差住宿标准是多少？」再去检索。
没有历史、或使用 Mock LLM 时直接返回原问题。
"""

import re

from app.providers import LLMProvider

# 追问的典型特征：以承接词开头，或含指代词，或很短（省略了主语 / 对象）
_FOLLOWUP_START = re.compile(r"^(那|那么|那如果|如果是|还有|另外|再问|然后|所以|它|他|她|这|这个|那个|上面|刚才|同样|其中)")
_REFERENCE = re.compile(r"(它|他们|她们|这个|那个|这些|那些|上述|上面|刚才|前面|同样|这种|那种|该制度|这条|那条)")


def needs_rewrite(question: str, history: list[dict]) -> bool:
    """规则先判断要不要改写：完整的问题直接检索，省掉一次 LLM 调用（约 0.5–2 秒）。"""
    if not history:
        return False
    q = question.strip()
    return len(q) <= 10 or bool(_FOLLOWUP_START.match(q)) or bool(_REFERENCE.search(q))


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
