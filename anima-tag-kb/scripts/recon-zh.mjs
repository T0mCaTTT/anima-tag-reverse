/**
 * recon2.mjs —— 中文覆盖体检 + synonyms.js 结构解析
 * 只读。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
// ai-tag-toolbox 快照目录：仓库里不留作者本机路径，用环境变量或同级目录指定
const STUDY = (() => {
  const cands = [
    process.env.ANIMA_STUDY_DIR,
    path.join(ROOT, '..', '.ai-tag-toolbox-study'),
    path.join(ROOT, '..', 'ai-tag-toolbox')
  ].filter(Boolean);
  const hit = cands.find(d => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
  if (!hit) throw new Error('找不到 ai-tag-toolbox 快照目录。请设 ANIMA_STUDY_DIR=<目录>（需含 data-tags.js / extra-tags.js / synonyms.js）。已试过：\n  ' + cands.join('\n  '));
  return hit;
})();

/* ---------- 1. 本地 KB 里哪些中文是占位符 ---------- */
const ph = [];
let total = 0;
const tagsDir = path.join(ROOT, '画师类', 'tags');
for (const f of fs.readdirSync(tagsDir)) {
  const c = JSON.parse(fs.readFileSync(path.join(tagsDir, f), 'utf8'));
  for (const it of c.items) {
    total++;
    const zh = String(it[1] || '');
    if (!zh || /^Danbooru 官方组/.test(zh) || /^AnimaTags-DB/.test(zh) || /官方组|数据集/.test(zh)) ph.push({ cat: c.id, tag: it[0], zh });
  }
}
console.log('本地条目', total, ' 疑似占位中文', ph.length);
const byCat = {};
for (const p of ph) byCat[p.cat] = (byCat[p.cat] || 0) + 1;
console.log('占位最多的类:', Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, v]) => `${k}:${v}`).join('  '));
console.log('样例:', ph.slice(0, 12).map(p => `${p.cat} | ${p.tag} => ${p.zh}`).join('\n         '));

/* ---------- 2. synonyms.js 结构 ---------- */
const ctx = { window: {}, module: { exports: {} }, console };
ctx.globalThis = ctx;
vm.createContext(ctx);
const src = fs.readFileSync(path.join(STUDY, 'synonyms.js'), 'utf8');
try { vm.runInContext(src, ctx, { timeout: 20000 }); } catch (e) { console.log('求值失败:', e.message); }
const S = ctx.SYNONYMS || ctx.window.SYNONYMS;
if (S) {
  const ks = Object.keys(S);
  console.log('\nSYNONYMS 顶层键数:', ks.length, ' 键样例:', ks.slice(0, 6));
  const first = S[ks[0]];
  console.log('值类型:', Array.isArray(first) ? 'array(' + first.length + ')' : typeof first, JSON.stringify(first).slice(0, 200));
  // 统计形态：zh->[en] 还是 en->[zh]
  let zhKeys = 0, enKeys = 0;
  for (const k of ks) (/^[\x00-\x7F]+$/.test(k) ? enKeys++ : zhKeys++);
  console.log('纯 ASCII 键:', enKeys, ' 含中文键:', zhKeys);
}
for (const name of ['SYNONYMS_BY_EN', 'SYNONYM_ALIASES', 'SEARCH_KEYWORDS']) {
  const v = ctx[name] || ctx.window[name];
  if (v) {
    const ks = Object.keys(v);
    console.log(`\n${name}: ${ks.length} 键, 样例 ${ks.slice(0, 4).join(' / ')} → ${JSON.stringify(v[ks[0]]).slice(0, 160)}`);
  } else console.log(`\n${name}: 未定义`);
}
