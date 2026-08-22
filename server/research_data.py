"""综合研判前的后端独立行情复核。

前端会提交自己计算的因子和回测，但模型调用前，后端必须重新访问公开行情源，
核对标的、数据截止日和最新价格。这样审计记录来自真实 I/O，而不是模型自述。
"""
import asyncio
import hashlib
import json
import re
from datetime import datetime, timedelta, timezone

import httpx

from config import HTTP_TIMEOUT, USER_AGENT

KLINE_URLS = (
    "https://push2his.eastmoney.com/api/qt/stock/kline/get",
    "http://push2his.eastmoney.com/api/qt/stock/kline/get",
)
TENCENT_KLINE_URL = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get"
CST = timezone(timedelta(hours=8))


def _fingerprint(rows: list[tuple[str, float]]) -> str:
    raw = json.dumps(rows[-20:], ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:12]


async def _exchange_series(secid: str, include_series: bool = False) -> dict:
    base_params = {"secid": secid, "fields1": "f1,f2,f3", "fields2": "f51,f53",
                   "ut": "fa5fd1943c7b386f172d6893dbfba10b",
                   "klt": "101", "beg": "0", "end": "20500101", "lmt": "320"}
    headers = {"User-Agent": USER_AGENT, "Referer": "https://quote.eastmoney.com/",
               "Accept": "application/json,text/plain,*/*", "Connection": "close"}
    errors = []
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT, follow_redirects=True, trust_env=False) as client:
        for url in KLINE_URLS:
            try:
                async def fetch(fqt: int) -> dict:
                    response = await client.get(url, params={**base_params, "fqt": str(fqt)}, headers=headers)
                    response.raise_for_status()
                    return response.json().get("data") or {}

                adjusted, raw = await asyncio.gather(fetch(2), fetch(0))
                adjusted_rows = []
                for row in adjusted.get("klines") or []:
                    parts = row.split(",")
                    if len(parts) >= 3:
                        adjusted_rows.append((parts[0], float(parts[2])))
                raw_rows = []
                for row in raw.get("klines") or []:
                    parts = row.split(",")
                    if len(parts) >= 3:
                        raw_rows.append((parts[0], float(parts[2])))
                if len(adjusted_rows) < 60 or len(raw_rows) < 60:
                    raise ValueError("公开日线有效记录不足 60 根")
                if adjusted_rows[-1][0] != raw_rows[-1][0]:
                    raise ValueError("复权与真实价格序列截止日不一致")
                result = {"secid": secid, "name": adjusted.get("name") or raw.get("name") or "",
                          "source": "东方财富后复权收益 + 不复权价格复核", "bars": len(adjusted_rows),
                          "asof": adjusted_rows[-1][0], "latest_price": raw_rows[-1][1],
                          "return_basis": "后复权", "fingerprint": _fingerprint(adjusted_rows)}
                if include_series:
                    result["series"] = [{"date": day, "close": close} for day, close in adjusted_rows]
                return result
            except Exception as exc:
                errors.append(str(exc)[:140])
    try:
        return await _tencent_series(secid, include_series)
    except Exception as exc:
        errors.append("腾讯行情：" + str(exc)[:140])
    raise RuntimeError("；".join(errors) or "公开日线不可用")


def _tencent_symbol(secid: str) -> str:
    market, code = (secid.split(".", 1) + [""])[:2]
    if market == "1":
        return "sh" + code
    if market == "0":
        return "sz" + code
    if market == "116":
        return "hk" + code.zfill(5)
    if market in ("105", "106", "107"):
        return "us" + code.upper()
    raise ValueError(f"腾讯行情暂不支持该市场编号 {market}")


async def _tencent_series(secid: str, include_series: bool = False) -> dict:
    symbol = _tencent_symbol(secid)
    params = {"param": f"{symbol},day,,,320,qfq"}
    headers = {"User-Agent": USER_AGENT, "Referer": "https://gu.qq.com/",
               "Accept": "application/json,text/plain,*/*", "Connection": "close"}
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT, follow_redirects=True, trust_env=False) as client:
        response = await client.get(TENCENT_KLINE_URL, params=params, headers=headers)
        response.raise_for_status()
    payload = (response.json().get("data") or {}).get(symbol) or {}
    raw_rows = payload.get("day") or payload.get("qfqday") or []
    rows = []
    for row in raw_rows:
        if not isinstance(row, list) or len(row) < 3:
            continue
        try:
            rows.append((str(row[0]), float(row[2])))
        except (TypeError, ValueError):
            continue
    if len(rows) < 60:
        raise RuntimeError("腾讯公开日线有效记录不足 60 根")
    quote = (payload.get("qt") or {}).get(symbol) or []
    name = str(quote[1]) if len(quote) > 1 else ""
    result = {"secid": secid, "name": name, "source": "腾讯行情前复权收益后端备用复核",
              "bars": len(rows), "asof": rows[-1][0], "latest_price": rows[-1][1],
              "return_basis": "前复权", "fingerprint": _fingerprint(rows)}
    if include_series:
        result["series"] = [{"date": day, "close": close} for day, close in rows]
    return result


async def _otc_series(code: str, include_series: bool = False) -> dict:
    url = f"https://fund.eastmoney.com/pingzhongdata/{code}.js"
    headers = {"User-Agent": USER_AGENT, "Referer": f"https://fund.eastmoney.com/{code}.html"}
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT, follow_redirects=True, trust_env=False) as client:
        response = await client.get(url, headers=headers)
        response.raise_for_status()
    match = re.search(r"Data_netWorthTrend\s*=\s*(\[.*?\]);", response.text, re.S)
    if not match:
        raise RuntimeError("天天基金净值数据格式无法识别")
    raw = json.loads(match.group(1))
    rows = []
    for item in raw:
        try:
            day = datetime.fromtimestamp(float(item["x"]) / 1000, CST).strftime("%Y-%m-%d")
            rows.append((day, float(item["y"])))
        except (KeyError, TypeError, ValueError, OSError):
            continue
    if len(rows) < 60:
        raise RuntimeError("场外基金净值不足 60 根")
    result = {"secid": "OF." + code, "name": "", "source": "天天基金后端独立复核",
              "bars": len(rows), "asof": rows[-1][0], "latest_price": rows[-1][1],
              "fingerprint": _fingerprint(rows)}
    if include_series:
        result["series"] = [{"date": day, "close": close} for day, close in rows]
    return result


async def verify_market(secid: str, code: str = "", include_series: bool = False) -> dict:
    secid = (secid or "").strip()
    code = (code or "").strip()
    if secid.startswith("OF."):
        return await _otc_series(secid[3:] or code, include_series)
    if not secid and re.fullmatch(r"\d{6}", code):
        secid = ("1." if code[0] in "659" else "0.") + code
    if not secid:
        raise ValueError("缺少可供后端复核的 secid")
    return await _exchange_series(secid, include_series)
