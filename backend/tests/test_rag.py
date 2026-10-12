"""RAG 核心环节的单元测试 + 离线端到端测试（mock LLM / mock Embedding，不需要任何 Key）。

    .venv/bin/pytest -q
"""

import json
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path

import pytest

os.environ.update(LLM_PROVIDER="mock", EMBEDDING_PROVIDER="mock", RERANK_PROVIDER="none",
                  DATA_DIR=tempfile.mkdtemp())

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

ALL_DEMO_FILES = sorted([p for p in DEMO.iterdir() if p.is_file()] +
                        [p for p in (DEMO / "extended").iterdir() if p.is_file()])


@pytest.mark.parametrize("path", ALL_DEMO_FILES, ids=lambda p: p.name)
def test_demo_files_parse_and_chunk(path):
    name = path.name
    ftype = name.rsplit(".", 1)[-1]
    doc = parse_file(path, ftype)
    doc.sections = [ParsedSection(clean_text(s.text, ftype == "pdf"), s.page) for s in doc.sections]
    chunks = chunk_document(doc, 500, 80)
    assert chunks, f"{name} 没有切出内容"
    assert all(len(c.content) <= 500 for c in chunks)
    if ftype == "pdf":
        assert {c.page for c in chunks} == set(range(1, doc.page_count + 1))  # 每页都有切片，引用可定位到页
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


# ---------------- v0.2：混合检索 / 重排闸门 / 评测 ----------------

def test_bm25_tokenize_keeps_codes_and_drops_stopwords():
    from app.rag.bm25 import tokenize
    toks = tokenize("文件编号 XH-FIN-018 是什么？客服热线400-800-1234")
    assert {"xh", "fin", "018", "400", "1234", "客服热线"} <= set(toks)
    assert "什么" not in toks and "-" not in toks


class FakeReranker:
    provider, model, signature = "fake", "fake", "fake:fake"

    def __init__(self, scores_by_doc):
        self.scores_by_doc = scores_by_doc

    def score(self, query, documents):
        return [next((v for k, v in self.scores_by_doc.items() if k in d), 0.01) for d in documents]


def _kb_with(client, names):
    kb = client.post("/api/knowledge-bases", json={"name": "h", "description": "", "icon": "book"}).json()
    files = [("files", (n, (DEMO / n).read_bytes())) for n in names]
    assert client.post(f"/api/knowledge-bases/{kb['id']}/documents", files=files).status_code == 201
    return kb["id"]


def test_hybrid_retrieval_and_rerank_gate():
    from fastapi.testclient import TestClient
    from app.main import app
    from app.providers import get_embedder
    from app.rag.retriever import RetrievalOptions, Retriever

    with TestClient(app) as c:
        kb_id = _kb_with(c, ["经销商结算与提现细则.docx", "员工报销制度.md", "员工请假制度.md"])
        r = Retriever(get_embedder())

        hybrid = r.retrieve(kb_id, "XH-FIN-018", RetrievalOptions(mode="hybrid", min_score=0.0))
        top = hybrid.chunks[0]
        assert top.document_name == "经销商结算与提现细则.docx" and top.bm25_rank == 1
        assert all(ch.rrf_score is not None for ch in hybrid.chunks)

        vector = r.retrieve(kb_id, "XH-FIN-018", RetrievalOptions(mode="vector", min_score=0.0))
        assert all(ch.bm25_rank is None for ch in vector.chunks)

        # 重排：按重排分数排序；闸门 = 重排分数达标 或 相似度足够高
        rr = Retriever(get_embedder(), FakeReranker({"XH-FIN-018": 0.9}))
        res = rr.retrieve(kb_id, "XH-FIN-018", RetrievalOptions(mode="hybrid", rerank_min_score=0.15,
                                                                 keep_similarity=0.99))
        assert res.gate == "rerank" and res.chunks[0].rerank_score == 0.9
        assert [ch.passed_threshold for ch in res.chunks] == [True] + [False] * (len(res.chunks) - 1)
        res = rr.retrieve(kb_id, "XH-FIN-018", RetrievalOptions(mode="hybrid", rerank_min_score=0.15,
                                                                 keep_similarity=0.0))
        assert all(ch.passed_threshold for ch in res.chunks)  # 相似度信号放行全部


def test_eval_case_and_metrics():
    from fastapi.testclient import TestClient
    from app.eval.runner import compute_metrics, load_dataset, run_case
    from app.main import app
    from app.rag.pipeline import RAGOptions

    with TestClient(app) as c:
        kb_id = _kb_with(c, ["员工报销制度.md"])
        opt = RAGOptions.from_settings(retrieval_mode="hybrid", rerank=False, query_rewrite=False)
        ok = run_case(kb_id, {"id": "a", "category": "直接问法", "question": "出差住宿标准",
                              "expected_docs": ["员工报销制度.md"], "expected_keywords": ["500"]}, opt, "retrieval")
        assert ok["hit_rank"] == 1 and ok["context_recall"] == 1 and ok["passed"]
        miss = run_case(kb_id, {"id": "b", "category": "直接问法", "question": "出差住宿标准",
                                "expected_docs": ["不存在.md"], "expected_keywords": []}, opt, "retrieval")
        assert miss["hit_rank"] is None and not miss["passed"]

    m = compute_metrics([ok, miss, {**ok, "should_refuse": True, "refused": True, "passed": True,
                                    "category": "应拒答"}], "retrieval")
    assert m["hit_rate"] == 0.5 and m["mrr"] == 0.5 and m["refusal_accuracy"] == 1.0
    assert m["by_category"]["直接问法"] == {"total": 2, "passed": 1}
    assert len(load_dataset("demo")["cases"]) >= 20


# ---------------- v0.3：反馈 / 知识洞察 / 条件改写 ----------------

def test_needs_rewrite_rules():
    from app.rag.query_rewrite import needs_rewrite
    h = [{"role": "user", "content": "普通员工住宿标准？"}]
    assert needs_rewrite("那总监呢？", h) and needs_rewrite("这个要发票吗？", h)
    assert not needs_rewrite("试用期员工可以请事假吗？", h)   # 完整问题不改写，省一次 LLM 调用
    assert not needs_rewrite("那总监呢？", [])                 # 没有历史不改写


def test_feedback_and_insights_offline():
    from fastapi.testclient import TestClient
    from app.main import app

    with TestClient(app) as c:
        kb_id = _kb_with(c, ["员工报销制度.md"])
        ids = []
        for q in ["出差住宿标准是多少", "公司班车几点发车？", "班车路线在哪里查？", "公积金比例是多少？"]:
            ids.append(c.post("/api/chat", json={"kb_id": kb_id, "question": q, "stream": False}).json()["query_id"])

        # 点踩 + 原因；差评筛选；转成评测题
        r = c.put(f"/api/retrievals/{ids[0]}/feedback", json={"rating": -1, "reasons": ["答案错误", "不存在的原因"]})
        assert r.json()["feedback"]["reasons"] == ["答案错误"]
        assert [x["id"] for x in c.get("/api/retrievals?feedback=down").json()] == [ids[0]]
        assert c.post(f"/api/retrievals/{ids[0]}/to-eval", json={"expected_docs": []}).status_code == 400
        assert c.post(f"/api/retrievals/{ids[0]}/to-eval",
                      json={"expected_docs": ["员工报销制度.md"], "expected_keywords": ["500"]}).status_code == 201
        assert any(d["id"] == "feedback" for d in c.get("/api/evals/datasets").json())

        ov = c.get(f"/api/insights?kb_id={kb_id}").json()
        assert ov["total"] == 4 and ov["downvotes"] == 1 and ov["trend"][-1]["total"] == 4
        assert ov["doc_usage"][0]["filename"] == "员工报销制度.md"

        gaps = c.post(f"/api/insights/gaps?kb_id={kb_id}").json()
        assert gaps["problem_count"] >= 1
        assert sum(g["count"] for g in gaps["gaps"]) == gaps["problem_count"]  # 每个问题都归入某一类
        assert all(g["last_at"].endswith("+00:00") for g in gaps["gaps"])     # 时间带时区


# ---------------- v0.4：文档生命周期（已废止文档） ----------------

def test_detect_deprecated():
    from app.rag.ingest import detect_deprecated
    assert detect_deprecated("员工报销制度（2024版·已废止）.md", "")
    assert detect_deprecated("a.md", "> 版本：V2.0 ｜ **状态：已废止**")
    assert detect_deprecated("a.md", "本制度已于 2026年1月1日 废止")
    assert not detect_deprecated("员工报销制度.md", "# 员工费用报销制度 生效日期：2026年1月1日")


def test_deprecated_documents_excluded_unless_asked():
    from fastapi.testclient import TestClient
    from app.main import app
    from app.rag.pipeline import RAGOptions, retrieve

    with TestClient(app) as c:
        kb_id = _kb_with(c, ["员工报销制度.md"])
        old = "员工报销制度（2024版·已废止）.md"
        r = c.post(f"/api/knowledge-bases/{kb_id}/documents",
                   files=[("files", (old, (DEMO / "extended" / old).read_bytes()))]).json()
        doc = c.get(f"/api/knowledge-bases/{kb_id}/documents").json()
        assert next(d for d in doc if d["filename"] == old)["lifecycle"] == "deprecated"  # 自动识别

        opt = RAGOptions.from_settings(retrieval_mode="hybrid", rerank=False, query_rewrite=False)
        _, res, _ = retrieve(kb_id, "出差住宿标准是多少", [], opt)
        assert all(ch.document_name != old for ch in res.chunks)          # 默认不召回
        _, res, _ = retrieve(kb_id, "2024 版的住宿标准是多少", [], opt)
        assert any(ch.document_name == old and ch.deprecated for ch in res.chunks)  # 问历史版本时召回

        # 手动改回「生效」后正常参与检索
        assert c.patch(f"/api/documents/{r[0]['id']}", json={"lifecycle": "active"}).json()["lifecycle"] == "active"
        _, res, _ = retrieve(kb_id, "出差住宿标准是多少", [], opt)
        assert any(ch.document_name == old for ch in res.chunks)
