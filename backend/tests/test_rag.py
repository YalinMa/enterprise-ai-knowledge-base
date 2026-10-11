"""RAG 核心环节的单元测试 + 一个离线端到端测试（mock LLM / mock Embedding，不需要任何 Key）。

    .venv/bin/pytest -q
"""

import json
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path

import pytest

os.environ.update(LLM_PROVIDER="mock", EMBEDDING_PROVIDER="mock", DATA_DIR=tempfile.mkdtemp())

from app.rag.chunking import chunk_document  # noqa: E402
from app.rag.citations import resolve_citations  # noqa: E402
from app.rag.cleaning import clean_text, join_broken_lines  # noqa: E402
from app.rag.parsers import ParsedDocument, ParsedSection, parse_file  # noqa: E402

DEMO = Path(__file__).resolve().parents[2] / "demo-data"


@dataclass
class FakeChunk:
    chunk_id: str
    document_id: int = 1
    document_name: str = "a.md"
    page: int | None = None
    section: str | None = None
    content: str = "x"
    score: float = 0.8


# ---------------- Citation ----------------

def test_citations_renumber_and_drop_invalid():
    chunks = [FakeChunk("c1"), FakeChunk("c2"), FakeChunk("c3")]
    text, cites, invalid = resolve_citations("A[3]。B【1】。C[1,3]。D[7]。", chunks)
    assert text == "A[1]。B[2]。C[2][1]。D。"           # 按首次出现重编号，[7] 被删除
    assert [c["chunk_id"] for c in cites] == ["c3", "c1"]  # 引用与正文编号一一对应
    assert [c["index"] for c in cites] == [1, 2]
    assert invalid == [7]


def test_citations_dedupe_adjacent():
    text, cites, _ = resolve_citations("结论[1][1]", [FakeChunk("c1")])
    assert text == "结论[1]" and len(cites) == 1


# ---------------- Cleaning ----------------

def test_pdf_line_join_keeps_headings_and_lists():
    raw = "第一章 总则\n1.1 这是一个很长很长很长很长的句子被排版\n截断了。\n1.2 第二条。"
    out = join_broken_lines(raw)
    assert "被排版截断了。" in out
    assert out.startswith("第一章 总则\n1.1")
    assert "\n1.2 第二条。" in out


def test_clean_text_collapses_whitespace():
    assert clean_text("a　　b\n\n\n\nc\x00") == "a b\n\nc"


# ---------------- Parsing + Chunking ----------------

@pytest.mark.parametrize("name", sorted(p.name for p in DEMO.iterdir()))
def test_demo_files_parse_and_chunk(name):
    ftype = name.rsplit(".", 1)[-1]
    doc = parse_file(DEMO / name, ftype)
    doc.sections = [ParsedSection(clean_text(s.text, ftype == "pdf"), s.page) for s in doc.sections]
    chunks = chunk_document(doc, 500, 80)
    assert chunks, f"{name} 没有切出内容"
    assert all(len(c.content) <= 500 for c in chunks)
    if ftype == "pdf":
        assert {c.page for c in chunks} == {1, 2, 3}  # 页码保留，引用可以定位到页
    if ftype in ("md", "docx"):
        assert any(c.section for c in chunks)       # 章节路径保留


def test_markdown_chunks_do_not_cross_sections():
    md = "# T\n\n## 一\n" + "甲" * 30 + "\n\n## 二\n" + "乙" * 30
    chunks = chunk_document(ParsedDocument([ParsedSection(md)], is_markdown=True), 500, 50)
    assert len(chunks) == 2
    assert chunks[0].section == "T > 一" and "乙" not in chunks[0].content


# ---------------- 离线端到端 ----------------

def test_end_to_end_offline():
    from fastapi.testclient import TestClient
    from app.main import app

    with TestClient(app) as c:
        kb = c.post("/api/knowledge-bases", json={"name": "t", "description": "", "icon": "book"}).json()
        files = [("files", (n, (DEMO / n).read_bytes())) for n in ("员工报销制度.md", "商城售后服务规则.pdf")]
        assert c.post(f"/api/knowledge-bases/{kb['id']}/documents", files=files).status_code == 201
        docs = c.get(f"/api/knowledge-bases/{kb['id']}/documents").json()
        assert all(d["status"] == "ready" for d in docs), docs

        r = c.post("/api/chat", json={"kb_id": kb["id"], "question": "出差住宿标准是多少？", "stream": False}).json()
        assert r["status"] == "ok" and r["citations"]
        # 每条引用都必须指向知识库中真实存在的切片
        for cite in r["citations"]:
            assert c.get(f"/api/chunks/{cite['chunk_id']}").status_code == 200
            assert f"[{cite['index']}]" in r["answer"]

        # 检索记录完整落库
        log = c.get(f"/api/retrievals/{r['query_id']}").json()
        assert len(log["retrieved"]) > 0 and log["prompt"][0]["role"] == "system"

        # 流式接口事件顺序：retrieval → token... → done
        with c.stream("POST", "/api/chat", json={"kb_id": kb["id"], "question": "维修多久寄回？"}) as s:
            events = [json.loads(line[5:])["type"] for line in s.iter_lines() if line.startswith("data:")]
        assert events[0] == "retrieval" and events[-1] == "done" and "token" in events

        # 删除文档后，向量和切片一并删除
        pdf = next(d for d in docs if d["file_type"] == "pdf")
        assert c.delete(f"/api/documents/{pdf['id']}").status_code == 204
        r = c.post("/api/chat", json={"kb_id": kb["id"], "question": "维修多久寄回？", "stream": False}).json()
        assert all(x["document_id"] != pdf["id"] for x in r["retrieved"])
