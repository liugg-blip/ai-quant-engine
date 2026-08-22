**English** · [简体中文](LIVE_TRADING_DESIGN.zh-CN.md)

# Quant Engine v10.0 — Live Trading Integration Design

> **Purpose of this document:** review and implementation reference for a brokerage engineer working on
> this later. The current deliverable is strictly paper trading only, and contains no QMT integration,
> no brokerage SDK, no account login, and no live order or cancellation code.
> This describes system boundaries and acceptance requirements. It is not investment advice, and it is
> not a directly executable live-trading program.

## 1. Goals and boundaries

If live trading is ever integrated, the current layered flow must be preserved:
**signal → proposed-trade list → risk gate → manual confirmation / automated authorization → execution
→ reconciliation.**

Replacing the SQLite simulated matching in `server/paper_engine.py` with brokerage order calls is
forbidden, as is letting the web frontend hold brokerage credentials directly.

Already complete in the current version:

- Multiple virtual accounts, composite signals, proposed-trade lists, T+1, costs, fills, holdings, and
  the wealth curve.
- Two modes — safe confirmation and simulated auto. Both write only to local SQLite.
- Three input classes (news, factors, trend) plus portfolio-level position limits.

The future brokerage engineer is responsible for:

- Adapting the brokerage-authorized quote and trading SDK.
- Account login, session keepalive, order placement, cancellation, fill reports, and asset queries.
- Broker-side rule validation, real account reconciliation, fault recovery, and production deployment.

## 2. Recommended isolation architecture

```text
Browser frontend
  │ submits only rules, watch pool, and manual confirmations
  ▼
Quant Engine API (existing FastAPI)
  │ produces immutable proposed-trade lists, never touches brokerage credentials
  ▼
Live risk gateway (future standalone service)
  │ secondary validation, idempotency, duplicate prevention, authorization state, trading session
  ▼
Brokerage adapter (future, implemented by a brokerage engineer)
  │ uses only the broker's official SDK / authorized interfaces
  ▼
Brokerage counter

Broker fill and asset reports ──► reconciliation service ──► independent live ledger ──► read-only feed back to frontend
```

The live risk gateway and the brokerage adapter must run as separate processes with separate databases.
Simulated tables and live tables must not be shared, and a simulated account ID must never be
interpretable as a real capital account number.

## 3. Data contract

Quant Engine delivers only *intents* to the future risk gateway — never unvalidated raw brokerage
instructions. Each intent contains at minimum:

| Field | Requirement |
|---|---|
| `intent_id` | Globally unique, never reused, serves as the idempotency key |
| `created_at` / `expires_at` | Creation and expiry time; execution forbidden after expiry |
| `account_alias` | References a controlled account alias — no account number, no password |
| `symbol` / `market` | Normalized security code and market |
| `side` | Whitelisted actions only |
| `quantity` | Already rounded to the minimum trading unit |
| `price_policy` | Limit / protected-market or similar, as confirmed by the broker |
| `max_slippage` | Maximum acceptable deviation; exceeded means rejected |
| `signal_snapshot` | Snapshot of news, factor, and trend scores plus rule version |
| `approval` | Confirming person, time, device, or automated authorization policy version |

The risk gateway returns unified statuses: `received`, `risk_rejected`, `submitted`,
`partially_filled`, `filled`, `cancelled`, `broker_rejected`, `unknown`.

**A timeout must never be treated directly as a failure and resubmitted.** Query first by `intent_id`
and broker order number to avoid duplicate fills.

## 4. Mandatory risk gates

Before any intent reaches the brokerage adapter, re-check at minimum:

1. Whether the live master switch, account authorization, and same-day manual unlock are all valid.
2. Trading date, trading session, trading halts, price limits, and minimum trading unit.
3. T+1 sellable quantity, with the broker's return as final authority — local estimates may only block
   early.
4. Available cash, frozen cash, available holdings, and outstanding orders.
5. Portfolio limits such as maximum 3 positions, 40% per instrument, 95% total exposure.
6. Per-order amount, daily turnover, daily loss, consecutive rejections, and maximum-drawdown circuit
   breaker.
7. Per-instrument cooldown, duplicate intents, and self-trade risk.
8. Price deviation, order-book liquidity, and maximum slippage; stale quotes are rejected outright.

Any missing critical data, broker query timeout, reconciliation mismatch, or system clock anomaly must
**"reject new positions"** rather than auto-pass.

## 5. Safe / auto dual modes

**Safe confirmation mode** is the only mode permitted at first launch: the proposed-trade list goes
through risk pre-checks, then the user confirms each trade individually. The confirmation action should
be secondarily verified and recorded with audit information.

**Auto mode** may only be enabled by a brokerage engineer after safe mode has run stably and passed
staged acceptance, and must satisfy:

- Whitelists for account, instrument, session, maximum amount, and strategy version.
- A time-limited daily manual unlock, defaulting back to locked after a restart.
- An independent emergency stop switch; once stopped, only cancellation and queries are allowed, never
  new orders.
- Degradation to safe confirmation when an auto strategy misbehaves — never silent continuation.

## 6. Reconciliation and recovery

**The broker is the authority on real assets.** The system runs three classes of reconciliation at
minimum — before the open, after fill reports, and after the close:

- **Order reconciliation**: local intent, broker order number, status, and rejection reason all map
  one-to-one.
- **Fill reconciliation**: partial fills, multiple fills, fees, and fill times all fully recorded.
- **Asset reconciliation**: cash, frozen cash, holding quantity, sellable quantity, and market value
  all match the broker.

If the report stream disconnects, stop new orders first, then backfill status from the broker's query
interface. When an `unknown` status appears, retrying with the same trade intent is forbidden until a
human or a query result removes the uncertainty.

## 7. Security and audit

- Brokerage credentials may only live in the operating system credential store or a controlled secrets
  service — never in `.env`, SQLite, logs, or the frontend.
- The risk gateway listens only on localhost or a controlled internal network, with mutual
  authentication. Exposing it to the public internet is forbidden.
- Logs should record rule version, input snapshot, risk result, confirming person, and broker report —
  but must be redacted.
- Critical tables use append-only auditing; deleting or rewriting fill history through the ordinary
  interface is not allowed.
- The system starts with live trading locked by default. Paper trading must always run independently,
  and a live-side failure must never contaminate the simulated ledger.

## 8. Brokerage engineer acceptance checklist

- [ ] With no brokerage adapter installed, the existing paper-trading features work in full.
- [ ] No brokerage password, token, or private key can be found in the frontend or the Quant Engine
      process.
- [ ] Replaying the same `intent_id` 100 times produces exactly one valid order.
- [ ] Network timeouts, out-of-order reports, partial fills, and restart recovery never cause duplicate
      orders.
- [ ] Same-day purchases, halts, insufficient funds, stale quotes, over-exposure, and excess slippage
      are all blocked.
- [ ] After an emergency stop, no new orders are produced, while queries and cancellations still work.
- [ ] A mismatch between broker assets and the local ledger auto-locks the system and reports a
      traceable difference.
- [ ] Safe confirmation mode has consecutively passed simulation, the broker's test environment, and
      limited staged acceptance.
- [ ] Every release has a rollback plan, and rolling back never loses outstanding order state.

## 9. Implementation order

1. Freeze and version the proposed-trade data contract first.
2. Build the standalone risk gateway and a read-only brokerage query adapter — asset and order queries
   only.
3. Complete reconciliation, idempotency, auditing, and fault-injection testing.
4. Connect order placement and cancellation in the broker's test environment, still in safe
   confirmation mode.
5. Only after brokerage, security, and business three-way acceptance, discuss a restricted auto mode.

The current v10 has completed a first draft of step 1's data contract: `live_snapshots` stores redacted
read-only snapshots, `order_intents` stores non-executable order intents with stable idempotency IDs,
and export packages are permanently marked `execution_enabled=false`.

**The program has not entered step 2**: there is no brokerage query adapter, no credentials, no risk
gateway, and no trade execution capability of any kind. Any subsequent live implementation must be
carried out independently by an engineer holding brokerage interface permissions and production
responsibility.
