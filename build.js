/* 构建：把 echarts + 标的库 + app.js 内联进 shell.html，产出完全离线的单文件 HTML */
const fs = require('fs'), path = require('path');
const root = __dirname, src = path.join(root, 'src'), dist = root;   // 产物直接放项目根目录

const shell = fs.readFileSync(path.join(src, 'shell.html'), 'utf8');
const ec = fs.readFileSync(path.join(src, 'echarts.min.js'), 'utf8');
const app = fs.readFileSync(path.join(src, 'app.js'), 'utf8');

// 标的库快照（fetch-universe.js 生成，缺失时降级为空库）
let uni = 'window.__QE_UNIVERSE__=null;';
const uniFile = path.join(src, 'universe.json');
if (fs.existsSync(uniFile)) {
  const raw = fs.readFileSync(uniFile, 'utf8');
  const j = JSON.parse(raw);
  uni = 'window.__QE_UNIVERSE__=' + raw + ';';
  console.log('   标的库快照', j.total, '个，日期', j.ts);
} else {
  console.warn('   !! 未找到 src/universe.json，先跑 node fetch-universe.js');
}

// 防止内联脚本里出现 </script> 提前闭合
const esc = s => s.replace(/<\/script/gi, '<\\/script');

let out = shell
  .replace('/*__ECHARTS__*/', () => esc(ec))
  .replace('/*__UNIVERSE__*/', () => esc(uni))
  .replace('/*__APP__*/', () => esc(app));

for (const tok of ['__ECHARTS__', '__UNIVERSE__', '__APP__']) {
  if (out.includes(tok)) { console.error('!! 占位符未被替换:', tok); process.exit(1); }
}

const file = path.join(dist, 'QUANT_ENGINE_v10.html');
fs.writeFileSync(file, out, 'utf8');
console.log('OK ->', file, (Buffer.byteLength(out) / 1024).toFixed(0) + ' KB');
