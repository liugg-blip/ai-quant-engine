import asyncio
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path


TEST_DATA = tempfile.TemporaryDirectory(prefix="qe-tests-")
ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "server"
sys.path.insert(0, str(SERVER))
os.environ["QE_DATA_DIR"] = TEST_DATA.name
os.environ["CRAWL_ON_START"] = "0"
os.environ["CRAWL_INTERVAL_MIN"] = "0"
os.environ["LLM_API_KEY"] = ""

import db  # noqa: E402
import advice  # noqa: E402
import paper_engine  # noqa: E402
from agent_tools import AgentTools, required_tools_for  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
import main  # noqa: E402
import llm  # noqa: E402


class QuantEngineRegressions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        db.init()

    @classmethod
    def tearDownClass(cls):
        if db._conn is not None:
            db._conn.close()
            db._conn = None
        TEST_DATA.cleanup()

    def test_local_api_requires_launcher_token(self):
        with TestClient(main.app) as client:
            public = client.get("/api/health")
            self.assertEqual(public.status_code, 200)
            self.assertFalse(public.json()["authenticated"])
            self.assertNotIn("counts", public.json())
            self.assertEqual(client.get("/api/holdings").status_code, 401)
            private = client.get("/api/holdings", headers={"X-QE-Token": main.SESSION_TOKEN})
            self.assertEqual(private.status_code, 200)
            self.assertEqual(client.post("/api/wechat/chat", json={"messages": []}).status_code, 401)
            preflight = client.options("/api/holdings", headers={
                "Origin": "https://attacker.example",
                "Access-Control-Request-Method": "GET",
            })
            self.assertNotEqual(preflight.headers.get("access-control-allow-origin"), "https://attacker.example")

    def test_session_token_is_stable(self):
        self.assertGreaterEqual(len(main.SESSION_TOKEN), 32)
        self.assertEqual(main.SESSION_TOKEN, main._load_or_create_session_token())
        self.assertEqual(main.SESSION_TOKEN_PATH.read_text(encoding="ascii").strip(), main.SESSION_TOKEN)

    def test_news_cross_source_dedup(self):
        day = "2026-08-21"
        items = [
            {"uid": "dedup-a", "source": "甲", "title": "某公司业绩增长！", "day": day,
             "published_at": day + "T09:00:00+08:00"},
            {"uid": "dedup-b", "source": "乙", "title": "某公司业绩增长", "day": day,
             "published_at": day + "T09:01:00+08:00"},
        ]
        self.assertEqual(db.save_news(items), 1)
        rows = db.conn().execute("SELECT uid FROM news WHERE uid LIKE 'dedup-%'").fetchall()
        self.assertEqual(len(rows), 1)

    def test_all_paper_children_reject_unknown_account(self):
        cases = {
            "paper_watchlist": "INSERT INTO paper_watchlist(account_id,secid,code,name,kind,created_at) VALUES(999,'1.X','X','','股票','x')",
            "paper_positions": "INSERT INTO paper_positions(account_id,secid,code,name,kind,shares,avg_cost,last_price,market_value,unrealized_pnl,highest_price,updated_at) VALUES(999,'1.X','X','','股票',0,0,0,0,0,0,'x')",
            "paper_lots": "INSERT INTO paper_lots(account_id,secid,buy_day,shares,remaining,cost_price,created_at) VALUES(999,'1.X','2026-08-21',100,100,1,'x')",
            "paper_signals": "INSERT INTO paper_signals(account_id,signal_day,secid,code,created_at) VALUES(999,'2026-08-21','1.X','X','x')",
            "paper_proposals": "INSERT INTO paper_proposals(account_id,signal_day,secid,code,side,shares,reference_price,created_at) VALUES(999,'2026-08-21','1.X','X','buy',100,1,'x')",
            "paper_trades": "INSERT INTO paper_trades(account_id,trade_day,secid,code,side,shares,reference_price,price,gross_amount,created_at) VALUES(999,'2026-08-21','1.X','X','buy',100,1,1,100,'x')",
            "paper_equity": "INSERT INTO paper_equity(account_id,day,total_asset,cash,market_value,created_at) VALUES(999,'2026-08-21',1,1,0,'x')",
            "order_intents": "INSERT INTO order_intents(intent_id,account_alias,paper_account_id,paper_proposal_id,secid,code,market,kind,side,quantity,reference_price,expires_at,created_at) VALUES('bad','x',999,999,'1.X','X','A股','股票','buy',100,1,'x','x')",
        }
        for table, sql in cases.items():
            with self.subTest(table=table), self.assertRaises(sqlite3.IntegrityError):
                db.conn().execute(sql)
        db.conn().rollback()

    def test_trade_proposal_must_belong_to_same_account(self):
        a1 = paper_engine.create_account("成交归属甲", 100000, "safe")["id"]
        a2 = paper_engine.create_account("成交归属乙", 100000, "safe")["id"]
        with db.write_tx() as c:
            proposal = c.execute(
                "INSERT INTO paper_proposals(account_id,signal_day,secid,code,side,shares,reference_price,created_at) VALUES(?,?,?,?,?,?,?,?)",
                (a1, "2026-08-21", "1.X", "X", "buy", 100, 1, "x"),
            ).lastrowid
        with self.assertRaises(sqlite3.IntegrityError):
            db.conn().execute(
                "INSERT INTO paper_trades(account_id,proposal_id,trade_day,secid,code,side,shares,reference_price,price,gross_amount,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                (a2, proposal, "2026-08-21", "1.X", "X", "buy", 100, 1, 1, 100, "x"),
            )
        db.conn().rollback()

    def test_current_instrument_is_bound_to_frontend_context(self):
        context = {"instrument": {"secid": "OF.025833", "code": "025833", "name": "天弘基金"}}
        tools = AgentTools(context, "读取当前标的走势和新闻")
        self.assertIn("get_market_snapshot", required_tools_for(tools.question))
        self.assertEqual(tools.required_args("get_market_snapshot"), {"secid": "OF.025833", "code": "025833"})

    def test_proposal_waits_for_next_market_open(self):
        account = paper_engine.create_account("次日成交测试", 100000, "safe")
        aid = account["id"]
        with db.write_tx() as c:
            cur = c.execute(
                """INSERT INTO paper_proposals
                   (account_id,signal_day,secid,code,name,kind,side,shares,reference_price,reference_day,
                    target_value,composite_score,news_score,factor_percentile,trend_score,reasons,status,created_at)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (aid, "2026-08-20", "1.510300", "510300", "沪深300ETF", "ETF", "buy", 100,
                 4.0, "2026-08-20", 400, 80, 0.5, 0.1, 70, "[]", "pending", db.now_iso()),
            )
            proposal_id = cur.lastrowid
            payload = {"dates": ["2026-08-20"], "open": [4.0], "close": [4.0]}
            c.execute("INSERT OR REPLACE INTO paper_market_cache(secid,fqt,payload,asof_day,updated_at) VALUES(?,?,?,?,?)",
                      ("1.510300", 0, json.dumps(payload), "2026-08-20", db.now_iso()))
        waiting = paper_engine.execute_proposals(aid, [proposal_id])
        self.assertFalse(waiting["executed"])
        status = db.conn().execute("SELECT status FROM paper_proposals WHERE id=?", (proposal_id,)).fetchone()["status"]
        self.assertEqual(status, "pending")

        payload = {"dates": ["2026-08-20", "2026-08-21"], "open": [4.0, 4.2], "close": [4.0, 4.25]}
        with db.write_tx() as c:
            c.execute("UPDATE paper_market_cache SET payload=?,asof_day=?,updated_at=? WHERE secid=? AND fqt=0",
                      (json.dumps(payload), "2026-08-21", db.now_iso(), "1.510300"))
        result = paper_engine.execute_proposals(aid, [proposal_id])
        self.assertEqual(len(result["executed"]), 1)
        trade = db.conn().execute("SELECT trade_day,reference_price FROM paper_trades WHERE proposal_id=?", (proposal_id,)).fetchone()
        self.assertEqual(trade["trade_day"], "2026-08-21")
        self.assertAlmostEqual(trade["reference_price"], 4.2)

    def test_refresh_never_backdates_equity_curve(self):
        account = paper_engine.create_account("倒签保护测试", 100000, "safe")
        aid = account["id"]
        original = paper_engine._fetch_series

        async def stale(*_args, **_kwargs):
            return {"dates": ["2026-08-19", "2026-08-20"], "open": [4.0, 4.1],
                    "close": [4.0, 4.1], "volume": [1, 1]}

        paper_engine._fetch_series = stale
        try:
            result = asyncio.run(paper_engine.refresh_account(aid))
        finally:
            paper_engine._fetch_series = original
        self.assertTrue(result["fresh"])
        self.assertFalse(result["equity_written"])
        days = [r["day"] for r in db.conn().execute(
            "SELECT day FROM paper_equity WHERE account_id=? ORDER BY day", (aid,))]
        self.assertEqual(days, [db.today()])

    def test_directional_advice_requires_two_traceable_news_items(self):
        day = "2026-08-18"
        db.save_news([{"uid": "advice-one", "source": "测试源", "title": "单条利好", "day": day,
                       "published_at": day + "T10:00:00+08:00"}])
        db.save_sentiment([{"uid": "advice-one", "label": "利好", "confidence": 0.9,
                            "sectors": ["半导体"], "symbols": ["000001"], "reason": "测试"}], "test")
        original = advice.chat_json

        async def fake_chat(*_args, **_kwargs):
            return {"market_summary": "测试", "risk_note": "测试", "items": [
                {"secid": "1.510300", "action": "加仓", "confidence": 0.9,
                 "rationale": "只有一条依据", "evidence": [0]},
            ]}

        advice.chat_json = fake_chat
        try:
            result = asyncio.run(advice.generate(day, [{"secid": "1.510300", "name": "沪深300ETF", "kind": "基金"}]))
        finally:
            advice.chat_json = original
        self.assertEqual(result["items"][0]["action"], "持有")
        self.assertLessEqual(result["items"][0]["confidence"], 0.35)

    def test_every_tool_call_receives_a_matching_tool_message(self):
        requests = []

        class FakeResponse:
            status_code = 200
            text = ""

            def __init__(self, payload):
                self.payload = payload

            def json(self):
                return self.payload

        class FakeClient:
            def __init__(self, *_args, **_kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return False

            async def post(self, _url, **kwargs):
                requests.append(kwargs["json"])
                if len(requests) == 1:
                    return FakeResponse({"choices": [{"message": {"content": "", "tool_calls": [
                        {"id": "good", "function": {"name": "market", "arguments": "{}"}},
                        {"id": "bad", "function": {"name": "market", "arguments": "not-json"}},
                    ]}}]})
                return FakeResponse({"choices": [{"message": {"content": "已基于工具结果回答"}}]})

        original_client = llm.httpx.AsyncClient
        original_enabled = llm.LLM_ENABLED
        original_provider = llm.LLM_PROVIDER
        llm.httpx.AsyncClient = FakeClient
        llm.LLM_ENABLED = True
        llm.LLM_PROVIDER = "deepseek"

        async def execute(_name, _args):
            return {"ok": True}

        try:
            reply, trace = asyncio.run(llm.chat_with_tools(
                "system", [{"role": "user", "content": "test"}],
                [{"type": "function", "function": {"name": "market", "parameters": {"type": "object"}}}],
                execute,
            ))
        finally:
            llm.httpx.AsyncClient = original_client
            llm.LLM_ENABLED = original_enabled
            llm.LLM_PROVIDER = original_provider

        self.assertEqual(reply, "已基于工具结果回答")
        tool_messages = [m for m in requests[1]["messages"] if m.get("role") == "tool"]
        self.assertEqual([m["tool_call_id"] for m in tool_messages], ["good", "bad"])
        self.assertTrue(any(event["status"] == "error" for event in trace))


if __name__ == "__main__":
    unittest.main(verbosity=2)
