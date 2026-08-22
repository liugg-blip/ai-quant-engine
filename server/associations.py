"""把已标注新闻、具体股票和基金披露重仓做可解释的反向关联。"""
import re
from collections import defaultdict

import db


def normalize_stock_code(value: str) -> str:
    raw = str(value or "").strip().upper().replace(" ", "")
    if not raw:
        return ""
    match = re.fullmatch(r"(?:SH|SZ|BJ)?(\d{6})(?:\.(?:SH|SZ|BJ))?", raw)
    if match:
        return match.group(1)
    match = re.fullmatch(r"(?:HK)?(\d{4,5})(?:\.HK)?", raw)
    if match:
        return match.group(1).zfill(5)
    if re.fullmatch(r"[A-Z][A-Z0-9.-]{0,9}", raw):
        return raw
    return ""


def build(day: str, limit: int = 500) -> dict:
    news = db.list_news(day=day, limit=limit)
    positive = [n for n in news if n.get("label") == "利好" and float(n.get("confidence") or 0) >= 0.55]
    by_stock: dict[str, list[dict]] = defaultdict(list)
    names: dict[str, str] = {}

    for item in positive:
        codes: list[str] = []
        for entity in item.get("entities") or []:
            if not isinstance(entity, dict):
                continue
            code = normalize_stock_code(entity.get("code", ""))
            if code:
                codes.append(code)
                if entity.get("name"):
                    names[code] = str(entity["name"])
        for symbol in item.get("symbols") or []:
            code = normalize_stock_code(symbol)
            # 旧版标注的 symbols 里可能包含 ETF/基金；实体版只允许具体股票进入反查。
            if code.isdigit() and len(code) == 6 and code[0] in ("1", "5"):
                continue
            if code:
                codes.append(code)
        for code in dict.fromkeys(codes):
            by_stock[code].append(item)

    disclosures = db.holdings_for_stocks(list(by_stock))
    funds_by_stock: dict[str, list[dict]] = defaultdict(list)
    for row in disclosures:
        funds_by_stock[row["stock_code"]].append(row)
        if not names.get(row["stock_code"]) and row.get("stock_name"):
            names[row["stock_code"]] = row["stock_name"]

    stocks = []
    for code, linked_news in by_stock.items():
        linked_news.sort(key=lambda n: (float(n.get("confidence") or 0), n.get("published_at") or ""), reverse=True)
        fund_rows = sorted(funds_by_stock.get(code, []),
                           key=lambda x: (int(x.get("is_held") or 0), float(x.get("weight") or 0)),
                           reverse=True)
        fund_items = []
        for row in fund_rows[:30]:
            fund_items.append({
                "fund_code": row["fund_code"], "fund_name": row.get("fund_name") or row["fund_code"],
                "secid": row.get("secid") or "", "weight": round(float(row.get("weight") or 0), 4),
                "report_date": row.get("report_date") or "未注明", "source": row.get("source") or "",
                "source_url": row.get("source_url") or "", "is_held": bool(row.get("is_held")),
                "sources": row.get("source_records") or [],
                "is_etf": bool(row.get("is_etf")),
                "reason": (f"该基金在 {row.get('report_date') or '未注明报告期'} 披露的十大重仓中，"
                           f"{names.get(code) or code}占基金净值 {float(row.get('weight') or 0):.2f}%；"
                           "本条仅梳理新闻影响与历史持仓暴露，不代表推荐。"),
            })
        news_items = [{"uid": n["uid"], "title": n["title"], "url": n.get("url") or "",
                       "source": n["source"], "published_at": n.get("published_at") or "",
                       "confidence": n.get("confidence") or 0, "sectors": n.get("sectors") or [],
                       "reason": n.get("reason") or ""} for n in linked_news[:8]]
        max_conf = max(float(n.get("confidence") or 0) for n in linked_news)
        stocks.append({"stock_code": code, "stock_name": names.get(code) or code,
                       "importance": round(max_conf + min(len(linked_news), 5) * 0.08, 3),
                       "news_count": len(linked_news), "max_confidence": max_conf,
                       "sectors": list(dict.fromkeys(s for n in linked_news for s in (n.get("sectors") or [])))[:5],
                       "news": news_items, "funds": fund_items})

    candidate_count = len(stocks)
    # “重大”采用可解释门槛：高置信度、同股多条新闻，或能反查到基金披露重仓。
    stocks = [s for s in stocks if s["max_confidence"] >= 0.72 or s["news_count"] >= 2 or s["funds"]]
    stocks.sort(key=lambda x: (bool(x["funds"]), x["importance"], x["news_count"]), reverse=True)
    stocks = stocks[:60]
    stats = db.fund_holding_stats()
    return {"day": day, "stocks": stocks, "major_count": len(stocks),
            "candidate_count": candidate_count,
            "linked_fund_count": len({f["fund_code"] for s in stocks for f in s["funds"]}),
            "fund_data": stats,
            "notice": "本页仅做公开信息梳理，不构成荐股、荐基或买卖建议。基金十大重仓来自定期报告，通常按季度披露，可能已经发生变化。",
            "data_lag": "基金持仓比例不是实时数据；请以每条记录标注的报告期和数据来源为准。"}
