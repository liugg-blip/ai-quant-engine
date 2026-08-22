**English** · [简体中文](README.zh-CN.md)

# Quant Engine v10.0

A dark, terminal-styled single-file backtesting workbench plus a Windows launcher.

> ⚠️ **This is a teaching tool for historical backtesting and strategy rehearsal.** Every performance
> figure is produced by the backtest engine simulating fills bar by bar over real historical daily
> candles — but historical backtests do not imply future returns, and they carry overfitting and
> survivorship bias. **This tool does not constitute investment advice.**

## What you get

| File | Description |
|---|---|
| `QUANT_ENGINE_v10.exe` | Double-click and go. Extracts the embedded page to `%LOCALAPPDATA%\QuantEngine\` and opens it in your default browser |
| `QUANT_ENGINE_v10.html` | Single-file build (3.26 MB). ECharts and the instrument universe are inlined, so it **runs offline** and can be copied around on its own |

## Data boundaries (read this first)

**This is not a global real-time feed.** There are three distinct cases:

| Instrument type | Data granularity | Timeliness |
|---|---|---|
| Stocks / listed funds / sectors / indices | Daily candles | With "⟳ Live" enabled, pulls a **snapshot** every 15 seconds (last / open / high / low / volume). **Not tick data, not Level 2.** No refresh outside trading hours |
| US equities (NASDAQ / NYSE / AMEX) | Daily candles | Also snapshot polling, but **the relayed US quotes are typically delayed by about 15 minutes**. Session times follow US Eastern (roughly 21:30 Beijing time, 22:30 in winter), with DST handled automatically |
| Off-exchange mutual funds | Daily unit NAV | **No intraday price.** Fund NAV is computed after the close and **published T+1**, so it is always a day behind |

**Coverage**: A-shares + listed funds + sectors + domestic indices + off-exchange mutual funds +
**US equities**. No Hong Kong stocks, FX, or crypto. (Things like a China-internet ETF are QDII funds
listed on the A-share market, not the US securities themselves — search the "US Equities" category
for those.)

US data comes from the same upstream endpoints (`m:105/106/107`) — **not** through any brokerage or
trading-app private API. Those run signed proprietary protocols; scraping them would require logging
into your account and circumventing anti-abuse controls, and this project does not go down that road.

Also, everything on the signal panel — volatility, composite score, win rate, payoff ratio, risk,
position size, expected return — **is computed locally from daily candles**. None of it is an
off-the-shelf indicator pulled from a data vendor.

## Probability interval projection (not a forecast)

Click "◈ Project" at the top right of the chart to draw a distribution band over the next 20 trading
days to the right of the candles:

- Estimates drift μ and volatility σ from the log returns of the last 120 daily bars
- Draws p5 / p25 / p50 / p75 / p95 quantile bands under a log-normal distribution (gold band = 90%
  interval, dashed = 50% interval)
- The blue line extrapolates a least-squares trend fitted to the last 60 log prices
- The tooltip gives: median, 50% / 90% intervals, probability of an advance `Φ(μ√H/σ)`, and
  annualized volatility

**This is not a forecast.** It answers "if future volatility resembles the last 120 days, where is the
price likely to land" — and its directional component comes entirely from extrapolating historical
drift, which is precisely the least stable part. The width of the band (volatility) is far more
trustworthy than its center (direction). Not investment advice.

## Instrument universe

A snapshot of the **full market — 49,270 instruments** is built in (captured at build time, date shown
in the UI) and works offline:

| Category | Count | Data form |
|---|---|---|
| Off-exchange funds (open-end) | 25,885 | Unit NAV |
| **US equities** (NASDAQ / NYSE / AMEX) | **13,718** | Candles |
| Stocks (main boards / ChiNext / STAR / BSE) | 5,892 | Candles |
| Listed funds (ETF / LOF) | 1,564 | Candles |
| Indices | 1,180 | Candles |
| Sectors (496 industry / 504 concept / 31 regional) | 1,031 | Candles |

Listed ETFs also appear in the full open-end fund listing, so they have been removed from the
"off-exchange funds" category (1,564 of them), guaranteeing the two categories **do not overlap**.

US equities can be searched by either Chinese name or ticker. But be prepared: the vast majority of
those 13,718 are penny stocks, ADRs, leveraged ETFs, and option-income strategy funds — searching
`TSLA` will surface derivatives like `TYYY` and `TSII` alongside it. **Searchable does not mean worth
buying.** US markets have no daily price limits and delist quickly, which makes this a sharper problem
than on the A-share side.

Above the instrument box are **6 category tabs: Listed Funds / Off-exchange Funds / Stocks / US
Equities / Sectors / Indices**. **Search runs only within the active category**, so funds and stocks
never get mixed together (searching `AAPL` under "Stocks" returns 0 results). It defaults to **Listed
Funds** — searching "semiconductor" there returns just the 15 relevant ETFs, while searching `600519`
returns 0 results, because finding a stock means clicking the "Stocks" tab first.

Search accepts Chinese names, tickers, and **pinyin initials** (e.g. `hs300`). Use `↑` `↓` to select
and Enter to confirm; leaving the box empty shows the common instruments for that category. "Update"
re-fetches the full market listing online and writes it to browser local storage (about 12 seconds).

> Note: newly listed funds have very short histories (indicators need 60 bars to warm up). Loading
> fewer than 250 daily bars produces a warning in the terminal log, and fewer than 90 prompts that
> backtesting is essentially impossible — pick instruments with longer histories for the results to
> mean anything.

## Interface

A full-screen four-pane grid with an animated loading bar across the top. Palette: black background,
red-up / green-down, gold accents, blue-cyan highlights, all figures in aligned monospace.

- **Top-left — daily backtest chart / NAV curve** — listed instruments get candles + 20-day moving
  average + volume bars; off-exchange funds automatically switch to a **NAV line** with daily percent
  change in the subplot. Play / pause / reset the rehearsal animation (1–15× speed), scrub with the
  bottom slider, plus "⟳ Live" snapshot sync and "◈ Project" probability bands.
- **Top-right — signal panel** — volatility, composite score, win rate, payoff ratio, risk, position
  size, and per-trade expected return, with rolling number animations; the long/short tag in the header
  follows the rehearsal position. **Win rate and payoff ratio are measured, not assumed**: over the 250
  bars preceding the rehearsal position, each bar is treated as a hypothetical entry and checked to see
  whether it reached the target or the stop first. Win rate = share that hit target first; payoff ratio
  = average gain ÷ average loss. They move with the instrument, the rehearsal position, and your
  stop/target inputs; editing them by hand locks in the manual value, and switching instruments
  restores the measured one.
- **Bottom-left — strategy engine** — instrument search plus win rate / stop / target / payoff /
  commission. Commands are grouped by workflow into three sets: **Analysis** (fetch data, regime
  strategy, 10 strategies), **Validation** (short set, reversal set, factors, allocation), and
  **Assets** (holdings, sentiment, paper trading, wealth, live read-only). The strategy card area
  scrolls independently rather than squeezing the page layout.
- **Bottom-right — terminal log** — OHLC streamed bar by bar, with a fade mask at the top.

Click any strategy card → backtest performance report dialog. **The report doesn't just give
performance, it automatically dissects the curve layer by layer** — see the next section.

The `?` button at the top opens the built-in beginner's guide at any time. Full step-by-step
instructions, field definitions, and FAQ are in `使用指南.md` (User Guide).

The `Chat` handle on the right edge of the page expands a persistent **DeepSeek quant assistant**.
Once expanded, the entry button hides; collapse it with `▶` or `×` in the title bar. The chat column
is pinned right at full height, and dragging its left edge resizes it. While expanded, the main grid,
signal panel, and terminal log shrink in step rather than being covered. Column width and multi-turn
history are stored locally.

The assistant reads the current instrument, data date, and a signal-panel summary alongside your
question, and can autonomously call read-only tools on the Python backend: public quotes, batch
historical risk/return comparison, financial news, sentiment, fund linkage, paper trading, and system
status. It only calls the holdings tool when you explicitly ask about "my holdings".

For anything involving latest quotes, news, sentiment, or cross-instrument history, the backend
imposes a first-round data gate that forces the relevant tool call before an answer is generated,
preventing stale numbers from earlier turns being reused. When multiple tool calls come back at once,
the backend returns each full result in turn, which eliminates the tool-sequence 400 errors.

**API keys are only ever stored on the Python backend. The model has no control over simulated fills
and no live-trading execution permissions whatsoever.**

The agent's "Comprehensive Assessment" runs another strict pipeline: confirm frontend live quotes →
validate 11 factors in batches → backtest every available strategy with out-of-sample excess broken
out separately → have the backend independently re-check cutoff dates and prices against upstream
quote sources → re-fetch and re-classify the day's news → read holdings and the paper account → and
only then let DeepSeek emit conditional observations. A single scrolling line at the top of the chat
shows the backend's real execution record, keeping only the latest status in view. If quote
verification fails, dates disagree, news items remain unclassified, or quantitative results are
missing, the system stops outright rather than calling the model to fabricate an entry or exit
conclusion.

## The validation system: peeling away "looks profitable" layer by layer

This is where the tool differs most from open-source engines like LEAN or QuantDinger — their strength
is execution, this one's strength is **falsification**.

Open any strategy report and it automatically runs:

| Gate | The question it answers | Method |
|---|---|---|
| **Risk-adjusted view** | Is it worth the risk taken | Sharpe / Calmar / drawdown-equivalent annualized return, compared with buy-and-hold on the same basis |
| **① Random-entry baseline** | Is it just luck | 200 random-entry runs (same trade count, same stop and target); see which percentile the strategy lands in. Below 95 is indistinguishable from random |
| **② In-sample / out-of-sample** | Does it only work in this stretch of market | Fit on the first 70%, test on the last 30%. The criterion is **excess** (strategy − buy-and-hold over the same period), with position size estimated in-sample and validated out-of-sample |
| **③ Parameter sensitivity** | Does it collapse when parameters move | A 5×5 grid sweep. Factor strategies automatically sweep their own core parameters (holding period × quantile threshold + quantile window) rather than irrelevant stop/target values |
| **④ Cross-instrument scan** | Does it only work on this one instrument | Button-triggered; runs the same rules across a basket of instruments (about 2 seconds) and counts how many show positive excess |

There's also a standalone **"◎ Factor Testing"** window: 11 factors across 4 families, reporting
IC (5 / 10 / 20-day), ICIR, segment consistency, and **layered returns Q1→Q5**, with one-click
conversion of a factor into either a **quantile strategy** or a **stock-selection portfolio** (the
portfolio must clear the same three gates: random selection, in/out-of-sample, and parameter
sensitivity).

"⎘ Export" at the top right of the report writes rules, parameters, and every validation conclusion
out as plain text, identical to what's on screen.

> **The design principle behind the five gates**: the first good result in any new direction should be
> assumed not to have passed, until the gates say it did. Two separate "best results yet" were
> overturned this way during development (details in `优化建议报告.md`, the optimization report).

## How the backtest engine computes

Not random numbers — a real backtest:

- 28 strategy templates (14 long + 7 short + 7 reversal) built on moving averages, relative strength,
  fast/slow lines, Bollinger Bands, ATR, Donchian channels, and volume moving averages
- Signals confirm at the close of bar *i*, and **fills take the open of bar i+1** (no lookahead)
- **Priced in currency**: starting capital is a first-class parameter; listed instruments fill in
  **round lots of 100 shares**, and a bar that can't afford a lot is skipped and counted
- **Real costs**: 2.5 bp commission with a **5 CNY per-trade minimum** + 5 bp slippage (both sides) +
  5 bp stamp duty (sell side only). Off-exchange funds instead use a subscription fee plus a
  holding-period tiered redemption fee (<7 days 1.5% | 7–30 days 0.75% | 30 days–1 year 0.5%)
- **Fill feasibility**: locked limit-up can't be bought, locked limit-down can't be sold (±10% main
  boards, ±20% ChiNext / STAR, ±30% BSE); a single order exceeding 1% of the day's turnover triggers a
  warning that real slippage will be higher
- **US equities are modeled by US rules**, not A-share parameters bolted on: **1-share minimum** (not
  100-share lots), **no stamp duty**, **no price limits**, and everything **priced in USD** (the
  report's capital and fee units switch automatically). The per-trade minimum commission is **1 USD** —
  a common floor across brokers, and **on the optimistic side**; whichever broker you actually use,
  change that field and re-read the conclusion. It also **excludes FX conversion spread**, so buying
  with converted currency takes a further haircut on real returns
- **Dual adjusted series**: returns use backward-adjusted prices (dividends aren't counted as losses,
  results are reproducible), while share counts and fees use unadjusted real market prices
- Exit priority: stop loss (fixed % or **ATR-dynamic**) → **trailing take-profit** → take-profit →
  strategy exit signal → 60-trading-day expiry
- Position size comes from the **half-Kelly formula** `f* = (p·b − (1−p)) / b`, halved and capped at
  80%; the report separately gives a corrected view that "estimates size from the strategy's own
  in-sample win rate and validates out-of-sample"

**About "position size 0%"**: once win rate and payoff ratio are taken from measured values, many
instruments produce a negative Kelly result under default parameters — meaning that stop/target
combination has no positive expectancy on that instrument, and the mathematical conclusion is not to
bet. Equity stays flat in that case, and the report's cumulative return automatically switches to a
**fully-invested basis** with a note, so `+0.00%` isn't misread as "broke even". To see parameters with
positive expectancy, widen the stop and extend the target.

"Reverse short" is not the long signals inverted — it is 7 independent bearish entry rules (death
cross, breakdown to new lows, overbought pullback, upper-band stall, bearish alignment, death cross
below zero, high-volume down bar), with P&L computed in the short direction.

**How off-exchange funds differ in backtesting**: they have only a unit NAV — open = high = low =
close, and no volume. So the 8 strategies that depend on candle bodies or volume (Bollinger lower-band
bounce, panic bottom-fishing, three-white-soldiers start, price-volume surge, gap continuation, 20-day
MA retest, Bollinger upper-band stall, high-volume down bar) are skipped automatically with an
explanation in the log. The remaining 13 close-only strategies backtest normally, filling at the next
day's NAV (matching actual subscription and redemption rules).

If the network or an endpoint fails, it automatically switches to a **local simulated market engine**
(geometric Brownian motion + trend/volatility regime switching + overnight gaps). The data-source tag
at the top right shows which is active.

## Results so far

For the record: **not one direction tested on this tool has passed all the gates.**

| Direction | Conclusion |
|---|---|
| 14 momentum templates | Underperform buy-and-hold; random baseline mostly below the 50th percentile |
| 7 reversal templates | Worse — random percentile 12%–49% |
| Factor quantile timing | After sweeping for the right parameters, only 12 of 25 grid cells positive; change the quantile window and it flips negative |
| Factor stock-selection portfolio | In-sample excess +10.39%/yr → out-of-sample **−25.27%/yr** |

Two patterns that keep recurring:

1. **In a one-way advancing market, every "timing + reduced exposure" strategy necessarily
   underperforms staying fully invested** — timing's value is in reducing drawdown, not raising
   returns. Judging these strategies purely on excess return is using the wrong yardstick, which is why
   the report also gives the risk-adjusted view.
2. **Seeing a significant IC, the next step is not to write a strategy — it's to look at layered
   returns first.** Measured here: the reversal effect exists only in the worst-performing 20%, and the
   other 80% shows no pattern at all. Meanwhile common conditions like a death cross or a breakdown to
   new lows cover far more ground than that, so the overwhelming majority of trades land in the
   ineffective region.

That result doesn't look good, but it is exactly what the tool is for: **telling you before you put
real money on it.**

### Which led to a different route: asset allocation

Main panel, `◈ Asset Allocation`. This module **doesn't predict direction** — it answers three
questions that history can verify directly:

| Question | Measured answer (four broad-based ETFs · 2022-06 → 2026-08 · real costs included) |
|---|---|
| **How many to hold?** | Equal-weight 4 vs single-holding average: drawdown 35.00% vs 36.23%, Sharpe 0.32 vs 0.27. Diversification works, but because A-share broad-based indices move together so tightly, it **only cut drawdown by 1.2 percentage points** |
| **How often to rebalance?** | Quarterly rebalancing +7.59%/yr with 35.00% drawdown; never rebalancing +7.33%/yr with 34.59% drawdown. The difference is small — rebalancing mainly keeps the winner from crowding out everything else |
| **How many purchases?** | Dollar-cost averaging +20.32%; lump-sum on the unluckiest day −5.75%, on the luckiest day +45.91%. **Timing's entire value is those 51.66 percentage points.** DCA takes the median and gives up both tails |

The right way to read the efficient-frontier scatter plot is to **look at its shape, not copy the
optimum** — the "max Sharpe allocation" is computed on history already known, which makes it
overfitting by construction, and it moves when the window moves. The real information in that chart is
that the upper edge of the scatter cloud is nearly straight, meaning that within this basket, taking
more risk and getting more return is close to an even trade.

One more finding that matters a lot for small accounts: a 5 CNY per-trade minimum commission is 0.25%
on a 2,000 CNY contribution, and 12 of those a year is roughly 3% burned. **Raising the per-contribution
amount or lowering the frequency saves that outright.**

## My Holdings / Daily Market Sentiment (requires the local backend)

The main panel adds `◧ My Holdings` and `◐ Market Sentiment`. Both depend on the Python backend under
`server/`:

```bash
cd server
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8770
```

On Windows, double-clicking `QUANT_ENGINE_v10.exe` starts the backend automatically; double-clicking
`server/run.bat` on its own works too. **When the backend isn't running, these two windows show startup
instructions, and the terminal's existing quotes, backtesting, factor testing, and asset allocation are
entirely unaffected.**

- **My Holdings**: funds and stocks are entered separately. Funds take "code + amount invested +
  purchase date", and the system converts to units using the historical NAV on that date or the next
  trading day; stocks take "code + share count + cost per share". Data goes into a local SQLite
  database (`server/data/quant.db`), and legacy unit/cost records remain usable. The list supports
  editing and deletion. Each holding can carry a daily, weekly, biweekly, or monthly contribution plan,
  with tracked periods, cumulative planned amount, and next date updated daily. **The contribution
  feature only tracks the plan — it never debits an account or places an order.** Holding market value,
  daily P&L, and cumulative P&L are computed live in the frontend from the same quote snapshots;
  off-exchange funds use the latest published NAV (T+1). If a live snapshot is briefly unreachable, it
  degrades to the daily close and marks the row "close, date" rather than leaving it blank.
- **Market Sentiment**: pulls from 10 public sources (financial newswires, exchange announcements,
  CNBC, MarketWatch, SeekingAlpha). "News detail" and "today's overview" are now a single page, running
  in the order "① news and overview (fetch and read) → ② news linkage → ③ impact on my holdings". Each
  item directly shows bullish / bearish / neutral, confidence, related sectors, related instruments,
  and the reasoning behind the call. DeepSeek's structured classification disables unnecessary deep
  reasoning and runs 8 items per batch across 10 parallel batches with live progress; already-read news
  doesn't consume the model again.
- **News linkage**: the model extracts specific companies and tickers from the news, then reverse-looks
  up the top-ten disclosed holdings of funds in SQLite, forming a three-level "news → stock → fund"
  chain. Bulk coverage comes from the fund data source, with a public fund-research site cross-checking
  the funds in "My Holdings". Sync order always puts held funds first, then expands to listed ETFs in
  batches. The list draws only the stock summary up front and generates news and fund detail on click,
  so large numbers of linkage records don't bog down the page. The backend rotates through 40 per day
  automatically, and the frontend fills the first batch itself when only holdings data exists;
  "Update fund holdings" advances another 60 per click. Every percentage is labeled with its reporting
  period and source — **it is the share of fund NAV as disclosed in the quarterly report, not today's
  live position.**

> ⚠️ Sentiment labels, news linkage, and suggested actions are all **organization or model inference
> based on public information, for reference only, and do not constitute investment advice.** There is
> no stable causal relationship between news sentiment and subsequent prices. See `server/README.md`.

Two sources were found unusable and kept as documented placeholder adapters: **Reuters** (the official
public RSS was discontinued) and one domestic newswire (its public endpoint requires a signature, and
reverse-engineering that signature amounts to circumventing anti-scraping controls, which this project
does not do).

## Paper trading / My Wealth (fake money, strictly)

The main panel adds `▣ Paper Trading` and `◆ My Wealth`. Both use the same local simulated ledger, the
UI permanently displays "paper trading, not real capital", and the backend contains no brokerage SDK,
no QMT integration, and no live order interface of any kind.

- **Multiple accounts**: create several independent virtual accounts, 100,000 CNY starting capital by
  default and configurable. Cash, holdings, fills, and NAV are fully isolated between accounts.
- **Automatic signals**: composites the day's news sentiment, cross-sectional factor ranking, and
  MA20/MA60 trend into a 0–100 score. Buy threshold, sell threshold, the three weights, maximum
  holdings, and per-instrument and total exposure caps are all configurable.
- **Safety confirmation**: safe mode only generates a "proposed trades" list, which is written to
  simulated fills after you tick and manually confirm. Even simulated auto mode only writes to the
  local fake-money ledger and never sends an order anywhere.
- **Fill constraints**: A-shares and listed ETFs use a conservative unified T+1 batch lock, filling in
  100-share lots. Commission, minimum commission, slippage, and stock sell-side stamp duty are all
  configurable, defaulting to 2.5 bp commission, 5 CNY minimum, 5 bp slippage, 5 bp sell-side stamp duty.
- **Portfolio controls**: by default holds at most 3 positions, 40% per-instrument cap, 95% total
  exposure cap, 5-day cooldown after a sale, plus fixed stop-loss and trailing take-profit thresholds.
- **Wealth analysis**: shows total assets, cumulative return, maximum drawdown, and annualized Sharpe,
  along with normalized curves for each virtual account and a CSI 300 ETF benchmark. Holding market
  value and NAV are updated daily by the backend.

News sentiment is only one component of the composite signal and never triggers a proposed buy on its
own without also clearing the factor and trend thresholds. All signals, fills, returns, and benchmark
comparisons are historical information and simulated computation — **for research only, not investment
advice.** The isolation architecture, risk gates, and acceptance checklist for any future live
integration are in `实盘接入设计文档.md` (live integration design); the current program contains no
executable live adapter.

### Live data (read-only) and order intents

The asset research center adds `◇ Live Data (read-only)`. It is not a trading interface — it provides
exactly two locked local data entry points:

- Import a **redacted JSON snapshot** produced by a brokerage engineer or a read-only bridging service,
  showing total assets, cash, available cash, holdings, orders, and a copy of fills.
- Convert pending proposed trades from paper trading into a `quant-engine-order-intent/1.0` JSON
  package, so a brokerage engineer can review the field set and the risk-control contract.

Every endpoint returns a fixed `execution_enabled: false`; no submit, cancel, or brokerage-login route
exists in the backend. A snapshot containing password, token, API key, private key, or similar fields
is rejected, and accounts may only be given aliases. Order intents use stable idempotency IDs, so
regenerating one never produces a second record.

## Rebuilding

Requires Node.js and .NET Framework 4.x (`csc.exe` ships with Windows).

```bash
powershell -File "build.ps1"
```

Also re-fetch the full-market instrument snapshot (needs network; the endpoints are rate-limited, so
wait a few minutes and retry on failure):

```bash
powershell -File "build.ps1" -Refresh
```

Rebuild only the HTML (no exe packaging):

```bash
node build.js
```

## Source layout

```
server/              Python FastAPI backend (holdings / news / fund linkage / paper trading SQLite and scheduled jobs)
server/paper_engine.py  Purely local paper-trading signals, T+1 fills, costs, holdings, and wealth curve
server/live_data.py  Read-only redacted live-snapshot storage and non-executable order-intent packages
src/shell.html       Page structure + all styles (with the __ECHARTS__ / __UNIVERSE__ / __APP__ inline placeholders)
src/app.js           Universe search, quote fetching, indicators, strategy library, backtest engine, charts, animation
src/universe.json    Full-market instrument snapshot (generated by fetch-universe.js, inlined at build time)
src/echarts.min.js   ECharts 5.5.1 (inlined at build time)
src/Launcher.cs      WinForms launcher; the HTML is packed as an embedded resource
src/MakeIcon.cs      Generates app.ico
fetch-universe.js    Pages through the upstream API to fetch the full-market instrument listing
build.js             Inlines everything into a single-file HTML
build.ps1            One-shot build of HTML + icon + EXE (-Refresh also refreshes the universe)
使用指南.md          User guide: complete walkthrough from picking an instrument to watching a paper account, plus risk boundaries
实盘接入设计文档.md  Live integration design: isolation architecture and acceptance requirements for a brokerage engineer (contains no live order implementation)
```

Build outputs (exe / html) go straight to the project root and are overwritten in place on rebuild.
