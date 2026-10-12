"""RAG 评测：在指定知识库上，用指定检索策略跑完评测集，计算检索与生成两类指标。

两种模式：
- retrieval：只跑 Query Rewrite + 检索，几秒钟出结果，适合对比检索策略
- full：完整问答（含 LLM 生成），额外评估答案是否包含关键事实、引用是否指向正确文档

指标（answerable = 非拒答题）：
- Hit@K          答案所在文档出现在送入 LLM 的 Top-K 切片中的比例
- MRR            答案所在文档第一次出现位置的倒数的平均值（越靠前越好）
- Context Recall 关键事实出现在送入 LLM 的切片中的比例
- 拒答准确率      该拒答的拒答了、不该拒答的没拒答，占全部题目的比例
- 误拒率          能回答的题却被拒答的比例
- 答案准确率      （full）答案包含全部关键事实的比例
- 引用命中率      （full）引用中包含正确文档的比例
"""

import json
import logging
import re
import statistics
import threading
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select

from app.db import EvalCaseRow, EvalRun, SessionLocal
from app.rag.pipeline import RAGOptions, answer_stream, retrieve

log = logging.getLogger("eval")
DATASET_DIR = Path(__file__).parent / "datasets"


FEEDBACK_DATASET = "feedback"


def _feedback_cases() -> list[dict]:
    db = SessionLocal()
    try:
        return [r.data for r in db.scalars(select(EvalCaseRow).where(
            EvalCaseRow.dataset == FEEDBACK_DATASET).order_by(EvalCaseRow.id))]
    finally:
        db.close()


def list_datasets() -> list[dict]:
    out = []
    for p in sorted(DATASET_DIR.glob("*.json")):
        d = json.loads(p.read_text(encoding="utf-8"))
        cats: dict[str, int] = {}
        for c in d["cases"]:
            cats[c["category"]] = cats.get(c["category"], 0) + 1
        out.append({"id": p.stem, "name": d["name"], "description": d.get("description", ""),
                    "count": len(d["cases"]), "categories": cats})
    fb = _feedback_cases()
    if fb:
        out.append({"id": FEEDBACK_DATASET, "name": "用户反馈评测集",
                    "description": "由用户差评沉淀的问题，补充标准答案后加入，用于防止同类问题复发（回归测试）。",
                    "count": len(fb), "categories": {"用户反馈": len(fb)}})
    return out


def load_dataset(name: str) -> dict:
    if name == FEEDBACK_DATASET:
        cases = _feedback_cases()
        if not cases:
            raise ValueError("用户反馈评测集还没有题目")
        return {"name": "用户反馈评测集", "cases": cases}
    p = DATASET_DIR / f"{name}.json"
    if not p.exists() or p.parent != DATASET_DIR:
        raise ValueError(f"评测集不存在：{name}")
    return json.loads(p.read_text(encoding="utf-8"))


def _norm(text: str) -> str:
    """关键词匹配前的归一化：去空白和 Markdown 加粗，去掉数字中的千分位逗号，统一大小写。"""
    text = re.sub(r"(?<=\d),(?=\d{3})", "", text or "")
    return re.sub(r"[\s*]", "", text).lower()


def _recall(keywords: list[str], text: str) -> float:
    if not keywords:
        return 1.0
    t = _norm(text)
    return sum(_norm(k) in t for k in keywords) / len(keywords)


def run_case(kb_id: int, case: dict, opt: RAGOptions, mode: str) -> dict:
    history = case.get("history", [])
    expected = set(case.get("expected_docs", []))
    keywords = case.get("expected_keywords", [])
    r = {"id": case["id"], "category": case["category"], "question": case["question"],
         "should_refuse": bool(case.get("should_refuse")), "expected_docs": sorted(expected)}

    if mode == "retrieval":
        query, result, timings = retrieve(kb_id, case["question"], history, opt)
        chunks = [c.to_dict() for c in result.chunks]
        timings["total_ms"] = sum(v for k, v in timings.items() if k.endswith("_ms"))
        answer, status, citations, query_id = None, None, [], None
    else:
        chunks, query, answer, status, citations, timings, query_id = [], case["question"], "", "", [], {}, None
        for ev in answer_stream(kb_id, case["question"], history, opt, source="eval"):
            if ev["type"] == "retrieval":
                chunks, query, query_id = ev["chunks"], ev["query"], ev["query_id"]
            elif ev["type"] == "done":
                answer, status, citations, timings = ev["answer"], ev["status"], ev["citations"], ev["timings"]
            elif ev["type"] == "error":
                status, answer, query_id = "error", ev["message"], ev.get("query_id", query_id)

    used = [c for c in chunks if c["passed_threshold"]]
    refused = (not used) if mode == "retrieval" else status in ("no_context", "no_answer")
    rank = next((i + 1 for i, c in enumerate(used) if c["document_name"] in expected), None)
    r.update(
        retrieval_query=query, query_id=query_id, refused=refused, status=status,
        hit_rank=rank, context_recall=round(_recall(keywords, "\n".join(c["content"] for c in used)), 3),
        top_chunks=[{"document_name": c["document_name"], "score": c["score"],
                     "rerank_score": c.get("rerank_score"), "passed": c["passed_threshold"]}
                    for c in chunks],
        total_ms=timings.get("total_ms"),
    )
    if mode == "full":
        r["answer"] = answer
        r["answer_recall"] = round(_recall(keywords, answer), 3)
        r["citation_hit"] = any(c["document_name"] in expected for c in citations) if expected else None

    if r["should_refuse"]:
        r["passed"], r["reason"] = refused, None if refused else "应拒答但给出了回答"
    elif refused:
        # 区分两种拒答：检索闸门拦截（没有切片送进 LLM） vs 模型看了资料仍判断不足
        r["passed"], r["reason"] = False, ("误拒答：相关资料未通过阈值" if not used
                                           else "误拒答：模型认为资料不足")
    elif rank is None:
        r["passed"], r["reason"] = False, "未召回正确文档"
    elif mode == "full" and r["answer_recall"] < 1:
        r["passed"], r["reason"] = False, "答案缺少关键事实"
    elif mode == "retrieval" and r["context_recall"] < 1:
        r["passed"], r["reason"] = False, "召回内容缺少关键事实"
    else:
        r["passed"], r["reason"] = True, None
    return r


def compute_metrics(results: list[dict], mode: str) -> dict:
    ans = [r for r in results if not r["should_refuse"]]
    neg = [r for r in results if r["should_refuse"]]
    mean = lambda xs: round(sum(xs) / len(xs), 4) if xs else None  # noqa: E731
    lat = [r["total_ms"] for r in results if r.get("total_ms") is not None]
    m = {
        "pass_rate": mean([r["passed"] for r in results]),
        "hit_rate": mean([r["hit_rank"] is not None for r in ans]),
        "mrr": mean([1 / r["hit_rank"] if r["hit_rank"] else 0 for r in ans]),
        "context_recall": mean([r["context_recall"] for r in ans]),
        "refusal_accuracy": mean([r["refused"] == r["should_refuse"] for r in results]),
        "false_refusal_rate": mean([r["refused"] for r in ans]),
        "refusal_recall": mean([r["refused"] for r in neg]),
        "latency_avg_ms": round(statistics.mean(lat)) if lat else None,
        "latency_p95_ms": round(sorted(lat)[max(0, int(len(lat) * 0.95) - 1)]) if lat else None,
        "by_category": {},
    }
    if mode == "full":
        m["answer_accuracy"] = mean([r["answer_recall"] == 1 and not r["refused"] for r in ans])
        m["citation_hit_rate"] = mean([bool(r["citation_hit"]) for r in ans])
    for cat in dict.fromkeys(r["category"] for r in results):
        rs = [r for r in results if r["category"] == cat]
        m["by_category"][cat] = {"total": len(rs), "passed": sum(r["passed"] for r in rs)}
    return m


def _execute(run_id: int) -> None:
    db = SessionLocal()
    try:
        run = db.get(EvalRun, run_id)
        cases = load_dataset(run.dataset)["cases"]
        cfg = run.config
        opt = RAGOptions.from_settings(top_k=cfg["top_k"], retrieval_mode=cfg["retrieval_mode"],
                                       rerank=cfg["rerank"], query_rewrite=cfg["query_rewrite"],
                                       llm_model=cfg.get("llm_model"))
        results = []
        for case in cases:
            try:
                results.append(run_case(run.kb_id, case, opt, run.mode))
            except Exception as e:  # noqa: BLE001 —— 单题失败记为不通过，不中断整个评测
                log.exception("eval case %s failed", case["id"])
                results.append({"id": case["id"], "category": case["category"],
                                "question": case["question"], "should_refuse": bool(case.get("should_refuse")),
                                "expected_docs": case.get("expected_docs", []), "refused": False,
                                "hit_rank": None, "context_recall": 0, "answer_recall": 0,
                                "citation_hit": False, "passed": False,
                                "reason": f"运行出错：{type(e).__name__}: {e}"})
            run.progress, run.results = len(results), list(results)
            db.commit()
        run.metrics = compute_metrics(results, run.mode)
        run.status, run.finished_at = "done", datetime.now(timezone.utc)
        db.commit()
    except Exception as e:  # noqa: BLE001
        log.exception("eval run %s failed", run_id)
        db.rollback()
        run = db.get(EvalRun, run_id)
        run.status, run.error = "failed", f"{type(e).__name__}: {e}"
        db.commit()
    finally:
        db.close()


def start_run(run_id: int) -> None:
    threading.Thread(target=_execute, args=(run_id,), daemon=True).start()
