"""模拟一批员工的真实提问和反馈，让「知识洞察」页有数据可看（后端需已启动）。

    python scripts/simulate_usage.py              # 默认对名称含 Demo 的知识库提问
    python scripts/simulate_usage.py --kb 1

问题分三类：知识库能回答的高频问题（同一件事多种问法）、知识库没有覆盖的问题（食堂、班车、
公积金、加班……，用来产生「知识缺口」），以及几条模拟的点赞 / 点踩。
注意：这些记录会和真实问答一起出现在检索记录和洞察页中。
"""

import argparse
import sys

import httpx

# (问题, 模拟反馈)：反馈为 None / ("up",) / ("down", [原因], 备注)
QUESTIONS = [
    # ---- 高频且能回答 ----
    ("员工出差住宿最多可以报销多少钱？", ("up",)),
    ("出差住酒店一晚能报多少？", None),
    ("去北京出差住宿标准是多少？", ("up",)),
    ("经理级出差住宿上限是多少？", None),
    ("经销商提现规则是什么？", ("up",)),
    ("经销商提现最低多少钱？", None),
    ("经销商提现需要开什么发票？", None),
    ("商品退款需要满足什么条件？", None),
    ("七天无理由退货怎么算时间？", ("up",)),
    ("员工请婚假可以休几天？", None),
    ("婚假要在多久之内休完？", None),
    ("公司 VPN 怎么连接？", None),
    ("VPN 连不上怎么办？", None),
    ("电脑密码多久要改一次？", None),
    ("维修完成后多久寄回？", None),
    ("买完降价了可以退差价吗？", ("up",)),
    ("报销多久能到账？", None),
    ("业务招待人均标准是多少？", None),
    # ---- 知识库没有覆盖：用来产生知识缺口 ----
    ("员工食堂几点开饭？", None),
    ("食堂中午有几个菜？", None),
    ("公司餐补每个月多少钱？", ("down", ["没回答到点上"], "问的是日常餐补，不是出差补贴")),
    ("公司有通勤班车吗？", None),
    ("班车路线在哪里查？", None),
    ("早上几点有班车？", None),
    ("公积金缴纳比例是多少？", None),
    ("住房公积金怎么提取？", None),
    ("公积金基数什么时候调整？", None),
    ("周末加班有加班费吗？", None),
    ("加班可以调休吗？", ("down", ["答案错误"], "说的是请假规则，不是加班调休")),
    ("晚上加班到几点可以报销打车？", None),
    ("每年体检什么时候安排？", None),
    ("员工体检包含哪些项目？", None),
    ("家属可以一起体检吗？", None),
    ("试用期多久可以转正？", None),
    ("转正需要走什么流程？", None),
    ("年终奖什么时候发？", None),
    ("年终奖怎么计算？", None),
    ("公司停车位怎么申请？", None),
]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8100")
    ap.add_argument("--kb", type=int)
    args = ap.parse_args()
    c = httpx.Client(base_url=args.base.rstrip("/"), timeout=120)

    kb_id = args.kb
    if kb_id is None:
        kb = next((k for k in c.get("/api/knowledge-bases").json() if "Demo" in k["name"]), None)
        if kb is None:
            sys.exit("没有找到 Demo 知识库，请先导入 Demo 数据或用 --kb 指定")
        kb_id = kb["id"]

    stats = {"ok": 0, "refused": 0, "feedback": 0}
    for i, (q, fb) in enumerate(QUESTIONS, 1):
        r = c.post("/api/chat", json={"kb_id": kb_id, "question": q, "stream": False}).json()
        status = r.get("status", "error")
        stats["refused" if status in ("no_context", "no_answer") else "ok"] += 1
        if fb and r.get("query_id"):
            body = {"rating": 1} if fb[0] == "up" else {"rating": -1, "reasons": fb[1], "comment": fb[2]}
            c.put(f"/api/retrievals/{r['query_id']}/feedback", json=body)
            stats["feedback"] += 1
        print(f"[{i:2}/{len(QUESTIONS)}] {status:<10} {q}")
    print(f"\n完成：{stats['ok']} 条已回答，{stats['refused']} 条拒答，{stats['feedback']} 条反馈")


if __name__ == "__main__":
    main()
