"""纯本地模拟盘：复合信号、拟交易清单、T+1 虚拟撮合与财富曲线。

本模块没有、也不会导入任何券商/QMT/交易柜台 SDK。所有“成交”只写 SQLite。
行情只用公开日线；执行价是最新未复权收盘价叠加可配置滑点，不代表真实可成交价格。
"""
import asyncio
import json
import math
import statistics
import time
from datetime import date
from typing import Any

import httpx

import db
from associations import normalize_stock_code
from config import USER_AGENT

KLINE_URLS = ("https://push2his.eastmoney.com/api/qt/stock/kline/get",
              "http://push2his.eastmoney.com/api/qt/stock/kline/get")
DEFAULT_RULES = {
    "news_threshold": 0.10,
    "factor_top_pct": 0.35,
    "trend_min": 55.0,
    "composite_min": 62.0,
    "sell_news_threshold": -0.35,
    "sell_factor_pct": 0.80,
    "sell_trend_max": 35.0,
    "news_weight": 0.35,
    "factor_weight": 0.35,
    "trend_weight": 0.30,
    "max_positions": 3,
    "max_single_pct": 0.40,
    "max_total_pct": 0.95,
    "buy_top_n": 3,
    "cooldown_days": 5,
    "commission_rate": 0.00025,
    "commission_min": 5.0,
    "slippage_rate": 0.0005,
    "stamp_tax_rate": 0.0005,
    "stop_loss_pct": 0.08,
    "trail_activate_pct": 0.03,
    "trail_drawdown_pct": 0.05,
}


def _json(value: str | None, fallback):
    try:
        return json.loads(value) if value else fallback
    except (TypeError, json.JSONDecodeError):
        return fallback


def _rules(raw: dict | None = None) -> dict:
    out = dict(DEFAULT_RULES)
    if raw:
        for key in out:
            if key in raw:
                out[key] = raw[key]
    # 服务端再次夹紧，前端不能绕过仓位和费用边界。
    out["news_threshold"] = max(-1.0, min(1.0, float(out["news_threshold"])))
    out["factor_top_pct"] = max(0.01, min(1.0, float(out["factor_top_pct"])))
    out["trend_min"] = max(0.0, min(100.0, float(out["trend_min"])))
    out["composite_min"] = max(0.0, min(100.0, float(out["composite_min"])))
    out["sell_news_threshold"] = max(-1.0, min(1.0, float(out["sell_news_threshold"])))
    out["sell_factor_pct"] = max(0.0, min(1.0, float(out["sell_factor_pct"])))
    out["sell_trend_max"] = max(0.0, min(100.0, float(out["sell_trend_max"])))
    for key in ("news_weight", "factor_weight", "trend_weight"):
        out[key] = max(0.0, float(out[key]))
    out["max_positions"] = max(1, min(20, int(out["max_positions"])))
    out["buy_top_n"] = max(1, min(20, int(out["buy_top_n"])))
    out["max_single_pct"] = max(0.01, min(1.0, float(out["max_single_pct"])))
    out["max_total_pct"] = max(out["max_single_pct"], min(1.0, float(out["max_total_pct"])))
    out["cooldown_days"] = max(0, min(60, int(out["cooldown_days"])))
    out["commission_rate"] = max(0.0, min(0.01, float(out["commission_rate"])))
    out["commission_min"] = max(0.0, min(100.0, float(out["commission_min"])))
    out["slippage_rate"] = max(0.0, min(0.02, float(out["slippage_rate"])))
    out["stamp_tax_rate"] = max(0.0, min(0.01, float(out["stamp_tax_rate"])))
    for key in ("stop_loss_pct", "trail_activate_pct", "trail_drawdown_pct"):
        out[key] = max(0.0, min(0.50, float(out[key])))
    return out


def create_account(name: str, initial_cash: float = 100000, mode: str = "safe",
                   rules: dict | None = None) -> dict:
    initial_cash = max(1000.0, min(1_000_000_000.0, float(initial_cash)))
    mode = mode if mode in ("safe", "auto") else "safe"
    ts = db.now_iso()
    with db.write_tx() as c:
        cur = c.execute(
            """INSERT INTO paper_accounts
               (name, initial_cash, cash, mode, rules, benchmark_secid, active, created_at, updated_at)
               VALUES (?,?,?,?,?,'1.510300',1,?,?)""",
            ((name or "模拟账户").strip()[:40], initial_cash, initial_cash, mode,
             json.dumps(_rules(rules), ensure_ascii=False), ts, ts),
        )
        aid = cur.lastrowid
        c.execute(
            """INSERT INTO paper_equity
               (account_id, day, total_asset, cash, market_value, benchmark_close, benchmark_value, created_at)
               VALUES (?,?,?,?,0,0,?,?)""",
            (aid, db.today(), initial_cash, initial_cash, initial_cash, ts),
        )
    return account_detail(aid)


def list_accounts() -> list[dict]:
    rows = [dict(r) for r in db.conn().execute(
        """SELECT a.*, COALESCE(e.total_asset, a.cash) total_asset,
                  COALESCE(e.market_value,0) market_value,
                  (SELECT COUNT(*) FROM paper_positions p WHERE p.account_id=a.id AND p.shares>0) position_count,
                  (SELECT COUNT(*) FROM paper_proposals q WHERE q.account_id=a.id AND q.status='pending') pending_count
           FROM paper_accounts a LEFT JOIN paper_equity e ON e.account_id=a.id
             AND e.day=(SELECT MAX(day) FROM paper_equity WHERE account_id=a.id)
           WHERE a.active=1 ORDER BY a.id""")]
    for row in rows:
        row["rules"] = _rules(_json(row.get("rules"), {}))
        row["simulation_only"] = True
    return rows


def _account(account_id: int) -> dict:
    row = db.conn().execute("SELECT * FROM paper_accounts WHERE id=? AND active=1", (account_id,)).fetchone()
    if not row:
        raise ValueError("模拟账户不存在")
    out = dict(row)
    out["rules"] = _rules(_json(out.get("rules"), {}))
    return out


def _decode_rows(rows: list[dict], field: str) -> list[dict]:
    for row in rows:
        row[field] = _json(row.get(field), [])
    return rows


def account_detail(account_id: int) -> dict:
    account = _account(account_id)
    today = db.today()
    watchlist = [dict(r) for r in db.conn().execute(
        "SELECT * FROM paper_watchlist WHERE account_id=? ORDER BY created_at, secid", (account_id,))]
    positions = [dict(r) for r in db.conn().execute(
        """SELECT p.*,
             COALESCE((SELECT SUM(l.remaining) FROM paper_lots l
                       WHERE l.account_id=p.account_id AND l.secid=p.secid
                         AND l.buy_day<? AND l.remaining>0),0) available_shares
           FROM paper_positions p WHERE p.account_id=? AND p.shares>0 ORDER BY p.market_value DESC""",
        (today, account_id))]
    proposals = _decode_rows([dict(r) for r in db.conn().execute(
        "SELECT * FROM paper_proposals WHERE account_id=? ORDER BY id DESC LIMIT 100", (account_id,))], "reasons")
    trades = [dict(r) for r in db.conn().execute(
        "SELECT * FROM paper_trades WHERE account_id=? ORDER BY id DESC LIMIT 100", (account_id,))]
    signal_day = db.conn().execute(
        "SELECT MAX(signal_day) d FROM paper_signals WHERE account_id=?", (account_id,)).fetchone()["d"]
    signals = []
    if signal_day:
        signals = _decode_rows([dict(r) for r in db.conn().execute(
            """SELECT * FROM paper_signals WHERE account_id=? AND signal_day=?
               ORDER BY composite_score DESC""", (account_id, signal_day))], "reasons")
    account.update({"watchlist": watchlist, "positions": positions, "proposals": proposals,
                    "trades": trades, "signals": signals, "signal_day": signal_day or "",
                    "simulation_only": True,
                    "warning": "模拟盘，非真实资金；所有成交只写本机 SQLite。"})
    return account


def update_account(account_id: int, body: dict) -> dict:
    account = _account(account_id)
    mode = body.get("mode", account["mode"])
    if mode not in ("safe", "auto"):
        raise ValueError("模式只能是安全确认或模拟自动")
    rules = _rules({**account["rules"], **(body.get("rules") or {})})
    name = str(body.get("name") or account["name"]).strip()[:40]
    with db.write_tx() as c:
        c.execute("UPDATE paper_accounts SET name=?, mode=?, rules=?, updated_at=? WHERE id=?",
                  (name, mode, json.dumps(rules, ensure_ascii=False), db.now_iso(), account_id))
    return account_detail(account_id)


def archive_account(account_id: int) -> None:
    _account(account_id)
    with db.write_tx() as c:
        c.execute("UPDATE paper_accounts SET active=0, updated_at=? WHERE id=?", (db.now_iso(), account_id))


def replace_watchlist(account_id: int, items: list[dict]) -> dict:
    _account(account_id)
    clean: list[dict] = []
    seen = set()
    for item in items[:50]:
        secid = str(item.get("secid") or "").strip()
        if not (secid.startswith("0.") or secid.startswith("1.")) or secid in seen:
            continue
        seen.add(secid)
        code = str(item.get("code") or secid.split(".", 1)[-1]).strip()
        kind = "ETF" if item.get("kind") == "ETF" else "股票"
        clean.append({"secid": secid, "code": code, "name": str(item.get("name") or code)[:40], "kind": kind})
    with db.write_tx() as c:
        c.execute("DELETE FROM paper_watchlist WHERE account_id=?", (account_id,))
        for item in clean:
            c.execute(
                """INSERT INTO paper_watchlist (account_id, secid, code, name, kind, created_at)
                   VALUES (?,?,?,?,?,?)""",
                (account_id, item["secid"], item["code"], item["name"], item["kind"], db.now_iso()),
            )
    return account_detail(account_id)


async def _fetch_series(client: httpx.AsyncClient, secid: str, fqt: int, limit: int = 280) -> dict:
    params = {"secid": secid, "fields1": "f1,f2,f3", "fields2": "f51,f52,f53,f54,f55,f56",
              "klt": "101", "fqt": str(fqt), "beg": "0", "end": "20500101", "lmt": str(limit),
              "_": str(int(time.time() * 1000))}
    headers = {"User-Agent": USER_AGENT, "Referer": "https://quote.eastmoney.com/",
               "Accept": "application/json,text/plain,*/*", "Connection": "close"}
    payload = None
    errors = []
    for url in KLINE_URLS:
        try:
            response = await client.get(url, params=params, headers=headers)
            response.raise_for_status()
            payload = response.json().get("data") or {}
            if payload.get("klines"):
                break
        except Exception as exc:
            errors.append(str(exc)[:100])
            payload = None
    if not payload:
        cached = db.conn().execute("SELECT payload FROM paper_market_cache WHERE secid=? AND fqt=?", (secid, fqt)).fetchone()
        if cached:
            data = _json(cached["payload"], {})
            if len(data.get("dates") or []) >= (65 if limit >= 65 else 2):
                return data
        raise ValueError("；".join(errors) or "公开日线不可用且无本地缓存")
    rows = payload.get("klines") or []
    minimum = 65 if limit >= 65 else 2
    if len(rows) < minimum:
        raise ValueError(f"{secid} 日线不足 {minimum} 根")
    dates, close, volume = [], [], []
    for row in rows:
        p = row.split(",")
        dates.append(p[0]); close.append(float(p[2])); volume.append(float(p[5] or 0))
    data = {"secid": secid, "name": payload.get("name") or "", "dates": dates,
            "close": close, "volume": volume, "source": "公开日线"}
    with db.write_tx() as c:
        c.execute(
            """INSERT INTO paper_market_cache (secid,fqt,payload,asof_day,updated_at) VALUES (?,?,?,?,?)
               ON CONFLICT(secid,fqt) DO UPDATE SET payload=excluded.payload,asof_day=excluded.asof_day,
                 updated_at=excluded.updated_at""",
            (secid, fqt, json.dumps(data, ensure_ascii=False), dates[-1], db.now_iso()),
        )
    return data


async def _fetch_market(client: httpx.AsyncClient, item: dict) -> dict:
    adjusted, raw = await asyncio.gather(
        _fetch_series(client, item["secid"], 2), _fetch_series(client, item["secid"], 0, 8)
    )
    return {**item, "adjusted": adjusted, "raw": raw,
            "reference_price": raw["close"][-1], "reference_day": raw["dates"][-1]}


def _mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _market_metrics(market: dict) -> dict:
    c = market["adjusted"]["close"]
    ma20, ma60 = _mean(c[-20:]), _mean(c[-60:])
    ma20_prev = _mean(c[-25:-5])
    momentum20 = c[-1] / c[-21] - 1
    gap20 = c[-1] / ma20 - 1 if ma20 else 0
    returns = [c[i] / c[i - 1] - 1 for i in range(len(c) - 19, len(c)) if c[i - 1]]
    volatility = statistics.pstdev(returns) if len(returns) > 1 else 0
    trend = 50.0
    trend += 18 if c[-1] > ma20 else -18
    trend += 14 if ma20 > ma20_prev else -14
    trend += 13 if c[-1] > ma60 else -13
    trend += max(-5, min(5, momentum20 * 50))
    return {"momentum20": momentum20, "gap20": gap20, "volatility": volatility,
            "trend_score": max(0.0, min(100.0, trend)), "ma20": ma20, "ma60": ma60}


def _percentile(values: list[tuple[str, float]], descending: bool) -> dict[str, float]:
    ordered = sorted(values, key=lambda x: x[1], reverse=descending)
    n = len(ordered)
    if n <= 1:
        return {key: 0.0 for key, _ in ordered}
    return {key: i / (n - 1) for i, (key, _) in enumerate(ordered)}


def _news_scores(day: str) -> tuple[dict[str, float], dict[str, list[str]]]:
    sums: dict[str, float] = {}
    counts: dict[str, int] = {}
    reasons: dict[str, list[str]] = {}
    for item in db.list_news(day=day, limit=500):
        label = item.get("label")
        if label not in ("利好", "利空"):
            continue
        value = float(item.get("confidence") or 0) * (1 if label == "利好" else -1)
        codes = []
        for entity in item.get("entities") or []:
            if isinstance(entity, dict):
                code = normalize_stock_code(entity.get("code", ""))
                if code:
                    codes.append(code)
        for symbol in item.get("symbols") or []:
            code = normalize_stock_code(symbol)
            if code and not (code.isdigit() and len(code) == 6 and code[0] in ("1", "5")):
                codes.append(code)
        for code in dict.fromkeys(codes):
            sums[code] = sums.get(code, 0.0) + value
            counts[code] = counts.get(code, 0) + 1
            reasons.setdefault(code, []).append(f"{label} {float(item.get('confidence') or 0)*100:.0f}%：{item['title'][:55]}")
    scores = {code: max(-1.0, min(1.0, total / counts[code])) for code, total in sums.items()}
    return scores, reasons


def _etf_news(code: str, stock_scores: dict[str, float], stock_reasons: dict[str, list[str]]) -> tuple[float, list[str]]:
    report = db.conn().execute(
        "SELECT MAX(report_date) d FROM fund_stock_holdings WHERE fund_code=?", (code,)).fetchone()["d"]
    if not report:
        return 0.0, ["该 ETF 尚无已同步的十大重仓，新闻暴露记为 0"]
    rows = db.conn().execute(
        """SELECT stock_code, stock_name, MAX(weight) weight FROM fund_stock_holdings
           WHERE fund_code=? AND report_date=? GROUP BY stock_code, stock_name""", (code, report)).fetchall()
    score = 0.0
    hits = []
    for row in rows:
        s = stock_scores.get(row["stock_code"], 0.0)
        if s:
            score += s * float(row["weight"] or 0) / 100
            hits.append(f"{row['stock_name']} {float(row['weight']):.2f}% × 新闻情绪 {s:+.2f}")
    return max(-1.0, min(1.0, score)), ([f"按 {report} 十大重仓加权"] + hits[:3]) if hits else [f"{report} 十大重仓未命中当日公司新闻"]


def _last_sell_days(account_id: int) -> dict[str, str]:
    return {r["secid"]: r["d"] for r in db.conn().execute(
        """SELECT secid, MAX(trade_day) d FROM paper_trades
           WHERE account_id=? AND side='sell' GROUP BY secid""", (account_id,))}


async def generate_signals(account_id: int) -> dict:
    account = _account(account_id)
    watch = [dict(r) for r in db.conn().execute(
        "SELECT secid,code,name,kind FROM paper_watchlist WHERE account_id=?", (account_id,))]
    positions = [dict(r) for r in db.conn().execute(
        "SELECT * FROM paper_positions WHERE account_id=? AND shares>0", (account_id,))]
    known = {x["secid"] for x in watch}
    for p in positions:
        if p["secid"] not in known:
            watch.append({k: p[k] for k in ("secid", "code", "name", "kind")})
    if not watch:
        raise ValueError("观察池为空，请先加入股票或场内 ETF")

    sem = asyncio.Semaphore(6)
    markets, errors = [], []
    async with httpx.AsyncClient(timeout=httpx.Timeout(18.0, connect=8.0), trust_env=False) as client:
        async def fetch_one(item):
            async with sem:
                try:
                    markets.append(await _fetch_market(client, item))
                except Exception as exc:
                    errors.append(f"{item['name'] or item['code']}：{str(exc)[:90]}")
        await asyncio.gather(*(fetch_one(item) for item in watch))
    if not markets:
        raise ValueError("观察池行情全部获取失败")

    metrics = {m["secid"]: _market_metrics(m) for m in markets}
    momentum_pct = _percentile([(m["secid"], metrics[m["secid"]]["momentum20"]) for m in markets], True)
    gap_pct = _percentile([(m["secid"], metrics[m["secid"]]["gap20"]) for m in markets], True)
    vol_pct = _percentile([(m["secid"], metrics[m["secid"]]["volatility"]) for m in markets], False)
    stock_news, stock_news_reasons = _news_scores(db.today())
    rules = account["rules"]
    weight_sum = rules["news_weight"] + rules["factor_weight"] + rules["trend_weight"] or 1
    pos_by_secid = {p["secid"]: p for p in positions}
    signals = []
    for market in markets:
        secid, code = market["secid"], normalize_stock_code(market["code"]) or market["code"]
        factor_pct = (0.45 * momentum_pct[secid] + 0.35 * gap_pct[secid] + 0.20 * vol_pct[secid])
        factor_score = (1 - factor_pct) * 100
        if market["kind"] == "ETF":
            news_score, nreasons = _etf_news(market["code"], stock_news, stock_news_reasons)
        else:
            news_score = stock_news.get(code, 0.0)
            nreasons = stock_news_reasons.get(code, ["当日没有识别到该股票的直接新闻，情绪记为 0"])
        trend_score = metrics[secid]["trend_score"]
        composite = ((50 + news_score * 50) * rules["news_weight"] +
                     factor_score * rules["factor_weight"] + trend_score * rules["trend_weight"]) / weight_sum
        reasons = nreasons[:3] + [
            f"因子强度分位：前 {factor_pct*100:.1f}%（动量/均线偏离/低波动）",
            f"趋势 {trend_score:.1f}/100：价格相对 MA20/MA60 与 MA20 五日斜率",
        ]
        buy_ok = (news_score >= rules["news_threshold"] and factor_pct <= rules["factor_top_pct"] and
                  trend_score >= rules["trend_min"] and composite >= rules["composite_min"])
        decision = "拟买入" if buy_ok else "观察"
        p = pos_by_secid.get(secid)
        if p:
            loss = market["reference_price"] / p["avg_cost"] - 1 if p["avg_cost"] else 0
            peak_dd = market["reference_price"] / max(p["highest_price"], market["reference_price"]) - 1
            sell_reasons = []
            if news_score <= rules["sell_news_threshold"]:
                sell_reasons.append("新闻情绪触发退出阈值")
            if factor_pct >= rules["sell_factor_pct"]:
                sell_reasons.append("因子排名跌出保留区间")
            if trend_score <= rules["sell_trend_max"]:
                sell_reasons.append("趋势评分跌破退出阈值")
            if rules["stop_loss_pct"] and loss <= -rules["stop_loss_pct"]:
                sell_reasons.append("触发模拟止损")
            activated = p["highest_price"] >= p["avg_cost"] * (1 + rules["trail_activate_pct"])
            if activated and rules["trail_drawdown_pct"] and peak_dd <= -rules["trail_drawdown_pct"]:
                sell_reasons.append("触发模拟跟踪止盈")
            if sell_reasons:
                decision = "拟卖出"
                reasons = sell_reasons + reasons
        signals.append({**{k: market[k] for k in ("secid", "code", "name", "kind", "reference_price", "reference_day")},
                        "news_score": news_score, "factor_percentile": factor_pct,
                        "factor_score": factor_score, "trend_score": trend_score,
                        "composite_score": composite, "decision": decision, "reasons": reasons})

    total_asset = account["cash"] + sum(float(p.get("market_value") or p["shares"] * p["avg_cost"]) for p in positions)
    market_value = total_asset - account["cash"]
    available_by = {r["secid"]: int(r["n"] or 0) for r in db.conn().execute(
        """SELECT secid,SUM(remaining) n FROM paper_lots
           WHERE account_id=? AND buy_day<? AND remaining>0 GROUP BY secid""", (account_id, db.today()))}
    proposals = []
    # 先处理退出，T+1 不可用的部分不会生成虚假可成交清单。
    for signal in signals:
        if signal["decision"] != "拟卖出" or signal["secid"] not in pos_by_secid:
            continue
        shares = available_by.get(signal["secid"], 0)
        if shares >= 100:
            proposals.append({**signal, "side": "sell", "shares": shares,
                              "target_value": shares * signal["reference_price"]})
        else:
            signal["decision"] = "T+1锁定"
            signal["reasons"].insert(0, "今日买入批次尚不可卖出")

    held_count = len(positions)
    sell_secids = {p["secid"] for p in proposals if p["side"] == "sell"}
    last_sell = _last_sell_days(account_id)
    buying_power = min(account["cash"], max(0.0, total_asset * rules["max_total_pct"] - market_value))
    candidates = sorted((s for s in signals if s["decision"] == "拟买入"),
                        key=lambda s: s["composite_score"], reverse=True)
    buys = 0
    for signal in candidates:
        if buys >= rules["buy_top_n"] or buying_power <= 0:
            break
        existing = pos_by_secid.get(signal["secid"])
        if not existing and held_count - len(sell_secids) + buys >= rules["max_positions"]:
            signal["decision"] = "仓位上限"
            continue
        last = last_sell.get(signal["secid"])
        if last and (date.fromisoformat(db.today()) - date.fromisoformat(last)).days < rules["cooldown_days"]:
            signal["decision"] = "冷却期"
            continue
        current_value = float(existing.get("market_value") or 0) if existing else 0.0
        target = total_asset * rules["max_single_pct"]
        amount = min(max(0.0, target - current_value), buying_power)
        shares = math.floor(amount / signal["reference_price"] / 100) * 100
        if shares < 100:
            signal["decision"] = "资金不足"
            continue
        proposals.append({**signal, "side": "buy", "shares": shares,
                          "target_value": shares * signal["reference_price"]})
        buying_power -= shares * signal["reference_price"]
        buys += 1

    ts = db.now_iso()
    proposal_ids = []
    with db.write_tx() as c:
        c.execute("UPDATE paper_proposals SET status='superseded',status_message='重新生成信号' WHERE account_id=? AND status='pending'",
                  (account_id,))
        c.execute("DELETE FROM paper_signals WHERE account_id=? AND signal_day=?", (account_id, db.today()))
        for signal in signals:
            c.execute(
                """INSERT INTO paper_signals
                   (account_id,signal_day,secid,code,name,kind,reference_price,reference_day,news_score,
                    factor_percentile,factor_score,trend_score,composite_score,decision,reasons,created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (account_id, db.today(), signal["secid"], signal["code"], signal["name"], signal["kind"],
                 signal["reference_price"], signal["reference_day"], signal["news_score"],
                 signal["factor_percentile"], signal["factor_score"], signal["trend_score"],
                 signal["composite_score"], signal["decision"],
                 json.dumps(signal["reasons"], ensure_ascii=False), ts),
            )
        for proposal in proposals:
            cur = c.execute(
                """INSERT INTO paper_proposals
                   (account_id,signal_day,secid,code,name,kind,side,shares,reference_price,reference_day,target_value,
                    composite_score,news_score,factor_percentile,trend_score,reasons,status,created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending',?)""",
                (account_id, db.today(), proposal["secid"], proposal["code"], proposal["name"], proposal["kind"],
                 proposal["side"], proposal["shares"], proposal["reference_price"], proposal["reference_day"],
                 proposal["target_value"], proposal["composite_score"], proposal["news_score"],
                 proposal["factor_percentile"], proposal["trend_score"],
                 json.dumps(proposal["reasons"], ensure_ascii=False), ts),
            )
            proposal_ids.append(cur.lastrowid)

    executed = None
    if account["mode"] == "auto" and proposal_ids:
        executed = execute_proposals(account_id, proposal_ids, actor="模拟自动模式")
    return {"account_id": account_id, "signal_day": db.today(), "signals": len(signals),
            "proposals": len(proposal_ids), "auto_executed": executed,
            "errors": errors, "mode": account["mode"], "simulation_only": True,
            "detail": account_detail(account_id)}


def _fees(gross: float, side: str, kind: str, rules: dict, reference: float, price: float, shares: int) -> dict:
    commission = max(rules["commission_min"], gross * rules["commission_rate"]) if gross else 0.0
    stamp = gross * rules["stamp_tax_rate"] if side == "sell" and kind == "股票" else 0.0
    slippage = abs(price - reference) * shares
    return {"commission": commission, "stamp_tax": stamp, "slippage_cost": slippage,
            "total_fee": commission + stamp + slippage}


def execute_proposals(account_id: int, proposal_ids: list[int] | None = None, actor: str = "人工确认") -> dict:
    account = _account(account_id)
    rules = account["rules"]
    selected = {int(x) for x in (proposal_ids or []) if int(x) > 0}
    args: list[Any] = [account_id]
    sql = "SELECT * FROM paper_proposals WHERE account_id=? AND status='pending'"
    if selected:
        sql += " AND id IN (" + ",".join("?" for _ in selected) + ")"
        args.extend(sorted(selected))
    proposals = [dict(r) for r in db.conn().execute(sql + " ORDER BY CASE side WHEN 'sell' THEN 0 ELSE 1 END,id", args)]
    done, skipped = [], []
    with db.write_tx() as c:
        cash = float(c.execute("SELECT cash FROM paper_accounts WHERE id=?", (account_id,)).fetchone()["cash"])
        for p in proposals:
            shares = int(p["shares"])
            reference = float(p["reference_price"])
            price = reference * (1 + rules["slippage_rate"] if p["side"] == "buy" else 1 - rules["slippage_rate"])
            price = round(max(0.001, price), 4)
            if p["side"] == "sell":
                available = int(c.execute(
                    """SELECT COALESCE(SUM(remaining),0) n FROM paper_lots
                       WHERE account_id=? AND secid=? AND buy_day<? AND remaining>0""",
                    (account_id, p["secid"], db.today())).fetchone()["n"])
                shares = min(shares, available)
            shares = shares // 100 * 100
            if shares <= 0:
                c.execute("UPDATE paper_proposals SET status='skipped',status_message=? WHERE id=?",
                          ("T+1 可卖数量不足" if p["side"] == "sell" else "数量不足一手", p["id"]))
                skipped.append({"id": p["id"], "message": "无可执行数量"})
                continue
            gross = price * shares
            fees = _fees(gross, p["side"], p["kind"], rules, reference, price, shares)
            if p["side"] == "buy":
                need = gross + fees["commission"]
                if need > cash:
                    shares = math.floor((cash - rules["commission_min"]) / price / 100) * 100
                    if shares <= 0:
                        c.execute("UPDATE paper_proposals SET status='skipped',status_message='模拟现金不足' WHERE id=?", (p["id"],))
                        skipped.append({"id": p["id"], "message": "模拟现金不足"})
                        continue
                    gross = price * shares
                    fees = _fees(gross, p["side"], p["kind"], rules, reference, price, shares)
                    need = gross + fees["commission"]
                cash -= need
                lot_cost = need / shares
                c.execute(
                    """INSERT INTO paper_lots (account_id,secid,buy_day,shares,remaining,cost_price,created_at)
                       VALUES (?,?,?,?,?,?,?)""",
                    (account_id, p["secid"], db.today(), shares, shares, lot_cost, db.now_iso()),
                )
                old = c.execute("SELECT * FROM paper_positions WHERE account_id=? AND secid=?",
                                (account_id, p["secid"])).fetchone()
                old_shares = int(old["shares"]) if old else 0
                old_cost = float(old["avg_cost"]) * old_shares if old else 0.0
                new_shares = old_shares + shares
                avg_cost = (old_cost + need) / new_shares
                highest = max(float(old["highest_price"] or 0) if old else 0, price)
                c.execute(
                    """INSERT INTO paper_positions
                       (account_id,secid,code,name,kind,shares,avg_cost,last_price,market_value,unrealized_pnl,highest_price,updated_at)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                       ON CONFLICT(account_id,secid) DO UPDATE SET shares=excluded.shares,avg_cost=excluded.avg_cost,
                         last_price=excluded.last_price,market_value=excluded.market_value,
                         unrealized_pnl=excluded.unrealized_pnl,highest_price=excluded.highest_price,updated_at=excluded.updated_at""",
                    (account_id, p["secid"], p["code"], p["name"], p["kind"], new_shares, avg_cost, price,
                     new_shares * price, new_shares * (price - avg_cost), highest, db.now_iso()),
                )
                realized = 0.0
            else:
                left, cost_basis = shares, 0.0
                lots = c.execute(
                    """SELECT * FROM paper_lots WHERE account_id=? AND secid=? AND buy_day<? AND remaining>0
                       ORDER BY buy_day,id""", (account_id, p["secid"], db.today())).fetchall()
                for lot in lots:
                    take = min(left, int(lot["remaining"]))
                    if not take:
                        continue
                    cost_basis += take * float(lot["cost_price"])
                    c.execute("UPDATE paper_lots SET remaining=remaining-? WHERE id=?", (take, lot["id"]))
                    left -= take
                    if not left:
                        break
                proceeds = gross - fees["commission"] - fees["stamp_tax"]
                cash += proceeds
                realized = proceeds - cost_basis
                remaining = c.execute(
                    """SELECT COALESCE(SUM(remaining),0) n,COALESCE(SUM(remaining*cost_price),0) cost
                       FROM paper_lots WHERE account_id=? AND secid=? AND remaining>0""",
                    (account_id, p["secid"])).fetchone()
                remain_shares = int(remaining["n"])
                if remain_shares:
                    avg_cost = float(remaining["cost"]) / remain_shares
                    c.execute(
                        """UPDATE paper_positions SET shares=?,avg_cost=?,last_price=?,market_value=?,
                           unrealized_pnl=?,updated_at=? WHERE account_id=? AND secid=?""",
                        (remain_shares, avg_cost, price, remain_shares * price,
                         remain_shares * (price - avg_cost), db.now_iso(), account_id, p["secid"]),
                    )
                else:
                    c.execute("DELETE FROM paper_positions WHERE account_id=? AND secid=?", (account_id, p["secid"]))
            reason = "；".join(_json(p.get("reasons"), [])[:4])
            c.execute(
                """INSERT INTO paper_trades
                   (account_id,proposal_id,trade_day,secid,code,name,kind,side,shares,reference_price,price,gross_amount,
                    commission,slippage_cost,stamp_tax,total_fee,realized_pnl,reason,created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (account_id, p["id"], db.today(), p["secid"], p["code"], p["name"], p["kind"], p["side"],
                 shares, reference, price, gross, fees["commission"], fees["slippage_cost"], fees["stamp_tax"],
                 fees["total_fee"], realized, reason, db.now_iso()),
            )
            c.execute("UPDATE paper_proposals SET status='executed',status_message=?,executed_at=? WHERE id=?",
                      (actor + "（模拟盘）", db.now_iso(), p["id"]))
            done.append({"id": p["id"], "side": p["side"], "code": p["code"], "shares": shares,
                         "price": price, "total_fee": fees["total_fee"], "realized_pnl": realized})
        c.execute("UPDATE paper_accounts SET cash=?,updated_at=? WHERE id=?", (cash, db.now_iso(), account_id))
    return {"executed": done, "skipped": skipped, "cash": cash,
            "simulation_only": True, "warning": "仅为假钱模拟成交，未向任何券商发送订单。"}


def reject_proposals(account_id: int, proposal_ids: list[int] | None = None) -> int:
    _account(account_id)
    selected = [int(x) for x in (proposal_ids or []) if int(x) > 0]
    with db.write_tx() as c:
        if selected:
            sql = "UPDATE paper_proposals SET status='rejected',status_message='人工拒绝' WHERE account_id=? AND status='pending' AND id IN (" + ",".join("?" for _ in selected) + ")"
            cur = c.execute(sql, [account_id, *selected])
        else:
            cur = c.execute("UPDATE paper_proposals SET status='rejected',status_message='人工拒绝' WHERE account_id=? AND status='pending'", (account_id,))
    return cur.rowcount


async def refresh_account(account_id: int) -> dict:
    account = _account(account_id)
    positions = [dict(r) for r in db.conn().execute(
        "SELECT * FROM paper_positions WHERE account_id=? AND shares>0", (account_id,))]
    targets = [{"secid": p["secid"], "position": p} for p in positions]
    targets.append({"secid": account["benchmark_secid"], "benchmark": True})
    prices: dict[str, tuple[float, str]] = {}
    async with httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=7.0), trust_env=False) as client:
        async def one(target):
            try:
                series = await _fetch_series(client, target["secid"], 0, 8)
                prices[target["secid"]] = (series["close"][-1], series["dates"][-1])
            except Exception:
                pass
        await asyncio.gather(*(one(t) for t in targets))
    market_value = 0.0
    with db.write_tx() as c:
        for p in positions:
            price = prices.get(p["secid"], (float(p["last_price"] or p["avg_cost"]), ""))[0]
            market = price * p["shares"]
            market_value += market
            highest = max(float(p["highest_price"] or 0), price)
            c.execute(
                """UPDATE paper_positions SET last_price=?,market_value=?,unrealized_pnl=?,highest_price=?,updated_at=?
                   WHERE account_id=? AND secid=?""",
                (price, market, market - p["avg_cost"] * p["shares"], highest, db.now_iso(), account_id, p["secid"]),
            )
        cash = float(c.execute("SELECT cash FROM paper_accounts WHERE id=?", (account_id,)).fetchone()["cash"])
        total = cash + market_value
        benchmark_close = prices.get(account["benchmark_secid"], (0.0, ""))[0]
        first = c.execute(
            """SELECT benchmark_close FROM paper_equity WHERE account_id=? AND benchmark_close>0
               ORDER BY day LIMIT 1""", (account_id,)).fetchone()
        base_close = float(first["benchmark_close"]) if first else benchmark_close
        benchmark_value = account["initial_cash"] * benchmark_close / base_close if benchmark_close and base_close else account["initial_cash"]
        c.execute(
            """INSERT INTO paper_equity
               (account_id,day,total_asset,cash,market_value,benchmark_close,benchmark_value,created_at)
               VALUES (?,?,?,?,?,?,?,?)
               ON CONFLICT(account_id,day) DO UPDATE SET total_asset=excluded.total_asset,cash=excluded.cash,
                 market_value=excluded.market_value,benchmark_close=excluded.benchmark_close,
                 benchmark_value=excluded.benchmark_value,created_at=excluded.created_at""",
            (account_id, db.today(), total, cash, market_value, benchmark_close, benchmark_value, db.now_iso()),
        )
    return {"account_id": account_id, "day": db.today(), "total_asset": total, "cash": cash,
            "market_value": market_value, "benchmark_value": benchmark_value,
            "simulation_only": True}


def _curve_metrics(points: list[dict], initial_cash: float) -> dict:
    values = [float(p["total_asset"]) for p in points]
    if not values:
        return {"total_return": 0, "max_drawdown": 0, "sharpe": 0}
    peak, mdd = values[0], 0.0
    for value in values:
        peak = max(peak, value)
        if peak:
            mdd = min(mdd, value / peak - 1)
    returns = [values[i] / values[i - 1] - 1 for i in range(1, len(values)) if values[i - 1]]
    sharpe = 0.0
    if len(returns) > 1:
        sd = statistics.pstdev(returns)
        if sd:
            sharpe = _mean(returns) / sd * math.sqrt(243)
    benchmark = [float(p["benchmark_value"]) for p in points]
    return {"total_return": values[-1] / initial_cash - 1 if initial_cash else 0,
            "max_drawdown": mdd, "sharpe": sharpe,
            "benchmark_return": benchmark[-1] / benchmark[0] - 1 if benchmark and benchmark[0] else 0}


async def wealth_all(refresh: bool = True) -> dict:
    accounts = list_accounts()
    if refresh:
        for account in accounts:
            try:
                await refresh_account(account["id"])
            except Exception:
                pass
        accounts = list_accounts()
    items = []
    for account in accounts:
        points = [dict(r) for r in db.conn().execute(
            "SELECT * FROM paper_equity WHERE account_id=? ORDER BY day", (account["id"],))]
        metrics = _curve_metrics(points, account["initial_cash"])
        items.append({"id": account["id"], "name": account["name"], "mode": account["mode"],
                      "initial_cash": account["initial_cash"], "total_asset": account["total_asset"],
                      "cash": account["cash"], "position_count": account["position_count"],
                      **metrics,
                      "curve": [{"day": p["day"], "value": p["total_asset"],
                                 "benchmark": p["benchmark_value"]} for p in points]})
    return {"items": items, "simulation_only": True,
            "warning": "我的财富仅统计虚拟账户假钱，不包含任何真实资产。"}


async def daily_cycle() -> dict:
    results = []
    for account in list_accounts():
        try:
            await refresh_account(account["id"])
            generated = await generate_signals(account["id"])
            if generated.get("auto_executed"):
                await refresh_account(account["id"])
            results.append({"account_id": account["id"], "ok": True,
                            "proposals": generated["proposals"], "mode": account["mode"]})
        except Exception as exc:
            results.append({"account_id": account["id"], "ok": False, "error": str(exc)[:160]})
    return {"day": db.today(), "accounts": results, "simulation_only": True}
