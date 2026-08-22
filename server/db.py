"""SQLite 持久化。单文件库，随服务一起放在 server/data/quant.db。

所有写操作都走短事务，读操作用 row_factory 返回 dict，方便直接 JSON 化。
FastAPI 是多线程跑的，所以连接用 check_same_thread=False + 一把全局写锁。
"""
import json
import calendar
import hashlib
import re
import sqlite3
import threading
from contextlib import contextmanager
from datetime import date, datetime, timezone, timedelta
from typing import Any, Iterable

from config import DB_PATH

CST = timezone(timedelta(hours=8))          # 全站按北京时间归"日"
_lock = threading.Lock()
_conn: sqlite3.Connection | None = None


def now_iso() -> str:
    return datetime.now(CST).isoformat(timespec="seconds")


def today() -> str:
    return datetime.now(CST).strftime("%Y-%m-%d")


def conn() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA foreign_keys=ON")
        _conn.execute("PRAGMA journal_mode=WAL")
        _conn.execute("PRAGMA synchronous=NORMAL")
    return _conn


SCHEMA = """
CREATE TABLE IF NOT EXISTS holdings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT NOT NULL,                -- 6位代码或美股代码
  secid      TEXT NOT NULL DEFAULT '',     -- 东财 secid，如 1.510300 / OF.110022 / 105.AAPL
  name       TEXT NOT NULL DEFAULT '',
  kind       TEXT NOT NULL DEFAULT '基金', -- 基金 | 股票
  shares     REAL NOT NULL DEFAULT 0,      -- 份额/股数
  cost       REAL NOT NULL DEFAULT 0,      -- 成本单价
  input_mode TEXT NOT NULL DEFAULT 'legacy', -- fund_amount | stock_shares | legacy
  invested_amount REAL NOT NULL DEFAULT 0, -- 基金投入金额；股票为成本总额
  entry_date TEXT NOT NULL DEFAULT '',     -- 买入日（基金必填）
  entry_price REAL NOT NULL DEFAULT 0,     -- 买入日净值/价格
  dca_enabled INTEGER NOT NULL DEFAULT 0,  -- 定投跟踪开关（不自动下单）
  dca_amount REAL NOT NULL DEFAULT 0,      -- 每期计划金额
  dca_frequency TEXT NOT NULL DEFAULT 'monthly', -- daily | weekly | biweekly | monthly
  dca_start_date TEXT NOT NULL DEFAULT '', -- 定投计划开始日
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(secid)
);

CREATE TABLE IF NOT EXISTS news (
  uid          TEXT PRIMARY KEY,           -- 源内唯一键的哈希，去重用
  source       TEXT NOT NULL,
  title        TEXT NOT NULL,
  url          TEXT NOT NULL DEFAULT '',
  summary      TEXT NOT NULL DEFAULT '',
  published_at TEXT NOT NULL DEFAULT '',
  day          TEXT NOT NULL,              -- 北京时间 YYYY-MM-DD
  content_key  TEXT NOT NULL DEFAULT '',   -- 跨来源标题指纹，用于同日去重
  fetched_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_news_day ON news(day);
CREATE INDEX IF NOT EXISTS idx_news_pub ON news(published_at DESC);

CREATE TABLE IF NOT EXISTS sentiment (
  uid        TEXT PRIMARY KEY REFERENCES news(uid) ON DELETE CASCADE,
  label      TEXT NOT NULL,                -- 利好 | 利空 | 中性
  confidence REAL NOT NULL DEFAULT 0,
  sectors    TEXT NOT NULL DEFAULT '[]',
  symbols    TEXT NOT NULL DEFAULT '[]',
  entities   TEXT NOT NULL DEFAULT '[]',   -- [{name, code, market}] 具体公司/股票实体
  reason     TEXT NOT NULL DEFAULT '',
  model      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fund_profiles (
  fund_code         TEXT PRIMARY KEY,
  fund_name         TEXT NOT NULL DEFAULT '',
  secid             TEXT NOT NULL DEFAULT '',
  is_held           INTEGER NOT NULL DEFAULT 0,
  is_etf            INTEGER NOT NULL DEFAULT 0,
  latest_report_date TEXT NOT NULL DEFAULT '',
  sources           TEXT NOT NULL DEFAULT '[]',
  last_sync_at      TEXT NOT NULL DEFAULT '',
  sync_error        TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_fund_profiles_priority
  ON fund_profiles(is_held DESC, is_etf DESC, last_sync_at);

CREATE TABLE IF NOT EXISTS fund_stock_holdings (
  fund_code  TEXT NOT NULL,
  stock_code TEXT NOT NULL,
  stock_name TEXT NOT NULL DEFAULT '',
  weight     REAL NOT NULL DEFAULT 0,
  report_date TEXT NOT NULL DEFAULT '',
  source     TEXT NOT NULL,
  source_url TEXT NOT NULL DEFAULT '',
  fetched_at TEXT NOT NULL,
  PRIMARY KEY(fund_code, stock_code, report_date, source),
  FOREIGN KEY(fund_code) REFERENCES fund_profiles(fund_code) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_fund_stock_code ON fund_stock_holdings(stock_code);
CREATE INDEX IF NOT EXISTS idx_fund_holding_fund ON fund_stock_holdings(fund_code, report_date DESC);

CREATE TABLE IF NOT EXISTS paper_accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  initial_cash  REAL NOT NULL,
  cash          REAL NOT NULL,
  mode          TEXT NOT NULL DEFAULT 'safe', -- safe | auto；两者均只使用假钱
  rules         TEXT NOT NULL DEFAULT '{}',
  benchmark_secid TEXT NOT NULL DEFAULT '1.510300',
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS paper_watchlist (
  account_id INTEGER NOT NULL,
  secid      TEXT NOT NULL,
  code       TEXT NOT NULL,
  name       TEXT NOT NULL DEFAULT '',
  kind       TEXT NOT NULL DEFAULT '股票', -- 股票 | ETF
  created_at TEXT NOT NULL,
  PRIMARY KEY(account_id, secid),
  FOREIGN KEY(account_id) REFERENCES paper_accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS paper_positions (
  account_id   INTEGER NOT NULL,
  secid        TEXT NOT NULL,
  code         TEXT NOT NULL,
  name         TEXT NOT NULL DEFAULT '',
  kind         TEXT NOT NULL DEFAULT '股票',
  shares       INTEGER NOT NULL DEFAULT 0,
  avg_cost     REAL NOT NULL DEFAULT 0,
  last_price   REAL NOT NULL DEFAULT 0,
  market_value REAL NOT NULL DEFAULT 0,
  unrealized_pnl REAL NOT NULL DEFAULT 0,
  highest_price REAL NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY(account_id, secid),
  FOREIGN KEY(account_id) REFERENCES paper_accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS paper_lots (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id  INTEGER NOT NULL,
  secid       TEXT NOT NULL,
  buy_day     TEXT NOT NULL,
  shares      INTEGER NOT NULL,
  remaining   INTEGER NOT NULL,
  cost_price  REAL NOT NULL,
  created_at  TEXT NOT NULL,
  FOREIGN KEY(account_id) REFERENCES paper_accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_paper_lots_available
  ON paper_lots(account_id, secid, buy_day, remaining);

CREATE TABLE IF NOT EXISTS paper_signals (
  account_id        INTEGER NOT NULL,
  signal_day        TEXT NOT NULL,
  secid             TEXT NOT NULL,
  code              TEXT NOT NULL,
  name              TEXT NOT NULL DEFAULT '',
  kind              TEXT NOT NULL DEFAULT '股票',
  reference_price   REAL NOT NULL DEFAULT 0,
  reference_day     TEXT NOT NULL DEFAULT '',
  news_score        REAL NOT NULL DEFAULT 0,
  factor_percentile REAL NOT NULL DEFAULT 1,
  factor_score      REAL NOT NULL DEFAULT 0,
  trend_score       REAL NOT NULL DEFAULT 0,
  composite_score   REAL NOT NULL DEFAULT 0,
  decision          TEXT NOT NULL DEFAULT '观察',
  reasons           TEXT NOT NULL DEFAULT '[]',
  created_at        TEXT NOT NULL,
  PRIMARY KEY(account_id, signal_day, secid),
  FOREIGN KEY(account_id) REFERENCES paper_accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_paper_signals_account
  ON paper_signals(account_id, signal_day DESC, composite_score DESC);

CREATE TABLE IF NOT EXISTS paper_proposals (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id       INTEGER NOT NULL,
  signal_day       TEXT NOT NULL,
  secid            TEXT NOT NULL,
  code             TEXT NOT NULL,
  name             TEXT NOT NULL DEFAULT '',
  kind             TEXT NOT NULL DEFAULT '股票',
  side             TEXT NOT NULL, -- buy | sell
  shares           INTEGER NOT NULL,
  reference_price  REAL NOT NULL,
  reference_day    TEXT NOT NULL DEFAULT '',
  target_value     REAL NOT NULL DEFAULT 0,
  composite_score  REAL NOT NULL DEFAULT 0,
  news_score       REAL NOT NULL DEFAULT 0,
  factor_percentile REAL NOT NULL DEFAULT 1,
  trend_score      REAL NOT NULL DEFAULT 0,
  reasons          TEXT NOT NULL DEFAULT '[]',
  status           TEXT NOT NULL DEFAULT 'pending', -- pending/executed/rejected/superseded/skipped
  status_message   TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL,
  executed_at      TEXT NOT NULL DEFAULT '',
  FOREIGN KEY(account_id) REFERENCES paper_accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_paper_proposals_account
  ON paper_proposals(account_id, signal_day DESC, status);

CREATE TABLE IF NOT EXISTS paper_trades (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id    INTEGER NOT NULL,
  proposal_id   INTEGER,
  trade_day     TEXT NOT NULL,
  secid         TEXT NOT NULL,
  code          TEXT NOT NULL,
  name          TEXT NOT NULL DEFAULT '',
  kind          TEXT NOT NULL DEFAULT '股票',
  side          TEXT NOT NULL,
  shares        INTEGER NOT NULL,
  reference_price REAL NOT NULL,
  price         REAL NOT NULL,
  gross_amount  REAL NOT NULL,
  commission    REAL NOT NULL DEFAULT 0,
  slippage_cost REAL NOT NULL DEFAULT 0,
  stamp_tax     REAL NOT NULL DEFAULT 0,
  total_fee     REAL NOT NULL DEFAULT 0,
  realized_pnl  REAL NOT NULL DEFAULT 0,
  reason        TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  FOREIGN KEY(account_id) REFERENCES paper_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY(proposal_id) REFERENCES paper_proposals(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_paper_trades_account
  ON paper_trades(account_id, trade_day DESC, id DESC);

CREATE TABLE IF NOT EXISTS paper_equity (
  account_id      INTEGER NOT NULL,
  day             TEXT NOT NULL,
  total_asset     REAL NOT NULL,
  cash            REAL NOT NULL,
  market_value    REAL NOT NULL,
  benchmark_close REAL NOT NULL DEFAULT 0,
  benchmark_value REAL NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  PRIMARY KEY(account_id, day),
  FOREIGN KEY(account_id) REFERENCES paper_accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_paper_equity_account ON paper_equity(account_id, day);

CREATE TABLE IF NOT EXISTS paper_market_cache (
  secid      TEXT NOT NULL,
  fqt        INTEGER NOT NULL,
  payload    TEXT NOT NULL,
  asof_day   TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY(secid, fqt)
);

-- 实盘数据只读区。这里只保存外部导入的脱敏快照，不保存券商凭证，也不具备委托能力。
CREATE TABLE IF NOT EXISTS live_snapshots (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  account_alias  TEXT NOT NULL,
  asof           TEXT NOT NULL,
  source         TEXT NOT NULL DEFAULT '本地只读导入',
  total_asset    REAL NOT NULL DEFAULT 0,
  cash           REAL NOT NULL DEFAULT 0,
  available_cash REAL NOT NULL DEFAULT 0,
  market_value   REAL NOT NULL DEFAULT 0,
  positions      TEXT NOT NULL DEFAULT '[]',
  orders         TEXT NOT NULL DEFAULT '[]',
  trades         TEXT NOT NULL DEFAULT '[]',
  imported_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_live_snapshots_alias
  ON live_snapshots(account_alias, id DESC);

-- 自动化下单“数据”只到订单意图为止。该表没有券商委托号或已提交状态。
CREATE TABLE IF NOT EXISTS order_intents (
  intent_id          TEXT PRIMARY KEY,
  account_alias      TEXT NOT NULL,
  paper_account_id   INTEGER NOT NULL,
  paper_proposal_id  INTEGER NOT NULL UNIQUE,
  secid              TEXT NOT NULL,
  code               TEXT NOT NULL,
  name               TEXT NOT NULL DEFAULT '',
  market             TEXT NOT NULL,
  kind               TEXT NOT NULL,
  side               TEXT NOT NULL,
  quantity           INTEGER NOT NULL,
  reference_price    REAL NOT NULL,
  max_slippage       REAL NOT NULL DEFAULT 0,
  signal_snapshot    TEXT NOT NULL DEFAULT '{}',
  risk_status        TEXT NOT NULL DEFAULT '待人工复核',
  status             TEXT NOT NULL DEFAULT 'draft',
  expires_at         TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  FOREIGN KEY(paper_account_id) REFERENCES paper_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY(paper_proposal_id) REFERENCES paper_proposals(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_order_intents_created
  ON order_intents(created_at DESC);

CREATE TABLE IF NOT EXISTS advice (
  day        TEXT PRIMARY KEY,
  payload    TEXT NOT NULL,
  model      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  role       TEXT NOT NULL,                -- user | assistant
  content    TEXT NOT NULL,
  context    TEXT NOT NULL DEFAULT '',     -- 当前标的与信号摘要，不保存整段行情
  model      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_messages_id ON agent_messages(id DESC);

CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
"""


def init() -> None:
    with _lock:
        conn().executescript(SCHEMA)
        # 旧版数据库原地加列，保留用户已经录入的持仓。
        existing = {r["name"] for r in conn().execute("PRAGMA table_info(holdings)")}
        additions = {
            "input_mode": "TEXT NOT NULL DEFAULT 'legacy'",
            "invested_amount": "REAL NOT NULL DEFAULT 0",
            "entry_date": "TEXT NOT NULL DEFAULT ''",
            "entry_price": "REAL NOT NULL DEFAULT 0",
            "dca_enabled": "INTEGER NOT NULL DEFAULT 0",
            "dca_amount": "REAL NOT NULL DEFAULT 0",
            "dca_frequency": "TEXT NOT NULL DEFAULT 'monthly'",
            "dca_start_date": "TEXT NOT NULL DEFAULT ''",
        }
        for name, spec in additions.items():
            if name not in existing:
                conn().execute(f"ALTER TABLE holdings ADD COLUMN {name} {spec}")
        sentiment_columns = {r["name"] for r in conn().execute("PRAGMA table_info(sentiment)")}
        if "entities" not in sentiment_columns:
            conn().execute("ALTER TABLE sentiment ADD COLUMN entities TEXT NOT NULL DEFAULT '[]'")
        news_columns = {r["name"] for r in conn().execute("PRAGMA table_info(news)")}
        if "content_key" not in news_columns:
            conn().execute("ALTER TABLE news ADD COLUMN content_key TEXT NOT NULL DEFAULT ''")
        rows = conn().execute(
            """SELECT n.uid,n.day,n.title,CASE WHEN s.uid IS NULL THEN 0 ELSE 1 END scored,n.published_at
               FROM news n LEFT JOIN sentiment s ON s.uid=n.uid
               ORDER BY n.day,scored DESC,n.published_at DESC"""
        ).fetchall()
        seen: set[tuple[str, str]] = set()
        for row in rows:
            key = _news_key(row["title"])
            pair = (row["day"], key)
            if key and pair in seen:
                conn().execute("DELETE FROM news WHERE uid=?", (row["uid"],))
                continue
            if key:
                seen.add(pair)
            conn().execute("UPDATE news SET content_key=? WHERE uid=?", (key, row["uid"]))
        conn().execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_news_day_content ON news(day,content_key) WHERE content_key<>''")
        # SQLite 不能给旧表原地追加 FOREIGN KEY。旧库用触发器补上等价的写入约束；
        # 新库则同时受上面的声明式外键保护。
        guarded = {
            "paper_watchlist": "account_id", "paper_positions": "account_id",
            "paper_lots": "account_id", "paper_signals": "account_id",
            "paper_proposals": "account_id", "paper_trades": "account_id",
            "paper_equity": "account_id", "order_intents": "paper_account_id",
        }
        for table, column in guarded.items():
            conn().executescript(f"""
              CREATE TRIGGER IF NOT EXISTS trg_{table}_account_insert
              BEFORE INSERT ON {table}
              WHEN NOT EXISTS(SELECT 1 FROM paper_accounts WHERE id=NEW.{column})
              BEGIN SELECT RAISE(ABORT, '模拟账户不存在'); END;
              CREATE TRIGGER IF NOT EXISTS trg_{table}_account_update
              BEFORE UPDATE OF {column} ON {table}
              WHEN NOT EXISTS(SELECT 1 FROM paper_accounts WHERE id=NEW.{column})
              BEGIN SELECT RAISE(ABORT, '模拟账户不存在'); END;
            """)
        conn().executescript("""
          CREATE TRIGGER IF NOT EXISTS trg_fund_stock_holdings_profile_insert
          BEFORE INSERT ON fund_stock_holdings
          WHEN NOT EXISTS(SELECT 1 FROM fund_profiles WHERE fund_code=NEW.fund_code)
          BEGIN SELECT RAISE(ABORT, '基金档案不存在'); END;
          CREATE TRIGGER IF NOT EXISTS trg_fund_stock_holdings_profile_update
          BEFORE UPDATE OF fund_code ON fund_stock_holdings
          WHEN NOT EXISTS(SELECT 1 FROM fund_profiles WHERE fund_code=NEW.fund_code)
          BEGIN SELECT RAISE(ABORT, '基金档案不存在'); END;
          CREATE TRIGGER IF NOT EXISTS trg_paper_trades_proposal_insert
          BEFORE INSERT ON paper_trades
          WHEN NEW.proposal_id IS NOT NULL AND NOT EXISTS(
            SELECT 1 FROM paper_proposals p WHERE p.id=NEW.proposal_id AND p.account_id=NEW.account_id)
          BEGIN SELECT RAISE(ABORT, '成交对应的拟交易不存在或不属于该账户'); END;
          CREATE TRIGGER IF NOT EXISTS trg_paper_trades_proposal_update
          BEFORE UPDATE OF proposal_id,account_id ON paper_trades
          WHEN NEW.proposal_id IS NOT NULL AND NOT EXISTS(
            SELECT 1 FROM paper_proposals p WHERE p.id=NEW.proposal_id AND p.account_id=NEW.account_id)
          BEGIN SELECT RAISE(ABORT, '成交对应的拟交易不存在或不属于该账户'); END;
          CREATE TRIGGER IF NOT EXISTS trg_order_intents_proposal_insert
          BEFORE INSERT ON order_intents
          WHEN NOT EXISTS(SELECT 1 FROM paper_proposals p
                          WHERE p.id=NEW.paper_proposal_id AND p.account_id=NEW.paper_account_id)
          BEGIN SELECT RAISE(ABORT, '拟交易不存在或不属于该账户'); END;
          CREATE TRIGGER IF NOT EXISTS trg_order_intents_proposal_update
          BEFORE UPDATE OF paper_proposal_id,paper_account_id ON order_intents
          WHEN NOT EXISTS(SELECT 1 FROM paper_proposals p
                          WHERE p.id=NEW.paper_proposal_id AND p.account_id=NEW.paper_account_id)
          BEGIN SELECT RAISE(ABORT, '拟交易不存在或不属于该账户'); END;
          CREATE TRIGGER IF NOT EXISTS trg_paper_accounts_legacy_cascade
          AFTER DELETE ON paper_accounts BEGIN
            DELETE FROM paper_watchlist WHERE account_id=OLD.id;
            DELETE FROM paper_positions WHERE account_id=OLD.id;
            DELETE FROM paper_lots WHERE account_id=OLD.id;
            DELETE FROM paper_signals WHERE account_id=OLD.id;
            DELETE FROM paper_trades WHERE account_id=OLD.id;
            DELETE FROM paper_equity WHERE account_id=OLD.id;
            DELETE FROM order_intents WHERE paper_account_id=OLD.id;
            DELETE FROM paper_proposals WHERE account_id=OLD.id;
          END;
          CREATE TRIGGER IF NOT EXISTS trg_paper_proposals_legacy_cascade
          AFTER DELETE ON paper_proposals BEGIN
            UPDATE paper_trades SET proposal_id=NULL WHERE proposal_id=OLD.id;
            DELETE FROM order_intents WHERE paper_proposal_id=OLD.id;
          END;
          CREATE TRIGGER IF NOT EXISTS trg_fund_profiles_legacy_cascade
          AFTER DELETE ON fund_profiles BEGIN
            DELETE FROM fund_stock_holdings WHERE fund_code=OLD.fund_code;
          END;
        """)
        # 旧版情绪记录可能只有方向没有板块，统一补齐，保证新闻明细可直接判断影响范围。
        conn().execute(
            "UPDATE sentiment SET sectors=? WHERE sectors IS NULL OR TRIM(sectors)='' OR sectors='[]'",
            ('["综合市场"]',),
        )
        conn().commit()


def _rows(cur) -> list[dict]:
    return [dict(r) for r in cur.fetchall()]


@contextmanager
def write_tx():
    """供模拟盘撮合使用的单写事务，防止确认按钮与定时任务同时修改虚拟现金。"""
    with _lock:
        c = conn()
        c.execute("BEGIN IMMEDIATE")
        try:
            yield c
            c.commit()
        except Exception:
            c.rollback()
            raise


# ---------------- 持仓 ----------------
def list_holdings() -> list[dict]:
    rows = _rows(conn().execute("SELECT * FROM holdings ORDER BY id"))
    for row in rows:
        row.update(_dca_status(row))
    return rows


def _month_date(start: date, offset: int) -> date:
    month0 = start.month - 1 + offset
    year, month = start.year + month0 // 12, month0 % 12 + 1
    day = min(start.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def _dca_status(h: dict) -> dict:
    base = {"dca_cycles": 0, "dca_planned_total": 0.0, "dca_next_date": ""}
    if not h.get("dca_enabled") or not h.get("dca_start_date") or not h.get("dca_amount"):
        return base
    try:
        start = date.fromisoformat(h["dca_start_date"])
    except ValueError:
        return base
    now = date.today()
    freq = h.get("dca_frequency") or "monthly"
    if now < start:
        cycles, nxt = 0, start
    elif freq in ("daily", "weekly", "biweekly"):
        step = 1 if freq == "daily" else 7 if freq == "weekly" else 14
        cycles = (now - start).days // step + 1
        nxt = start + timedelta(days=cycles * step)
    else:
        months = (now.year - start.year) * 12 + now.month - start.month
        current = _month_date(start, months)
        cycles = months + (1 if current <= now else 0)
        nxt = _month_date(start, cycles)
    return {"dca_cycles": cycles, "dca_planned_total": round(cycles * float(h["dca_amount"]), 2),
            "dca_next_date": nxt.isoformat()}


def upsert_holding(h: dict) -> dict:
    ts = now_iso()
    secid = (h.get("secid") or h.get("code") or "").strip()
    with _lock:
        conn().execute(
            """INSERT INTO holdings
                 (code, secid, name, kind, shares, cost, input_mode, invested_amount,
                  entry_date, entry_price, note, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(secid) DO UPDATE SET
                 code=excluded.code, name=excluded.name, kind=excluded.kind,
                 shares=excluded.shares, cost=excluded.cost, input_mode=excluded.input_mode,
                 invested_amount=excluded.invested_amount, entry_date=excluded.entry_date,
                 entry_price=excluded.entry_price, note=excluded.note,
                 updated_at=excluded.updated_at""",
            ((h.get("code") or "").strip(), secid, (h.get("name") or "").strip(),
             h.get("kind") or "基金", float(h.get("shares") or 0), float(h.get("cost") or 0),
             h.get("input_mode") or "legacy", float(h.get("invested_amount") or 0),
             (h.get("entry_date") or "").strip(), float(h.get("entry_price") or h.get("cost") or 0),
             (h.get("note") or "").strip(), ts, ts),
        )
        conn().commit()
    row = conn().execute("SELECT * FROM holdings WHERE secid=?", (secid,)).fetchone()
    return dict(row) if row else {}


def delete_holding(hid: int) -> int:
    with _lock:
        cur = conn().execute("DELETE FROM holdings WHERE id=?", (hid,))
        conn().commit()
    return cur.rowcount


def update_dca(hid: int, plan: dict) -> dict | None:
    with _lock:
        conn().execute(
            """UPDATE holdings SET dca_enabled=?, dca_amount=?, dca_frequency=?,
               dca_start_date=?, updated_at=? WHERE id=?""",
            (1 if plan.get("enabled") else 0, float(plan.get("amount") or 0),
             plan.get("frequency") or "monthly", (plan.get("start_date") or "").strip(),
             now_iso(), hid),
        )
        conn().commit()
    row = conn().execute("SELECT * FROM holdings WHERE id=?", (hid,)).fetchone()
    if not row:
        return None
    out = dict(row)
    out.update(_dca_status(out))
    return out


# ---------------- 新闻 ----------------
def _news_key(title: str) -> str:
    normalized = re.sub(r"[^0-9a-z\u4e00-\u9fff]+", "", str(title or "").lower())[:160]
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:24] if normalized else ""


def save_news(items: Iterable[dict]) -> int:
    """返回真正新增的条数（已存在的 uid 直接忽略）。"""
    ts = now_iso()
    added = 0
    with _lock:
        for it in items:
            key = _news_key(it.get("title", ""))
            duplicate = conn().execute(
                "SELECT uid FROM news WHERE day=? AND content_key=? LIMIT 1", (it["day"], key)
            ).fetchone() if key else None
            if duplicate and duplicate["uid"] != it["uid"]:
                continue
            cur = conn().execute(
                """INSERT INTO news (uid, source, title, url, summary, published_at, day, content_key, fetched_at)
                   VALUES (?,?,?,?,?,?,?,?,?)
                   ON CONFLICT(uid) DO UPDATE SET source=excluded.source,title=excluded.title,url=excluded.url,
                     summary=excluded.summary,published_at=excluded.published_at,day=excluded.day,
                     content_key=excluded.content_key,fetched_at=excluded.fetched_at""",
                (it["uid"], it["source"], it["title"], it.get("url", ""),
                 it.get("summary", ""), it.get("published_at", ""), it["day"], key, ts),
            )
            added += 1 if cur.rowcount and not duplicate else 0
        conn().commit()
    return added


def list_news(day: str | None = None, limit: int = 200, only_unscored: bool = False) -> list[dict]:
    sql = ["SELECT n.*, s.label, s.confidence, s.sectors, s.symbols, s.entities, s.reason",
           "FROM news n LEFT JOIN sentiment s ON s.uid = n.uid"]
    args: list[Any] = []
    where = []
    if day:
        where.append("n.day = ?")
        args.append(day)
    if only_unscored:
        where.append("s.uid IS NULL")
    if where:
        sql.append("WHERE " + " AND ".join(where))
    sql.append("ORDER BY n.published_at DESC, n.rowid DESC LIMIT ?")
    args.append(limit)
    out = _rows(conn().execute(" ".join(sql), args))
    for r in out:
        r["sectors"] = json.loads(r["sectors"]) if r.get("sectors") else []
        r["symbols"] = json.loads(r["symbols"]) if r.get("symbols") else []
        r["entities"] = json.loads(r["entities"]) if r.get("entities") else []
    return out


def news_days(limit: int = 30) -> list[str]:
    return [r["day"] for r in _rows(
        conn().execute("SELECT day FROM news GROUP BY day ORDER BY day DESC LIMIT ?", (limit,)))]


# ---------------- 情绪 ----------------
def save_sentiment(rows: Iterable[dict], model: str) -> int:
    ts = now_iso()
    n = 0
    with _lock:
        for r in rows:
            conn().execute(
                """INSERT INTO sentiment (uid, label, confidence, sectors, symbols, entities, reason, model, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?)
                   ON CONFLICT(uid) DO UPDATE SET
                     label=excluded.label, confidence=excluded.confidence, sectors=excluded.sectors,
                     symbols=excluded.symbols, entities=excluded.entities,
                     reason=excluded.reason, model=excluded.model,
                     created_at=excluded.created_at""",
                (r["uid"], r.get("label", "中性"), float(r.get("confidence") or 0),
                 json.dumps(r.get("sectors") or [], ensure_ascii=False),
                 json.dumps(r.get("symbols") or [], ensure_ascii=False),
                 json.dumps(r.get("entities") or [], ensure_ascii=False),
                 r.get("reason", ""), model, ts),
            )
            n += 1
        conn().commit()
    return n


def sentiment_stats(day: str) -> dict:
    rows = _rows(conn().execute(
        """SELECT s.label, COUNT(*) c, AVG(s.confidence) conf
           FROM news n JOIN sentiment s ON s.uid=n.uid WHERE n.day=? GROUP BY s.label""", (day,)))
    total = sum(r["c"] for r in rows) or 0
    by = {r["label"]: {"count": r["c"], "avg_conf": round(r["conf"] or 0, 3)} for r in rows}
    unscored = conn().execute(
        "SELECT COUNT(*) c FROM news n LEFT JOIN sentiment s ON s.uid=n.uid WHERE n.day=? AND s.uid IS NULL",
        (day,)).fetchone()["c"]
    return {"day": day, "total_scored": total, "unscored": unscored, "by_label": by}


# ---------------- 建议 ----------------
def save_advice(day: str, payload: dict, model: str) -> None:
    with _lock:
        conn().execute(
            """INSERT INTO advice (day, payload, model, created_at) VALUES (?,?,?,?)
               ON CONFLICT(day) DO UPDATE SET payload=excluded.payload, model=excluded.model,
                 created_at=excluded.created_at""",
            (day, json.dumps(payload, ensure_ascii=False), model, now_iso()))
        conn().commit()


def get_advice(day: str) -> dict | None:
    r = conn().execute("SELECT * FROM advice WHERE day=?", (day,)).fetchone()
    if not r:
        return None
    d = dict(r)
    d["payload"] = json.loads(d["payload"])
    return d


# ---------------- 驻留量化专家 ----------------
def list_agent_messages(limit: int = 80) -> list[dict]:
    limit = max(1, min(int(limit), 200))
    return _rows(conn().execute(
        """SELECT * FROM (
             SELECT id, role, content, context, model, created_at
             FROM agent_messages ORDER BY id DESC LIMIT ?
           ) ORDER BY id""", (limit,)))


def save_agent_turn(user_content: str, assistant_content: str,
                    context: str, model: str) -> list[dict]:
    ts = now_iso()
    with write_tx() as c:
        cur1 = c.execute(
            "INSERT INTO agent_messages(role,content,context,model,created_at) VALUES(?,?,?,?,?)",
            ("user", user_content, context, model, ts),
        )
        cur2 = c.execute(
            "INSERT INTO agent_messages(role,content,context,model,created_at) VALUES(?,?,?,?,?)",
            ("assistant", assistant_content, "", model, ts),
        )
        ids = (cur1.lastrowid, cur2.lastrowid)
    rows = conn().execute(
        "SELECT id,role,content,context,model,created_at FROM agent_messages WHERE id IN (?,?) ORDER BY id",
        ids,
    )
    return _rows(rows)


def clear_agent_messages() -> int:
    with _lock:
        cur = conn().execute("DELETE FROM agent_messages")
        conn().commit()
        return cur.rowcount


# ---------------- meta ----------------
def meta_get(k: str, default: str = "") -> str:
    r = conn().execute("SELECT v FROM meta WHERE k=?", (k,)).fetchone()
    return r["v"] if r else default


def meta_set(k: str, v: str) -> None:
    with _lock:
        conn().execute("INSERT INTO meta (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", (k, v))
        conn().commit()


# ---------------- 基金十大重仓 ----------------
def register_funds(items: Iterable[dict]) -> int:
    """登记基金目录。只更新目录元数据，不触发网络抓取。"""
    ts = now_iso()
    count = 0
    with _lock:
        for item in items:
            code = str(item.get("code") or "").strip()
            if not code:
                continue
            conn().execute(
                """INSERT INTO fund_profiles
                     (fund_code, fund_name, secid, is_held, is_etf, last_sync_at)
                   VALUES (?,?,?,?,?, '')
                   ON CONFLICT(fund_code) DO UPDATE SET
                     fund_name=CASE WHEN excluded.fund_name<>'' THEN excluded.fund_name ELSE fund_profiles.fund_name END,
                     secid=CASE WHEN excluded.secid<>'' THEN excluded.secid ELSE fund_profiles.secid END,
                     is_held=MAX(fund_profiles.is_held, excluded.is_held),
                     is_etf=MAX(fund_profiles.is_etf, excluded.is_etf)""",
                (code, str(item.get("name") or "").strip(), str(item.get("secid") or "").strip(),
                 1 if item.get("is_held") else 0, 1 if item.get("is_etf") else 0),
            )
            count += 1
        # 持仓表是“是否持有”的唯一事实来源，目录里旧标记要同步撤销。
        conn().execute("UPDATE fund_profiles SET is_held=0")
        held = conn().execute("SELECT code, name, secid FROM holdings WHERE kind<>'股票'").fetchall()
        for h in held:
            code = str(h["code"] or "").strip()
            if not code:
                continue
            conn().execute(
                """INSERT INTO fund_profiles (fund_code, fund_name, secid, is_held, is_etf, last_sync_at)
                   VALUES (?,?,?,?,?, '')
                   ON CONFLICT(fund_code) DO UPDATE SET
                     fund_name=CASE WHEN excluded.fund_name<>'' THEN excluded.fund_name ELSE fund_profiles.fund_name END,
                     secid=CASE WHEN excluded.secid<>'' THEN excluded.secid ELSE fund_profiles.secid END,
                     is_held=1""",
                (code, h["name"] or "", h["secid"] or "", 1,
                 0 if str(h["secid"] or "").startswith("OF.") else 1),
            )
        conn().commit()
    return count


def fund_sync_candidates(limit: int = 40, held_only: bool = False) -> list[dict]:
    where = "WHERE is_held=1" if held_only else ""
    return _rows(conn().execute(
        f"""SELECT * FROM fund_profiles {where}
            ORDER BY is_held DESC,
              CASE WHEN last_sync_at='' THEN 0 ELSE 1 END,
              last_sync_at ASC, is_etf DESC, fund_code ASC LIMIT ?""", (limit,)))


def save_fund_holdings(fund: dict, payload: dict) -> int:
    code = str(fund.get("fund_code") or payload.get("fund_code") or "").strip()
    source = str(payload.get("source") or "").strip()
    report_date = str(payload.get("report_date") or "").strip()
    if not code or not source:
        return 0
    rows = payload.get("holdings") or []
    ts = now_iso()
    with _lock:
        # 同一来源每次保留最新披露期，避免过期重复数据干扰反查。
        conn().execute("DELETE FROM fund_stock_holdings WHERE fund_code=? AND source=?", (code, source))
        for row in rows:
            stock_code = str(row.get("stock_code") or "").strip().upper()
            if not stock_code:
                continue
            conn().execute(
                """INSERT OR REPLACE INTO fund_stock_holdings
                   (fund_code, stock_code, stock_name, weight, report_date, source, source_url, fetched_at)
                   VALUES (?,?,?,?,?,?,?,?)""",
                (code, stock_code, str(row.get("stock_name") or "").strip(),
                 float(row.get("weight") or 0), report_date, source,
                 str(payload.get("source_url") or ""), ts),
            )
        existing_sources = conn().execute(
            "SELECT DISTINCT source FROM fund_stock_holdings WHERE fund_code=? ORDER BY source", (code,)
        ).fetchall()
        sources = [r["source"] for r in existing_sources]
        name = str(payload.get("fund_name") or fund.get("fund_name") or "").strip()
        conn().execute(
            """UPDATE fund_profiles SET
                 fund_name=CASE WHEN ?<>'' THEN ? ELSE fund_name END,
                 latest_report_date=CASE WHEN ?>latest_report_date THEN ? ELSE latest_report_date END,
                 sources=?, last_sync_at=?, sync_error=''
               WHERE fund_code=?""",
            (name, name, report_date, report_date,
             json.dumps(sources, ensure_ascii=False), ts, code),
        )
        conn().commit()
    return len(rows)


def mark_fund_sync_error(code: str, message: str) -> None:
    with _lock:
        conn().execute("UPDATE fund_profiles SET last_sync_at=?, sync_error=? WHERE fund_code=?",
                       (now_iso(), str(message)[:300], code))
        conn().commit()


def fund_holding_stats() -> dict:
    c = conn()
    row = c.execute(
        """SELECT COUNT(*) profiles, SUM(is_etf) etfs, SUM(is_held) held,
                  SUM(CASE WHEN last_sync_at<>'' AND sync_error='' THEN 1 ELSE 0 END) synced,
                  SUM(CASE WHEN is_held=1 AND last_sync_at<>'' AND sync_error='' THEN 1 ELSE 0 END) held_synced,
                  MAX(last_sync_at) last_sync_at
           FROM fund_profiles""").fetchone()
    reports = [r["report_date"] for r in c.execute(
        "SELECT DISTINCT report_date FROM fund_stock_holdings WHERE report_date<>'' ORDER BY report_date DESC LIMIT 4")]
    return {"profiles": row["profiles"] or 0, "etfs": row["etfs"] or 0,
            "held": row["held"] or 0, "synced": row["synced"] or 0,
            "held_synced": row["held_synced"] or 0, "last_sync_at": row["last_sync_at"] or "",
            "holding_rows": c.execute("SELECT COUNT(*) n FROM fund_stock_holdings").fetchone()["n"],
            "report_dates": reports}


def holdings_for_stocks(stock_codes: list[str]) -> list[dict]:
    codes = [str(x).strip().upper() for x in stock_codes if str(x).strip()]
    if not codes:
        return []
    placeholders = ",".join("?" for _ in codes)
    rows = _rows(conn().execute(
        f"""SELECT h.*, p.fund_name, p.secid, p.is_held, p.is_etf
            FROM fund_stock_holdings h JOIN fund_profiles p ON p.fund_code=h.fund_code
            WHERE h.stock_code IN ({placeholders})
            ORDER BY h.stock_code, h.report_date DESC,
              CASE h.source WHEN '天天基金' THEN 0 ELSE 1 END, h.weight DESC""", codes))
    # 一只基金/股票只展示最新报告期的一条占比，同时保留同报告期的来源核对记录。
    out, chosen = [], {}
    for row in rows:
        key = (row["fund_code"], row["stock_code"])
        source_record = {"source": row.get("source") or "", "source_url": row.get("source_url") or "",
                         "report_date": row.get("report_date") or "", "weight": row.get("weight") or 0}
        if key in chosen:
            if row.get("report_date") == chosen[key].get("report_date"):
                chosen[key]["source_records"].append(source_record)
            continue
        row["source_records"] = [source_record]
        chosen[key] = row
        out.append(row)
    return out


def counts() -> dict:
    c = conn()
    return {
        "holdings": c.execute("SELECT COUNT(*) n FROM holdings").fetchone()["n"],
        "news": c.execute("SELECT COUNT(*) n FROM news").fetchone()["n"],
        "scored": c.execute("SELECT COUNT(*) n FROM sentiment").fetchone()["n"],
        "days": c.execute("SELECT COUNT(DISTINCT day) n FROM news").fetchone()["n"],
        "fund_profiles": c.execute("SELECT COUNT(*) n FROM fund_profiles").fetchone()["n"],
        "fund_holding_rows": c.execute("SELECT COUNT(*) n FROM fund_stock_holdings").fetchone()["n"],
        "paper_accounts": c.execute("SELECT COUNT(*) n FROM paper_accounts WHERE active=1").fetchone()["n"],
        "paper_trades": c.execute("SELECT COUNT(*) n FROM paper_trades").fetchone()["n"],
        "live_snapshots": c.execute("SELECT COUNT(*) n FROM live_snapshots").fetchone()["n"],
        "order_intents": c.execute("SELECT COUNT(*) n FROM order_intents").fetchone()["n"],
        "agent_messages": c.execute("SELECT COUNT(*) n FROM agent_messages").fetchone()["n"],
    }
