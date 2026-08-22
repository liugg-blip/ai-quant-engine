"""与厂商无关的大模型客户端。

结构化新闻任务使用 chat_json()；终端内的量化专家使用 chat_text()。
API 密钥只在本机 FastAPI 进程中读取，不下发给浏览器。
"""
import json
import re
from collections.abc import Awaitable, Callable
from typing import Any

import httpx

from config import (LLM_API_KEY, LLM_BASE_URL, LLM_ENABLED, LLM_MODEL,
                    LLM_PROVIDER, LLM_TIMEOUT)


class LLMError(RuntimeError):
    pass


def extract_json(text: str):
    """从模型回复中提取 JSON，兼容代码块和额外解释文字。"""
    t = (text or "").strip()
    try:
        return json.loads(t)
    except Exception:
        pass
    m = re.search(r"```(?:json)?\s*(.*?)```", t, re.S)
    if m:
        try:
            return json.loads(m.group(1).strip())
        except Exception:
            pass
    for a, b in (("[", "]"), ("{", "}")):
        i, j = t.find(a), t.rfind(b)
        if i >= 0 and j > i:
            try:
                return json.loads(t[i:j + 1])
            except Exception:
                continue
    raise LLMError("模型返回的不是可解析的 JSON：" + t[:200])


def _ensure_enabled() -> None:
    if not LLM_ENABLED:
        raise LLMError("未配置 LLM_API_KEY。请在 server/.env 中配置后重启量化引擎。")


async def _request(system: str, messages: list[dict], max_tokens: int,
                   json_mode: bool = False) -> str:
    _ensure_enabled()
    clean_messages = [
        {"role": m.get("role", "user"), "content": str(m.get("content") or "")}
        for m in messages if m.get("role") in ("user", "assistant") and m.get("content")
    ]
    async with httpx.AsyncClient(timeout=LLM_TIMEOUT) as client:
        if LLM_PROVIDER == "anthropic":
            response = await client.post(
                f"{LLM_BASE_URL}/messages",
                headers={"x-api-key": LLM_API_KEY, "anthropic-version": "2023-06-01",
                         "content-type": "application/json"},
                json={"model": LLM_MODEL, "max_tokens": max_tokens, "system": system,
                      "messages": clean_messages},
            )
            if response.status_code >= 400:
                raise LLMError(f"HTTP {response.status_code}: {response.text[:300]}")
            parts = response.json().get("content") or []
            text = "".join(p.get("text", "") for p in parts if p.get("type") == "text")
        else:
            payload = {
                "model": LLM_MODEL,
                "max_tokens": max_tokens,
                "temperature": 0.2,
                "messages": [{"role": "system", "content": system}, *clean_messages],
            }
            if LLM_PROVIDER == "deepseek" or "deepseek.com" in LLM_BASE_URL:
                # 对话窗口优先稳定和低延迟；深度研究仍由策略验证模块完成。
                payload["thinking"] = {"type": "disabled"}
                if json_mode:
                    payload["response_format"] = {"type": "json_object"}
            response = await client.post(
                f"{LLM_BASE_URL}/chat/completions",
                headers={"Authorization": f"Bearer {LLM_API_KEY}",
                         "Content-Type": "application/json"},
                json=payload,
            )
            if response.status_code >= 400:
                raise LLMError(f"HTTP {response.status_code}: {response.text[:300]}")
            message = (response.json().get("choices") or [{}])[0].get("message") or {}
            text = message.get("content") or message.get("reasoning_content") or ""
    text = text.strip()
    if not text:
        raise LLMError("模型返回了空内容，请检查模型名称和接口兼容性。")
    return text


async def chat_json(system: str, user: str, max_tokens: int = 4000):
    text = await _request(system, [{"role": "user", "content": user}], max_tokens, True)
    return extract_json(text)


async def chat_text(system: str, messages: list[dict], max_tokens: int = 1800) -> str:
    """生成普通文本答复，保留多轮 user/assistant 上下文。"""
    return await _request(system, messages, max_tokens, False)


async def chat_with_tools(
    system: str,
    messages: list[dict],
    tools: list[dict],
    execute: Callable[[str, dict], Awaitable[Any]],
    max_tokens: int = 2200,
    max_rounds: int = 4,
    on_event: Callable[[str, str, str, dict], Any] | None = None,
    required_tools: list[str] | None = None,
) -> tuple[str, list[dict]]:
    """用 OpenAI 兼容的函数调用完成多轮“判断需要什么 -> 执行 -> 回答”。"""
    _ensure_enabled()
    if LLM_PROVIDER == "anthropic":
        # 当前项目的 Anthropic 兼容配置只实现文本协议；保持可用但不伪装成已调用工具。
        text = await chat_text(system + "\n当前模型连接未启用后端工具协议。", messages, max_tokens)
        return text, []

    allowed = {str(t.get("function", {}).get("name") or "") for t in tools}
    conversation = [{"role": "system", "content": system}]
    conversation.extend(
        {"role": m.get("role", "user"), "content": str(m.get("content") or "")}
        for m in messages
        if m.get("role") in ("user", "assistant") and m.get("content")
    )
    trace: list[dict] = []
    forced = [name for name in (required_tools or []) if name in allowed]

    def emit(name: str, status: str, message: str, detail: dict | None = None) -> None:
        event = {"tool": name, "status": status, "message": message, "detail": detail or {}}
        trace.append(event)
        if on_event:
            on_event(name, status, message, detail or {})

    async with httpx.AsyncClient(timeout=LLM_TIMEOUT) as client:
        for round_index in range(max(1, max_rounds)):
            payload = {
                "model": LLM_MODEL,
                "max_tokens": max_tokens,
                "temperature": 0.2,
                "messages": conversation,
                "tools": tools,
                "tool_choice": "auto",
            }
            if round_index < len(forced):
                payload["tool_choice"] = {
                    "type": "function", "function": {"name": forced[round_index]}
                }
            if LLM_PROVIDER == "deepseek" or "deepseek.com" in LLM_BASE_URL:
                # 非思考模式不需要回传 reasoning_content，工具轮次更稳定且延迟更低。
                payload["thinking"] = {"type": "disabled"}
            response = await client.post(
                f"{LLM_BASE_URL}/chat/completions",
                headers={"Authorization": f"Bearer {LLM_API_KEY}",
                         "Content-Type": "application/json"},
                json=payload,
            )
            if response.status_code >= 400:
                raise LLMError(f"HTTP {response.status_code}: {response.text[:300]}")
            message = (response.json().get("choices") or [{}])[0].get("message") or {}
            calls = message.get("tool_calls") or []
            if not calls:
                text = (message.get("content") or message.get("reasoning_content") or "").strip()
                if not text:
                    raise LLMError("模型在工具调用后返回了空内容。")
                return text, trace

            normalized_calls = []
            for call_index, raw_call in enumerate(calls):
                call = dict(raw_call or {})
                call["id"] = str(call.get("id") or f"call_{round_index}_{call_index}")
                call["type"] = "function"
                call["function"] = dict(call.get("function") or {})
                normalized_calls.append(call)
            conversation.append({"role": "assistant", "content": message.get("content") or "",
                                 "tool_calls": normalized_calls})
            for call_index, call in enumerate(normalized_calls):
                function = call.get("function") or {}
                name = str(function.get("name") or "")
                call_id = call["id"]
                try:
                    args = json.loads(function.get("arguments") or "{}")
                    if not isinstance(args, dict):
                        raise ValueError("参数必须是 JSON 对象")
                    if name not in allowed:
                        raise ValueError("工具未获授权")
                    if call_index >= 8:
                        raise RuntimeError("单轮最多执行 8 项工具；该项已暂缓，请在下一轮继续查询")
                    emit(name, "running", f"正在调用 {name}", args)
                    result = await execute(name, args)
                    raw_result = json.dumps(result, ensure_ascii=False, separators=(",", ":"), default=str)
                    compact = raw_result if len(raw_result) <= 18000 else json.dumps({
                        "truncated": True,
                        "preview": raw_result[:16500],
                        "note": "工具结果过长，已保留前段；可缩小关键词或查询范围后再次调用。",
                    }, ensure_ascii=False, separators=(",", ":"))
                    emit(name, "done", f"{name} 已返回真实数据", {"bytes": len(compact)})
                except Exception as exc:
                    compact = json.dumps({"ok": False, "error": str(exc)[:400]}, ensure_ascii=False)
                    emit(name or "unknown", "error", f"工具调用失败：{str(exc)[:160]}", {})
                conversation.append({"role": "tool", "tool_call_id": call_id,
                                     "name": name or "unknown", "content": compact})

        # 达到工具轮次上限后禁止继续调用，要求模型只基于已经取得的数据作答。
        final_payload = {
            "model": LLM_MODEL, "max_tokens": max_tokens, "temperature": 0.2,
            "messages": conversation,
        }
        if LLM_PROVIDER == "deepseek" or "deepseek.com" in LLM_BASE_URL:
            final_payload["thinking"] = {"type": "disabled"}
        response = await client.post(
            f"{LLM_BASE_URL}/chat/completions",
            headers={"Authorization": f"Bearer {LLM_API_KEY}", "Content-Type": "application/json"},
            json=final_payload,
        )
        if response.status_code >= 400:
            raise LLMError(f"HTTP {response.status_code}: {response.text[:300]}")
        message = (response.json().get("choices") or [{}])[0].get("message") or {}
        text = (message.get("content") or message.get("reasoning_content") or "").strip()
        if not text:
            raise LLMError("模型没有根据工具结果生成最终回答。")
        return text, trace


def info() -> dict:
    return {"enabled": LLM_ENABLED, "provider": LLM_PROVIDER,
            "model": LLM_MODEL if LLM_ENABLED else "", "base_url": LLM_BASE_URL}
