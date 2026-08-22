# 量化引擎后端

给终端补上单文件 HTML 做不到的服务能力：**持仓持久化、新闻抓取、大模型情绪与建议、驻留量化专家**。

> ⚠️ 本服务产出的情绪标注与"今日操作建议"，都是**大模型基于公开新闻的推断**，
> **仅供参考，不构成任何投资建议**。新闻情绪与后续价格之间没有稳定因果关系。

## 启动

```bash
cd server
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8770
```

Windows 可以直接双击 `run.bat`，它会建虚拟环境、装依赖、启动服务。

情绪打分、每日建议和驻留量化专家需要大模型，把 `.env.example` 复制成 `.env` 并填 `LLM_API_KEY`：

```ini
LLM_PROVIDER=deepseek         # deepseek | dashscope | openai(任意兼容端点) | anthropic
LLM_API_KEY=sk-xxxx
LLM_MODEL=                    # 留空用各家默认
```

**不填 key 服务照样能起**，只是模型相关功能会返回明确的“未配置”提示，抓取和持仓不受影响。

前端默认连 `http://127.0.0.1:8770`。要改端口，在终端页面的控制台执行
`localStorage.setItem('qe_api','http://127.0.0.1:8888')` 后刷新。

## 新闻源（全部实测过）

| 源 | 状态 | 说明 |
|---|---|---|
| 华尔街见闻 快讯 | ✅ | 公开 JSON |
| 东方财富 全球快讯 + 要闻 | ✅ | JSONP |
| 金十数据 快讯 | ✅ | 只取中文条目——金十把同一条快讯的中英文当两条推 |
| 深交所公告 | ✅ | 官方 API |
| 上交所公告 | ✅ | 需日期区间；`result` 是嵌套列表，已拍平 |
| 东财公告中心 | ✅ | 两市合并，作为交易所直连的补充 |
| CNBC / MarketWatch / SeekingAlpha | ✅ | RSS |
| **Reuters** | ❌ 占位 | 官方公开 RSS 已下线（businessNews 连接超时、agency feed 404）。正规替代是买 Reuters Connect 授权。英文/全球板块现由 CNBC + MarketWatch + SeekingAlpha 承担 |
| **财联社** | ❌ 占位 | 公开接口现要求签名参数（实测 404/405）。逆向签名属于绕过反爬机制，本项目不做 |

两个不可用的源都保留了**空实现的适配器**，注释里写清了原因；将来拿到授权或开放接口，
只需把函数体补上，其余流程无需改动。

单次抓取约 230 条，按标题做跨源去重。默认每 60 分钟自动抓一次（`CRAWL_INTERVAL_MIN=0` 可关掉，
只保留手动刷新）。

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 服务状态、模型配置、库内计数、上次抓取结果 |
| GET | `/api/agent/history` | 读取本机保存的 Agent 多轮对话 |
| POST | `/api/agent/chat` | 发送问题和当前终端摘要，调用已配置的 DeepSeek |
| POST | `/api/agent/chat/start` | 异步启动普通对话；DeepSeek 可按需选择后端只读工具 |
| GET | `/api/agent/chat/status` | 查询普通对话的工具调用和回答进度 |
| POST | `/api/agent/research` | 汇总行情、因子、样本外回测、新闻、持仓和模拟盘，生成条件化综合研判 |
| POST | `/api/agent/research/start` | 后台启动带数据门禁的综合研判任务 |
| GET | `/api/agent/research/status` | 查询行情复核、新闻分类、量化检验、资产读取和模型阶段的实时记录 |
| DELETE | `/api/agent/history` | 清空本机 Agent 对话历史 |
| GET | `/api/holdings` | 持仓列表 |
| POST | `/api/holdings` | 新增/更新（按 secid 幂等，重复提交是更新不是插入） |
| DELETE | `/api/holdings/{id}` | 删除 |
| POST | `/api/news/refresh` | 立刻抓取全部源，返回每个源的条数与失败原因 |
| GET | `/api/news?day=&limit=&unscored=` | 新闻列表（含情绪标注） |
| POST | `/api/sentiment/run?day=&limit=` | 给未打分的新闻做情绪标注 |
| GET | `/api/sentiment/overview?day=` | 当日情绪总览 + 板块热度 |
| POST | `/api/advice/generate` | 汇总当日新闻 + 持仓，生成参考建议 |
| GET | `/api/advice?day=` | 取已生成的建议 |
| PUT | `/api/holdings/{id}/dca` | 保存或停止持仓定投跟踪计划 |
| POST | `/api/news/read/start` | 后台启动“抓取新闻 + 模型阅读标注” |
| GET | `/api/news/read/status` | 查询阅读批次、百分比和已标注条数 |
| POST | `/api/fund-holdings/register` | 登记基金目录（不联网，幂等写入） |
| POST | `/api/fund-holdings/sync?limit=&held_only=` | 分批抓取天天基金/晨星十大重仓，持仓基金优先 |
| GET | `/api/fund-holdings/status` | 基金目录、已同步基金、重仓行数与最近更新时间 |
| GET | `/api/news-links?day=&limit=` | 输出新闻 → 股票 → 基金三级关联 |
| GET/POST | `/api/paper/accounts` | 列出或新建虚拟账户（默认假想资金 10 万元） |
| GET/PUT/DELETE | `/api/paper/accounts/{id}` | 读取、修改或归档虚拟账户 |
| PUT | `/api/paper/accounts/{id}/watchlist` | 替换账户观察池 |
| POST | `/api/paper/accounts/{id}/signals` | 生成复合信号和拟交易清单；模拟自动模式会写入假钱成交 |
| POST | `/api/paper/accounts/{id}/execute` | 人工确认选中的拟交易；只执行本地模拟撮合 |
| POST | `/api/paper/accounts/{id}/reject` | 拒绝待确认拟交易 |
| POST | `/api/paper/accounts/{id}/refresh` | 更新虚拟持仓市值、账户净值与基准 |
| GET | `/api/paper/wealth?refresh=true` | 多账户财富指标和净值曲线 |
| GET | `/api/live/read-only/status` | 只读快照、订单意图和执行锁定状态 |
| POST/GET | `/api/live/read-only/snapshot` | 导入或读取脱敏资产快照；拒绝凭证字段 |
| POST | `/api/live/read-only/order-intents/from-paper/{id}` | 从模拟盘待确认清单生成不可执行订单意图 |
| GET | `/api/live/read-only/order-intents` | 读取订单意图数据 |
| GET | `/api/live/read-only/order-intents/export` | 导出带只读锁定标志的 JSON 数据包 |

## 数据

SQLite 单文件 `data/quant.db`，核心表包括：`holdings` / `news` / `sentiment` / `advice` /
`fund_profiles` / `fund_stock_holdings` / `paper_accounts` / `paper_watchlist` / `paper_positions` /
`paper_lots` / `paper_signals` / `paper_proposals` / `paper_trades` / `paper_equity` /
`live_snapshots` / `order_intents` / `meta`。
**持仓数据只存在你本机**，服务默认只监听 `127.0.0.1`，不上传任何地方。

基金重仓数据保留 `weight`（占基金净值比例）、`report_date`、`source`、`source_url` 和抓取时间。
天天基金用于批量覆盖；用户持仓基金同时读取晨星公开页面做来源核对。基金定期报告通常按季度披露，
因此关联结果只表示报告期暴露，不表示基金今日仍持有或仍保持相同比例。
后端每天自动按“用户持仓优先、最久未同步 ETF 其次”的顺序轮转 40 只；前端手动更新每批推进 60 只。

模拟盘在每日后台任务中先更新市值，再生成复合信号；安全模式停在拟交易清单等待人工确认，
模拟自动模式只把结果写入上述 SQLite 表。`paper_lots` 按买入日期保存剩余批次，执行卖出时只读取
早于当天的批次，因此当天买入不会被同日卖出。默认卖出股票印花税为 5‱；ETF 不计印花税。
佣金与滑点属于可调整的模拟参数，不能被理解为任何券商对用户账户的实际报价。

`live_snapshots` 只保存用户主动导入的标准化脱敏字段；敏感凭证字段、超过 2MB 的快照和缺少只读确认标记的请求都会被拒绝。
`order_intents` 只保存 `draft` 状态的数据契约，固定 `execution_enabled=false`，没有券商委托号、已提交状态或执行路由。

## 设计取舍

**日常持仓行情仍由前端负责，综合研判会做后端独立复核。** 持仓的市值/当日盈亏/累计盈亏，由前端复用已有的东方财富快照通道现算，
后端保存代码、类型和录入依据：基金保存投入金额、买入日期、买入净值及换算份额；股票保存
股数与成本单价。这样避免在两处维护两套行情源，也让持仓面板在后端没起时
至少还能看到行情。执行“综合研判”时，后端会额外通过东方财富/腾讯日线独立核对标的、截止日、
最新价和数据指纹；再强制完成当日新闻抓取与板块分类。任一门禁失败都不会调用 DeepSeek 生成建议。

**依据必须可追溯。** 建议里的每条新闻依据，都是模型引用输入里的**编号**、由服务端还原成
真实标题/来源/链接的，不是模型自由生成的"某消息"。模型引用越界编号会被直接丢弃。

**新闻关联不是荐股。** 系统只在情绪标签为利好且置信度达到门槛时，将模型识别的公司代码与
基金披露重仓做数据库连接；输出中不生成“买入”“加仓”等动作词。每条基金关联都显示原新闻、
占净值比例、报告期和来源链接。

**模型输出一律不信任。** 情绪打分按 `idx` 回填而不是按顺序（模型会乱序、会漏条）；
非法 label 回落为"中性"、置信度夹到 [0,1]、伪造的 secid 丢弃、模型漏掉的持仓补成"持有 + 无依据"。
这些都有覆盖测试。

**模拟成交与实盘隔离。** `paper_engine.py` 不导入 QMT、券商 SDK，也没有网络委托函数；所谓“自动模式”
只是免去人工勾选并自动写入本地假钱成交。实盘能力必须由独立进程、独立凭证、独立数据库和券商工程师实现，
不得通过替换模拟撮合函数的方式接入。边界与验收要求见项目根目录 `实盘接入设计文档.md`。
