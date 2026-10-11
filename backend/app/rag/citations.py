"""Citation 后处理：把模型输出里的引用编号对齐到真实切片。

- 统一格式：【1】、[1,2]、[1、2]、[^1] → [1][2]
- 丢弃越界编号（模型编造的引用）
- 按首次出现顺序重新编号为 1..n，返回的 citations 与正文编号一一对应
"""

import re

_VARIANTS = re.compile(r"[\[【]\^?\s*(\d+(?:\s*[,，、]\s*\d+)*)\s*[\]】]")


def resolve_citations(answer: str, chunks) -> tuple[str, list[dict], list[int]]:
    """返回（规范化后的正文, citations, 被丢弃的非法编号）。"""
    invalid: list[int] = []
    order: list[int] = []  # 原始编号，按首次出现排序

    def normalize(m: re.Match) -> str:
        out = []
        for n in re.split(r"\s*[,，、]\s*", m.group(1)):
            n = int(n)
            if 1 <= n <= len(chunks):
                if n not in order:
                    order.append(n)
                out.append(f"[[{n}]]")  # 临时占位，避免和重编号冲突
            else:
                invalid.append(n)
        return "".join(out)

    text = _VARIANTS.sub(normalize, answer)
    remap = {orig: new for new, orig in enumerate(order, 1)}
    text = re.sub(r"\[\[(\d+)\]\]", lambda m: f"[{remap[int(m.group(1))]}]", text)
    text = re.sub(r"(\[\d+\])\1+", r"\1", text)  # [1][1] → [1]

    citations = []
    for orig in order:
        c = chunks[orig - 1]
        citations.append({
            "index": remap[orig], "source_rank": orig, "chunk_id": c.chunk_id,
            "document_id": c.document_id, "document_name": c.document_name,
            "page": c.page, "section": c.section, "content": c.content, "score": c.score,
        })
    return text.strip(), citations, invalid
