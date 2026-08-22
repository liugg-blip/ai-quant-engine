"""驻留量化专家可调用的只读后端工具。

只访问公开财经数据和量化引擎本机数据库；不包含实盘登录、委托、撤单、文件系统或任意内网访问。
"""
from __future__ import annotations

import asyncio
import html
import ipaddress
import math
import re
import socket
from urllib.parse import urljoin, urlparse

import httpx

import associations
import db
import news
import paper_engine
import research_data
from config import HTTP_TIMEOUT, USER_AGENT


FINANCE_HOSTS = (
    "eastmoney.com", "wallstreetcn.com", "cls.cn", "10jqka.com.cn", "xueqiu.com",
    "sse.com.cn", "szse.cn", "cnbc.com", "marketwatch.com", "seekingalpha.com",
    "reuters.com", "morningstar.cn", "morningstar.com",
)


def _allowed_finance_url(url: str) -> tuple[bool, str]:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower().rstrip(".")
    allowed = parsed.scheme in ("http", "https") and not parsed.username and not parsed.password
    allowed = allowed and any(host == x or host.endswith("." + x) for x in FINANCE_HOSTS)
    return bool(allowed), host


async def _assert_public_host(host: str) -> None:
    """在发出请求前校验所有解析地址，阻断回环、内网、链路本地及 DNS 重绑定目标。"""
    try:
        infos = await asyncio.to_thread(socket.getaddrinfo, host, None, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise ValueError("财经网页域名解析失败") from exc
    addresses = {row[4][0].split("%", 1)[0] for row in infos if row and row[4]}
    if not addresses:
        raise ValueError("财经网页域名没有可用地址")
    for raw in addresses:
        ip = ipaddress.ip_address(raw)
        if not ip.is_global:
            raise ValueError("财经网页解析到了非公网地址，已停止读取")


TOOL_LABELS = {
    "get_market_snapshot": "公开行情复核",
    "compare_market_history": "多标的历史风险收益比较",
    "get_latest_news": "财经新闻抓取与检索",
    "get_sentiment_overview": "市场情绪数据库",
    "get_my_holdings": "我的持仓数据库",
    "get_paper_wealth": "模拟盘与财富数据",
    "get_news_fund_links": "新闻到股票到基金关联",
    "get_fund_exposure": "基金重仓反查",
    "get_engine_status": "量化引擎数据状态",
    "read_public_finance_url": "公开财经网页读取",
}


def required_tool_for(question: str) -> str:
    """为必须依赖新数据的问题设置首轮工具门禁，避免模型沿用旧对话数字。"""
    text = re.sub(r"\s+", "", str(question or "")).lower()
    if not text:
        return ""
    if re.search(r"https?://", text):
        return "read_public_finance_url"
    if "我的持仓" in text or "我持有" in text or "我的基金" in text or "我的股票" in text:
        return "get_my_holdings"
    if any(word in text for word in ("模拟盘", "我的财富", "虚拟账户", "假钱账户")):
        return "get_paper_wealth"
    if any(word in text for word in ("新闻关联", "哪些基金重仓", "反查基金", "关联基金")):
        return "get_news_fund_links"
    if any(word in text for word in ("数据库状态", "数据状态", "后端状态", "引擎状态")):
        return "get_engine_status"
    history_words = ("历史", "回测", "比较", "对比", "最稳", "稳健", "波动", "回撤", "夏普", "收益")
    asset_words = ("基金", "股票", "etf", "标的", "以上", "这些", "代码")
    code_mentioned = bool(re.search(r"(?<!\d)\d{5,6}(?!\d)", text))
    if any(word in text for word in history_words) and (
            any(word in text for word in asset_words) or code_mentioned):
        return "compare_market_history"
    if "情绪" in text and any(word in text for word in ("今天", "今日", "当前", "最新", "市场", "板块")):
        return "get_sentiment_overview"
    if "新闻" in text or "公告" in text or "资讯" in text:
        return "get_latest_news"
    market_words = ("行情", "价格", "净值", "涨跌", "走势", "现价", "数据截止", "最新价")
    if any(word in text for word in market_words):
        return "get_market_snapshot"
    return ""


def required_tools_for(question: str) -> list[str]:
    """按顺序列出本轮必须完成的数据读取；当前标的与新闻可以同时核验。"""
    text = re.sub(r"\s+", "", str(question or "")).lower()
    result: list[str] = []
    if any(word in text for word in ("当前标的", "本标的", "这个标的", "页面标的", "现在这只")):
        result.append("get_market_snapshot")
    primary = required_tool_for(question)
    if primary and primary not in result:
        result.append(primary)
    if ("新闻" in text or "公告" in text or "资讯" in text) and "get_latest_news" not in result:
        result.append("get_latest_news")
    if "情绪" in text and "get_sentiment_overview" not in result:
        result.append("get_sentiment_overview")
    return result[:3]


TOOLS = [
    {"type": "function", "function": {
        "name": "get_market_snapshot",
        "description": "获取当前或指定股票、ETF、场外基金的公开最新日线截止日、最新价和数据源。询问最新行情、价格或数据日期时调用。",
        "parameters": {"type": "object", "properties": {
            "secid": {"type": "string", "description": "东方财富 secid，例如 1.510300、0.159915、OF.161725；当前标的可留空"},
            "code": {"type": "string", "description": "证券或基金代码；当前标的可留空"},
        }, "additionalProperties": False},
    }},
    {"type": "function", "function": {
        "name": "compare_market_history",
        "description": "批量读取最多8只股票、ETF或场外基金的公开日线，比较历史收益、年化波动、最大回撤、夏普和上涨日比例。用户要求比较多只基金历史表现或找相对稳健标的时调用。",
        "parameters": {"type": "object", "properties": {
            "items": {"type": "array", "minItems": 1, "maxItems": 8, "items": {
                "type": "object", "properties": {
                    "secid": {"type": "string", "description": "如1.510300、0.159915、OF.161725"},
                    "code": {"type": "string"},
                    "name": {"type": "string"},
                }, "additionalProperties": False}},
            "window": {"type": "integer", "minimum": 60, "maximum": 320, "description": "比较最近多少根日线，默认250"},
        }, "required": ["items"], "additionalProperties": False},
    }},
    {"type": "function", "function": {
        "name": "get_latest_news",
        "description": "从公开财经源实时抓取或查询本机新闻库。用户说今天、当前、最新新闻时应把 refresh 设为 true；query 使用一到三个短关键词。",
        "parameters": {"type": "object", "properties": {
            "query": {"type": "string", "description": "短关键词，例如 半导体 基金；空字符串表示全部财经新闻"},
            "limit": {"type": "integer", "minimum": 1, "maximum": 20},
            "refresh": {"type": "boolean", "description": "是否先联网抓取全部公开财经源"},
        }, "additionalProperties": False},
    }},
    {"type": "function", "function": {
        "name": "get_sentiment_overview",
        "description": "读取已由模型标注的每日新闻情绪、利好利空数量和板块热度。",
        "parameters": {"type": "object", "properties": {
            "day": {"type": "string", "description": "YYYY-MM-DD；空值表示今天"},
        }, "additionalProperties": False},
    }},
    {"type": "function", "function": {
        "name": "get_my_holdings",
        "description": "读取用户保存在本机 SQLite 的基金和股票持仓、录入依据与定投计划。仅在用户明确询问我的持仓时调用。",
        "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
    }},
    {"type": "function", "function": {
        "name": "get_paper_wealth",
        "description": "读取纯模拟盘账户的总资产、收益、回撤、夏普和沪深300基准。不会执行任何交易。",
        "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
    }},
    {"type": "function", "function": {
        "name": "get_news_fund_links",
        "description": "读取今日利好新闻涉及的股票，并反查重仓这些股票的基金及季报占比。用于新闻影响哪些基金的信息梳理。",
        "parameters": {"type": "object", "properties": {
            "day": {"type": "string", "description": "YYYY-MM-DD；空值表示今天"},
            "query": {"type": "string", "description": "股票代码、公司、板块或基金关键词，可留空"},
        }, "additionalProperties": False},
    }},
    {"type": "function", "function": {
        "name": "get_fund_exposure",
        "description": "给定股票代码，反查哪些基金在最新已入库季报十大重仓中持有它，并返回占基金净值比例和报告日期。",
        "parameters": {"type": "object", "properties": {
            "stock_codes": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 10},
        }, "required": ["stock_codes"], "additionalProperties": False},
    }},
    {"type": "function", "function": {
        "name": "get_engine_status",
        "description": "查看量化引擎数据库中的新闻、情绪、基金持仓、个人持仓和模拟账户数量及数据日期。",
        "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
    }},
    {"type": "function", "function": {
        "name": "read_public_finance_url",
        "description": "读取用户提供的公开财经网页正文。只支持允许的财经与交易所域名，不访问本机、内网或任意文件。",
        "parameters": {"type": "object", "properties": {
            "url": {"type": "string", "description": "用户消息中明确提供的 http/https 财经网页链接"},
        }, "required": ["url"], "additionalProperties": False},
    }},
]


def tool_label(name: str) -> str:
    return TOOL_LABELS.get(name, name or "未知工具")


def _compact_news(item: dict) -> dict:
    return {k: item.get(k) for k in (
        "title", "source", "published_at", "url", "summary", "label", "confidence",
        "sectors", "symbols", "reason")}


def _query_news(items: list[dict], query: str, limit: int) -> list[dict]:
    query = str(query or "").strip()
    if not query:
        return items[:limit]
    terms = [x.lower() for x in re.split(r"[\s,，、/|]+", query) if x.strip()][:5]
    ranked = []
    for item in items:
        blob = " ".join(str(item.get(k) or "") for k in
                        ("title", "summary", "source", "sectors", "symbols", "reason")).lower()
        score = sum(1 for term in terms if term in blob)
        if score:
            ranked.append((score, item.get("published_at") or "", item))
    ranked.sort(key=lambda row: (row[0], row[1]), reverse=True)
    return [row[2] for row in ranked[:limit]]


class AgentTools:
    def __init__(self, context: dict | None = None, question: str = ""):
        self.context = context if isinstance(context, dict) else {}
        self.question = str(question or "")

    def required_args(self, name: str) -> dict | None:
        """为可确定的强制工具生成参数，使数据读取不依赖模型先成功返回 tool_call。"""
        instrument = self.context.get("instrument") or {}
        if name == "get_market_snapshot":
            return {"secid": instrument.get("secid") or "", "code": instrument.get("code") or ""}
        if name == "get_latest_news":
            refresh = any(word in self.question for word in ("今天", "今日", "当前", "最新", "刚刚"))
            return {"refresh": refresh, "limit": 12}
        if name in ("get_sentiment_overview", "get_my_holdings", "get_paper_wealth",
                    "get_news_fund_links", "get_engine_status"):
            return {}
        if name == "read_public_finance_url":
            match = re.search(r"https?://[^\s<>\"']+", self.question)
            return {"url": match.group(0).rstrip("，。；、)") } if match else None
        if name == "compare_market_history":
            codes = list(dict.fromkeys(re.findall(r"(?<!\d)(\d{5,6})(?!\d)", self.question)))[:8]
            items = [{"code": code} for code in codes]
            if not items and (instrument.get("secid") or instrument.get("code")):
                items = [{"secid": instrument.get("secid") or "", "code": instrument.get("code") or "",
                          "name": instrument.get("name") or ""}]
            return {"items": items, "window": 250} if items else None
        if name == "get_fund_exposure":
            codes = list(dict.fromkeys(re.findall(r"(?<!\d)(\d{5,6})(?!\d)", self.question)))[:10]
            return {"stock_codes": codes} if codes else None
        return None

    async def execute(self, name: str, args: dict) -> dict:
        args = args if isinstance(args, dict) else {}
        handlers = {
            "get_market_snapshot": self._market,
            "compare_market_history": self._compare_history,
            "get_latest_news": self._news,
            "get_sentiment_overview": self._sentiment,
            "get_my_holdings": self._holdings,
            "get_paper_wealth": self._wealth,
            "get_news_fund_links": self._links,
            "get_fund_exposure": self._exposure,
            "get_engine_status": self._status,
            "read_public_finance_url": self._read_url,
        }
        if name not in handlers:
            raise ValueError("工具未获授权")
        return await handlers[name](args)

    async def _market(self, args: dict) -> dict:
        instrument = self.context.get("instrument") or {}
        asks_current = any(word in self.question for word in
                           ("当前标的", "本标的", "这个标的", "页面标的", "现在这只"))
        # “当前标的”只能绑定前端本轮上下文，禁止模型从旧对话自行填入其他代码。
        secid = str((instrument.get("secid") if asks_current else args.get("secid"))
                    or instrument.get("secid") or "").strip()
        code = str((instrument.get("code") if asks_current else args.get("code"))
                   or instrument.get("code") or "").strip()
        data = await research_data.verify_market(secid, code)
        return {"ok": True, "queried_at": db.now_iso(),
                "bound_to_current_instrument": asks_current,
                "requested_name": instrument.get("name") or "", **data,
                "note": "公开行情快照，不是交易所逐笔行情。"}

    @staticmethod
    def _history_metrics(data: dict, requested_name: str, window: int) -> dict:
        series = (data.get("series") or [])[-window:]
        valid_series = [row for row in series if float(row.get("close") or 0) > 0]
        closes = [float(row["close"]) for row in valid_series]
        if len(closes) < 60:
            raise ValueError("有效日线不足 60 根")
        returns = [closes[i] / closes[i - 1] - 1 for i in range(1, len(closes)) if closes[i - 1] > 0]
        total = closes[-1] / closes[0] - 1
        annualized = (closes[-1] / closes[0]) ** (252 / max(1, len(closes) - 1)) - 1
        mean = sum(returns) / len(returns)
        variance = sum((value - mean) ** 2 for value in returns) / max(1, len(returns) - 1)
        daily_vol = math.sqrt(max(0.0, variance))
        peak, drawdown = closes[0], 0.0
        for close in closes:
            peak = max(peak, close)
            drawdown = min(drawdown, close / peak - 1)
        return {
            "secid": data.get("secid"), "code": str(data.get("secid") or "").split(".")[-1],
            "name": requested_name or data.get("name") or data.get("secid"),
            "source": data.get("source"), "start": valid_series[0].get("date"),
            "asof": valid_series[-1].get("date"), "bars": len(closes), "latest_price": closes[-1],
            "total_return_pct": round(total * 100, 2),
            "annualized_return_pct": round(annualized * 100, 2),
            "annualized_volatility_pct": round(daily_vol * math.sqrt(252) * 100, 2),
            "max_drawdown_pct": round(abs(drawdown) * 100, 2),
            "sharpe_rf0": round(mean / daily_vol * math.sqrt(252), 3) if daily_vol else 0,
            "positive_day_pct": round(sum(1 for value in returns if value > 0) / len(returns) * 100, 2),
        }

    async def _compare_history(self, args: dict) -> dict:
        items = (args.get("items") or [])[:8]
        if not items:
            raise ValueError("至少需要一个标的")
        window = max(60, min(int(args.get("window") or 250), 320))

        async def one(item: dict) -> dict:
            item = item if isinstance(item, dict) else {"code": str(item)}
            try:
                data = await research_data.verify_market(str(item.get("secid") or ""),
                                                         str(item.get("code") or ""), True)
                return self._history_metrics(data, str(item.get("name") or ""), window)
            except Exception as exc:
                return {"secid": item.get("secid") or "", "code": item.get("code") or "",
                        "name": item.get("name") or "", "error": str(exc)[:240]}

        rows = await asyncio.gather(*(one(item) for item in items))
        valid = [row for row in rows if not row.get("error")]
        return {"ok": bool(valid), "queried_at": db.now_iso(), "window_requested": window,
                "valid": len(valid), "failed": len(rows) - len(valid), "items": rows,
                "method": "按公开收盘价计算的历史买入并持有风险收益统计；夏普按无风险利率0估算。",
                "warning": "这不是策略回测，也不代表未来；比较结论必须同时检查区间、回撤、波动和数据源。"}

    async def _news(self, args: dict) -> dict:
        query = str(args.get("query") or "").strip()
        limit = max(1, min(int(args.get("limit") or 12), 20))
        refresh_result = None
        if bool(args.get("refresh")):
            payload = await news.crawl_all()
            added = db.save_news(payload.get("items") or [])
            refresh_result = {"fetched": len(payload.get("items") or []), "added": added,
                              "per_source": payload.get("per_source") or {}}
        day = db.today()
        pool = db.list_news(day=day, limit=500)
        matches = _query_news(pool, query, limit)
        if query and not matches:
            matches = _query_news(db.list_news(day=None, limit=1200), query, limit)
        return {"ok": True, "day": day, "query": query, "refresh": refresh_result,
                "matched": len(matches), "items": [_compact_news(x) for x in matches],
                "note": "标题和摘要来自公开源；未标注项目可由本次对话模型解读，但不等同于价格预测。"}

    async def _sentiment(self, args: dict) -> dict:
        day = str(args.get("day") or db.today())[:10]
        stats = db.sentiment_stats(day)
        items = db.list_news(day=day, limit=500)
        sectors: dict[str, dict] = {}
        for item in items:
            label = item.get("label")
            weight = float(item.get("confidence") or 0) * (1 if label == "利好" else -1 if label == "利空" else 0)
            for sector in item.get("sectors") or []:
                row = sectors.setdefault(str(sector), {"sector": str(sector), "score": 0.0, "count": 0})
                row["score"] += weight
                row["count"] += 1
        top = sorted(sectors.values(), key=lambda row: abs(row["score"]), reverse=True)[:12]
        for row in top:
            row["score"] = round(row["score"], 3)
        return {"ok": True, **stats, "top_sectors": top,
                "note": "新闻情绪是模型分类统计，不代表后续价格方向。"}

    async def _holdings(self, args: dict) -> dict:
        rows = db.list_holdings()
        fields = ("code", "secid", "name", "kind", "shares", "cost", "input_mode",
                  "invested_amount", "entry_date", "entry_price", "dca_enabled", "dca_amount",
                  "dca_frequency", "dca_start_date", "dca_cycles", "dca_planned_total", "dca_next_date")
        return {"ok": True, "count": len(rows),
                "items": [{k: row.get(k) for k in fields} for row in rows],
                "privacy": "仅因用户明确询问持仓而读取；不包含任何券商账号或凭证。"}

    async def _wealth(self, args: dict) -> dict:
        data = await paper_engine.wealth_all(refresh=False)
        return {"ok": True, "simulation_only": True, **data,
                "warning": "全部为假钱模拟记录，不能据此声称已交易。"}

    async def _links(self, args: dict) -> dict:
        day = str(args.get("day") or db.today())[:10]
        query = str(args.get("query") or "").strip().lower()
        data = associations.build(day, 500)
        stocks = data.get("stocks") or []
        if query:
            stocks = [s for s in stocks if query in " ".join([
                str(s.get("stock_code") or ""), str(s.get("stock_name") or ""),
                " ".join(s.get("sectors") or []),
                " ".join(str(f.get("fund_name") or "") for f in s.get("funds") or []),
            ]).lower()]
        return {"ok": True, "day": day, "matched": len(stocks), "stocks": stocks[:12],
                "data_lag": data.get("data_lag"), "notice": data.get("notice")}

    async def _exposure(self, args: dict) -> dict:
        codes = [str(x or "").strip().upper() for x in (args.get("stock_codes") or [])][:10]
        if not codes:
            raise ValueError("至少需要一个股票代码")
        rows = db.holdings_for_stocks(codes)
        fields = ("stock_code", "stock_name", "fund_code", "fund_name", "weight",
                  "report_date", "source", "source_url", "is_held", "is_etf")
        return {"ok": True, "stock_codes": codes, "count": len(rows),
                "items": [{k: row.get(k) for k in fields} for row in rows[:80]],
                "warning": "基金重仓来自季报，存在披露滞后，不是实时仓位。"}

    async def _status(self, args: dict) -> dict:
        return {"ok": True, "time": db.now_iso(), "today": db.today(), "counts": db.counts(),
                "news_days": db.news_days(10), "fund_holdings": db.fund_holding_stats()}

    async def _read_url(self, args: dict) -> dict:
        url = str(args.get("url") or "").strip()
        allowed, _ = _allowed_finance_url(url)
        if not allowed:
            raise ValueError("只允许读取公开财经媒体、交易所和基金数据域名")
        if url not in self.question:
            raise ValueError("只能读取用户在当前问题中明确提供的链接")
        current = url
        response = None
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT, follow_redirects=False,
                                     headers={"User-Agent": USER_AGENT}, trust_env=False) as client:
            for _ in range(5):
                ok, host = _allowed_finance_url(current)
                if not ok:
                    raise ValueError("财经网页重定向到了未授权域名，已停止读取")
                await _assert_public_host(host)
                response = await client.get(current)
                if response.status_code in (301, 302, 303, 307, 308):
                    location = response.headers.get("location")
                    if not location:
                        raise ValueError("财经网页返回了无目标的重定向")
                    current = urljoin(current, location)
                    continue
                response.raise_for_status()
                break
            else:
                raise ValueError("财经网页重定向次数过多")
        if response is None:
            raise ValueError("财经网页读取失败")
        text = re.sub(r"(?is)<(script|style|noscript).*?>.*?</\1>", " ", response.text[:800000])
        text = re.sub(r"(?s)<[^>]+>", " ", text)
        text = re.sub(r"\s+", " ", html.unescape(text)).strip()
        return {"ok": True, "url": str(response.url), "status": response.status_code,
                "text": text[:12000], "fetched_at": db.now_iso(),
                "note": "网页正文可能受站点动态渲染或版权限制而不完整。"}
