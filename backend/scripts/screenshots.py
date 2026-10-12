"""自动生成 README 截图和问答动图（前后端需已启动）。界面改动后重新跑一遍即可更新。

    pip install playwright                 # 使用本机已安装的 Chrome，无需额外下载浏览器
    python scripts/screenshots.py          # 输出到 docs/screenshots/

会以全新的浏览器配置运行，不影响你自己的 Chrome；问答截图会产生几条真实的问答记录。
"""

import argparse
import io
import time
from pathlib import Path

import httpx
from PIL import Image
from playwright.sync_api import Page, sync_playwright

OUT = Path(__file__).resolve().parents[2] / "docs" / "screenshots"
W, H = 1440, 900


def shot(page: Page, name: str, full: bool = False) -> None:
    page.wait_for_timeout(600)
    page.screenshot(path=str(OUT / f"{name}.png"), full_page=full)
    print("✓", name)


def wait_answer(page: Page, n: int, timeout: float = 60) -> None:
    """等待第 n 条回答生成完毕（出现「查看检索详情」链接）。"""
    end = time.time() + timeout
    while time.time() < end:
        if page.locator("text=查看检索详情").count() >= n:
            return
        page.wait_for_timeout(300)
    raise TimeoutError("等待回答超时")


def record_gif(page: Page, question: str, path: Path, seconds: float = 9, fps: int = 4) -> None:
    """边流式回答边截帧，合成动图。"""
    page.fill("textarea", question)
    page.keyboard.press("Enter")
    frames = []
    for _ in range(int(seconds * fps)):
        img = Image.open(io.BytesIO(page.screenshot(clip={"x": 300, "y": 0, "width": W - 300, "height": H})))
        frames.append(img.convert("RGB").resize((img.width * 2 // 3, img.height * 2 // 3)))
        page.wait_for_timeout(1000 // fps)
    frames += [frames[-1]] * fps * 2  # 结尾停留 2 秒
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=1000 // fps, loop=0, optimize=True)
    print("✓", path.name)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:3100")
    ap.add_argument("--api", default="http://127.0.0.1:8100")
    ap.add_argument("--kb", type=int, default=1, help="用于问答截图的知识库 ID")
    ap.add_argument("--no-gif", action="store_true")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    base = args.base.rstrip("/")

    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1.5, locale="zh-CN")

        page.goto(f"{base}/")
        page.wait_for_selector("text=全部知识库")
        shot(page, "01-home")

        page.goto(f"{base}/kb/{args.kb}")
        page.wait_for_selector("text=已完成")
        shot(page, "02-kb-detail")

        # 问答：先录动图，再追问一轮展示改写
        page.goto(f"{base}/chat?kb={args.kb}")
        page.wait_for_selector("textarea")
        if not args.no_gif:
            record_gif(page, "员工出差住宿最多可以报销多少钱？", OUT / "chat.gif")
        else:
            page.fill("textarea", "员工出差住宿最多可以报销多少钱？")
            page.keyboard.press("Enter")
        wait_answer(page, 1)
        page.fill("textarea", "那总监呢？")
        page.keyboard.press("Enter")
        wait_answer(page, 2)
        page.locator("main div.overflow-y-auto").first.evaluate("el => el.scrollTop = el.scrollHeight")
        shot(page, "03-chat")

        page.locator("text=引用来源").last.locator("xpath=..").locator("button").first.click()
        page.wait_for_selector("text=来源已校验")
        shot(page, "04-citation")
        page.keyboard.press("Escape")

        href = page.locator("a:has-text('查看检索详情')").last.get_attribute("href")
        page.goto(f"{base}{href}")
        page.wait_for_selector("text=Retrieved Chunks")
        shot(page, "05-retrieval-detail")

        page.goto(f"{base}/evals")
        page.wait_for_selector("text=评测集")
        shot(page, "06-evals")
        # 评测详情截「纯向量 + 完整问答」的基线：最能说明问题出在哪类题
        runs = httpx.get(f"{args.api.rstrip('/')}/api/evals").json()
        baseline = next((r for r in runs if r["status"] == "done" and r["mode"] == "full"
                         and r["config"]["retrieval_mode"] == "vector" and not r["config"]["rerank"]), None)
        if baseline:
            page.goto(f"{base}/evals/{baseline['id']}")
            page.wait_for_selector("text=按题型")
            shot(page, "07-eval-detail")

        page.goto(f"{base}/insights")
        page.wait_for_selector("text=知识缺口报告")
        page.wait_for_selector("text=建议补充", timeout=60000)
        shot(page, "08-insights")

        browser.close()
    print(f"\n已输出到 {OUT}")


if __name__ == "__main__":
    main()
