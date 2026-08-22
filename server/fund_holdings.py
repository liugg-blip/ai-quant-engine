"""基金十大重仓抓取与分批同步。

天天基金作为主要批量来源；晨星公开基金页用于用户持仓基金的交叉核对，
以及天天基金失败时的补充。所有占比都按来源给出的基金净值占比保存。
"""
import asyncio
import json
import re
from typing import Any

import httpx
from bs4 import BeautifulSoup

import db

EASTMONEY_URL = "https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code={code}&topline=10"
MORNINGSTAR_URL = "https://www.morningstar.cn/fund/{code}.html"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
    "Accept-Language": "zh-CN,zh;q=0.9",
}


def _weight(text: str) -> float:
    match = re.search(r"-?\d+(?:\.\d+)?", text.replace(",", ""))
    return float(match.group()) if match else 0.0


def _code(text: str) -> str:
    raw = re.sub(r"\s+", "", text).upper()
    match = re.search(r"(?:SH|SZ|BJ)?(\d{5,6})(?:\.(?:SH|SZ|BJ|HK))?", raw)
    if match:
        return match.group(1)
    match = re.search(r"\b[A-Z][A-Z0-9.-]{0,9}\b", raw)
    return match.group() if match else ""


def _table_holdings(table) -> list[dict]:
    header_cells = table.find("tr")
    if not header_cells:
        return []
    headers = [x.get_text(" ", strip=True) for x in header_cells.find_all(["th", "td"])]

    def find_col(words: tuple[str, ...], fallback: int) -> int:
        for i, name in enumerate(headers):
            if any(word in name for word in words):
                return i
        return fallback

    code_i = find_col(("股票代码", "证券代码", "代码"), 1)
    name_i = find_col(("股票名称", "证券名称", "名称"), 2)
    weight_i = find_col(("占净值", "占比", "持仓比例"), 6)
    out: list[dict] = []
    for tr in table.find_all("tr")[1:]:
        cells = [x.get_text(" ", strip=True) for x in tr.find_all("td")]
        if len(cells) <= max(code_i, name_i, weight_i):
            continue
        stock_code = _code(cells[code_i])
        weight = _weight(cells[weight_i])
        if not stock_code or weight <= 0:
            continue
        out.append({"stock_code": stock_code, "stock_name": cells[name_i], "weight": weight})
        if len(out) >= 10:
            break
    return out


def parse_eastmoney(text: str, fund_code: str) -> dict:
    match = re.search(r'content:"((?:\\.|[^"\\])*)"\s*,\s*arryear\s*:', text, re.S)
    if not match:
        raise ValueError("天天基金返回内容缺少持仓表")
    try:
        html = json.loads('"' + match.group(1) + '"')
    except json.JSONDecodeError as exc:
        raise ValueError("天天基金持仓内容解析失败") from exc
    soup = BeautifulSoup(html, "html.parser")
    all_text = soup.get_text(" ", strip=True)
    date_match = re.search(r"(?:截止至[：:]?\s*|报告期[：:]?\s*)(20\d{2}-\d{2}-\d{2})", all_text)
    if not date_match:
        date_match = re.search(r"20\d{2}-\d{2}-\d{2}", all_text)
    report_date = date_match.group(1) if date_match else ""
    fund_name = ""
    heading = soup.find(["h3", "h4", "h5"])
    if heading:
        fund_name = heading.get_text(" ", strip=True)
        fund_name = re.sub(r"(?:基金)?持仓|股票投资明细.*", "", fund_name).strip(" -_")
        fund_name = re.sub(r"\s*20\d{2}年.*$", "", fund_name).strip()
    holdings: list[dict] = []
    for table in soup.find_all("table"):
        candidate = _table_holdings(table)
        if candidate:
            holdings = candidate
            break
    if not holdings:
        raise ValueError("天天基金当前报告期没有股票重仓数据")
    return {"fund_code": fund_code, "fund_name": fund_name, "report_date": report_date,
            "source": "天天基金", "source_url": EASTMONEY_URL.format(code=fund_code),
            "holdings": holdings}


def parse_morningstar(text: str, fund_code: str) -> dict:
    soup = BeautifulSoup(text, "html.parser")
    marker = soup.find(string=lambda x: bool(x and "重仓股票" in x))
    if not marker:
        raise ValueError("晨星页面没有重仓股票板块")
    area = marker.parent
    nearby = area.get_text(" ", strip=True) if area else ""
    if area and area.parent:
        nearby += " " + area.parent.get_text(" ", strip=True)[:500]
    date_match = re.search(r"20\d{2}-\d{2}-\d{2}", nearby)
    report_date = date_match.group() if date_match else ""
    table = area.find_next("table") if area else None
    holdings = _table_holdings(table) if table else []
    if not holdings:
        raise ValueError("晨星当前报告期没有股票重仓数据")
    title = soup.find("h1") or soup.find("title")
    fund_name = title.get_text(" ", strip=True) if title else ""
    fund_name = re.sub(r"[-_|].*$", "", fund_name).strip()
    fund_name = re.sub(rf"\s*{re.escape(fund_code)}\b.*$", "", fund_name).strip()
    return {"fund_code": fund_code, "fund_name": fund_name, "report_date": report_date,
            "source": "晨星", "source_url": MORNINGSTAR_URL.format(code=fund_code),
            "holdings": holdings}


async def _fetch(client: httpx.AsyncClient, url: str, parser, code: str) -> dict:
    headers = dict(HEADERS)
    if "FundArchivesDatas.aspx" in url:
        headers["Referer"] = f"https://fundf10.eastmoney.com/ccmx_{code}.html"
        headers["X-Requested-With"] = "XMLHttpRequest"
    response = await client.get(url, headers=headers, follow_redirects=True)
    response.raise_for_status()
    return parser(response.text, code)


async def sync_profiles(limit: int = 40, held_only: bool = False) -> dict[str, Any]:
    # 即使前端尚未重传目录，也先把 SQLite 中的真实持仓同步到基金目录。
    db.register_funds([])
    profiles = db.fund_sync_candidates(max(1, min(limit, 100)), held_only=held_only)
    sem = asyncio.Semaphore(6)
    results: list[dict] = []

    async with httpx.AsyncClient(timeout=httpx.Timeout(18.0, connect=8.0)) as client:
        async def one(profile: dict) -> None:
            code = profile["fund_code"]
            saved = 0
            sources: list[str] = []
            errors: list[str] = []
            async with sem:
                try:
                    data = await _fetch(client, EASTMONEY_URL.format(code=code), parse_eastmoney, code)
                    saved += db.save_fund_holdings(profile, data)
                    sources.append("天天基金")
                except Exception as exc:
                    errors.append("天天基金：" + str(exc)[:120])

                # 用户持仓优先双源核对；普通 ETF 只在主源失败时调用体积更大的晨星页面。
                if profile.get("is_held") or not saved:
                    try:
                        data = await _fetch(client, MORNINGSTAR_URL.format(code=code), parse_morningstar, code)
                        saved += db.save_fund_holdings(profile, data)
                        sources.append("晨星")
                    except Exception as exc:
                        errors.append("晨星：" + str(exc)[:120])

            if not saved:
                db.mark_fund_sync_error(code, "；".join(errors))
            results.append({"fund_code": code, "fund_name": profile.get("fund_name", ""),
                            "rows": saved, "sources": sources, "errors": errors})

        await asyncio.gather(*(one(profile) for profile in profiles))

    return {"requested": len(profiles), "succeeded": sum(1 for r in results if r["rows"]),
            "failed": sum(1 for r in results if not r["rows"]),
            "rows_saved": sum(r["rows"] for r in results), "items": results,
            "stats": db.fund_holding_stats(), "at": db.now_iso()}
