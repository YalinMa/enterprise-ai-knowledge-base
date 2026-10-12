"""命令行跑 RAG 评测，对比多组检索策略（后端需已启动）。结果同时保存在「评测」页面。

    python scripts/run_eval.py                        # 仅检索模式，对比 4 组策略
    python scripts/run_eval.py --mode full            # 完整问答模式（会调用 LLM，较慢）
    python scripts/run_eval.py --kb 3 --configs hybrid+rerank
"""

import argparse
import sys
import time

import httpx

PRESETS = {
    "vector": {"retrieval_mode": "vector", "rerank": False, "query_rewrite": False},
    "vector+rewrite": {"retrieval_mode": "vector", "rerank": False, "query_rewrite": True},
    "hybrid+rewrite": {"retrieval_mode": "hybrid", "rerank": False, "query_rewrite": True},
    "hybrid+rerank": {"retrieval_mode": "hybrid", "rerank": True, "query_rewrite": True},
}
COLUMNS = [("pass_rate", "通过率"), ("hit_rate", "Hit@5"), ("mrr", "MRR"),
           ("context_recall", "Ctx Recall"), ("refusal_accuracy", "拒答准确"),
           ("false_refusal_rate", "误拒率"), ("answer_accuracy", "答案准确"),
           ("citation_hit_rate", "引用命中"), ("latency_avg_ms", "平均耗时")]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8100")
    ap.add_argument("--kb", type=int, help="知识库 ID，默认用名称含 Demo 的知识库")
    ap.add_argument("--mode", default="retrieval", choices=["retrieval", "full"])
    ap.add_argument("--dataset", default="demo")
    ap.add_argument("--llm-model", help="覆盖生成模型（同一厂商），如 deepseek-chat，用于模型选型对比")
    ap.add_argument("--configs", default=",".join(PRESETS), help="逗号分隔：" + " / ".join(PRESETS))
    args = ap.parse_args()
    c = httpx.Client(base_url=args.base.rstrip("/"), timeout=60)

    kb_id = args.kb
    if kb_id is None:
        kbs = c.get("/api/knowledge-bases").json()
        kb = next((k for k in kbs if "Demo" in k["name"]), None)
        if kb is None:
            sys.exit("没有找到 Demo 知识库，请先在首页「导入 Demo 数据」或用 --kb 指定")
        kb_id = kb["id"]

    rows = []
    for name in args.configs.split(","):
        body = {"kb_id": kb_id, "dataset": args.dataset, "mode": args.mode, "llm_model": args.llm_model,
                **PRESETS[name.strip()]}
        run = c.post("/api/evals", json=body).json()
        while run["status"] == "running":
            time.sleep(1)
            run = c.get(f"/api/evals/{run['id']}").json()
            print(f"\r{name:<16} {run['progress']}/{run['total']}", end="", flush=True)
        print(f"\r{name:<16} 完成（评测 #{run['id']}）" + (f" 失败：{run['error']}" if run["error"] else ""))
        rows.append((f"{name} · {run['config']['llm'].split(':', 1)[-1]}" if args.mode == "full" else name,
                     run["metrics"]))

    cols = [(k, label) for k, label in COLUMNS if any(m.get(k) is not None for _, m in rows)]
    print("\n| 策略 | " + " | ".join(label for _, label in cols) + " |")
    print("|---|" + "---|" * len(cols))
    for name, m in rows:
        cells = []
        for k, _ in cols:
            v = m.get(k)
            cells.append("—" if v is None else f"{v} ms" if k.startswith("latency") else f"{v:.0%}" if k != "mrr" else f"{v:.3f}")
        print(f"| {name} | " + " | ".join(cells) + " |")


if __name__ == "__main__":
    main()
