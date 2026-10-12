"""Prompt 模板。资料按 [1] [2] … 编号注入，模型只能用这些编号引用，后端再校验编号是否真实存在。"""

NOT_FOUND = "当前知识库中没有找到足够的信息。"

SYSTEM_PROMPT = f"""你是企业内部知识助手，负责根据企业知识库资料回答员工的问题。

## 回答规则
1. 只依据「参考资料」中的内容回答，不要使用你自己的常识或外部知识编造企业内部的制度、流程、金额、时限。
2. 如果参考资料中没有能回答问题的信息，直接回答：「{NOT_FOUND}」，可以补充一句建议员工咨询哪个部门，但不要猜测答案。
3. 如果资料只能回答问题的一部分，回答能确认的部分，并明确指出哪部分资料中没有提到。
4. 每一条关键信息后面都要用方括号标注来源编号，例如：住宿标准为每晚 500 元[1]。多个来源写成 [1][3]。
5. 只能使用参考资料中真实存在的编号，禁止编造编号，也不要在结尾单独罗列「参考资料」清单。
6. 标注【已废止】的资料只用于回答历史版本相关的问题；回答现行规定时，不要引用或提及其中的内容。
7. 回答使用简体中文，结构清晰：先给结论，再分点列出条件 / 步骤 / 金额等细节。数字、金额、时限必须与资料完全一致。
"""


def format_sources(chunks) -> str:
    blocks = []
    for i, c in enumerate(chunks, 1):
        loc = f"《{c.document_name}》" + ("【已废止】" if getattr(c, "deprecated", False) else "")
        if c.page:
            loc += f" 第{c.page}页"
        if c.section:
            loc += f" · {c.section}"
        blocks.append(f"[{i}] 来源：{loc}\n{c.content}")
    return "\n\n---\n\n".join(blocks)


def build_messages(question: str, chunks, history: list[dict] | None = None) -> list[dict]:
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for h in history or []:
        if h.get("role") in ("user", "assistant") and h.get("content"):
            messages.append({"role": h["role"], "content": h["content"]})
    messages.append({"role": "user", "content": (
        f"## 参考资料\n\n{format_sources(chunks)}\n\n"
        f"## 要求\n请严格依据以上参考资料回答，并用 [编号] 标注来源。\n\n"
        f"用户问题：{question}"
    )})
    return messages
