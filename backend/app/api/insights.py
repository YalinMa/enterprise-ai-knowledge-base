"""知识洞察：从真实问答记录里发现「知识缺口」和使用情况。

- 概览：提问量、拒答率、好评 / 差评、耗时、每日趋势
- 文档使用：每份文档被引用的次数；从未被引用的文档（可能过时或不被需要）
- 热门问题：把相似的问题聚成一类，看大家最常问什么
- 知识缺口：被拒答或被点踩的问题聚类后，让 LLM 命名主题并建议该补充什么文档、找哪个部门

知识缺口的归类交给 LLM：短问题的向量容易被「什么时候 / 多少钱」这类句式主导，实测同主题问题的
相似度最低 0.49，而不同主题最高 0.60，单靠 Embedding 阈值分不干净。热门问题与 Mock 模式下的
兜底聚类用 Embedding + 贪心聚类（阈值取 0.62，高于跨主题最高值：宁可分细，不错合）。
"""

import json
import logging
import math
import re
import statistics
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import Document, KnowledgeBase, QueryLog, get_db
from app.providers import get_embedder, get_llm

router = APIRouter(prefix="/api/insights", tags=["insights"])
log = logging.getLogger("insights")

REFUSED = ("no_context", "no_answer")
# 问题聚类阈值（余弦相似度），通义 v4 下实测跨主题最高 0.60
CLUSTER_THRESHOLD = {"mock": 0.45, "local": 0.7}
DEFAULT_CLUSTER_THRESHOLD = 0.62
_gap_cache: dict[tuple, dict] = {}


def _logs(db: Session, kb_id: int | None, days: int) -> list[QueryLog]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    q = select(QueryLog).where(QueryLog.source == "chat", QueryLog.created_at >= since)
    if kb_id:
        q = q.where(QueryLog.kb_id == kb_id)
    return list(db.scalars(q.order_by(QueryLog.id)))


def _utc(dt: datetime) -> datetime:
    """SQLite 不保存时区，读出来的是 naive datetime（实际是 UTC），统一补上时区。"""
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def _local_day(lg: QueryLog):
    return _utc(lg.created_at).astimezone().date()


def _is_refused(lg: QueryLog) -> bool:
    return lg.status in REFUSED


def _is_down(lg: QueryLog) -> bool:
    return (lg.feedback or {}).get("rating") == -1


def _cosine(a, b) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na, nb = math.sqrt(sum(x * x for x in a)), math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def _norm_q(q: str) -> str:
    return re.sub(r"[\s？?。！!，,]+", "", q)


def cluster_questions(questions: list[str]) -> list[list[int]]:
    """贪心聚类，返回每个簇包含的问题下标（按簇大小降序）。完全相同的问题先合并，减少 Embedding 调用。"""
    if not questions:
        return []
    emb = get_embedder()
    threshold = CLUSTER_THRESHOLD.get(emb.provider, DEFAULT_CLUSTER_THRESHOLD)
    uniq: dict[str, list[int]] = defaultdict(list)
    for i, q in enumerate(questions):
        uniq[_norm_q(q)].append(i)
    keys = list(uniq)
    vecs = emb.embed_documents([questions[uniq[k][0]] for k in keys])
    clusters: list[dict] = []  # {"center": vec, "members": [key idx]}
    for ki, v in enumerate(vecs):
        best, best_sim = None, threshold
        for c in clusters:
            sim = _cosine(v, c["center"])
            if sim >= best_sim:
                best, best_sim = c, sim
        if best is None:
            clusters.append({"center": list(v), "members": [ki]})
        else:
            n = len(best["members"])
            best["center"] = [(x * n + y) / (n + 1) for x, y in zip(best["center"], v)]
            best["members"].append(ki)
    out = [[i for ki in c["members"] for i in uniq[keys[ki]]] for c in clusters]
    return sorted(out, key=len, reverse=True)


@router.get("")
def overview(kb_id: int | None = None, days: int = 30, db: Session = Depends(get_db)):
    logs = _logs(db, kb_id, days)
    total = len(logs)
    lat = [lg.timings.get("total_ms") for lg in logs if (lg.timings or {}).get("total_ms")]
    ftk = [lg.timings.get("first_token_ms") for lg in logs if (lg.timings or {}).get("first_token_ms")]
    rated = [lg for lg in logs if lg.feedback]

    by_day = Counter(_local_day(lg).strftime("%m-%d") for lg in logs)
    today = datetime.now().date()
    trend = []
    for d in range(13, -1, -1):
        day = today - timedelta(days=d)
        refused = sum(1 for lg in logs if _is_refused(lg) and _local_day(lg) == day)
        trend.append({"date": day.strftime("%m-%d"), "total": by_day.get(day.strftime("%m-%d"), 0),
                      "refused": refused})

    # 文档使用情况：被引用次数
    cited = Counter()
    for lg in logs:
        for c in lg.citations or []:
            cited[c["document_id"]] += 1
    dq = select(Document).where(Document.status == "ready")
    if kb_id:
        dq = dq.where(Document.kb_id == kb_id)
    docs = list(db.scalars(dq))
    kb_names = {k.id: k.name for k in db.scalars(select(KnowledgeBase))}
    doc_usage = sorted(
        [{"document_id": d.id, "filename": d.filename, "kb_name": kb_names.get(d.kb_id, ""),
          "citations": cited.get(d.id, 0)} for d in docs],
        key=lambda x: -x["citations"])

    # 热门问题（全部提问聚类，不调用 LLM）
    questions = [lg.question for lg in logs]
    hot = []
    for idxs in cluster_questions(questions)[:8]:
        group = [logs[i] for i in idxs]
        hot.append({"question": group[0].question,
                    "count": len(group),
                    "examples": list(dict.fromkeys(g.question for g in group))[:4],
                    "refused": sum(_is_refused(g) for g in group)})

    return {
        "total": total,
        "refused": sum(_is_refused(lg) for lg in logs),
        "refusal_rate": round(sum(_is_refused(lg) for lg in logs) / total, 4) if total else None,
        "upvotes": sum(1 for lg in rated if lg.feedback["rating"] == 1),
        "downvotes": sum(1 for lg in rated if lg.feedback["rating"] == -1),
        "feedback_rate": round(len(rated) / total, 4) if total else None,
        "latency_avg_ms": round(statistics.mean(lat)) if lat else None,
        "first_token_avg_ms": round(statistics.mean(ftk)) if ftk else None,
        "trend": trend,
        "doc_usage": doc_usage,
        "hot_questions": hot,
        "problem_count": sum(1 for lg in logs if _is_refused(lg) or _is_down(lg)),
    }


GAP_PROMPT = """你是企业知识管理顾问。下面是员工在内部知识库里提问、但没有得到满意答案的问题（被拒答或被点踩）。
请把它们按「员工想了解的主题」归类（同一件事的不同问法归为一类，例如班车有没有 / 班车路线 / 班车时间 是同一类），并为每一类给出：
- topic：4~10 个字概括主题
- suggestion：一句话建议应该补充什么文档或章节（具体到文档名或章节）
- owner：最可能负责这份内容的部门（如 人力资源部、财务部、行政部、IT 服务台、客户服务中心、渠道发展部）
- items：属于这一类的问题编号
- out_of_scope：如果这类问题根本不属于企业内部知识（如天气、新闻、闲聊）或属于不应公开的信息（如未公开的战略、高管隐私），
  拒答本身就是正确的，不需要补充文档，填 true；否则填 false

每个编号必须且只能出现在一个类里。按问题数量从多到少排序。只输出 JSON 数组：
[{{"topic": "...", "suggestion": "...", "owner": "...", "out_of_scope": false, "items": [1, 3]}}]

## 问题
{questions}"""


def _llm_groups(questions: list[str]) -> tuple[list[dict], str] | None:
    """让 LLM 按主题归类并命名。返回 ([{topic, suggestion, owner, items(0-based)}], 模型名)，失败返回 None。"""
    llm = get_llm(get_settings().rewrite_model or None)
    if llm.is_mock:
        return None
    text = "\n".join(f"{i + 1}. {q}" for i, q in enumerate(questions))
    try:
        raw = llm.complete([{"role": "user", "content": GAP_PROMPT.format(questions=text)}])
        items = json.loads(raw[raw.index("["): raw.rindex("]") + 1])
    except Exception:  # noqa: BLE001 —— 退化为 Embedding 聚类
        log.exception("gap grouping failed")
        return None
    groups, seen = [], set()
    for it in items:
        idx = [int(n) - 1 for n in it.get("items", []) if str(n).isdigit()]
        idx = [i for i in idx if 0 <= i < len(questions) and i not in seen]
        if not idx:
            continue
        seen.update(idx)
        groups.append({"topic": str(it.get("topic", ""))[:30], "suggestion": str(it.get("suggestion", ""))[:200],
                       "owner": str(it.get("owner", ""))[:20], "out_of_scope": it.get("out_of_scope") is True,
                       "items": idx})
    for i in range(len(questions)):  # LLM 漏掉的问题单独成组，保证不丢数据
        if i not in seen:
            groups.append({"topic": questions[i][:20], "suggestion": "", "owner": "", "out_of_scope": False,
                           "items": [i]})
    return groups, f"{llm.provider}:{llm.model}"


@router.post("/gaps")
def knowledge_gaps(kb_id: int | None = None, days: int = 30, db: Session = Depends(get_db)):
    """知识缺口报告：有问题的提问按主题归类，给出补充建议和负责部门。结果按数据版本缓存。"""
    logs = [lg for lg in _logs(db, kb_id, days) if _is_refused(lg) or _is_down(lg)]
    if not logs:
        return {"gaps": [], "generated_by": None, "problem_count": 0}
    key = (kb_id, days, logs[-1].id, len(logs),
           sum(1 for lg in logs if lg.feedback))  # 有新记录或新反馈时重新生成
    if key in _gap_cache:
        return _gap_cache[key]

    # 相同问题先合并，最多取最近 150 个不同问题交给 LLM
    by_q: dict[str, list[QueryLog]] = defaultdict(list)
    for lg in reversed(logs):
        by_q[_norm_q(lg.question)].append(lg)
    keys = list(by_q)[:150]
    distinct = [by_q[k][0].question for k in keys]

    res = _llm_groups(distinct)
    if res:
        groups, generated_by = res
    else:
        groups = [{"topic": distinct[idx[0]][:20], "suggestion": "", "owner": "", "out_of_scope": False,
                   "items": idx}
                  for idx in cluster_questions(distinct)]
        generated_by = None

    gaps = []
    for g in groups:
        group = [lg for i in g["items"] for lg in by_q[keys[i]]]
        gaps.append({
            "topic": g["topic"], "suggestion": g["suggestion"], "owner": g["owner"],
            "out_of_scope": g["out_of_scope"],
            "count": len(group),
            "refused": sum(_is_refused(x) for x in group),
            "downvoted": sum(_is_down(x) for x in group),
            "questions": [distinct[i] for i in g["items"]][:6],
            "query_ids": [x.id for x in group][:20],
            "kb_names": sorted({x.kb_name for x in group}),
            "reasons": sorted({r for x in group for r in (x.feedback or {}).get("reasons", [])}),
            "last_at": _utc(max(x.created_at for x in group)).isoformat(),
        })
    gaps.sort(key=lambda g: (g["out_of_scope"], -g["count"]))  # 范围外的问题排在最后

    result = {"gaps": gaps, "generated_by": generated_by, "problem_count": len(logs),
              "generated_at": datetime.now(timezone.utc).isoformat()}
    _gap_cache.clear()
    _gap_cache[key] = result
    return result


@router.get("/gaps/export")
def export_gaps(kb_id: int | None = None, days: int = 30, db: Session = Depends(get_db)):
    """导出 Markdown 报告，方便发给各部门负责人。"""
    data = knowledge_gaps(kb_id, days, db)
    if not data["gaps"]:
        raise HTTPException(404, "暂无知识缺口")
    gaps = [g for g in data["gaps"] if not g.get("out_of_scope")]
    lines = [f"# 知识缺口报告（近 {days} 天）", "",
             f"共 {data['problem_count']} 次提问未得到满意答案，其中 {sum(g['count'] for g in gaps)} 次属于知识缺口，"
             f"归纳为 {len(gaps)} 个主题。", ""]
    for i, g in enumerate(gaps, 1):
        lines += [f"## {i}. {g['topic']}（{g['count']} 次）", ""]
        if g["owner"]:
            lines.append(f"- **建议负责部门**：{g['owner']}")
        if g["suggestion"]:
            lines.append(f"- **建议补充**：{g['suggestion']}")
        lines.append(f"- **拒答 / 差评**：{g['refused']} / {g['downvoted']}")
        lines += ["- **典型问题**："] + [f"  - {q}" for q in g["questions"]] + [""]
    return {"markdown": "\n".join(lines)}
