"""生成 Demo 用的 PDF 和 DOCX（Markdown / TXT 示例资料直接放在 demo-data/ 里）。

    python scripts/make_demo_files.py
"""

import sys
from pathlib import Path

DEMO = Path(__file__).resolve().parents[2] / "demo-data"

PDF_PAGES = [
    ("星河优选商城 售后服务规则", [
        "文件编号：XH-CS-007　版本：V1.8　生效日期：2026年3月1日　归口部门：客户服务中心",
        "第一章 总则",
        "1.1 本规则规定了星河优选商城自营商品的保修、换货、维修和价格保护服务标准，与《商品退款规则》配合使用。",
        "1.2 售后服务受理渠道：App「我的-售后服务」、客服热线 400-800-1234、官网在线客服。",
        "第二章 保修政策",
        "2.1 数码家电类商品自签收之日起享受 1 年免费保修，主要部件（主板、屏幕、压缩机等）享受 2 年保修。",
        "2.2 星河自有品牌商品在国家三包基础上延长保修 6 个月。",
        "2.3 以下情况不在免费保修范围：人为损坏、进液、私自拆机、超出保修期、易耗品（电池容量自然衰减、滤芯等）。",
        "2.4 保修期内维修更换的部件，自更换之日起享受 90 天保修，或按原保修期剩余时间计算，以较长者为准。",
    ]),
    ("第三章 换货与维修流程", [
        "3.1 换货条件：商品签收后 30 天内出现性能故障，经检测确认为质量问题的，可申请换同型号商品；同型号缺货时可选择退款。",
        "3.2 维修流程：用户提交售后申请 → 客服 2 小时内审核 → 上门取件或用户寄回 → 维修中心 48 小时内出具检测报告 → 维修完成后 3 个工作日内寄回。",
        "3.3 维修期间，维修时长超过 15 个工作日的，用户可申请免费换新同型号商品。",
        "3.4 同一商品在保修期内因同一质量问题累计维修 2 次后仍无法正常使用的，可申请退货或换货。",
        "3.5 上门服务范围：大家电（冰箱、洗衣机、空调、电视 55 英寸以上）提供免费上门检测和维修，其他商品需寄修。",
    ]),
    ("第四章 价格保护与发票", [
        "4.1 价格保护：自营商品自签收之日起 7 天内，如商城同一商品降价，用户可申请价格保护，退还差价。",
        "4.2 以下情况不适用价格保护：秒杀、拼团、限时抢购、使用优惠券产生的价格变化、赠品价格变化。",
        "4.3 每个订单仅可申请一次价格保护，差价以退回原支付账户方式返还，1–3 个工作日到账。",
        "4.4 发票：商城默认开具电子普通发票，用户可在订单完成后 180 天内申请换开增值税专用发票。",
        "4.5 发生退货的订单，需先将原发票作废或红冲后再办理退款。",
        "附：本规则由客户服务中心负责解释，自发布之日起施行。",
    ]),
]


def make_pdf(path: Path) -> None:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer

    font_candidates = [
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",                # macOS
        "/usr/share/fonts/truetype/arphic/uming.ttc",                          # Linux
        "C:/Windows/Fonts/simhei.ttf",                                         # Windows
    ]
    font = next((f for f in font_candidates if Path(f).exists()), None)
    if font is None:
        sys.exit("找不到中文字体，跳过 PDF 生成")
    pdfmetrics.registerFont(TTFont("CJK", font))
    title = ParagraphStyle("t", fontName="CJK", fontSize=18, leading=26, spaceAfter=14)
    body = ParagraphStyle("b", fontName="CJK", fontSize=11, leading=19, spaceAfter=8,
                          wordWrap="CJK")
    story = []
    for i, (heading, paras) in enumerate(PDF_PAGES):
        story.append(Paragraph(heading, title))
        for p in paras:
            story.append(Paragraph(p, body))
        story.append(Spacer(1, 12))
        if i < len(PDF_PAGES) - 1:
            story.append(PageBreak())
    SimpleDocTemplate(str(path), pagesize=A4, title="星河优选商城 售后服务规则").build(story)


def make_docx(path: Path) -> None:
    import docx
    d = docx.Document()
    d.add_heading("星河科技 经销商结算与提现细则", 0)
    d.add_paragraph("文件编号：XH-FIN-018　版本：V1.3　生效日期：2026年2月1日　归口部门：财务部、渠道发展部")
    d.add_paragraph("本细则是《经销商管理制度》第四章「经销商提现规则」的配套操作说明。")

    d.add_heading("一、账户余额构成", 1)
    d.add_paragraph("经销商账户余额分为三类：可提现余额、冻结余额、保证金。")
    t = d.add_table(rows=1, cols=3)
    t.style = "Table Grid"
    for cell, text in zip(t.rows[0].cells, ["余额类型", "来源", "是否可提现"]):
        cell.text = text
    for row in [("可提现余额", "已结算的季度返利、已过售后期的推广佣金", "可以"),
                ("冻结余额", "确认收货未满 15 天的佣金、存在售后纠纷订单的佣金", "不可以"),
                ("保证金", "签约时缴纳的履约保证金", "不可以，解约结算时退还")]:
        cells = t.add_row().cells
        for c, v in zip(cells, row):
            c.text = v

    d.add_heading("二、提现操作步骤", 1)
    for s in ["登录「星河渠道商平台」，进入「财务中心 - 提现」。",
              "填写提现金额（1,000 元至 50 万元之间），系统自动校验可提现余额和本月提现次数（每月最多 4 次）。",
              "上传与提现金额相等的增值税专用发票（税率 6%，服务类目「市场推广服务」）的 PDF 文件。",
              "提交后由财务部在 3 个工作日内完成发票审核和付款审批。",
              "审核通过后 T+1 个工作日，款项汇入经销商企业对公账户。"]:
        d.add_paragraph(s, style="List Number")

    d.add_heading("三、常见驳回原因", 1)
    for s in ["发票抬头、税号或金额与提现申请不一致；",
              "收款账户为个人账户或非经销商本企业账户；",
              "申请在每月 26 日至月末的结账期内提交（将顺延至次月处理，而非驳回）；",
              "经销商处于违规处罚期，提现权限被暂停。"]:
        d.add_paragraph(s, style="List Bullet")

    d.add_heading("四、对账与争议", 1)
    d.add_paragraph("每季度结束后第 5 个工作日，平台推送上一季度对账单。经销商应在收到对账单后 10 个工作日内确认，"
                    "逾期未提出异议视为确认。对账存在争议的，由渠道经理发起复核，财务部在 5 个工作日内给出结论。")
    d.add_paragraph("联系人：财务部渠道结算组，邮箱 channel-finance@xinghe-tech.example。")
    d.save(str(path))


if __name__ == "__main__":
    DEMO.mkdir(exist_ok=True)
    make_pdf(DEMO / "商城售后服务规则.pdf")
    make_docx(DEMO / "经销商结算与提现细则.docx")
    print("generated:", *[p.name for p in sorted(DEMO.iterdir())], sep="\n  ")
