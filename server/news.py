"""新闻抓取。每个源一个适配器，统一产出：
    {uid, source, title, url, summary, published_at, day}

只使用公开可访问的接口 / RSS，不做签名逆向、不绕验证码或风控。
下面每个源的可用性都是实测过的，注释里写了实测结果与失败原因。
"""
import asyncio
import hashlib
import json
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta

import httpx

from config import HTTP_TIMEOUT, PER_SOURCE_LIMIT, USER_AGENT

CST = timezone(timedelta(hours=8))
_HAS_CJK = re.compile(r"[一-鿿]")


def _uid(source: str, key: str) -> str:
    return hashlib.sha1(f"{source}|{key}".encode("utf-8")).hexdigest()[:20]


def _clean(s: str, limit: int = 400) -> str:
    s = re.sub(r"<[^>]+>", "", s or "")
    s = re.sub(r"&[a-zA-Z#0-9]+;", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s[:limit]


def _from_ts(ts: float) -> tuple[str, str]:
    d = datetime.fromtimestamp(ts, CST)
    return d.isoformat(timespec="seconds"), d.strftime("%Y-%m-%d")


def _from_dt(d: datetime) -> tuple[str, str]:
    d = d.astimezone(CST)
    return d.isoformat(timespec="seconds"), d.strftime("%Y-%m-%d")


def _now() -> tuple[str, str]:
    return _from_ts(datetime.now(CST).timestamp())


# ---------------------------------------------------------------- 中文源

async def src_wallstreetcn(c: httpx.AsyncClient) -> list[dict]:
    """华尔街见闻 快讯。实测公开可取。"""
    r = await c.get("https://api-one.wallstcn.com/apiv1/content/lives",
                    params={"channel": "global-channel", "limit": PER_SOURCE_LIMIT})
    items = (r.json().get("data") or {}).get("items") or []
    out = []
    for it in items:
        text = _clean(it.get("content_text") or it.get("content") or "")
        if not text:
            continue
        pub, day = _from_ts(it.get("display_time") or it.get("created_at") or 0) if it.get("display_time") else _now()
        out.append({"uid": _uid("wallstreetcn", str(it.get("id"))), "source": "华尔街见闻",
                    "title": (it.get("title") or text)[:120], "url": it.get("uri") or "",
                    "summary": text, "published_at": pub, "day": day})
    return out


async def src_eastmoney_live(c: httpx.AsyncClient) -> list[dict]:
    """东方财富 快讯(102) + 要闻(101)。JSONP，实测公开可取。"""
    out = []
    for code, label in (("102", "东方财富·全球快讯"), ("101", "东方财富·要闻")):
        r = await c.get(f"https://newsapi.eastmoney.com/kuaixun/v1/getlist_{code}_ajaxResult_50_1_.html",
                        headers={"Referer": "https://kuaixun.eastmoney.com/"})
        m = re.search(r"var\s+ajaxResult\s*=\s*(\{.*\})\s*;?\s*$", r.text.strip(), re.S)
        if not m:
            continue
        for it in (json.loads(m.group(1)).get("LivesList") or [])[:PER_SOURCE_LIMIT]:
            title = _clean(it.get("title") or "")
            body = _clean(it.get("digest") or it.get("title") or "")
            if not title:
                continue
            ts = it.get("showtime") or ""
            try:
                pub, day = _from_dt(datetime.strptime(ts, "%Y-%m-%d %H:%M:%S").replace(tzinfo=CST))
            except Exception:
                pub, day = _now()
            out.append({"uid": _uid("em" + code, str(it.get("id") or title)), "source": label,
                        "title": title[:120], "url": it.get("url_unique") or it.get("url") or "",
                        "summary": body, "published_at": pub, "day": day})
    return out


async def src_jin10(c: httpx.AsyncClient) -> list[dict]:
    """金十数据 快讯。实测公开可取，用来替代需要签名的财联社。"""
    r = await c.get("https://www.jin10.com/flash_newest.js", headers={"Referer": "https://www.jin10.com/"})
    m = re.search(r"var\s+newest\s*=\s*(\[.*?\])\s*;", r.text, re.S)
    if not m:
        return []
    out = []
    for it in json.loads(m.group(1)):
        if len(out) >= PER_SOURCE_LIMIT:
            break
        d = it.get("data") or {}
        text = _clean(d.get("content") or d.get("pic") or "")
        title = _clean(d.get("title") or text)[:120]
        if not title:
            continue
        # 金十把同一条快讯的英文原文和中文翻译当成两条分别推送（英文条目没有 source/pic 字段）。
        # 英文全球新闻已由 CNBC / MarketWatch / SeekingAlpha 覆盖，这里只留中文，避免同一件事进库两次。
        if not _HAS_CJK.search(text):
            continue
        try:
            pub, day = _from_dt(datetime.strptime(it.get("time", ""), "%Y-%m-%d %H:%M:%S").replace(tzinfo=CST))
        except Exception:
            pub, day = _now()
        out.append({"uid": _uid("jin10", str(it.get("id"))), "source": "金十数据",
                    "title": title, "url": "https://www.jin10.com/", "summary": text or title,
                    "published_at": pub, "day": day})
    return out


async def src_cls(c: httpx.AsyncClient) -> list[dict]:
    """财联社电报 —— 占位适配器，当前不可用。

    实测：/nodeapi/updateTelegraphList 返回 404，/api/sw 返回 405；
    其公开接口现在要求带签名参数（sign/时间戳），逆向签名属于绕过反爬机制，本项目不做。
    如果以后拿到官方授权或开放接口，把实现补在这里即可，其余流程无需改动。
    """
    return []


# ---------------------------------------------------------------- 公告

async def src_szse_notice(c: httpx.AsyncClient) -> list[dict]:
    """深交所 上市公司公告。实测公开可取。"""
    r = await c.post("http://www.szse.cn/api/disc/announcement/annList",
                     params={"random": "0.1"},
                     headers={"Content-Type": "application/json",
                              "Referer": "http://www.szse.cn/disclosure/listed/notice/index.html"},
                     json={"seDate": [], "channelCode": ["listedNotice_disc"],
                           "pageSize": min(PER_SOURCE_LIMIT, 30), "pageNum": 1})
    out = []
    for it in (r.json().get("data") or []):
        title = _clean(it.get("title") or "")
        if not title:
            continue
        ts = (it.get("publishTime") or "")[:19]
        try:
            pub, day = _from_dt(datetime.strptime(ts, "%Y-%m-%d %H:%M:%S").replace(tzinfo=CST))
        except Exception:
            pub, day = _now()
        out.append({"uid": _uid("szse", it.get("id") or title), "source": "深交所公告",
                    "title": title[:120], "url": "http://www.szse.cn" + (it.get("attachPath") or ""),
                    "summary": title, "published_at": pub, "day": day})
    return out


async def src_sse_notice(c: httpx.AsyncClient) -> list[dict]:
    """上交所 上市公司公告。实测需带日期区间与 Referer。"""
    today = datetime.now(CST)
    beg = (today - timedelta(days=3)).strftime("%Y-%m-%d")
    r = await c.get("http://query.sse.com.cn/security/stock/queryCompanyBulletinNew.do",
                    params={"jsonCallBack": "cb", "isPagination": "true",
                            "pageHelp.pageSize": min(PER_SOURCE_LIMIT, 30), "pageHelp.pageNo": 1,
                            "START_DATE": beg, "END_DATE": today.strftime("%Y-%m-%d")},
                    headers={"Referer": "http://www.sse.com.cn/"})
    t = r.text
    try:
        data = json.loads(t[t.index("(") + 1: t.rindex(")")])
    except Exception:
        return []
    # 实测：result 是"列表的列表"（每个元素本身又是一批公告），需要先拍平一层
    raw = data.get("result") or []
    flat: list[dict] = []
    for grp in raw:
        if isinstance(grp, list):
            flat.extend(x for x in grp if isinstance(x, dict))
        elif isinstance(grp, dict):
            flat.append(grp)

    out = []
    for it in flat[:PER_SOURCE_LIMIT]:
        title = _clean(it.get("TITLE") or it.get("BULLETIN_TITLE") or "")
        if not title:
            continue
        ds = (it.get("SSEDATE") or it.get("BULLETIN_DATE") or "")[:10]
        try:
            pub, day = _from_dt(datetime.strptime(ds, "%Y-%m-%d").replace(tzinfo=CST))
        except Exception:
            pub, day = _now()
        out.append({"uid": _uid("sse", (it.get("URL") or "") + title), "source": "上交所公告",
                    "title": title[:120], "url": "http://static.sse.com.cn" + (it.get("URL") or ""),
                    "summary": title, "published_at": pub, "day": day})
    return out


async def src_em_notice(c: httpx.AsyncClient) -> list[dict]:
    """东方财富 公告中心（两市合并，作为交易所直连的补充）。"""
    r = await c.get("https://np-anotice-stock.eastmoney.com/api/security/ann",
                    params={"page_size": min(PER_SOURCE_LIMIT, 30), "page_index": 1,
                            "ann_type": "A", "client_source": "web"},
                    headers={"Referer": "https://data.eastmoney.com/notices/"})
    out = []
    for it in ((r.json().get("data") or {}).get("list") or []):
        title = _clean(it.get("title") or "")
        if not title:
            continue
        ds = (it.get("notice_date") or "")[:19].replace("T", " ")
        try:
            pub, day = _from_dt(datetime.strptime(ds, "%Y-%m-%d %H:%M:%S").replace(tzinfo=CST))
        except Exception:
            pub, day = _now()
        codes = [x.get("stock_code") for x in (it.get("codes") or []) if x.get("stock_code")]
        out.append({"uid": _uid("emann", it.get("art_code") or title), "source": "交易所公告·东财",
                    "title": title[:120],
                    "url": f"https://data.eastmoney.com/notices/detail/{codes[0] if codes else ''}/{it.get('art_code','')}.html",
                    "summary": title, "published_at": pub, "day": day})
    return out


# ---------------------------------------------------------------- 英文 / 全球

async def _rss(c: httpx.AsyncClient, url: str, source: str) -> list[dict]:
    r = await c.get(url)
    try:
        root = ET.fromstring(r.content)
    except ET.ParseError:
        return []
    out = []
    for it in root.iter("item"):
        title = _clean((it.findtext("title") or ""), 200)
        if not title:
            continue
        link = (it.findtext("link") or "").strip()
        desc = _clean(it.findtext("description") or "")
        pubs = (it.findtext("pubDate") or "").strip()
        pub, day = _now()
        for fmt in ("%a, %d %b %Y %H:%M:%S %z", "%a, %d %b %Y %H:%M:%S %Z", "%a, %d %b %Y %H:%M:%S GMT"):
            try:
                d = datetime.strptime(pubs, fmt)
                if d.tzinfo is None:
                    d = d.replace(tzinfo=timezone.utc)
                pub, day = _from_dt(d)
                break
            except Exception:
                continue
        out.append({"uid": _uid(source, link or title), "source": source, "title": title,
                    "url": link, "summary": desc or title, "published_at": pub, "day": day})
        if len(out) >= PER_SOURCE_LIMIT:
            break
    return out


async def src_cnbc(c):        return await _rss(c, "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10001147", "CNBC")
async def src_marketwatch(c): return await _rss(c, "https://feeds.content.dowjones.io/public/rss/mw_topstories", "MarketWatch")
async def src_seekingalpha(c):return await _rss(c, "https://seekingalpha.com/market_currents.xml", "SeekingAlpha")


async def src_reuters(c: httpx.AsyncClient) -> list[dict]:
    """路透 —— 占位适配器，当前不可用。

    实测：feeds.reuters.com/reuters/businessNews 连接超时（该服务已下线），
    reutersagency.com 的 feed 返回 404。路透已停止提供公开 RSS，
    正规替代是购买 Reuters Connect 授权。英文/全球板块改由 CNBC + MarketWatch + SeekingAlpha 承担。
    """
    return []


SOURCES = {
    "华尔街见闻": src_wallstreetcn,
    "东方财富": src_eastmoney_live,
    "金十数据": src_jin10,
    "财联社": src_cls,                 # 占位：需签名，不可用
    "深交所公告": src_szse_notice,
    "上交所公告": src_sse_notice,
    "东财公告": src_em_notice,
    "CNBC": src_cnbc,
    "MarketWatch": src_marketwatch,
    "SeekingAlpha": src_seekingalpha,
    "Reuters": src_reuters,            # 占位：官方 RSS 已下线
}


async def crawl_all() -> dict:
    """并发抓取全部源。单个源失败不影响其它源，失败原因会回报给前端。"""
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT, headers={"User-Agent": USER_AGENT},
                                 follow_redirects=True) as c:
        async def one(name, fn):
            try:
                items = await fn(c)
                return name, items, ""
            except Exception as e:
                return name, [], f"{type(e).__name__}: {e}"[:160]

        results = await asyncio.gather(*(one(n, f) for n, f in SOURCES.items()))

    all_items: list[dict] = []
    per_source = {}
    for name, items, err in results:
        per_source[name] = {"count": len(items), "error": err}
        all_items.extend(items)

    # 同一条快讯可能被多个源转发，按标题再去重一次
    seen, dedup = set(), []
    for it in all_items:
        k = re.sub(r"\W+", "", it["title"])[:40]
        if k and k in seen:
            continue
        seen.add(k)
        dedup.append(it)
    return {"items": dedup, "per_source": per_source}
