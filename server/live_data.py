"""实盘数据只读层与订单意图数据包。

本模块不导入券商 SDK，不保存凭证，也没有下单、撤单或登录函数。
它只接受用户主动导入的脱敏账户快照，并把模拟盘拟交易转换成待复核 JSON 数据。
"""
from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, timedelta
from typing import Any

import db


EXECUTION_ENABLED = False
WARNING = "实盘数据只读；订单意图不会被提交到券商，不会操作真实资金。"
_SENSITIVE_PARTS = ("password", "passwd", "token", "secret", "api_key", "apikey", "private_key", "credential")


def _number(value: Any, field: str, minimum: float = 0.0) -> float:
    try:
        result = float(value or 0)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field} 必须是数字") from exc
    if not math.isfinite(result) or result < minimum or result > 1_000_000_000_000:
        raise ValueError(f"{field} 超出允许范围")
    return result


def _signed_number(value: Any, field: str) -> float:
    try:
        result = float(value or 0)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field} 必须是数字") from exc
    if not math.isfinite(result) or abs(result) > 1_000_000_000_000:
        raise ValueError(f"{field} 超出允许范围")
    return result


def _assert_no_secrets(value: Any, path: str = "root") -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            lowered = str(key).lower()
            if any(part in lowered for part in _SENSITIVE_PARTS):
                raise ValueError(f"导入数据包含禁止保存的敏感字段：{path}.{key}")
            _assert_no_secrets(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _assert_no_secrets(child, f"{path}[{index}]")


def _text(value: Any, limit: int = 80) -> str:
    return str(value or "").strip()[:limit]


def _position(item: dict) -> dict:
    quantity = int(_number(item.get("quantity"), "持仓数量"))
    available = min(quantity, int(_number(item.get("available", quantity), "可用数量")))
    return {
        "code": _text(item.get("code"), 24),
        "name": _text(item.get("name"), 50),
        "market": _text(item.get("market"), 16),
        "quantity": quantity,
        "available": available,
        "cost": _number(item.get("cost"), "持仓成本"),
        "price": _number(item.get("price"), "最新价格"),
        "market_value": _number(item.get("market_value"), "持仓市值"),
        "pnl": _signed_number(item.get("pnl"), "浮动盈亏"),
    }


def _record(item: dict) -> dict:
    return {
        "id": _text(item.get("id"), 64),
        "time": _text(item.get("time"), 40),
        "code": _text(item.get("code"), 24),
        "name": _text(item.get("name"), 50),
        "side": _text(item.get("side"), 12),
        "quantity": int(_number(item.get("quantity"), "数量")),
        "price": _number(item.get("price"), "价格"),
        "status": _text(item.get("status"), 30),
    }


def import_snapshot(body: dict) -> dict:
    if body.get("confirmation") != "READ_ONLY_IMPORT":
        raise ValueError("缺少只读导入确认标记")
    _assert_no_secrets(body)
    raw_size = len(json.dumps(body, ensure_ascii=False).encode("utf-8"))
    if raw_size > 2_000_000:
        raise ValueError("快照超过 2MB，请减少历史委托或成交记录")
    alias = _text(body.get("account_alias"), 40)
    if not alias:
        raise ValueError("请使用账户别名，禁止填写真实资金账号")
    positions = [_position(x) for x in (body.get("positions") or [])[:500] if isinstance(x, dict)]
    orders = [_record(x) for x in (body.get("orders") or [])[:500] if isinstance(x, dict)]
    trades = [_record(x) for x in (body.get("trades") or [])[:500] if isinstance(x, dict)]
    snapshot = {
        "account_alias": alias,
        "asof": _text(body.get("asof") or db.now_iso(), 40),
        "source": _text(body.get("source") or "本地只读导入", 50),
        "total_asset": _number(body.get("total_asset"), "总资产"),
        "cash": _number(body.get("cash"), "现金"),
        "available_cash": _number(body.get("available_cash"), "可用现金"),
        "market_value": _number(body.get("market_value"), "持仓市值"),
        "positions": positions,
        "orders": orders,
        "trades": trades,
    }
    with db.write_tx() as c:
        cur = c.execute(
            """INSERT INTO live_snapshots
               (account_alias,asof,source,total_asset,cash,available_cash,market_value,
                positions,orders,trades,imported_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (alias, snapshot["asof"], snapshot["source"], snapshot["total_asset"], snapshot["cash"],
             snapshot["available_cash"], snapshot["market_value"],
             json.dumps(positions, ensure_ascii=False), json.dumps(orders, ensure_ascii=False),
             json.dumps(trades, ensure_ascii=False), db.now_iso()),
        )
    return {"id": cur.lastrowid, **snapshot, "execution_enabled": EXECUTION_ENABLED, "warning": WARNING}


def latest_snapshot(account_alias: str = "") -> dict | None:
    args: list[Any] = []
    where = ""
    if account_alias:
        where = "WHERE account_alias=?"
        args.append(account_alias)
    row = db.conn().execute(
        f"SELECT * FROM live_snapshots {where} ORDER BY id DESC LIMIT 1", args
    ).fetchone()
    if not row:
        return None
    result = dict(row)
    for field in ("positions", "orders", "trades"):
        result[field] = json.loads(result[field] or "[]")
    result.update({"execution_enabled": EXECUTION_ENABLED, "warning": WARNING})
    return result


def _market(secid: str) -> str:
    if secid.startswith("1."):
        return "上海"
    if secid.startswith("0."):
        return "深圳"
    return "未知"


def create_intents(paper_account_id: int, account_alias: str, proposal_ids: list[int] | None = None) -> dict:
    alias = _text(account_alias, 40)
    if not alias:
        raise ValueError("请填写只读账户别名")
    account = db.conn().execute(
        "SELECT id,name FROM paper_accounts WHERE id=? AND active=1", (paper_account_id,)
    ).fetchone()
    if not account:
        raise ValueError("模拟账户不存在")
    ids = sorted({int(x) for x in (proposal_ids or []) if int(x) > 0})
    args: list[Any] = [paper_account_id]
    sql = "SELECT * FROM paper_proposals WHERE account_id=? AND status='pending'"
    if ids:
        sql += " AND id IN (" + ",".join("?" for _ in ids) + ")"
        args.extend(ids)
    rows = [dict(r) for r in db.conn().execute(sql + " ORDER BY id", args)]
    created, existing = [], []
    expires = (datetime.fromisoformat(db.now_iso()) + timedelta(hours=8)).isoformat(timespec="seconds")
    with db.write_tx() as c:
        for row in rows:
            stable = f"{paper_account_id}:{row['id']}:{row['signal_day']}"
            intent_id = "OI-" + hashlib.sha256(stable.encode()).hexdigest()[:20].upper()
            signal = {
                "signal_day": row["signal_day"],
                "composite_score": row["composite_score"],
                "news_score": row["news_score"],
                "factor_percentile": row["factor_percentile"],
                "trend_score": row["trend_score"],
                "reasons": json.loads(row["reasons"] or "[]"),
                "source": "量化引擎模拟盘拟交易",
            }
            cur = c.execute(
                """INSERT OR IGNORE INTO order_intents
                   (intent_id,account_alias,paper_account_id,paper_proposal_id,secid,code,name,market,kind,
                    side,quantity,reference_price,max_slippage,signal_snapshot,risk_status,status,expires_at,created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (intent_id, alias, paper_account_id, row["id"], row["secid"], row["code"], row["name"],
                 _market(row["secid"]), row["kind"], row["side"], int(row["shares"]),
                 float(row["reference_price"]), 0.005, json.dumps(signal, ensure_ascii=False),
                 "待人工复核", "draft", expires, db.now_iso()),
            )
            (created if cur.rowcount else existing).append(intent_id)
    return {"created": created, "existing": existing, "items": list_intents(alias),
            "execution_enabled": EXECUTION_ENABLED, "warning": WARNING}


def list_intents(account_alias: str = "", limit: int = 200) -> list[dict]:
    args: list[Any] = []
    where = ""
    if account_alias:
        where = "WHERE account_alias=?"
        args.append(account_alias)
    args.append(max(1, min(int(limit), 500)))
    rows = [dict(r) for r in db.conn().execute(
        f"SELECT * FROM order_intents {where} ORDER BY created_at DESC LIMIT ?", args
    )]
    for row in rows:
        row["signal_snapshot"] = json.loads(row["signal_snapshot"] or "{}")
        row["execution_enabled"] = EXECUTION_ENABLED
    return rows


def export_package(account_alias: str = "") -> dict:
    return {
        "schema": "quant-engine-order-intent/1.0",
        "generated_at": db.now_iso(),
        "execution_enabled": EXECUTION_ENABLED,
        "read_only": True,
        "warning": WARNING,
        "items": list_intents(account_alias, 500),
    }
