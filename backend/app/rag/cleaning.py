"""Text Cleaning：去掉控制字符、多余空白，修复 PDF 抽取出来的「硬换行」。"""

import re

_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f​﻿]")
_SENTENCE_END = tuple("。！？：；.!?:;」』\"”|")
_BLOCK_START = re.compile(r"^(#{1,6}\s|[-*•·]\s|\d+[.、)）]|[（(]?[一二三四五六七八九十]+[、.)）]|第[一二三四五六七八九十百\d]+[章节条])")


def _is_cjk(ch: str) -> bool:
    return "一" <= ch <= "鿿" or "　" <= ch <= "〿" or "＀" <= ch <= "￯"


def join_broken_lines(text: str) -> str:
    """PDF 每行末尾都有换行，把被排版截断的句子接回去，但保留标题、列表和段落边界。

    判断依据：上一行几乎占满整行宽度（被排版强制折行）、且没有以句末标点结尾。
    """
    lines = [ln.strip() for ln in text.split("\n")]
    lengths = sorted(len(ln) for ln in lines if ln)
    if not lengths:
        return ""
    full_width = lengths[int(len(lengths) * 0.9) - 1 if len(lengths) > 1 else 0]
    out: list[str] = []
    prev_raw = ""
    for line in lines:
        if not line:
            out.append("")
            prev_raw = ""
            continue
        if (out and prev_raw and len(prev_raw) >= full_width * 0.8
                and not prev_raw.endswith(_SENTENCE_END) and not _BLOCK_START.match(line)):
            sep = "" if _is_cjk(prev_raw[-1]) or _is_cjk(line[0]) else " "
            out[-1] = out[-1] + sep + line
        else:
            out.append(line)
        prev_raw = line
    return "\n".join(out)


def clean_text(text: str, from_pdf: bool = False) -> str:
    text = _CONTROL.sub("", text).replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("　", " ").replace("\xa0", " ")
    if from_pdf:
        text = join_broken_lines(text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()
