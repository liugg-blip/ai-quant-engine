"""可独立部署的微信小程序 DeepSeek 聊天 API。"""
import asyncio

from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

import llm
from config import CORS_ORIGINS, WECHAT_ACCESS_TOKEN, WECHAT_RATE_LIMIT

app = FastAPI(title="DeepSeek 微信聊天 API", version="1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if CORS_ORIGINS == "*" else [s.strip() for s in CORS_ORIGINS.split(",")],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-App-Token"],
)

_SYSTEM = """你是微信小程序中的 DeepSeek 智能助手。始终使用简体中文，回答准确、友好、简洁。
不知道的内容要明确说明，不编造实时信息、来源或能力。涉及医疗、法律、投资等高风险内容时说明局限并建议咨询专业人士。"""
_rate: dict[str, list[float]] = {}


@app.get("/api/health")
def health():
    return {"ok": True, "llm": llm.info()}


@app.post("/api/wechat/chat")
async def chat(request: Request, body: dict = Body(...)):
    if WECHAT_ACCESS_TOKEN and request.headers.get("X-App-Token", "") != WECHAT_ACCESS_TOKEN:
        raise HTTPException(401, "访问令牌无效")

    now = asyncio.get_running_loop().time()
    client_ip = request.client.host if request.client else "unknown"
    recent = [t for t in _rate.get(client_ip, []) if now - t < 60]
    if len(recent) >= WECHAT_RATE_LIMIT:
        raise HTTPException(429, "请求过于频繁，请稍后再试")
    recent.append(now)
    _rate[client_ip] = recent

    raw = body.get("messages")
    if not isinstance(raw, list) or not raw:
        raise HTTPException(400, "messages 必须是非空数组")
    messages = []
    total_chars = 0
    for item in raw[-20:]:
        if not isinstance(item, dict) or item.get("role") not in ("user", "assistant"):
            continue
        content = str(item.get("content") or "").strip()
        if not content:
            continue
        if len(content) > 4000:
            raise HTTPException(400, "单条消息不能超过 4000 个字符")
        total_chars += len(content)
        messages.append({"role": item["role"], "content": content})
    if not messages or messages[-1]["role"] != "user":
        raise HTTPException(400, "最后一条消息必须来自用户")
    if total_chars > 16000:
        raise HTTPException(400, "对话上下文过长，请清空后重试")
    try:
        reply = await llm.chat_text(_SYSTEM, messages, max_tokens=1600)
    except Exception as exc:
        raise HTTPException(502, str(exc)[:400])
    return {"reply": reply, "model": llm.info().get("model") or ""}
