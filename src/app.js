/* ============================================================
   量化引擎 v10.0  —  单文件量化演练终端
   历史回测 / 策略演练教学工具，不构成投资建议
   ============================================================ */
(function () {
'use strict';

/* ---------- 0. 基础工具 ---------- */
var $ = function (id) { return document.getElementById(id); };
var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
var fx = function (v, d) { return (isFinite(v) ? v : 0).toFixed(d === undefined ? 2 : d); };
var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
function now() { var d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }
function px(v) { return v >= 1000 ? v.toFixed(1) : v >= 10 ? v.toFixed(2) : v.toFixed(3); }

/* 顶部加载进度条 */
var LB = { el: $('loadbar'), bar: $('loadbar').firstElementChild, timer: 0 };
function lbStart() {
  clearInterval(LB.timer); LB.el.classList.add('on');
  var p = 0; LB.bar.style.width = '4%';
  LB.timer = setInterval(function () {
    p += (88 - p) * 0.12 + 0.6; LB.bar.style.width = Math.min(p, 90) + '%';
  }, 130);
}
function lbSet(pct) { clearInterval(LB.timer); LB.el.classList.add('on'); LB.bar.style.width = clamp(pct, 0, 100) + '%'; }
function lbDone() {
  clearInterval(LB.timer); LB.bar.style.width = '100%';
  setTimeout(function () { LB.el.classList.remove('on'); LB.bar.style.width = '0%'; }, 420);
}

/* 终端日志 */
var LOGBODY = $('logBody'), LOGSCROLL = $('logScroll'), MAXLN = 260;
function log(html, cls, noTs) {
  var d = document.createElement('div');
  d.className = 'ln' + (cls ? ' ' + cls : '');
  d.innerHTML = noTs ? html : '<span class="ts">' + now() + '</span> ' + html;
  LOGBODY.appendChild(d);
  while (LOGBODY.childElementCount > MAXLN) LOGBODY.removeChild(LOGBODY.firstChild);
  LOGSCROLL.scrollTop = LOGSCROLL.scrollHeight;
}
var logSym = null;
function logBar(sym, b, prevC) {
  var otc = !!(D && D.otc);
  if (sym !== logSym) {
    logSym = sym;
    log('──── <span class="sym">' + esc(sym) + '</span> ' + (otc ? '单位净值数据流' : '开高低收数据流') + ' ────', 'sys');
  }
  var chg = prevC ? (b.c - prevC) / prevC * 100 : 0;
  var cl = chg >= 0 ? 'up' : 'dn';
  var body = otc
    ? '净值 ' + px(b.c)
    : '开' + px(b.o) + ' 高' + px(b.h) + ' 低' + px(b.l) + ' 收' + px(b.c);
  log('<span class="ts">' + b.d.slice(5) + '</span> <span class="' + cl + '">' + body + '</span> ' +
      '<span class="' + cl + '">' + (chg >= 0 ? '+' : '') + fx(chg) + '%</span>', null, true);
}
$('btnLogClr').onclick = function () { LOGBODY.innerHTML = ''; logSym = null; log('日志已清空', 'sys'); };

/* 数字滚动动效 */
var rollState = {};
function roll(id, target, dec, unit) {
  var el = $(id); if (!el) return;
  var from = rollState[id] === undefined ? 0 : rollState[id];
  if (!isFinite(target)) target = 0;
  var t0 = performance.now(), dur = 620, settled = false;
  function paint(v) { el.innerHTML = fx(v, dec) + (unit ? '<span class="u">' + unit + '</span>' : ''); }
  function step(t) {
    var k = clamp((t - t0) / dur, 0, 1);
    var e = 1 - Math.pow(1 - k, 3);
    paint(from + (target - from) * e);
    if (k < 1) { if (!settled) requestAnimationFrame(step); }
    else { settled = true; rollState[id] = target; }
  }
  requestAnimationFrame(step);
  // 页面不可见时 rAF 会被挂起，用定时器兜底，保证数值最终落到目标
  setTimeout(function () { if (!settled) { settled = true; rollState[id] = target; paint(target); } }, dur + 160);
}
function bar(id, pct, color) {
  var el = $(id); if (!el) return;
  el.style.width = clamp(pct, 0, 100) + '%';
  if (color) el.style.background = color;
}
setInterval(function () { $('clock').textContent = now(); }, 1000);

/* ============================================================
   1. 标的库（全市场股票 / 基金 / 板块 / 指数）
   ============================================================ */
var LSKEY = 'qe_universe_v2';   // v2 起加入场外基金与拼音字段，换 key 以弃用旧缓存
var DB = { ts: '', list: [], byId: {}, byCat: {} };
var CATS = ['场内基金', '场外基金', '股票', '美股', '板块', '指数'];
/* 原始分组 → 界面分类 */
var CAT_OF = {
  '基金': '场内基金', '场外基金': '场外基金', '股票': '股票', '美股': '美股',
  '行业板块': '板块', '概念板块': '板块', '地域板块': '板块', '指数': '指数'
};
var GRP_TAG = {
  '股票': ['s', '股票'], '基金': ['f', '场内'], '场外基金': ['o', '场外'], '美股': ['u', '美股'],
  '行业板块': ['b', '行业'], '概念板块': ['b', '概念'], '地域板块': ['b', '地域'], '指数': ['i', '指数']
};
var GRP_RANK = { '行业板块': 0, '概念板块': 1, '地域板块': 2, '基金': 0, '场外基金': 0, '股票': 0, '美股': 0, '指数': 0 };
var CAT = '场内基金';
var CAT_PH = {
  '场内基金': '在「场内基金」内搜索：半导体 / 沪深300 / 512480',
  '场外基金': '在「场外基金」内搜索：易方达消费 / 110022 / hs300',
  '股票': '在「股票」内搜索：茅台 / 600519 / 宁德时代',
  '美股': '在「美股」内搜索：苹果 / AAPL / 英伟达 / TSLA',
  '板块': '在「板块」内搜索：半导体 / 白酒 / 光伏 / 证券',
  '指数': '在「指数」内搜索：上证 / 沪深300 / 创业板指'
};
/* 各分类的常用标的（搜索框为空时展示） */
var QUICK = {
  '场内基金': ['1.510300', '0.159915', '1.588000', '1.510500', '1.510050', '1.512480', '1.512690',
    '1.512170', '1.512880', '1.512800', '1.518880', '1.513050', '1.515790', '1.516160', '0.159928', '1.515030'],
  '场外基金': ['OF.000051', 'OF.000961', 'OF.000008', 'OF.110022', 'OF.161725', 'OF.005827',
    'OF.163402', 'OF.003096', 'OF.001594', 'OF.007531', 'OF.012348', 'OF.008888'],
  '股票': ['1.600519', '0.000858', '1.601318', '1.600036', '0.000001', '0.300750', '0.002594',
    '1.600900', '1.601899', '0.002415', '1.600030', '1.601088'],
  '美股': ['107.SPY', '105.QQQ', '105.AAPL', '105.NVDA', '105.MSFT', '105.GOOGL', '105.AMZN',
    '105.META', '105.TSLA', '106.TSM', '106.BRK_B', '106.KO'],
  '板块': ['90.BK1036', '90.BK1277', '90.BK0473', '90.BK1283', '90.BK1216', '90.BK1031'],
  '指数': ['1.000001', '0.399001', '0.399006', '1.000300', '1.000905', '1.000852', '1.000688']
};
var isOTC = function (t) { return !!t && t.id.slice(0, 3) === 'OF.'; };

function loadUniverse(u) {
  DB.ts = u.ts; DB.list = []; DB.byId = {}; DB.byCat = {};
  CATS.forEach(function (c) { DB.byCat[c] = []; });
  Object.keys(u.data).forEach(function (g) {
    var cat = CAT_OF[g]; if (!cat) return;
    var lines = u.data[g].split('\n');
    for (var i = 0; i < lines.length; i++) {
      var s = lines[i]; if (!s) continue;
      var p = s.split('|'); if (p.length < 2) continue;
      var id = p[0], nm = p[1], py = p[2] || '';
      if (DB.byId[id]) continue;
      var it = { id: id, code: id.slice(id.indexOf('.') + 1), name: nm, py: py.toLowerCase(), g: g, cat: cat, r: GRP_RANK[g] || 0 };
      DB.list.push(it); DB.byId[id] = it; DB.byCat[cat].push(it);
    }
  });
  paintDbState();
}
function paintDbState() {
  $('dbTxt').textContent = '标的库 ' + DB.list.length + ' 个 · 更新于 ' + (DB.ts || '—');
  $('dbTxt').title = CATS.map(function (c) { return c + ' ' + (DB.byCat[c] || []).length; }).join(' · ');
  var btns = $('cbTabs').querySelectorAll('button');
  for (var i = 0; i < btns.length; i++) {
    var c = btns[i].dataset.cat;
    btns[i].querySelector('.cnt').textContent = (DB.byCat[c] || []).length || '';
    btns[i].classList.toggle('on', c === CAT);
  }
}

/* 搜索：只在当前分类内匹配。精确代码 > 名称前缀 > 代码前缀 > 名称包含 */
function searchDB(q) {
  var pool = DB.byCat[CAT] || [];
  q = (q || '').trim();
  if (!q) {
    var out = [], ids = QUICK[CAT] || [];
    for (var i = 0; i < ids.length; i++) { var it = DB.byId[ids[i]]; if (it && it.cat === CAT) out.push(it); }
    if (!out.length) out = pool.slice(0, 40);
    return { list: out, quick: true, pool: pool.length };
  }
  var lo = q.toLowerCase();
  var A = [], B = [], C = [], Dd = [], n = pool.length;
  for (var j = 0; j < n; j++) {
    var t = pool[j];
    if (t.code === q) { A.push(t); continue; }
    var p = t.name.indexOf(q);
    if (p === 0) { B.push(t); continue; }
    if (t.code.toLowerCase().indexOf(lo) === 0) { C.push(t); continue; }
    if (t.py && t.py.indexOf(lo) === 0) { C.push(t); continue; }   // 拼音首字母，如 hs300
    if (p > 0 || t.name.toLowerCase().indexOf(lo) >= 0) Dd.push(t);
  }
  var cmp = function (a, b) { return a.r - b.r || a.name.length - b.name.length; };
  A.sort(cmp); B.sort(cmp); C.sort(cmp); Dd.sort(cmp);
  return { list: A.concat(B, C, Dd).slice(0, 80), quick: false, pool: pool.length };
}

/* ---------- 搜索下拉交互 ---------- */
var SEL = null, cbIdx = -1, cbItems = [];
var IN = $('fSym'), DROP = $('cbDrop');

function hl(text, q) {
  if (!q) return esc(text);
  var i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return esc(text);
  return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length));
}
function renderDrop(q) {
  var r = searchDB(q);
  cbItems = r.list; cbIdx = -1;
  var h = '<div class="cb-hd">' + (r.quick
    ? CAT + '常用 · 输入关键字可搜索本分类全部 ' + r.pool + ' 个'
    : CAT + '内匹配 ' + r.list.length + (r.list.length >= 80 ? '+' : '') + ' 个 · ↑↓ 选择，回车确认') + '</div>';
  if (!r.list.length) {
    var code6 = /^\d{6}$/.test(q.trim());
    h += '<div class="cb-empty">「' + CAT + '」分类下未找到「' + esc(q) + '」' +
      (code6 ? '<br><b class="cy">回车可直接按代码 ' + esc(q.trim()) + ' 取数</b>' : '<br>换个关键字，或点上方标签切换分类') +
      '</div>';
  } else {
    for (var i = 0; i < r.list.length; i++) {
      var t = r.list[i], tag = GRP_TAG[t.g] || ['', t.g];
      h += '<div class="cb-it" data-i="' + i + '"><span class="tp ' + tag[0] + '">' + tag[1] + '</span>' +
        '<span class="nm">' + hl(t.name, q) + '</span><span class="cd">' + hl(t.code, q) + '</span></div>';
    }
  }
  DROP.innerHTML = h;
  DROP.classList.add('on');
  positionDrop();
}
/* 下方空间不够时向上弹出，并把高度限制在可视区内 */
function positionDrop() {
  var r = IN.getBoundingClientRect();
  var below = window.innerHeight - r.bottom - 12, above = r.top - 12;
  if (below >= 180 || below >= above) {
    DROP.style.top = 'calc(100% + 3px)'; DROP.style.bottom = 'auto';
    DROP.style.maxHeight = Math.max(120, Math.min(268, below)) + 'px';
  } else {
    DROP.style.top = 'auto'; DROP.style.bottom = 'calc(100% + 3px)';
    DROP.style.maxHeight = Math.max(120, Math.min(268, above)) + 'px';
  }
}
function closeDrop() { DROP.classList.remove('on'); cbIdx = -1; }
function markIdx() {
  var els = DROP.querySelectorAll('.cb-it');
  for (var i = 0; i < els.length; i++) els[i].classList.toggle('on', i === cbIdx);
  if (cbIdx >= 0 && els[cbIdx]) els[cbIdx].scrollIntoView({ block: 'nearest' });
}
function pick(t) {
  SEL = t;
  IN.value = t.name + '  ' + t.code;
  closeDrop(); IN.blur();
  log('已选择标的 <span class="sym">' + esc(t.name) + '</span>（' + t.code + ' · ' + t.g + '），点「获取数据」载入行情', 'sys');
}
IN.addEventListener('focus', function () { IN.select(); renderDrop(''); });
IN.addEventListener('input', function () { renderDrop(IN.value); });
IN.addEventListener('keydown', function (e) {
  if (!DROP.classList.contains('on')) { if (e.key === 'ArrowDown') renderDrop(IN.value); return; }
  if (e.key === 'ArrowDown') { e.preventDefault(); cbIdx = Math.min(cbIdx + 1, cbItems.length - 1); markIdx(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); cbIdx = Math.max(cbIdx - 1, 0); markIdx(); }
  else if (e.key === 'Enter') {
    e.preventDefault();
    if (cbIdx >= 0 && cbItems[cbIdx]) pick(cbItems[cbIdx]);
    else if (cbItems.length) pick(cbItems[0]);
    else { closeDrop(); doFetch(); }
  } else if (e.key === 'Escape') closeDrop();
});
DROP.addEventListener('mousedown', function (e) {
  var it = e.target.closest ? e.target.closest('.cb-it') : null;
  if (!it) return;
  e.preventDefault();
  pick(cbItems[+it.dataset.i]);
});
function selText(t) { return t ? t.name + '  ' + t.code : ''; }
function restoreInput() { if (SEL && IN.value.trim() !== selText(SEL)) IN.value = selText(SEL); }
document.addEventListener('mousedown', function (e) {
  if (!DROP.contains(e.target) && e.target !== IN) { closeDrop(); restoreInput(); }
});

/* 分类切换：基金 / 股票 / 板块 / 指数 —— 搜索只在当前分类内进行 */
$('cbTabs').addEventListener('click', function (e) {
  var b = e.target.closest ? e.target.closest('button') : null;
  if (!b || !b.dataset.cat || b.dataset.cat === CAT) return;
  CAT = b.dataset.cat;
  IN.placeholder = CAT_PH[CAT] || '';
  paintDbState();
  IN.value = '';
  IN.focus();
  renderDrop('');
  log('标的分类已切换到「' + CAT + '」，共 ' + (DB.byCat[CAT] || []).length + ' 个可选', 'sys');
});

/* ---------- 在线更新标的库 ---------- */
var DBGROUPS = [
  ['股票', 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048'],
  ['基金', 'b:MK0021,b:MK0022,b:MK0023,b:MK0024'],
  ['行业板块', 'm:90+t:2'], ['概念板块', 'm:90+t:3'], ['地域板块', 'm:90+t:1'],
  ['指数', 'm:1+t:1'], ['指数', 'm:0+t:5'],
  ['美股', 'm:105,m:106,m:107']
];
function listUrl(fsv, pn) {
  return 'https://push2.eastmoney.com/api/qt/clist/get?cb=__CB__&pn=' + pn + '&pz=100' +
    '&po=1&np=1&fltt=2&invt=2&fid=f12&fs=' + encodeURIComponent(fsv) + '&fields=f12,f13,f14&_=' + Date.now();
}
function getListPage(fsv, pn, tries) {
  tries = tries || 0;
  return jsonp(listUrl(fsv, pn), 15000).then(function (j) {
    if (!j || !j.data) return { total: 0, list: [] };
    return { total: j.data.total, list: (j.data.diff || []).map(function (d) { return d.f13 + '|' + d.f12 + '|' + d.f14; }) };
  }).catch(function (e) {
    if (tries < 3) return new Promise(function (r) { setTimeout(r, 900 * (tries + 1)); }).then(function () { return getListPage(fsv, pn, tries + 1); });
    throw e;
  });
}
var dbBusy = false;
function refreshDB() {
  if (dbBusy) return;
  dbBusy = true; $('btnDb').disabled = true;
  var bag = {}, done = 0, totalPages = 0;
  log('开始在线更新标的库（分页拉取，约需 10 秒）…', 'sys');
  lbSet(3);

  var chain = Promise.resolve();
  var tasks = [];
  DBGROUPS.forEach(function (g) {
    chain = chain.then(function () {
      return getListPage(g[1], 1).then(function (first) {
        var pages = Math.max(1, Math.ceil(first.total / 100));
        totalPages += pages;
        (bag[g[0]] = bag[g[0]] || []).push.apply(bag[g[0]], first.list);
        done++;
        for (var p = 2; p <= pages; p++) tasks.push([g[0], g[1], p]);
      });
    });
  });

  chain.then(function () {
    // 两路并发、每次间隔 160ms，避免被接口限流
    var i = 0;
    function worker() {
      if (i >= tasks.length) return Promise.resolve();
      var t = tasks[i++];
      return getListPage(t[1], t[2]).then(function (r) {
        (bag[t[0]] = bag[t[0]] || []).push.apply(bag[t[0]], r.list);
        done++;
        $('dbTxt').textContent = '更新中 ' + done + '/' + (totalPages || '?') + ' 页…';
        lbSet(4 + done / Math.max(totalPages, 1) * 92);
        return new Promise(function (rs) { setTimeout(rs, 160); }).then(worker);
      });
    }
    return Promise.all([worker(), worker()]);
  }).then(function () {
    // 场外基金清单（天天基金全量 js，定义全局 r）
    try { delete window.r; } catch (e) { window.r = void 0; }
    return loadScript('https://fund.eastmoney.com/js/fundcode_search.js?v=' + Date.now(), 30000)
      .then(function () {
        var a = window.r;
        if (!a || !a.length) throw new Error('清单为空');
        // 场内 ETF/LOF 也在这份清单里，剔掉以保证两个分类互不重叠
        var inCodes = {};
        (bag['基金'] || []).forEach(function (row) { inCodes[row.split('|')[1]] = 1; });
        bag['场外基金'] = a.filter(function (x) { return x && x[0] && x[2] && !inCodes[x[0]]; })
          .map(function (x) { return 'OF|' + x[0] + '|' + x[2] + '|' + (x[1] || ''); });
        $('dbTxt').textContent = '场外基金 ' + bag['场外基金'].length + ' 只…';
      })
      .catch(function (e) {
        log('· 场外基金清单更新失败（' + e.message + '），保留原有 ' + (DB.byCat['场外基金'] || []).length + ' 只', 'sys');
        var keep = (DB.byCat['场外基金'] || []);
        if (keep.length) bag['场外基金'] = keep.map(function (t) { return 'OF|' + t.code + '|' + t.name + '|' + (t.py || ''); });
      });
  }).then(function () {
    var data = {}, total = 0;
    Object.keys(bag).forEach(function (k) {
      var seen = {}, keep = [];
      bag[k].forEach(function (row) {
        var p = row.split('|'), id = p[0] + '.' + p[1];
        if (seen[id]) return; seen[id] = 1;
        keep.push(id + '|' + p[2] + (p[3] ? '|' + p[3] : ''));
      });
      keep.sort();
      data[k] = keep.join('\n'); total += keep.length;
    });
    if (total < 1000) throw new Error('返回数据异常，仅 ' + total + ' 条');
    var d = new Date();
    var u = { ts: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()), total: total, data: data };
    try { localStorage.setItem(LSKEY, JSON.stringify(u)); } catch (e) { log('本地存储写入失败（不影响本次使用）：' + e.message, 'err'); }
    loadUniverse(u);
    log('✓ 标的库已更新：共 ' + total + ' 个标的（' + Object.keys(data).map(function (k) { return k + ' ' + data[k].split('\n').length; }).join('，') + '）', 'ok');
    lbDone();
  }).catch(function (e) {
    log('✗ 标的库更新失败（' + e.message + '），继续使用本地快照 ' + DB.ts + '（' + DB.list.length + ' 个标的）', 'err');
    log('提示：东方财富列表接口对高频请求有限流，稍后再试即可；不影响「获取数据」取行情', 'sys');
    paintDbState(); lbDone();
  }).then(function () { dbBusy = false; $('btnDb').disabled = false; });
}
$('btnDb').onclick = refreshDB;

/* ============================================================
   2. 行情数据
   ============================================================ */
var D = null;   // {name,t:[],o:[],h:[],l:[],c:[],v:[]}
var MKT = { lot: 100, stamp: 0.0005, minComm: 5, cur: '¥', unit: '元', lotName: '手(100股)' };  // 当前标的的市场规则，applyData 里刷新
var X = null;   // 指标

function jsonp(url, timeout) {
  return new Promise(function (res, rej) {
    var cb = '__qe' + Math.random().toString(36).slice(2, 9);
    var s = document.createElement('script');
    var tid = setTimeout(function () { clean(); rej(new Error('请求超时')); }, timeout || 9000);
    function clean() { clearTimeout(tid); try { delete window[cb]; } catch (e) { window[cb] = void 0; } if (s.parentNode) s.parentNode.removeChild(s); }
    window[cb] = function (d) { clean(); res(d); };
    s.onerror = function () { clean(); rej(new Error('网络不可达')); };
    s.src = url.replace('__CB__', cb);
    document.head.appendChild(s);
  });
}

/* 复权方式：2=后复权（回测默认，历史价固定、结果可复现）1=前复权 0=不复权 */
var ADJ_NAME = { '2': '后复权', '1': '前复权', '0': '不复权' };
function adjMode() { return $('fAdj') ? $('fAdj').value : '2'; }

/* 东方财富日线。字段顺序：日期,开,收,高,低,量,额,振幅,涨跌幅,涨跌额,换手 */
function klineUrl(secid, fqt) {
  return 'https://push2his.eastmoney.com/api/qt/stock/kline/get?cb=__CB__' +
    '&secid=' + secid + '&ut=fa5fd1943c7b386f172d6893dbfba10b' +
    '&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61' +
    '&klt=101&fqt=' + fqt + '&beg=0&end=20500101&lmt=1200&_=' + Date.now();
}
/* 同时取两条序列：
   主序列（按所选复权方式）→ 指标与收益率
   不复权序列            → 真实市价，用于算能买几手、佣金与印花税
   后复权价累计了上市以来全部分红，绝对价位可达真实价数倍，绝不能用来算股数。 */
function fetchEM(secid, name) {
  var adj = adjMode();
  var main = jsonp(klineUrl(secid, adj)).then(function (r) {
    if (!r || !r.data || !r.data.klines || !r.data.klines.length) throw new Error('该标的无日线数据');
    var k = r.data.klines.slice(-1000);
    var o = { sym: secid, name: r.data.name || name, adj: adj, t: [], o: [], h: [], l: [], c: [], v: [], real: true };
    k.forEach(function (row) {
      var p = row.split(',');
      o.t.push(p[0]); o.o.push(+p[1]); o.c.push(+p[2]); o.h.push(+p[3]); o.l.push(+p[4]); o.v.push(+p[5]);
    });
    return o;
  });
  if (adj === '0') return main.then(function (o) { o.ro = o.o.slice(); o.rc = o.c.slice(); return o; });

  var raw = jsonp(klineUrl(secid, '0')).then(function (r) {
    var m = {};
    if (r && r.data && r.data.klines) r.data.klines.forEach(function (row) {
      var p = row.split(','); m[p[0]] = [+p[1], +p[2]];       // 日期 → [开, 收]
    });
    return m;
  }).catch(function () { return null; });

  return Promise.all([main, raw]).then(function (a) {
    var o = a[0], m = a[1];
    o.ro = []; o.rc = [];
    for (var i = 0; i < o.t.length; i++) {
      var v = m && m[o.t[i]];
      o.ro.push(v ? v[0] : o.o[i]);
      o.rc.push(v ? v[1] : o.c[i]);
    }
    o.rawOk = !!m;
    return o;
  });
}

/* 普通外链脚本加载（天天基金的 pingzhongdata 是裸 JS，不是 JSONP） */
function loadScript(url, timeout) {
  return new Promise(function (res, rej) {
    var s = document.createElement('script');
    var tid = setTimeout(function () { clean(); rej(new Error('请求超时')); }, timeout || 15000);
    function clean() { clearTimeout(tid); if (s.parentNode) s.parentNode.removeChild(s); }
    s.onload = function () { clean(); res(); };
    s.onerror = function () { clean(); rej(new Error('网络不可达')); };
    s.src = url;
    document.head.appendChild(s);
  });
}

/* 场外基金：每日单位净值序列（无开高低、无成交量，T+1 公布） */
function fetchOTCNav(code, name, fullHistory) {
  try { delete window.Data_netWorthTrend; } catch (e) { window.Data_netWorthTrend = void 0; }
  try { delete window.fS_name; } catch (e) { window.fS_name = void 0; }
  return loadScript('https://fund.eastmoney.com/pingzhongdata/' + code + '.js?v=' + Date.now(), 20000)
    .then(function () {
      var a = window.Data_netWorthTrend;
      if (!a || !a.length) throw new Error('该基金无净值数据');
      if (!fullHistory) a = a.slice(-1000);
      var o = { sym: 'OF.' + code, name: window.fS_name || name, otc: true, real: true,
                t: [], o: [], h: [], l: [], c: [], v: [], rr: [] };
      for (var i = 0; i < a.length; i++) {
        var d = new Date(a[i].x), nv = +a[i].y;
        if (!isFinite(nv) || nv <= 0) continue;
        o.t.push(d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()));
        // 场外基金只有一个净值，开高低收同值；成交量不存在，副图改画日涨跌幅
        o.o.push(nv); o.h.push(nv); o.l.push(nv); o.c.push(nv); o.v.push(0);
        o.rr.push(+a[i].equityReturn || 0);
      }
      if (o.c.length < 2) throw new Error('净值数据过少');
      return o;
    });
}

/* 场内实时快照（轮询，非逐笔）。f59 为小数位，价格需除以 10^f59 */
function fetchQuote(secid) {
  var u = 'https://push2.eastmoney.com/api/qt/stock/get?cb=__CB__&secid=' + secid +
    '&ut=fa5fd1943c7b386f172d6893dbfba10b&fields=f43,f44,f45,f46,f47,f57,f58,f59,f60,f86,f169,f170&_=' + Date.now();
  return jsonp(u, 8000).then(function (r) {
    var d = r && r.data;
    if (!d || d.f43 === undefined || d.f43 === '-') throw new Error('无实时报价');
    var k = Math.pow(10, isFinite(d.f59) ? d.f59 : 2);
    var ts = new Date((d.f86 || 0) * 1000);
    return {
      c: d.f43 / k, h: d.f44 / k, l: d.f45 / k, o: d.f46 / k, v: +d.f47 || 0,
      prev: d.f60 / k, chg: (+d.f170 || 0) / 100, name: d.f58,
      date: ts.getFullYear() + '-' + pad(ts.getMonth() + 1) + '-' + pad(ts.getDate()),
      time: pad(ts.getHours()) + ':' + pad(ts.getMinutes()) + ':' + pad(ts.getSeconds())
    };
  });
}

/* 离线兜底：几何布朗运动 + 趋势/波动状态切换，生成 4 年日线 */
function simulate(name, seedStr) {
  var seed = 0; for (var i = 0; i < seedStr.length; i++) seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
  function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
  function gauss() { var u = 1 - rnd(), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  var n = 980, p0 = 3.2 + rnd() * 2.4, drift = 0.0004, vol = 0.016;
  var o = { sym: 'SIM', name: name, t: [], o: [], h: [], l: [], c: [], v: [], real: false };
  var d = new Date(); d.setFullYear(d.getFullYear() - 4);
  for (var j = 0; j < n; j++) {
    d.setDate(d.getDate() + 1);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    if (j % 55 === 0) { drift = (rnd() - 0.42) * 0.0022; vol = 0.010 + rnd() * 0.020; }
    var op = Math.max(0.4, p0 * (1 + 0.35 * vol * gauss()));   // 隔夜跳空
    var ret = drift + vol * gauss();
    p0 = Math.max(0.4, op * (1 + ret));
    var hi = Math.max(op, p0) * (1 + rnd() * vol * 0.7);
    var lo = Math.min(op, p0) * (1 - rnd() * vol * 0.7);
    o.t.push(d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()));
    o.o.push(+op.toFixed(3)); o.c.push(+p0.toFixed(3)); o.h.push(+hi.toFixed(3)); o.l.push(+lo.toFixed(3));
    o.v.push(Math.round((0.8 + Math.abs(ret) * 40 + rnd() * 0.6) * 3.2e7));
  }
  return o;
}

/* ============================================================
   3. 技术指标
   ============================================================ */
function SMA(a, n) { var r = [], s = 0; for (var i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; r.push(i >= n - 1 ? s / n : NaN); } return r; }
function EMA(a, n) { var r = [], k = 2 / (n + 1), p = NaN; for (var i = 0; i < a.length; i++) { p = isNaN(p) ? a[i] : a[i] * k + p * (1 - k); r.push(p); } return r; }
function STD(a, n) {
  var r = []; for (var i = 0; i < a.length; i++) {
    if (i < n - 1) { r.push(NaN); continue; }
    var m = 0, q = 0, j; for (j = i - n + 1; j <= i; j++) m += a[j]; m /= n;
    for (j = i - n + 1; j <= i; j++) q += (a[j] - m) * (a[j] - m);
    r.push(Math.sqrt(q / n));
  } return r;
}
function RSI(c, n) {
  var r = [NaN], au = 0, ad = 0, i;
  for (i = 1; i < c.length; i++) {
    var ch = c[i] - c[i - 1], u = ch > 0 ? ch : 0, dn = ch < 0 ? -ch : 0;
    if (i <= n) { au += u / n; ad += dn / n; r.push(i === n ? 100 - 100 / (1 + au / (ad || 1e-9)) : NaN); }
    else { au = (au * (n - 1) + u) / n; ad = (ad * (n - 1) + dn) / n; r.push(100 - 100 / (1 + au / (ad || 1e-9))); }
  } return r;
}
function ATR(h, l, c, n) {
  var tr = [h[0] - l[0]], i;
  for (i = 1; i < c.length; i++) tr.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  var r = [], p = NaN;
  for (i = 0; i < tr.length; i++) { p = isNaN(p) ? tr[i] : (p * (n - 1) + tr[i]) / n; r.push(i >= n - 1 ? p : NaN); }
  return r;
}
function rollMax(a, n) { var r = []; for (var i = 0; i < a.length; i++) { if (i < n) { r.push(NaN); continue; } var m = -Infinity; for (var j = i - n; j < i; j++) if (a[j] > m) m = a[j]; r.push(m); } return r; }
function rollMin(a, n) { var r = []; for (var i = 0; i < a.length; i++) { if (i < n) { r.push(NaN); continue; } var m = Infinity; for (var j = i - n; j < i; j++) if (a[j] < m) m = a[j]; r.push(m); } return r; }

function indicators(d) {
  var c = d.c, x = {};
  x.ma5 = SMA(c, 5); x.ma10 = SMA(c, 10); x.ma20 = SMA(c, 20); x.ma60 = SMA(c, 60);
  x.rsi = RSI(c, 14);
  var e12 = EMA(c, 12), e26 = EMA(c, 26);
  x.dif = e12.map(function (v, i) { return v - e26[i]; });
  x.dea = EMA(x.dif, 9);
  x.hist = x.dif.map(function (v, i) { return 2 * (v - x.dea[i]); });
  var sd = STD(c, 20);
  x.bbMid = x.ma20;
  x.bbUp = x.ma20.map(function (v, i) { return v + 2 * sd[i]; });
  x.bbDn = x.ma20.map(function (v, i) { return v - 2 * sd[i]; });
  x.atr = ATR(d.h, d.l, c, 14);
  x.dcH20 = rollMax(d.h, 20); x.dcL20 = rollMin(d.l, 20);
  x.dcH10 = rollMax(d.h, 10); x.dcL10 = rollMin(d.l, 10);
  x.vma5 = SMA(d.v, 5); x.vma20 = SMA(d.v, 20);
  x.ret = c.map(function (v, i) { return i ? (v - c[i - 1]) / c[i - 1] : 0; });
  x.vol60 = (function () {
    var r = [], s = x.ret;
    for (var i = 0; i < s.length; i++) {
      if (i < 60) { r.push(NaN); continue; }
      var m = 0, q = 0, j;
      for (j = i - 59; j <= i; j++) m += s[j]; m /= 60;
      for (j = i - 59; j <= i; j++) q += (s[j] - m) * (s[j] - m);
      r.push(Math.sqrt(q / 60) * Math.sqrt(243) * 100);
    } return r;
  })();
  return x;
}
var upX = function (a, b, i) { return a[i - 1] <= b[i - 1] && a[i] > b[i]; };   // 上穿
var dwX = function (a, b, i) { return a[i - 1] >= b[i - 1] && a[i] < b[i]; };   // 下穿
var ok = function () { for (var i = 0; i < arguments.length; i++) if (!isFinite(arguments[i])) return false; return true; };

/* ============================================================
   4. 策略模板库
   entry/exit 接收 (i, x, d)，i 为已收盘K线下标，成交发生在 i+1 开盘
   ============================================================ */
var LONG = [
  { n: '双均线金叉', s: '趋势跟踪', b: '5日均线上穿20日均线，且20日均线向上', x: '5日均线下穿20日均线离场',
    e: function (i, x) { return ok(x.ma20[i], x.ma20[i - 3]) && upX(x.ma5, x.ma20, i) && x.ma20[i] > x.ma20[i - 3]; },
    q: function (i, x) { return dwX(x.ma5, x.ma20, i); } },
  { n: '20日线回踩企稳', s: '趋势跟踪', nb: 1, b: '收盘站上60日均线，最低触及20日均线后收阳', x: '收盘跌破20日均线离场',
    e: function (i, x, d) { return ok(x.ma60[i], x.ma20[i]) && d.c[i] > x.ma60[i] && d.l[i] <= x.ma20[i] && d.c[i] > d.o[i] && d.c[i] > x.ma20[i]; },
    q: function (i, x, d) { return ok(x.ma20[i]) && d.c[i] < x.ma20[i]; } },
  { n: '唐奇安通道突破', s: '突破', b: '收盘创 20 日新高', x: '收盘跌破 10 日新低',
    e: function (i, x, d) { return ok(x.dcH20[i]) && d.c[i] > x.dcH20[i]; },
    q: function (i, x, d) { return ok(x.dcL10[i]) && d.c[i] < x.dcL10[i]; } },
  { n: '布林下轨反弹', s: '均值回归', nb: 1, b: '前一日收盘跌破布林下轨，当日收阳反包', x: '触及布林中轨或上轨离场',
    e: function (i, x, d) { return ok(x.bbDn[i - 1]) && d.c[i - 1] < x.bbDn[i - 1] && d.c[i] > d.o[i] && d.c[i] > d.c[i - 1]; },
    q: function (i, x, d) { return ok(x.bbUp[i], x.bbMid[i]) && (d.c[i] > x.bbUp[i] || d.c[i] > x.bbMid[i] * 1.02); } },
  { n: '超卖反转', s: '均值回归', b: '相对强弱指标由 30 以下上穿 30', x: '相对强弱指标上穿 65 离场',
    e: function (i, x) { return ok(x.rsi[i], x.rsi[i - 1]) && x.rsi[i - 1] < 30 && x.rsi[i] >= 30; },
    q: function (i, x) { return ok(x.rsi[i]) && x.rsi[i] > 65; } },
  { n: '零轴上金叉', s: '动量', b: '快线上穿慢线，且快线在 0 轴上方', x: '快线下穿慢线离场',
    e: function (i, x) { return ok(x.dif[i], x.dea[i]) && upX(x.dif, x.dea, i) && x.dif[i] > 0; },
    q: function (i, x) { return dwX(x.dif, x.dea, i); } },
  { n: '量价齐升', s: '量价', nb: 1, b: '成交量 > 5日均量 1.8 倍，收阳且涨幅 > 2%', x: '缩量至 5日均量 0.7 倍以下离场',
    e: function (i, x, d) { return ok(x.vma5[i]) && d.v[i] > x.vma5[i] * 1.8 && x.ret[i] > 0.02; },
    q: function (i, x, d) { return ok(x.vma5[i]) && d.v[i] < x.vma5[i] * 0.7; } },
  { n: '跳空缺口延续', s: '突破', nb: 1, b: '今日开盘高于昨日最高价，且收阳', x: '收盘回补缺口离场',
    e: function (i, x, d) { return d.o[i] > d.h[i - 1] && d.c[i] > d.o[i]; },
    q: function (i, x, d) { return d.c[i] < d.l[i - 1]; } },
  { n: '三连阳启动', s: '动量', nb: 1, b: '连续 3 根阳线且累计涨幅 > 3%', x: '出现一根跌幅 > 2% 的阴线离场',
    e: function (i, x, d) { return d.c[i] > d.o[i] && d.c[i - 1] > d.o[i - 1] && d.c[i - 2] > d.o[i - 2] && (d.c[i] / d.c[i - 3] - 1) > 0.03; },
    q: function (i, x) { return x.ret[i] < -0.02; } },
  { n: '均线多头排列', s: '趋势跟踪', b: '5日 > 10日 > 20日 > 60日均线，首次成立', x: '5日均线跌破10日均线离场',
    e: function (i, x) {
      if (!ok(x.ma60[i], x.ma60[i - 1])) return false;
      var t = function (j) { return x.ma5[j] > x.ma10[j] && x.ma10[j] > x.ma20[j] && x.ma20[j] > x.ma60[j]; };
      return t(i) && !t(i - 1);
    },
    q: function (i, x) { return dwX(x.ma5, x.ma10, i); } },
  { n: '波动收缩突破', s: '突破', b: '真实波幅处于 20 日低位，随后突破 10 日高点', x: '跌破10日均线离场',
    e: function (i, x, d) {
      if (!ok(x.atr[i], x.dcH10[i], x.ma10[i])) return false;
      var r = x.atr[i] / d.c[i], lowVol = true;
      for (var j = i - 20; j < i; j++) { if (!isFinite(x.atr[j])) return false; if (x.atr[j] / d.c[j] < r) { lowVol = false; break; } }
      return lowVol && d.c[i] > x.dcH10[i];
    },
    q: function (i, x, d) { return ok(x.ma10[i]) && d.c[i] < x.ma10[i]; } },
  { n: '月度动量', s: '波段', b: '收盘较 20 日前上涨超 5%，且站上20日均线', x: '收盘较 10 日前下跌超 3% 离场',
    e: function (i, x, d) { return ok(x.ma20[i]) && i > 21 && (d.c[i] / d.c[i - 20] - 1) > 0.05 && d.c[i] > x.ma20[i]; },
    q: function (i, x, d) { return i > 11 && (d.c[i] / d.c[i - 10] - 1) < -0.03; } },
  { n: '恐慌抄底', s: '逆势', nb: 1, b: '连续 3 根阴线且相对强弱指标 < 40', x: '相对强弱指标回到 55 以上离场',
    e: function (i, x, d) { return ok(x.rsi[i]) && x.rsi[i] < 40 && d.c[i] < d.o[i] && d.c[i - 1] < d.o[i - 1] && d.c[i - 2] < d.o[i - 2]; },
    q: function (i, x) { return ok(x.rsi[i]) && x.rsi[i] > 55; } },
  { n: '平台整理突破', s: '突破', b: '20 日振幅 < 12%，收盘突破区间上沿', x: '跌回区间中位离场',
    e: function (i, x, d) {
      if (!ok(x.dcH20[i], x.dcL20[i])) return false;
      return (x.dcH20[i] - x.dcL20[i]) / x.dcL20[i] < 0.12 && d.c[i] > x.dcH20[i];
    },
    q: function (i, x, d) { return ok(x.dcH20[i], x.dcL20[i]) && d.c[i] < (x.dcH20[i] + x.dcL20[i]) / 2; } }
];

/* 反转组：把 7 个追涨模板的进场条件精确取反，仍然做多。
   用来检验「因子 IC 显示该标的呈反转特征」这一发现能否转化为可交易的收益。 */
var REVERSAL = [
  { n: '均线死叉买入', s: '反转', b: '5日均线下穿20日均线，且20日均线向下 → 买入', x: '5日均线上穿20日均线卖出',
    e: function (i, x) { return ok(x.ma20[i], x.ma20[i - 3]) && dwX(x.ma5, x.ma20, i) && x.ma20[i] < x.ma20[i - 3]; },
    q: function (i, x) { return upX(x.ma5, x.ma20, i); } },
  { n: '破位新低买入', s: '反转', b: '收盘跌破 20 日新低 → 买入', x: '收盘站上10日均线卖出',
    e: function (i, x, d) { return ok(x.dcL20[i]) && d.c[i] < x.dcL20[i]; },
    q: function (i, x, d) { return ok(x.ma10[i]) && d.c[i] > x.ma10[i]; } },
  { n: '空头排列买入', s: '反转', b: '5日 < 10日 < 20日 < 60日均线，首次成立 → 买入', x: '收盘站上20日均线卖出',
    e: function (i, x) {
      if (!ok(x.ma60[i], x.ma60[i - 1])) return false;
      var t = function (j) { return x.ma5[j] < x.ma10[j] && x.ma10[j] < x.ma20[j] && x.ma20[j] < x.ma60[j]; };
      return t(i) && !t(i - 1);
    },
    q: function (i, x, d) { return ok(x.ma20[i]) && d.c[i] > x.ma20[i]; } },
  { n: '三连阴买入', s: '反转', nb: 1, b: '连续 3 根阴线且累计跌幅 > 3% → 买入', x: '出现涨幅 > 2% 的阳线卖出',
    e: function (i, x, d) { return d.c[i] < d.o[i] && d.c[i - 1] < d.o[i - 1] && d.c[i - 2] < d.o[i - 2] && (d.c[i] / d.c[i - 3] - 1) < -0.03; },
    q: function (i, x) { return x.ret[i] > 0.02; } },
  { n: '跌破平台买入', s: '反转', b: '20 日振幅 < 12%，收盘跌破区间下沿 → 买入', x: '回到区间中位卖出',
    e: function (i, x, d) {
      if (!ok(x.dcH20[i], x.dcL20[i])) return false;
      return (x.dcH20[i] - x.dcL20[i]) / x.dcL20[i] < 0.12 && d.c[i] < x.dcL20[i];
    },
    q: function (i, x, d) { return ok(x.dcH20[i], x.dcL20[i]) && d.c[i] > (x.dcH20[i] + x.dcL20[i]) / 2; } },
  { n: '月度反转', s: '反转', b: '收盘较 20 日前下跌超 5%，且低于20日均线 → 买入', x: '较 10 日前上涨超 3% 卖出',
    e: function (i, x, d) { return ok(x.ma20[i]) && i > 21 && (d.c[i] / d.c[i - 20] - 1) < -0.05 && d.c[i] < x.ma20[i]; },
    q: function (i, x, d) { return i > 11 && (d.c[i] / d.c[i - 10] - 1) > 0.03; } },
  { n: '零轴下死叉买入', s: '反转', b: '快线 < 0 且快线下穿慢线 → 买入', x: '快线上穿慢线卖出',
    e: function (i, x) { return ok(x.dif[i], x.dea[i]) && dwX(x.dif, x.dea, i) && x.dif[i] < 0; },
    q: function (i, x) { return upX(x.dif, x.dea, i); } }
];

var SHORT = [
  { n: '双均线死叉做空', s: '趋势跟踪', b: '5日均线下穿20日均线，且20日均线向下 → 开空', x: '5日均线上穿20日均线平仓',
    e: function (i, x) { return ok(x.ma20[i], x.ma20[i - 3]) && dwX(x.ma5, x.ma20, i) && x.ma20[i] < x.ma20[i - 3]; },
    q: function (i, x) { return upX(x.ma5, x.ma20, i); } },
  { n: '破位新低做空', s: '突破', b: '收盘跌破 20 日新低 → 开空', x: '收盘重回10日均线上方平仓',
    e: function (i, x, d) { return ok(x.dcL20[i]) && d.c[i] < x.dcL20[i]; },
    q: function (i, x, d) { return ok(x.ma10[i]) && d.c[i] > x.ma10[i]; } },
  { n: '超买回落做空', s: '均值回归', b: '相对强弱指标由 70 以上下穿 70 → 开空', x: '相对强弱指标跌破 45 平仓',
    e: function (i, x) { return ok(x.rsi[i], x.rsi[i - 1]) && x.rsi[i - 1] > 70 && x.rsi[i] <= 70; },
    q: function (i, x) { return ok(x.rsi[i]) && x.rsi[i] < 45; } },
  { n: '布林上轨滞涨', s: '均值回归', nb: 1, b: '前日冲破布林上轨，当日收阴 → 开空', x: '回落至布林中轨平仓',
    e: function (i, x, d) { return ok(x.bbUp[i - 1]) && d.c[i - 1] > x.bbUp[i - 1] && d.c[i] < d.o[i]; },
    q: function (i, x, d) { return ok(x.bbMid[i]) && d.c[i] < x.bbMid[i]; } },
  { n: '空头排列做空', s: '趋势跟踪', b: '5日 < 10日 < 20日 < 60日均线，首次成立 → 开空', x: '收盘站上20日均线平仓',
    e: function (i, x) {
      if (!ok(x.ma60[i], x.ma60[i - 1])) return false;
      var t = function (j) { return x.ma5[j] < x.ma10[j] && x.ma10[j] < x.ma20[j] && x.ma20[j] < x.ma60[j]; };
      return t(i) && !t(i - 1);
    },
    q: function (i, x, d) { return ok(x.ma20[i]) && d.c[i] > x.ma20[i]; } },
  { n: '零轴下死叉', s: '动量', b: '快线 < 0 且快线下穿慢线 → 开空', x: '快线上穿慢线平仓',
    e: function (i, x) { return ok(x.dif[i], x.dea[i]) && dwX(x.dif, x.dea, i) && x.dif[i] < 0; },
    q: function (i, x) { return upX(x.dif, x.dea, i); } },
  { n: '放量长阴', s: '量价', nb: 1, b: '跌幅 > 3% 且成交量 > 5日均量 1.8 倍 → 开空', x: '收盘站上10日均线平仓',
    e: function (i, x, d) { return ok(x.vma5[i]) && x.ret[i] < -0.03 && d.v[i] > x.vma5[i] * 1.8; },
    q: function (i, x, d) { return ok(x.ma10[i]) && d.c[i] > x.ma10[i]; } }
];

/* ============================================================
   5. 回测引擎
   ============================================================ */
/* 东方财富美股市场号：105 纳斯达克 / 106 纽交所 / 107 美交所（含 NYSE Arca 的 ETF） */
function isUS(d) {
  var s = (d && (d.sym || d.id)) || '';
  return s.slice(0, 4) === '105.' || s.slice(0, 4) === '106.' || s.slice(0, 4) === '107.';
}
/* 各市场的成交规则与成本口径。A股：100 股整手 + 卖出印花税 + 每笔最低 5 元佣金；
   美股：1 股起、无印花税、无过户费建模，佣金按中资券商常见口径每单最低 1 美元。 */
function mkt(d) {
  return isUS(d)
    ? { lot: 1, stamp: 0, minComm: US_MIN_COMM, cur: '$', unit: '美元', lotName: '股' }
    : { lot: LOT, stamp: STAMP, minComm: MIN_COMM, cur: '¥', unit: '元', lotName: '手(100股)' };
}

/* A股涨跌停幅度：创业板/科创板 20%，北交所 30%，其余 10%；
   场外基金按净值申赎无涨跌停；板块/指数本身不可交易，不设限制。 */
function limitPct(d) {
  if (d.otc || !d.sym) return 0;
  if (d.sym.slice(0, 3) === '90.') return 0;               // 板块指数
  if (isUS(d)) return 0;                                   // 美股无涨跌停（个股熔断是全市场级，不建模）
  var code = d.sym.split('.')[1] || '';
  if (/^(300|301|688|689)/.test(code)) return 0.20;
  if (/^(8|4|92)/.test(code)) return 0.30;
  if (/^(000|399|930|950)/.test(code) && d.cat === '指数') return 0;
  return 0.10;
}

/* rng = {a,b}：只在 [a,b) 这段 K 线上交易，用于样本内/样本外切分；不传则跑全程 */
function backtest(st, d, x, cfg, rng) {
  var n = d.c.length, i, pos = null, dir = st.dir, otc = !!d.otc;
  var zeroPos = !(cfg.pos > 0);
  var sz = zeroPos ? 1 : cfg.pos;             // 凯利为 0 时按满仓模拟，报告里会标注口径
  var cap = cfg.cap0, peak = cap, mdd = 0;    // 权益以「元」计
  var eq = new Array(n).fill(null), trades = [];
  var skipped = 0, feeSum = 0, limitSkip = 0, blocked = 0, impact = 0;

  var M = mkt(d);                             // 该标的所在市场的手数/印花税/最低佣金
  var comm = otc ? 0 : cfg.fee / 1e4;         // 场内佣金率（万分之）
  var slip = otc ? 0 : cfg.slip / 1e4;        // 场外按净值申赎，无滑点
  var buyFeeOtc = otc ? cfg.buyFee / 100 : 0; // 场外申购费
  // 场外赎回费按持有日历天数分档（<7天 1.5% 为监管强制）
  function otcSellRate(iEnter, iExit) {
    var days = (new Date(d.t[iExit].replace(/-/g, '/')) - new Date(d.t[iEnter].replace(/-/g, '/'))) / 864e5;
    return days < 7 ? 0.015 : days < 30 ? 0.0075 : days < 365 ? 0.005 : 0.0025;
  }
  // 真实市价序列：用于算股数与费用；复权序列只负责收益率
  var RO = d.ro || d.o, RC = d.rc || d.c;
  // 涨跌停：一字涨停买不进、一字跌停卖不出。用不复权价对前收判断。
  var LIM = limitPct(d);
  function atLimit(i, up) {
    if (!LIM || i < 1 || !(RC[i - 1] > 0)) return false;
    var chg = RO[i] / RC[i - 1] - 1;
    return up ? chg >= LIM - 0.002 : chg <= -(LIM - 0.002);
  }
  // 开仓：场内按整手（A股 100 股 / 美股 1 股）、佣金每笔有下限；场外可碎股。
  // 全部直接解算，不用迭代逼近 —— 迭代版会在浮点误差正好让 amt+fee 超出预算 1 个 ULP 时死循环。
  function openPos(rawPrice, budget) {
    if (!(rawPrice > 0) || budget <= 0) return null;
    var px = dir === 1 ? rawPrice * (1 + slip) : rawPrice * (1 - slip);
    if (otc) {                                   // 场外可碎股，申购费从预算内扣
      if (dir === -1) return { sh: budget / px, px: px, amt: budget, fee: budget * (buyFeeOtc + M.stamp) };
      var amtO = budget / (1 + buyFeeOtc);
      return { sh: amtO / px, px: px, amt: amtO, fee: budget - amtO };
    }
    if (dir === -1) {                            // 做空开仓即卖出，需缴印花税，不受预算约束
      var shS = Math.floor(budget / px / M.lot) * M.lot;
      if (shS <= 0) return null;
      var amtS = shS * px;
      return { sh: shS, px: px, amt: amtS, fee: Math.max(amtS * comm, M.minComm) + amtS * M.stamp };
    }
    // 约束 amt + max(amt*comm, minComm) ≤ budget 等价于两条线性约束同时成立，直接取较紧的一条
    var cap = Math.min((budget - M.minComm) / px, budget / (px * (1 + comm)));
    var sh = Math.floor(cap / M.lot) * M.lot;
    // 浮点兜底：最多回退两手，避免任何情况下的无界循环
    for (var g = 0; g < 3 && sh > 0; g++) {
      var amt = sh * px, f = Math.max(amt * comm, M.minComm);
      if (amt + f <= budget) return { sh: sh, px: px, amt: amt, fee: f };
      sh -= M.lot;
    }
    return null;
  }
  // 平仓金额 = 开仓金额 × 复权总收益倍数（分红不会被误算成亏损），再还原两次滑点
  function closePos(amtIn, mult, iEnter, iExit) {
    var amt = dir === 1 ? amtIn * mult * (1 - slip) / (1 + slip)
                        : amtIn * mult * (1 + slip) / (1 - slip);
    var f = otc ? amt * otcSellRate(iEnter, iExit) : Math.max(amt * comm, M.minComm);
    if (!otc && dir === 1) f += amt * M.stamp;                // 做多的平仓卖出缴印花税
    return { amt: amt, fee: f };
  }

  // 本笔自身的盈亏率：卖出净额相对买入总成本
  function tradeRet(p, cl) {
    return dir === 1 ? (cl.amt - cl.fee - p.amt - p.fee) / (p.amt + p.fee)
                     : (p.amt - p.fee - cl.amt - cl.fee) / p.amt;
  }
  var SL = cfg.sl / 100, TP = cfg.tp / 100, MAXHOLD = 60;
  var TRAIL_ON = (cfg.trailOn || 0) / 100, TRAIL_BACK = (cfg.trailBack || 5) / 100;
  var start = Math.max(65, rng && rng.a != null ? rng.a : 65);
  var END = Math.min(n - 1, rng && rng.b != null ? rng.b : n - 1);
  for (i = 0; i < start; i++) eq[i] = cap;

  for (i = start; i < END; i++) {
    if (pos) {
      // 盯市：持仓价值 = 开仓金额 × 当前复权倍数（再还原开仓时多付的滑点）
      var mv = pos.amt * (d.c[i] / pos.adjPx) / (dir === 1 ? (1 + slip) : (1 - slip));
      eq[i] = dir === 1 ? pos.cash + mv : pos.cash - mv;
      var r = dir * (d.c[i] - pos.adjPx) / pos.adjPx;
      if (r > pos.peak) pos.peak = r;                       // 最高浮盈，供跟踪止盈使用
      var why = null;
      // 止损：固定百分比，或按开仓时 ATR 折算的动态距离（波动大时自动放宽）
      if (pos.atrStop != null ? (r <= -pos.atrStop) : (r <= -SL)) why = pos.atrStop != null ? 'ATR止损' : '止损';
      else if (TRAIL_ON > 0 && pos.peak >= TRAIL_ON && r <= pos.peak - TRAIL_BACK) why = '跟踪止盈';
      else if (r >= TP) why = '止盈';
      else if (st.q(i, x, d, i - pos.i)) why = '离场信号';   // 第4参：已持仓交易日数
      else if (i - pos.i >= MAXHOLD) why = '持仓到期';
      if (why && atLimit(i + 1, dir !== 1)) { blocked++; why = null; }   // 跌停卖不出，顺延到下一根
      if (why) {
        var cl = closePos(pos.amt, d.o[i + 1] / pos.adjPx, pos.i, i + 1);
        cap = dir === 1 ? pos.cash + cl.amt - cl.fee : pos.cash - cl.amt - cl.fee;
        var tf = pos.fee + cl.fee; feeSum += tf;
        trades.push({ no: trades.length + 1, dir: dir, di: pos.d, dp: pos.px, xi: d.t[i + 1],
          xp: RO[i + 1] * (dir === 1 ? 1 - slip : 1 + slip),
          sh: pos.sh, hold: i + 1 - pos.i,
          r: (cap - pos.cap0) / pos.cap0,                       // 对总权益的影响，用于权益曲线
          rt: tradeRet(pos, cl),                                // 本笔自身的盈亏率，用于胜率/盈亏比与明细
          why: why, cap: cap, fee: tf });
        pos = null; eq[i] = cap;
      }
    } else {
      eq[i] = cap;
      var canEnter = true;
      try { canEnter = !!st.e(i, x, d); } catch (e) { canEnter = false; }
      if (canEnter && atLimit(i + 1, dir === 1)) { limitSkip++; canEnter = false; }  // 一字涨停买不进
      if (canEnter) {
        var op = openPos(RO[i + 1], cap * sz);                 // 用真实市价算能买几手
        if (!op) skipped++;
        else if (RC[i + 1] > 0 && d.v[i + 1] > 0 &&
                 op.amt > d.v[i + 1] * RC[i + 1] * 0.01) impact++;   // 单笔超过当日成交额 1%
        else {
          // ATR 动态止损：把开仓时的 ATR(14) 折成相对开仓价的百分比距离，整段持仓固定不变
          var aStop = null;
          if (cfg.stopMode === 'atr' && isFinite(x.atr[i]) && d.o[i + 1] > 0) {
            aStop = clamp(x.atr[i] * cfg.atrMul / d.o[i + 1], 0.005, 0.5);
          }
          pos = { i: i + 1, d: d.t[i + 1], px: op.px, sh: op.sh, amt: op.amt, fee: op.fee,
                  adjPx: d.o[i + 1], cap0: cap, peak: 0, atrStop: aStop,
                  cash: dir === 1 ? cap - op.amt - op.fee : cap + op.amt - op.fee };
        }
      }
    }
    if (eq[i] > peak) peak = eq[i];
    var dd = (peak - eq[i]) / peak; if (dd > mdd) mdd = dd;
  }
  if (pos) {
    var cll = closePos(pos.amt, d.c[END] / pos.adjPx, pos.i, END);
    cap = dir === 1 ? pos.cash + cll.amt - cll.fee : pos.cash - cll.amt - cll.fee;
    var tfl = pos.fee + cll.fee; feeSum += tfl;
    trades.push({ no: trades.length + 1, dir: dir, di: pos.d, dp: pos.px, xi: d.t[END],
      xp: RC[END] * (dir === 1 ? 1 - slip : 1 + slip),
      sh: pos.sh, hold: END - pos.i, r: (cap - pos.cap0) / pos.cap0, rt: tradeRet(pos, cll),
      why: '持仓中', cap: cap, fee: tfl });
  }
  eq[END] = cap;
  for (i = 1; i < n; i++) if (eq[i] === null) eq[i] = eq[i - 1];

  // 胜率与盈亏比按每笔自身盈亏率统计，不受仓位大小影响
  var w = trades.filter(function (t) { return t.rt > 0; }), l = trades.filter(function (t) { return t.rt <= 0; });
  var aw = w.length ? w.reduce(function (a, t) { return a + t.rt; }, 0) / w.length : 0;
  var al = l.length ? Math.abs(l.reduce(function (a, t) { return a + t.rt; }, 0) / l.length) : 0;
  // 权益曲线的日收益 → 年化波动 → 夏普（无风险利率按 0）
  var er = [], k2;
  for (k2 = start + 1; k2 <= END; k2++) if (eq[k2 - 1] > 0) er.push(eq[k2] / eq[k2 - 1] - 1);
  var vol = 0;
  if (er.length > 20) {
    var mu2 = 0, q2 = 0, z;
    for (z = 0; z < er.length; z++) mu2 += er[z]; mu2 /= er.length;
    for (z = 0; z < er.length; z++) q2 += (er[z] - mu2) * (er[z] - mu2);
    vol = Math.sqrt(q2 / (er.length - 1)) * Math.sqrt(243) * 100;
  }
  var years = Math.max(END - start, 1) / 243, mult = cap / cfg.cap0;
  var annPct = (Math.pow(Math.max(mult, 1e-6), 1 / years) - 1) * 100;
  return {
    ret: (mult - 1) * 100,
    vol: vol,
    sharpe: vol > 0 ? annPct / vol : 0,
    calmar: mdd > 0 ? annPct / (mdd * 100) : 0,
    from: d.t[start], to: d.t[END], bars: END - start,
    zeroPos: zeroPos, sz: sz,
    cap0: cfg.cap0, capEnd: cap, feeSum: feeSum, skipped: skipped,
    limitSkip: limitSkip, blocked: blocked, impact: impact, limitPct: LIM,
    ann: (Math.pow(Math.max(mult, 1e-6), 1 / years) - 1) * 100,
    win: trades.length ? w.length / trades.length * 100 : 0,
    pl: al > 0 ? aw / al : (aw > 0 ? 99 : 0),
    mdd: mdd * 100,
    nt: trades.length, nw: w.length, nl: l.length,
    trades: trades, eq: eq
  };
}

/* ============================================================
   随机进场基准：把「进场时点」换成随机，其余（止损/止盈/最长持仓/仓位/费用/整手）
   与真实策略完全一致，交易次数也对齐。用来回答：这个信号本身有没有价值？
   若真实收益落不到随机分布的前 5%，就说明它与随机进场没有统计上的区别。
   ============================================================ */
var RND_RUNS = 200;
function randomBenchmark(st, d, x, cfg, nt) {
  if (!nt || nt < 5) return null;                 // 样本太少，比了也没意义
  var n = d.c.length, start = 65, span = n - 1 - start;
  if (span < 80) return null;
  // 用「策略名 + 标的」派生固定种子：同一组合任何时候重跑，随机分布完全一致，
  // 否则临界策略的判定会在 95% 门槛两侧来回翻转。
  var seed = 2166136261;
  var key = st.n + '|' + (d.sym || '') + '|' + nt;
  for (var q = 0; q < key.length; q++) { seed ^= key.charCodeAt(q); seed = (seed * 16777619) >>> 0; }
  function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }

  var rets = [], counts = [], i, run;
  for (run = 0; run < RND_RUNS; run++) {
    // 随机撒 nt 个进场候选点（超采样以抵消"持仓中无法进场"的损耗）
    var flag = new Uint8Array(n), want = Math.min(span, Math.round(nt * 2.2));
    for (i = 0; i < want; i++) flag[start + Math.floor(rnd() * span)] = 1;
    var taken = 0;
    var synth = {
      n: '随机', s: '基准', dir: st.dir,
      e: function (k) { if (taken >= nt) return false; if (flag[k]) { taken++; return true; } return false; },
      q: function () { return false; }             // 只靠止损/止盈/到期离场
    };
    var r = backtest(synth, d, x, cfg);
    rets.push(r.ret); counts.push(r.nt);
  }
  rets.sort(function (a, b) { return a - b; });
  var avgN = counts.reduce(function (a, b) { return a + b; }, 0) / counts.length;
  return { rets: rets, median: rets[Math.floor(rets.length / 2)], avgTrades: avgN };
}
function pctRank(sorted, v) {
  var lo = 0, hi = sorted.length;
  while (lo < hi) { var m = (lo + hi) >> 1; if (sorted[m] < v) lo = m + 1; else hi = m; }
  return lo / sorted.length * 100;
}

/* ============================================================
   特征层（#7）+ 因子有效性检验（#5）
   把散落在策略里的指标抽成统一的"因子"，再用秩相关衡量它对未来收益的预测力。
   ============================================================ */
var FEATURES = [
  ['收益率', '5日动量', function (i, x, d) { return i > 5 ? d.c[i] / d.c[i - 5] - 1 : NaN; }],
  ['收益率', '20日动量', function (i, x, d) { return i > 20 ? d.c[i] / d.c[i - 20] - 1 : NaN; }],
  ['收益率', '60日动量', function (i, x, d) { return i > 60 ? d.c[i] / d.c[i - 60] - 1 : NaN; }],
  ['波动率', '60日年化波动', function (i, x) { return x.vol60[i]; }],
  ['波动率', '真实波幅占比', function (i, x, d) { return d.c[i] ? x.atr[i] / d.c[i] : NaN; }],
  ['量能', '量比(量/20日均量)', function (i, x, d) { return x.vma20[i] ? d.v[i] / x.vma20[i] : NaN; }],
  ['量能', '5日量能变化', function (i, x) { return x.vma20[i] ? x.vma5[i] / x.vma20[i] : NaN; }],
  ['趋势', '偏离20日均线', function (i, x, d) { return x.ma20[i] ? d.c[i] / x.ma20[i] - 1 : NaN; }],
  ['趋势', '20日均线斜率', function (i, x) { return (i > 5 && x.ma20[i - 5]) ? x.ma20[i] / x.ma20[i - 5] - 1 : NaN; }],
  ['趋势', '相对强弱RSI14', function (i, x) { return x.rsi[i]; }],
  ['趋势', '快慢线柱', function (i, x, d) { return d.c[i] ? x.hist[i] / d.c[i] : NaN; }]
];
var IC_H = [5, 10, 20];

function rankOf(a) {                       // 平均秩，处理并列
  var idx = a.map(function (v, i) { return i; });
  idx.sort(function (p, q) { return a[p] - a[q]; });
  var r = new Array(a.length), i = 0;
  while (i < idx.length) {
    var j = i; while (j + 1 < idx.length && a[idx[j + 1]] === a[idx[i]]) j++;
    var avg = (i + j) / 2 + 1;
    for (var k = i; k <= j; k++) r[idx[k]] = avg;
    i = j + 1;
  }
  return r;
}
function spearman(a, b) {
  if (a.length < 20) return NaN;
  var ra = rankOf(a), rb = rankOf(b), n = a.length, i;
  var ma = 0, mb = 0;
  for (i = 0; i < n; i++) { ma += ra[i]; mb += rb[i]; }
  ma /= n; mb /= n;
  var sab = 0, sa = 0, sb = 0;
  for (i = 0; i < n; i++) {
    var da = ra[i] - ma, db = rb[i] - mb;
    sab += da * db; sa += da * da; sb += db * db;
  }
  return (sa > 0 && sb > 0) ? sab / Math.sqrt(sa * sb) : NaN;
}
/* 返回 {ic:{5,10,20}, icir, blocks} */
function factorIC(fn, d, x) {
  var n = d.c.length, out = { ic: {}, icir: NaN };
  var vals = [], i;
  for (i = 0; i < n; i++) { var v; try { v = fn(i, x, d); } catch (e) { v = NaN; } vals.push(v); }
  IC_H.forEach(function (H) {
    var A = [], B = [];
    for (i = 65; i < n - H; i++) {
      var f = vals[i], r = d.c[i] > 0 ? d.c[i + H] / d.c[i] - 1 : NaN;
      if (isFinite(f) && isFinite(r)) { A.push(f); B.push(r); }
    }
    out.ic[H] = spearman(A, B);
    out.n = A.length;
  });
  // ICIR：按 120 根分块算 IC(10)，看它在时间上稳不稳
  var H2 = 10, blocks = [];
  for (var s = 65; s < n - H2 - 120; s += 120) {
    var A2 = [], B2 = [];
    for (i = s; i < Math.min(s + 120, n - H2); i++) {
      var f2 = vals[i], r2 = d.c[i] > 0 ? d.c[i + H2] / d.c[i] - 1 : NaN;
      if (isFinite(f2) && isFinite(r2)) { A2.push(f2); B2.push(r2); }
    }
    var ic2 = spearman(A2, B2);
    if (isFinite(ic2)) blocks.push(ic2);
  }
  // 分层收益：按因子值把样本分成 5 组，看各组未来 10 日的平均收益。
  // IC 只衡量"整体单调倾向"，分层能看出极端组是否真的更好——策略只在极端值触发，这才是它关心的。
  (function () {
    var H3 = 10, pairs = [];
    for (var t = 65; t < n - H3; t++) {
      var f3 = vals[t], r3 = d.c[t] > 0 ? d.c[t + H3] / d.c[t] - 1 : NaN;
      if (isFinite(f3) && isFinite(r3)) pairs.push([f3, r3]);
    }
    if (pairs.length < 100) return;
    pairs.sort(function (a, b) { return a[0] - b[0]; });
    var Q = 5, per = Math.floor(pairs.length / Q), qs = [];
    for (var g = 0; g < Q; g++) {
      var s2 = g * per, e2 = (g === Q - 1) ? pairs.length : (g + 1) * per, sum = 0;
      for (var u = s2; u < e2; u++) sum += pairs[u][1];
      qs.push(sum / (e2 - s2) * 100);
    }
    out.q = qs;
    out.spread = qs[Q - 1] - qs[0];
    // 单调性：相邻分组递增/递减的一致程度
    var up = 0, dn = 0;
    for (var w = 1; w < Q; w++) { if (qs[w] > qs[w - 1]) up++; else dn++; }
    out.mono = Math.max(up, dn) / (Q - 1);
  })();

  if (blocks.length >= 3) {
    var m = blocks.reduce(function (a, b) { return a + b; }, 0) / blocks.length;
    var q = 0; blocks.forEach(function (b) { q += (b - m) * (b - m); });
    var sd = Math.sqrt(q / (blocks.length - 1));
    out.icir = sd > 0 ? m / sd : NaN;
    out.blockPos = blocks.filter(function (b) { return b > 0; }).length;
    out.blockN = blocks.length;
  }
  return out;
}

/* ---------- 因子分位策略 ----------
   直接命中分层收益里那一组：当因子值滚动分位落进最低/最高 20% 时买入，固定持有 H 天。
   分位阈值只用「当下往前 250 根」计算，绝不使用全样本分位数（那等于偷看未来）。 */
var FQ_WIN = 250, FQ_HOLD = 10, FQ_EDGE = 0.2;
function factorPctSeries(st, d, x) {
  if (!st._cache) st._cache = new WeakMap();
  var hit = st._cache.get(d);
  if (hit) return hit;
  var W = st._win, n = d.c.length, vals = [], i, j;
  for (i = 0; i < n; i++) { var v; try { v = st._fn(i, x, d); } catch (e) { v = NaN; } vals.push(v); }
  var pct = new Array(n).fill(NaN);
  for (i = W; i < n; i++) {
    var cur = vals[i]; if (!isFinite(cur)) continue;
    var lt = 0, tot = 0;
    for (j = i - W; j < i; j++) {
      var u = vals[j]; if (!isFinite(u)) continue;
      tot++; if (u < cur) lt++;
    }
    if (tot >= W * 0.6) pct[i] = lt / tot;
  }
  st._cache.set(d, pct);
  return pct;
}
/* 三个参数随策略携带，敏感性扫描才能生成变体 */
function buildFactorStrategy(fi, lowSide, win, hold, edge) {
  var f = FEATURES[fi];
  win = win || FQ_WIN; hold = hold || FQ_HOLD; edge = edge || FQ_EDGE;
  var side = lowSide ? '最低' : '最高';
  return {
    n: '因子·' + f[1] + '·' + side + Math.round(edge * 100) + '%',
    s: '因子', _fn: f[2], _fi: fi, _low: lowSide, _win: win, _hold: hold, _edge: edge,
    b: '「' + f[1] + '」滚动分位（近' + win + '根）落入' + side + ' ' + Math.round(edge * 100) + '% → 买入',
    x: '固定持有 ' + hold + ' 个交易日后卖出',
    e: function (i, x, d) {
      var p = factorPctSeries(this, d, x)[i];
      return isFinite(p) && (this._low ? p <= this._edge : p >= 1 - this._edge);
    },
    q: function (i, x, d, held) { return held >= this._hold; }
  };
}

/* ============================================================
   组合回测（#21）：用因子给一篮子标的打分，定期持有得分最好的 K 只。
   与单标的回测的区别：同时持有多只、有单票上限/总仓上限/冷却期。
   ============================================================ */
var PF = { K: 3, maxOne: 0.40, maxTotal: 0.95, rebal: 10, cool: 5 };

/* 取多个标的的公共交易日，构成对齐面板 */
function buildPanel(list) {
  var cnt = {}, i, j;
  list.forEach(function (d) {
    var seen = {};
    for (i = 0; i < d.t.length; i++) if (!seen[d.t[i]]) { seen[d.t[i]] = 1; cnt[d.t[i]] = (cnt[d.t[i]] || 0) + 1; }
  });
  var dates = Object.keys(cnt).filter(function (k) { return cnt[k] === list.length; }).sort();
  if (dates.length < 300) return null;
  var pos = {}; for (i = 0; i < dates.length; i++) pos[dates[i]] = i;
  var syms = list.map(function (d) {
    var c = new Array(dates.length), rc = new Array(dates.length), ro = new Array(dates.length);
    for (i = 0; i < d.t.length; i++) {
      var k = pos[d.t[i]];
      if (k !== undefined) { c[k] = d.c[i]; rc[k] = (d.rc || d.c)[i]; ro[k] = (d.ro || d.o)[i]; }
    }
    return { name: d.name, sym: d.sym, otc: !!d.otc, c: c, rc: rc, ro: ro, d: d };
  });
  return { dates: dates, syms: syms };
}

/* 每个标的在公共日历上的因子滚动分位 */
function panelScores(panel, featIdx, win) {
  var f = FEATURES[featIdx][2];
  return panel.syms.map(function (s) {
    var n = panel.dates.length, vals = new Array(n).fill(NaN), i, j;
    // 因子按各标的自身的原始序列计算，再映射到公共日历
    var x = s.d.__x || (s.d.__x = indicators(s.d));
    var raw = [];
    for (i = 0; i < s.d.c.length; i++) { var v; try { v = f(i, x, s.d); } catch (e) { v = NaN; } raw.push(v); }
    var map = {}; for (i = 0; i < s.d.t.length; i++) map[s.d.t[i]] = raw[i];
    for (i = 0; i < n; i++) { var g = map[panel.dates[i]]; vals[i] = g === undefined ? NaN : g; }
    var pct = new Array(n).fill(NaN);
    for (i = win; i < n; i++) {
      var cur = vals[i]; if (!isFinite(cur)) continue;
      var lt = 0, tot = 0;
      for (j = i - win; j < i; j++) { var u = vals[j]; if (!isFinite(u)) continue; tot++; if (u < cur) lt++; }
      if (tot >= win * 0.6) pct[i] = lt / tot;
    }
    return pct;
  });
}

/* 组合回测主体。opt: {a,b} 限定区间；{rnd} 传入随机数发生器则改为随机选股（基准用） */
function portfolioBacktest(panel, scores, lowSide, cfg, opt) {
  opt = opt || {};
  var n = panel.dates.length, M = panel.syms.length, i, m;
  var cash = cfg.cap0, hold = {}, eq = new Array(n).fill(cfg.cap0);
  var lastSell = {}, trades = 0, feeSum = 0, peak = cfg.cap0, mdd = 0;
  var comm = cfg.fee / 1e4, slip = cfg.slip / 1e4;
  var start = Math.max(260, opt.a || 0);
  var LAST = Math.min(n - 1, opt.b != null ? opt.b : n - 1);

  function mv(i2) {                                  // 持仓市值
    var s = 0;
    for (var k in hold) {
      var h = hold[k], sy = panel.syms[k];
      if (isFinite(sy.c[i2])) s += h.amt * (sy.c[i2] / h.adj) / (1 + slip);
    }
    return s;
  }
  for (i = start; i < LAST; i++) {
    eq[i] = cash + mv(i);
    if (eq[i] > peak) peak = eq[i];
    var dd = (peak - eq[i]) / peak; if (dd > mdd) mdd = dd;
    if ((i - start) % cfg.rebal !== 0) continue;

    // 打分排序，选出目标持仓；传入 rnd 时改为随机排序（随机选股基准）
    var rank = [];
    for (m = 0; m < M; m++) {
      var p = scores[m][i];
      if (isFinite(p) && isFinite(panel.syms[m].ro[i + 1])) rank.push({ m: m, p: lowSide ? p : 1 - p });
    }
    if (opt.rnd) { for (m = 0; m < rank.length; m++) rank[m].p = opt.rnd(); }
    rank.sort(function (a, b) { return a.p - b.p; });
    var target = {};
    for (m = 0; m < Math.min(cfg.K, rank.length); m++) {
      if ((lastSell[rank[m].m] || -99) > i - cfg.cool) continue;   // 冷却期内不重新买入
      target[rank[m].m] = 1;
    }
    // 卖出不在目标里的
    for (var k2 in hold) {
      if (target[k2]) continue;
      var h2 = hold[k2], sy2 = panel.syms[k2];
      if (!isFinite(sy2.ro[i + 1])) continue;
      var amtOut = h2.amt * (sy2.c[i] / h2.adj) * (1 - slip) / (1 + slip);
      var R2 = mkt(sy2);
      var fOut = Math.max(amtOut * comm, R2.minComm) + (sy2.otc ? 0 : amtOut * R2.stamp);
      cash += amtOut - fOut; feeSum += fOut; trades++;
      lastSell[k2] = i;
      delete hold[k2];
    }
    // 买入目标里尚未持有的，等权、受单票与总仓上限约束
    var equity = cash + mv(i), need = [];
    for (var k3 in target) if (!hold[k3]) need.push(+k3);
    for (m = 0; m < need.length; m++) {
      var idx = need[m], sy3 = panel.syms[idx];
      var room = Math.min(equity * cfg.maxOne, equity * cfg.maxTotal - mv(i), cash);
      var budget = Math.min(room, equity * cfg.maxTotal / cfg.K);
      if (budget <= 0) continue;
      var R3 = mkt(sy3);
      var px = sy3.ro[i + 1] * (1 + slip);
      var sh = sy3.otc ? budget / px : Math.floor(budget / px / R3.lot) * R3.lot;
      if (sh <= 0) continue;
      var amtIn = sh * px, fIn = Math.max(amtIn * comm, R3.minComm);
      if (amtIn + fIn > cash) continue;
      cash -= amtIn + fIn; feeSum += fIn; trades++;
      hold[idx] = { amt: amtIn, adj: sy3.c[i + 1], sh: sh };
    }
  }
  eq[LAST] = cash + mv(LAST);
  var yrs = Math.max(LAST - start, 1) / 243;
  var mult = eq[LAST] / cfg.cap0;
  var er = [], z;
  for (z = start + 1; z <= LAST; z++) if (eq[z - 1] > 0) er.push(eq[z] / eq[z - 1] - 1);
  var mu = 0, q = 0;
  for (z = 0; z < er.length; z++) mu += er[z]; mu /= er.length || 1;
  for (z = 0; z < er.length; z++) q += (er[z] - mu) * (er[z] - mu);
  var vol = er.length > 20 ? Math.sqrt(q / (er.length - 1)) * Math.sqrt(243) * 100 : 0;
  var ann = (Math.pow(Math.max(mult, 1e-6), 1 / yrs) - 1) * 100;
  return { ann: ann, ret: (mult - 1) * 100, mdd: mdd * 100, vol: vol,
           sharpe: vol > 0 ? ann / vol : 0, calmar: mdd > 0 ? ann / (mdd * 100) : 0,
           trades: trades, feeSum: feeSum, from: panel.dates[start], to: panel.dates[LAST],
           eq: eq, start: start, last: LAST };
}

/* 等权持有全篮子作为基准 */
function equalWeightBench(panel, start) {
  var n = panel.dates.length, M = panel.syms.length, eq = [], i, m;
  for (i = start; i < n; i++) {
    var s = 0, cnt2 = 0;
    for (m = 0; m < M; m++) {
      var sy = panel.syms[m];
      if (isFinite(sy.c[i]) && isFinite(sy.c[start]) && sy.c[start] > 0) { s += sy.c[i] / sy.c[start]; cnt2++; }
    }
    eq.push(cnt2 ? s / cnt2 : 1);
  }
  var peak = 1, mdd = 0, er = [];
  for (i = 0; i < eq.length; i++) {
    if (eq[i] > peak) peak = eq[i];
    var dd = (peak - eq[i]) / peak; if (dd > mdd) mdd = dd;
    if (i && eq[i - 1] > 0) er.push(eq[i] / eq[i - 1] - 1);
  }
  var yrs = Math.max(eq.length, 1) / 243;
  var ann = (Math.pow(Math.max(eq[eq.length - 1], 1e-6), 1 / yrs) - 1) * 100;
  var mu = 0, q = 0;
  for (i = 0; i < er.length; i++) mu += er[i]; mu /= er.length || 1;
  for (i = 0; i < er.length; i++) q += (er[i] - mu) * (er[i] - mu);
  var vol = er.length > 20 ? Math.sqrt(q / (er.length - 1)) * Math.sqrt(243) * 100 : 0;
  return { ann: ann, mdd: mdd * 100, vol: vol,
           sharpe: vol > 0 ? ann / vol : 0, calmar: mdd > 0 ? ann / (mdd * 100) : 0 };
}

/* ============================================================
   资产配置研究：不预测涨跌，只研究"各买多少、多久调一次"
   ============================================================ */
var ALLOC_BASKET = ['1.510300', '1.510500', '0.159915', '1.588000'];   // 沪深300 / 中证500 / 创业板 / 科创50
var REBAL_DAYS = 60;                                                    // 约一个季度

/* 由一条净值序列算风险指标 */
function curveStats(eq, from) {
  var i, peak = eq[from], mdd = 0, er = [];
  for (i = from; i < eq.length; i++) {
    if (eq[i] > peak) peak = eq[i];
    var dd = (peak - eq[i]) / peak; if (dd > mdd) mdd = dd;
    if (i > from && eq[i - 1] > 0) er.push(eq[i] / eq[i - 1] - 1);
  }
  var yrs = Math.max(eq.length - 1 - from, 1) / 243;
  var ann = (Math.pow(Math.max(eq[eq.length - 1] / eq[from], 1e-6), 1 / yrs) - 1) * 100;
  var mu = 0, q = 0;
  for (i = 0; i < er.length; i++) mu += er[i]; mu /= er.length || 1;
  for (i = 0; i < er.length; i++) q += (er[i] - mu) * (er[i] - mu);
  var vol = er.length > 20 ? Math.sqrt(q / (er.length - 1)) * Math.sqrt(243) * 100 : 0;
  return { ann: ann, mdd: mdd * 100, vol: vol,
           sharpe: vol > 0 ? ann / vol : 0, calmar: mdd > 0 ? ann / (mdd * 100) : 0,
           total: (eq[eq.length - 1] / eq[from] - 1) * 100 };
}
/* 按固定权重 + 定期再平衡走一条净值；rebal=0 表示买入后不再调仓 */
function weightedCurve(panel, w, rebal, feeRate) {
  var n = panel.dates.length, M = panel.syms.length, eq = new Array(n).fill(1), i, m;
  var units = [];                                   // 各资产持有的"份额"
  for (m = 0; m < M; m++) units[m] = w[m] / panel.syms[m].c[0];
  for (i = 0; i < n; i++) {
    var v = 0;
    for (m = 0; m < M; m++) v += units[m] * panel.syms[m].c[i];
    eq[i] = v;
    if (rebal > 0 && i > 0 && i % rebal === 0) {
      var turn = 0;
      for (m = 0; m < M; m++) {
        var cur = units[m] * panel.syms[m].c[i], tgt = v * w[m];
        turn += Math.abs(tgt - cur);
        units[m] = tgt / panel.syms[m].c[i];
      }
      eq[i] = v - turn / 2 * feeRate * 2;           // 双边换手各计一次费用
      var scale = eq[i] / v;
      for (m = 0; m < M; m++) units[m] *= scale;
    }
  }
  return eq;
}
/* 定投模拟：每 step 个交易日投入 amount 元 */
function dcaSim(d, amount, step, cfg) {
  var n = d.c.length, RO = d.ro || d.o, RC = d.rc || d.c;
  var comm = cfg.fee / 1e4, slip = cfg.slip / 1e4, otc = !!d.otc, MK = mkt(d);
  var shares = 0, invested = 0, fees = 0, buys = 0, skipped = 0, adjBase = null, units = 0;
  var eq = new Array(n).fill(0), inv = new Array(n).fill(0), i;
  for (i = 0; i < n - 1; i++) {
    if (i % step === 0 && RO[i + 1] > 0) {
      var px = RO[i + 1] * (1 + slip);
      var sh = otc ? amount / px : Math.floor(amount / px / MK.lot) * MK.lot;
      if (sh > 0) {
        var amt = sh * px, f = otc ? amt * cfg.buyFee / 100 : Math.max(amt * comm, MK.minComm);
        if (amt + f <= amount * 1.02) {
          invested += amt + f; fees += f; buys++;
          units += amt / d.o[i + 1];                // 用复权价累计"总收益份额"
        } else skipped++;
      } else skipped++;
    }
    eq[i] = units * d.c[i];
    inv[i] = invested;
  }
  eq[n - 1] = units * d.c[n - 1]; inv[n - 1] = invested;
  return { eq: eq, inv: inv, invested: invested, fees: fees, buys: buys, skipped: skipped,
           end: eq[n - 1], gain: invested > 0 ? (eq[n - 1] / invested - 1) * 100 : 0 };
}

/* ---------- 实测胜率 / 赔率 ----------
   在当前演练位置之前的 LOOK 根里，逐根假设"此处买入"，
   看后续是先摸到目标(+tp%)还是先跌破止损(-sl%)：
     胜率 = 先达目标的比例
     赔率 = 平均盈利幅度 ÷ 平均亏损幅度
   同一根内两边都触及时按先止损处理（保守）。
   这两个值随标的、随演练进度、随止损/目标输入而变化。 */
var MEAS_LOOK = 250, MEAS_HOLD = 60;
function measureWinOdds(upto, sl, tp) {
  if (!D || upto < 30) return null;
  var s = Math.max(1, upto - MEAS_LOOK), win = 0, loss = 0, gsum = 0, lsum = 0, i, j;
  for (i = s; i < upto; i++) {
    var e = D.c[i]; if (!(e > 0)) continue;
    var up = e * (1 + tp / 100), dn = e * (1 - sl / 100), end = Math.min(upto, i + MEAS_HOLD), done = false;
    for (j = i + 1; j <= end; j++) {
      if (D.l[j] <= dn) { loss++; lsum += sl / 100; done = true; break; }
      if (D.h[j] >= up) { win++; gsum += tp / 100; done = true; break; }
    }
    if (!done) {                       // 到期未触发，按最终盈亏归类
      var r = (D.c[end] - e) / e;
      if (r > 0) { win++; gsum += r; } else { loss++; lsum += Math.abs(r); }
    }
  }
  var n = win + loss;
  if (n < 20) return null;
  var aw = win ? gsum / win : 0, al = loss ? lsum / loss : 0;
  return { win: win / n, odds: al > 0 ? aw / al : (aw > 0 ? 9.99 : 0),
           avgWin: aw, avgLoss: al, n: n, nw: win, nl: loss };
}
/* 用户手动改过就不再自动覆盖，取数时重置 */
var manualWin = false, manualOdds = false;
$('fWin').addEventListener('input', function () { manualWin = true; });
$('fOdds').addEventListener('input', function () { manualOdds = true; });

/* ---------- 参数 / 凯利 ---------- */
/* A股真实成本常数：印花税卖出单边 0.05%（2023-08 起减半）；佣金每笔最低 5 元；一手 100 股 */
var STAMP = 0.0005, MIN_COMM = 5, LOT = 100;
/* 美股每单最低佣金（美元）。中资券商买美股无印花税，1 股起买；不同券商差异大，取常见下限 */
var US_MIN_COMM = 1;
function cfgFromForm() {
  var win = clamp(+$('fWin').value || 55, 1, 99) / 100;
  var sl = clamp(+$('fSL').value || 5, 0.5, 50);
  var tp = clamp(+$('fTP').value || 12, 1, 200);
  var odds = clamp(+$('fOdds').value || (tp / sl), 0.1, 20);
  var fee = clamp(+$('fFee').value || 0, 0, 200);      // 场内=佣金‱；场外=申购费%
  var slip = clamp(+$('fSlip').value || 0, 0, 200);    // ‱，买卖各一次
  var cap0 = clamp(+$('fCap').value || 100000, 1000, 1e9);
  var kelly = (win * odds - (1 - win)) / odds;
  var pos = clamp(kelly / 2, 0, 0.8);
  var ev = win * tp - (1 - win) * sl;
  return { win: win, sl: sl, tp: tp, odds: odds, fee: fee, slip: slip, cap0: cap0,
           buyFee: fee, kelly: kelly, pos: pos, ev: ev,
           stopMode: $('fStopMode').value,
           atrMul: clamp(+$('fAtrMul').value || 1.5, 0.3, 6),
           trailOn: clamp(+$('fTrailOn').value || 0, 0, 50),
           trailBack: clamp(+$('fTrailBack').value || 5, 0.5, 30) };
}
function syncOdds() {
  // 有行情时赔率由实测给出，这里只在无数据时用 目标÷止损 兜底
  var sl = +$('fSL').value, tp = +$('fTP').value;
  if (!D && !manualOdds && sl > 0 && tp > 0) $('fOdds').value = (tp / sl).toFixed(2);
  paintSignals();
}
$('fSL').addEventListener('input', syncOdds);
$('fTP').addEventListener('input', syncOdds);
['fWin', 'fOdds', 'fFee', 'fSlip', 'fCap', 'fAtrMul', 'fTrailOn', 'fTrailBack'].forEach(function (id) {
  $(id).addEventListener('input', paintSignals);
});
$('fStopMode').addEventListener('change', function () {
  var atr = this.value === 'atr';
  $('fSL').disabled = atr;
  $('fSL').title = atr ? 'ATR 动态止损模式下不使用固定止损' : '';
  log('止损方式已切换为' + (atr ? 'ATR 动态（距离 = 开仓时 ATR(14) × 倍数，波动大时自动放宽）' : '固定百分比') +
      '，需重新生成策略才会生效', 'sys');
  paintSignals();
});

/* ============================================================
   6. K 线图 + 播放演练
   ============================================================ */
/* 图表尺寸自愈。
   ECharts 在 init 时把容器宽高记死；如果那一刻容器还没完成布局（页面在后台标签页里打开、
   窗口尚未显示、父容器 flex 高度未定），它会记成 0×0 或 100×100，此后无论怎么 setOption
   都画不出东西，表现就是"K线图卡住、换标的没反应、点什么都没用"，只有手动改变窗口大小才恢复。

   注意 ResizeObserver 单独不够：页面在后台标签页里时，ResizeObserver 回调和 requestAnimationFrame
   一样会被浏览器挂起，而"后台标签页"正是产生 0 尺寸初始化的主要场景。所以真正兜底的是
   syncSize()——它在每次重绘前直接比对容器实际尺寸，不依赖任何异步回调。
   另外 ECharts 对 0 尺寸容器可能记成 0×0 也可能退化成 100×100，因此判据只能是"和容器不一致"。 */
function keepSized(inst, el) {
  if (!inst || !el) return inst;
  inst.__el = el;
  syncSize(inst);
  if (window.ResizeObserver) {
    try { new ResizeObserver(function () { syncSize(inst); }).observe(el); } catch (e) { /* 老浏览器忽略 */ }
  }
  return inst;
}
function syncSize(inst) {
  var el = inst && inst.__el;
  if (!el || !el.isConnected) return;
  var w = el.clientWidth, h = el.clientHeight;
  if (w > 0 && h > 0 && (inst.getWidth() !== w || inst.getHeight() !== h)) inst.resize();
}
var chart = keepSized(echarts.init($('chart'), null, { renderer: 'canvas' }), $('chart'));
var play = { idx: 0, timer: 0, on: false };

function baseOption() {
  return {
    animation: false,
    backgroundColor: 'transparent',
    grid: [{ left: 52, right: 16, top: 26, height: '62%' }, { left: 52, right: 16, top: '74%', height: '13%' }],
    axisPointer: { link: [{ xAxisIndex: 'all' }], label: { backgroundColor: '#1a2634' } },
    tooltip: {
      trigger: 'axis', backgroundColor: 'rgba(8,13,20,.96)', borderColor: '#22d3ee', borderWidth: 1,
      textStyle: { color: '#c3d1e0', fontSize: 11 },
      formatter: function (ps) {
        var k = null, ma = null, sub = null, nav = null;
        ps.forEach(function (p) {
          var v = (p.data && p.data.value !== undefined) ? p.data.value : p.data;
          if (p.seriesName === 'K线') k = p.data;
          else if (p.seriesName === '20日均线') ma = v;
          else if (p.seriesName === '副图') sub = v;
          else if (p.seriesName === '净值') nav = v;
        });
        var head = '<b style="color:#f5c542">' + ps[0].axisValue + '</b><br>';
        if (isFinite(nav)) {
          var col2 = isFinite(sub) && sub >= 0 ? '#ff3b47' : '#12d18a';
          return head + '单位净值 <span style="color:#22d3ee">' + px(nav) + '</span><br>' +
            '日涨跌 <span style="color:' + col2 + '">' + (isFinite(sub) ? (sub >= 0 ? '+' : '') + fx(sub, 2) + '%' : '—') + '</span><br>' +
            '20日均线 <span style="color:#f5c542">' + (isFinite(ma) ? px(ma) : '—') + '</span>';
        }
        if (!k || k[1] === '-') return '';
        var o = k[1], c = k[2], l = k[3], h = k[4], col = c >= o ? '#ff3b47' : '#12d18a';
        return head +
          '开 <span style="color:' + col + '">' + px(o) + '</span>　高 <span style="color:' + col + '">' + px(h) + '</span><br>' +
          '低 <span style="color:' + col + '">' + px(l) + '</span>　收 <span style="color:' + col + '">' + px(c) + '</span><br>' +
          '20日均线 <span style="color:#f5c542">' + (isFinite(ma) ? px(ma) : '—') + '</span><br>' +
          '成交量 <span style="color:#22d3ee">' + (isFinite(sub) ? (sub / 1e4).toFixed(0) + ' 万' : '—') + '</span>';
      }
    },
    xAxis: [
      { type: 'category', data: [], boundaryGap: true, axisLine: { lineStyle: { color: '#1f2d3d' } }, axisLabel: { color: '#5d6f82', fontSize: 9 }, splitLine: { show: false }, min: 'dataMin', max: 'dataMax' },
      { type: 'category', gridIndex: 1, data: [], boundaryGap: true, axisLine: { lineStyle: { color: '#1f2d3d' } }, axisLabel: { show: false }, axisTick: { show: false }, min: 'dataMin', max: 'dataMax' }
    ],
    yAxis: [
      { scale: true, position: 'left', axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: '#5d6f82', fontSize: 9 }, splitLine: { lineStyle: { color: '#0f1720' } } },
      { scale: true, gridIndex: 1, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false }, splitLine: { show: false } }
    ],
    dataZoom: [
      { type: 'inside', xAxisIndex: [0, 1], start: 60, end: 100 },
      {
        type: 'slider', xAxisIndex: [0, 1], bottom: 6, height: 16, start: 60, end: 100,
        left: 52, right: 48,                                    // 两端留出空间，避免起止日期标签被面板裁掉
        labelFormatter: function (v, s) { return s ? String(s).slice(2) : ''; },
        backgroundColor: '#080d14', borderColor: '#1f2d3d', fillerColor: 'rgba(34,211,238,.10)',
        handleStyle: { color: '#f5c542', borderColor: '#f5c542' }, moveHandleStyle: { color: '#1f2d3d' },
        dataBackground: { lineStyle: { color: '#2a3a4a' }, areaStyle: { color: '#111c26' } },
        selectedDataBackground: { lineStyle: { color: '#22d3ee' }, areaStyle: { color: 'rgba(34,211,238,.14)' } },
        textStyle: { color: '#5d6f82', fontSize: 9 }
      }
    ],
    series: [
      // large 模式：1000 根 K 线的整图重绘从 28ms 降到 20ms，代价是不做逐根 hover 高亮
      //（tooltip 是按坐标轴触发的，不受影响）
      { name: 'K线', type: 'candlestick', data: [], large: true, largeThreshold: 200,
        itemStyle: { color: '#ff3b47', color0: '#0b1017', borderColor: '#ff3b47', borderColor0: '#12d18a' } },
      { name: '20日均线', type: 'line', data: [], smooth: true, symbol: 'none', lineStyle: { width: 1.4, color: '#f5c542' }, z: 5 },
      { name: '副图', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: [], large: true, largeThreshold: 200, itemStyle: { color: '#1d3a4a' } },
      { name: '净值', type: 'line', data: [], smooth: false, symbol: 'none', z: 4,
        lineStyle: { width: 1.6, color: '#22d3ee' },
        areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [
          { offset: 0, color: 'rgba(34,211,238,.22)' }, { offset: 1, color: 'rgba(34,211,238,0)' }] } } }
    ]
  };
}

/* ---------- 概率区间推演 ----------
   用最近 LOOK 根日线估计对数收益的漂移 μ 与波动 σ，
   按对数正态分布给出未来 H 个交易日的分位区间（p5/p25/p50/p75/p95）。
   这是历史波动的统计外推，不是预测。 */
var PROJ = { H: 20, LOOK: 120, out: null };   // on 字段已去掉：推演不再叠加在主图上
function normCdf(x) {
  var t = 1 / (1 + 0.2316419 * Math.abs(x));
  var d = 0.3989422804014327 * Math.exp(-x * x / 2);
  var p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x > 0 ? 1 - p : p;
}
function nextBizDays(lastDate, h) {
  var d = new Date(lastDate.replace(/-/g, '/')), out = [];
  while (out.length < h) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    out.push(d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()));
  }
  return out;
}
function computeProjection(upto) {
  var s = Math.max(1, upto - PROJ.LOOK + 1), r = [], i;
  for (i = s; i <= upto; i++) {
    var a = D.c[i - 1], b = D.c[i];
    if (a > 0 && b > 0) r.push(Math.log(b / a));
  }
  if (r.length < 30) return null;
  var n = r.length, mu = 0, q = 0;
  for (i = 0; i < n; i++) mu += r[i]; mu /= n;
  for (i = 0; i < n; i++) q += (r[i] - mu) * (r[i] - mu);
  var sd = Math.sqrt(q / (n - 1));
  if (!(sd > 0)) return null;

  // 漂移与波动取自复权序列（分红不算下跌），但展示价必须是真实市价 ——
  // 否则美股这类经历过拆股的标的会显示成后复权价（英伟达曾显示 111458 而不是 111）
  var RC = D.rc || D.c;
  var S0 = RC[upto], H = PROJ.H;
  var scale = D.c[upto] > 0 ? S0 / D.c[upto] : 1;   // 复权价 → 真实价的换算比例
  var Z = { p5: -1.6448536, p25: -0.6744898, p50: 0, p75: 0.6744898, p95: 1.6448536 };
  var band = { p5: [], p25: [], p50: [], p75: [], p95: [] };
  for (var hh = 1; hh <= H; hh++) {
    var m = mu * hh, sg = sd * Math.sqrt(hh);
    for (var k in Z) band[k].push(+(S0 * Math.exp(m + sg * Z[k])).toFixed(4));
  }
  // 最近 60 根的对数价格最小二乘趋势，向前延伸 H 根
  var L = Math.min(60, upto), xs = [], ys = [];
  for (i = 0; i < L; i++) { xs.push(i); ys.push(Math.log(D.c[upto - L + 1 + i])); }
  var mx = (L - 1) / 2, my = ys.reduce(function (a, b) { return a + b; }, 0) / L, sxy = 0, sxx = 0;
  for (i = 0; i < L; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) * (xs[i] - mx); }
  var slope = sxx ? sxy / sxx : 0, intercept = my - slope * mx;
  var reg = [];
  for (i = 0; i < L + H; i++) reg.push(+(Math.exp(intercept + slope * i) * scale).toFixed(4));

  var sgH = sd * Math.sqrt(H);
  return {
    band: band, reg: reg, regFrom: upto - L + 1,
    S0: S0, H: H, mu: mu, sd: sd,
    annVol: sd * Math.sqrt(243) * 100,
    annDrift: (Math.exp(mu * 243) - 1) * 100,
    regSlopeAnn: (Math.exp(slope * 243) - 1) * 100,
    upProb: normCdf(mu * H / sgH) * 100
  };
}
/* ---------- 概率区间推演（独立窗口） ----------
   以前推演是 6 条 series 叠在主 K 线图上，开关一次就要整图重绘（1000 根 K 线，20-28ms），
   还要把 x 轴向右扩 20 根、所有序列补齐长度。现在整块搬进 #mask4 自己的图表实例：
   主图彻底不知道推演的存在，点推演对 K 线图零成本。 */
var pjChart = null;
function paintProjStats(p) {
  var b = p.band, last = p.H - 1, chg = (b.p50[last] / p.S0 - 1) * 100;
  $('pjLook').textContent = PROJ.LOOK;
  $('pjH').textContent = p.H;
  $('pjMid').textContent = px(b.p50[last]);
  $('pjMid').className = 'v ' + (chg >= 0 ? 'u' : 'd');
  $('pjMidS').textContent = '相对当前 ' + px(p.S0) + '　' + (chg >= 0 ? '+' : '') + fx(chg, 2) + '%';
  $('pjP50').textContent = px(b.p25[last]) + ' ~ ' + px(b.p75[last]);
  $('pjP90').textContent = px(b.p5[last]) + ' ~ ' + px(b.p95[last]);
  $('pjUp').textContent = fx(p.upProb, 1) + '%';
  $('pjUp').className = 'v ' + (p.upProb >= 50 ? 'u' : 'd');
  $('pjVol').textContent = fx(p.annVol, 1) + '%';
  $('pjSlope').textContent = (p.regSlopeAnn >= 0 ? '+' : '') + fx(p.regSlopeAnn, 1) + '%';
  $('pjSlope').className = 'v ' + (p.regSlopeAnn >= 0 ? 'u' : 'd');
}
/* 推演窗口自己的图：左边最近 60 根真实走势，右边 H 根分位扇形 */
function paintProjChart(p) {
  var BACK = 60, i;
  var a0 = Math.max(0, play.idx - BACK + 1);
  var hist = [], cat = [];
  var RC = D.rc || D.c;                                 // 展示用真实市价，与 S0 同口径
  for (i = a0; i <= play.idx; i++) { cat.push(D.t[i]); hist.push(+RC[i].toFixed(4)); }
  cat = cat.concat(nextBizDays(D.t[play.idx], p.H));
  var W = cat.length, anchor = play.idx - a0;            // 当前价在新数组里的下标
  var mk = function () { return new Array(W).fill('-'); };
  var lo = mk(), hi = mk(), q25 = mk(), q75 = mk(), mid = mk(), reg = mk();
  while (hist.length < W) hist.push('-');
  lo[anchor] = p.S0; hi[anchor] = 0; q25[anchor] = p.S0; q75[anchor] = p.S0; mid[anchor] = p.S0;
  for (i = 0; i < p.H; i++) {
    var k = anchor + 1 + i;
    lo[k] = p.band.p5[i];
    hi[k] = +(p.band.p95[i] - p.band.p5[i]).toFixed(4);  // 与 lo 堆叠出 90% 区间带
    q25[k] = p.band.p25[i]; q75[k] = p.band.p75[i]; mid[k] = p.band.p50[i];
  }
  for (i = 0; i < p.reg.length; i++) {                   // 回归线：历史尾段 + 外推段
    var idx = p.regFrom + i - a0;
    if (idx >= 0 && idx < W) reg[idx] = p.reg[i];
  }
  if (!pjChart) pjChart = keepSized(echarts.init($('pjChart')), $('pjChart'));
  syncSize(pjChart);
  pjChart.setOption({
    animation: false, backgroundColor: 'transparent',
    grid: { left: 56, right: 16, top: 16, bottom: 46 },
    tooltip: {
      trigger: 'axis', backgroundColor: 'rgba(8,13,20,.96)', borderColor: '#22d3ee', borderWidth: 1,
      textStyle: { color: '#c3d1e0', fontSize: 11 },
      formatter: function (ps) {
        var g = {}; ps.forEach(function (x) { g[x.seriesName] = x.data; });
        var head = '<b style="color:#f5c542">' + ps[0].axisValue + '</b><br>';
        if (isFinite(g['实际走势'])) return head + '收盘 <span style="color:#22d3ee">' + px(g['实际走势']) + '</span>';
        if (!isFinite(g['中位'])) return '';
        return head + '<span style="color:#5d6f82">概率推演（非预测）</span><br>' +
          '中位 <span style="color:#f5c542">' + px(g['中位']) + '</span><br>' +
          (isFinite(g['90%下沿']) && isFinite(g['90%区间'])
            ? '90% 区间 <span style="color:#22d3ee">' + px(g['90%下沿']) + ' ~ ' + px(g['90%下沿'] + g['90%区间']) + '</span>' : '');
      }
    },
    xAxis: {
      type: 'category', data: cat, boundaryGap: false,
      axisLine: { lineStyle: { color: '#1f2d3d' } },
      axisLabel: { color: '#5d6f82', fontSize: 9.5, interval: Math.ceil(W / 9) },
      splitLine: { show: false }
    },
    yAxis: {
      scale: true, axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: '#5d6f82', fontSize: 9.5 },
      splitLine: { lineStyle: { color: '#101a24' } }
    },
    series: [
      { name: '90%下沿', type: 'line', stack: 'pj', data: lo, symbol: 'none', z: 2,
        lineStyle: { width: 0, opacity: 0 }, areaStyle: { opacity: 0 }, silent: true, tooltip: { show: false } },
      { name: '90%区间', type: 'line', stack: 'pj', data: hi, symbol: 'none', z: 2,
        lineStyle: { width: 0, opacity: 0 }, areaStyle: { color: 'rgba(245,197,66,.15)' }, silent: true },
      { name: '25%分位', type: 'line', data: q25, symbol: 'none', z: 3, silent: true,
        lineStyle: { width: 1, color: '#7a6015', type: 'dashed' } },
      { name: '75%分位', type: 'line', data: q75, symbol: 'none', z: 3, silent: true,
        lineStyle: { width: 1, color: '#7a6015', type: 'dashed' } },
      { name: '回归趋势', type: 'line', data: reg, symbol: 'none', z: 4, silent: true,
        lineStyle: { width: 1.2, color: '#3b82f6' } },
      { name: '中位', type: 'line', data: mid, symbol: 'none', z: 6,
        lineStyle: { width: 1.6, color: '#f5c542', type: 'dotted' } },
      { name: '实际走势', type: 'line', data: hist, symbol: 'none', z: 5,
        lineStyle: { width: 1.6, color: '#22d3ee' },
        areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [
          { offset: 0, color: 'rgba(34,211,238,.18)' }, { offset: 1, color: 'rgba(34,211,238,0)' }] } } }
    ]
  }, true);
}
chart.setOption(baseOption());
function resizeAllCharts() {
  [chart, eqChart, rndChart, sensChart, alChart, pjChart].forEach(function (c) { if (c) { c.resize(); syncSize(c); } });
}
window.addEventListener('resize', resizeAllCharts);
// 页面在后台标签页里加载时容器尺寸为 0，切回前台要重新量一次
document.addEventListener('visibilitychange', function () { if (!document.hidden) resizeAllCharts(); });
window.addEventListener('pageshow', resizeAllCharts);

function chartData(upto) {
  var n = D.c.length, kd = [], md = [], vd = [], nav = [], i;
  var otc = !!D.otc;
  for (i = 0; i < n; i++) {
    if (i <= upto) {
      md.push(isFinite(X.ma20[i]) ? +X.ma20[i].toFixed(4) : '-');
      if (otc) {
        kd.push('-'); nav.push(+D.c[i].toFixed(4));
        var rr = D.rr ? D.rr[i] : 0;                       // 场外基金副图画日涨跌幅
        vd.push({ value: +(+rr).toFixed(2), itemStyle: { color: rr >= 0 ? 'rgba(255,59,71,.60)' : 'rgba(18,209,138,.50)' } });
      } else {
        kd.push([D.o[i], D.c[i], D.l[i], D.h[i]]); nav.push('-');
        vd.push({ value: D.v[i], itemStyle: { color: D.c[i] >= D.o[i] ? 'rgba(255,59,71,.55)' : 'rgba(18,209,138,.45)' } });
      }
    } else { kd.push('-'); md.push('-'); vd.push('-'); nav.push('-'); }
  }
  return { kd: kd, md: md, vd: vd, nav: nav, otc: otc };
}
/* 主图只画行情本身。推演已独立成窗口（见 openProj），
   这里既不用扩 x 轴、也不用生成 6 条推演序列 —— 推演开关不再触碰主图。 */
function renderChart(follow) {
  syncSize(chart);                            // 容器曾在 0 尺寸下初始化时的兜底，见 keepSized
  var cd = chartData(play.idx), n = D.c.length;
  var opt = {
    xAxis: [{ data: D.t }, { data: D.t }],
    series: [{ data: cd.kd }, { data: cd.md }, { data: cd.vd }, { data: cd.nav }]
  };
  if (follow) {
    var s = Math.max(0, play.idx - 130), e = Math.min(n - 1, play.idx + 6);
    opt.dataZoom = [{ startValue: s, endValue: e }, { startValue: s, endValue: e }];
  }
  chart.setOption(opt);
  $('pgTxt').textContent = (play.idx + 1) + ' / ' + n + '　' + D.t[play.idx];
}

function stopPlay() { clearTimeout(play.timer); play.on = false; $('btnPlay').textContent = '▶ 播放'; }
/* 演练调度。
   原来用 setInterval(tick, 速度)，但一次 tick 要整图重绘 1000 根 K 线，实测 40–70ms，
   远超 15 倍速的 8ms 间隔 —— 任务永远排不完，主线程被打满，点任何按钮（尤其是推演）都像卡死。
   改成「跑完一次再排下一次」的链式定时器，并强制留出不少于本次开销的空闲时间，
   把主线程占用率压到 50% 以下；机器跟不上时改为一帧多走几根、只重绘一次，倍速观感不变。 */
function startPlay() {
  if (!D) { log('无行情数据，请先点「获取数据」', 'err'); return; }
  if (play.on) return;
  if (play.idx >= D.c.length - 1) play.idx = 60;
  play.on = true; $('btnPlay').textContent = '⏵ 演练中';
  clearInterval(idleTicker);
  play.last = performance.now(); play.acc = 0; play.sig = 0;
  tick();
  function tick() {
    if (!play.on || !D) return;
    var t0 = performance.now(), end = D.c.length - 1;
    var step = +$('speed').value || 60;
    play.acc += t0 - play.last; play.last = t0;
    var adv = Math.floor(play.acc / step);
    if (adv < 1) adv = 1;
    if (adv > 8) adv = 8;                       // 单帧最多补 8 根，避免切回前台后暴走
    play.acc = Math.max(0, play.acc - adv * step);
    for (var q = 0; q < adv && play.idx < end; q++) {
      play.idx++;
      logBar(D.name, { d: D.t[play.idx], o: D.o[play.idx], h: D.h[play.idx], l: D.l[play.idx], c: D.c[play.idx], v: D.v[play.idx] }, D.c[play.idx - 1]);
    }
    renderChart(true);
    // 胜率/赔率是 250 根首触模拟，逐根重算既贵又没人看得过来，演练中每 4 根刷一次
    play.sig = (play.sig + 1) % 4;
    if (!play.sig) paintSignals();
    if (play.idx >= end) {
      stopPlay(); paintSignals();
      log('▣ 演练完成 · 已回放全部 ' + D.c.length + ' 根日线', 'ok'); startIdle(); return;
    }
    var cost = performance.now() - t0;
    play.timer = setTimeout(tick, Math.max(step - cost, Math.min(cost, 60)));
  }
}
$('btnPlay').onclick = startPlay;
$('btnPause').onclick = function () { if (play.on) { stopPlay(); log('⏸ 演练暂停于 ' + D.t[play.idx], 'sys'); startIdle(); } };
$('btnReset').onclick = function () {
  if (!D) return; stopPlay(); play.idx = 60; renderChart(true); paintSignals();
  log('⟲ 演练已重置至 ' + D.t[play.idx], 'sys'); startIdle();
};
$('speed').onchange = function () { if (play.on) { stopPlay(); startPlay(); } };

/* ---------- 推演开关 ---------- */
function openProj() {
  if (!D) { log('无行情数据，请先点「获取数据」', 'err'); return; }
  var p = computeProjection(play.idx);
  PROJ.out = p;
  if (!p) { log('✗ 样本不足 30 根，无法推演', 'err'); return; }
  $('pjSub').textContent = D.name + ' ｜ 起点 ' + D.t[play.idx] +
    '（演练进度 ' + (play.idx + 1) + '/' + D.c.length + '）｜ 外推 ' + p.H + ' 个交易日';
  $('mask4').classList.add('on');
  paintProjStats(p);
  paintProjChart(p);
  log('◈ 概率区间推演｜以 ' + D.t[play.idx] + ' 为起点，用最近 ' + PROJ.LOOK +
      ' 根日线的漂移与波动，按对数正态分布外推 ' + p.H + ' 个交易日', 'sys');
  log('　 中位 ' + px(p.band.p50[p.H - 1]) + '｜50% 落在 ' + px(p.band.p25[p.H - 1]) + '~' + px(p.band.p75[p.H - 1]) +
      '｜90% 落在 ' + px(p.band.p5[p.H - 1]) + '~' + px(p.band.p95[p.H - 1]), 'sys');
  log('　 上涨概率 ' + fx(p.upProb, 1) + '%｜年化波动 ' + fx(p.annVol, 1) + '%｜回归斜率(年化) ' +
      (p.regSlopeAnn >= 0 ? '+' : '') + fx(p.regSlopeAnn, 1) + '%', 'sys');
  log('⚠ 推演是历史波动的统计外推，只描述「按过去的波动幅度，未来大概散在哪」，不预测方向，不构成投资建议', 'err');
}
$('btnProj').onclick = openProj;
$('pjRefresh').onclick = openProj;
$('pjClose').onclick = function () { $('mask4').classList.remove('on'); };
$('mask4').onclick = function (e) { if (e.target === $('mask4')) $('mask4').classList.remove('on'); };

/* ---------- 场内实时快照轮询 ---------- */
var LIVE = { on: false, timer: 0, secid: null, last: '' };
/* us=true 时按美东时间判断（用 IANA 时区换算，夏令时自动处理），否则按本机时间判断 A 股时段 */
function inTradingHours(us) {
  if (us) {
    var s;
    try {
      s = new Date().toLocaleString('en-US', {
        timeZone: 'America/New_York', hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit'
      });
    } catch (e) { return false; }
    if (/Sat|Sun/.test(s)) return false;
    var hm = s.match(/(\d{1,2}):(\d{2})/);
    if (!hm) return false;
    var mm = (+hm[1] % 24) * 60 + (+hm[2]);
    return mm >= 570 && mm <= 961;                           // 09:30-16:01 美东，不含盘前盘后
  }
  var d = new Date(), w = d.getDay(), m = d.getHours() * 60 + d.getMinutes();
  if (w === 0 || w === 6) return false;
  return (m >= 555 && m <= 691) || (m >= 780 && m <= 905);   // 09:15-11:31 / 13:00-15:05
}
function applyQuote(q) {
  if (!D || D.otc) return false;
  var n = D.c.length, lastD = D.t[n - 1];
  var atEnd = play.idx >= n - 1;
  if (q.date > lastD) {                       // 新的交易日 → 追加一根
    D.t.push(q.date); D.o.push(q.o); D.h.push(q.h); D.l.push(q.l); D.c.push(q.c); D.v.push(q.v);
    if (D.rr) D.rr.push(q.chg);
    log('⟳ 新增当日K线 ' + q.date + ' 收 ' + px(q.c) + '（' + (q.chg >= 0 ? '+' : '') + fx(q.chg, 2) + '%）', 'ok');
  } else if (q.date === lastD) {              // 当日盘中 → 覆盖最后一根
    if (D.c[n - 1] === q.c && D.h[n - 1] === q.h && D.l[n - 1] === q.l) return false;
    D.o[n - 1] = q.o; D.h[n - 1] = q.h; D.l[n - 1] = q.l; D.c[n - 1] = q.c; D.v[n - 1] = q.v;
  } else return false;                        // 快照比本地数据还旧，忽略
  X = indicators(D);
  if (atEnd) play.idx = D.c.length - 1;
  $('barsTag').textContent = '日线 ' + D.c.length + ' 根';
  $('asofTag').textContent = '数据截止 ' + D.t[D.c.length - 1] + ' ' + q.time;
  renderChart(false); paintSignals();
  return true;
}
function pollQuote(manual) {
  if (!LIVE.secid) return;
  if (!manual && !inTradingHours(isUS({ sym: LIVE.secid }))) { $('btnLive').textContent = '⟳ 实时·休市'; return; }
  fetchQuote(LIVE.secid).then(function (q) {
    var changed = applyQuote(q);
    $('btnLive').textContent = '⟳ ' + q.time;
    if (changed) log('⟳ 快照 ' + q.date + ' ' + q.time + '　最新 ' + px(q.c) +
      '　<span class="' + (q.chg >= 0 ? 'up' : 'dn') + '">' + (q.chg >= 0 ? '+' : '') + fx(q.chg, 2) + '%</span>', 'sys');
  }).catch(function (e) {
    log('✗ 实时快照失败：' + e.message, 'err');
  });
}
function stopLive() {
  LIVE.on = false; clearInterval(LIVE.timer);
  $('btnLive').classList.remove('live'); $('btnLive').textContent = '⟳ 实时';
}
$('btnLive').onclick = function () {
  if (!D) { log('无行情数据，请先点「获取数据」', 'err'); return; }
  if (D.otc) {
    log('✗ 场外基金没有盘中行情：它每天只有一个单位净值，且 T+1 才公布。点「获取数据」可拉取最新净值', 'err');
    return;
  }
  if (!D.real) { log('✗ 当前是本地模拟行情，无实时数据。请先「获取数据」拉取真实行情', 'err'); return; }
  if (LIVE.on) { stopLive(); log('⟳ 已关闭实时同步', 'sys'); return; }
  LIVE.on = true; LIVE.secid = D.sym;
  $('btnLive').classList.add('live');
  log('⟳ 实时同步已开启：每 15 秒拉取一次东方财富快照（非逐笔，交易时段外不刷新）', 'sys');
  var usNow = isUS(D);
  if (!inTradingHours(usNow)) log('　 当前非' + (usNow ? '美股' : 'A 股') + '交易时段，显示的是最近一个交易日的收盘快照', 'sys');
  if (usNow) log('　 美股行情为东方财富转发，通常延迟约 15 分钟；北京时间开盘约 21:30（冬令时 22:30）', 'sys');
  pollQuote(true);
  LIVE.timer = setInterval(pollQuote, 15000);
};

/* 空闲时的数据滚动流 */
var idleTicker = 0, idleIdx = 0;
function startIdle() {
  clearInterval(idleTicker);
  if (!D) return;
  idleIdx = Math.max(60, D.c.length - 40);
  idleTicker = setInterval(function () {
    if (!D || play.on) return;
    idleIdx++; if (idleIdx > D.c.length - 1) idleIdx = Math.max(60, D.c.length - 120);
    logBar(D.name, { d: D.t[idleIdx], o: D.o[idleIdx], h: D.h[idleIdx], l: D.l[idleIdx], c: D.c[idleIdx], v: D.v[idleIdx] }, D.c[idleIdx - 1]);
  }, 900);
}

/* ============================================================
   7. 信号面板
   ============================================================ */
var lastBT = null;
function paintSignals() {
  var c = cfgFromForm();
  // 用当前演练位置的行情实测胜率与赔率，回填输入框（用户手动改过则不覆盖）
  var m = (D && X) ? measureWinOdds(play.idx, c.sl, c.tp) : null;
  if (m) {
    if (!manualWin) $('fWin').value = fx(m.win * 100, 0);
    if (!manualOdds) $('fOdds').value = fx(m.odds, 2);
    if (!manualWin || !manualOdds) c = cfgFromForm();
    // 期望收益必须与赔率、凯利同口径：都用实测的平均盈利/平均亏损，
    // 否则会出现「期望收益为正但凯利为负」这种自相矛盾的显示
    c.ev = (c.win * m.avgWin - (1 - c.win) * m.avgLoss) * 100;
  }
  roll('sWin', c.win * 100, 1, '%');   bar('bWin', c.win * 100);
  roll('sOdds', c.odds, 2, '倍');      bar('bOdds', clamp(c.odds / 5 * 100, 0, 100));
  roll('sPos', c.pos * 100, 1, '%');   bar('bPos', c.pos / 0.8 * 100);
  roll('sEv', c.ev, 2, '%');           bar('bEv', clamp((c.ev + 5) / 20 * 100, 0, 100));
  $('sEvNote').textContent = m
    ? '实测 平均盈利 ' + fx(m.avgWin * 100, 2) + '% / 平均亏损 ' + fx(m.avgLoss * 100, 2) + '% · 凯利 f* = ' + fx(c.kelly * 100, 1) + '%'
    : '凯利公式 f* = ' + fx(c.kelly * 100, 1) + '% · 建议取一半';
  $('sEv').style.color = c.ev >= 0 ? 'var(--up)' : 'var(--down)';
  $('sPosSrc').textContent = c.kelly <= 0
    ? '凯利为负 · 该参数下无正期望，不建议下注'
    : '半凯利 · 上限 80%';
  $('sWinSrc').textContent = manualWin ? '手动输入'
    : m ? ('近' + m.n + '次机会：' + m.nw + ' 胜 / ' + m.nl + ' 负')
    : (D ? '样本不足，暂沿用上次数值' : '来自参数输入');
  $('sOddsSrc').textContent = manualOdds ? '手动输入'
    : m ? '实测 平均盈利 ÷ 平均亏损'
    : (D ? '样本不足，暂沿用上次数值' : '盈亏比 = 目标 ÷ 止损');

  if (!D || !X) return;
  var i = play.idx, vol = X.vol60[i];
  if (!isFinite(vol)) vol = 20;
  roll('sVol', vol, 2, '%'); bar('bVol', clamp(vol / 60 * 100, 0, 100));

  var risk = clamp(vol / 55 * 100, 3, 100);
  roll('sRisk', risk, 0, '/100'); bar('bRisk', risk, risk > 66 ? 'var(--up)' : risk > 38 ? 'var(--gold)' : 'var(--down)');
  $('sRiskLv').textContent = risk > 66 ? '高波动 · 建议减半仓位' : risk > 38 ? '中等波动' : '低波动 · 环境平稳';

  var m20 = X.ma20[i], m20p = X.ma20[Math.max(0, i - 5)], m60 = X.ma60[i], cp = D.c[i];
  var slope = (isFinite(m20) && isFinite(m20p) && m20p) ? (m20 / m20p - 1) * 100 : 0;
  var above = isFinite(m20) ? (cp / m20 - 1) * 100 : 0;
  var regime = 'flat', rtxt = '◇ 震荡观望', rshort = '震荡';
  if (slope > 0.35 && above > 0) { regime = 'long'; rtxt = '▲ 多头趋势'; rshort = '多头'; }
  else if (slope < -0.35 && above < 0) { regime = 'short'; rtxt = '▼ 空头趋势'; rshort = '空头'; }
  var rg = $('regime'); rg.className = regime; rg.textContent = rtxt;
  $('sigRegime').textContent = rshort;
  $('sigRegime').className = 'chip ' + (regime === 'long' ? 'r' : regime === 'short' ? 'gr' : 'g');

  var volR = isFinite(X.vma20[i]) && X.vma20[i] ? D.v[i] / X.vma20[i] : 1;
  $('sTrend').innerHTML = '<span class="' + (regime === 'long' ? 'u' : regime === 'short' ? 'd' : 'gd') + '">' + rtxt + '</span>';
  $('sTrendSub').textContent = '20日均线斜率 ' + (slope >= 0 ? '+' : '') + fx(slope, 2) + '% · 价格偏离 ' +
    (above >= 0 ? '+' : '') + fx(above, 2) + '% · 量比 ' + fx(volR, 2) + ' · ' +
    (isFinite(m60) ? (cp > m60 ? '站上60日均线' : '处于60日均线下方') : '—');

  var trendS = clamp(50 + slope * 22 + above * 2.2, 0, 100);
  var evS = clamp((c.ev + 4) / 16 * 100, 0, 100);
  var volS = 100 - risk;
  var winS = c.win * 100;
  var btS = lastBT ? clamp(50 + lastBT.ret / 4 - lastBT.mdd / 2, 0, 100) : 50;
  var score = 0.28 * trendS + 0.24 * evS + 0.18 * volS + 0.15 * winS + 0.15 * btS;
  roll('sScore', score, 0, '/100');
  bar('bScore', score, score > 66 ? 'var(--up)' : score > 40 ? 'var(--gold)' : 'var(--down)');

  var cur = D.c[i], prv = D.c[Math.max(0, i - 1)], chg = prv ? (cur / prv - 1) * 100 : 0;
  var shown = (D.rc && D.rc[i]) ? D.rc[i] : cur;      // 顶栏显示真实市价，图表按复权价绘制
  $('tickerName').textContent = D.name;
  $('tickerName').title = D.name;
  $('tickerPx').textContent = px(shown);
  $('tickerPx').className = 'num ' + (chg >= 0 ? 'u' : 'd');
  $('tickerChg').textContent = (chg >= 0 ? '+' : '') + fx(chg) + '%';
  $('tickerChg').className = 'num ' + (chg >= 0 ? 'u' : 'd');
}

/* ============================================================
   8. 策略卡片
   ============================================================ */
var CARDS = [];
function styleChip(s) {
  var m = { '趋势跟踪': 'c', '突破': 'g', '均值回归': 'gr', '动量': 'c', '量价': 'g', '波段': 'c', '逆势': 'gr', '反转': 'gr' };
  return '<span class="chip ' + (m[s] || '') + '">' + s + '</span>';
}
function buildCard(tpl, dir, cfg) {
  var st = { n: tpl.n, s: tpl.s, b: tpl.b, x: tpl.x, e: tpl.e, q: tpl.q, dir: dir,
             _fn: tpl._fn, _fi: tpl._fi, _low: tpl._low, _win: tpl._win, _hold: tpl._hold, _edge: tpl._edge };
  return { st: st, r: backtest(st, D, X, cfg), cfg: cfg };
}
/* 策略列表。
   实测参数表单占掉面板 338px 里的 235px，只剩 77px 给列表，而单张卡片就有 92px ——
   一屏连一张都放不下。所以这里做三件事：
     · 紧凑行视图（约 26px/条），10 个策略一屏看完，完整条件文字进 title 与报告
     · 排序：收益 / 胜率 / 回撤 / 盈亏比 / 笔数
     · 筛选：做多 / 做空 / 隐藏 0 交易 / 只看正收益
   排序筛选后仍要能打开正确的报告，所以整个流程都带着 CARDS 里的原始下标走。 */
var formAutoFolded = false;
var SVIEW = (function () { try { return localStorage.getItem('qe_sview') || 'row'; } catch (e) { return 'row'; } })();
var SSORT = 'def', SFILT = 'all';

function cardView() {
  var v = CARDS.map(function (c, i) { return { c: c, i: i }; });
  v = v.filter(function (x) {
    var c = x.c;
    if (SFILT === 'long') return c.st.dir === 1;
    if (SFILT === 'short') return c.st.dir === -1;
    if (SFILT === 'traded') return c.r.nt > 0;
    if (SFILT === 'pos') return c.r.ret > 0;
    return true;
  });
  var key = {
    ret: function (c) { return -c.r.ret; },
    win: function (c) { return -c.r.win; },
    mdd: function (c) { return c.r.mdd; },
    pl: function (c) { return -c.r.pl; },
    nt: function (c) { return -c.r.nt; }
  }[SSORT];
  if (key) v.sort(function (p, q) {
    var d = key(p.c) - key(q.c);
    return isFinite(d) && d !== 0 ? d : p.i - q.i;    // 并列时保持生成顺序，结果可复现
  });
  return v;
}
function renderCards() {
  var box = $('stratList');
  box.innerHTML = '';
  $('hint').style.display = CARDS.length ? 'none' : '';
  $('stratCount').textContent = CARDS.length + ' 个策略';
  $('stratTools').style.display = CARDS.length ? 'flex' : 'none';
  $('btnView').textContent = SVIEW === 'row' ? '▤ 紧凑' : '▥ 卡片';
  var v = cardView();
  $('stratShown').textContent = v.length === CARDS.length
    ? '共 ' + CARDS.length + ' 个' : '显示 ' + v.length + ' / 共 ' + CARDS.length;
  if (CARDS.length && !v.length) {
    box.innerHTML = '<div style="padding:18px;text-align:center;color:#3a4a5a;font-size:11px">' +
      '当前筛选条件下没有策略。把「筛选」改回“全部”即可。</div>';
    return;
  }

  if (SVIEW === 'row') {
    var hd = document.createElement('div');
    hd.id = 'stratHd';
    hd.innerHTML = '<span class="nm">策略</span><span class="m" style="width:56px">收益</span>' +
      '<span class="m" style="width:44px">胜率</span><span class="m" style="width:52px">回撤</span>' +
      '<span class="m" style="width:30px">笔</span>';
    box.appendChild(hd);
  }
  v.forEach(function (x) {
    var c = x.c, idx = x.i, long = c.st.dir === 1;
    var d = document.createElement('div');
    if (SVIEW === 'row') {
      d.className = 'srow ' + (long ? 'long' : 'short');
      d.title = (long ? '买入：' : '开空：') + c.st.b + '\n' + (long ? '卖出：' : '平仓：') + c.st.x +
        '\n止损 ' + fx(c.cfg.sl, 1) + '% / 目标 ' + fx(c.cfg.tp, 1) + '%　仓位 ' + fx(c.cfg.pos * 100, 1) + '%' +
        (c.r.zeroPos ? '（凯利≤0，收益按满仓口径）' : '') + '\n点击查看完整回测绩效报告';
      d.innerHTML =
        '<span class="dir ' + (long ? 'r' : 'gr') + '">' + (long ? '多' : '空') + '</span>' +
        '<span class="nm">' + c.st.n + '</span>' +
        '<span class="m ret ' + (c.r.ret >= 0 ? 'u' : 'd') + '">' + (c.r.ret >= 0 ? '+' : '') + fx(c.r.ret, 1) + '%</span>' +
        '<span class="m win">' + fx(c.r.win, 0) + '%</span>' +
        '<span class="m mdd">-' + fx(c.r.mdd, 1) + '%</span>' +
        '<span class="m nt">' + c.r.nt + '</span>';
    } else {
      d.className = 'card ' + (long ? 'long' : 'short');
      d.innerHTML =
        '<div class="h"><span class="nm">' + c.st.n + '</span>' + styleChip(c.st.s) +
        '<span class="chip ' + (long ? 'r' : 'gr') + '">' + (long ? '做多' : '做空') + '</span>' +
        '<span class="chip">止损 ' + fx(c.cfg.sl, 1) + '% / 目标 ' + fx(c.cfg.tp, 1) + '%</span></div>' +
        '<div class="cond"><b>' + (long ? '买入' : '开空') + '</b><span>' + c.st.b + '</span>' +
        '<b>' + (long ? '卖出' : '平仓') + '</b><span>' + c.st.x + '，或触及止损 ' + fx(c.cfg.sl, 1) + '% / 目标 ' + fx(c.cfg.tp, 1) + '%</span></div>' +
        '<div class="ft"><span>仓位建议 <em>' + fx(c.cfg.pos * 100, 1) + '%</em></span>' +
        '<span>' + (c.r.zeroPos ? '回测(满仓)' : '回测') + ' <span class="n ' + (c.r.ret >= 0 ? 'u' : 'd') + '">' +
          (c.r.ret >= 0 ? '+' : '') + fx(c.r.ret, 1) + '%</span></span>' +
        '<span>胜率 <span class="n">' + fx(c.r.win, 1) + '%</span></span>' +
        '<span>回撤 <span class="n d">-' + fx(c.r.mdd, 1) + '%</span></span>' +
        (c.r.skipped ? '<span class="d">跳过 ' + c.r.skipped + ' 次(买不起1手)</span>' : '') +
        '<span><span class="n">' + c.r.nt + '</span> 笔</span>' +
        '<span class="go">查看回测绩效报告 →</span></div>';
    }
    d.onclick = function () { openReport(idx); };
    box.appendChild(d);
  });
}
/* 参数区折叠：取完数据后这几行很少再动，收起来能把列表可视高从 77px 放大到约 300px */
function setForm(fold) {
  $('stratForm').classList.toggle('fold', fold);
  $('btnForm').textContent = fold ? '⌄ 参数' : '⌃ 参数';
  $('btnForm').title = fold ? '展开参数区' : '收起参数区，把高度让给策略列表';
}
$('btnForm').onclick = function () { setForm(!$('stratForm').classList.contains('fold')); };
$('btnView').onclick = function () {
  SVIEW = SVIEW === 'row' ? 'card' : 'row';
  try { localStorage.setItem('qe_sview', SVIEW); } catch (e) { /* 隐私模式忽略 */ }
  renderCards();
};
$('fSort').onchange = function () { SSORT = this.value; renderCards(); };
$('fFilter').onchange = function () { SFILT = this.value; renderCards(); };
function addStrategies(list, dir, label) {
  if (!D) { log('请先点「⛁ 获取数据」载入行情', 'err'); return; }
  if (D.otc) {
    var drop = list.filter(function (t) { return t.nb; });
    list = list.filter(function (t) { return !t.nb; });
    if (drop.length) log('· 场外基金只有单位净值（无开高低、无成交量），已跳过依赖阴阳线/量能的 ' +
      drop.length + ' 个策略：' + drop.map(function (t) { return t.n; }).join('、'), 'sys');
    if (!list.length) { log('✗ 该类策略全部依赖 K 线形态，场外基金无法回测，请改用场内标的', 'err'); return; }
  }
  if (!list.length) { log('该类策略已全部生成，未新增', 'sys'); return; }
  var cfg = cfgFromForm();
  if (cfg.pos <= 0) log('⚠ 凯利公式结果为负（胜率×赔率不足以覆盖亏损），仓位建议 0%，仅作演示', 'err');
  lbStart();
  setTimeout(function () {
    var added = 0;
    list.forEach(function (t) {
      if (CARDS.some(function (c) { return c.st.n === t.n && c.st.dir === dir; })) return;
      var c = buildCard(t, dir, cfg);
      CARDS.push(c); added++;
      log('✦ ' + label + '「' + c.st.n + '」回测 ' + (c.r.ret >= 0 ? '+' : '') + fx(c.r.ret, 1) +
          '% · 胜率 ' + fx(c.r.win, 1) + '% · ' + c.r.nt + ' 笔', c.r.ret >= 0 ? 'ok' : 'err');
    });
    if (CARDS.length) lastBT = CARDS[CARDS.length - 1].r;
    renderCards(); paintSignals(); lbDone();
    // 列表挤到放不下两条时自动收起参数区（只做一次，之后尊重用户的手动选择）
    var host = $('stratList').parentElement;
    if (!formAutoFolded && CARDS.length > 2 && host.clientHeight < 80 && !$('stratForm').classList.contains('fold')) {
      formAutoFolded = true; setForm(true);
      log('· 参数区已自动收起给策略列表腾地方，点右上「⌄ 参数」可展开', 'sys');
    }
    if (!added) log('该类策略已全部生成，未新增', 'sys');
  }, 220);
}
function pickN(arr, n) {
  var a = usable(arr), out = [];
  while (a.length && out.length < n) out.push(a.splice(Math.floor(Math.random() * a.length), 1)[0]);
  return out;
}
/* 场外基金只有净值，先剔掉依赖阴阳线/量能的模板再抽样，避免抽完才被过滤掉 */
var otcNoteShown = false;
function usable(arr) {
  if (!(D && D.otc)) return arr.slice();
  var drop = arr.filter(function (t) { return t.nb; });
  if (drop.length && !otcNoteShown) {
    otcNoteShown = true;
    log('· 场外基金只有单位净值（无开高低、无成交量），依赖阴阳线/量能的 ' + drop.length +
        ' 个策略不参与：' + drop.map(function (t) { return t.n; }).join('、'), 'sys');
  }
  return arr.filter(function (t) { return !t.nb; });
}
$('btnAI').onclick = function () {
  if (!D) { log('请先点「⛁ 获取数据」载入行情', 'err'); return; }
  var i = play.idx, m20 = X.ma20[i], m20p = X.ma20[Math.max(0, i - 5)];
  var slope = (isFinite(m20) && isFinite(m20p) && m20p) ? (m20 / m20p - 1) * 100 : 0;
  var trendy = Math.abs(slope) > 0.35;
  var pool = trendy
    ? LONG.filter(function (t) { return ['趋势跟踪', '突破', '动量', '波段'].indexOf(t.s) >= 0; })
    : LONG.filter(function (t) { return ['均值回归', '逆势', '量价'].indexOf(t.s) >= 0; });
  log('✦ 按市况匹配：市况 = ' + (trendy ? (slope > 0 ? '上升趋势' : '下降趋势') : '区间震荡') +
      '（20日均线斜率 ' + fx(slope, 2) + '%），从对应风格池（' + pool.length + ' 项）随机抽一个。' +
      '这是规则匹配，不产生新策略', 'sys');
  addStrategies(pickN(pool.length ? pool : LONG, 1), 1, '按市况匹配');
};
$('btnTen').onclick = function () { addStrategies(pickN(LONG, 10), 1, '批量生成'); };
$('btnShort').onclick = function () { addStrategies(pickN(SHORT, SHORT.length), -1, '反向做空'); };
$('btnRev').onclick = function () {
  log('⟲ 反转组：把 7 个追涨模板的进场条件精确取反（仍做多），检验因子 IC 显示的反转特征能否变成收益', 'sys');
  addStrategies(pickN(REVERSAL, REVERSAL.length), 1, '反转组');
};
$('btnClear').onclick = function () { CARDS = []; lastBT = null; renderCards(); paintSignals(); log('策略列表已清空', 'sys'); };

/* ============================================================
   9. 回测绩效报告
   ============================================================ */
var eqChart = null;
var curReport = -1;
function openReport(idx) {
  var c = CARDS[idx], r = c.r;
  curReport = idx;
  $('mTitle').textContent = '回测绩效报告 · ' + c.st.n;
  $('mSub').textContent = D.name + ' ｜ ' + D.t[65] + ' → ' + D.t[D.t.length - 1] + ' ｜ ' +
    (c.st.dir === 1 ? '做多' : '做空') + ' ｜ 仓位 ' + fx(c.r.sz * 100, 1) + '% ｜ ' +
    (D.otc ? '申购费 ' + fx(c.cfg.buyFee, 2) + '% + 分档赎回费'
           : '佣金 ' + fx(c.cfg.fee, 1) + '‱(最低' + MKT.minComm + MKT.unit + ') + 滑点 ' + fx(c.cfg.slip, 1) + '‱' +
             (MKT.stamp ? ' + 印花税 5‱(卖出)' : ' ｜ 美股无印花税')) +
    (D.otc ? '' : ' ｜ ' + (MKT.lot > 1 ? '100股整手' : '1股起买')) +
    ' ｜ 止损 ' + (c.cfg.stopMode === 'atr' ? 'ATR×' + fx(c.cfg.atrMul, 1) : fx(c.cfg.sl, 1) + '%') +
    (c.cfg.trailOn > 0 ? ' ｜ 跟踪止盈 盈' + fx(c.cfg.trailOn, 1) + '%启动/回撤' + fx(c.cfg.trailBack, 1) + '%' : '');

  var holding = r.trades.length && r.trades[r.trades.length - 1].why === '持仓中' ? 1 : 0;
  var K = [
    ['累计收益', (r.ret >= 0 ? '+' : '') + fx(r.ret, 2) + '%',
      (r.zeroPos ? '⚠ 凯利≤0，此为满仓口径' : '年化 ' + (r.ann >= 0 ? '+' : '') + fx(r.ann, 2) + '%') +
      ' · ' + Math.round(r.cap0 / 1e4) + '万 → ' + fx(r.capEnd / 1e4, 2) + '万', r.ret >= 0 ? 'u' : 'd'],
    ['胜率', fx(r.win, 2) + '%', r.nw + ' 胜 / ' + r.nl + ' 负', r.win >= 50 ? 'u' : 'd'],
    ['盈亏比', fx(r.pl, 2), '平均盈利 ÷ 平均亏损', r.pl >= 1 ? 'u' : 'd'],
    ['最大回撤', '-' + fx(r.mdd, 2) + '%', '权益峰值到谷底', 'd'],
    ['累计费用', fx(r.feeSum, 0) + ' ' + MKT.unit,
      r.nt ? '占初始资金 ' + fx(r.feeSum / r.cap0 * 100, 2) + '% · 均 ' + fx(r.feeSum / r.nt, 0) + ' ' + MKT.unit + '/笔' : '—', 'gd']
  ];
  $('kpis').innerHTML = K.map(function (k) {
    return '<div class="kpi"><div class="k">' + k[0] + '</div><div class="v ' + k[3] + '">' + k[1] + '</div><div class="s">' + k[2] + '</div></div>';
  }).join('');

  var rows = r.trades.map(function (t) {
    return '<tr><td>' + t.no + '</td><td><span class="chip ' + (t.dir === 1 ? 'r' : 'gr') + '">' + (t.dir === 1 ? '多' : '空') + '</span></td>' +
      '<td>' + t.di + '</td><td>' + px(t.dp) + '</td><td>' + t.xi + '</td><td>' + px(t.xp) + '</td>' +
      '<td>' + (t.sh >= 1000 || t.sh === Math.round(t.sh) ? Math.round(t.sh) : fx(t.sh, t.sh < 100 ? 1 : 0)) + '</td>' +
      '<td>' + t.hold + '</td><td class="dm">' + fx(t.fee || 0, 0) + '</td>' +
      '<td class="' + (t.rt >= 0 ? 'u' : 'd') + '">' + (t.rt >= 0 ? '+' : '') + fx(t.rt * 100, 2) + '%</td>' +
      '<td class="dm">' + t.why + '</td><td>' + fx(t.cap, 0) + '</td></tr>';
  }).join('');
  $('tradeTbl').innerHTML =
    '<thead><tr><th>序号</th><th>方向</th><th>开仓日</th><th>开仓价</th><th>平仓日</th><th>平仓价</th>' +
    '<th>股数</th><th>持仓(交易日)</th><th>费用(' + MKT.unit + ')</th><th>单笔收益</th><th>退出原因</th><th>权益(' + MKT.unit + ')</th></tr></thead><tbody>' +
    (rows || '<tr><td colspan="12" style="text-align:center;padding:22px;color:#3a4a5a">该策略在此标的的样本期内未触发任何交易信号</td></tr>') +
    '</tbody>';

  // 成交可行性提示：涨跌停挡单、单笔占成交额过高
  var exec = [];
  if (r.limitSkip) exec.push('<b>' + r.limitSkip + '</b> 次信号因<b>一字涨停买不进</b>被跳过');
  if (r.blocked) exec.push('<b>' + r.blocked + '</b> 次离场因<b>跌停卖不出</b>顺延到下一根');
  if (r.impact) exec.push('<b>' + r.impact + '</b> 笔的下单金额<b>超过当日成交额 1%</b>，真实滑点会明显高于设定值');
  if (r.skipped) exec.push('<b>' + r.skipped + '</b> 次因资金不足一手被跳过');
  $('mExec').innerHTML = exec.length
    ? '⛒ 成交可行性：' + exec.join('；') + '。' +
      (r.limitPct ? '<span class="dm">（该标的涨跌停幅度按 ±' + fx(r.limitPct * 100, 0) + '% 建模）</span>' : '')
    : '';
  $('mExec').style.display = exec.length ? '' : 'none';

  var warn = $('mWarn');
  if (!D.tradable) {
    warn.innerHTML = '⚠ <b>' + esc(D.name) + '</b> 是' + (D.cat || '指数') +
      '，属于计算出来的数值，<b>没有任何渠道可以直接买卖</b>。下面这条净值曲线对应的交易在现实中并不存在，' +
      '它只能用来观察该' + (D.cat === '板块' ? '板块' : '指数') + '的走势特征。要实际操作请改选跟踪它的 ETF。';
    warn.style.display = '';
  } else if (D.otc) {
    warn.innerHTML = '· 场外基金按<b>次日单位净值</b>成交；赎回费已按持有天数分档计入' +
      '（&lt;7天 1.5%｜7-30天 0.75%｜30天-1年 0.5%｜1年以上 0.25%），申购费按上方输入。';
    warn.style.display = '';
  } else warn.style.display = 'none';

  renderRisk(c);
  renderRandomBench(c);
  renderSplitTest(c);
  renderSensitivity(c);
  // 跨标的扫描按需触发（要联网），每次换策略先复位
  scanCard = c;
  $('scanResult').style.display = 'none';
  $('scanStatus').textContent = '尚未扫描。将把「' + c.st.n + '」跑到「' + CAT + '」的 ' +
    scanBasket().length + ' 个常用标的上，需联网，约 10–30 秒。';

  $('mask').classList.add('on');
  setTimeout(function () {
    if (!eqChart) eqChart = keepSized(echarts.init($('eqChart')), $('eqChart'));
    eqChart.resize();
    var bh = D.c.map(function (v) { return +(v / D.c[65]).toFixed(4); });
    eqChart.setOption({
      animation: true, backgroundColor: 'transparent',
      grid: { left: 46, right: 14, top: 22, bottom: 24 },
      legend: { data: ['策略净值', '标的净值'], top: 2, textStyle: { color: '#5d6f82', fontSize: 10 }, itemWidth: 14, itemHeight: 2 },
      tooltip: { trigger: 'axis', backgroundColor: 'rgba(8,13,20,.96)', borderColor: '#22d3ee', textStyle: { color: '#c3d1e0', fontSize: 11 } },
      xAxis: { type: 'category', data: D.t, axisLine: { lineStyle: { color: '#1f2d3d' } }, axisLabel: { color: '#5d6f82', fontSize: 9 } },
      yAxis: { scale: true, axisLine: { show: false }, axisLabel: { color: '#5d6f82', fontSize: 9 }, splitLine: { lineStyle: { color: '#0f1720' } } },
      series: [
        { name: '策略净值', type: 'line', data: r.eq.map(function (v) { return +(v / r.cap0).toFixed(4); }), symbol: 'none', lineStyle: { color: '#f5c542', width: 1.6 }, areaStyle: { color: 'rgba(245,197,66,.10)' } },
        { name: '标的净值', type: 'line', data: bh, symbol: 'none', lineStyle: { color: '#22d3ee', width: 1, type: 'dashed' } }
      ]
    });
  }, 40);
  log('▤ 打开回测报告「' + c.st.n + '」累计 ' + fx(r.ret, 2) + '% · 回撤 -' + fx(r.mdd, 2) + '%', 'sys');
}
/* 买入持有的同口径风险指标 */
function bhStats(a, b) {
  var i, base = D.c[a], peak = 1, mdd = 0, rets = [];
  for (i = a; i <= b; i++) {
    var e = D.c[i] / base;
    if (e > peak) peak = e;
    var dd = (peak - e) / peak; if (dd > mdd) mdd = dd;
    if (i > a && D.c[i - 1] > 0) rets.push(D.c[i] / D.c[i - 1] - 1);
  }
  var yrs = Math.max(b - a, 1) / 243;
  var ann = (Math.pow(D.c[b] / base, 1 / yrs) - 1) * 100;
  var mu = 0, q = 0;
  for (i = 0; i < rets.length; i++) mu += rets[i]; mu /= rets.length || 1;
  for (i = 0; i < rets.length; i++) q += (rets[i] - mu) * (rets[i] - mu);
  var vol = rets.length > 20 ? Math.sqrt(q / (rets.length - 1)) * Math.sqrt(243) * 100 : 0;
  return { ann: ann, mdd: mdd * 100, vol: vol,
           sharpe: vol > 0 ? ann / vol : 0, calmar: mdd > 0 ? ann / (mdd * 100) : 0 };
}
/* 风险调整口径：策略 vs 买入持有 */
function renderRisk(c) {
  var n = D.c.length, r = c.r, bh = bhStats(65, n - 1), v = $('riskVerdict');
  var num = function (x2, dec, suf, good) {
    return '<span class="' + (good === undefined ? '' : (good ? 'u' : 'd')) + '">' +
      (x2 >= 0 && suf === '%' ? '+' : '') + fx(x2, dec) + (suf || '') + '</span>';
  };
  // 把策略仓位放大到与买入持有同等回撤后的等效年化（线性近似）
  var lever = r.mdd > 0.01 ? bh.mdd / r.mdd : NaN;
  var equiv = isFinite(lever) ? r.ann * lever : NaN;

  $('riskTbl').innerHTML =
    '<thead><tr><th>指标</th><th>本策略</th><th>买入并持有</th><th>谁更优</th></tr></thead><tbody>' +
    '<tr><td>年化收益</td><td>' + num(r.ann, 2, '%') + '</td><td>' + num(bh.ann, 2, '%') + '</td><td>' +
      (r.ann > bh.ann ? '<span class="u">策略</span>' : '<span class="dm">持有</span>') + '</td></tr>' +
    '<tr><td>最大回撤</td><td><span class="d">-' + fx(r.mdd, 2) + '%</span></td><td><span class="d">-' +
      fx(bh.mdd, 2) + '%</span></td><td>' + (r.mdd < bh.mdd ? '<span class="u">策略</span>' : '<span class="dm">持有</span>') + '</td></tr>' +
    '<tr><td>年化波动</td><td>' + fx(r.vol, 2) + '%</td><td>' + fx(bh.vol, 2) + '%</td><td>' +
      (r.vol < bh.vol ? '<span class="u">策略</span>' : '<span class="dm">持有</span>') + '</td></tr>' +
    '<tr><td>夏普比率</td><td><b>' + fx(r.sharpe, 2) + '</b></td><td><b>' + fx(bh.sharpe, 2) + '</b></td><td>' +
      (r.sharpe > bh.sharpe ? '<span class="u">策略</span>' : '<span class="dm">持有</span>') + '</td></tr>' +
    '<tr><td>卡玛比率（年化÷回撤）</td><td><b>' + fx(r.calmar, 2) + '</b></td><td><b>' + fx(bh.calmar, 2) +
      '</b></td><td>' + (r.calmar > bh.calmar ? '<span class="u">策略</span>' : '<span class="dm">持有</span>') + '</td></tr>' +
    '<tr><td>同等回撤下的等效年化</td><td>' + (isFinite(equiv) ? num(equiv, 2, '%') +
      ' <span class="' + (lever > 2 ? 'd' : 'dm') + '">（需放大仓位 ' + fx(lever, 1) + ' 倍' +
      (lever > 2 ? '，<b>不可实现</b>' : '') + '）</span>' : '<span class="dm">回撤过小，无法换算</span>') +
      '</td><td>' + num(bh.ann, 2, '%') + '</td><td>' +
      (isFinite(equiv) && equiv > bh.ann ? (lever > 2 ? '<span class="dm">理论上策略</span>' : '<span class="u">策略</span>') : '<span class="dm">持有</span>') + '</td></tr>' +
    '</tbody>' +
    (isFinite(lever) && lever > 2
      ? '<tfoot><tr><td colspan="4" style="color:var(--up);font-size:9.5px;line-height:1.7;padding:5px 7px">' +
        '⚠ 「同等回撤下的等效年化」是<b>线性换算</b>，仅用于横向比较风险效率，<b>不是可实现的收益</b>：' +
        'A 股融资融券最多约 1 倍杠杆（放大 2 倍），本行需要 ' + fx(lever, 1) +
        ' 倍；且高杠杆下回撤会非线性放大、冲击成本上升，并存在强平风险。' +
        '真实含义是"这个策略的风险效率相当于……"，而非"照此加杠杆即可获得该收益"。' +
        '</td></tr></tfoot>' : '');

  var winSharpe = r.sharpe > bh.sharpe, winCalmar = r.calmar > bh.calmar, winEquiv = isFinite(equiv) && equiv > bh.ann;
  if (r.nt < 5) {
    v.className = 'weak';
    v.innerHTML = '交易次数太少（' + r.nt + ' 笔），风险指标不可靠。';
  } else if (winSharpe && winCalmar) {
    v.className = 'good';
    v.innerHTML = '✔ <b>风险调整后优于买入持有</b>：夏普 ' + fx(r.sharpe, 2) + ' vs ' + fx(bh.sharpe, 2) +
      '，卡玛 ' + fx(r.calmar, 2) + ' vs ' + fx(bh.calmar, 2) + '。' +
      '<br><b>这不等于它更赚钱</b>：年化 ' + fx(r.ann, 2) + '% 仍低于持有的 ' + fx(bh.ann, 2) +
      '%，优势来自回撤只有 ' + fx(r.mdd, 2) + '%（持有 ' + fx(bh.mdd, 2) + '%）。' +
      '<br><span class="dm">实际含义：拿着它心里踏实，但账户涨得慢。' +
      (isFinite(lever) && lever > 2 ? '想把这份"稳"换成收益需要 ' + fx(lever, 1) + ' 倍杠杆，A 股做不到。' : '') +
      '要不要选它，取决于你更怕回撤还是更怕踏空。</span>';
  } else if (winSharpe || winCalmar || r.mdd < bh.mdd) {
    v.className = 'weak';
    v.innerHTML = '～ <b>部分风险指标占优</b>' +
      (r.mdd < bh.mdd ? '：回撤 ' + fx(r.mdd, 2) + '% 明显小于持有的 ' + fx(bh.mdd, 2) + '%' : '') +
      '，但' + (winSharpe ? '' : '夏普') + (winSharpe || winCalmar ? '' : '与') + (winCalmar ? '' : '卡玛') +
      '未能全面胜出。<br><span class="dm">这类结果的实际含义是：它更适合"拿得住"，而不是"赚得多"。' +
      '要不要用它，取决于你更怕回撤还是更怕踏空。</span>';
  } else {
    v.className = 'noise';
    v.innerHTML = '✖ <b>风险调整后依然不如买入持有</b>：夏普 ' + fx(r.sharpe, 2) + ' vs ' + fx(bh.sharpe, 2) +
      '，卡玛 ' + fx(r.calmar, 2) + ' vs ' + fx(bh.calmar, 2) + '。' +
      '既没赚得多，也没有在承担更小风险的前提下做得更好。';
  }
  log('▤ 风险调整：夏普 ' + fx(r.sharpe, 2) + ' vs 持有 ' + fx(bh.sharpe, 2) +
      '｜卡玛 ' + fx(r.calmar, 2) + ' vs ' + fx(bh.calmar, 2) +
      '｜回撤 ' + fx(r.mdd, 2) + '% vs ' + fx(bh.mdd, 2) + '%',
      (winSharpe && winCalmar) ? 'ok' : (winSharpe || winCalmar) ? 'sys' : 'err');
}

/* 随机基准：直方图 + 判定 */
var rndChart = null;
function renderRandomBench(c) {
  var box = $('rndBox');
  box.style.display = '';
  // 先清空，避免上一份报告的数字残留
  ['rnReal', 'rnMed', 'rnBeat', 'rnPct'].forEach(function (id) { $(id).textContent = '—'; $(id).className = ''; });
  $('rndChart').style.display = '';

  var bm = randomBenchmark(c.st, D, X, c.cfg, c.r.nt);
  if (!bm) {
    $('rndChart').style.display = 'none';
    var v0 = $('rnVerdict');
    v0.className = 'weak';
    v0.innerHTML = c.r.nt < 5
      ? '样本不足：该策略在此标的上只触发了 <b>' + c.r.nt + '</b> 笔交易，' +
        '这么少的样本和随机进场比较没有统计意义。<br>可以换个交易更频繁的策略，或放宽止损/目标让持仓期更短。'
      : '数据长度不足 145 根，无法构建随机分布。请换一个上市较久的标的。';
    log('▤ 随机基准：仅 ' + c.r.nt + ' 笔交易，样本不足，跳过对照', 'sys');
    return;
  }
  var real = c.r.ret, p = pctRank(bm.rets, real);
  var beat = bm.rets.filter(function (v) { return v >= real; }).length;

  $('rnReal').textContent = (real >= 0 ? '+' : '') + fx(real, 2) + '%';
  $('rnReal').className = real >= 0 ? 'u' : 'd';
  $('rnMed').textContent = (bm.median >= 0 ? '+' : '') + fx(bm.median, 2) + '%';
  $('rnBeat').textContent = beat + ' / ' + bm.rets.length + ' 组';
  $('rnPct').textContent = fx(p, 1) + ' %';
  $('rnPct').className = p >= 95 ? 'u' : p >= 80 ? 'gd' : 'd';

  var v = $('rnVerdict');
  if (p >= 95) {
    v.className = 'good';
    v.innerHTML = '✔ 落在随机分布前 ' + fx(100 - p, 1) + '%，<b>信号带来的超额难以用运气解释</b>。' +
      '但这仍是样本内结果，仍需样本外验证。';
  } else if (p >= 80) {
    v.className = 'weak';
    v.innerHTML = '～ 强于多数随机进场，但未达 95% 门槛，<b>证据偏弱</b>：换个标的或时间段很可能就不成立。';
  } else {
    v.className = 'noise';
    v.innerHTML = '✖ <b>与随机进场没有区别</b>。这条净值曲线的形状来自止损止盈规则和标的本身的走势，' +
      '不是进场信号的功劳。';
  }

  // 直方图
  var lo = bm.rets[0], hi = bm.rets[bm.rets.length - 1];
  lo = Math.min(lo, real); hi = Math.max(hi, real);
  var BIN = 26, w = (hi - lo) / BIN || 1, bins = new Array(BIN).fill(0), i;
  for (i = 0; i < bm.rets.length; i++) {
    var k = Math.min(BIN - 1, Math.floor((bm.rets[i] - lo) / w));
    bins[k]++;
  }
  var cats = [], realBin = Math.min(BIN - 1, Math.floor((real - lo) / w));
  for (i = 0; i < BIN; i++) cats.push(fx(lo + w * (i + 0.5), 1));
  setTimeout(function () {
    if (!rndChart) rndChart = keepSized(echarts.init($('rndChart')), $('rndChart'));
    rndChart.resize();
    rndChart.setOption({
      animation: false, backgroundColor: 'transparent',
      grid: { left: 30, right: 10, top: 16, bottom: 22 },
      tooltip: { trigger: 'axis', backgroundColor: 'rgba(8,13,20,.96)', borderColor: '#22d3ee',
        textStyle: { color: '#c3d1e0', fontSize: 11 },
        formatter: function (ps) { return '收益率 ' + ps[0].axisValue + '% 附近<br>随机组数 ' + ps[0].data; } },
      xAxis: { type: 'category', data: cats, axisLine: { lineStyle: { color: '#1f2d3d' } },
        axisLabel: { color: '#5d6f82', fontSize: 9, interval: 5 }, axisTick: { show: false } },
      yAxis: { type: 'value', axisLine: { show: false }, axisLabel: { color: '#5d6f82', fontSize: 9 },
        splitLine: { lineStyle: { color: '#0f1720' } } },
      series: [{
        type: 'bar', data: bins, barCategoryGap: '12%',
        itemStyle: {
          color: function (o) { return o.dataIndex === realBin ? '#f5c542' : 'rgba(34,211,238,.45)'; }
        },
        markLine: {
          silent: true, symbol: 'none',
          data: [{ xAxis: realBin }],
          label: { formatter: '本策略', color: '#f5c542', fontSize: 9, position: 'insideEndTop' },
          lineStyle: { color: '#f5c542', width: 1.5, type: 'solid' }
        }
      }]
    });
  }, 60);

  log('▤ 随机基准：' + bm.rets.length + ' 组随机进场（平均 ' + fx(bm.avgTrades, 1) + ' 笔），' +
      '本策略 ' + fx(real, 2) + '% 位于第 ' + fx(p, 1) + ' 百分位，' +
      (p >= 95 ? '显著优于随机' : p >= 80 ? '弱于显著水平' : '与随机无异'),
      p >= 95 ? 'ok' : p >= 80 ? 'sys' : 'err');
}

/* 样本内 / 样本外：前 70% vs 后 30%，两段各自从初始资金重新起算 */
function renderSplitTest(c) {
  var n = D.c.length, split = Math.floor(n * 0.7), v = $('oosVerdict');
  if (n - split < 90 || split < 160) {
    $('oosTbl').innerHTML = '';
    v.className = 'weak';
    v.innerHTML = '数据长度不足，无法切分出有意义的样本外区间（需样本内 ≥160 根、样本外 ≥90 根）。';
    return;
  }
  var IS = backtest(c.st, D, X, c.cfg, { a: 65, b: split });
  var OS = backtest(c.st, D, X, c.cfg, { a: split, b: n - 1 });
  // 同期买入并持有（用复权价，含分红；不计交易费用）——只有跑赢它才叫本事
  function bhAnn(a, b) {
    if (!(D.c[a] > 0)) return 0;
    return (Math.pow(D.c[b] / D.c[a], 243 / Math.max(b - a, 1)) - 1) * 100;
  }
  IS.bh = bhAnn(65, split); OS.bh = bhAnn(split, n - 1);
  IS.alpha = IS.ann - IS.bh; OS.alpha = OS.ann - OS.bh;

  function row(label, f) {
    return '<tr><td>' + label + '</td><td>' + f(IS) + '</td><td>' + f(OS) + '</td></tr>';
  }
  var sign = function (x2, dec) { return '<span class="' + (x2 >= 0 ? 'u' : 'd') + '">' + (x2 >= 0 ? '+' : '') + fx(x2, dec == null ? 2 : dec) + '%</span>'; };
  $('oosTbl').innerHTML =
    '<thead><tr><th>指标</th><th>样本内（前70%）</th><th>样本外（后30%）</th></tr></thead><tbody>' +
    row('区间', function (r) { return '<span class="dm">' + r.from + ' → ' + r.to + '</span>'; }) +
    row('策略年化', function (r) { return sign(r.ann); }) +
    row('买入持有年化', function (r) { return '<span class="dm">' + (r.bh >= 0 ? '+' : '') + fx(r.bh, 2) + '%</span>'; }) +
    row('<b>超额（策略−持有）</b>', function (r) { return '<b>' + sign(r.alpha) + '</b>'; }) +
    row('胜率', function (r) { return r.nt ? fx(r.win, 1) + '%' : '—'; }) +
    row('最大回撤', function (r) { return '<span class="d">-' + fx(r.mdd, 2) + '%</span>'; }) +
    row('交易次数', function (r) { return r.nt + ' 笔'; }) +
    '</tbody>';

  // ---- 仓位口径校正（#28）----
  // 现行仓位来自"任意时点买入"的通用统计，用在有选择性的信号上会系统性偏小。
  // 这里改用：样本内跑一遍拿到该策略自身的胜率/盈亏比 → 凯利定仓 → 只在样本外验证。
  // 估仓位与验证严格分在两段数据上，避免用同一段既定仓位又算收益的循环论证。
  var sz = $('oosSize');
  var ISf = backtest(c.st, D, X, mergeCfg(c.cfg, { pos: 1 }), { a: 65, b: split });
  if (ISf.nt >= 8 && OS.nt >= 5) {
    var p1 = ISf.win / 100, b1 = ISf.pl;
    var k1 = b1 > 0 ? (p1 * b1 - (1 - p1)) / b1 : -1;
    var pos1 = clamp(k1 / 2, 0, 0.8);
    if (pos1 > 0) {
      var OSp = backtest(c.st, D, X, mergeCfg(c.cfg, { pos: pos1 }), { a: split, b: n - 1 });
      var alphaP = OSp.ann - OS.bh;
      sz.style.display = '';
      sz.innerHTML = '⚖ <b>仓位口径校正</b>：按样本内该策略自身实测（胜率 <b>' + fx(ISf.win, 1) +
        '%</b>、盈亏比 <b>' + fx(ISf.pl, 2) + '</b>）得出半凯利仓位 <b>' + fx(pos1 * 100, 1) + '%</b>' +
        '，对比界面当前的通用仓位 <b>' + fx(c.cfg.pos * 100, 1) + '%</b>（那是"任意时点买入"的统计）。' +
        '<br>以校正后的仓位跑<b>样本外</b>：年化 <b class="' + (OSp.ann >= 0 ? 'u' : 'd') + '">' +
        (OSp.ann >= 0 ? '+' : '') + fx(OSp.ann, 2) + '%</b>，超额 <b class="' + (alphaP >= 0 ? 'u' : 'd') + '">' +
        (alphaP >= 0 ? '+' : '') + fx(alphaP, 2) + '%</b>' +
        (alphaP > OS.alpha ? '（较原仓位改善 ' + fx(alphaP - OS.alpha, 2) + ' 个百分点）' : '') +
        '<br><span class="dm">估仓位只用样本内、验证只用样本外，两段数据不重叠。</span>';
    } else {
      sz.style.display = '';
      sz.innerHTML = '⚖ <b>仓位口径校正</b>：按样本内该策略自身实测（胜率 ' + fx(ISf.win, 1) + '%、盈亏比 ' +
        fx(ISf.pl, 2) + '）算出的凯利为负，<b>该策略本身不值得下注</b>，与通用仓位无关。';
    }
  } else {
    sz.style.display = 'none';
  }

  if (OS.nt < 5) {
    v.className = 'weak';
    v.innerHTML = '样本外只成交 <b>' + OS.nt + '</b> 笔，太少，无法判断策略是否延续。' +
      '换个交易更频繁的策略，或选历史更长的标的。';
  } else if (IS.alpha <= 0) {
    v.className = 'noise';
    v.innerHTML = '✖ <b>样本内就跑输买入持有</b>（超额 ' + fx(IS.alpha, 2) + '%/年）。' +
      '谈不上过拟合，它连"在自己熟悉的历史上有效"这一关都没过 —— 不如直接买入并持有。';
  } else if (OS.alpha <= 0) {
    v.className = 'noise';
    v.innerHTML = '✖ <b>典型过拟合</b>：样本内超额 ' + fx(IS.alpha, 2) + '%/年，样本外变成 ' +
      fx(OS.alpha, 2) + '%/年。<b>样本外的正收益来自行情本身</b>（同期买入持有 ' + fx(OS.bh, 2) +
      '%/年），不是这条规则的功劳。';
  } else if (OS.alpha >= IS.alpha * 0.5) {
    v.className = 'good';
    v.innerHTML = '✔ 样本外仍有 <b>' + fx(OS.alpha, 2) + '%/年超额</b>，保住样本内（' +
      fx(IS.alpha, 2) + '%）的 ' + fx(OS.alpha / IS.alpha * 100, 0) + '%，<b>超额有延续性</b>。' +
      '注意：后 30% 只是一段行情，换个市场阶段仍可能失效。';
  } else {
    v.className = 'weak';
    v.innerHTML = '～ 样本外超额 ' + fx(OS.alpha, 2) + '%/年，只剩样本内（' + fx(IS.alpha, 2) +
      '%）的 <b>' + fx(OS.alpha / IS.alpha * 100, 0) + '%</b>，<b>衰减明显</b>，多半有过拟合成分。';
  }
  log('▤ 样本外检验：超额 样本内 ' + fx(IS.alpha, 2) + '%/年（' + IS.nt + '笔）→ 样本外 ' +
      fx(OS.alpha, 2) + '%/年（' + OS.nt + '笔）｜同期买入持有 ' + fx(IS.bh, 2) + '% / ' + fx(OS.bh, 2) + '%',
      OS.alpha > 0 && IS.alpha > 0 ? 'ok' : 'err');
}

/* 参数敏感性：止损 × 目标 各 5 档，仓位固定，看超额在参数平面上的分布 */
var sensChart = null, SENS_MUL = [0.6, 0.8, 1.0, 1.2, 1.4];
function renderSensitivity(c) {
  var v = $('ssVerdict'), n = D.c.length;
  ['ssCur', 'ssNb', 'ssPos', 'ssMed'].forEach(function (id) { $(id).textContent = '—'; $(id).className = ''; });
  if (n < 200) {
    $('sensChart').style.display = 'none';
    v.className = 'weak'; v.innerHTML = '数据太短，无法做参数扫描。';
    return;
  }
  $('sensChart').style.display = '';
  var bhAll = (Math.pow(D.c[n - 1] / D.c[65], 243 / Math.max(n - 1 - 65, 1)) - 1) * 100;

  // 因子策略扫它自己的核心参数（持有期 × 分位阈值），其余策略扫止损 × 目标
  var isFac = c.st._fi != null;
  var HOLDS = [5, 8, 10, 15, 20], EDGES = [0.10, 0.15, 0.20, 0.25, 0.30];
  var K = 5, grid = [], flat = [], data = [], xs = [], ys = [], i, j;
  var xName = isFac ? '持有期(交易日)' : '止损%', yName = isFac ? '分位阈值%' : '目标%';
  for (i = 0; i < K; i++) xs.push(isFac ? String(HOLDS[i]) : fx(c.cfg.sl * SENS_MUL[i], 1));
  for (j = 0; j < K; j++) ys.push(isFac ? fx(EDGES[j] * 100, 0) : fx(c.cfg.tp * SENS_MUL[j], 1));
  for (j = 0; j < K; j++) {
    grid[j] = [];
    for (i = 0; i < K; i++) {
      // 仓位统一按满仓，与买入持有同口径 ——
      // 否则小仓位下策略几乎不参与市场，25 格会被"仓位太小"这一个共同因素淹没，失去区分度。
      var cfg2 = {};
      for (var k in c.cfg) cfg2[k] = c.cfg[k];
      cfg2.pos = 1;
      var stv = c.st;
      if (isFac) {
        stv = buildFactorStrategy(c.st._fi, c.st._low, c.st._win, HOLDS[i], EDGES[j]);
        stv.dir = c.st.dir;
      } else {
        cfg2.sl = c.cfg.sl * SENS_MUL[i];
        cfg2.tp = c.cfg.tp * SENS_MUL[j];
      }
      var rr = backtest(stv, D, X, cfg2);
      var alpha = rr.ann - bhAll;
      grid[j][i] = alpha; flat.push(alpha);
      data.push([i, j, +alpha.toFixed(2)]);
    }
  }
  var mid = 2;                                     // 当前参数所在格（乘数1.0 / 持有10日 / 阈值20%）

  // 因子策略再单独扫一遍「分位窗口」，它不在热力图的两个维度里
  var winTxt = '';
  if (isFac) {
    var WINS = [120, 250, 400], wr = [];
    WINS.forEach(function (w) {
      var s2 = buildFactorStrategy(c.st._fi, c.st._low, w, c.st._hold, c.st._edge);
      s2.dir = c.st.dir;
      var cfg3 = {}; for (var kk in c.cfg) cfg3[kk] = c.cfg[kk]; cfg3.pos = 1;
      var a2 = backtest(s2, D, X, cfg3).ann - bhAll;
      wr.push({ w: w, a: a2 });
    });
    winTxt = '<br>分位窗口敏感性：' + wr.map(function (o) {
      return (o.w === c.st._win ? '<b>' : '') + o.w + '根 ' +
        '<span class="' + (o.a >= 0 ? 'u' : 'd') + '">' + (o.a >= 0 ? '+' : '') + fx(o.a, 2) + '%</span>' +
        (o.w === c.st._win ? '（当前）</b>' : '');
    }).join('　');
  }
  var cur = grid[mid][mid];
  var nb = [], di, dj;
  for (dj = -1; dj <= 1; dj++) for (di = -1; di <= 1; di++) {
    if (!di && !dj) continue;
    var yy = mid + dj, xx = mid + di;
    if (grid[yy] && grid[yy][xx] !== undefined) nb.push(grid[yy][xx]);
  }
  var nbAvg = nb.reduce(function (a, b) { return a + b; }, 0) / nb.length;
  var posN = flat.filter(function (a) { return a > 0; }).length;
  var sorted = flat.slice().sort(function (a, b) { return a - b; });
  var med = sorted[Math.floor(sorted.length / 2)];

  var sg = function (x2) { return '<span class="' + (x2 >= 0 ? 'u' : 'd') + '">' + (x2 >= 0 ? '+' : '') + fx(x2, 2) + '%</span>'; };
  $('ssCur').innerHTML = sg(cur);
  $('ssNb').innerHTML = sg(nbAvg);
  $('ssPos').textContent = posN + ' / ' + flat.length + ' 格';
  $('ssMed').innerHTML = sg(med);

  var spread = sorted[sorted.length - 1] - sorted[0];
  if (isFac) {
    // 因子策略：三个参数都扫过了，判定直接看网格与窗口两条线索
    v.className = (cur > 0 && nbAvg > 0 && posN >= flat.length * 0.6) ? 'good'
      : (cur > 0 && posN >= flat.length * 0.4) ? 'weak' : 'noise';
    v.innerHTML = (v.className === 'good'
        ? '✔ <b>三个参数都扫过，仍是稳健区域</b>：' + posN + '/' + flat.length + ' 格为正，邻域均值 ' + fx(nbAvg, 2) + '%。'
        : v.className === 'weak'
        ? '～ ' + posN + '/' + flat.length + ' 格为正，<b>参数选择仍在影响结论</b>。'
        : '✖ 仅 ' + posN + '/' + flat.length + ' 格为正，<b>当前这组参数是被挑出来的</b>。') +
      winTxt +
      '<br><span class="dm">已扫描：持有期(5–20日) × 分位阈值(10–30%) 共 25 格，外加分位窗口 3 档。</span>';
  } else if (spread < 0.5) {
    // 25 格几乎一样：说明离场信号先于止损/止盈触发，这两个参数没参与决策
    v.className = cur > 0 ? 'weak' : 'noise';
    v.innerHTML = '⌗ <b>止损与目标几乎不影响结果</b>（25 格极差仅 ' + fx(spread, 2) + '%）：' +
      '该策略的离场几乎全部由「' + esc(c.st.x) + '」触发，止损/止盈从没轮到。' +
      '<br>所以这次扫描<b>没有真正检验到稳健性</b>' +
      (cur > 0 ? '——想验证稳健，应改动该策略自身的信号周期参数。' : '，而且当前超额为负（' + fx(cur, 2) + '%/年）。');
  } else if (cur <= 0) {
    v.className = 'noise';
    v.innerHTML = '当前参数下超额本就为负（' + fx(cur, 2) + '%/年），敏感性已无讨论价值 —— 先找到有正超额的参数再谈稳健。';
  } else if (nbAvg <= 0) {
    v.className = 'noise';
    v.innerHTML = '✖ <b>孤立尖峰</b>：当前格 ' + fx(cur, 2) + '%，相邻 8 格平均 ' + fx(nbAvg, 2) +
      '%。参数稍动结果就翻负，<b>这是过拟合最典型的形状</b>，当前这组参数是被历史"挑"出来的。';
  } else if (posN >= flat.length * 0.6 && nbAvg >= cur * 0.5) {
    v.className = 'good';
    v.innerHTML = '✔ <b>稳健区域</b>：' + posN + '/' + flat.length + ' 格为正超额，邻域均值 ' +
      fx(nbAvg, 2) + '% 与当前格 ' + fx(cur, 2) + '% 接近。参数不是关键，<b>规律本身可能真实存在</b>。';
  } else {
    v.className = 'weak';
    v.innerHTML = '～ 邻域均值 ' + fx(nbAvg, 2) + '%（当前格 ' + fx(cur, 2) + '%），' + posN + '/' +
      flat.length + ' 格为正。<b>有一定稳定性但不够扎实</b>，参数选择仍在影响结论。';
  }

  var lim = Math.max(Math.abs(sorted[0]), Math.abs(sorted[sorted.length - 1]), 1);
  setTimeout(function () {
    if (!sensChart) sensChart = keepSized(echarts.init($('sensChart')), $('sensChart'));
    sensChart.resize();
    sensChart.setOption({
      animation: false, backgroundColor: 'transparent',
      grid: { left: 46, right: 62, top: 14, bottom: 30 },
      tooltip: {
        backgroundColor: 'rgba(8,13,20,.96)', borderColor: '#22d3ee',
        textStyle: { color: '#c3d1e0', fontSize: 11 },
        formatter: function (p) {
          return xName.replace('%', '') + ' ' + xs[p.data[0]] + ' ／ ' + yName.replace('%', '') + ' ' + ys[p.data[1]] +
            '<br>超额 <b>' + (p.data[2] >= 0 ? '+' : '') + p.data[2] + '%/年</b>' +
            (p.data[0] === mid && p.data[1] === mid ? '<br><span style="color:#f5c542">← 当前设置</span>' : '');
        }
      },
      xAxis: { type: 'category', data: xs, name: xName, nameLocation: 'middle', nameGap: 20,
        nameTextStyle: { color: '#5d6f82', fontSize: 9 },
        axisLabel: { color: '#5d6f82', fontSize: 9 }, axisLine: { lineStyle: { color: '#1f2d3d' } }, splitArea: { show: true, areaStyle: { color: ['#0a1119', '#0c141d'] } } },
      yAxis: { type: 'category', data: ys, name: yName, nameTextStyle: { color: '#5d6f82', fontSize: 9 },
        axisLabel: { color: '#5d6f82', fontSize: 9 }, axisLine: { lineStyle: { color: '#1f2d3d' } }, splitArea: { show: true, areaStyle: { color: ['#0a1119', '#0c141d'] } } },
      visualMap: { min: -lim, max: lim, calculable: false, orient: 'vertical', right: 4, top: 'middle',
        itemWidth: 9, itemHeight: 96, precision: 0,
        textStyle: { color: '#5d6f82', fontSize: 9 },
        inRange: { color: ['#12d18a', '#0d1a20', '#3a2226', '#ff3b47'] } },
      series: [{
        type: 'heatmap', data: data,
        label: { show: true, fontSize: 9, color: '#c3d1e0',
          formatter: function (p) { return (p.data[2] >= 0 ? '+' : '') + fx(p.data[2], 0); } },
        itemStyle: {
          borderColor: function (o) { return (o.data[0] === mid && o.data[1] === mid) ? '#f5c542' : 'rgba(0,0,0,.25)'; },
          borderWidth: function (o) { return (o.data[0] === mid && o.data[1] === mid) ? 2 : 1; }
        }
      }]
    });
  }, 70);

  log('▤ 参数敏感性：当前格超额 ' + fx(cur, 2) + '%/年，邻域均值 ' + fx(nbAvg, 2) + '%，' +
      posN + '/' + flat.length + ' 格为正', nbAvg > 0 && cur > 0 ? 'ok' : 'err');
}

/* ---------- 跨标的扫描 ----------
   同一条规则在一篮子标的上各跑一遍，统计有多少个能跑出正超额。
   一个只在单个标的上成立的"规律"，通常是那个标的的巧合。 */
var SCAN_CACHE = {}, scanBusy = false, scanCard = null;
function scanBasket() {
  var ids = (QUICK[CAT] || []).slice(0, 16);
  return ids.filter(function (id) { return DB.byId[id]; });
}
function loadForScan(id) {
  if (SCAN_CACHE[id]) return Promise.resolve(SCAN_CACHE[id]);
  var it = DB.byId[id];
  var task = id.slice(0, 3) === 'OF.' ? fetchOTCNav(id.slice(3), it.name) : fetchEM(id, it.name);
  return task.then(function (d) {
    d.__x = indicators(d);
    SCAN_CACHE[id] = d;
    return d;
  });
}
function runScan(c) {
  if (scanBusy) return;
  var ids = scanBasket();
  if (ids.length < 4) {
    $('scanStatus').textContent = '当前分类的常用标的不足 4 个，无法做跨标的比较。';
    return;
  }
  scanBusy = true;
  $('btnScan').disabled = true;
  $('scanResult').style.display = 'none';
  var done = 0, rows = [], failed = 0;
  $('scanStatus').textContent = '正在扫描 0/' + ids.length + ' …';

  function one(id) {
    return loadForScan(id).then(function (d) {
      var r = backtest(c.st, d, d.__x, mergeCfg(c.cfg, { pos: 1 }));
      var m = d.c.length, bh = (Math.pow(d.c[m - 1] / d.c[65], 243 / Math.max(m - 1 - 65, 1)) - 1) * 100;
      rows.push({ id: id, name: d.name, ann: r.ann, bh: bh, alpha: r.ann - bh, nt: r.nt, mdd: r.mdd });
    }).catch(function () { failed++; }).then(function () {
      done++; $('scanStatus').textContent = '正在扫描 ' + done + '/' + ids.length + ' …';
    });
  }
  // 3 路并发 + 每次间隔，避免触发接口限流
  var idx = 0;
  function worker() {
    if (idx >= ids.length) return Promise.resolve();
    var id = ids[idx++];
    return one(id).then(function () {
      return new Promise(function (rs) { setTimeout(rs, 140); }).then(worker);
    });
  }
  Promise.all([worker(), worker(), worker()]).then(function () {
    scanBusy = false; $('btnScan').disabled = false;
    if (rows.length < 4) {
      $('scanStatus').textContent = '✗ 取数失败过多（成功 ' + rows.length + '/' + ids.length + '），请稍后重试。';
      return;
    }
    renderScan(c, rows, failed, ids.length);
  });
}
function mergeCfg(base, over) {
  var o = {}; for (var k in base) o[k] = base[k];
  for (var k2 in over) o[k2] = over[k2];
  return o;
}
function renderScan(c, rows, failed, total) {
  rows.sort(function (a, b) { return b.alpha - a.alpha; });
  var pos = rows.filter(function (r) { return r.alpha > 0; }).length;
  var sorted = rows.map(function (r) { return r.alpha; }).slice().sort(function (a, b) { return a - b; });
  var med = sorted[Math.floor(sorted.length / 2)];
  var selfIdx = rows.findIndex(function (r) { return r.id === (SEL && SEL.id); });

  $('scanStatus').textContent = '已扫描 ' + rows.length + ' 个标的' + (failed ? '（' + failed + ' 个取数失败）' : '') +
    ' · 满仓口径 · 超额 = 策略年化 − 同期买入持有年化';
  $('scanResult').style.display = '';
  $('scPos').innerHTML = '<span class="' + (pos > rows.length / 2 ? 'u' : 'd') + '">' + pos + ' / ' + rows.length + '</span>';
  $('scMed').innerHTML = '<span class="' + (med >= 0 ? 'u' : 'd') + '">' + (med >= 0 ? '+' : '') + fx(med, 2) + '%</span>';
  $('scRank').textContent = selfIdx >= 0 ? ('第 ' + (selfIdx + 1) + ' / ' + rows.length) : '不在篮子内';

  $('scanTbl').innerHTML =
    '<thead><tr><th>标的</th><th>策略年化</th><th>买入持有</th><th>超额</th><th>笔数</th></tr></thead><tbody>' +
    rows.map(function (r) {
      return '<tr' + (r.id === (SEL && SEL.id) ? ' class="self"' : '') + '>' +
        '<td>' + esc(r.name) + '</td>' +
        '<td class="' + (r.ann >= 0 ? 'u' : 'd') + '">' + (r.ann >= 0 ? '+' : '') + fx(r.ann, 2) + '%</td>' +
        '<td class="dm">' + (r.bh >= 0 ? '+' : '') + fx(r.bh, 2) + '%</td>' +
        '<td class="' + (r.alpha >= 0 ? 'u' : 'd') + '"><b>' + (r.alpha >= 0 ? '+' : '') + fx(r.alpha, 2) + '%</b></td>' +
        '<td>' + r.nt + '</td></tr>';
    }).join('') + '</tbody>';

  var v = $('scVerdict'), rate = pos / rows.length;
  if (rate >= 0.7 && med > 0) {
    v.className = 'good';
    v.innerHTML = '✔ <b>' + pos + '/' + rows.length + ' 个标的有正超额</b>，中位 ' + fx(med, 2) +
      '%。同一条规则在多数标的上都成立，<b>这是目前最强的证据</b>。';
  } else if (rate >= 0.5) {
    v.className = 'weak';
    v.innerHTML = '～ ' + pos + '/' + rows.length + ' 个为正，中位 ' + fx(med, 2) +
      '%。<b>大约一半一半</b>，接近抛硬币，说明规律不普适。';
  } else {
    v.className = 'noise';
    v.innerHTML = '✖ 仅 <b>' + pos + '/' + rows.length + '</b> 个标的有正超额，中位 ' + fx(med, 2) +
      '%。' + (selfIdx === 0 ? '<b>而你正在看的这个恰好是最好的那个</b> —— 典型的挑标的（selection bias）。'
        : '这条规则不具备跨标的普适性。');
  }
  v.innerHTML += '<br><span class="dm" style="font-size:9.5px">⚠ 篮子取自当前分类的常用标的，' +
    '均为<b>今天仍在市</b>的品种，已退市的不在其中（幸存者偏差）。</span>';

  log('▤ 跨标的扫描：' + pos + '/' + rows.length + ' 个标的有正超额，中位 ' + fx(med, 2) + '%',
      rate >= 0.7 ? 'ok' : rate >= 0.5 ? 'sys' : 'err');
}
$('btnScan').onclick = function () { if (scanCard) runScan(scanCard); };

/* ---------- 因子检验窗口 ---------- */
function icTag(v) {
  var a = Math.abs(v);
  if (!isFinite(v)) return ['—', 'dm'];
  var s = (v >= 0 ? '+' : '') + fx(v, 3);
  return [s, a >= 0.05 ? (v > 0 ? 'u' : 'd') : a >= 0.02 ? 'gd' : 'dm'];
}
function openIC() {
  if (!D || !X) { log('请先「⛁ 获取数据」载入行情', 'err'); return; }
  $('icSub').textContent = D.name + ' ｜ ' + D.t[65] + ' → ' + D.t[D.t.length - 1] +
    ' ｜ ' + (D.c.length - 65) + ' 根样本' + (D.otc ? ' ｜ 场外基金按净值' : '');
  var rows = '', lastFam = '', best = null, strong = 0, weak = 0;
  var trendSum = 0, trendN = 0;             // 统计动量/趋势类因子的方向
  FEATURES.forEach(function (f, fidx) {
    var res = factorIC(f[2], D, X);
    var i10 = res.ic[10], ir = res.icir;
    var aIC = Math.abs(i10), aIR = Math.abs(ir);
    // 综合幅度与稳定性：一个 IC 不大但在各分段都同号的因子，比 IC 大却飘忽的更可信
    var score = isFinite(i10) ? aIC * (isFinite(ir) ? Math.min(1 + aIR, 2.5) : 1) : -1;
    var lvl = !isFinite(i10) ? 0
      : (aIC >= 0.05 && aIR >= 0.3) ? 3
      : (aIC >= 0.05 || (aIC >= 0.03 && aIR >= 0.8)) ? 2
      : aIC >= 0.02 ? 1 : 0;
    if (lvl >= 3) strong++; else if (lvl >= 1) weak++;
    if (score > 0 && (!best || score > best.score)) best = { name: f[1], ic: i10, icir: ir, score: score, lvl: lvl };
    if ((f[0] === '收益率' || f[0] === '趋势') && isFinite(i10)) { trendSum += i10; trendN++; }

    var cells = IC_H.map(function (H) { var t = icTag(res.ic[H]); return '<td class="' + t[1] + '">' + t[0] + '</td>'; }).join('');
    var irTxt = isFinite(ir) ? fx(ir, 2) : '—';
    var irc = isFinite(ir) && aIR >= 0.3 ? (ir > 0 ? 'u' : 'd') : 'dm';
    var dirTxt = i10 > 0 ? '正向' : '反向';
    var judge = lvl === 0 ? '<span class="dm">无预测力</span>'
      : lvl === 1 ? '<span class="gd">偏弱</span>'
      : lvl === 2 ? '<span class="gd">' + dirTxt + '·中等</span>'
      : '<span class="' + (i10 > 0 ? 'u' : 'd') + '">' + dirTxt + '·较强且稳定</span>';
    var q = res.q, qTxt = '—', spTxt = '—', spc = 'dm';
    if (q) {
      qTxt = '<span class="dm">' + q.map(function (z) { return fx(z, 1); }).join(' ') + '</span>';
      spTxt = (res.spread >= 0 ? '+' : '') + fx(res.spread, 2) + '%';
      spc = Math.abs(res.spread) >= 1 ? (res.spread > 0 ? 'u' : 'd') : 'dm';
      if (res.mono >= 0.75) spTxt += ' <span class="gd">单调</span>';
    }
    rows += '<tr' + (f[0] !== lastFam ? ' class="sep"' : '') + '>' +
      '<td class="fam">' + (f[0] !== lastFam ? f[0] : '') + '</td>' +
      '<td>' + f[1] + '</td>' + cells +
      '<td class="' + irc + '">' + irTxt + '</td>' +
      '<td>' + (res.blockN ? res.blockPos + '/' + res.blockN : '—') + '</td>' +
      '<td style="font-size:9.5px">' + qTxt + '</td>' +
      '<td class="' + spc + '">' + spTxt + '</td>' +
      '<td>' + judge + '</td>' +
      '<td style="white-space:nowrap"><button class="mini" data-fi="' + fidx + '" data-low="' + (i10 <= 0 ? 1 : 0) + '">建策略</button>' +
      ' <button class="mini" data-pf="' + fidx + '" data-low="' + (i10 <= 0 ? 1 : 0) + '">组合</button></td></tr>';
    lastFam = f[0];
  });
  $('icTbl').innerHTML =
    '<thead><tr><th>类别</th><th>因子</th><th>IC(5日)</th><th>IC(10日)</th><th>IC(20日)</th>' +
    '<th>ICIR</th><th>分段为正</th><th title="按因子值从低到高分5组，各组未来10日平均收益%">分层收益 Q1→Q5</th>' +
    '<th title="最高组减最低组，即按此因子做多空的毛价差">Q5−Q1</th><th>判读</th>' +
    '<th title="按滚动分位精确命中最优那一组，固定持有10日">→</th></tr></thead><tbody>' + rows + '</tbody>';

  var v = $('icVerdict');
  // 动量/趋势类若整体为负，说明该标的呈短期反转特征——追涨类策略方向就是反的
  var trendAvg = trendN ? trendSum / trendN : 0;
  var revNote = (trendN >= 4 && trendAvg <= -0.02)
    ? '<br>⚑ <b>该标的呈现短期反转特征</b>：动量与趋势类因子的 IC 平均为 ' + fx(trendAvg, 3) +
      '（全部为负方向），意味着"涨得多的后面反而弱"。' +
      '<b>追涨类策略（均线金叉、突破、连阳）在这里方向是反的</b>，这也解释了它们为何跑不赢买入持有。'
    : (trendN >= 4 && trendAvg >= 0.02)
    ? '<br>⚑ 动量与趋势类因子 IC 平均 +' + fx(trendAvg, 3) + '，该标的偏<b>动量延续</b>特征，追涨类逻辑方向是对的。'
    : '';

  if (strong === 0 && weak === 0) {
    v.className = 'noise';
    v.innerHTML = '✖ <b>' + FEATURES.length + ' 个因子全部 |IC| &lt; 0.02</b>，在这个标的上没有一个具备可用的预测力。' +
      '基于它们搭的任何择时策略，本质上都是在噪声里找形状。' + revNote;
  } else if (strong === 0) {
    v.className = 'weak';
    v.innerHTML = '～ 没有"较强且稳定"的因子，' + weak + ' 个落在弱/中等区间。综合幅度与稳定性最靠前的是「' +
      best.name + '」（IC ' + fx(best.ic, 3) + '，ICIR ' + (isFinite(best.icir) ? fx(best.icir, 2) : '—') +
      '）。<b>证据不足以支撑一套择时系统</b>。' + revNote;
  } else {
    v.className = 'good';
    v.innerHTML = '✔ 有 <b>' + strong + '</b> 个因子达到"较强且稳定"（|IC|≥0.05 且 |ICIR|≥0.3）。综合最靠前的是「' +
      best.name + '」（IC ' + fx(best.ic, 3) + '，ICIR ' + (isFinite(best.icir) ? fx(best.icir, 2) : '—') + '）。' +
      (best.ic < 0 ? '它是<b>反向</b>因子：取值越高，后市反而越弱。' : '') + revNote +
      '<br><span class="dm">下一步不是立刻开仓，而是看它扣掉交易成本后还剩多少 —— ' +
      '前面几关已经反复说明：统计上的关联离能赚钱还差得远。</span>';
  }
  $('mask2').classList.add('on');
  log('◎ 因子检验：' + FEATURES.length + ' 个因子中，|IC|>0.05 有 ' + strong + ' 个，0.02–0.05 有 ' + weak + ' 个',
      strong ? 'ok' : weak ? 'sys' : 'err');
}
$('btnIC').onclick = openIC;
/* 组合回测：拉一篮子标的，用该因子打分选股 */
var pfBusy = false;
function runPortfolio(fi, lowSide) {
  if (pfBusy) return;
  var ids = scanBasket();
  if (ids.length < 5) { $('pfStatus').textContent = '当前分类常用标的不足 5 个，无法做组合。'; return; }
  pfBusy = true;
  $('pfTbl').style.display = 'none'; $('pfVerdict').style.display = 'none';
  var done = 0, list = [];
  $('pfStatus').textContent = '正在取数 0/' + ids.length + ' …';
  var idx = 0;
  function worker() {
    if (idx >= ids.length) return Promise.resolve();
    var id = ids[idx++];
    return loadForScan(id).then(function (d) { list.push(d); })
      .catch(function () {})
      .then(function () {
        done++; $('pfStatus').textContent = '正在取数 ' + done + '/' + ids.length + ' …';
        return new Promise(function (r) { setTimeout(r, 140); }).then(worker);
      });
  }
  Promise.all([worker(), worker(), worker()]).then(function () {
    pfBusy = false;
    if (list.length < 5) { $('pfStatus').textContent = '✗ 取数失败过多（成功 ' + list.length + '），请稍后重试。'; return; }
    var panel = buildPanel(list);
    if (!panel) { $('pfStatus').textContent = '✗ 这些标的的公共交易日不足 300 根，无法构建组合。'; return; }
    var cfg = cfgFromForm();
    var scores = panelScores(panel, fi, FQ_WIN);
    var pf = portfolioBacktest(panel, scores, lowSide, mergeCfg(cfg, PF));
    var bh = equalWeightBench(panel, pf.start);
    renderPortfolio(fi, lowSide, panel, pf, bh);
  });
}
function renderPortfolio(fi, lowSide, panel, pf, bh) {
  $('pfStatus').textContent = '篮子 ' + panel.syms.length + ' 个标的 ｜ ' + pf.from + ' → ' + pf.to +
    ' ｜ 每 ' + PF.rebal + ' 日调仓、持有 ' + PF.K + ' 只、单票上限 ' + Math.round(PF.maxOne * 100) +
    '%、总仓 ' + Math.round(PF.maxTotal * 100) + '%、冷却 ' + PF.cool + ' 日 ｜ 共 ' + pf.trades + ' 次买卖，费用 ' +
    fx(pf.feeSum, 0) + ' ' + mkt(panel.syms[0]).unit;
  var sg = function (v, d2) { return '<span class="' + (v >= 0 ? 'u' : 'd') + '">' + (v >= 0 ? '+' : '') + fx(v, d2 || 2) + '%</span>'; };
  $('pfTbl').style.display = '';
  $('pfTbl').innerHTML =
    '<thead><tr><th>指标</th><th>因子选股组合</th><th>等权持有全篮子</th><th>谁更优</th></tr></thead><tbody>' +
    '<tr><td>年化收益</td><td>' + sg(pf.ann) + '</td><td>' + sg(bh.ann) + '</td><td>' +
      (pf.ann > bh.ann ? '<span class="u">组合</span>' : '<span class="dm">等权</span>') + '</td></tr>' +
    '<tr><td>最大回撤</td><td><span class="d">-' + fx(pf.mdd, 2) + '%</span></td><td><span class="d">-' +
      fx(bh.mdd, 2) + '%</span></td><td>' + (pf.mdd < bh.mdd ? '<span class="u">组合</span>' : '<span class="dm">等权</span>') + '</td></tr>' +
    '<tr><td>年化波动</td><td>' + fx(pf.vol, 2) + '%</td><td>' + fx(bh.vol, 2) + '%</td><td>' +
      (pf.vol < bh.vol ? '<span class="u">组合</span>' : '<span class="dm">等权</span>') + '</td></tr>' +
    '<tr><td>夏普比率</td><td><b>' + fx(pf.sharpe, 2) + '</b></td><td><b>' + fx(bh.sharpe, 2) + '</b></td><td>' +
      (pf.sharpe > bh.sharpe ? '<span class="u">组合</span>' : '<span class="dm">等权</span>') + '</td></tr>' +
    '<tr><td>卡玛比率</td><td><b>' + fx(pf.calmar, 2) + '</b></td><td><b>' + fx(bh.calmar, 2) + '</b></td><td>' +
      (pf.calmar > bh.calmar ? '<span class="u">组合</span>' : '<span class="dm">等权</span>') + '</td></tr>' +
    '</tbody>';
  var v = $('pfVerdict'); v.style.display = '';
  var alpha = pf.ann - bh.ann;
  if (alpha > 1 && pf.sharpe > bh.sharpe) {
    v.className = 'good';
    v.innerHTML = '✔ <b>选股组合跑赢等权持有 ' + fx(alpha, 2) + '%/年</b>，夏普也更高（' +
      fx(pf.sharpe, 2) + ' vs ' + fx(bh.sharpe, 2) + '）。<b>这是"选品种"层面的证据，与前面的择时检验相互独立。</b>';
  } else if (alpha > 0 || pf.sharpe > bh.sharpe) {
    v.className = 'weak';
    v.innerHTML = '～ 部分指标占优（超额 ' + fx(alpha, 2) + '%/年，夏普 ' + fx(pf.sharpe, 2) + ' vs ' +
      fx(bh.sharpe, 2) + '），但优势不明显，可能来自换仓摩擦与样本波动。';
  } else {
    v.className = 'noise';
    v.innerHTML = '✖ <b>选股组合不如等权持有全篮子</b>（超额 ' + fx(alpha, 2) + '%/年）。' +
      '按这个因子挑标的，还不如把钱平摊在整个篮子上不动。';
  }
  v.innerHTML += '<br><span class="dm">⚠ 篮子只含今天仍在市的标的（幸存者偏差）。</span>';
  log('▤ 组合回测「' + FEATURES[fi][1] + '」：年化 ' + fx(pf.ann, 2) + '% vs 等权 ' + fx(bh.ann, 2) +
      '%，夏普 ' + fx(pf.sharpe, 2) + ' vs ' + fx(bh.sharpe, 2), alpha > 1 ? 'ok' : alpha > 0 ? 'sys' : 'err');
  renderPfChecks(fi, lowSide, panel, pf, bh);
}

/* 组合的三道关卡：随机选股基准 / 样本内外 / 参数敏感性 */
var PF_RUNS = 120;
function renderPfChecks(fi, lowSide, panel, pf, bh) {
  var box = $('pfChecks'); box.style.display = ''; box.innerHTML = '';
  var cfg = mergeCfg(cfgFromForm(), PF);
  var scores = panelScores(panel, fi, FQ_WIN);
  var n = panel.dates.length;
  var card = function (cls, html) { return '<div class="ck ' + cls + '">' + html + '</div>'; };
  var out = '';

  // ① 随机选股基准：同样的调仓节奏与约束，只把"选哪几只"换成随机
  var seed = 2166136261, key = 'pf|' + fi + '|' + panel.syms.length;
  for (var q = 0; q < key.length; q++) { seed ^= key.charCodeAt(q); seed = (seed * 16777619) >>> 0; }
  var rnd = function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  var rets = [];
  for (var run = 0; run < PF_RUNS; run++) rets.push(portfolioBacktest(panel, scores, lowSide, cfg, { rnd: rnd }).ann);
  rets.sort(function (a, b) { return a - b; });
  var pct = pctRank(rets, pf.ann), medR = rets[Math.floor(rets.length / 2)];
  var c1 = pct >= 95 ? 'good' : pct >= 80 ? 'weak' : 'noise';
  out += card(c1, '<b class="h">① 随机选股基准</b>　' + PF_RUNS + ' 组随机挑 ' + PF.K +
    ' 只（调仓节奏与约束完全相同）：随机中位年化 <b>' + fx(medR, 2) + '%</b>，本组合 <b>' + fx(pf.ann, 2) +
    '%</b>，位于第 <b>' + fx(pct, 1) + '</b> 百分位。<br>' +
    (pct >= 95 ? '✔ 因子选出来的确实优于随便挑。'
     : pct >= 80 ? '～ 强于多数随机组合，但未达 95% 门槛。'
     : '✖ <b>和随便挑 ' + PF.K + ' 只没有区别</b> —— 这个因子在选品种上没有贡献。'));

  // ② 样本内 / 样本外
  var split = Math.floor(n * 0.7);
  var isR = portfolioBacktest(panel, scores, lowSide, cfg, { b: split });
  var osR = portfolioBacktest(panel, scores, lowSide, cfg, { a: split, b: n - 1 });
  var isB = equalWeightBench(panel, isR.start), osB = equalWeightBench(panel, osR.start);
  var aIS = isR.ann - isB.ann, aOS = osR.ann - osB.ann;
  var c2 = (aIS > 0 && aOS > 0) ? (aOS >= aIS * 0.5 ? 'good' : 'weak') : 'noise';
  out += card(c2, '<b class="h">② 样本内 / 样本外</b>　超额（组合 − 等权）：' +
    '样本内 <b class="' + (aIS >= 0 ? 'u' : 'd') + '">' + (aIS >= 0 ? '+' : '') + fx(aIS, 2) + '%</b>/年 → ' +
    '样本外 <b class="' + (aOS >= 0 ? 'u' : 'd') + '">' + (aOS >= 0 ? '+' : '') + fx(aOS, 2) + '%</b>/年<br>' +
    (c2 === 'good' ? '✔ 超额在样本外仍然存在。'
     : c2 === 'weak' ? '～ 样本外衰减明显。'
     : '✖ <b>超额没有延续到样本外</b>。'));

  // ③ 参数敏感性：调仓周期 × 持仓数
  var REB = [5, 10, 15, 20, 30], KS = [1, 2, 3, 5, 8], gridTxt = [], posN = 0, tot = 0, curA = null;
  for (var y = 0; y < KS.length; y++) {
    var row = [];
    for (var xI = 0; xI < REB.length; xI++) {
      var c2b = mergeCfg(cfg, { rebal: REB[xI], K: KS[y] });
      var a2 = portfolioBacktest(panel, scores, lowSide, c2b).ann - bh.ann;
      tot++; if (a2 > 0) posN++;
      if (REB[xI] === PF.rebal && KS[y] === PF.K) curA = a2;
      row.push((a2 >= 0 ? '+' : '') + fx(a2, 1));
    }
    gridTxt.push('持仓' + KS[y] + '只: ' + row.join('  '));
  }
  var c3 = posN >= tot * 0.6 && curA > 0 ? 'good' : posN >= tot * 0.4 ? 'weak' : 'noise';
  out += card(c3, '<b class="h">③ 参数敏感性</b>　调仓周期（5/10/15/20/30 日）× 持仓数（1/2/3/5/8 只）共 ' +
    tot + ' 格，<b>' + posN + '</b> 格跑赢等权。当前格（' + PF.rebal + '日/' + PF.K + '只）超额 <b class="' +
    (curA >= 0 ? 'u' : 'd') + '">' + (curA >= 0 ? '+' : '') + fx(curA, 2) + '%</b>。' +
    '<div class="grid">' + gridTxt.join('<br>') + '<br><span style="color:#3a4a5a">列 = 调仓 5/10/15/20/30 日</span></div>' +
    (c3 === 'good' ? '✔ 多数参数组合都能跑赢等权。'
     : c3 === 'weak' ? '～ 约一半参数组合有效，选择仍在影响结论。'
     : '✖ <b>多数参数组合跑输等权</b>，当前这组是被挑出来的。'));

  box.innerHTML = out;
  log('▤ 组合三关：随机基准 ' + fx(pct, 1) + '百分位｜样本外超额 ' + fx(aOS, 2) + '%｜参数 ' + posN + '/' + tot + ' 格为正',
      (c1 === 'good' && c2 === 'good' && c3 === 'good') ? 'ok' : 'err');
}

/* 从因子表直接生成"精确命中最优分位"的策略 */
$('icTbl').addEventListener('click', function (e) {
  var pb = e.target.closest ? e.target.closest('button[data-pf]') : null;
  if (pb) { runPortfolio(+pb.dataset.pf, pb.dataset.low === '1'); return; }
  var b = e.target.closest ? e.target.closest('button[data-fi]') : null;
  if (!b) return;
  var tpl = buildFactorStrategy(+b.dataset.fi, b.dataset.low === '1');
  $('mask2').classList.remove('on');
  $('mask').classList.remove('on');
  log('◎ 由因子「' + FEATURES[+b.dataset.fi][1] + '」生成分位策略：滚动分位阈值只用当下往前 ' +
      FQ_WIN + ' 根计算，不使用全样本分位（避免偷看未来）', 'sys');
  addStrategies([tpl], 1, '因子分位');
});
$('icClose').onclick = function () { $('mask2').classList.remove('on'); };
$('mask2').onclick = function (e) { if (e.target === $('mask2')) $('mask2').classList.remove('on'); };

/* 导出：直接取页面上已渲染的结论，保证导出的内容与看到的一致 */
function buildExport() {
  var c = CARDS[curReport];
  if (!c) return '';
  var txt = function (id) { var e = $(id); return e ? e.textContent.replace(/\s+/g, ' ').trim() : ''; };
  var L = [];
  L.push('量化引擎 v10.0 · 策略检验报告');
  L.push('导出时间：' + new Date().toLocaleString('zh-CN'));
  L.push('');
  L.push('【标的与口径】');
  L.push('  ' + txt('mSub'));
  L.push('  数据源 ' + txt('srcTag') + ' ｜ ' + txt('barsTag') + ' ｜ ' + txt('asofTag'));
  L.push('');
  L.push('【策略规则】' + c.st.n + '（' + c.st.s + '｜' + (c.st.dir === 1 ? '做多' : '做空') + '）');
  L.push('  进场：' + c.st.b);
  L.push('  离场：' + c.st.x);
  L.push('');
  L.push('【绩效】');
  [].forEach.call(document.querySelectorAll('#kpis .kpi'), function (k) {
    L.push('  ' + k.querySelector('.k').textContent + '：' + k.querySelector('.v').textContent +
           '（' + k.querySelector('.s').textContent + '）');
  });
  var ex = txt('mExec'); if (ex) L.push('  ' + ex);
  L.push('');
  L.push('【风险调整（对比买入并持有）】');
  [].forEach.call(document.querySelectorAll('#riskTbl tbody tr'), function (tr) {
    var c2 = tr.cells;
    L.push('  ' + c2[0].textContent + '：策略 ' + c2[1].textContent.trim() +
           ' ｜ 持有 ' + c2[2].textContent.trim() + ' ｜ 更优：' + c2[3].textContent.trim());
  });
  L.push('  → ' + txt('riskVerdict'));
  L.push('');
  L.push('【检验关卡】');
  L.push('  ① 随机进场基准：本策略 ' + txt('rnReal') + '，随机中位 ' + txt('rnMed') +
         '，第 ' + txt('rnPct') + ' 百分位');
  L.push('     ' + txt('rnVerdict'));
  L.push('  ② 样本内 / 样本外：');
  [].forEach.call(document.querySelectorAll('#oosTbl tbody tr'), function (tr) {
    L.push('     ' + tr.cells[0].textContent + '：样本内 ' + tr.cells[1].textContent.trim() +
           ' ｜ 样本外 ' + tr.cells[2].textContent.trim());
  });
  var os2 = txt('oosSize'); if (os2 && $('oosSize').style.display !== 'none') L.push('     ' + os2);
  L.push('     ' + txt('oosVerdict'));
  L.push('  ③ 参数敏感性：当前格 ' + txt('ssCur') + '，邻域 ' + txt('ssNb') +
         '，正超额 ' + txt('ssPos') + '，中位 ' + txt('ssMed'));
  L.push('     ' + txt('ssVerdict'));
  var sc = txt('scVerdict');
  if (sc && sc !== '—') {
    L.push('  ④ 跨标的扫描：正超额 ' + txt('scPos') + '，中位 ' + txt('scMed') + '，本标的排名 ' + txt('scRank'));
    L.push('     ' + sc);
  } else {
    L.push('  ④ 跨标的扫描：本次未运行');
  }
  L.push('');
  L.push('【免责声明】');
  L.push('  以上全部为历史数据回测结果，不代表未来收益，存在过拟合与幸存者偏差。');
  L.push('  本终端为量化教学与策略演练工具，不构成任何投资建议。');
  return L.join('\n');
}
$('mExport').onclick = function () {
  var t = buildExport();
  if (!t) return;
  $('expText').value = t;
  $('expWrap').classList.add('on');
  $('expText').focus(); $('expText').select();
};
$('expCopy').onclick = function () {
  var ta = $('expText');
  ta.select();
  var done = function (ok) {
    $('expCopy').textContent = ok ? '✓ 已复制' : '复制失败，请手动 Ctrl+C';
    setTimeout(function () { $('expCopy').textContent = '复制到剪贴板'; }, 2200);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(ta.value).then(function () { done(true); }, function () { done(false); });
  } else {
    try { done(document.execCommand('copy')); } catch (e) { done(false); }
  }
};
$('expClose').onclick = function () { $('expWrap').classList.remove('on'); };
$('expWrap').onclick = function (e) { if (e.target === $('expWrap')) $('expWrap').classList.remove('on'); };

/* ---------- 资产配置窗口 ---------- */
var allocBusy = false, alChart = null;
$('btnAlloc').onclick = function () { $('mask3').classList.add('on'); };
$('alClose').onclick = function () { $('mask3').classList.remove('on'); };
$('mask3').onclick = function (e) { if (e.target === $('mask3')) $('mask3').classList.remove('on'); };
$('alRun').onclick = function () { runAlloc(); };

function runAlloc() {
  if (allocBusy) return;
  allocBusy = true; $('alRun').disabled = true;
  var ids = ALLOC_BASKET.filter(function (id) { return DB.byId[id]; });
  var done = 0, list = [];
  $('alStatus').textContent = '正在取数 0/' + ids.length + ' …';
  var idx = 0;
  function worker() {
    if (idx >= ids.length) return Promise.resolve();
    var id = ids[idx++];
    return loadForScan(id).then(function (d) { list.push(d); }).catch(function () {})
      .then(function () {
        done++; $('alStatus').textContent = '正在取数 ' + done + '/' + ids.length + ' …';
        return new Promise(function (r) { setTimeout(r, 140); }).then(worker);
      });
  }
  Promise.all([worker(), worker()]).then(function () {
    allocBusy = false; $('alRun').disabled = false;
    if (list.length < 3) { $('alStatus').textContent = '✗ 取数失败过多，请稍后重试。'; return; }
    var panel = buildPanel(list);
    if (!panel) { $('alStatus').textContent = '✗ 这些标的公共交易日不足，无法比较（科创50ETF 2020 年才上市）。'; return; }
    var cfg = cfgFromForm();
    $('alSub').textContent = panel.syms.length + ' 只宽基 ｜ ' + panel.dates[0] + ' → ' + panel.dates[panel.dates.length - 1];
    $('alStatus').textContent = '公共区间 ' + panel.dates.length + ' 个交易日。以下全部含真实费用。';
    renderAlloc1(panel, cfg);
    renderAlloc2(cfg);
    renderAlloc3(panel, cfg);
  });
}

/* ① 宽基组合：分散 + 再平衡 */
function renderAlloc1(panel, cfg) {
  $('alSec1').style.display = '';
  var M = panel.syms.length, feeRate = cfg.fee / 1e4 + cfg.slip / 1e4 + STAMP / 2;
  var rows = [], singles = [];
  for (var m = 0; m < M; m++) {
    var w0 = new Array(M).fill(0); w0[m] = 1;
    var s = curveStats(weightedCurve(panel, w0, 0, feeRate), 0);
    singles.push(s);
    rows.push({ name: panel.syms[m].name, s: s, hl: false });
  }
  var we = new Array(M).fill(1 / M);
  var eqNoReb = curveStats(weightedCurve(panel, we, 0, feeRate), 0);
  var eqReb = curveStats(weightedCurve(panel, we, REBAL_DAYS, feeRate), 0);
  rows.push({ name: '等权 · 不调仓', s: eqNoReb, hl: false });
  rows.push({ name: '等权 · 每季度再平衡', s: eqReb, hl: true });

  var f2 = function (v, d2) { return '<span class="' + (v >= 0 ? 'u' : 'd') + '">' + (v >= 0 ? '+' : '') + fx(v, d2 || 2) + '%</span>'; };
  $('alTbl1').innerHTML = '<thead><tr><th>组合</th><th>年化</th><th>最大回撤</th><th>年化波动</th><th>夏普</th><th>卡玛</th></tr></thead><tbody>' +
    rows.map(function (r) {
      return '<tr' + (r.hl ? ' class="hl"' : '') + '><td>' + esc(r.name) + '</td><td>' + f2(r.s.ann) +
        '</td><td><span class="d">-' + fx(r.s.mdd, 2) + '%</span></td><td>' + fx(r.s.vol, 2) + '%</td><td><b>' +
        fx(r.s.sharpe, 2) + '</b></td><td><b>' + fx(r.s.calmar, 2) + '</b></td></tr>';
    }).join('') + '</tbody>';

  var worstDD = Math.max.apply(null, singles.map(function (s) { return s.mdd; }));
  var avgDD = singles.reduce(function (a, s) { return a + s.mdd; }, 0) / singles.length;
  var avgSharpe = singles.reduce(function (a, s) { return a + s.sharpe; }, 0) / singles.length;
  var v = $('alV1');
  v.className = 'alv ' + (eqReb.sharpe > avgSharpe ? 'good' : 'weak');
  v.innerHTML = '分散效果：单只平均回撤 <b>' + fx(avgDD, 2) + '%</b>（最差 ' + fx(worstDD, 2) +
    '%），等权组合 <b>' + fx(eqReb.mdd, 2) + '%</b>，削减了 <b>' + fx(avgDD - eqReb.mdd, 2) + ' 个百分点</b>。' +
    '夏普 ' + fx(eqReb.sharpe, 2) + ' vs 单只平均 ' + fx(avgSharpe, 2) + '。' +
    '<br>再平衡效果：季度调仓 ' + f2(eqReb.ann) + ' / 回撤 ' + fx(eqReb.mdd, 2) +
    '%，不调仓 ' + f2(eqNoReb.ann) + ' / 回撤 ' + fx(eqNoReb.mdd, 2) + '%。' +
    (eqReb.ann > eqNoReb.ann ? '<b>再平衡这次是加分的</b>' : '<b>本段区间里再平衡并没有加分</b>') +
    '（它不保证提高收益，主要作用是把仓位拉回目标、避免单一资产越涨占比越大）。' +
    '<br><span class="dm">这些是"不预测涨跌"就能拿到的改善 —— 不需要任何择时能力。</span>';
}

/* ② 定投 vs 一次性 */
function renderAlloc2(cfg) {
  $('alSec2').style.display = '';
  var v = $('alV2');
  if (!D || !D.real) { $('alTbl2').innerHTML = ''; v.className = 'alv weak';
    v.innerHTML = '请先在主界面「获取数据」载入一个真实标的，本节按当前标的计算。'; return; }
  var amount = clamp(+$('alMonthly').value || 2000, 100, 1e7);
  var n = D.c.length, STEP = 20;
  var dca = dcaSim(D, amount, STEP, cfg);
  if (!dca.buys) { $('alTbl2').innerHTML = ''; v.className = 'alv weak';
    v.innerHTML = '每月 ' + amount + ' ' + MKT.unit + '买不起一' + (MKT.lot > 1 ? '手' : '股') + '「' + esc(D.name) + '」（约 ' +
      fx((D.rc ? D.rc[n - 1] : D.c[n - 1]) * MKT.lot, 0) + ' ' + MKT.unit + '），无法定投。请调高金额或换低价标的。'; return; }

  // 一次性：把定投的总投入在某一天全部投进去
  function lump(i0) {
    if (!(D.c[i0] > 0)) return null;
    var cost = dca.invested;
    var net = cost / (1 + cfg.slip / 1e4) - MIN_COMM;
    return net * (D.c[n - 1] / D.c[i0]);
  }
  var atStart = lump(0);
  var best = -Infinity, worst = Infinity, bi = 0, wi = 0;
  for (var i = 0; i < n - 1; i++) {
    var e = lump(i); if (e == null) continue;
    if (e > best) { best = e; bi = i; }
    if (e < worst) { worst = e; wi = i; }
  }
  var rows = [
    ['定投（每 ' + STEP + ' 交易日 ' + fx(amount, 0) + ' ' + MKT.unit + ' × ' + dca.buys + ' 次）', dca.end, dca.invested, true],
    ['期初一次性全投', atStart, dca.invested, false],
    ['最幸运时点一次性（' + D.t[bi] + '）', best, dca.invested, false],
    ['最倒霉时点一次性（' + D.t[wi] + '）', worst, dca.invested, false]
  ];
  $('alTbl2').innerHTML = '<thead><tr><th>方式</th><th>总投入</th><th>期末市值</th><th>总收益率</th></tr></thead><tbody>' +
    rows.map(function (r) {
      var g = (r[1] / r[2] - 1) * 100;
      return '<tr' + (r[3] ? ' class="hl"' : '') + '><td>' + r[0] + '</td><td>' + fx(r[2], 0) +
        '</td><td>' + fx(r[1], 0) + '</td><td><span class="' + (g >= 0 ? 'u' : 'd') + '">' +
        (g >= 0 ? '+' : '') + fx(g, 2) + '%</span></td></tr>';
    }).join('') + '</tbody>';

  var gD = (dca.end / dca.invested - 1) * 100, gB = (best / dca.invested - 1) * 100, gW = (worst / dca.invested - 1) * 100;
  var feeRate2 = dca.fees / dca.invested * 100;
  v.className = 'alv ' + (gD > gW + (gB - gW) * 0.4 ? 'good' : 'weak');
  v.innerHTML = '<b>择时的价值区间</b>：同样一笔钱，买在最倒霉的一天收益 ' + fx(gW, 2) +
    '%，最幸运的一天 ' + fx(gB, 2) + '%，相差 <b>' + fx(gB - gW, 2) + ' 个百分点</b>。' +
    '定投拿到 <b>' + fx(gD, 2) + '%</b>，落在这个区间的第 ' + fx((gD - gW) / Math.max(gB - gW, 1e-6) * 100, 0) + ' 百分位。' +
    '<br><b>定投的意义不是收益最高，而是把"买在哪一天"这个你无法控制的变量摊平了</b> —— ' +
    '代价是放弃了买在最低点的可能。' +
    '<br>费用：累计 <b>' + fx(dca.fees, 0) + ' ' + MKT.unit + '</b>，占总投入 <b>' + fx(feeRate2, 3) + '%</b>' +
    (feeRate2 > 0.15 ? '。<span class="u">每笔最低 ' + MKT.minComm + ' ' + MKT.unit + '佣金在小额定投下占比显著，调高每次金额或降低频率能明显省下这块。</span>' : '（占比很低，可忽略）。') +
    (dca.skipped ? '<br><span class="dm">有 ' + dca.skipped + ' 次因金额不足一' + (MKT.lot > 1 ? '手' : '股') + '被跳过。</span>' : '');
}

/* ③ 有效前沿 */
function renderAlloc3(panel, cfg) {
  $('alSec3').style.display = '';
  var M = panel.syms.length, feeRate = cfg.fee / 1e4 + cfg.slip / 1e4 + STAMP / 2;
  var pts = [], best = null, i, m;
  var seed = 20260807;
  function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
  for (i = 0; i < 3000; i++) {
    var w = [], sum = 0;
    for (m = 0; m < M; m++) { var r0 = -Math.log(1 - rnd()); w.push(r0); sum += r0; }
    for (m = 0; m < M; m++) w[m] /= sum;
    var s = curveStats(weightedCurve(panel, w, REBAL_DAYS, feeRate), 0);
    pts.push([+s.vol.toFixed(2), +s.ann.toFixed(2), s.sharpe]);
    if (!best || s.sharpe > best.s.sharpe) best = { w: w.slice(), s: s };
  }
  var we = new Array(M).fill(1 / M);
  var eqS = curveStats(weightedCurve(panel, we, REBAL_DAYS, feeRate), 0);
  var singles = [];
  for (m = 0; m < M; m++) {
    var w1 = new Array(M).fill(0); w1[m] = 1;
    var s1 = curveStats(weightedCurve(panel, w1, 0, feeRate), 0);
    singles.push({ name: panel.syms[m].name, v: s1.vol, a: s1.ann });
  }
  setTimeout(function () {
    if (!alChart) alChart = keepSized(echarts.init($('alChart')), $('alChart'));
    alChart.resize();
    alChart.setOption({
      animation: false, backgroundColor: 'transparent',
      grid: { left: 52, right: 18, top: 26, bottom: 34 },
      tooltip: { backgroundColor: 'rgba(8,13,20,.96)', borderColor: '#22d3ee',
        textStyle: { color: '#c3d1e0', fontSize: 11 },
        formatter: function (p) { return '年化波动 ' + p.data[0] + '%<br>年化收益 ' + p.data[1] + '%'; } },
      legend: { data: ['随机配比', '等权', '最大夏普', '单一资产'], top: 2,
        textStyle: { color: '#5d6f82', fontSize: 9 }, itemWidth: 10, itemHeight: 8 },
      xAxis: { type: 'value', name: '年化波动%', nameLocation: 'middle', nameGap: 20, scale: true,
        nameTextStyle: { color: '#5d6f82', fontSize: 9 }, axisLabel: { color: '#5d6f82', fontSize: 9 },
        axisLine: { lineStyle: { color: '#1f2d3d' } }, splitLine: { lineStyle: { color: '#0f1720' } } },
      yAxis: { type: 'value', name: '年化收益%', scale: true,
        nameTextStyle: { color: '#5d6f82', fontSize: 9 }, axisLabel: { color: '#5d6f82', fontSize: 9 },
        axisLine: { show: false }, splitLine: { lineStyle: { color: '#0f1720' } } },
      series: [
        { name: '随机配比', type: 'scatter', data: pts, symbolSize: 3,
          itemStyle: { color: 'rgba(34,211,238,.30)' } },
        { name: '等权', type: 'scatter', data: [[+eqS.vol.toFixed(2), +eqS.ann.toFixed(2)]], symbolSize: 13,
          itemStyle: { color: '#22d3ee' }, label: { show: true, formatter: '等权', position: 'top', color: '#22d3ee', fontSize: 9 } },
        { name: '最大夏普', type: 'scatter', data: [[+best.s.vol.toFixed(2), +best.s.ann.toFixed(2)]], symbolSize: 15,
          itemStyle: { color: '#f5c542' }, label: { show: true, formatter: '最大夏普', position: 'top', color: '#f5c542', fontSize: 9 } },
        { name: '单一资产', type: 'scatter', data: singles.map(function (o) { return [+o.v.toFixed(2), +o.a.toFixed(2), o.name]; }),
          symbolSize: 10, itemStyle: { color: '#ff3b47' },
          label: { show: true, fontSize: 9, color: '#ff8a92', position: 'right',
            formatter: function (p) { return p.data[2]; } } }
      ]
    });
  }, 60);

  var wTxt = best.w.map(function (w2, m2) { return panel.syms[m2].name + ' ' + fx(w2 * 100, 0) + '%'; }).join('　');
  var v = $('alV3');
  v.className = 'alv ' + (best.s.sharpe > eqS.sharpe * 1.15 ? 'good' : 'weak');
  v.innerHTML = '<b>最大夏普配比</b>：' + wTxt + '<br>年化 ' +
    '<span class="' + (best.s.ann >= 0 ? 'u' : 'd') + '">' + (best.s.ann >= 0 ? '+' : '') + fx(best.s.ann, 2) + '%</span>' +
    '，回撤 <span class="d">-' + fx(best.s.mdd, 2) + '%</span>，夏普 <b>' + fx(best.s.sharpe, 2) + '</b>' +
    '　｜　等权：年化 ' + fx(eqS.ann, 2) + '%，回撤 -' + fx(eqS.mdd, 2) + '%，夏普 ' + fx(eqS.sharpe, 2) +
    '<br><span class="u">⚠ 这个"最优配比"是在已知历史上算出来的，本身就是过拟合</span>：' +
    '换一段时间最优点会移动，直接照抄它没有意义。' +
    '<br><span class="dm">这张图真正的用处是看<b>形状</b> —— 散点云的上边缘就是有效前沿，' +
    '等权点离前沿有多远，决定了"精调权重"值不值得费这个劲。通常答案是：不值得。</span>';
}

$('btnGuide').onclick = function () { $('mask8').classList.add('on'); };
$('guideClose').onclick = function () { $('mask8').classList.remove('on'); };
$('mask8').onclick = function (e) { if (e.target === $('mask8')) $('mask8').classList.remove('on'); };
$('mClose').onclick = function () { $('mask').classList.remove('on'); };
$('mask').onclick = function (e) { if (e.target === $('mask')) $('mask').classList.remove('on'); };
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape') return;
  if ($('expWrap').classList.contains('on')) $('expWrap').classList.remove('on');
  else if ($('mask8').classList.contains('on')) $('mask8').classList.remove('on');
  else if ($('mask7').classList.contains('on')) $('mask7').classList.remove('on');
  else if ($('mask4').classList.contains('on')) $('mask4').classList.remove('on');
  else if ($('mask3').classList.contains('on')) $('mask3').classList.remove('on');
  else if ($('mask2').classList.contains('on')) $('mask2').classList.remove('on');
  else if ($('agentPanel').classList.contains('open')) agentOpen(false);
  else $('mask').classList.remove('on');
});

/* ============================================================
   10. 获取数据
   ============================================================ */
function applyData(d, srcTxt) {
  stopLive();
  manualWin = manualOdds = false;      // 换标的后胜率/赔率回到实测
  otcNoteShown = false;
  D = d; X = indicators(D); logSym = null; MKT = mkt(D);
  AGENT.lastResearch = null;              // 研判结论只属于原标的，换标的后不得继续注入
  if (D.tradable === undefined) D.tradable = true;   // 模拟行情默认可交易
  play.idx = D.c.length - 1;
  // 费率输入框在场内/场外之间切换含义
  if (D.otc) {
    $('fFeeLab').textContent = '申购费 %';
    if (+$('fFee').value === 2.5) $('fFee').value = '0.15';
    $('fSlip').disabled = true; $('fSlipLab').textContent = '滑点（场外不适用）';
  } else {
    $('fFeeLab').textContent = '佣金 ‱';
    if (+$('fFee').value === 0.15) $('fFee').value = '2.5';
    $('fSlip').disabled = false; $('fSlipLab').textContent = '滑点 ‱';
  }
  $('fCapLab').textContent = '初始资金 ' + MKT.unit;
  $('fCapLab').title = MKT.lot > 1
    ? '决定能买几手（100 股整手），以及每笔最低 5 元佣金的实际影响'
    : '美股 1 股起买、无印花税；每笔最低佣金按 1 美元计（各券商差异较大）';
  $('chartTitle').textContent = D.otc ? '净值走势图' : '日线回测图';
  $('chartTag').innerHTML = (D.otc
    ? '单位净值 + 20日均线 · 副图为日涨跌幅 · T+1 公布'
    : 'K线 + 20日均线 · 约 4 年日线'
      + (D.real && D.adj && D.adj !== '0' ? ' · <span class="gd">图为' + ADJ_NAME[D.adj] + '价</span>' : ''))
    + (D.tradable ? '' : ' <span class="chip r">不可直接交易</span>');
  renderChart(false);
  chart.setOption({ dataZoom: [{ start: 62, end: 100 }, { start: 62, end: 100 }] });
  $('srcTag').textContent = srcTxt;
  $('barsTag').textContent = '日线 ' + D.c.length + ' 根';
  $('asofTag').textContent = '数据截止 ' + D.t[D.t.length - 1];
  $('dot').style.background = D.real ? 'var(--down)' : 'var(--gold)';
  $('dot').style.boxShadow = '0 0 8px ' + (D.real ? 'var(--down)' : 'var(--gold)');
  CARDS = []; lastBT = null; renderCards();
  paintSignals();
  agentRefreshContext();
  log('◆ 载入 ' + D.name + ' · ' + D.c.length + ' 根日线 · ' + D.t[0] + ' → ' + D.t[D.t.length - 1] + ' · 数据源 ' + srcTxt, 'ok');
  if (D.c.length < 90) {
    log('⚠ 该标的仅 ' + D.c.length + ' 根数据，指标需要 60 根预热，几乎无法回测，建议换成上市较久的标的', 'err');
  } else if (D.c.length < 250) {
    log('⚠ 该标的仅 ' + D.c.length + ' 根数据（约 ' + (D.c.length / 243).toFixed(1) + ' 年），样本偏短，回测结果参考价值有限', 'err');
  }
  if (!D.otc && D.real) {
    var am = D.adj || '2';
    log('· 复权方式：' + (ADJ_NAME[am] || '未知') +
        (am === '2' ? '（回测推荐：历史价固定，同一策略任何时候重跑结果一致；显示价与当前市价有偏离属正常）'
         : am === '1' ? '（⚠ 前复权每次分红除权都会改写全部历史价，同一回测隔段时间重跑结果会变，不建议用于回测）'
         : '（⚠ 未复权，除权日会出现价格跳空，均线与收益率均失真）'),
        am === '2' ? 'sys' : 'err');
  }
  if (D.otc) {
    log('· 场外基金按当日单位净值申赎，回测的成交价取次日净值；无盘中价、无成交量，故不支持实时同步', 'sys');
    log('· 赎回费已按持有天数分档计入：<7天 1.5%｜7-30天 0.75%｜30天-1年 0.5%｜1年以上 0.25%。' +
        '策略最长持仓 60 个交易日，多数交易会落在 0.5% 档', 'sys');
  }
  if (!D.tradable) {
    log('⚠ 「' + D.name + '」是' + (D.cat || '指数') + '，是计算出来的数值，<b>没有任何渠道可以直接买卖</b>。' +
        '下面的回测只反映该' + (D.cat === '板块' ? '板块' : '指数') + '的走势特征，不代表你能照此交易；' +
        '要实际操作请改选跟踪它的 ETF。', 'err');
  }
  var k = Math.max(60, D.c.length - 14);
  (function stream() {
    if (k >= D.c.length) { startIdle(); return; }
    logBar(D.name, { d: D.t[k], o: D.o[k], h: D.h[k], l: D.l[k], c: D.c[k], v: D.v[k] }, D.c[k - 1]);
    k++; setTimeout(stream, 55);
  })();
}
function guessSecid(code) {
  code = (code || '').trim();
  // 美股代码是字母，无法从代码本身推断交易所（105/106/107），只能查标的库
  if (/^[A-Za-z][A-Za-z._-]{0,6}$/.test(code)) {
    var up = code.toUpperCase().replace(/[.-]/g, '_');
    var hit = ['105.', '106.', '107.'].map(function (p) { return DB.byId[p + up]; })
      .filter(function (x) { return x; })[0];
    return hit ? hit.id : null;
  }
  if (!/^\d{6}$/.test(code)) return null;
  var h = code[0];
  return (h === '6' || h === '5' || h === '9') ? '1.' + code : '0.' + code;
}
function doFetch() {
  var secid, name;
  if (SEL) { secid = SEL.id; name = SEL.name; }
  else {
    var raw = IN.value.trim().replace(/\s.*$/, '');
    secid = (CAT === '场外基金' && /^\d{6}$/.test(raw)) ? 'OF.' + raw : guessSecid(raw);
    name = raw;
    if (!secid) { log('✗ 请先在标的框中选择一个标的，或输入 6 位代码（如 600519 / 159915）、美股代码（如 AAPL）', 'err'); IN.focus(); return Promise.resolve(false); }
  }
  lbStart(); clearInterval(idleTicker); stopPlay();
  var otc = secid.slice(0, 3) === 'OF.';
  log('⛁ 正在请求' + (otc ? '历史净值' : '日线数据') + '（' + name + ' · ' + secid.replace('OF.', '') + '）…', 'sys');
  var meta = DB.byId[secid];
  var cat = meta ? meta.cat : (secid.slice(0, 3) === '90.' ? '板块' : '');
  var tradable = cat ? ['股票', '场内基金', '场外基金', '美股'].indexOf(cat) >= 0 : true;
  var task = otc ? fetchOTCNav(secid.slice(3), name) : fetchEM(secid, name);
  return task.then(function (d) {
    d.cat = cat; d.tradable = tradable;
    applyData(d, otc ? '天天基金' : '东方财富');
    lbDone();
    return true;
  }).catch(function (e) {
    log('✗ 在线数据不可用（' + e.message + '），切换本地模拟行情引擎', 'err');
    applyData(simulate(name + '［模拟］', secid), '本地模拟');
    lbDone();
    return false;
  });
}
$('btnFetch').onclick = doFetch;
$('fAdj').onchange = function () {
  if (D && D.real && !D.otc) { log('复权方式已改为「' + ADJ_NAME[adjMode()] + '」，正在重新取数…', 'sys'); doFetch(); }
};

/* ============================================================
   11. 启动
   ============================================================ */
log('量化引擎 v10.0 初始化…', 'sys');
log('模块加载：图表引擎 / 指标库 / 回测引擎 / 策略库（' + (LONG.length + SHORT.length) + ' 个模板）', 'sys');
lbStart();
(function bootUniverse() {
  var baked = window.__QE_UNIVERSE__;
  var use = baked;
  try {
    var s = localStorage.getItem(LSKEY);
    if (s) {
      var u = JSON.parse(s);
      // 只有确实更新、且不比内置快照少的缓存才优先采用
      if (u && u.data && (!baked || u.ts > baked.ts || (u.ts === baked.ts && (u.total || 0) >= (baked.total || 0)))) use = u;
    }
  } catch (e) { /* 忽略本地存储异常 */ }
  if (use) {
    loadUniverse(use);
    log('标的库就绪：' + DB.list.length + ' 个标的（股票 / 基金 / 板块 / 指数），快照日期 ' + DB.ts, 'ok');
  } else {
    $('dbTxt').textContent = '标的库未内置，请点「更新」';
    log('未内置标的库，可点「更新」在线拉取', 'err');
  }
  var q = DB.byId['1.510300'];
  if (q) { SEL = q; CAT = q.cat; IN.value = selText(q); }
  IN.placeholder = CAT_PH[CAT] || '';
  paintDbState();
})();
setTimeout(function () {
  applyData(simulate('沪深300ETF［模拟］', 'boot'), '本地模拟');
  lbDone();
  log('提示：点「⛁ 获取数据」拉取东方财富真实日线（需联网）', 'sys');
  log('⚠ 数据为日线级历史行情（非实时逐笔），仅覆盖 A 股与场内基金；本终端为量化教学与策略演练工具，回测结果不构成投资建议', 'err');
}, 500);


/* ============================================================
   13. 我的持仓 / 市场每日情绪（需要本机后端 server/）
   ------------------------------------------------------------
   设计取舍：
   · 后端只负责"存"和"想"（SQLite 持仓、新闻抓取、大模型情绪与建议），
     行情仍走前端已有的东方财富快照通道 —— 不在后端重复造一套行情源。
   · 后端没启动时，这两个窗口显示启动指引，主终端的回测功能完全不受影响。
   ============================================================ */
var API = (function () {
  try { return localStorage.getItem('qe_api') || 'http://127.0.0.1:8770'; }
  catch (e) { return 'http://127.0.0.1:8770'; }
})();
var SRV = { ok: false, info: null, checked: 0 };

function api(path, opt) {
  opt = opt || {};
  return fetch(API + path, {
    method: opt.method || 'GET',
    headers: opt.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opt.body ? JSON.stringify(opt.body) : undefined,
    signal: AbortSignal.timeout(opt.timeout || 30000)
  }).then(function (r) {
    return r.text().then(function (t) {
      var j = null; try { j = JSON.parse(t); } catch (e) { /* 非 JSON 走下面的报错 */ }
      if (!r.ok) throw new Error((j && (j.detail || j.message)) || ('HTTP ' + r.status));
      if (j === null) throw new Error('后端返回了非 JSON 内容');
      return j;
    });
  });
}
function checkSrv() {
  return api('/api/health', { timeout: 4000 }).then(function (j) {
    SRV.ok = true; SRV.info = j; SRV.checked = Date.now(); return j;
  }).catch(function (e) {
    SRV.ok = false; SRV.info = null; SRV.err = e.message; SRV.checked = Date.now();
    throw e;
  });
}
function srvBadge(id) {
  var el = $(id);
  if (SRV.ok) {
    var m = SRV.info && SRV.info.llm && SRV.info.llm.enabled
      ? SRV.info.llm.model : '未配置模型';
    el.className = 'srvTag ok'; el.textContent = '后端已连接 · ' + m;
  } else {
    el.className = 'srvTag bad'; el.textContent = '后端未连接';
  }
}
var OFFLINE_HTML =
  '<b style="color:var(--up)">后端未启动</b>，「我的持仓」与「市场情绪」需要它来存数据和调模型。<br>' +
  '在项目目录下打开命令行，执行：<br>' +
  '<code>cd server</code><br><code>pip install -r requirements.txt</code><br>' +
  '<code>uvicorn main:app --host 127.0.0.1 --port 8770</code><br>' +
  '（Windows 也可以直接双击 <code>server\\run.bat</code>，它会自动建虚拟环境并装依赖）<br>' +
  '<span style="color:var(--dim2)">情绪打分与每日建议还需要在 <code>server/.env</code> 里填 <code>LLM_API_KEY</code>。' +
  '主终端的行情、回测、因子检验、资产配置<b style="color:var(--gold)">不依赖后端</b>，照常可用。</span>';

/* ---------- 驻留 DeepSeek 量化专家 ---------- */
var AGENT = { items: [], loaded: false, busy: false, dragging: null, resizing: null, stage: '', lastResearch: null, trace: [], sizeTimer: 0 };

function agentSeriesAvg(a, end, n) {
  if (!a || end < 0) return null;
  var from = Math.max(0, end - n + 1), sum = 0, count = 0;
  for (var i = from; i <= end; i++) if (isFinite(a[i])) { sum += +a[i]; count++; }
  return count ? sum / count : null;
}
function agentTechnicalContext(idx) {
  if (!D || idx < 0) return {};
  var raw = D.rc && D.rc.length === D.c.length ? D.rc : D.c;
  var close = raw[idx], from20 = Math.max(0, idx - 19), recent = raw.slice(from20, idx + 1).filter(isFinite);
  var atrPct = X && isFinite(X.atr[idx]) && D.c[idx] ? X.atr[idx] / D.c[idx] * 100 : null;
  function ret(n) { return idx >= n && raw[idx - n] ? (close / raw[idx - n] - 1) * 100 : null; }
  return {
    close: isFinite(close) ? +close.toFixed(4) : null,
    ma20_close: agentSeriesAvg(raw, idx, 20),
    ma60_close: agentSeriesAvg(raw, idx, 60),
    high20_close: recent.length ? Math.max.apply(null, recent) : null,
    low20_close: recent.length ? Math.min.apply(null, recent) : null,
    atr_pct: isFinite(atrPct) ? +atrPct.toFixed(3) : null,
    return_5d_pct: ret(5), return_20d_pct: ret(20), return_60d_pct: ret(60)
  };
}

function agentContext() {
  var idx = D && D.c && D.c.length ? clamp(play.idx, 0, D.c.length - 1) : -1;
  var loadedSecid = D && D.sym && D.sym !== 'SIM' && D.sym !== 'boot'
    ? D.sym : (SEL && SEL.id) || '';
  var loadedCode = loadedSecid.indexOf('OF.') === 0
    ? loadedSecid.slice(3) : loadedSecid.split('.').pop();
  return {
    instrument: {
      name: (D && D.name) || $('tickerName').textContent.trim(),
      code: loadedCode || (SEL && SEL.code) || '',
      secid: loadedSecid,
      category: (D && D.cat) || (SEL && SEL.cat) || CAT || '',
      price: $('tickerPx').textContent.trim(),
      change: $('tickerChg').textContent.trim()
    },
    data: {
      source: $('srcTag').textContent.trim(),
      bars: $('barsTag').textContent.trim(),
      asof: $('asofTag').textContent.trim(),
      current_bar_date: idx >= 0 && D.t ? D.t[idx] : ''
    },
    signals: {
      regime: $('sigRegime').textContent.trim(),
      volatility: $('sVol').textContent.trim(),
      score: $('sScore').textContent.trim(),
      win_rate: $('sWin').textContent.trim(),
      odds: $('sOdds').textContent.trim(),
      risk: $('sRisk').textContent.trim(),
      position: $('sPos').textContent.trim(),
      expected_value: $('sEv').textContent.trim(),
      trend: $('sTrend').textContent.trim()
    },
    parameters: {
      stop_loss_pct: $('fSL').value,
      target_pct: $('fTP').value,
      initial_cash: $('fCap').value
    },
    technicals: agentTechnicalContext(idx),
    last_research: AGENT.lastResearch ? {
      action: AGENT.lastResearch.action, confidence: AGENT.lastResearch.confidence,
      headline: AGENT.lastResearch.headline
    } : null
  };
}

function agentSetStage(text) {
  AGENT.stage = text || '正在分析';
  if (AGENT.busy) renderAgentMessages();
}
function agentFactorPercentile(fn, idx) {
  var cur;
  try { cur = fn(idx, X, D); } catch (e) { return null; }
  if (!isFinite(cur)) return null;
  var from = Math.max(65, idx - 250), below = 0, count = 0;
  for (var i = from; i < idx; i++) {
    var value; try { value = fn(i, X, D); } catch (e2) { value = NaN; }
    if (!isFinite(value)) continue;
    count++; if (value < cur) below++;
  }
  return count >= 80 ? below / count : null;
}
function agentFactorEvidenceAsync() {
  return new Promise(function (resolve) {
    var idx = clamp(play.idx, 0, D.c.length - 1), rows = [], fi = 0;
    function step() {
      if (fi >= FEATURES.length) {
        rows.sort(function (a, b) { return b.reliability_score - a.reliability_score; });
        var strong = rows.filter(function (x) { return x.quality === '较强且稳定'; });
        resolve({
          tested: FEATURES.length,
          valid: rows.length,
          strong_count: strong.length,
          favorable_now: rows.filter(function (x) { return x.current_signal === '支持'; }).length,
          adverse_now: rows.filter(function (x) { return x.current_signal === '反对'; }).length,
          factors: rows,
          warning: 'IC 与分层收益来自当前完整历史样本，属于探索性证据；当前分位只使用此前最多250根数据。'
        });
        return;
      }
      var f = FEATURES[fi++], res = factorIC(f[2], D, X), ic10 = res.ic[10], ir = res.icir;
      if (isFinite(ic10)) {
        var pct = agentFactorPercentile(f[2], idx), aic = Math.abs(ic10), air = Math.abs(ir);
        var quality = aic >= 0.05 && isFinite(ir) && air >= 0.3 ? '较强且稳定' : aic >= 0.02 ? '偏弱' : '无预测力';
        var signal = '中性';
        if (pct != null && quality !== '无预测力') {
          if ((ic10 > 0 && pct >= 0.8) || (ic10 < 0 && pct <= 0.2)) signal = '支持';
          else if ((ic10 > 0 && pct <= 0.2) || (ic10 < 0 && pct >= 0.8)) signal = '反对';
        }
        rows.push({ family: f[0], name: f[1], ic10: +ic10.toFixed(4),
          icir: isFinite(ir) ? +ir.toFixed(3) : null,
          q5_q1_pct: isFinite(res.spread) ? +res.spread.toFixed(3) : null,
          current_percentile: pct == null ? null : +pct.toFixed(3), current_signal: signal,
          quality: quality, reliability_score: +(aic * (isFinite(ir) ? Math.min(1 + air, 2.5) : 1)).toFixed(5) });
      }
      if (fi % 3 === 0) agentSetStage('正在检验因子 ' + fi + '/' + FEATURES.length);
      setTimeout(step, 0);
    }
    step();
  });
}
function agentBacktestEvidenceAsync() {
  return new Promise(function (resolve) {
    var pool = LONG.concat(REVERSAL), seen = {}, list = [];
    pool.forEach(function (t) {
      var key = t.n + '|' + t.s;
      if (seen[key] || (D.otc && t.nb)) return;
      seen[key] = 1; list.push(t);
    });
    var cfg = mergeCfg(cfgFromForm(), { pos: 1 }), rows = [], k = 0, n = D.c.length;
    var split = Math.max(80, Math.min(n - 30, Math.floor(n * 0.7)));
    var bhOS = D.c[split] > 0 ? (D.c[n - 1] / D.c[split] - 1) * 100 : 0;
    function step() {
      if (k >= list.length) {
        rows.sort(function (a, b) { return b.rank_score - a.rank_score; });
        resolve({
          tested: rows.length,
          full_position_signal_test: true,
          oos_from: D.t[split], oos_to: D.t[n - 1], oos_buy_hold_pct: +bhOS.toFixed(2),
          positive_oos_excess: rows.filter(function (x) { return x.oos_excess_pct > 0 && x.oos_trades >= 5; }).length,
          entry_votes_now: rows.filter(function (x) { return x.entry_now; }).length,
          exit_votes_now: rows.filter(function (x) { return x.exit_now; }).length,
          top_by_oos_risk_score: rows.slice(0, 8),
          warning: '排序同时惩罚回撤与少样本；仍存在同标的多策略筛选偏差，不能把第一名称为最优。'
        });
        return;
      }
      var tpl = list[k++], card = buildCard(tpl, 1, cfg);
      var os = backtest(card.st, D, X, cfg, { a: split, b: n - 1 });
      var entry = false, exit = false;
      try { entry = !!card.st.e(n - 1, X, D); } catch (e) { /* ignore */ }
      try { exit = !!card.st.q(n - 1, X, D); } catch (e2) { /* ignore */ }
      var excess = os.ret - bhOS;
      rows.push({ name: card.st.n, style: card.st.s,
        total_return_pct: +card.r.ret.toFixed(2), annualized_pct: +card.r.ann.toFixed(2),
        max_drawdown_pct: +card.r.mdd.toFixed(2), win_rate_pct: +card.r.win.toFixed(2),
        payoff_ratio: +card.r.pl.toFixed(2), trades: card.r.nt,
        oos_return_pct: +os.ret.toFixed(2), oos_excess_pct: +excess.toFixed(2), oos_trades: os.nt,
        entry_now: entry, exit_now: exit,
        rank_score: +(excess - card.r.mdd * 0.25 + card.r.win * 0.03 - (os.nt < 5 ? 15 : 0)).toFixed(3) });
      if (k % 4 === 0) agentSetStage('正在回测策略 ' + k + '/' + list.length);
      setTimeout(step, 0);
    }
    step();
  });
}
function agentResearchSnapshotAsync() {
  agentSetStage('正在检验因子 0/' + FEATURES.length);
  return agentFactorEvidenceAsync().then(function (factors) {
    agentSetStage('正在回测策略');
    return agentBacktestEvidenceAsync().then(function (backtests) {
      return { market: agentContext(), factors: factors, backtests: backtests,
        source_rules: { no_live_execution: true, otc_nav_delay: !!D.otc,
          online_real_data: !!D.real, tradable: D.tradable !== false } };
    });
  });
}

function agentRefreshContext() {
  var name = $('tickerName').textContent.trim() || '等待行情载入';
  $('agentContextName').textContent = name + ' · ' + $('asofTag').textContent.trim();
}
function agentSetStatus(ok, model, message) {
  $('agentState').className = ok ? 'ok' : 'bad';
  $('agentState').textContent = ok ? '已连接' : (message || '未连接');
  $('agentModel').textContent = ok ? ('DeepSeek · ' + (model || '量化专家')) : 'DeepSeek · 后端未连接';
}
function agentWelcome() {
  return '<div class="agentWelcome"><b>我住在量化引擎里。</b>' +
    '我可以围绕这个网页日常对话，也会按问题调用后端读取公开行情、财经新闻、情绪、基金关联、持仓或模拟盘数据。' +
    '你可以问“解读今天的新闻并查看关联基金”或使用下方快捷问题。我的回答是研究辅助，不是未来预测。</div>';
}
function agentClock(ts) {
  if (!ts) return '';
  var m = String(ts).match(/T(\d\d:\d\d)/); return m ? m[1] : '';
}
function agentInline(text) {
  return String(text || '').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}
function agentFormat(text) {
  return esc(text || '').split(/\r?\n/).map(function (line) {
    var head = line.match(/^#{1,3}\s+(.+)$/);
    if (head) return '<div class="agentMdHead">' + agentInline(head[1]) + '</div>';
    var numbered = line.match(/^\s*(\d+)\.\s+(.+)$/);
    if (numbered) return '<div class="agentMdItem num" data-n="' + numbered[1] + '">' + agentInline(numbered[2]) + '</div>';
    var bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) return '<div class="agentMdItem">' + agentInline(bullet[1]) + '</div>';
    if (!line.trim()) return '<div class="agentMdGap"></div>';
    return '<div class="agentMdLine">' + agentInline(line) + '</div>';
  }).join('');
}
function renderAgentTrace(state) {
  state = state || {};
  var events = state.events || [], wrap = $('agentTrace'), box = $('agentTraceList');
  AGENT.trace = events;
  if (!events.length && !state.running) {
    wrap.classList.remove('on'); box.innerHTML = ''; AGENT.traceRenderKey = '';
    $('agentTraceState').textContent = '等待启动'; return;
  }
  wrap.classList.add('on');
  $('agentTraceState').textContent = state.running ? (state.message || '正在执行') :
    (state.stage === 'done' ? '全部完成' : state.stage === 'error' ? '已停止' : (state.message || '等待'));
  var event = events.length ? events[events.length - 1] :
    { status: 'running', message: state.message || '正在准备数据核验', at: '' };
  var key = [event.status || 'running', event.message || '', event.at || ''].join('|');
  if (AGENT.traceRenderKey === key) return;
  AGENT.traceRenderKey = key;
  var status = event.status === 'done' ? '完成' : event.status === 'error' ? '失败' : '执行';
  box.innerHTML = '<div class="agentTraceRow ' + esc(event.status || 'running') + '"><span class="st">' + status +
    '</span><span class="msg">' + esc(event.message || '') + '</span><time>' + agentClock(event.at) + '</time></div>';
}
function renderAgentMessages() {
  var box = $('agentMessages');
  if (!AGENT.items.length && !AGENT.busy) { box.innerHTML = agentWelcome(); return; }
  var html = AGENT.items.map(function (m) {
    var role = m.role === 'user' ? 'user' : 'assistant';
    var who = role === 'user' ? '你' : ('量化专家' + (m.model ? ' · ' + esc(m.model) : ''));
    return '<div class="agentMsg ' + role + '"><div class="agentWho">' + who +
      (agentClock(m.created_at) ? ' · ' + agentClock(m.created_at) : '') + '</div><div class="agentBubble">' +
      agentFormat(m.content || '') + '</div></div>';
  }).join('');
  if (AGENT.busy) html += '<div class="agentTyping"><span>' + esc(AGENT.stage || '正在分析') + '</span><i></i><i></i><i></i></div>';
  box.innerHTML = html || agentWelcome();
  requestAnimationFrame(function () { box.scrollTop = box.scrollHeight; });
}
function agentResearchPoll() {
  return api('/api/agent/research/status', { timeout: 12000 }).then(function (state) {
    renderAgentTrace(state);
    agentSetStage(state.message || '后端正在执行数据核验');
    if (state.running) {
      return new Promise(function (resolve) { setTimeout(resolve, 1200); }).then(agentResearchPoll);
    }
    if (state.stage === 'done' && state.result) return state.result;
    throw new Error(state.error || state.message || '后端研判任务未完成');
  });
}
function agentLoad(force) {
  if (AGENT.loaded && !force) return Promise.resolve();
  return api('/api/agent/history?limit=80', { timeout: 8000 }).then(function (j) {
    AGENT.items = j.items || []; AGENT.loaded = true;
    var li = j.llm || {};
    agentSetStatus(!!li.enabled, li.model, li.enabled ? '' : '模型未配置');
    renderAgentMessages();
  }).catch(function (e) {
    agentSetStatus(false, '', '后端未连接');
    if (!AGENT.items.length) {
      AGENT.items = [{ role: 'assistant', content: '后端未连接，无法调用 DeepSeek。请重新打开量化终端；若仍失败，检查 server/.env 和 8770 端口。' }];
      renderAgentMessages();
    }
    throw e;
  });
}
function agentDockLimits() {
  var minW = Math.min(330, Math.max(280, innerWidth - 34));
  var maxW = innerWidth <= 900 ? Math.max(minW, innerWidth - 34) :
    Math.min(620, Math.max(minW, innerWidth - 680));
  return { min: minW, max: maxW };
}
function agentApplyDockWidth(width) {
  var lim = agentDockLimits();
  var w = clamp(+width || 410, lim.min, lim.max);
  $('agentPanel').style.width = w + 'px';
  document.documentElement.style.setProperty('--agent-dock-w', w + 'px');
  return w;
}
function agentRestoreSize() {
  var width = 410;
  try {
    var s = JSON.parse(localStorage.getItem('qe_agent_size') || 'null');
    if (s && isFinite(+s.w)) width = +s.w;
  } catch (e) { /* 忽略损坏的本地尺寸 */ }
  agentApplyDockWidth(width);
}
function agentSaveSize() {
  if (window.innerWidth <= 620 || !$('agentPanel').classList.contains('open')) return;
  var r = $('agentPanel').getBoundingClientRect();
  try { localStorage.setItem('qe_agent_size', JSON.stringify({ w: Math.round(r.width) })); } catch (e) { /* ignore */ }
}
function agentScheduleLayout() {
  if (AGENT.layoutRaf) cancelAnimationFrame(AGENT.layoutRaf);
  AGENT.layoutRaf = requestAnimationFrame(function () { AGENT.layoutRaf = 0; resizeAllCharts(); });
  clearTimeout(AGENT.layoutTimer);
  AGENT.layoutTimer = setTimeout(resizeAllCharts, 290);
}
function agentOpen(open) {
  if (open) agentRestoreSize();
  $('agentPanel').classList.toggle('open', open);
  document.body.classList.toggle('agent-dock-open', open);
  $('agentFab').classList.toggle('open', open);
  $('agentFab').setAttribute('aria-expanded', open ? 'true' : 'false');
  $('agentFab').setAttribute('aria-label', open ? '收起量化专家对话栏' : '展开量化专家对话栏');
  $('agentFab').title = open ? '收起量化专家对话栏' : '展开量化专家对话栏';
  $('agentPanel').setAttribute('aria-hidden', open ? 'false' : 'true');
  $('agentDockArrow').textContent = open ? '▶' : '◀';
  agentScheduleLayout();
  if (!open) return;
  agentRefreshContext();
  agentLoad(false).catch(function () { /* 状态已在窗口内显示 */ });
  Promise.all([
    api('/api/agent/chat/status', { timeout: 6000 }).catch(function () { return null; }),
    api('/api/agent/research/status', { timeout: 6000 }).catch(function () { return null; })
  ]).then(function (states) {
    var usable = states.filter(function (state) { return state && ((state.events || []).length || state.running); });
    usable.sort(function (a, b) { return String(b.started_at || '').localeCompare(String(a.started_at || '')); });
    if (usable.length) renderAgentTrace(usable[0]);
  });
}
function agentChatPoll() {
  return api('/api/agent/chat/status', { timeout: 12000 }).then(function (state) {
    renderAgentTrace(state);
    agentSetStage(state.message || '后端正在读取数据');
    if (state.running) {
      return new Promise(function (resolve) { setTimeout(resolve, 1050); }).then(agentChatPoll);
    }
    if (state.stage === 'done' && state.result) return state.result;
    throw new Error(state.error || state.message || '量化专家任务未完成');
  });
}
function agentAsk(text) {
  text = String(text || '').trim();
  if (!text || AGENT.busy) return;
  AGENT.busy = true; AGENT.stage = '正在判断需要读取哪些数据'; $('agentSend').disabled = true;
  $('agentInput').value = ''; $('agentInput').style.height = '54px';
  AGENT.items.push({ id: 'pending-user', role: 'user', content: text, created_at: new Date().toISOString() });
  renderAgentMessages(); agentRefreshContext();
  api('/api/agent/chat/start', { method: 'POST', timeout: 15000,
    body: { message: text, context: agentContext() } }).then(function (state) {
      renderAgentTrace(state);
      return agentChatPoll();
    }).then(function (j) {
      AGENT.items = AGENT.items.filter(function (x) { return x.id !== 'pending-user'; });
      AGENT.items = AGENT.items.concat(j.messages || [
        { role: 'user', content: text }, { role: 'assistant', content: j.reply, model: j.model }
      ]);
      agentSetStatus(true, j.model, '');
    }).catch(function (e) {
      AGENT.items = AGENT.items.filter(function (x) { return x.id !== 'pending-user'; });
      AGENT.items.push({ role: 'user', content: text });
      AGENT.items.push({ role: 'assistant', content: '本次回答失败：' + e.message + '\n请检查后端执行记录、模型配置或稍后重试。' });
      agentSetStatus(false, '', e.message.indexOf('429') >= 0 ? '正在回答' : '调用失败');
    }).finally(function () {
      AGENT.busy = false; AGENT.stage = ''; $('agentSend').disabled = false; renderAgentMessages();
    });
}

function agentRunResearch() {
  if (AGENT.busy) return;
  agentOpen(true);
  AGENT.busy = true; AGENT.stage = '正在确认在线行情';
  $('agentSend').disabled = true;
  AGENT.items.push({ id: 'pending-research', role: 'user', content: '请执行一键综合研判', created_at: new Date().toISOString() });
  renderAgentMessages();
  var ensure = D && D.real ? Promise.resolve(true) : doFetch();
  ensure.then(function () {
    if (!D || !D.real) throw new Error('在线真实行情获取失败，已停止研判，避免用模拟数据给出时机判断');
    if (D.c.length < 250) throw new Error('有效历史不足 250 根，无法同时完成因子和样本外检验');
    return agentResearchSnapshotAsync();
  }).then(function (snapshot) {
    agentSetStage('正在启动后端数据核验');
    return api('/api/agent/research/start', { method: 'POST', timeout: 15000, body: { snapshot: snapshot } });
  }).then(function (state) {
    renderAgentTrace(state);
    return agentResearchPoll();
  }).then(function (j) {
    AGENT.items = AGENT.items.filter(function (x) { return x.id !== 'pending-research'; });
    AGENT.items = AGENT.items.concat(j.messages || [
      { role: 'user', content: '请执行一键综合研判' },
      { role: 'assistant', content: j.reply, model: j.model }
    ]);
    AGENT.lastResearch = j.report || null;
    agentSetStatus(true, j.model, '');
    loadMood();
    log('AI 综合研判：' + ((j.report && j.report.action) || '已完成') +
      ' · 置信度 ' + ((j.report && j.report.confidence) || 0) + '/100（不执行交易）', 'sys');
  }).catch(function (e) {
    AGENT.items = AGENT.items.filter(function (x) { return x.id !== 'pending-research'; });
    AGENT.items.push({ role: 'user', content: '请执行一键综合研判' });
    AGENT.items.push({ role: 'assistant', content: '综合研判未完成：' + e.message + '\n系统没有生成入场或清仓结论。' });
    $('agentState').className = 'bad'; $('agentState').textContent = '研判未完成';
  }).finally(function () {
    AGENT.busy = false; AGENT.stage = '';
    $('agentSend').disabled = false; renderAgentMessages();
  });
}

$('agentFab').onclick = function () { agentOpen(!$('agentPanel').classList.contains('open')); };
$('agentClose').onclick = function () { agentOpen(false); };
$('agentMin').onclick = function () { agentOpen(false); };
$('agentForm').onsubmit = function (e) { e.preventDefault(); agentAsk($('agentInput').value); };
$('btnJudge').onclick = agentRunResearch;
$('agentInput').onkeydown = function (e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); agentAsk(this.value); }
};
$('agentInput').oninput = function () {
  this.style.height = '54px'; this.style.height = Math.min(92, this.scrollHeight) + 'px';
};
$('agentClear').onclick = function () {
  if (!confirm('清空保存在本机 SQLite 中的全部 Agent 对话历史？')) return;
  api('/api/agent/history', { method: 'DELETE', timeout: 8000 }).then(function () {
    AGENT.items = []; AGENT.loaded = true; renderAgentMessages();
  }).catch(function (e) { alert('清空失败：' + e.message); });
};
$('agentResize').addEventListener('pointerdown', function (e) {
  if (window.innerWidth <= 620) return;
  var panel = $('agentPanel'), r = panel.getBoundingClientRect();
  var lim = agentDockLimits();
  AGENT.resizing = { x: e.clientX, w: r.width, min: lim.min, max: lim.max };
  document.body.style.cursor = 'ew-resize';
  e.preventDefault(); e.stopPropagation();
});
document.addEventListener('pointermove', function (e) {
  if (AGENT.resizing) {
    var z = AGENT.resizing;
    agentApplyDockWidth(clamp(z.w - (e.clientX - z.x), z.min, z.max));
    e.preventDefault(); return;
  }
});
document.addEventListener('pointerup', function () {
  if (AGENT.resizing) {
    AGENT.resizing = null; document.body.style.cursor = ''; agentSaveSize(); agentScheduleLayout();
  }
});
window.addEventListener('resize', function () {
  requestAnimationFrame(function () { agentRestoreSize(); agentScheduleLayout(); });
});
if (window.ResizeObserver) {
  try {
    new ResizeObserver(function () {
      if (!$('agentPanel').classList.contains('open') || window.innerWidth <= 620 || AGENT.resizing) return;
      clearTimeout(AGENT.sizeTimer);
      AGENT.sizeTimer = setTimeout(agentSaveSize, 180);
    }).observe($('agentPanel'));
  } catch (e) { /* 老浏览器保留默认尺寸 */ }
}
setTimeout(function () {
  agentRefreshContext();
  try {
    if (!localStorage.getItem('qe_agent_seen')) {
      localStorage.setItem('qe_agent_seen', '1'); agentOpen(true);
    }
  } catch (e) { /* 隐私模式下不自动展开 */ }
}, 1400);

/* ---------- 我的持仓 ---------- */
var POS = { rows: [], quotes: {}, editing: null, dcaId: null, dayStamp: '' };

function guessSecidForPos(code, mkt, kind) {
  code = (code || '').trim().toUpperCase();
  if (!code) return '';
  if (mkt && mkt !== 'auto') return mkt === 'OF' ? 'OF.' + code : mkt + '.' + code;
  var hit = kind === '基金'
    ? (DB.byId['OF.' + code] || DB.byId['1.' + code] || DB.byId['0.' + code])
    : (DB.byId['1.' + code] || DB.byId['0.' + code] || DB.byId['105.' + code] ||
       DB.byId['106.' + code] || DB.byId['107.' + code]);
  if (hit) return hit.id;
  if (kind === '股票' && /^[A-Z][A-Z._-]{0,6}$/.test(code)) return guessSecid(code) || ('105.' + code);
  if (/^\d{6}$/.test(code)) {
    if (kind === '基金') return 'OF.' + code;
    return guessSecid(code) || ('1.' + code);
  }
  return code;
}

function fundEntryPoint(secid, wanted, name) {
  var task;
  if (secid.slice(0, 3) === 'OF.') {
    task = fetchOTCNav(secid.slice(3), name, true);
  } else {
    var begin = wanted.replace(/-/g, '');
    var u = 'https://push2his.eastmoney.com/api/qt/stock/kline/get?cb=__CB__&secid=' + secid +
      '&fields1=f1,f2,f3&fields2=f51,f53&klt=101&fqt=0&beg=' + begin +
      '&end=20500101&lmt=20&_=' + Date.now();
    task = jsonp(u, 12000).then(function (r) {
      var rows = r && r.data && r.data.klines;
      if (!rows || !rows.length) throw new Error('买入日期之后没有可用行情');
      var d = { name: r.data.name || name, otc: false, t: [], c: [], rc: [] };
      rows.forEach(function (row) { var p = row.split(','); d.t.push(p[0]); d.c.push(+p[1]); d.rc.push(+p[1]); });
      return d;
    });
  }
  return task.then(function (d) {
    var i = -1;
    for (var k = 0; k < d.t.length; k++) {
      if (d.t[k] >= wanted) { i = k; break; }
    }
    if (i < 0) {
      throw new Error('买入日期晚于最新已公布净值/收盘价（最新 ' + d.t[d.t.length - 1] + '）');
    }
    var prices = d.otc ? d.c : (d.rc && d.rc.length ? d.rc : d.c);
    var price = +prices[i];
    if (!(price > 0)) throw new Error('买入日价格不可用');
    return { date: d.t[i], price: price, name: d.name || name || '', shifted: d.t[i] !== wanted };
  });
}

/* 场内标的的兜底报价：实时快照挂了就用日线最后两根算现价与昨收。
   实测 push2（快照域名）会偶发不可达，而 push2his（日线域名）仍然正常；
   持仓面板是看钱的地方，宁可显示"上一收盘价"也不该整行空着。 */
function quoteFromKline(secid) {
  var u = 'https://push2his.eastmoney.com/api/qt/stock/kline/get?cb=__CB__&secid=' + secid +
    '&fields1=f1,f2,f3&fields2=f51,f53&klt=101&fqt=0&beg=0&end=20500101&lmt=3&_=' + Date.now();
  return jsonp(u, 9000).then(function (r) {
    var k = r && r.data && r.data.klines;
    if (!k || !k.length) throw new Error('无日线数据');
    var last = +k[k.length - 1].split(',')[1];
    var prev = k.length > 1 ? +k[k.length - 2].split(',')[1] : last;
    if (!(last > 0)) throw new Error('日线价格异常');
    return { c: last, prev: prev, chg: prev > 0 ? (last / prev - 1) * 100 : 0,
             name: r.data.name, stale: true, asof: k[k.length - 1].split(',')[0] };
  });
}
/* 场外基金没有盘中报价，用最近两个净值算当日涨跌 */
function quoteForPos(secid) {
  if (secid.slice(0, 3) === 'OF.') {
    return fetchOTCNav(secid.slice(3), '').then(function (d) {
      var n = d.c.length;
      return { c: d.c[n - 1], prev: n > 1 ? d.c[n - 2] : d.c[n - 1],
               chg: n > 1 ? (d.c[n - 1] / d.c[n - 2] - 1) * 100 : 0,
               name: d.name, otc: true, asof: d.t[n - 1] };
    });
  }
  return fetchQuote(secid).catch(function () { return quoteFromKline(secid); });
}

function loadPositions() {
  return api('/api/holdings').then(function (j) {
    POS.rows = j.items || [];
    renderPositions();
    return refreshQuotes();
  });
}
function refreshQuotes() {
  if (!POS.rows.length) { renderPositions(); return Promise.resolve(); }
  $('posSub').textContent = '正在取实时行情…';
  return Promise.all(POS.rows.map(function (h) {
    return quoteForPos(h.secid).then(function (q) { POS.quotes[h.secid] = q; })
      .catch(function (e) { POS.quotes[h.secid] = { err: e.message }; });
  })).then(function () {
    $('posSub').textContent = '行情更新于 ' + new Date().toLocaleTimeString('zh-CN');
    renderPositions();
  });
}
function posMetrics(h) {
  var q = POS.quotes[h.secid] || {};
  if (!(q.c > 0)) return { bad: q.err || '无行情' };
  var mv = q.c * h.shares;
  var cost = h.invested_amount > 0 ? h.invested_amount : h.cost * h.shares;
  var dayPnl = (q.c - (q.prev || q.c)) * h.shares;
  return { price: q.c, mv: mv, cost: cost, pnl: mv - cost,
           pnlPct: cost > 0 ? (mv / cost - 1) * 100 : 0,
           dayPnl: dayPnl, dayPct: q.chg || 0, otc: !!q.otc, stale: !!q.stale,
           asof: q.asof, name: q.name };
}
function renderPositions() {
  var sMv = 0, sCost = 0, sDay = 0, any = false;
  var funds = POS.rows.filter(function (h) { return h.kind !== '股票'; });
  var stocks = POS.rows.filter(function (h) { return h.kind === '股票'; });
  $('posFundCount').textContent = funds.length + ' 只';
  $('posStockCount').textContent = stocks.length + ' 只';
  var sg = function (v, suf) {
    return '<span class="' + (v >= 0 ? 'u' : 'd') + '">' + (v >= 0 ? '+' : '') + fx(v, 2) + (suf || '') + '</span>';
  };
  function baseName(h, m) {
    return esc(h.name || m.name || h.code) + '<span class="dm" style="font-size:9.5px"> ' + h.secid +
      (m.otc ? ' 净值 ' + (m.asof || '') : m.stale ? ' <span style="color:var(--gold)">收盘价 ' + (m.asof || '') + '</span>' : '') + '</span>';
  }
  function addTotals(m) {
    any = true; sMv += m.mv; sCost += m.cost; sDay += m.dayPnl;
  }
  function dcaCell(h) {
    if (!h.dca_enabled) return '<span class="dm">未设置</span><br><button class="mini" data-dca="' + h.id + '">＋ 定投</button>';
    var names = { daily: '每日', weekly: '每周', biweekly: '每两周', monthly: '每月' };
    return '<div class="dcaState"><b style="color:var(--cyan)">' + (names[h.dca_frequency] || '每月') +
      ' ' + fx(h.dca_amount, 0) + '元</b><br>已跟踪 ' + (h.dca_cycles || 0) + ' 期 · 计划 ' +
      fx(h.dca_planned_total || 0, 0) + '元<br>下次 ' + esc(h.dca_next_date || '—') +
      '</div><button class="mini" data-dca="' + h.id + '">设置</button>';
  }
  function rowActions(h) {
    return '<button class="mini" data-edit="' + h.id + '">修改</button> ' +
      '<button class="mini" data-del="' + h.id + '">删除</button>';
  }
  function fundRows(list) {
    if (!list.length) return '<tr><td colspan="11" style="padding:15px;text-align:center;color:#3a4a5a">尚未录入基金</td></tr>';
    return list.map(function (h) {
      var m = posMetrics(h);
      var invested = h.invested_amount > 0 ? h.invested_amount : h.cost * h.shares;
      var entryDate = h.entry_date || '<span class="dm">旧记录未填</span>';
      if (m.bad) {
        return '<tr><td>' + esc(h.name || h.code) + '<span class="dm"> ' + h.secid + '</span></td>' +
          '<td>' + entryDate + '</td><td class="n">' + fx(invested, 2) + '</td><td class="n">' + fx(h.shares, 2) + '</td>' +
          '<td class="n">' + px(h.entry_price || h.cost) + '</td><td colspan="4" style="color:var(--gold);font-size:10px">行情不可用：' + esc(m.bad) + '</td>' +
          '<td>' + dcaCell(h) + '</td><td>' + rowActions(h) + '</td></tr>';
      }
      addTotals(m);
      return '<tr><td>' + baseName(h, m) + '</td><td>' + entryDate + '</td>' +
        '<td class="n">' + fx(invested, 2) + '</td><td class="n">' + fx(h.shares, 2) + '</td>' +
        '<td class="n">' + px(h.entry_price || h.cost) + '</td><td class="n">' + px(m.price) + '</td>' +
        '<td class="n">' + fx(m.mv, 2) + '</td><td class="n">' + sg(m.dayPnl, '') +
        ' <span class="dm">(' + (m.dayPct >= 0 ? '+' : '') + fx(m.dayPct, 2) + '%)</span></td>' +
        '<td class="n">' + sg(m.pnl, '') + ' <span class="dm">(' + (m.pnlPct >= 0 ? '+' : '') + fx(m.pnlPct, 2) + '%)</span></td>' +
        '<td>' + dcaCell(h) + '</td><td>' + rowActions(h) + '</td></tr>';
    }).join('');
  }
  function stockRows(list) {
    if (!list.length) return '<tr><td colspan="9" style="padding:15px;text-align:center;color:#3a4a5a">尚未录入股票</td></tr>';
    return list.map(function (h) {
      var m = posMetrics(h);
      if (m.bad) return '<tr><td>' + esc(h.name || h.code) + '<span class="dm"> ' + h.secid + '</span></td>' +
        '<td class="n">' + fx(h.shares, 0) + '</td><td class="n">' + px(h.cost) + '</td>' +
        '<td colspan="4" style="color:var(--gold);font-size:10px">行情不可用：' + esc(m.bad) + '</td>' +
        '<td>' + dcaCell(h) + '</td><td>' + rowActions(h) + '</td></tr>';
      addTotals(m);
      return '<tr><td>' + baseName(h, m) + '</td><td class="n">' + fx(h.shares, 0) + '</td>' +
        '<td class="n">' + px(h.cost) + '</td><td class="n">' + px(m.price) + '</td>' +
        '<td class="n">' + fx(m.mv, 2) + '</td><td class="n">' + sg(m.dayPnl, '') +
        ' <span class="dm">(' + (m.dayPct >= 0 ? '+' : '') + fx(m.dayPct, 2) + '%)</span></td>' +
        '<td class="n">' + sg(m.pnl, '') + ' <span class="dm">(' + (m.pnlPct >= 0 ? '+' : '') + fx(m.pnlPct, 2) + '%)</span></td>' +
        '<td>' + dcaCell(h) + '</td><td>' + rowActions(h) + '</td></tr>';
    }).join('');
  }
  $('posFundTbl').innerHTML = '<thead><tr><th>基金</th><th>买入日期</th><th>投入金额</th><th>换算份额</th>' +
    '<th>买入净值</th><th>最新净值</th><th>持仓市值</th><th>当日盈亏</th><th>累计盈亏</th><th>定投计划</th><th></th></tr></thead><tbody>' + fundRows(funds) + '</tbody>';
  $('posStockTbl').innerHTML = '<thead><tr><th>股票</th><th>股数</th><th>成本单价</th><th>现价</th>' +
    '<th>持仓市值</th><th>当日盈亏</th><th>累计盈亏</th><th>定投计划</th><th></th></tr></thead><tbody>' + stockRows(stocks) + '</tbody>';
  document.querySelectorAll('#posFundTbl [data-del],#posStockTbl [data-del]').forEach(function (b) {
    b.onclick = function () {
      if (!confirm('确定删除这条持仓？')) return;
      api('/api/holdings/' + b.dataset.del, { method: 'DELETE' })
        .then(function () {
          if (POS.editing === +b.dataset.del) finishPositionEdit(true);
          if (POS.dcaId === +b.dataset.del) closeDcaEditor();
          return loadPositions();
        })
        .catch(function (e) { alert('删除失败：' + e.message); });
    };
  });
  document.querySelectorAll('#posFundTbl [data-edit],#posStockTbl [data-edit]').forEach(function (b) {
    b.onclick = function () { beginPositionEdit(+b.dataset.edit); };
  });
  document.querySelectorAll('#posFundTbl [data-dca],#posStockTbl [data-dca]').forEach(function (b) {
    b.onclick = function () { openDcaEditor(+b.dataset.dca); };
  });
  var setv = function (id, v, pct) {
    var el = $(id);
    el.textContent = (v >= 0 ? '+' : '') + fx(v, 0) + (pct == null ? '' : '　' + (pct >= 0 ? '+' : '') + fx(pct, 2) + '%');
    el.className = 'v ' + (v >= 0 ? 'u' : 'd');
  };
  if (any) {
    $('pmMv').textContent = fx(sMv, 0); $('pmMv').className = 'v';
    $('pmCost').textContent = fx(sCost, 0); $('pmCost').className = 'v';
    setv('pmDay', sDay, sMv - sDay > 0 ? sDay / (sMv - sDay) * 100 : 0);
    setv('pmPnl', sMv - sCost, sCost > 0 ? (sMv / sCost - 1) * 100 : 0);
  } else {
    ['pmMv', 'pmDay', 'pmPnl', 'pmCost'].forEach(function (id) { $(id).textContent = '—'; $(id).className = 'v'; });
  }
}
function openPositions() {
  $('mask5').classList.add('on');
  checkSrv().then(function () {
    srvBadge('srv5'); $('posOffline').style.display = 'none'; $('posMain').style.display = '';
    return loadPositions();
  }).catch(function () {
    srvBadge('srv5');
    $('posOffline').style.display = ''; $('posOffline').innerHTML = OFFLINE_HTML;
    $('posMain').style.display = 'none';
  });
}
$('btnPos').onclick = openPositions;
$('posClose').onclick = function () { $('mask5').classList.remove('on'); };
$('mask5').onclick = function (e) { if (e.target === $('mask5')) $('mask5').classList.remove('on'); };
$('posRefresh').onclick = function () { refreshQuotes(); };
function setPosEntryMode(mode) {
  $('posFundForm').classList.toggle('on', mode === 'fund');
  $('posStockForm').classList.toggle('on', mode === 'stock');
  $('posEntryTabs').querySelectorAll('button').forEach(function (b) {
    b.classList.toggle('on', b.dataset.posMode === mode);
  });
}
function marketFromSecid(secid) {
  var p = (secid || '').split('.')[0];
  return ['OF', '0', '1', '105', '106', '107'].indexOf(p) >= 0 ? p : 'auto';
}
function finishPositionEdit(clearFields) {
  POS.editing = null;
  $('posEditBar').classList.remove('on');
  $('pfFundCode').disabled = $('pfFundMkt').disabled = false;
  $('pfStockCode').disabled = $('pfStockMkt').disabled = false;
  $('pfFundAdd').textContent = '＋ 保存基金持仓';
  $('pfStockAdd').textContent = '＋ 保存股票持仓';
  if (clearFields) {
    ['pfFundCode', 'pfFundAmount', 'pfFundName', 'pfStockCode', 'pfStockShares',
     'pfStockCost', 'pfStockName'].forEach(function (id) { $(id).value = ''; });
  }
}
function beginPositionEdit(id) {
  var h = POS.rows.find(function (x) { return x.id === id; });
  if (!h) return;
  POS.editing = id;
  $('posEditBar').classList.add('on');
  $('posEditText').innerHTML = '正在修改：<b style="color:var(--gold)">' + esc(h.name || h.code) + '</b>　代码锁定，避免误建另一条记录';
  if (h.kind === '股票') {
    setPosEntryMode('stock');
    $('pfStockCode').value = h.code; $('pfStockCode').disabled = true;
    $('pfStockMkt').value = marketFromSecid(h.secid); $('pfStockMkt').disabled = true;
    $('pfStockShares').value = h.shares; $('pfStockCost').value = h.cost;
    $('pfStockName').value = h.name || ''; $('pfStockAdd').textContent = '✓ 保存股票修改';
  } else {
    setPosEntryMode('fund');
    $('pfFundCode').value = h.code; $('pfFundCode').disabled = true;
    $('pfFundMkt').value = marketFromSecid(h.secid); $('pfFundMkt').disabled = true;
    $('pfFundAmount').value = h.invested_amount > 0 ? h.invested_amount : h.cost * h.shares;
    $('pfFundDate').value = h.entry_date || '';
    $('pfFundName').value = h.name || ''; $('pfFundAdd').textContent = '✓ 保存基金修改';
  }
  $('modal5Body').scrollTop = 0;
}
function openDcaEditor(id) {
  var h = POS.rows.find(function (x) { return x.id === id; });
  if (!h) return;
  POS.dcaId = id;
  $('dcaName').textContent = h.name || h.code;
  $('dcaAmount').value = h.dca_amount || '';
  $('dcaFrequency').value = h.dca_frequency || 'monthly';
  $('dcaStart').value = h.dca_start_date || posTodayText;
  $('dcaEditor').classList.add('on');
  $('dcaStop').style.display = h.dca_enabled ? '' : 'none';
  $('dcaEditor').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function closeDcaEditor() {
  POS.dcaId = null; $('dcaEditor').classList.remove('on');
}
$('posEntryTabs').onclick = function (e) {
  var b = e.target.closest('[data-pos-mode]');
  if (b) setPosEntryMode(b.dataset.posMode);
};
var posToday = new Date();
var posTodayText = posToday.getFullYear() + '-' + pad(posToday.getMonth() + 1) + '-' + pad(posToday.getDate());
POS.dayStamp = posTodayText;
$('pfFundDate').max = posTodayText;
$('pfFundDate').value = posTodayText;
setInterval(function () {
  var d = new Date(), day = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  if (day === POS.dayStamp) return;
  POS.dayStamp = posTodayText = day; $('pfFundDate').max = day;
  if ($('mask5').classList.contains('on') && SRV.ok) loadPositions();
}, 3600000);
$('posEditCancel').onclick = function () { finishPositionEdit(true); };
$('dcaCancel').onclick = closeDcaEditor;
$('dcaSave').onclick = function () {
  var id = POS.dcaId, amount = +$('dcaAmount').value, start = $('dcaStart').value;
  if (!id) return;
  if (!(amount > 0)) { alert('每期定投金额必须大于 0'); return; }
  if (!start) { alert('请选择定投开始日期'); return; }
  var b = this;
  busy(b, '保存中…', api('/api/holdings/' + id + '/dca', { method: 'PUT', body: {
    enabled: true, amount: amount, frequency: $('dcaFrequency').value, start_date: start
  }}).then(function () {
    closeDcaEditor(); log('◫ 定投计划已保存，每日自动更新进度（不自动下单）', 'ok'); return loadPositions();
  }).catch(function (e) { alert('定投计划保存失败：' + e.message); }));
};
$('dcaStop').onclick = function () {
  var id = POS.dcaId; if (!id) return;
  var b = this;
  busy(b, '停止中…', api('/api/holdings/' + id + '/dca', { method: 'PUT', body: {
    enabled: false, amount: +$('dcaAmount').value || 0,
    frequency: $('dcaFrequency').value, start_date: $('dcaStart').value
  }}).then(function () { closeDcaEditor(); return loadPositions(); })
    .catch(function (e) { alert('停止失败：' + e.message); }));
};

$('pfFundAdd').onclick = function () {
  var b = this, code = $('pfFundCode').value.trim(), amount = +$('pfFundAmount').value;
  var wanted = $('pfFundDate').value;
  if (!code) { alert('请填写基金代码'); return; }
  if (!(amount > 0)) { alert('投入金额必须大于 0'); return; }
  if (!wanted) { alert('请选择买入日期'); return; }
  if (wanted > posTodayText) { alert('买入日期不能晚于今天'); return; }
  var secid = guessSecidForPos(code, $('pfFundMkt').value, '基金');
  var meta = DB.byId[secid], inputName = $('pfFundName').value.trim() || (meta ? meta.name : '');
  var run = fundEntryPoint(secid, wanted, inputName).then(function (ep) {
    var shares = amount / ep.price;
    return api('/api/holdings', { method: 'POST', body: {
      code: code.toUpperCase(), secid: secid, kind: '基金', name: inputName || ep.name,
      shares: shares, cost: ep.price, invested_amount: amount,
      entry_date: ep.date, entry_price: ep.price, input_mode: 'fund_amount'
    }}).then(function (h) {
      log('◧ 基金持仓已保存：投入 ' + fx(amount, 2) + ' 元 · ' + ep.date + ' 净值 ' + px(ep.price) +
          ' · 换算 ' + fx(shares, 2) + ' 份' + (ep.shifted ? '（非交易日已顺延）' : ''), 'ok');
      finishPositionEdit(true); $('pfFundDate').value = posTodayText;
      return loadPositions();
    });
  }).catch(function (e) { alert('基金保存失败：' + e.message); });
  busy(b, '正在查买入净值…', run);
};

$('pfStockAdd').onclick = function () {
  var code = $('pfStockCode').value.trim();
  var shares = +$('pfStockShares').value, cost = +$('pfStockCost').value;
  if (!code) { alert('请填写股票代码'); return; }
  if (!(shares > 0)) { alert('股数必须大于 0'); return; }
  if (!(cost > 0)) { alert('成本单价必须大于 0'); return; }
  var secid = guessSecidForPos(code, $('pfStockMkt').value, '股票');
  var meta = DB.byId[secid];
  var body = { code: code.toUpperCase(), secid: secid, kind: '股票',
               name: $('pfStockName').value.trim() || (meta ? meta.name : ''),
               shares: shares, cost: cost, invested_amount: shares * cost,
               entry_price: cost, input_mode: 'stock_shares' };
  api('/api/holdings', { method: 'POST', body: body }).then(function (h) {
    log('◧ 股票持仓已保存：' + (h.name || h.code) + ' × ' + fx(h.shares, 0) + ' 股 @ ' + px(h.cost), 'ok');
    finishPositionEdit(true);
    return loadPositions();
  }).catch(function (e) { alert('股票保存失败：' + e.message); });
};

/* ---------- 市场每日情绪 ---------- */
var MOOD = { overview: null, news: [], links: null, fundCatalogReady: false };
function moodTab(sec) {
  ['adv', 'link', 'news'].forEach(function (k) {
    $('sec' + k.charAt(0).toUpperCase() + k.slice(1)).classList.toggle('on', k === sec);
  });
  $('moodTabs').querySelectorAll('button').forEach(function (b) {
    b.classList.toggle('on', b.dataset.sec === sec);
  });
}
$('moodTabs').addEventListener('click', function (e) {
  var b = e.target.closest('button'); if (b) moodTab(b.dataset.sec);
});

function renderOverview(o) {
  MOOD.overview = o;
  var by = o.by_label || {};
  var pos = (by['利好'] || {}).count || 0, neg = (by['利空'] || {}).count || 0,
      neu = (by['中性'] || {}).count || 0, tot = o.total_scored || 0;
  var bar = '';
  if (tot) {
    var seg = function (n, c, t) {
      var pct = n / tot * 100;
      var label = t + n;
      return n ? '<i aria-label="' + label + '，占 ' + pct.toFixed(1) + '%" title="' + label +
        ' 条，占 ' + pct.toFixed(1) + '%" style="width:' + pct.toFixed(1) + '%;background:' + c + '">' +
        (pct >= 7.5 ? label : '') + '</i>' : '';
    };
    bar = '<div id="moodBar">' + seg(pos, '#ff3b47', '利好 ') + seg(neu, '#2c405a', '中性 ') +
          seg(neg, '#12d18a', '利空 ') + '</div>' +
      '<div id="moodLegend">' +
      '<div class="moodLeg"><i style="background:#ff3b47"></i><b>利好 ' + pos + '</b><span>' + (pos / tot * 100).toFixed(1) + '%</span></div>' +
      '<div class="moodLeg"><i style="background:#2c405a"></i><b>中性 ' + neu + '</b><span>' + (neu / tot * 100).toFixed(1) + '%</span></div>' +
      '<div class="moodLeg"><i style="background:#12d18a"></i><b>利空 ' + neg + '</b><span>' + (neg / tot * 100).toFixed(1) + '%</span></div>' +
      '</div>';
  }
  $('moodHead').innerHTML =
    '<b style="color:var(--gold)">' + o.day + ' 情绪总览</b>' + bar +
    esc(o.headline || '') +
    (o.unscored ? '<br><span style="color:var(--gold);font-size:10.5px">还有 ' + o.unscored +
      ' 条尚未阅读，请先回到“① 新闻明细”执行抓取并阅读。</span>' : '');
  var tops = o.top_sectors || [];
  $('moodSectors').innerHTML = tops.length
    ? '<div style="font-size:10.5px;color:var(--dim);margin-bottom:4px">板块情绪热度（利好计正、利空计负，按绝对值排序）</div>' +
      tops.map(function (t) {
        return '<span class="secChip ' + (t.score >= 0 ? 'u' : 'd') + '">' + esc(t.sector) +
          ' ' + (t.score >= 0 ? '+' : '') + t.score + ' <span style="color:var(--dim2)">(' + t.count + '条)</span></span>';
      }).join('')
    : '<div style="font-size:10.5px;color:var(--dim2)">还没有板块标注数据。</div>';
}
function renderNews(items) {
  MOOD.news = items;
  var read = items.filter(function (n) { return !!n.label; }).length;
  $('newsReadState').textContent = items.length ? '今日新闻 ' + items.length + ' 条 · 模型已阅读 ' + read + ' 条 · 待阅读 ' + (items.length - read) + ' 条' : '';
  if (!items.length) { $('newsBox').innerHTML = '<div style="padding:18px;color:#3a4a5a">当日还没有新闻，先点“⟳ 抓取并阅读”。</div>'; return; }
  $('newsBox').innerHTML = items.map(function (n) {
    var lab = n.label ? '<span class="lab ' + (n.label === '利好' ? 'u' : n.label === '利空' ? 'd' : '') + '">' +
      n.label + ' ' + fx((n.confidence || 0) * 100, 0) + '</span>' : '<span class="lab">未打分</span>';
    var sectors = (n.sectors || []).slice(0, 3);
    var symbols = (n.symbols || []).slice(0, 5);
    var impact = n.label ? (n.label + ' · 影响把握 ' + fx((n.confidence || 0) * 100, 0) + '%') : '等待模型阅读';
    return '<div class="nrow">' + lab +
      (n.url ? '<a class="t" href="' + esc(n.url) + '" target="_blank" rel="noopener">' + esc(n.title) + '</a>'
             : '<span class="t">' + esc(n.title) + '</span>') +
      '<div class="impact"><b>股市影响：' + esc(impact) + '</b>' +
      (sectors.length ? sectors.map(function (s) { return '<span class="sectorTag">板块 · ' + esc(s) + '</span>'; }).join('') : '<span class="sectorTag">板块 · 待归类</span>') +
      (symbols.length ? '<span class="dm">关联标的 ' + esc(symbols.join(' / ')) + '</span>' : '') + '</div>' +
      '<div class="meta">' + esc(n.source) + ' · ' + esc((n.published_at || '').replace('T', ' ').slice(0, 16)) +
      (n.reason ? ' · 判断依据：' + esc(n.reason) : '') + '</div></div>';
  }).join('');
}
function renderAdvice(a) {
  if (!a || !a.exists && !a.items) {
    $('advBox').innerHTML = '<div style="padding:18px;color:#3a4a5a">当日还没有生成建议。请先完成新闻阅读与今日总览。</div>';
    return;
  }
  var head = '<div class="adviceHead"><b style="color:var(--gold)">' + a.day + ' 今日操作建议（参考）</b><br>' +
    esc(a.market_summary || '') + (a.risk_note ? '<br><span style="color:var(--gold)">风险提示：' + esc(a.risk_note) + '</span>' : '') +
    '<br><span style="color:var(--dim2);font-size:10px">依据当日 ' + (a.news_used || 0) + ' 条新闻' +
    (a.model ? ' · 模型 ' + esc(a.model) : '') + '</span></div>';
  var cards = (a.items || []).map(function (it) {
    var ev = (it.evidence || []).map(function (e) {
      return '<div>· <span class="lab ' + (e.label === '利好' ? 'u' : e.label === '利空' ? 'd' : '') + '">' + esc(e.label) + '</span>' +
        (e.url ? '<a href="' + esc(e.url) + '" target="_blank" rel="noopener">' + esc(e.title) + '</a>'
               : esc(e.title)) + ' <span style="color:var(--dim2)">— ' + esc(e.source) + '</span></div>';
    }).join('') || '<div style="color:var(--dim2)">当日没有找到直接相关的新闻依据。</div>';
    return '<div class="advCard ' + esc(it.action) + '"><div class="ah"><b>' + esc(it.name) + '</b>' +
      '<span class="act">' + esc(it.action) + '</span>' +
      '<span class="dm" style="font-size:10px;color:var(--dim2)">把握 ' + fx((it.confidence || 0) * 100, 0) + '%' +
      ' · ' + esc(it.kind) + ' · ' + esc(it.secid) + '</span></div>' +
      '<div class="why">' + esc(it.rationale || '') + '</div>' +
      '<div class="ev">' + ev + '</div></div>';
  }).join('');
  $('advBox').innerHTML = head + cards +
    '<div style="margin-top:8px;padding:7px 10px;border:1px solid var(--up-d);border-left:3px solid var(--up);' +
    'background:rgba(255,59,71,.06);border-radius:3px;font-size:10.5px;line-height:1.8;color:var(--txt)">' +
    esc(a.disclaimer || '') + '</div>';
}

function registerFundCatalog() {
  if (MOOD.fundCatalogReady) return api('/api/fund-holdings/status');
  var funds = (DB.byCat['场内基金'] || []).map(function (x) {
    return { code: x.code, name: x.name, secid: x.id,
             is_etf: /ETF/i.test(x.name || ''), is_held: false };
  });
  $('linkStatus').textContent = '正在登记 ' + funds.length + ' 只场内基金目录（只写本机 SQLite，不进行网络抓取）…';
  return api('/api/fund-holdings/register', { method: 'POST', timeout: 60000, body: { funds: funds } })
    .then(function (j) { MOOD.fundCatalogReady = true; return j.stats || {}; });
}
function renderLinkStatus(s, prefix) {
  s = s || {};
  var last = s.last_sync_at ? s.last_sync_at.replace('T', ' ').slice(0, 19) : '尚未同步';
  $('linkStatus').innerHTML = (prefix ? '<span>' + esc(prefix) + '</span>' : '') +
    '<span>基金目录 <b>' + (s.profiles || 0) + '</b></span>' +
    '<span>场内 ETF <b>' + (s.etfs || 0) + '</b></span>' +
    '<span>已同步基金 <b>' + (s.synced || 0) + '</b></span>' +
    '<span>重仓记录 <b>' + (s.holding_rows || 0) + '</b></span>' +
    '<span>最近更新 ' + esc(last) + '</span>';
}
function linkStockName(s) {
  if (s.stock_name && s.stock_name !== s.stock_code) return s.stock_name;
  var code = s.stock_code || '', prefixes = ['1.', '0.', '105.', '106.', '107.'];
  for (var i = 0; i < prefixes.length; i++) {
    var hit = DB.byId[prefixes[i] + code];
    if (hit && hit.cat === (i < 2 ? '股票' : '美股')) return hit.name;
  }
  return code;
}
function renderLinks(data) {
  MOOD.links = data;
  renderLinkStatus(data.fund_data || {}, '今日涉及 ' + (data.major_count || 0) + ' 只股票 · 关联 ' +
    (data.linked_fund_count || 0) + ' 只基金');
  $('linkNotice').innerHTML = '<b>数据滞后提醒：</b>' + esc(data.data_lag || '') + '<br>' + esc(data.notice || '');
  var stocks = data.stocks || [];
  if (!stocks.length) {
    $('linkBox').innerHTML = '<div class="linkEmpty">今日已阅读新闻中，尚未识别出置信度不低于 55% 的具体利好股票。' +
      '<br>先到“① 新闻与总览”执行抓取并阅读；已有旧标注只有股票代码时也会正常参与反查。</div>';
    return;
  }
  $('linkBox').innerHTML = stocks.map(function (s, idx) {
    var stockName = linkStockName(s);
    return '<div class="linkStock" data-link-row="' + idx + '"><button class="linkHead" data-link-open="' + idx + '">' +
      '<span class="arr">›</span><span class="stock"><b>' + esc(stockName) + '</b><small>' + esc(s.stock_code) + '</small></span>' +
      '<span class="sectors">' + esc((s.sectors || []).join(' · ') || '未归类') + '</span>' +
      '<span class="metric confidence">把握 ' + fx((s.max_confidence || 0) * 100, 0) + '%</span>' +
      '<span class="metric">新闻 ' + (s.news_count || 0) + ' · 基金 ' + (s.funds || []).length + '</span></button>' +
      '<div class="linkDetail"></div></div>';
  }).join('');
  $('linkBox').querySelectorAll('[data-link-open]').forEach(function (button) {
    button.onclick = function () {
      var row = $('linkBox').querySelector('[data-link-row="' + button.dataset.linkOpen + '"]');
      if (!row) return;
      if (!row.dataset.rendered) {
        var s = stocks[+button.dataset.linkOpen];
        var stockName = linkStockName(s);
        var news = (s.news || []).map(function (n) {
          var title = n.url ? '<a href="' + esc(n.url) + '" target="_blank" rel="noopener">' + esc(n.title) + '</a>' : esc(n.title);
          return '<div><span class="lab u">利好 ' + fx((n.confidence || 0) * 100, 0) + '%</span>' + title +
            ' <span class="dm">· ' + esc(n.source) + ' · ' + esc((n.published_at || '').replace('T', ' ').slice(0, 16)) +
            (n.reason ? ' · ' + esc(n.reason) : '') + '</span></div>';
        }).join('');
        var funds = (s.funds || []).map(function (f) {
          var sourceRows = (f.sources && f.sources.length) ? f.sources : [{ source: f.source, source_url: f.source_url }];
          var source = sourceRows.map(function (src) {
            return src.source_url ? '<a href="' + esc(src.source_url) + '" target="_blank" rel="noopener">' + esc(src.source) + '</a>' : esc(src.source);
          }).join(' / ');
          return '<tr><td><b>' + esc(f.fund_name) + '</b><span class="dm"> ' + esc(f.fund_code) + '</span>' +
            (f.is_held ? '<span class="held">我的持仓</span>' : '') + '</td><td class="wt">' + fx(f.weight, 2) +
            '%</td><td>' + esc(f.report_date) + '</td><td>' + source + '</td><td class="dm">' + esc(f.reason) + '</td></tr>';
        }).join('');
        if (!funds) funds = '<tr><td colspan="5" class="dm" style="padding:10px">当前已同步基金中未查到该股票的十大重仓记录。可继续点“更新基金持仓”扩大场内 ETF 覆盖。</td></tr>';
        row.querySelector('.linkDetail').innerHTML = '<div class="linkPath"><b>新闻</b> → ' + esc(stockName) +
          '（' + esc(s.stock_code) + '）→ 披露重仓基金</div><div class="linkNews">' + news + '</div>' +
          '<table class="linkFunds"><thead><tr><th>基金</th><th>占基金净值</th><th>报告期</th><th>来源</th><th>关联说明</th></tr></thead><tbody>' +
          funds + '</tbody></table>';
        row.dataset.rendered = '1';
      }
      row.classList.toggle('on');
    };
  });
}
function loadLinks() {
  return api('/api/news-links?limit=500', { timeout: 30000 }).then(renderLinks).catch(function (e) {
    $('linkBox').innerHTML = '<div class="linkEmpty" style="color:var(--gold)">新闻关联获取失败：' + esc(e.message) + '</div>';
    throw e;
  });
}
function prepareLinks() {
  return registerFundCatalog().then(function (stats) {
    renderLinkStatus(stats, '基金目录已登记');
    return loadLinks().then(function () {
      var needHeld = (stats.held || 0) > (stats.held_synced || 0);
      var needFirst = (stats.profiles || 0) > (stats.held || 0) &&
        (stats.synced || 0) <= (stats.held_synced || 0);
      if (!needHeld && !needFirst) return;
      $('linkStatus').textContent = needHeld ? '首次同步“我的持仓”基金十大重仓…' : '首次同步一批场内 ETF 十大重仓…';
      return api('/api/fund-holdings/sync?limit=' + (needHeld ? 20 : 30) + '&held_only=' + (needHeld ? 'true' : 'false'),
        { method: 'POST', timeout: 300000 }).then(function (j) {
          renderLinkStatus(j.stats, '首次同步完成 ' + j.succeeded + '/' + j.requested + ' 只');
          return loadLinks();
        });
    });
  }).catch(function (e) {
    $('linkStatus').innerHTML = '<span style="color:var(--gold)">基金目录/持仓同步失败：' + esc(e.message) + '</span>';
  });
}
function loadMood() {
  var day = SRV.info ? SRV.info.today : '';
  $('moodSub').textContent = day;
  return Promise.all([
    api('/api/sentiment/overview').then(renderOverview).catch(function (e) {
      $('moodHead').textContent = '情绪总览获取失败：' + e.message;
    }),
    api('/api/news?limit=500').then(function (j) { renderNews(j.items || []); }).catch(function (e) {
      $('newsBox').textContent = '新闻列表获取失败：' + e.message;
    }),
    api('/api/advice').then(renderAdvice).catch(function () { renderAdvice(null); }),
    prepareLinks()
  ]);
}
function openMood() {
  $('mask6').classList.add('on');
  moodTab('link');
  checkSrv().then(function () {
    srvBadge('srv6'); $('moodOffline').style.display = 'none'; $('moodMain').style.display = '';
    return loadMood();
  }).catch(function () {
    srvBadge('srv6');
    $('moodOffline').style.display = ''; $('moodOffline').innerHTML = OFFLINE_HTML;
    $('moodMain').style.display = 'none';
  });
}
$('btnMood').onclick = openMood;
$('moodClose').onclick = function () { $('mask6').classList.remove('on'); };
$('mask6').onclick = function (e) { if (e.target === $('mask6')) $('mask6').classList.remove('on'); };

$('linkRefresh').onclick = function () {
  var b = this;
  busy(b, '刷新中…', loadLinks().catch(function (e) { alert('关联刷新失败：' + e.message); }));
};
$('linkSync').onclick = function () {
  var b = this;
  var run = registerFundCatalog().then(function () {
    $('linkStatus').textContent = '正在分批更新：优先“我的持仓”，随后扩展场内 ETF 覆盖…';
    return api('/api/fund-holdings/sync?limit=60', { method: 'POST', timeout: 300000 });
  }).then(function (j) {
    renderLinkStatus(j.stats, '本批成功 ' + j.succeeded + '/' + j.requested + ' 只 · 新写入 ' + j.rows_saved + ' 行');
    if (j.failed) log('基金持仓同步：' + j.failed + ' 只来源暂不可用，可稍后重试', 'sys');
    return loadLinks();
  }).catch(function (e) { alert('基金持仓更新失败：' + e.message); });
  busy(b, '更新中…', run);
};

function busy(btn, txt, p) {
  var old = btn.textContent; btn.disabled = true; btn.textContent = txt;
  return p.finally(function () { btn.disabled = false; btn.textContent = old; });
}
$('moodRead').onclick = function () {
  var b = this;
  $('newsReadState').textContent = '正在抓取新闻并由模型分批阅读。已读过的新闻会自动跳过，请勿重复点击…';
  function poll() {
    return api('/api/news/read/status', { timeout: 5000 }).then(function (s) {
      if (s.running) {
        var pct = s.total_batches ? Math.round(s.completed_batches / s.total_batches * 100) : 0;
        $('newsReadState').textContent = s.stage === 'crawling' ? '正在抓取各来源新闻…'
          : '模型阅读进度：' + s.completed_batches + ' / ' + s.total_batches + ' 批（' + pct + '%）· 已标注 ' + s.scored + ' 条';
        return new Promise(function (resolve) { setTimeout(resolve, 1800); }).then(poll);
      }
      if (s.stage === 'error') throw new Error(s.message || '新闻阅读失败');
      return s.result || { crawl: {}, scored: s.scored || 0, batches: s.total_batches || 0, errors: s.errors || [] };
    });
  }
  var runRead = api('/api/news/read/start?limit=500', { method: 'POST', timeout: 30000 }).then(poll).then(function (j) {
    var c = j.crawl || {}, fail = Object.keys(c.per_source || {}).filter(function (k) { return c.per_source[k].error; });
    log('⟳ 新闻阅读完成：抓取 ' + (c.fetched || 0) + ' 条，模型新阅读 ' + (j.scored || 0) +
        ' 条，共 ' + (j.batches || 0) + ' 批' + (fail.length ? '；失败源 ' + fail.join('、') : ''), 'ok');
    if (j.errors && j.errors.length) log('◎ 部分批次失败：' + j.errors[0], 'err');
    return loadMood().then(function () { moodTab('news'); });
  }).catch(function (e) { $('newsReadState').textContent = '阅读失败：' + e.message; alert('抓取并阅读失败：' + e.message); });
  busy(b, '模型阅读中…', runRead);
};
$('moodOverview').onclick = function () {
  var b = this;
  busy(b, '汇总中…', api('/api/sentiment/overview').then(function (o) {
    renderOverview(o);
    moodTab('news');
  }).catch(function (e) { alert('总览刷新失败：' + e.message); }));
};
$('moodAdvise').onclick = function () {
  var b = this;
  var run = (POS.rows.length ? Promise.resolve() : loadPositions()).then(function () {
    if (!MOOD.overview || !MOOD.overview.total_scored) throw new Error('请先到“① 新闻与总览”执行抓取并阅读');
    // 把带实时行情的持仓一起送上去，模型才能看到浮盈浮亏
    var enriched = POS.rows.map(function (h) {
      var m = posMetrics(h);
      return { secid: h.secid, code: h.code, name: h.name, kind: h.kind,
               market_value: m.bad ? null : m.mv, day_pct: m.bad ? null : m.dayPct,
               pnl_pct: m.bad ? null : m.pnlPct };
    });
    return api('/api/advice/generate', { method: 'POST', timeout: 300000,
      body: { holdings: enriched.length ? enriched : undefined } });
  }).then(function (a) {
    a.exists = true; renderAdvice(a); moodTab('adv');
    log('✦ 今日建议已生成（' + (a.items || []).length + ' 只持仓，依据 ' + a.news_used + ' 条新闻）·仅供参考', 'ok');
  }).catch(function (e) { alert('生成失败：' + e.message); });
  busy(b, '生成中…', run);
};

/* ---------- 纯模拟盘 / 我的财富 ---------- */
var PAPER = { accounts: [], current: null, chart: null };
function simTab(sec) {
  ['paper', 'wealth', 'live'].forEach(function (k) {
    $('sim' + k.charAt(0).toUpperCase() + k.slice(1)).classList.toggle('on', k === sec);
  });
  $('simTabs').querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.simSec === sec); });
  if (sec === 'wealth' && SRV.ok) loadWealth(true);
  if (sec === 'live' && SRV.ok) loadLiveData();
}
$('simTabs').onclick = function (e) {
  var b = e.target.closest('[data-sim-sec]'); if (b) simTab(b.dataset.simSec);
};
function paperMoney(v) { return '¥' + fx(+v || 0, 2); }
function paperPct(v) { return ((+v || 0) >= 0 ? '+' : '') + fx((+v || 0) * 100, 2) + '%'; }
function paperStatus(s) {
  return ({ pending: '待确认', executed: '已模拟成交', rejected: '已拒绝', superseded: '已被新信号替代', skipped: '已跳过' })[s] || s;
}
function loadPaperAccounts(selectId) {
  return api('/api/paper/accounts').then(function (j) {
    PAPER.accounts = j.items || [];
    var sel = $('paperAccount');
    sel.innerHTML = PAPER.accounts.map(function (a) {
      return '<option value="' + a.id + '">' + esc(a.name) + ' · ' + paperMoney(a.total_asset) + '</option>';
    }).join('');
    if (!PAPER.accounts.length) {
      PAPER.current = null; $('paperEmpty').style.display = ''; $('paperContent').style.display = 'none';
      $('paperCreate').classList.add('on'); $('paperArchive').disabled = true; return null;
    }
    $('paperEmpty').style.display = 'none'; $('paperContent').style.display = ''; $('paperArchive').disabled = false;
    var id = selectId || (PAPER.current && PAPER.current.id) || PAPER.accounts[0].id;
    if (!PAPER.accounts.some(function (a) { return a.id === +id; })) id = PAPER.accounts[0].id;
    sel.value = id;
    return loadPaperDetail(+id);
  });
}
function loadPaperDetail(id) {
  return api('/api/paper/accounts/' + id).then(function (d) { PAPER.current = d; renderPaper(d); return d; });
}
function renderPaper(d) {
  var market = (d.positions || []).reduce(function (s, p) { return s + (+p.market_value || 0); }, 0);
  var pending = (d.proposals || []).filter(function (p) { return p.status === 'pending'; }).length;
  $('pkAsset').textContent = paperMoney((+d.cash || 0) + market); $('pkCash').textContent = paperMoney(d.cash);
  $('pkMarket').textContent = paperMoney(market); $('pkPositions').textContent = (d.positions || []).length + ' 只';
  $('pkPending').textContent = pending + ' 笔';
  $('paperModeTag').textContent = d.mode === 'auto' ? '模拟自动模式 · 假钱' : '安全确认模式';
  $('paperModeTag').style.color = d.mode === 'auto' ? 'var(--up)' : 'var(--gold)';
  $('paperWatchInput').value = (d.watchlist || []).map(function (x) { return x.code; }).join(', ');
  $('paperWatchTags').innerHTML = (d.watchlist || []).length ? (d.watchlist || []).map(function (x) {
    return '<span class="secChip cy">' + esc(x.name) + ' ' + esc(x.code) + '</span>';
  }).join('') : '观察池为空';
  var r = d.rules || {};
  $('prMode').value = d.mode || 'safe'; $('prNews').value = r.news_threshold;
  $('prFactor').value = fx((r.factor_top_pct || 0) * 100, 0); $('prTrend').value = r.trend_min;
  $('prComposite').value = r.composite_min; $('prMaxPos').value = r.max_positions;
  $('prSingle').value = fx((r.max_single_pct || 0) * 100, 0); $('prTotal').value = fx((r.max_total_pct || 0) * 100, 0);
  $('prComm').value = fx((r.commission_rate || 0) * 10000, 2); $('prSlip').value = fx((r.slippage_rate || 0) * 10000, 2);
  $('prStamp').value = fx((r.stamp_tax_rate || 0) * 10000, 2); $('prMinComm').value = r.commission_min;
  $('prStop').value = fx((r.stop_loss_pct || 0) * 100, 1); $('prTrailOn').value = fx((r.trail_activate_pct || 0) * 100, 1);
  $('prTrailBack').value = fx((r.trail_drawdown_pct || 0) * 100, 1);
  renderPaperProposals(d.proposals || [], d.signal_day);
  renderPaperSignals(d.signals || [], d.signal_day);
  renderPaperPositions(d.positions || []);
  renderPaperTrades(d.trades || []);
}
function renderPaperProposals(rows, signalDay) {
  rows = rows.filter(function (x) { return x.status === 'pending' || !signalDay || x.signal_day === signalDay; }).slice(0, 30);
  if (!rows.length) { $('paperProposals').innerHTML = '<div class="simEmpty">当前没有拟交易。生成信号后，安全模式会在这里等待人工确认。</div>'; return; }
  $('paperProposals').innerHTML = '<table class="simTable"><thead><tr><th></th><th>方向</th><th>标的</th><th>数量</th><th>参考价</th>' +
    '<th>综合/新闻/趋势</th><th>因子排名</th><th>状态</th><th>依据</th></tr></thead><tbody>' + rows.map(function (p) {
      var why = (p.reasons || []).slice(0, 3).join('；');
      return '<tr><td>' + (p.status === 'pending' ? '<input type="checkbox" data-paper-proposal="' + p.id + '" checked>' : '') + '</td>' +
        '<td class="' + p.side + '">' + (p.side === 'buy' ? '拟买入' : '拟卖出') + '</td><td><b>' + esc(p.name) + '</b> <span class="dm">' + esc(p.code) + '</span></td>' +
        '<td class="n">' + fx(p.shares, 0) + '</td><td class="n">' + px(p.reference_price) + '<br><span class="dm">' + esc(p.reference_day) + '</span></td>' +
        '<td class="n">' + fx(p.composite_score, 1) + ' / ' + fx(p.news_score, 2) + ' / ' + fx(p.trend_score, 1) + '</td>' +
        '<td class="n">前 ' + fx(p.factor_percentile * 100, 1) + '%</td><td class="' + p.status + '">' + paperStatus(p.status) + '</td>' +
        '<td class="why">' + esc(why) + (p.status_message ? '<br>' + esc(p.status_message) : '') + '</td></tr>';
    }).join('') + '</tbody></table>';
}
function renderPaperSignals(rows, day) {
  $('paperSignalState').textContent = day ? day + ' · ' + rows.length + ' 个标的' : '尚未生成';
  if (!rows.length) { $('paperSignals').innerHTML = '<div class="simEmpty">暂无复合信号。</div>'; return; }
  $('paperSignals').innerHTML = '<table class="simTable"><thead><tr><th>标的</th><th>决定</th><th>综合</th><th>新闻</th><th>因子分位</th><th>趋势</th><th>参考日/价格</th></tr></thead><tbody>' +
    rows.slice(0, 50).map(function (s) {
      return '<tr><td><b>' + esc(s.name) + '</b> <span class="dm">' + esc(s.code) + '</span></td><td class="' +
        (s.decision === '拟买入' ? 'buy' : s.decision === '拟卖出' ? 'sell' : '') + '">' + esc(s.decision) + '</td>' +
        '<td class="n">' + fx(s.composite_score, 1) + '</td><td class="n">' + (s.news_score >= 0 ? '+' : '') + fx(s.news_score, 2) + '</td>' +
        '<td class="n">前 ' + fx(s.factor_percentile * 100, 1) + '%</td><td class="n">' + fx(s.trend_score, 1) + '</td>' +
        '<td class="n">' + esc(s.reference_day) + ' · ' + px(s.reference_price) + '</td></tr>';
    }).join('') + '</tbody></table>';
}
function renderPaperPositions(rows) {
  if (!rows.length) { $('paperPositions').innerHTML = '<div class="simEmpty">尚无虚拟持仓。</div>'; return; }
  $('paperPositions').innerHTML = '<table class="simTable"><thead><tr><th>标的</th><th>总数量</th><th>T+1可用</th><th>成本</th><th>参考价</th><th>市值</th><th>模拟浮盈亏</th></tr></thead><tbody>' +
    rows.map(function (p) { var pnl = +p.unrealized_pnl || 0; return '<tr><td><b>' + esc(p.name) + '</b> <span class="dm">' + esc(p.code) + '</span></td>' +
      '<td class="n">' + fx(p.shares, 0) + '</td><td class="n">' + fx(p.available_shares, 0) + '</td><td class="n">' + px(p.avg_cost) + '</td>' +
      '<td class="n">' + px(p.last_price) + '</td><td class="n">' + paperMoney(p.market_value) + '</td><td class="n ' + (pnl >= 0 ? 'buy' : 'sell') + '">' +
      (pnl >= 0 ? '+' : '') + fx(pnl, 2) + '</td></tr>'; }).join('') + '</tbody></table>';
}
function renderPaperTrades(rows) {
  if (!rows.length) { $('paperTrades').innerHTML = '<div class="simEmpty">尚无模拟成交。</div>'; return; }
  $('paperTrades').innerHTML = '<table class="simTable"><thead><tr><th>日期</th><th>方向</th><th>标的</th><th>数量</th><th>模拟成交价</th>' +
    '<th>佣金</th><th>滑点成本</th><th>印花税</th><th>总摩擦</th><th>已实现盈亏</th></tr></thead><tbody>' + rows.map(function (t) {
      return '<tr><td>' + esc(t.trade_day) + '</td><td class="' + t.side + '">' + (t.side === 'buy' ? '买入' : '卖出') + '</td>' +
        '<td><b>' + esc(t.name) + '</b> <span class="dm">' + esc(t.code) + '</span></td><td class="n">' + fx(t.shares, 0) + '</td>' +
        '<td class="n">' + px(t.price) + '</td><td class="n">' + fx(t.commission, 2) + '</td><td class="n">' + fx(t.slippage_cost, 2) + '</td>' +
        '<td class="n">' + fx(t.stamp_tax, 2) + '</td><td class="n">' + fx(t.total_fee, 2) + '</td><td class="n ' + (t.realized_pnl >= 0 ? 'buy' : 'sell') + '">' +
        (t.realized_pnl >= 0 ? '+' : '') + fx(t.realized_pnl, 2) + '</td></tr>';
    }).join('') + '</tbody></table>';
}
function ruleBody() {
  return { news_threshold: +$('prNews').value, factor_top_pct: +$('prFactor').value / 100,
    trend_min: +$('prTrend').value, composite_min: +$('prComposite').value,
    max_positions: +$('prMaxPos').value, max_single_pct: +$('prSingle').value / 100,
    max_total_pct: +$('prTotal').value / 100, commission_rate: +$('prComm').value / 10000,
    slippage_rate: +$('prSlip').value / 10000, stamp_tax_rate: +$('prStamp').value / 10000,
    commission_min: +$('prMinComm').value, stop_loss_pct: +$('prStop').value / 100,
    trail_activate_pct: +$('prTrailOn').value / 100, trail_drawdown_pct: +$('prTrailBack').value / 100 };
}
function selectedPaperProposals() {
  return Array.prototype.map.call(document.querySelectorAll('[data-paper-proposal]:checked'), function (x) { return +x.dataset.paperProposal; });
}
function openSim(sec) {
  $('mask7').classList.add('on'); simTab(sec || 'paper');
  checkSrv().then(function () {
    srvBadge('srv7'); $('simOffline').style.display = 'none'; $('simMain').style.display = '';
    return loadPaperAccounts().then(function () {
      if (sec === 'wealth') return loadWealth(true);
      if (sec === 'live') return loadLiveData();
    });
  }).catch(function () {
    srvBadge('srv7'); $('simOffline').style.display = ''; $('simOffline').innerHTML = OFFLINE_HTML; $('simMain').style.display = 'none';
  });
}
$('btnPaper').onclick = function () { openSim('paper'); };
$('btnWealth').onclick = function () { openSim('wealth'); };
$('btnLiveRead').onclick = function () { openSim('live'); };
$('simClose').onclick = function () { $('mask7').classList.remove('on'); };
$('mask7').onclick = function (e) { if (e.target === $('mask7')) $('mask7').classList.remove('on'); };
$('paperAccount').onchange = function () { loadPaperDetail(+this.value); };
$('paperNew').onclick = function () { $('paperCreate').classList.toggle('on'); };
$('paperCreateSave').onclick = function () {
  var mode = $('paperNewMode').value, cash = +$('paperNewCash').value;
  if (!(cash >= 1000)) { alert('初始假想资金至少 1000 元'); return; }
  if (mode === 'auto' && !confirm('确认启用“模拟自动模式”？它只使用假钱，但会自动写入模拟成交记录。')) return;
  var b = this, run = api('/api/paper/accounts', { method: 'POST', body: {
    name: $('paperNewName').value.trim() || '模拟账户', initial_cash: cash, mode: mode
  }}).then(function (a) { $('paperCreate').classList.remove('on'); return loadPaperAccounts(a.id); })
    .catch(function (e) { alert('创建失败：' + e.message); });
  busy(b, '创建中…', run);
};
$('paperRefresh').onclick = function () {
  if (!PAPER.current) return; var b = this;
  busy(b, '更新中…', api('/api/paper/accounts/' + PAPER.current.id + '/refresh', { method: 'POST', timeout: 120000 })
    .then(function () { return loadPaperAccounts(PAPER.current.id); }).catch(function (e) { alert('更新失败：' + e.message); }));
};
$('paperArchive').onclick = function () {
  if (!PAPER.current || !confirm('归档虚拟账户“' + PAPER.current.name + '”？历史模拟成交仍保留在 SQLite。')) return;
  api('/api/paper/accounts/' + PAPER.current.id, { method: 'DELETE' }).then(function () { PAPER.current = null; return loadPaperAccounts(); })
    .catch(function (e) { alert('归档失败：' + e.message); });
};
$('paperWatchSave').onclick = function () {
  if (!PAPER.current) return;
  var codes = $('paperWatchInput').value.toUpperCase().split(/[，,\s]+/).filter(Boolean), items = [], bad = [];
  codes.forEach(function (code) {
    var hit = DB.byId['1.' + code] || DB.byId['0.' + code];
    if (!hit || (hit.cat !== '股票' && hit.cat !== '场内基金')) { bad.push(code); return; }
    items.push({ secid: hit.id, code: hit.code, name: hit.name, kind: hit.cat === '场内基金' ? 'ETF' : '股票' });
  });
  if (!items.length) { alert('没有识别到 A 股或场内 ETF 代码'); return; }
  var b = this;
  busy(b, '保存中…', api('/api/paper/accounts/' + PAPER.current.id + '/watchlist', { method: 'PUT', body: { items: items } })
    .then(function (d) { renderPaper(d); if (bad.length) alert('以下代码未加入：' + bad.join('、')); })
    .catch(function (e) { alert('观察池保存失败：' + e.message); }));
};
$('paperRuleSave').onclick = function () {
  if (!PAPER.current) return; var mode = $('prMode').value;
  if (mode === 'auto' && PAPER.current.mode !== 'auto' && !confirm('模拟自动模式会跳过人工确认，但仍然只使用假钱。确认启用？')) return;
  var b = this;
  busy(b, '保存中…', api('/api/paper/accounts/' + PAPER.current.id, { method: 'PUT', body: { mode: mode, rules: ruleBody() } })
    .then(function (d) { PAPER.current = d; renderPaper(d); log('▣ 模拟盘规则已保存（非真实资金）', 'ok'); })
    .catch(function (e) { alert('规则保存失败：' + e.message); }));
};
$('paperGenerate').onclick = function () {
  if (!PAPER.current) return; var b = this;
  $('paperSignalState').textContent = '正在读取观察池日线与当日新闻…';
  busy(b, '生成中…', api('/api/paper/accounts/' + PAPER.current.id + '/signals', { method: 'POST', timeout: 300000 })
    .then(function (j) { PAPER.current = j.detail; renderPaper(j.detail);
      log('⚙ 模拟盘生成 ' + j.signals + ' 个信号、' + j.proposals + ' 笔拟交易' + (j.auto_executed ? '，已按模拟自动模式成交' : '，等待人工确认'), 'ok');
    }).catch(function (e) { $('paperSignalState').textContent = '生成失败'; alert('信号生成失败：' + e.message); }));
};
$('paperExecute').onclick = function () {
  if (!PAPER.current) return; var ids = selectedPaperProposals();
  if (!ids.length) { alert('请勾选待确认的拟交易'); return; }
  if (!confirm('确认执行 ' + ids.length + ' 笔“模拟成交”？只扣减虚拟现金，不会向券商发送订单。')) return;
  var b = this;
  busy(b, '模拟成交中…', api('/api/paper/accounts/' + PAPER.current.id + '/execute', { method: 'POST', timeout: 120000, body: { proposal_ids: ids } })
    .then(function (j) { log('✓ 已记录 ' + j.executed.length + ' 笔模拟成交（假钱）', 'ok'); return loadPaperAccounts(PAPER.current.id); })
    .catch(function (e) { alert('模拟成交失败：' + e.message); }));
};
$('paperReject').onclick = function () {
  if (!PAPER.current) return; var ids = selectedPaperProposals(); if (!ids.length) { alert('请勾选待拒绝的拟交易'); return; }
  api('/api/paper/accounts/' + PAPER.current.id + '/reject', { method: 'POST', body: { proposal_ids: ids } })
    .then(function () { return loadPaperDetail(PAPER.current.id); }).catch(function (e) { alert('拒绝失败：' + e.message); });
};
function loadWealth(refresh) {
  $('wealthTable').innerHTML = '<div class="simEmpty">正在计算虚拟账户财富曲线…</div>';
  return api('/api/paper/wealth?refresh=' + (refresh ? 'true' : 'false'), { timeout: 180000 }).then(renderWealth)
    .catch(function (e) { $('wealthTable').innerHTML = '<div class="simEmpty" style="color:var(--gold)">财富数据获取失败：' + esc(e.message) + '</div>'; });
}
function renderWealth(j) {
  var items = j.items || [], total = items.reduce(function (s, x) { return s + (+x.total_asset || 0); }, 0);
  var best = items.slice().sort(function (a, b) { return b.total_return - a.total_return; })[0];
  $('wealthSummary').innerHTML = '<div class="simKpi"><div class="k">虚拟账户数</div><div class="v">' + items.length + '</div></div>' +
    '<div class="simKpi"><div class="k">模拟资产合计</div><div class="v">' + paperMoney(total) + '</div></div>' +
    '<div class="simKpi"><div class="k">当前领先账户</div><div class="v" style="font-size:12px">' + esc(best ? best.name : '—') + '</div></div>' +
    '<div class="simKpi warn"><div class="k">资金性质</div><div class="v" style="font-size:12px;color:var(--up)">全部是假钱</div></div>';
  $('wealthTable').innerHTML = items.length ? '<table class="simTable"><thead><tr><th>虚拟账户</th><th>模式</th><th>初始资金</th><th>总资产</th>' +
    '<th>累计收益</th><th>最大回撤</th><th>夏普</th><th>沪深300基准</th><th>持仓</th></tr></thead><tbody>' + items.map(function (x) {
      return '<tr><td><b>' + esc(x.name) + '</b></td><td>' + (x.mode === 'auto' ? '模拟自动' : '安全确认') + '</td>' +
        '<td class="n">' + paperMoney(x.initial_cash) + '</td><td class="n">' + paperMoney(x.total_asset) + '</td>' +
        '<td class="n ' + (x.total_return >= 0 ? 'buy' : 'sell') + '">' + paperPct(x.total_return) + '</td>' +
        '<td class="n sell">' + paperPct(x.max_drawdown) + '</td><td class="n">' + fx(x.sharpe, 2) + '</td>' +
        '<td class="n">' + paperPct(x.benchmark_return) + '</td><td class="n">' + x.position_count + '</td></tr>';
    }).join('') + '</tbody></table>' : '<div class="simEmpty">创建虚拟账户后，这里会显示多账户对比曲线。</div>';
  if (!PAPER.chart) PAPER.chart = echarts.init($('wealthChart'));
  var days = [], seen = {};
  items.forEach(function (x) { (x.curve || []).forEach(function (p) { if (!seen[p.day]) { seen[p.day] = 1; days.push(p.day); } }); });
  days.sort();
  var series = items.map(function (x) {
    var map = {}; (x.curve || []).forEach(function (p) { map[p.day] = +p.value / x.initial_cash * 100; });
    return { name: x.name, type: 'line', showSymbol: false, connectNulls: true,
      data: days.map(function (d) { return map[d] == null ? null : +map[d].toFixed(3); }) };
  });
  if (items.length) {
    var bm = {}, first = items[0]; (first.curve || []).forEach(function (p) { bm[p.day] = +p.benchmark / first.initial_cash * 100; });
    series.push({ name: '沪深300基准', type: 'line', showSymbol: false, lineStyle: { type: 'dashed', color: '#8795a8' },
      data: days.map(function (d) { return bm[d] == null ? null : +bm[d].toFixed(3); }) });
  }
  PAPER.chart.setOption({ backgroundColor: 'transparent', color: ['#f5c542', '#22d3ee', '#ff3b47', '#12d18a', '#a78bfa'],
    tooltip: { trigger: 'axis', valueFormatter: function (v) { return fx(v, 2); } },
    legend: { top: 7, textStyle: { color: '#7f91a6', fontSize: 10 } },
    grid: { left: 52, right: 22, top: 42, bottom: 35 },
    xAxis: { type: 'category', data: days, axisLabel: { color: '#617186', fontSize: 9 }, axisLine: { lineStyle: { color: '#1d2a39' } } },
    yAxis: { type: 'value', name: '初始=100', scale: true, axisLabel: { color: '#617186', fontSize: 9 }, splitLine: { lineStyle: { color: '#111c28' } } },
    series: series }, true);
}
$('wealthRefresh').onclick = function () { var b = this; busy(b, '更新中…', loadWealth(true)); };

/* ---------- 实盘数据只读 / 不可执行订单意图 ---------- */
var LIVE = { snapshot: null, intents: [] };
function liveAlias() { return $('liveAlias').value.trim() || '我的只读账户'; }
function downloadJson(name, data) {
  var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  var url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}
function loadLiveData() {
  $('liveState').textContent = '正在读取本机只读数据…';
  return api('/api/live/read-only/status?account_alias=' + encodeURIComponent(liveAlias()), { timeout: 30000 })
    .then(function (j) {
      if (j.execution_enabled !== false) throw new Error('后端未保持只读锁定，已拒绝显示');
      LIVE.snapshot = j.snapshot || null; LIVE.intents = j.intents || [];
      renderLiveSnapshot(LIVE.snapshot); renderLiveIntents(LIVE.intents);
      return j;
    }).catch(function (e) {
      $('liveState').textContent = '只读数据获取失败：' + e.message;
      throw e;
    });
}
function renderLiveSnapshot(s) {
  $('lkAsset').textContent = s ? paperMoney(s.total_asset) : '—';
  $('lkCash').textContent = s ? paperMoney(s.cash) : '—';
  $('lkAvailable').textContent = s ? paperMoney(s.available_cash) : '—';
  $('lkMarket').textContent = s ? paperMoney(s.market_value) : '—';
  $('liveAsOf').textContent = s ? ('数据时间 ' + s.asof + ' · ' + s.source) : '';
  $('liveState').textContent = s
    ? ('已载入“' + s.account_alias + '”的脱敏快照 · 执行权限关闭')
    : '尚未导入该账户别名的实盘只读快照';
  var positions = s ? (s.positions || []) : [];
  $('livePositions').innerHTML = positions.length ? '<table class="simTable"><thead><tr><th>标的</th><th>市场</th><th>数量</th><th>可用</th><th>成本</th><th>价格</th><th>市值</th><th>浮动盈亏</th></tr></thead><tbody>' +
    positions.map(function (p) { return '<tr><td><b>' + esc(p.name) + '</b> <span class="dm">' + esc(p.code) + '</span></td><td>' + esc(p.market) +
      '</td><td class="n">' + fx(p.quantity, 0) + '</td><td class="n">' + fx(p.available, 0) + '</td><td class="n">' + px(p.cost) +
      '</td><td class="n">' + px(p.price) + '</td><td class="n">' + paperMoney(p.market_value) + '</td><td class="n ' + (p.pnl >= 0 ? 'buy' : 'sell') + '">' +
      (p.pnl >= 0 ? '+' : '') + fx(p.pnl, 2) + '</td></tr>'; }).join('') + '</tbody></table>'
    : '<div class="simEmpty">没有只读持仓快照</div>';
  renderLiveRecords('liveOrders', s ? s.orders : [], '委托');
  renderLiveRecords('liveTrades', s ? s.trades : [], '成交');
}
function renderLiveRecords(id, rows, label) {
  rows = rows || [];
  $(id).innerHTML = rows.length ? '<table class="simTable"><thead><tr><th>时间</th><th>方向</th><th>标的</th><th>数量</th><th>价格</th><th>状态</th></tr></thead><tbody>' +
    rows.map(function (r) { return '<tr><td>' + esc(r.time) + '</td><td>' + esc(r.side) + '</td><td><b>' + esc(r.name) + '</b> <span class="dm">' + esc(r.code) +
      '</span></td><td class="n">' + fx(r.quantity, 0) + '</td><td class="n">' + px(r.price) + '</td><td>' + esc(r.status) + '</td></tr>'; }).join('') + '</tbody></table>'
    : '<div class="simEmpty">没有只读' + label + '记录</div>';
}
function renderLiveIntents(rows) {
  LIVE.intents = rows || [];
  $('liveIntentState').innerHTML = '<span class="liveLock">执行权限关闭</span> · ' + LIVE.intents.length + ' 条订单意图，仅可复核和导出';
  $('liveIntents').innerHTML = LIVE.intents.length ? '<table class="simTable"><thead><tr><th>意图编号</th><th>方向</th><th>标的</th><th>数量</th><th>参考价</th><th>最大偏离</th><th>风控状态</th><th>到期时间</th></tr></thead><tbody>' +
    LIVE.intents.map(function (x) { return '<tr><td class="dm">' + esc(x.intent_id) + '</td><td class="' + (x.side === 'buy' ? 'buy' : 'sell') + '">' +
      (x.side === 'buy' ? '拟买入' : '拟卖出') + '</td><td><b>' + esc(x.name) + '</b> <span class="dm">' + esc(x.code) + '</span></td><td class="n">' + fx(x.quantity, 0) +
      '</td><td class="n">' + px(x.reference_price) + '</td><td class="n">' + fx(x.max_slippage * 100, 2) + '%</td><td class="pending">' + esc(x.risk_status) +
      '</td><td class="dm">' + esc(x.expires_at) + '</td></tr>'; }).join('') + '</tbody></table>'
    : '<div class="simEmpty">尚无订单意图。模拟盘存在待确认拟交易时才能生成。</div>';
}
$('liveAlias').onchange = function () { if (SRV.ok) loadLiveData().catch(function () {}); };
$('liveRefresh').onclick = function () { var b = this; busy(b, '刷新中…', loadLiveData().catch(function () {})); };
$('liveTemplate').onclick = function () {
  downloadJson('QUANT_ENGINE_实盘只读快照模板.json', {
    account_alias: liveAlias(), asof: new Date().toISOString(), source: '券商工程师只读桥接',
    total_asset: 100000, cash: 20000, available_cash: 18000, market_value: 80000,
    positions: [{ code: '510300', name: '沪深300ETF', market: '上海', quantity: 2000, available: 2000,
      cost: 4.0, price: 4.1, market_value: 8200, pnl: 200 }],
    orders: [], trades: []
  });
};
$('liveImport').onclick = function () {
  var file = $('liveSnapshotFile').files && $('liveSnapshotFile').files[0];
  if (!file) { alert('请先选择券商工程师导出的脱敏 JSON 快照'); return; }
  var b = this, reader = new FileReader();
  reader.onload = function () {
    var body; try { body = JSON.parse(reader.result); } catch (e) { alert('JSON 文件格式无效'); return; }
    body.account_alias = liveAlias(); body.confirmation = 'READ_ONLY_IMPORT';
    busy(b, '导入中…', api('/api/live/read-only/snapshot', { method: 'POST', body: body, timeout: 60000 })
      .then(function () { log('◇ 已导入实盘数据只读快照；执行权限保持关闭', 'ok'); return loadLiveData(); })
      .catch(function (e) { alert('只读快照导入失败：' + e.message); }));
  };
  reader.readAsText(file, 'utf-8');
};
$('liveBuildIntents').onclick = function () {
  if (!PAPER.current) { alert('请先建立模拟账户并生成待确认拟交易'); return; }
  if (!confirm('仅生成不可执行的订单意图数据，不会向券商发送委托。继续？')) return;
  var b = this;
  busy(b, '生成中…', api('/api/live/read-only/order-intents/from-paper/' + PAPER.current.id,
    { method: 'POST', body: { account_alias: liveAlias() }, timeout: 60000 })
    .then(function (j) {
      if (j.execution_enabled !== false) throw new Error('只读锁定校验失败');
      renderLiveIntents(j.items || []);
      log('◇ 已生成 ' + j.created.length + ' 条不可执行订单意图', 'ok');
    }).catch(function (e) { alert('订单意图生成失败：' + e.message); }));
};
$('liveExportIntents').onclick = function () {
  var b = this;
  busy(b, '导出中…', api('/api/live/read-only/order-intents/export?account_alias=' + encodeURIComponent(liveAlias()))
    .then(function (j) {
      if (j.execution_enabled !== false || j.read_only !== true) throw new Error('数据包缺少只读锁定标记');
      downloadJson('QUANT_ENGINE_订单意图_只读.json', j);
    }).catch(function (e) { alert('导出失败：' + e.message); }));
};
window.addEventListener('resize', function () { if (PAPER.chart) PAPER.chart.resize(); });

})();
