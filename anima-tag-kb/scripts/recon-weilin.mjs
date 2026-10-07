/** recon-weilin.mjs —— 评估 WeiLin 数据对本地库的增益：补中文 / 补频次 / 新增标签。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const S = path.join(ROOT, 'data', 'sources');

const norm = s => String(s || '').toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
const isHan = s => /[\u4e00-\u9fff]/.test(s);

const wRows = fs.readFileSync(path.join(S, 'weilin-danbooru.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const wByKey = new Map();
for (const r of wRows) { const k = norm(r.tag); if (!wByKey.has(k)) wByKey.set(k, r); }

const wTags = JSON.parse(fs.readFileSync(path.join(S, 'weilin-tags.json'), 'utf8'));
const curatedByKey = new Map();
for (const v of wTags.tag_rows) { const k = norm(v[2]); if (!curatedByKey.has(k)) curatedByKey.set(k, { zh: v[3], group: v[1] }); }

const dRows = fs.readFileSync(path.join(S, 'danbooru-tags.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const dByKey = new Map();
for (const r of dRows) { const k = norm(r.name); if (!dByKey.has(k) || dByKey.get(k).post_count < r.post_count) dByKey.set(k, r); }

const U = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'unified-tags.json'), 'utf8'));
const have = new Map();
for (const t of U.tags) have.set(norm(t.tag).replace(/^@/, ''), t);

const stat = {
  本地: { total: U.tags.length, 缺中文: U.tags.filter(t => !t.zh).length },
  weilin: { danbooru行: wRows.length, 有中文: wRows.filter(r => isHan(r.zh)).length, 策展tag: wTags.tag_rows.length, 一级分类: wTags.groups.length, 二级分类: wTags.subgroups.length },
  danbooru直采: { 行: dRows.length, unique: dByKey.size },
};
// 1) 补中文
let fillMissing = 0, replacePlaceholder = 0, same = 0;
const noFill = [];
for (const t of U.tags) {
  const k = norm(t.tag).replace(/^@/, '');
  const w = wByKey.get(k) || (curatedByKey.get(k) ? { zh: curatedByKey.get(k).zh } : null);
  if (curatedByKey.has(k) && !wByKey.has(k)) { /* curated only */ }
  const zh = w && isHan(w.zh) ? w.zh : '';
  if (!t.zh) { if (zh) fillMissing++; else noFill.push(t.tag); }
  else if (/^Danbooru 官方组|^AnimaTags-DB/.test(t.zh)) { if (zh) replacePlaceholder++; }
  else if (zh && zh === t.zh) same++;
}
stat.补中文 = { 空缺补上: fillMissing, 占位符换成真译名: replacePlaceholder, 仍缺: noFill.length, 译名一致的: same };
stat.仍缺样例 = noFill.slice(0, 40);

// 2) 补频次
let freqFill = 0;
const freqMiss = [];
for (const t of U.tags) {
  const k = norm(t.tag).replace(/^@/, '');
  if (t.freq) continue;
  const d = dByKey.get(k), w = wByKey.get(k);
  const c = d ? d.post_count : (w && w.hot ? w.hot : 0);
  if (c > 0) freqFill++; else freqMiss.push(t.tag);
}
stat.补频次 = { 可补: freqFill, 仍无: freqMiss.length };

// 3) 新增标签（Danbooru 直采 general 且本地没有）
const dGeneral = [...dByKey.values()].filter(r => r.category === 0);
const dAll = [...dByKey.values()];
const missingGeneral = dGeneral.filter(r => !have.has(norm(r.name)));
const missingAll = dAll.filter(r => !have.has(norm(r.name)));
const wMissing = wRows.filter(r => !have.has(norm(r.tag)));
stat.新增候选 = {
  danbooru直采全部缺: missingAll.length,
  danbooru直采general缺: missingGeneral.length,
  'general缺_>=500投稿': missingGeneral.filter(r => r.post_count >= 500).length,
  'general缺_>=200投稿': missingGeneral.filter(r => r.post_count >= 200).length,
  WeiLin条目本地没有: wMissing.length,
};
stat.general缺样例 = missingGeneral.filter(r => r.post_count >= 500).slice(0, 40).map(r => `${r.name}(${r.post_count})`);
stat.WeiLin缺样例 = wMissing.slice(0, 40).map(r => `${r.tag}[${r.cat}]${r.zh}(${r.hot})`);

// 4) 分类增益：WeiLin 二级分类能覆盖多少本地标签
const coverBySub = {};
for (const v of wTags.tag_rows) {
  const k = norm(v[2]);
  const g = wTags.groups.find(x => x.id === +v[1]);
  const sg = wTags.subgroups.find(x => x.id === +v[0]);
  if (!have.has(k)) continue;
  const name = (g ? g.name : '?') + '>' + (sg ? sg.name : '?');
  coverBySub[name] = (coverBySub[name] || 0) + 1;
}
stat.WeiLin二级分类命中本地标签数 = Object.entries(coverBySub).sort((a, b) => b[1] - a[1]).slice(0, 25);

fs.writeFileSync(path.join(S, 'recon-weilin.json'), JSON.stringify(stat, null, 1));
console.log(JSON.stringify(stat, null, 1));
