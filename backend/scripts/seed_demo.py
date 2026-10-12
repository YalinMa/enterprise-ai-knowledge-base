"""通过 HTTP API 初始化按部门划分的示例知识库（后端需已启动）。

    python scripts/seed_demo.py                 # 默认 http://127.0.0.1:8100
    python scripts/seed_demo.py --base http://host:8100
    python scripts/seed_demo.py --extended      # 额外创建「扩展版」知识库：demo-data + extended 共 30 份文件

已存在的同名知识库 / 同名文件会跳过，可重复执行。
"""

import argparse
import sys
import time
from pathlib import Path

import httpx

DEMO = Path(__file__).resolve().parents[2] / "demo-data"
EXTENDED = DEMO / "extended"
EXTENDED_KB = ("星河科技知识库（扩展版）", "building",
               "30 份制度文件，含旧版制度、适用范围不同的补充规定、长 PDF 等干扰项，用于评测")

KBS = [
    ("产品知识库", "package", "商城退款、售后、保修与价格保护规则",
     ["产品退款规则.md", "商城售后服务规则.pdf"]),
    ("运营知识库", "megaphone", "渠道经销商准入、返利、结算与提现制度",
     ["经销商管理制度.md", "经销商结算与提现细则.docx"]),
    ("技术知识库", "code", "IT 服务台、账号、VPN 与设备相关 FAQ",
     ["IT服务台常见问题.txt"]),
    ("人事行政知识库", "users", "员工报销、请假与休假制度",
     ["员工报销制度.md", "员工请假制度.md"]),
]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8100")
    ap.add_argument("--extended", action="store_true", help="创建扩展版评测知识库")
    args = ap.parse_args()
    base = args.base.rstrip("/")
    c = httpx.Client(base_url=base, timeout=60)
    try:
        existing = {kb["name"]: kb for kb in c.get("/api/knowledge-bases").json()}
    except httpx.ConnectError:
        sys.exit(f"无法连接 {base}，请先启动后端")

    plan = [(n, i, d, [DEMO / f for f in fs]) for n, i, d, fs in KBS]
    if args.extended:
        files = sorted(p for p in DEMO.iterdir() if p.is_file() and not p.name.startswith("."))
        files += sorted(p for p in EXTENDED.iterdir() if p.is_file() and not p.name.startswith("."))
        plan = [(*EXTENDED_KB, files)]
    for name, icon, desc, paths in plan:
        kb = existing.get(name) or c.post("/api/knowledge-bases",
                                          json={"name": name, "icon": icon, "description": desc}).json()
        have = {d["filename"] for d in c.get(f"/api/knowledge-bases/{kb['id']}/documents").json()}
        todo = [p for p in paths if p.name not in have]
        for i in range(0, len(todo), 10):  # 分批上传
            r = c.post(f"/api/knowledge-bases/{kb['id']}/documents",
                       files=[("files", (p.name, p.read_bytes())) for p in todo[i:i + 10]])
            r.raise_for_status()
        print(f"✓ {name}: 新增 {len(todo)} 个文件")

    # 等待后台解析完成
    for _ in range(120):
        docs = [d for kb in c.get("/api/knowledge-bases").json()
                for d in c.get(f"/api/knowledge-bases/{kb['id']}/documents").json()]
        busy = [d for d in docs if d["status"] in ("pending", "parsing", "embedding")]
        if not busy:
            break
        time.sleep(1)
    failed = [d["filename"] for d in docs if d["status"] == "failed"]
    stats = c.get("/api/stats").json()
    print(f"完成：{stats['kb_count']} 个知识库 / {stats['document_count']} 个文档 / {stats['chunk_count']} 个切片"
          + (f"，失败：{failed}" if failed else ""))


if __name__ == "__main__":
    main()
