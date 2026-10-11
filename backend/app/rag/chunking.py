"""Chunking：基于 LangChain text-splitters。

策略：
1. 有标题结构的文档（Markdown / Word）先按 #/##/### 切成章节，保证一个切片不跨章节，
   并把「章节路径」记进 metadata —— 引用时可以显示「§ 差旅住宿标准」。
2. 每个章节 / PDF 每一页再用递归字符切分器切到 chunk_size 以内，优先在段落、句号处断开。
3. PDF 按页切，切片不跨页，保证引用页码准确。
"""

import re
from dataclasses import dataclass

from langchain_text_splitters import MarkdownHeaderTextSplitter, RecursiveCharacterTextSplitter

from app.rag.parsers import ParsedDocument

CJK_SEPARATORS = ["\n\n", "\n", "。", "！", "？", "；", "，", " ", ""]
HEADERS = [("#", "h1"), ("##", "h2"), ("###", "h3")]


@dataclass
class TextChunk:
    content: str
    page: int | None
    section: str | None


def chunk_document(doc: ParsedDocument, chunk_size: int, chunk_overlap: int) -> list[TextChunk]:
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size, chunk_overlap=chunk_overlap, separators=CJK_SEPARATORS,
        keep_separator="end", strip_whitespace=True,
    )
    chunks: list[TextChunk] = []
    for sec in doc.sections:
        if not sec.text.strip():
            continue
        if doc.is_markdown:
            md = MarkdownHeaderTextSplitter(HEADERS, strip_headers=False)
            for part in md.split_text(sec.text):
                path = " > ".join(part.metadata[k] for _, k in HEADERS if k in part.metadata)
                text = re.sub(r" +\n", "\n", part.page_content)  # 去掉切分器补的行尾空格
                for piece in splitter.split_text(text):
                    chunks.append(TextChunk(piece, sec.page, path or None))
        else:
            for piece in splitter.split_text(sec.text):
                chunks.append(TextChunk(piece, sec.page, None))
    # 过滤只剩标题、没有正文的碎片
    return [c for c in chunks if len(c.content.lstrip("# ").strip()) >= 8 or "\n" in c.content]


def embedding_text(doc_name: str, chunk: TextChunk) -> str:
    """送去做 Embedding 的文本：在正文前加上「文档名 > 章节」，让短切片也带着上下文语义。"""
    header = f"《{doc_name}》"
    if chunk.section:
        header += f" {chunk.section}"
    return f"{header}\n{chunk.content}"
