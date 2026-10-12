"""LLM Provider 层。

业务代码只依赖 LLMProvider 接口；OpenAI / DeepSeek / 通义 / 任何 OpenAI 兼容接口都走同一个实现，
差异只在 base_url 和模型名。没有 Key 时用 MockLLM —— 一个基于检索结果的「抽取式」回答器，
让整条 RAG 链路在离线状态下也能完整演示。
"""

import json
import re
import time
from abc import ABC, abstractmethod
from collections.abc import Iterator

from openai import BadRequestError, OpenAI


class Thinking(str):
    """推理模型（如 deepseek-flash）输出正文前的「思考」片段。stream 里以这个类型产出，
    调用方据此提示「模型思考中」，不计入答案。"""


class LLMProvider(ABC):
    provider: str
    model: str
    is_mock: bool = False

    @abstractmethod
    def stream(self, messages: list[dict], context: list[dict] | None = None) -> Iterator[str]:
        """流式生成正文片段；推理模型的思考过程以 Thinking 类型产出。
        context 是本次检索到的资料，真实模型已经在 prompt 里看到了，只有 Mock 用它。"""

    def complete(self, messages: list[dict], context: list[dict] | None = None) -> str:
        return "".join(p for p in self.stream(messages, context) if not isinstance(p, Thinking))


class OpenAICompatLLM(LLMProvider):
    def __init__(self, provider: str, api_key: str, base_url: str, model: str,
                 temperature: float = 0.1, extra_body: str = ""):
        self.provider, self.model, self.temperature = provider, model, temperature
        self.client = OpenAI(api_key=api_key, base_url=base_url, timeout=60, max_retries=1)
        self.extra_body = json.loads(extra_body) if extra_body else None
        self._send_temperature = True  # 部分推理模型不接受 temperature，第一次报错后自动关掉

    def _create(self, messages):
        kwargs = dict(model=self.model, messages=messages, stream=True)
        if self._send_temperature:
            kwargs["temperature"] = self.temperature
        if self.extra_body:
            kwargs["extra_body"] = self.extra_body
        return self.client.chat.completions.create(**kwargs)

    def stream(self, messages, context=None):
        try:
            resp = self._create(messages)
        except BadRequestError as e:
            if self._send_temperature and "temperature" in str(e).lower():
                self._send_temperature = False
                resp = self._create(messages)
            else:
                raise
        for chunk in resp:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            if delta is None:
                continue
            reasoning = getattr(delta, "reasoning_content", None)
            if reasoning:
                yield Thinking(reasoning)
            if delta.content:
                yield delta.content


_QUESTION_WORDS = re.compile(r"什么|多少|怎么|如何|哪些|是否|可以|需要|规则|要求|吗|呢|？|\?")


def _bigrams(text: str) -> set[str]:
    text = re.sub(r"[\s*#>|:：，,。、「」（）()]+", "", text)
    return {text[i:i + 2] for i in range(len(text) - 1)}


def _units(content: str) -> list[str]:
    """把切片拆成可引用的最小单元：普通句子，或「引导句 + 其后的列表 / 表格」整体。"""
    units: list[str] = []
    lines = [ln.rstrip() for ln in content.split("\n")]
    i = 0
    while i < len(lines):
        ln = lines[i].strip()
        i += 1
        if not ln or ln.startswith(("#", ">")) or set(ln) <= set("|-: "):
            continue
        if ln.endswith(("：", ":")):  # 引导句：把后面的列表 / 表格一起带上
            block = [ln]
            j = i
            while j < len(lines) and not lines[j].strip():  # 允许引导句和列表之间有空行
                j += 1
            while j < len(lines) and re.match(r"^\s*([-*|]|\d+[.、])", lines[j]):
                block.append(lines[j].rstrip())
                j += 1
            if len(block) > 1:
                i = j
                units.append("\n".join(block))
            continue
        ln = re.sub(r"^([-*•]|\d+[.、])\s*", "", ln)  # 去掉列表符号，输出时统一加
        units.extend(x.strip() for x in re.split(r"(?<=[。！？；])", ln) if len(x.strip()) >= 8)
    return units


class MockLLM(LLMProvider):
    """不调用任何模型：从检索到的资料里挑出和问题最相关的原文片段，拼成带引用的回答。"""

    provider, model, is_mock = "mock", "extractive-mock", True

    def stream(self, messages, context=None):
        answer = self._answer(messages[-1]["content"] if messages else "", context or [])
        for i in range(0, len(answer), 4):  # 模拟打字机效果
            time.sleep(0.012)
            yield answer[i:i + 4]

    @staticmethod
    def _answer(user_msg: str, context: list[dict]) -> str:
        question = _QUESTION_WORDS.sub("", user_msg.split("用户问题：")[-1])
        q = _bigrams(question)
        scored = []
        for src in context:
            for unit in _units(src["content"]):
                b = _bigrams(unit)
                hit = len(q & b)
                if hit >= 2:
                    scored.append((hit / (len(b) ** 0.3), src["index"], unit))
        scored.sort(key=lambda x: -x[0])
        picked = scored[:3]
        if not picked:
            return "当前知识库中没有找到足够的信息。"
        parts = []
        for _, idx, unit in picked:
            if "\n" in unit:
                lead, rest = unit.split("\n", 1)
                parts.append(f"{lead.rstrip('：:')}[{idx}]：\n\n{rest}")
            else:
                parts.append(f"- {unit.rstrip('。；')}。[{idx}]")
        return ("根据知识库中的相关资料：\n\n" + "\n\n".join(parts)
                + "\n\n> 当前为 Mock 模式（未配置大模型 Key），以上为从检索结果中抽取的原文片段。")
