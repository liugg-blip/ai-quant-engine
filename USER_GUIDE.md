**English** · [简体中文](USER_GUIDE.zh-CN.md)

# Quant Engine v10.0 — User Guide

Quant Engine is for observing trends in funds, stocks, indices, and sectors, validating strategies, and
recording trade results with simulated capital. It is not brokerage trading software. Every backtest,
projection, news sentiment label, and model suggestion is for research reference only.

## 1. Recommended workflow

1. Pick a category in the "Instrument" area: listed funds, off-exchange funds, stocks, US equities,
   sectors, or indices.
2. Enter a code or name, select the target, then click "Fetch data".
3. Check the data source, daily-bar count, and data cutoff date shown at the top.
4. Read the candles, MA20, and the signal panel on the right — don't go by a single score.
5. Click "Regime strategy" or "10 strategies", then click a strategy row for the full backtest report.
6. Use factor testing, out-of-sample, random baseline, parameter sensitivity, and the cross-instrument
   scan to rule out coincidence.
7. Once something passes, put it in paper trading and watch it first. Do not commit real money on the
   strength of the report alone.

## 2. Interface areas

| Area | Main function | What to watch |
|---|---|---|
| Top-left, daily backtest chart | Candles, MA20, play, pause, reset, zoom, adjusted prices, live updates | Confirm the data date first; projections open in a separate window and never modify the main chart |
| Top-right, signal panel | Volatility, composite score, win rate, payoff ratio, risk, position size, expected return, trend | Metrics recompute with the current instrument and quote window |
| Bottom-left, strategy engine | Instrument search, parameters, strategy generation, backtesting, factors, asset allocation | Entry points are grouped into "Analysis, Validation, Assets" |
| Bottom-right, terminal log | Data requests, quotes, task progress | On failure, look here first for the specific reason |
| Right-hand chat column | DeepSeek quant assistant, explanation of current signals, multi-turn Q&A | Click the "Chat" handle to expand or collapse; answers are research assistance only |

## 3. Analysis features

### Fetching data

- A-shares, listed funds, US equities, indices, and sectors read primarily from public quote endpoints.
- Off-exchange funds read a NAV line, not exchange candles.
- If an endpoint is unavailable it may fall back to locally simulated quotes, and the data source is
  stated explicitly at the top.

### Candle rehearsal

- "Play" reveals historical candles bar by bar, "Pause" holds the current position, "Reset" restores
  the full dataset.
- Switching instruments stops the current rehearsal and rebuilds chart state.
- Projection only displays a probability interval computed from historical volatility and a formula.
  It does not represent future prices.

### Signal panel

- Win rate and payoff ratio come from current quotes and a touch simulation. They are not fixed
  promised values.
- Position size follows a half-Kelly approach subject to a cap; negative expectancy can yield zero
  position size.
- Read risk, maximum drawdown, and expected return together — never the composite score alone.

## 4. Strategies and validation

| Feature | Meaning |
|---|---|
| Regime strategy | Matches rule templates to a trending, ranging, or weak environment |
| 10 strategies | Generates a batch and compares cumulative return, win rate, profit/loss ratio, drawdown, and trade count |
| Short set | Tests weak markets in the reverse direction. Does not imply directly executable margin-short trading |
| Reversal set | Inverts some momentum conditions to test the oversold-bounce hypothesis |
| Factors | Shows Spearman IC, ICIR, and layered returns to judge whether a factor is stable |
| Allocation | Compares broad-based diversification, dollar-cost averaging, and the efficient frontier, without relying on point forecasts |

Every strategy passes at least these checks:

1. Risk-adjusted return: are Sharpe and Calmar reasonable?
2. Random-entry baseline: is it meaningfully better than random trading?
3. In-sample vs out-of-sample: does excess return survive out-of-sample?
4. Parameter sensitivity: does a small parameter change break it immediately?
5. Cross-instrument scan: does it only happen to work on one instrument?

## 5. Personal assets and news

### My Holdings

- Funds are entered as "code, amount invested, purchase date"; the system converts to units and
  computes cumulative P&L.
- Stocks are entered as "code, share count, cost per share".
- Holdings support editing, deletion, and tracking of daily, weekly, biweekly, or monthly contribution
  plans.
- Contribution tracking never debits an account and never sends a trade to a fund platform or broker.

### Market sentiment

Recommended reading order:

1. News and today's overview: confirm the model has read and labeled the news.
2. News linkage: see which stocks the news touches and which funds disclose holding them.
3. Impact on my holdings: reference suggestions generated against your holdings, with the news basis.

There is no stable causal relationship between news sentiment and subsequent price moves. A fund's top
ten holdings generally come from quarterly reports, and the percentages are not today's live positions.

## 6. Paper trading and wealth

- Create multiple virtual accounts, 100,000 CNY starting capital by default.
- The composite signal is built jointly from news sentiment, factor ranking, and trend.
- Safe confirmation mode generates a proposed-trade list first and writes simulated fills only after
  manual confirmation.
- Simulated auto mode still uses nothing but fake money.
- Fills account for T+1, 100-share/unit lots, commission, minimum commission, slippage, and sell-side
  stamp duty on stocks.
- "My Wealth" shows total assets, cumulative return, maximum drawdown, Sharpe, and a CSI 300 benchmark
  curve.

## 7. Live data boundaries

"Live read-only" supports exactly two things:

- Importing redacted asset, holding, order, and fill JSON snapshots provided by a brokerage engineer.
- Generating non-executable order-intent JSON from paper-trading proposed trades.

The program never stores brokerage passwords, tokens, API keys, or private keys, and has no login,
order-placement, cancellation, or real-money interface. All read-only endpoints return a fixed
`execution_enabled=false`.

## 8. The resident quant assistant

- Click the `Chat ◀` handle on the right edge of the page to expand the assistant. The entry button
  hides once expanded; collapse with `▶` or `×` in the title bar and it reappears. While expanded, the
  main four-pane grid narrows dynamically and the signal panel and terminal log shrink in step, so
  nothing is covered by chat content.
- The chat column is pinned to the right at full height; drag its left edge to resize, and the width is
  saved locally. On narrow screens it switches to an overlay so the quote area never gets squeezed to
  unusability.
- The agent handles everyday conversation about the site's features, stocks and funds, financial
  fundamentals, and investing education. It reads the current instrument and signal summary first; when
  a question involves recent information, it genuinely calls read-only backend tools for public quotes,
  financial news, sentiment, fund linkage, or paper trading.
- Asked about the historical performance of several stocks or funds, the agent can batch-read public
  daily bars for up to 8 instruments and compare return, volatility, maximum drawdown, Sharpe, and the
  proportion of up days. That result is buy-and-hold historical statistics, not a strategy backtest.
- Questions about latest quotes, news, sentiment, and historical comparison pass through a backend data
  gate first; the model only produces a conclusion after "this question requires a read first" appears
  at the top and the tool steps complete. The input box clears immediately on send — no need to wait
  for the answer to finish.
- Conversation history is stored locally in `server/data/quant.db` and survives restarts. "Clear"
  deletes all local agent conversations.
- Each question sends recent conversation and the current signal summary to the DeepSeek endpoint
  configured in `.env`. The API key never reaches the web page and is never written into conversation
  history.
- The agent reads your local holdings summary only when a question explicitly concerns "my holdings".
  It can read paper-trading results but cannot control simulated fills, and it has no live login,
  order-placement, or cancellation capability.

Clicking "Comprehensive Assessment" makes the agent run through:

1. If quotes are still simulated, first attempt to fetch online historical data for the selected
   instrument.
2. Compute IC, ICIR, layered returns, and current rolling quantile for 11 factors, in batches.
3. Backtest every applicable strategy, focusing the comparison on the last 30% out-of-sample return,
   excess over benchmark, drawdown, and trade count.
4. Have the backend independently query public quote sources to verify the instrument, latest trading
   day, closing price, and quote fingerprint.
5. Have the backend re-fetch the day's news and complete sentiment, sector, and related-instrument
   classification batch by batch; it proceeds only when unclassified items reach 0.
6. Read the holdings summary and paper-trading return, drawdown, and Sharpe.
7. Only after every gate passes, output the current observed action, confidence, entry conditions,
   trim/exit conditions, conflicting evidence, and invalidation conditions.

The "backend data execution record" at the top of the chat box comes from FastAPI task status, not from
the model describing itself. The interface shows one line at a time, with later steps scrolling slowly
into view. Any failed step displays the failure reason and stops the recommendation. Output is fixed in
the order "current suggestion → what to do now → entry conditions → trim/exit → core basis → conflict
risk → next check". The model is not permitted to invent target prices, position percentages, or
specific review dates.

Ordinary Q&A lets DeepSeek choose the necessary read-only backend tools on its own, with the execution
record at the top showing the actual call sequence. Public quotes, news, and fund disclosures are all
labeled with source and date; the holdings tool opens only when the user explicitly asks about holdings.
"Comprehensive Assessment" remains the stricter full-gate pipeline.

**"Wait" is a normal and important result.** When data is delayed, a factor has no predictive power,
out-of-sample fails, or evidence conflicts, the system will not force a timing call just to produce a
buy or sell answer.

Good questions: what an indicator means, why the current signal changed, whether a backtest is
overfitted, the order of strategy validation, how position size and drawdown are computed.

Bad questions: guaranteed returns, a precise forecast of tomorrow's price, asking the program to
execute trades on your behalf.

## 9. FAQ

### Why is the return high but adoption not recommended?

There may be bull-market exposure, overfitting, parameter luck, survivorship bias, or omitted fees.
Check out-of-sample excess, maximum drawdown, and the cross-instrument result first.

### Why were no proposed trades generated?

Instruments in the watch pool may not have simultaneously cleared the news, factor, trend, and
composite-score thresholds. This is a normal outcome, and thresholds should not be casually lowered
just to produce a trade.

### Why aren't off-exchange funds priced in real time?

Off-exchange fund NAV is generally published after the trading day ends, so a T+1 or longer disclosure
delay is inherent.

### Why does the wealth curve start with only one point?

A new virtual account only has a NAV record for the day it was created. The curve accumulates as daily
updates come in.

## 10. Risk statement

Historical backtests do not imply future returns; probability projection is not price prediction; news
and large-model suggestions can be wrong; public quotes and fund disclosures can both be delayed. None
of these results constitute investment advice.
