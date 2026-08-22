/* 从东方财富抓取全市场标的清单 -> src/universe.json
   构建时执行一次，把快照内联进单文件 HTML；运行时还可在界面里点「更新标的库」增量刷新。 */
const fs = require('fs'), path = require('path');

const GROUPS = [
  ['股票',   'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048'],
  ['基金',   'b:MK0021,b:MK0022,b:MK0023,b:MK0024'],
  ['行业板块', 'm:90+t:2'],
  ['概念板块', 'm:90+t:3'],
  ['地域板块', 'm:90+t:1'],
  ['指数',   'm:1+t:1'],
  ['指数',   'm:0+t:5'],
  ['美股',   'm:105,m:106,m:107']   // 纳斯达克 / 纽交所 / 美交所
];
const PZ = 100;

function url(fs_, pn) {
  return 'https://push2.eastmoney.com/api/qt/clist/get?pn=' + pn + '&pz=' + PZ +
    '&po=1&np=1&fltt=2&invt=2&fid=f12&fs=' + encodeURIComponent(fs_) + '&fields=f12,f13,f14';
}

async function getPage(fs_, pn, tries) {
  tries = tries || 0;
  try {
    const r = await fetch(url(fs_, pn), {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://quote.eastmoney.com/' },
      signal: AbortSignal.timeout(20000)
    });
    const j = await r.json();
    if (!j.data) return { total: 0, list: [] };
    return { total: j.data.total, list: (j.data.diff || []).map(d => d.f13 + '.' + d.f12 + '|' + d.f14) };
  } catch (e) {
    if (tries < 3) { await new Promise(r => setTimeout(r, 800 * (tries + 1))); return getPage(fs_, pn, tries + 1); }
    throw e;
  }
}

async function fetchGroup(name, fs_) {
  const first = await getPage(fs_, 1);
  const pages = Math.ceil(first.total / PZ);
  const out = first.list.slice();
  // 并发 6 路
  let pn = 2;
  async function worker() {
    while (pn <= pages) {
      const my = pn++;
      const r = await getPage(fs_, my);
      out.push(...r.list);
    }
  }
  await Promise.all(Array.from({ length: Math.min(6, Math.max(pages - 1, 1)) }, worker));
  process.stdout.write('  ' + name + ' ' + fs_.slice(0, 22) + ' -> ' + out.length + '/' + first.total + '\n');
  return out;
}

/* 场外基金（开放式基金）清单：天天基金的全量 js
   格式 var r = [[代码, 简拼, 名称, 类型, 全拼], ...]
   统一成 OF.代码|名称|简拼 三段，OF 前缀用于区分场内标的 */
async function fetchOTC() {
  const r = await fetch('https://fund.eastmoney.com/js/fundcode_search.js', {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://fund.eastmoney.com/' },
    signal: AbortSignal.timeout(60000)
  });
  const txt = await r.text();
  const m = txt.match(/var\s+r\s*=\s*(\[[\s\S]*?\]);?\s*$/);
  if (!m) throw new Error('场外基金清单解析失败');
  const arr = JSON.parse(m[1]);
  const out = arr
    .filter(a => a && a[0] && a[2])
    .map(a => 'OF.' + a[0] + '|' + a[2] + '|' + (a[1] || ''));
  process.stdout.write('  场外基金 -> ' + out.length + '\n');
  return out;
}

(async () => {
  // 已有快照：某一组抓取失败时回退，避免限流导致整份数据作废
  const outFile = path.join(__dirname, 'src', 'universe.json');
  let old = null;
  if (fs.existsSync(outFile)) {
    try { old = JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch (e) { /* 忽略损坏的旧快照 */ }
  }
  const oldOf = k => (old && old.data && old.data[k]) ? old.data[k].split('\n') : null;

  const bag = {}, failed = [];
  for (const [name, fs_] of GROUPS) {
    try {
      const list = await fetchGroup(name, fs_);
      bag[name] = (bag[name] || []).concat(list);
    } catch (e) {
      console.warn('  !! ' + name + ' ' + fs_.slice(0, 20) + ' 抓取失败:', e.message);
      failed.push(name);
    }
  }
  try { bag['场外基金'] = await fetchOTC(); }
  catch (e) { console.warn('  !! 场外基金清单抓取失败:', e.message); failed.push('场外基金'); }

  // 回退：本次没抓到的分组沿用旧快照
  for (const k of new Set(failed)) {
    if (bag[k] && bag[k].length) continue;
    const prev = oldOf(k);
    if (prev) { bag[k] = prev; console.log('  ↩ ' + k + ' 沿用旧快照 ' + prev.length + ' 条'); }
  }
  if (!Object.keys(bag).length) throw new Error('全部分组均抓取失败，且无可用旧快照');
  // 场内 ETF/LOF 也会出现在天天基金的全量清单里，从「场外基金」剔除，保证两个分类互不重叠
  if (bag['场外基金'] && bag['基金']) {
    const inCodes = new Set(bag['基金'].map(l => l.split('|')[0].split('.')[1]));
    const before = bag['场外基金'].length;
    bag['场外基金'] = bag['场外基金'].filter(l => !inCodes.has(l.split('|')[0].slice(3)));
    console.log('  ✂ 场外基金剔除与场内重叠 ' + (before - bag['场外基金'].length) + ' 只');
  }

  // 去重（同一 secid 只保留一次）
  const data = {};
  let total = 0;
  for (const k of Object.keys(bag)) {
    const seen = new Set(), keep = [];
    for (const line of bag[k]) {
      const id = line.split('|')[0];
      if (seen.has(id)) continue;
      seen.add(id); keep.push(line);
    }
    keep.sort((a, b) => a.split('|')[0].localeCompare(b.split('|')[0]));
    data[k] = keep.join('\n');
    total += keep.length;
    console.log(('  ' + k).padEnd(12), keep.length);
  }
  const d = new Date();
  const out = {
    ts: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'),
    total: total,
    data: data
  };
  const file = path.join(__dirname, 'src', 'universe.json');
  fs.writeFileSync(file, JSON.stringify(out), 'utf8');
  console.log('OK ->', file, (fs.statSync(file).size / 1024).toFixed(0) + ' KB, 共 ' + total + ' 个标的');
})();
