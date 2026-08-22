"""集中配置。全部可用环境变量覆盖，没有配置也能启动（LLM 相关缺失时只是情绪打分不可用）。"""
import os
import shutil
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent


def _load_dotenv() -> None:
    """极简 .env 读取，避免多一个依赖。已存在的环境变量优先。"""
    f = BASE_DIR / ".env"
    if not f.exists():
        example = BASE_DIR / ".env.example"
        if not example.exists():
            return
        # 兼容旧版界面的提示：用户曾被引导直接在 .env.example 中填写。
        # 首次启动自动迁移为正式 .env，后续只读正式文件。
        try:
            shutil.copyfile(example, f)
        except OSError:
            f = example
    for line in f.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_dotenv()

# 路径类配置也必须在 .env 载入后读取，否则 QE_DATA_DIR 写进 .env 不会生效。
DATA_DIR = Path(os.getenv("QE_DATA_DIR", BASE_DIR / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "quant.db"

# ---- 大模型 ----
# provider: deepseek | dashscope(通义千问) | openai(任意 OpenAI 兼容端点) | anthropic
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "dashscope").lower()
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "")
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "")

_DEFAULTS = {
    "deepseek": ("https://api.deepseek.com", "deepseek-v4-flash"),
    "dashscope": ("https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen-plus"),
    "openai": ("https://api.openai.com/v1", "gpt-4o-mini"),
    "anthropic": ("https://api.anthropic.com/v1", "claude-sonnet-4-5"),
}
_base, _model = _DEFAULTS.get(LLM_PROVIDER, _DEFAULTS["dashscope"])
LLM_BASE_URL = LLM_BASE_URL or _base
LLM_MODEL = LLM_MODEL or _model

LLM_ENABLED = bool(LLM_API_KEY)
LLM_TIMEOUT = float(os.getenv("LLM_TIMEOUT", "90"))
LLM_CONCURRENCY = int(os.getenv("LLM_CONCURRENCY", "10"))
# 一次请求塞多少条新闻做情绪打分。太大容易被截断，太小则调用次数多。
SENTIMENT_BATCH = int(os.getenv("SENTIMENT_BATCH", "8"))
NEWS_READ_LIMIT = int(os.getenv("NEWS_READ_LIMIT", "240"))
RESEARCH_NEWS_LIMIT = max(40, min(NEWS_READ_LIMIT, int(os.getenv("RESEARCH_NEWS_LIMIT", "160"))))
AUTO_READ_DAILY = os.getenv("AUTO_READ_DAILY", "1") not in ("0", "false", "False")

# ---- 抓取 ----
HTTP_TIMEOUT = float(os.getenv("HTTP_TIMEOUT", "20"))
USER_AGENT = os.getenv(
    "USER_AGENT",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
)
# 每个源单次最多取多少条
PER_SOURCE_LIMIT = int(os.getenv("PER_SOURCE_LIMIT", "30"))
# 定时抓取间隔（分钟）；<=0 关闭定时，只保留手动刷新
CRAWL_INTERVAL_MIN = int(os.getenv("CRAWL_INTERVAL_MIN", "60"))
# 启动时是否立刻抓一次
CRAWL_ON_START = os.getenv("CRAWL_ON_START", "1") not in ("0", "false", "False")

# ---- 服务 ----
HOST = os.getenv("QE_HOST", "127.0.0.1")
PORT = int(os.getenv("QE_PORT", "8770"))
# 前端通常由 file:// 或本机静态服务器打开。来源限制只是第一层，数据接口还会校验
# 启动器传入的随机会话令牌，避免任意外部网页调用 localhost API。
CORS_ORIGINS = os.getenv("QE_CORS", "null,http://127.0.0.1,http://localhost")

# ---- 微信小程序聊天 ----
# 可选的轻量访问令牌。它只能阻挡随手调用，不能代替微信登录鉴权；生产环境建议在网关层限流。
WECHAT_ACCESS_TOKEN = os.getenv("WECHAT_ACCESS_TOKEN", "")
WECHAT_RATE_LIMIT = max(1, int(os.getenv("WECHAT_RATE_LIMIT", "20")))

DISCLAIMER = (
    "以上为模型基于公开新闻的统计性推断，仅供参考，不构成任何投资建议。"
    "新闻情绪与后续价格之间没有稳定因果关系，请勿据此直接下单。"
)
