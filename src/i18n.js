/* Quant Engine UI localization. Business keys and market-source text stay unchanged. */
(function () {
'use strict';

var startupHash = String(location.hash || '');
var startupSearch = String(location.search || '');
function hashValue(name) {
  var m = startupHash.match(new RegExp('(?:^#|&)' + name + '=([^&]*)'));
  try { return m ? decodeURIComponent(m[1]) : ''; } catch (e) { return m ? m[1] : ''; }
}
function queryValue(name) {
  var m = startupSearch.match(new RegExp('(?:^\\?|&)' + name + '=([^&]*)'));
  try { return m ? decodeURIComponent(m[1]) : ''; } catch (e) { return m ? m[1] : ''; }
}

// EXE 直接注入语言最可靠；查询参数和 hash 分别兼容单文件与旧版启动器。
var injected = String(window.__QE_LAUNCH_LANG__ || '');
var requested = injected === 'en-US' || injected === 'zh-CN'
  ? injected : (queryValue('qe_lang') || hashValue('qe_lang'));
if (!requested) {
  try { requested = localStorage.getItem('qe_ui_language') || ''; } catch (e) { /* file storage may be blocked */ }
}
var lang = requested === 'en-US' || requested === 'en' ? 'en-US' : 'zh-CN';
document.documentElement.lang = lang;
try { localStorage.setItem('qe_ui_language', lang); } catch (e2) { /* ignore */ }

var pairs = [
  ['量化引擎 v10.0', 'Quant Engine v10.0'],
  ['量化引擎', 'QUANT ENGINE'], ['— 待载入 —', '— WAITING —'], ['暂无数据', 'No data'],
  ['数据源', 'Source'], ['本地模拟', 'Local simulation'], ['日线 0 根', '0 daily bars'], ['数据截止 —', 'Data through —'],
  ['日线回测图', 'Daily chart'], ['K线 + 20日均线 · 约 4 年日线', 'Candles + MA20 · about 4 years'],
  ['▶ 播放', '▶ Play'], ['⏸ 暂停', '⏸ Pause'], ['⟲ 重置', '⟲ Reset'],
  ['1 倍速', '1×'], ['2 倍速', '2×'], ['5 倍速', '5×'], ['15 倍速', '15×'],
  ['后复权', 'Adjusted'], ['前复权', 'Forward adjusted'], ['不复权', 'Unadjusted'],
  ['⟳ 实时', '⟳ Refresh'], ['◈ 推演', '◈ Projection'], ['演练进度', 'Playback'],
  ['信号面板', 'Signal panel'], ['行情因子', 'Market factors'], ['震荡', 'Sideways'], ['多头', 'Bullish'], ['空头', 'Bearish'],
  ['波动率', 'Volatility'], ['年化 · 60日滚动', 'Annualized · 60-day rolling'],
  ['综合评分', 'Composite score'], ['趋势+动量+期望收益 加权', 'Trend + momentum + EV'],
  ['胜率', 'Win rate'], ['来自参数输入', 'From parameters'], ['赔率', 'Payoff'], ['倍', '×'],
  ['盈亏比 = 目标 ÷ 止损', 'Payoff = target ÷ stop'], ['风险', 'Risk'], ['仓位', 'Position'],
  ['半凯利 · 上限 80%', 'Half Kelly · max 80%'], ['单笔期望收益', 'Expected value'],
  ['胜率×目标 −(1−胜率)×止损', 'Win rate × target − loss rate × stop'],
  ['趋势结构', 'Trend structure'], ['20日均线斜率 / 价格位置 / 量能', 'MA20 slope / price position / volume'],
  ['策略引擎', 'Strategy engine'], ['点击策略查看回测绩效', 'Select a strategy to view its backtest'],
  ['0 个策略', '0 strategies'], ['⌃ 参数', '⌃ Parameters'], ['标的', 'Instrument'],
  ['场内基金', 'Exchange funds'], ['场外基金', 'OTC funds'], ['股票', 'China stocks'], ['美股', 'US stocks'],
  ['板块', 'Sectors'], ['指数', 'Indices'], ['胜率 %', 'Win rate %'], ['止损 %', 'Stop %'],
  ['目标 %', 'Target %'], ['赔率 倍', 'Payoff ×'], ['佣金 ‱', 'Commission ‱'], ['滑点 ‱', 'Slippage ‱'],
  ['初始资金 元', 'Initial cash'], ['止损方式', 'Stop method'], ['固定 %', 'Fixed %'], ['ATR 动态', 'ATR dynamic'],
  ['ATR 倍数', 'ATR multiple'], ['跟踪启动 %', 'Trail trigger %'], ['跟踪回撤 %', 'Trail drawdown %'],
  ['标的库载入中…', 'Loading instrument universe...'], ['更新', 'Update'], ['分析', 'Analyze'], ['验证', 'Validate'], ['资产', 'Assets'],
  ['⛁ 获取数据', '⛁ Load data'], ['AI 研判', 'AI review'], ['✦ 市况策略', '✦ Regime strategy'],
  ['⁙ 10 个策略', '⁙ 10 strategies'], ['↓ 做空组', '↓ Short set'], ['⟲ 反转组', '⟲ Reversal set'],
  ['◎ 因子', '◎ Factors'], ['◈ 配置', '◈ Allocation'], ['清空结果', 'Clear results'],
  ['◧ 持仓', '◧ Holdings'], ['◐ 情绪', '◐ Sentiment'], ['▣ 模拟盘', '▣ Paper trading'],
  ['◆ 财富', '◆ Wealth'], ['◇ 实盘只读', '◇ Live read-only'], ['默认顺序', 'Default order'],
  ['收益 ↓', 'Return ↓'], ['胜率 ↓', 'Win rate ↓'], ['回撤 ↑（小到大）', 'Drawdown ↑'],
  ['盈亏比 ↓', 'Payoff ↓'], ['交易笔数 ↓', 'Trades ↓'], ['全部', 'All'], ['只看做多', 'Long only'],
  ['只看做空', 'Short only'], ['隐藏 0 交易', 'Hide zero trades'], ['只看正收益', 'Positive return'], ['▤ 紧凑', '▤ Compact'],
  ['终端日志', 'Terminal log'], ['开高低收数据流', 'OHLC data stream'], ['清屏', 'Clear'],
  ['对话', 'Chat'], ['量化专家', 'Quant expert'], ['DeepSeek · 正在连接', 'DeepSeek · Connecting'],
  ['清空', 'Clear'], ['上下文', 'Context'], ['等待行情载入', 'Waiting for market data'], ['检测后端', 'Checking backend'],
  ['后端数据执行记录', 'Backend execution'], ['等待启动', 'Waiting'], ['发送', 'Send'],
  ['回车发送 · Shift+回车换行', 'Enter to send · Shift+Enter for new line'],
  ['功能与使用指南', 'Features and guide'], ['从看懂行情到模拟验证', 'From market reading to paper validation'],
  ['✕ 关闭', '✕ Close'], ['新手主线：', 'Beginner workflow: '], ['选择标的', 'Choose an instrument'],
  ['获取行情', 'Load market data'], ['阅读信号', 'Read signals'], ['验证策略', 'Validate strategies'], ['模拟观察', 'Paper observation'],
  ['行情与趋势', 'Market and trend'], ['K 线图：', 'Chart: '], ['推演：', 'Projection: '], ['信号面板：', 'Signal panel: '],
  ['策略研究', 'Strategy research'], ['市况策略：', 'Regime strategy: '], ['10 个策略：', '10 strategies: '],
  ['因子与配置：', 'Factors and allocation: '], ['量化专家：', 'Quant expert: '], ['个人资产', 'Personal assets'],
  ['我的持仓：', 'My holdings: '], ['市场情绪：', 'Market sentiment: '], ['我的财富：', 'My wealth: '],
  ['交易边界', 'Trading boundaries'], ['模拟盘：', 'Paper trading: '], ['实盘只读：', 'Live read-only: '], ['数据日期：', 'Data dates: '],
  ['判断顺序：', 'Decision order: '],
  ['资产研究中心', 'Asset research center'], ['无实盘执行权限', 'NO LIVE EXECUTION'], ['后端检测中…', 'Checking backend...'],
  ['◆ 我的财富', '◆ My wealth'], ['◇ 实盘数据（只读）', '◇ Live data (read-only)'], ['虚拟账户', 'Paper account'],
  ['＋ 新建', '＋ New'], ['⟳ 更新市值', '⟳ Update values'], ['安全确认模式', 'Confirmation mode'], ['归档账户', 'Archive account'],
  ['账户名称', 'Account name'], ['初始假想资金（元）', 'Initial paper cash'], ['执行模式', 'Execution mode'],
  ['安全确认', 'Manual confirmation'], ['模拟自动', 'Paper auto'], ['✓ 创建虚拟账户', '✓ Create paper account'],
  ['尚无虚拟账户。', 'No paper account yet.'], ['模拟总资产', 'Paper total assets'], ['模拟现金', 'Paper cash'],
  ['持仓市值', 'Market value'], ['虚拟持仓', 'Paper holdings'], ['待确认拟交易', 'Pending simulated orders'],
  ['观察池', 'Watchlist'], ['仅支持 A 股与场内 ETF；逗号分隔代码', 'China stocks and ETFs only; separate codes with commas'],
  ['✓ 保存观察池', '✓ Save watchlist'], ['复合信号规则', 'Composite signal rules'],
  ['新闻情绪 + 因子分位 + 趋势；所有百分比均可修改', 'News sentiment + factor percentile + trend; all thresholds are editable'],
  ['✓ 保存规则', '✓ Save rules'], ['模式', 'Mode'], ['新闻买入阈值', 'News buy threshold'], ['因子前列 %', 'Top factor %'],
  ['趋势最低分', 'Minimum trend score'], ['综合最低分', 'Minimum composite score'], ['最大持仓数', 'Max holdings'],
  ['单标的上限 %', 'Per-instrument max %'], ['总仓上限 %', 'Total exposure max %'], ['卖出印花税 ‱', 'Sell stamp tax ‱'],
  ['最低佣金（元）', 'Minimum commission'], ['模拟止损 %', 'Paper stop %'], ['拟交易清单', 'Proposed orders'],
  ['⚙ 生成自动信号', '⚙ Generate signals'], ['✓ 确认模拟成交', '✓ Confirm paper fills'], ['✕ 拒绝', '✕ Reject'],
  ['信号观察表', 'Signal watch table'], ['未达到全部条件的标的只观察，不生成订单', 'Instruments missing any rule remain watch-only'],
  ['T+1 可用数量按买入批次计算', 'T+1 availability is calculated by buy lot'], ['模拟成交记录', 'Paper fills'],
  ['我的财富 · 虚拟账户对比', 'My wealth · paper account comparison'],
  ['总资产、回撤、夏普与沪深300归一化基准', 'Total assets, drawdown, Sharpe and CSI 300 normalized benchmark'],
  ['⟳ 更新全部账户', '⟳ Update all accounts'], ['实盘数据只读 · 自动下单关闭', 'Live data is read-only · auto-ordering disabled'],
  ['账户别名', 'Account alias'], ['⇧ 导入快照', '⇧ Import snapshot'], ['⇩ 快照模板', '⇩ Snapshot template'], ['⟳ 刷新', '⟳ Refresh'],
  ['尚未导入实盘只读快照', 'No live read-only snapshot imported'], ['实盘总资产（只读）', 'Live total assets (read-only)'],
  ['现金', 'Cash'], ['可用现金', 'Available cash'], ['执行权限', 'Execution permission'], ['永久关闭', 'Permanently disabled'],
  ['只读持仓快照', 'Read-only holdings'], ['只读委托快照', 'Read-only orders'], ['只读成交快照', 'Read-only fills'],
  ['自动化下单数据', 'Order-intent data'], ['生成订单意图', 'Generate order intents'], ['⇩ 导出 JSON', '⇩ Export JSON'],
  ['执行权限关闭；数据包不会自动发送。', 'Execution is disabled; data is never sent automatically.'],
  ['◧ 我的持仓', '◧ My holdings'], ['↻ 刷新行情', '↻ Refresh quotes'], ['当日盈亏', 'Daily P&L'], ['累计盈亏', 'Total P&L'],
  ['总成本', 'Total cost'], ['基金录入', 'Add fund'], ['股票录入', 'Add stock'], ['取消修改', 'Cancel edit'],
  ['基金代码', 'Fund code'], ['基金市场', 'Fund market'], ['自动识别基金市场', 'Detect fund market'],
  ['上海场内基金', 'Shanghai exchange fund'], ['深圳场内基金', 'Shenzhen exchange fund'],
  ['投入金额（元）', 'Amount invested'], ['买入日期', 'Purchase date'], ['基金名称（可留空）', 'Fund name (optional)'],
  ['＋ 保存基金持仓', '＋ Save fund holding'], ['股票代码', 'Stock code'], ['股票市场', 'Stock market'], ['自动识别', 'Auto detect'],
  ['上海', 'Shanghai'], ['深圳', 'Shenzhen'], ['纳斯达克', 'NASDAQ'], ['纽交所', 'NYSE'], ['美交所', 'AMEX'],
  ['股数', 'Shares'], ['成本单价', 'Cost per share'], ['股票名称（可留空）', 'Stock name (optional)'],
  ['＋ 保存股票持仓', '＋ Save stock holding'], ['定投计划：', 'Recurring plan:'], ['每期金额（元）', 'Amount per period'],
  ['周期', 'Frequency'], ['每日', 'Daily'], ['每周', 'Weekly'], ['每两周', 'Every two weeks'], ['每月', 'Monthly'],
  ['开始日期', 'Start date'], ['✓ 保存计划', '✓ Save plan'], ['停止定投', 'Stop plan'], ['取消', 'Cancel'],
  ['基金持仓', 'Fund holdings'], ['股票持仓', 'Stock holdings'],
  ['◐ 市场每日情绪', '◐ Daily market sentiment'], ['① 新闻与总览', '① News and overview'],
  ['② 新闻关联', '② News links'], ['③ 对我的持仓', '③ My holdings'], ['⟳ 抓取并阅读', '⟳ Fetch and read'],
  ['◎ 刷新总览', '◎ Refresh overview'], ['加载中…', 'Loading...'], ['⟳ 更新基金持仓', '⟳ Update fund holdings'],
  ['◎ 刷新关联', '◎ Refresh links'], ['正在登记场内基金目录…', 'Indexing exchange funds...'],
  ['正在加载今日新闻关联…', 'Loading today\'s news links...'], ['✦ 生成持仓建议', '✦ Generate holding reference'],
  ['尚未生成持仓建议。', 'No holding reference generated.'],
  ['◈ 概率区间推演', '◈ Probability-range projection'], ['↻ 按当前进度重算', '↻ Recalculate at current bar'],
  ['中位', 'Median'], ['50% 区间', '50% range'], ['半数情况落在此区间', 'Half of outcomes fall in this range'],
  ['90% 区间', '90% range'], ['九成情况落在此区间', '90% of outcomes fall in this range'],
  ['上涨概率', 'Probability of gain'], ['Φ(μ√H/σ)，纯统计外推', 'Φ(μ√H/σ), statistical extrapolation'],
  ['年化波动', 'Annualized volatility'], ['日收益标准差 ×√243', 'Daily return stdev × √243'],
  ['回归斜率(年化)', 'Regression slope (annualized)'], ['最近60根对数价最小二乘', 'OLS on last 60 log prices'],
  ['资产配置研究', 'Asset allocation research'], ['▶ 开始', '▶ Start'], ['每月投入（元）', 'Monthly contribution'],
  ['导出策略与检验结论', 'Export strategy and validation'], ['复制到剪贴板', 'Copy to clipboard'],
  ['因子有效性检验（IC）', 'Factor validity test (IC)'], ['组合回测', 'Portfolio backtest'],
  ['回测绩效报告', 'Backtest performance report'], ['⎘ 导出', '⎘ Export'], ['风险调整口径', 'Risk-adjusted view'],
  ['随机进场基准对照', 'Random-entry benchmark'], ['本策略', 'Strategy'], ['随机中位', 'Random median'],
  ['随机胜出', 'Beat random'], ['百分位', 'Percentile'], ['样本内 / 样本外', 'In-sample / out-of-sample'],
  ['参数敏感性', 'Parameter sensitivity'], ['当前参数超额', 'Current excess return'], ['相邻 8 格均值', '8-neighbor average'],
  ['正超额格子', 'Positive cells'], ['全网格中位', 'Grid median'], ['跨标的扫描', 'Cross-instrument scan'],
  ['▶ 开始扫描', '▶ Start scan'], ['正超额标的', 'Positive excess instruments'], ['超额中位', 'Median excess return'],
  ['本标的排名', 'Current instrument rank'], ['交易明细', 'Trade details'],
  ['自动读取', 'Auto fetch'], ['例如：600519, 300308, 510300', 'Example: 600519, 300308, 510300'],
  ['终端就绪 · 先在上方搜索标的，点', 'Terminal ready · search above, then select'],
  ['载入行情', 'Load data'], ['再点', 'Then select'], ['或', 'or'],
  ['所有绩效均由真实历史日线逐根回测得出，不构成投资建议', 'All performance is calculated from historical daily bars and is not investment advice.'],
  ['普通问答可按需调用后端公开行情、新闻、情绪、基金关联和模拟盘等只读工具；只有明确询问“我的持仓”时才读取持仓。仅供研究参考，不会执行交易。',
    'Questions may call read-only backend tools for public quotes, news, sentiment, fund links and paper accounts. Holdings are read only when explicitly requested. Research only; no trades are executed.'],
  ['先选标的并获取数据，再读 K 线与信号，之后生成策略并查看回测报告；只有通过因子、样本外和跨标的验证的规则，才进入模拟盘观察。',
    'Choose an instrument and load data, read the chart and signals, then generate strategies and inspect their backtests. Only rules that survive factor, out-of-sample and cross-instrument checks should enter paper observation.'],
  ['先选基金、股票、美股、板块或指数，再搜索代码或名称。', 'Choose a fund, China stock, US stock, sector or index, then search by code or name.'],
  ['载入约四年日线，确认数据来源和截止日期。', 'Load about four years of daily bars and confirm the source and cutoff date.'],
  ['结合趋势、波动、胜率、赔率、风险和期望收益。', 'Read trend, volatility, win rate, payoff, risk and expected value together.'],
  ['查看回测、样本外、随机基准、参数敏感性和跨标的结果。', 'Inspect backtest, out-of-sample, random benchmark, sensitivity and cross-instrument results.'],
  ['拟交易先人工确认，只使用虚拟资金记录表现。', 'Confirm proposed orders manually and record performance with virtual cash only.'],
  ['日线、MA20、缩放、播放、暂停、重置和实时更新。', 'Daily bars, MA20, zoom, play, pause, reset and quote refresh.'],
  ['在独立窗口显示概率区间，不修改主 K 线。', 'Shows probability ranges in a separate window without changing the main chart.'],
  ['随当前行情窗口重新计算胜率、赔率、风险、仓位与期望收益。', 'Recalculates win rate, payoff, risk, position and EV for the visible market window.'],
  ['按趋势、震荡或弱势环境匹配规则模板。', 'Matches rule templates to trending, sideways or weak regimes.'],
  ['批量比较收益、胜率、回撤、盈亏比和交易次数。', 'Compares return, win rate, drawdown, payoff and trade count in bulk.'],
  ['检查 IC、分层收益、组合分散、定投和有效前沿。', 'Checks IC, bucket returns, diversification, recurring investment and the efficient frontier.'],
  ['点击右侧“对话”把手展开或收起，左边缘可调宽度；主界面与右侧信号、日志会同步收缩，历史记录继续保留。',
    'Use the Chat handle on the right to open or close the expert. Drag its left edge to resize; the main panels adapt and chat history is retained.'],
  ['基金按金额和日期录入，股票按股数和成本录入，可设置定投跟踪。', 'Funds use amount and purchase date; stocks use shares and unit cost. Recurring tracking is supported.'],
  ['先阅读新闻，再看总览、新闻关联与持仓参考建议。', 'Read the news first, then review the overview, news links and holding references.'],
  ['比较多个虚拟账户与沪深300基准曲线。', 'Compare multiple paper accounts with the CSI 300 benchmark.'],
  ['执行 T+1、佣金、滑点和卖出股票印花税，全部是假钱。', 'Models T+1, commission, slippage and sell-side stamp tax using virtual cash only.'],
  ['只导入脱敏快照和导出订单意图，不登录券商、不提交委托。', 'Imports sanitized snapshots and exports order intents only; it never logs in to a broker or submits orders.'],
  ['场外基金净值和基金季报持仓存在披露滞后。', 'OTC fund NAVs and quarterly fund holdings are published with a delay.'],
  ['先检查数据日期和来源，再看风险与回撤，最后才看收益。推演、新闻情绪、回测和大模型建议都不是未来保证，不应单独作为买卖依据。',
    'Check source and data date first, then risk and drawdown, and return last. Projections, news sentiment, backtests and AI output do not guarantee future results and must not be used alone to trade.'],
  ['详细文字版见项目目录《使用指南.md》。所有结果仅供量化学习与信息整理，不构成投资建议。',
    'See 使用指南.md in the project folder for the full guide. Results are for quantitative learning and information organization, not investment advice.'],
  ['仅保存脱敏资产快照和订单意图数据；不登录券商、不提交委托、不操作真实资金。',
    'Stores sanitized asset snapshots and order-intent data only. It never logs in to a broker, submits orders or touches real funds.'],
  ['由模拟盘待确认清单生成，仅供券商工程师复核', 'Generated from pending paper orders for broker-engineer review only'],
  ['无实盘执行权限。', 'No live execution permission.'],
  ['模拟盘只使用假钱；实盘区域只保存用户主动导入的脱敏数据副本和不可执行订单意图。 程序不保存券商凭证，也不包含登录、下单或撤单代码。结果仅供量化学习，不构成投资建议。',
    'Paper trading uses virtual cash only. The live area stores user-imported sanitized snapshots and non-executable order intents. No broker credentials, login, order or cancel code is included. Not investment advice.'],
  ['按买入日或之后首个交易日的净值换算份额；暂不计申购费', 'Units are derived from the NAV on the purchase date or next trading day; subscription fees are not included.'],
  ['同一标的重复保存＝更新，不会产生重复行', 'Saving the same instrument updates it instead of creating a duplicate.'],
  ['每日自动更新计划进度，只跟踪提醒，不自动扣款或下单', 'Plan progress updates daily for tracking only; no debit or order is executed.'],
  ['持仓数据保存在本机后端的 SQLite 里（', 'Holdings are stored in local backend SQLite ('],
  ['），不上传任何地方。 市值与盈亏由东方财富实时快照现算，', ') and are not uploaded. Market value and P&L use Eastmoney snapshots; '],
  ['非交易时段显示的是最近一个交易日收盘价', 'outside market hours the latest trading-day close is shown'],
  ['；场外基金按最新公布净值（T+1）。', '; OTC funds use the latest published NAV (T+1).'],
  ['先抓取公开财经新闻并逐条标注，再在本页汇总情绪与板块影响。', 'Fetch public financial news and label each item before summarizing sentiment and sector impact.'],
  ['已标注过的新闻不会重复消耗模型。', 'Previously labeled news is not sent to the model again.'],
  ['按“新闻 → 具体股票 → 基金披露重仓”逐级梳理。只展示公开信息关联，不输出买卖结论。',
    'Maps News → specific stocks → disclosed fund holdings. It organizes public information and does not issue trade recommendations.'],
  ['基金十大重仓通常来自季度报告，具有滞后性；不得把披露比例当作今日实时仓位。',
    'Top-ten fund holdings usually come from quarterly reports and are delayed. Disclosed weights are not current live positions.'],
  ['最后把已阅读新闻与持仓关联，给出带原文依据的参考建议。', 'Finally link reviewed news to holdings and provide a reference backed by source items.'],
  ['⚠ 情绪标注与操作建议均由', '⚠ Sentiment labels and action references are inferred by an'],
  ['大模型基于公开新闻推断', 'LLM from public news'], ['得出，', ', and are'],
  ['仅供参考，不构成任何投资建议', 'for reference only, not investment advice'],
  ['。 “新闻关联”只连接公开新闻与基金定期报告，持仓比例有滞后性。新闻情绪与后续价格之间没有稳定因果关系；请勿据此直接下单。',
    '. News links connect public news with periodic fund reports; holdings are delayed. News sentiment has no stable causal relationship with later prices. Do not trade directly from it.'],
  ['用最近', 'Uses the latest '], ['根日线的对数收益估计漂移 μ 与波动 σ，按对数正态分布外推未来', ' daily log returns to estimate drift μ and volatility σ, then extrapolates '],
  ['个交易日的分位区间。', ' trading days of lognormal percentile ranges.'], ['这', 'This is '], ['不是预测', 'not a forecast'],
  [':它只回答"如果未来的波动幅度和过去差不多，价格大概散落在哪个范围"。 方向来自历史漂移的外推，而漂移恰恰是最不稳定的部分 ——',
    ': it only asks where prices may fall if future volatility resembles the past. Direction comes from historical drift, which is the least stable input.'],
  ['：它只回答"如果未来的波动幅度和过去差不多，价格大概散落在哪个范围"。 方向来自历史漂移的外推，而漂移恰恰是最不稳定的部分 ——',
    ': it only asks where prices may fall if future volatility resembles the past. Direction comes from historical drift, which is the least stable input.'],
  ['区间宽度（波动）比中位值（方向）可信得多', 'Range width (volatility) is more defensible than the median direction'],
  ['⚠ 推演是', '⚠ Projection is a'], ['历史波动的统计外推', 'statistical extrapolation of historical volatility'],
  ['，不是预测，也不含任何基本面、消息面与资金面信息。 区间只描述"按过去的波动幅度，未来大概散在哪"，',
    ', not a forecast. It excludes fundamentals, news and fund flows and only describes ranges implied by past volatility.'],
  ['不构成任何投资建议', 'not investment advice'], ['前面所有检验问的是', 'Earlier tests asked'],
  ['"什么时候买"和"买哪个"', 'when to buy and what to buy'], ['，结论都是否定的。 这一页问第三个问题：', '. Their evidence was negative. This page asks a third question:'],
  ['各买多少、多久调一次', 'how much to allocate and how often to rebalance'],
  ['这条路不依赖预测能力，只依赖两件被反复验证的事：分散能降低波动、再平衡能自动高抛低吸。 所有计算含真实费用（佣金最低 5 元、印花税、滑点、100 股整手）。',
    'This path does not require price prediction. It relies on diversification reducing volatility and rebalancing restoring target weights. Calculations include commission minimums, stamp tax, slippage and board lots.'],
  ['点右上「开始」加载宽基篮子，约 10 秒。', 'Select Start to load the broad-index basket; allow about 10 seconds.'],
  ['① 宽基组合 · 分散对回撤的削减', '① Broad-index mix · diversification and drawdown'],
  ['四只宽基 ETF 等权，每季度调回等权，对比各自单买', 'Four broad ETFs, equal weight, rebalanced quarterly, compared with each single holding'],
  ['② 定投 vs 一次性 · 择时到底重不重要', '② Recurring vs lump sum · does entry timing matter?'],
  ['每月固定金额买入，对比期初一次性、以及"最幸运/最倒霉时点"一次性', 'Fixed monthly contributions versus start-date, best-date and worst-date lump sums'],
  ['标的取当前载入的品种；每次买入都按整手与最低 5 元佣金计费', 'Uses the current instrument; each purchase applies board lots and minimum commission.'],
  ['③ 有效前沿 · 同等风险下收益最高的配比', '③ Efficient frontier · highest return for a given risk'],
  ['随机采样 3000 组权重，横轴年化波动、纵轴年化收益', 'Samples 3,000 weight sets; x-axis is annualized volatility and y-axis annualized return'],
  ['⚠ 全部为历史数据回测，不代表未来收益。分散与再平衡能改善风险特征，但', '⚠ All results are historical backtests and do not represent future returns. Diversification and rebalancing may improve risk characteristics but'],
  ['不能保证盈利', 'cannot guarantee profit'], ['， 市场整体下跌时组合同样亏损。本终端为量化教学工具，', '. A portfolio can still lose when the market falls. This terminal is an educational tool and'],
  ['纯文本，可直接粘贴到笔记或聊天中。内容与报告页面完全一致，不含任何未经检验的推断。', 'Plain text for notes or chat. It matches the report and contains no untested inference.'],
  ['先看信号有没有', 'Test whether the signal has'], ['预测力', 'predictive power'],
  ['，再谈回测。做法：把每个因子在第 t 天的取值，与该标的未来 N 天的收益率 做', '. Then backtest it by comparing each factor value at day t with the instrument return over the next N days using'],
  ['秩相关', 'rank correlation'], ['（Spearman）。相关系数 IC 越偏离 0，说明这个因子越能提前区分涨跌。', ' (Spearman). The farther IC is from zero, the more the factor historically separated future returns.'],
  ['口径说明：这里是', 'Method: this is'], ['时序 IC', 'time-series IC'],
  ['（同一标的、跨时间），用于判断择时信号； 机构常说的截面 Rank IC 是"同一天、跨多只标的"排序，两者含义不同。 A 股日线级别：|IC|<0.02 基本无预测力，0.02–0.05 偏弱，>0.05 已算不错；ICIR>0.3 表示这个 IC 比较稳定。',
    ' for one instrument across time. Cross-sectional Rank IC ranks many instruments on one date and means something different. For China daily bars, |IC| below 0.02 is negligible, 0.02–0.05 is weak, and above 0.05 is notable; ICIR above 0.3 suggests greater stability.'],
  ['用该因子给一篮子标的打分，每 10 日调仓、持有得分最好的 3 只 —— 这才是"选品种"，前面所有关卡测的都是"择时"',
    'Score a basket with this factor, rebalance every 10 days and hold the top three. This tests selection; earlier gates test timing.'],
  ['在上表点「组合」按钮开始。需联网取一篮子标的，约 10–30 秒。', 'Select Portfolio in the table to begin. Loading the basket online takes about 10–30 seconds.'],
  ['⚠ IC 只说明"历史上这个因子与后续涨跌有统计关联"，不等于能赚钱：还要扣掉交易成本、考虑信号能否稳定复现。 本终端为量化教学与策略演练工具，',
    '⚠ IC only shows historical association between a factor and later returns. Profitability still depends on costs and stable replication. This is an educational research tool and'],
  ['择时策略的价值通常在降低回撤，不在提高收益 —— 只看"超额"会用错尺子', 'Timing strategies often aim to reduce drawdown rather than maximize return; excess return alone is the wrong yardstick.'],
  ['同样的交易次数、同样的止损止盈，只把进场时点换成随机 —— 检验「信号本身有没有价值」', 'Keep trade count and exits unchanged but randomize entries to test whether the signal adds value.'],
  ['前 70% 当作"你能看到的历史"，后 30% 当作"未来" —— 检验策略是不是只在特定行情里灵', 'Treat the first 70% as visible history and the last 30% as the future to test regime dependence.'],
  ['止损与目标各上下浮动 ±40%，看超额在参数平面上是"一整片"还是"一个孤点" —— 孤点即过拟合。 统一按满仓扫描，与买入持有同口径',
    'Vary stop and target by ±40%. A broad positive area is more robust than an isolated point. The grid uses full exposure for comparison with buy-and-hold.'],
  ['同一条规则拿到一篮子标的上跑 —— 只在一个标的上灵的规律，多半是这个标的的巧合', 'Run the same rule across a basket. A rule that works on only one instrument is likely instrument-specific luck.'],
  ['尚未扫描。需要联网逐个取数，约 10–30 秒。', 'Not scanned. Online data loading may take 10–30 seconds.'],
  ['⚠ 本报告为', '⚠ This report contains'], ['历史数据回测', 'historical backtest'],
  ['结果：按策略规则在已发生的日线上逐根模拟撮合，成交价取信号次日开盘价，已扣除手续费与滑点。 历史回测', ' results. Fills are simulated bar by bar at the next daily open after a signal, net of fees and slippage. Historical backtests'],
  ['不代表未来收益', 'do not represent future returns'], ['，存在过拟合与幸存者偏差；本终端为量化教学与策略演练工具，', ', and may contain overfitting and survivorship bias. This is an educational strategy tool and'],
  ['回测应使用后复权：历史价固定不变，结果可复现。前复权每次分红除权都会改写全部历史价。', 'Backtests should use adjusted history so past prices stay fixed and results remain reproducible. Forward adjustment rewrites history after corporate actions.'],
  ['收起参数区，把高度让给策略列表', 'Collapse parameters to give the strategy list more space'],
  ['在「基金」内搜索：半导体 / 沪深300 / 512480', 'Search funds: semiconductor / CSI 300 / 512480'],
  ['A股佣金常见万2.5，且每笔最低收 5 元', 'Typical China-stock commission is 2.5‱ with a CNY 5 minimum per order'],
  ['买卖各扣一次，模拟实际成交价与理论价的偏差', 'Applied on both sides to model deviation from theoretical prices'],
  ['决定能买几手，以及每笔最低佣金的实际影响。选美股标的时单位为美元', 'Determines board lots and the impact of minimum commission. US-stock values use USD.'],
  ['固定%按开仓价百分比；ATR动态按真实波幅倍数，波动大时自动放宽', 'Fixed stop uses entry-price percentage; ATR dynamic stop widens with volatility.'],
  ['止损距离 = 开仓时的 ATR(14) × 该倍数', 'Stop distance = ATR(14) at entry × this multiple'],
  ['浮盈达到该比例后启动跟踪止盈；填 0 关闭', 'Activate trailing exit after this unrealized gain; enter 0 to disable'],
  ['从最高浮盈回撤该比例即止盈离场', 'Exit after this drawdown from peak unrealized gain'],
  ['自动汇总市况、因子、样本外回测、新闻、持仓与模拟盘', 'Run market, factor, out-of-sample, news, holding and paper-account checks'],
  ['按20日均线斜率判断市况并选择对应策略模板', 'Select a strategy template from the MA20 regime'],
  ['把追涨模板的进场条件取反，用来检验反转逻辑', 'Invert momentum entries to test reversal logic'],
  ['研究分散、定投与有效前沿', 'Study diversification, recurring investment and efficient frontier'],
  ['录入并跟踪基金和股票持仓', 'Add and track fund and stock holdings'],
  ['财经新闻情绪总览与持仓参考建议', 'Financial-news sentiment and holding references'],
  ['假钱信号、拟交易清单与模拟成交', 'Virtual signals, proposed orders and paper fills'],
  ['虚拟账户和沪深300基准对比', 'Compare paper accounts with CSI 300'],
  ['只读脱敏资产快照与不可执行订单意图', 'Read-only sanitized snapshots and non-executable order intents'],
  ['按哪一列排序', 'Sort by column'], ['只看其中一部分', 'Filter results'], ['紧凑行 / 完整卡片', 'Compact rows / full cards'],
  ['展开量化专家对话栏', 'Open Quant Expert'], ['DeepSeek 量化专家对话栏', 'DeepSeek Quant Expert'],
  ['清空本机对话历史', 'Clear local chat history'], ['收起右侧对话栏', 'Collapse the right chat panel'],
  ['关闭右侧对话栏', 'Close the right chat panel'],
  ['询问网页功能、最新新闻、行情、基金、策略验证或风险控制…', 'Ask about the terminal, latest news, quotes, funds, validation or risk...'],
  ['左右拖动调整对话栏宽度', 'Drag horizontally to resize the chat panel'],
  ['重新拉取实时行情并刷新盈亏', 'Reload the latest quote and refresh P&L'],
  ['按当前演练进度重新推演', 'Recalculate from the current playback bar'],
  ['把策略规则、参数与全部检验结论导出为纯文本', 'Export rules, parameters and validation results as plain text']
];

var dict = {};
var extraPairs = [
  ['单位净值数据流', 'NAV data stream'], ['净值', 'NAV'], ['开', 'O '], ['高', ' H '], ['低', ' L '], ['收', ' C '],
  ['日志已清空', 'Log cleared'], ['基金', 'Funds'], ['行业板块', 'Industry sectors'], ['概念板块', 'Theme sectors'],
  ['地域板块', 'Regional sectors'], ['场内', 'Exchange'], ['场外', 'OTC'], ['行业', 'Industry'], ['概念', 'Theme'], ['地域', 'Region'],
  ['在「场内基金」内搜索：半导体 / 沪深300 / 512480', 'Search exchange funds: semiconductor / CSI 300 / 512480'],
  ['在「场外基金」内搜索：易方达消费 / 110022 / hs300', 'Search OTC funds: name / 110022 / hs300'],
  ['在「股票」内搜索：茅台 / 600519 / 宁德时代', 'Search China stocks: name / 600519 / ticker'],
  ['在「美股」内搜索：苹果 / AAPL / 英伟达 / TSLA', 'Search US stocks: Apple / AAPL / Nvidia / TSLA'],
  ['在「板块」内搜索：半导体 / 白酒 / 光伏 / 证券', 'Search sectors: semiconductor / solar / brokers'],
  ['在「指数」内搜索：上证 / 沪深300 / 创业板指', 'Search indices: SSE / CSI 300 / ChiNext'],
  ['常用 · 输入关键字可搜索本分类全部', 'Popular · type to search this category'], ['清单为空', 'List is empty'],
  ['开始在线更新标的库（分页拉取，约需 10 秒）…', 'Updating the online instrument universe; allow about 10 seconds...'],
  ['更新中', 'Updating'], ['请求超时', 'Request timed out'], ['请求已取消', 'Request cancelled'], ['网络不可达', 'Network unavailable'],
  ['该标的无日线数据', 'No daily bars for this instrument'], ['该基金无净值数据', 'No NAV data for this fund'],
  ['净值数据过少', 'Insufficient NAV history'], ['无实时报价', 'No current quote'], ['元', 'CNY'], ['美元', 'USD'], ['股', 'shares'],
  ['双均线金叉', 'Dual-MA bullish cross'], ['趋势跟踪', 'Trend following'],
  ['5日均线上穿20日均线，且20日均线向上', 'MA5 crosses above a rising MA20'], ['5日均线下穿20日均线离场', 'Exit when MA5 crosses below MA20'],
  ['20日线回踩企稳', 'MA20 pullback hold'], ['收盘站上60日均线，最低触及20日均线后收阳', 'Close above MA60 after testing MA20 and finishing up'],
  ['收盘跌破20日均线离场', 'Exit on a close below MA20'], ['唐奇安通道突破', 'Donchian breakout'], ['突破', 'Breakout'],
  ['收盘创 20 日新高', 'Close at a 20-day high'], ['收盘跌破 10 日新低', 'Exit on a 10-day low'],
  ['布林下轨反弹', 'Bollinger lower-band rebound'], ['均值回归', 'Mean reversion'],
  ['前一日收盘跌破布林下轨，当日收阳反包', 'Prior close below lower band, followed by a bullish reversal'],
  ['触及布林中轨或上轨离场', 'Exit at the middle or upper Bollinger band'], ['超卖反转', 'Oversold reversal'],
  ['相对强弱指标由 30 以下上穿 30', 'RSI crosses above 30 from oversold'], ['相对强弱指标上穿 65 离场', 'Exit when RSI crosses above 65'],
  ['零轴上金叉', 'Bullish cross above zero'], ['动量', 'Momentum'], ['快线上穿慢线，且快线在 0 轴上方', 'Fast line crosses above slow line while above zero'],
  ['快线下穿慢线离场', 'Exit when fast line crosses below slow line'], ['量价齐升', 'Price-volume expansion'], ['量价', 'Price and volume'],
  ['成交量 > 5日均量 1.8 倍，收阳且涨幅 > 2%', 'Volume above 1.8× MA5 volume with a gain above 2%'],
  ['缩量至 5日均量 0.7 倍以下离场', 'Exit when volume falls below 0.7× MA5 volume'], ['跳空缺口延续', 'Gap continuation'],
  ['今日开盘高于昨日最高价，且收阳', 'Open above the prior high and close up'], ['收盘回补缺口离场', 'Exit when the gap is filled'],
  ['三连阳启动', 'Three-up-bar launch'], ['连续 3 根阳线且累计涨幅 > 3%', 'Three consecutive up bars with total gain above 3%'],
  ['出现一根跌幅 > 2% 的阴线离场', 'Exit on a down bar below -2%'], ['均线多头排列', 'Bullish MA alignment'],
  ['5日 > 10日 > 20日 > 60日均线，首次成立', 'First occurrence of MA5 > MA10 > MA20 > MA60'],
  ['5日均线跌破10日均线离场', 'Exit when MA5 falls below MA10'], ['波动收缩突破', 'Volatility-contraction breakout'],
  ['真实波幅处于 20 日低位，随后突破 10 日高点', 'ATR near a 20-day low, then price breaks a 10-day high'],
  ['跌破10日均线离场', 'Exit below MA10'], ['月度动量', 'Monthly momentum'], ['波段', 'Swing'],
  ['收盘较 20 日前上涨超 5%，且站上20日均线', '20-day return above 5% and close above MA20'],
  ['收盘较 10 日前下跌超 3% 离场', 'Exit when 10-day return falls below -3%'], ['恐慌抄底', 'Panic rebound'], ['逆势', 'Countertrend'],
  ['相对强弱指标回到 55 以上离场', 'Exit when RSI recovers above 55'], ['平台整理突破', 'Range breakout'], ['跌回区间中位离场', 'Exit below the range midpoint'],
  ['均线死叉买入', 'Buy bearish MA cross'], ['反转', 'Reversal'], ['5日均线下穿20日均线，且20日均线向下 → 买入', 'Buy when MA5 crosses below a falling MA20'],
  ['5日均线上穿20日均线卖出', 'Sell when MA5 crosses above MA20'], ['破位新低买入', 'Buy breakdown to new low'],
  ['收盘跌破 20 日新低 → 买入', 'Buy on a close at a 20-day low'], ['收盘站上10日均线卖出', 'Sell above MA10'],
  ['空头排列买入', 'Buy bearish MA alignment'], ['收盘站上20日均线卖出', 'Sell above MA20'], ['三连阴买入', 'Buy after three down bars'],
  ['连续 3 根阴线且累计跌幅 > 3% → 买入', 'Buy after three down bars totaling below -3%'],
  ['出现涨幅 > 2% 的阳线卖出', 'Sell on an up bar above 2%'], ['跌破平台买入', 'Buy range breakdown'], ['回到区间中位卖出', 'Sell at the range midpoint'],
  ['月度反转', 'Monthly reversal'], ['收盘较 20 日前下跌超 5%，且低于20日均线 → 买入', 'Buy when 20-day return is below -5% and price is below MA20'],
  ['较 10 日前上涨超 3% 卖出', 'Sell when 10-day return exceeds 3%'], ['零轴下死叉买入', 'Buy bearish cross below zero'],
  ['快线上穿慢线卖出', 'Sell when fast line crosses above slow line'], ['双均线死叉做空', 'Short dual-MA bearish cross'],
  ['5日均线下穿20日均线，且20日均线向下 → 开空', 'Open short when MA5 crosses below a falling MA20'],
  ['5日均线上穿20日均线平仓', 'Cover when MA5 crosses above MA20'], ['破位新低做空', 'Short new-low breakdown'],
  ['收盘跌破 20 日新低 → 开空', 'Open short at a 20-day closing low'], ['收盘重回10日均线上方平仓', 'Cover above MA10'],
  ['超买回落做空', 'Short overbought rollover'], ['相对强弱指标由 70 以上下穿 70 → 开空', 'Open short when RSI crosses below 70'],
  ['相对强弱指标跌破 45 平仓', 'Cover when RSI falls below 45'], ['布林上轨滞涨', 'Upper-band stall'],
  ['前日冲破布林上轨，当日收阴 → 开空', 'Open short after an upper-band break followed by a down close'],
  ['回落至布林中轨平仓', 'Cover at the middle Bollinger band'], ['空头排列做空', 'Short bearish MA alignment'],
  ['收盘站上20日均线平仓', 'Cover above MA20'], ['零轴下死叉', 'Bearish cross below zero'], ['快线上穿慢线平仓', 'Cover when fast line crosses above slow line'],
  ['放量长阴', 'High-volume down bar'], ['跌幅 > 3% 且成交量 > 5日均量 1.8 倍 → 开空', 'Open short below -3% with volume above 1.8× MA5 volume'],
  ['收盘站上10日均线平仓', 'Cover above MA10'], ['ATR止损', 'ATR stop'], ['止损', 'Stop'], ['跟踪止盈', 'Trailing exit'],
  ['止盈', 'Target exit'], ['离场信号', 'Exit signal'], ['持仓到期', 'Holding period ended'], ['持仓中', 'Holding'],
  ['随机', 'Random'], ['基准', 'Benchmark'], ['收益率', 'Return'], ['5日动量', '5-day momentum'], ['20日动量', '20-day momentum'],
  ['60日动量', '60-day momentum'], ['60日年化波动', '60-day annualized volatility'], ['真实波幅占比', 'ATR ratio'],
  ['量能', 'Volume strength'], ['量比(量/20日均量)', 'Volume / MA20 volume'], ['5日量能变化', '5-day volume change'], ['趋势', 'Trend'],
  ['偏离20日均线', 'Distance from MA20'], ['20日均线斜率', 'MA20 slope'], ['相对强弱RSI14', 'RSI14'], ['快慢线柱', 'MACD histogram'],
  ['最低', 'Low'], ['最高', 'High'], ['正向', 'Positive'], ['反向', 'Negative'], ['固定持有', 'Fixed holding period'],
  ['ATR 动态止损模式下不使用固定止损', 'Fixed stop is disabled in ATR dynamic mode'], ['固定百分比', 'Fixed percentage'],
  ['K线', 'Candles'], ['20日均线', 'MA20'], ['副图', 'Subchart'], ['实际走势', 'Actual path'], ['90%下沿', '90% lower bound'],
  ['90%区间', '90% range'], ['25%分位', '25th percentile'], ['75%分位', '75th percentile'], ['回归趋势', 'Regression trend'],
  ['无行情数据，请先点「获取数据」', 'No market data. Select Load data first.'], ['⏵ 演练中', '⏵ Playing'],
  ['▣ 演练完成 · 已回放全部', '▣ Playback complete'], ['✗ 样本不足 30 根，无法推演', 'Fewer than 30 bars; projection unavailable'],
  ['⟳ 新增当日K线', '⟳ Added today bar'], ['日线', 'Daily'], ['数据截止', 'Data through'], ['⟳ 实时·休市', '⟳ Live · closed'],
  ['⟳ 快照', '⟳ Snapshot'], ['最新', 'Latest'], ['⟳ 已关闭实时同步', '⟳ Live refresh off'],
  ['手动输入', 'Manual input'], ['样本不足，暂沿用上次数值', 'Insufficient sample; using prior values'],
  ['实测 平均盈利 ÷ 平均亏损', 'Measured average win ÷ average loss'], ['高波动 · 建议减半仓位', 'High volatility · halve reference size'],
  ['中等波动', 'Medium volatility'], ['低波动 · 环境平稳', 'Low volatility · calmer regime'],
  ['◇ 震荡观望', '◇ Sideways'], ['▲ 多头趋势', '▲ Bullish trend'], ['▼ 空头趋势', '▼ Bearish trend'],
  ['站上60日均线', 'Above MA60'], ['处于60日均线下方', 'Below MA60'], ['▥ 卡片', '▥ Cards'],
  ['买入：', 'Buy:'], ['开空：', 'Open short:'], ['卖出：', 'Sell:'], ['平仓：', 'Cover:'], ['点击查看完整回测绩效报告', 'Open the full backtest report'],
  ['多', 'Long'], ['空', 'Short'], ['做多', 'Long'], ['做空', 'Short'], ['买入', 'Buy'], ['开空', 'Open short'], ['卖出', 'Sell'], ['平仓', 'Cover'],
  ['回测(满仓)', 'Backtest (full exposure)'], ['回测', 'Backtest'], ['⌄ 参数', '⌄ Parameters'], ['展开参数区', 'Expand parameters'],
  ['请先点「⛁ 获取数据」载入行情', 'Select Load data first'], ['策略计算正在进行，请等待本批完成', 'Strategy calculation is running; wait for this batch'],
  ['按市况匹配', 'Regime match'], ['批量生成', 'Batch generation'], ['反向做空', 'Reverse short'], ['反转组', 'Reversal set'],
  ['策略列表已清空', 'Strategy list cleared'], ['累计收益', 'Total return'], ['年化', 'Annualized'], ['盈亏比', 'Payoff ratio'],
  ['平均盈利 ÷ 平均亏损', 'Average win ÷ average loss'], ['最大回撤', 'Maximum drawdown'], ['权益峰值到谷底', 'Equity peak to trough'],
  ['累计费用', 'Total costs'], ['占初始资金', 'Of initial cash'], ['策略净值', 'Strategy equity'], ['标的净值', 'Instrument equity'],
  ['夏普', 'Sharpe'], ['卡玛', 'Calmar'], ['策略年化', 'Strategy annualized'], ['买入持有年化', 'Buy-and-hold annualized'],
  ['交易次数', 'Trades'], ['持有期(交易日)', 'Holding days'], ['止损%', 'Stop %'], ['分位阈值%', 'Percentile threshold %'], ['目标%', 'Target %'],
  ['区间', 'Period'], ['持仓', 'Holdings'], ['导出时间：', 'Exported:'], ['【标的与口径】', '[Instrument and method]'],
  ['【策略规则】', '[Strategy rules]'], ['进场：', 'Entry:'], ['离场：', 'Exit:'], ['【绩效】', '[Performance]'],
  ['【风险调整（对比买入并持有）】', '[Risk-adjusted vs buy-and-hold]'], ['【检验关卡】', '[Validation gates]'], ['【免责声明】', '[Disclaimer]'],
  ['✓ 已复制', 'Copied'], ['复制失败，请手动 Ctrl+C', 'Copy failed; use Ctrl+C'], ['未知错误', 'Unknown error'],
  ['等权 · 不调仓', 'Equal weight · no rebalance'], ['等权 · 每季度再平衡', 'Equal weight · quarterly rebalance'],
  ['定投', 'Recurring investment'], ['期初一次性全投', 'Lump sum at start'], ['随机配比', 'Random weights'], ['等权', 'Equal weight'],
  ['最大夏普', 'Maximum Sharpe'], ['单一资产', 'Single asset'], ['年化波动%', 'Annualized volatility %'], ['年化收益%', 'Annualized return %'],
  ['申购费 %', 'Subscription fee %'], ['滑点（场外不适用）', 'Slippage (not used for OTC)'], ['初始资金', 'Initial cash'],
  ['净值走势图', 'NAV chart'], ['单位净值 + 20日均线 · 副图为日涨跌幅 · T+1 公布', 'NAV + MA20 · daily-change subchart · published T+1'],
  ['◆ 载入', '◆ Loaded'], ['历史净值', 'NAV history'], ['日线数据', 'daily bars'], ['天天基金', 'Eastmoney Fund'],
  ['策略', 'Strategy'], ['收益', 'Return'], ['回撤', 'Drawdown'], ['笔', 'Trades'], ['名称', 'Name'],
  ['风格', 'Style'], ['条件', 'Conditions'], ['进场条件', 'Entry condition'], ['离场条件', 'Exit condition'],
  ['仓位建议', 'Position reference'], ['费用', 'Costs'], ['日期', 'Date'], ['方向', 'Side'], ['价格', 'Price'],
  ['数量', 'Quantity'], ['原因', 'Reason'], ['状态', 'Status'], ['结论', 'Conclusion'], ['。', '.'], ['；', ';']
];
pairs = pairs.concat(extraPairs);
for (var i = 0; i < pairs.length; i++) dict[pairs[i][0]] = pairs[i][1];

var rules = [
  [/^日线\s*(\d+)\s*根$/, '$1 daily bars'],
  [/^数据截止\s*(.+)$/, 'Data through $1'],
  [/^1\s*个策略$/, '1 strategy'],
  [/^(\d+)\s*个策略$/, '$1 strategies'],
  [/^演练进度\s*(.*)$/, 'Playback $1'],
  [/^标的库\s*(\d+)\s*个\s*·\s*数据日期\s*(.+)$/, 'Universe $1 · data date $2'],
  [/^近(\d+)次机会：\s*(\d+)胜\s*\/\s*(\d+)负$/, 'Last $1 signals: $2 wins / $3 losses'],
  [/^已显示\s*(\d+)\s*\/\s*(\d+)$/, 'Showing $1 / $2'],
  [/^显示\s*(\d+)\s*\/\s*共\s*(\d+)$/, 'Showing $1 / $2'],
  [/^共\s*(\d+)\s*条$/, '$1 items'],
  [/^共\s*(\d+)$/, 'Total $1'], [/^共\s*(\d+)\s*个$/, 'Total $1'], [/^(\d+)\s*根日线$/, '$1 daily bars'],
  [/^⏸\s*演练暂停于\s*(.+)$/, '⏸ Playback paused at $1'],
  [/^⟲\s*演练已重置至\s*(.+)$/, '⟲ Playback reset to $1'],
  [/^标的分类已切换到「(.+)」，共(\d+)个可选$/, 'Category changed to $1 · $2 instruments'],
  [/^更新中\s*(\d+)\/(\d+)\s*页…$/, 'Updating page $1 / $2...'],
  [/^后端已连接\s*·\s*(.+)$/, 'Backend connected · $1'],
  [/^正在扫描\s*(\d+)\/(\d+)$/, 'Scanning $1 / $2'],
  [/^正在取数\s*(\d+)\/(\d+)$/, 'Loading $1 / $2'],
  [/^已扫描\s*(\d+)\s*个标的$/, 'Scanned $1 instruments'],
  [/^相对当前\s*(.+)$/, 'vs current $1'],
  [/^(.+?)\s*｜\s*起点\s*(.+?)（演练进度\s*(.+?)）｜\s*外推\s*(\d+)\s*个交易日$/, '$1 | start $2 (playback $3) | project $4 trading days'],
  [/^完成\s*·\s*公共区间\s*(\d+)\s*个交易日\s*·\s*3000\s*组配比$/, 'Complete · $1 common trading days · 3,000 allocations'],
  [/^后端已连接$/, 'Backend connected'],
  [/^已连接$/, 'Connected'], [/^未连接$/, 'Disconnected'],
  [/^正在执行$/, 'Running'], [/^全部完成$/, 'Complete'], [/^已停止$/, 'Stopped'],
  [/^完成$/, 'Done'], [/^失败$/, 'Failed'], [/^执行$/, 'Running']
];

function translateCore(value) {
  if (lang !== 'en-US' || !value) return value;
  if (Object.prototype.hasOwnProperty.call(dict, value)) return dict[value];
  var normalized = String(value).replace(/\s+/g, ' ').trim();
  if (normalized !== value && Object.prototype.hasOwnProperty.call(dict, normalized)) return dict[normalized];
  for (var i = 0; i < rules.length; i++) {
    if (rules[i][0].test(normalized)) return normalized.replace(rules[i][0], rules[i][1]);
  }
  return value;
}

function translateDeep(value, depth) {
  if (lang !== 'en-US' || value == null || depth > 12) return value;
  if (typeof value === 'string') return translateCore(value);
  if (typeof value !== 'object' || typeof value === 'function') return value;
  if (Array.isArray(value)) {
    for (var i = 0; i < value.length; i++) value[i] = translateDeep(value[i], depth + 1);
    return value;
  }
  Object.keys(value).forEach(function (key) {
    var child = value[key];
    // Large ECharts data arrays contain thousands of OHLC points. They never need UI translation.
    if (key === 'data' && Array.isArray(child) && child.length > 80) return;
    value[key] = translateDeep(child, depth + 1);
  });
  return value;
}

if (lang === 'en-US' && window.echarts && typeof window.echarts.init === 'function') {
  var originalInit = window.echarts.init;
  window.echarts.init = function () {
    var instance = originalInit.apply(window.echarts, arguments);
    var originalSetOption = instance.setOption;
    instance.setOption = function (option) {
      if (option && typeof option === 'object') translateDeep(option, 0);
      return originalSetOption.apply(instance, arguments);
    };
    return instance;
  };
}

function translateText(value) {
  var m = String(value || '').match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (!m || !m[2]) return value;
  return m[1] + translateCore(m[2]) + m[3];
}

function applyElement(el) {
  if (!el || el.nodeType !== 1) return;
  if (el.tagName === 'OPTION' && !el.hasAttribute('value')) el.setAttribute('value', el.textContent.trim());
  ['title', 'placeholder', 'aria-label'].forEach(function (name) {
    if (!el.hasAttribute(name)) return;
    var before = el.getAttribute(name), after = translateCore(before);
    if (after !== before) el.setAttribute(name, after);
  });
}

function apply(root) {
  if (lang !== 'en-US' || !root) return;
  if (root.nodeType === 3) {
    var translated = translateText(root.nodeValue);
    if (translated !== root.nodeValue) root.nodeValue = translated;
    return;
  }
  if (root.nodeType === 1) applyElement(root);
  var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, null, false);
  var node;
  while ((node = walker.nextNode())) {
    if (node.nodeType === 1) applyElement(node);
    else if (!/^(SCRIPT|STYLE|TEXTAREA)$/.test(node.parentNode && node.parentNode.tagName || '')) {
      var after = translateText(node.nodeValue);
      if (after !== node.nodeValue) node.nodeValue = after;
    }
  }
}

window.QE_I18N = {
  lang: lang,
  isEnglish: lang === 'en-US',
  t: translateCore,
  apply: apply,
  sourceLanguage: 'zh-CN'
};

if (lang === 'en-US') {
  document.title = 'Quant Engine v10.0';
  apply(document.body);
  var observer = new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var m = mutations[i];
      if (m.type === 'characterData') {
        var after = translateText(m.target.nodeValue);
        if (after !== m.target.nodeValue) m.target.nodeValue = after;
      } else if (m.type === 'attributes') {
        applyElement(m.target);
      } else {
        for (var j = 0; j < m.addedNodes.length; j++) apply(m.addedNodes[j]);
      }
    }
  });
  observer.observe(document.body, {
    childList: true, subtree: true, characterData: true, attributes: true,
    attributeFilter: ['title', 'placeholder', 'aria-label']
  });
}
})();
