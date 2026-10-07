/**
 * recon.mjs —— 合并前的对账：toolbox 标签 vs 本地知识库标签
 * 只读，不改任何文件。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

const norm = s => String(s || '').toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();

/* ---------- 1. 解析 toolbox 数据 ---------- */
function parseTagFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  // 抓取形如 ["en","zh","aliases","cat","sub",0] 的数组行
  const rows = [];
  const re = /\[\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*,\s*(\d)\s*\]/g;
  let m;
  while ((m = re.exec(src))) {
    rows.push({ en: m[1], zh: m[2], aliases: m[3], cat: m[4], sub: m[5], nsfw: +m[6] });
  }
  return rows;
}
const base = parseTagFile(path.join(STUDY, 'data-tags.js'));
const extra = parseTagFile(path.join(STUDY, 'extra-tags.js'));

console.log('== toolbox 数据 ==');
console.log('data-tags.js  :', base.length, '行');
console.log('extra-tags.js :', extra.length, '行');
const allTb = [...base, ...extra];
const tbMap = new Map();
for (const r of allTb) {
  const k = norm(r.en);
  if (!k) continue;
  if (!tbMap.has(k)) tbMap.set(k, r);
}
console.log('去重后 unique (按英文规范化):', tbMap.size);

const catCount = {}, subCount = {};
for (const r of allTb) { catCount[r.cat] = (catCount[r.cat] || 0) + 1; const k = r.cat + '/' + r.sub; subCount[k] = (subCount[k] || 0) + 1; }
console.log('一级分类数:', Object.keys(catCount).length, ' (category,sub) 组合:', Object.keys(subCount).length);
console.log('一级分类分布:', Object.entries(catCount).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  '));

/* ---------- 2. 本地 KB 标签 ---------- */
const local = new Map(); // key -> {tag, cat, zh}
const tagsDir = path.join(ROOT, '画师类', 'tags');
let localTotal = 0;
for (const f of fs.readdirSync(tagsDir)) {
  const c = JSON.parse(fs.readFileSync(path.join(tagsDir, f), 'utf8'));
  for (const it of c.items) {
    localTotal++;
    const raw = String(it[0] || '');
    const k = norm(raw.replace(/^@/, ''));
    if (!local.has(k)) local.set(k, { tag: raw, cat: c.id, catName: c.name, zh: it[1] || '' });
  }
}
console.log('\n== 本地知识库 ==');
console.log('条目总数:', localTotal, ' unique 规范化键:', local.size);

/* ---------- 3. 对账 ---------- */
let both = 0, onlyTb = 0, onlyLocal = 0;
const missing = [];
for (const [k, r] of tbMap) {
  if (local.has(k)) both++;
  else { onlyTb++; if (missing.length < 40) missing.push(`${r.en} = ${r.zh || '(无中文)'}  [${r.cat}/${r.sub}]`); }
}
for (const k of local.keys()) if (!tbMap.has(k)) onlyLocal++;

console.log('\n== 对账 ==');
console.log('两边都有:', both);
console.log('仅 toolbox 有（可补充）:', onlyTb);
console.log('仅本地有:', onlyLocal);
console.log('\n仅 toolbox 有的样例（前 40）:');
missing.forEach(x => console.log('  ' + x));

/* ---------- 4. sames 名称冲突（同一 key 两边中文不同） ---------- */
const conflicts = [];
for (const [k, r] of tbMap) {
  const l = local.get(k);
  if (l && l.zh && r.zh && norm(l.zh) !== norm(r.zh)) conflicts.push(`${k}  本地「${l.zh}」 vs toolbox「${r.zh}」`);
}
console.log('\n中文译名不一致:', conflicts.length, '例：');
conflicts.slice(0, 15).forEach(x => console.log('  ' + x));

/* ---------- 5. synonyms / search-keywords 概览 ---------- */
for (const f of ['synonyms.js', 'search-keywords.js']) {
  const src = fs.readFileSync(path.join(STUDY, f), 'utf8');
  console.log(`\n== ${f} ==  长度 ${src.length}`);
  console.log('  头 400 字:', src.slice(0, 400).replace(/\n/g, ' ⏎ '));
}
