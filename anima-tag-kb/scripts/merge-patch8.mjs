#!/usr/bin/env node
// merge-patch8.mjs —— 把「第 7 期本地缺口回填」（data/patch8-tags.json）合并进本地词库
//
// 用法：
//   node anima-tag-kb/scripts/merge-patch8.mjs                  # 只读演练（默认，不动盘）
//   node anima-tag-kb/scripts/merge-patch8.mjs --write          # 真写：自动备份 + 出报告
//   node anima-tag-kb/scripts/merge-patch8.mjs --kb 画师类 --write
//
// 做什么：
//   1) new_rows    —— 本地确实缺的真标签，追加进 search-index.json 的 rows（第 13 位打来源标记），
//                     并往对应 bigs/<part>.json 的 items 追加一条（形状克隆同 sub 的本地条目）。
//   2) alias_patches —— 把「历轮查不出」的说法挂成已存在标签的别名：同时写 search-index 的 aliases 串
//                     与 bigs 条目第 5 位的别名数组。多词别名统一用下划线（别名串按空格切分）。
//   3) 计数同步：manifest.meta.total、categories[].count、categories[].subs[].count，
//      并在 meta.supplements 追加一条记录。
//   4) 写盘一律 JSON.stringify(v)（紧凑、无 BOM、无多余空白），与 merge-anima3.mjs 一致。
//
// 安全：默认不动盘；--write 会先把 search-index / manifest / 受影响的 bigs 分片复制到
//       _backup/patch8-<时间戳>/，报告写到 _merge/patch8-merge-<时间戳>.json。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.dirname(HERE);

const argv = process.argv.slice(2);
const WRITE = argv.includes('--write');
const kbIdx = argv.indexOf('--kb');
const KB_NAME = kbIdx >= 0 ? argv[kbIdx + 1] : '画师类';
const KB = path.join(REPO_ROOT, KB_NAME);
const SOURCE = path.join(REPO_ROOT, 'data', 'patch8-tags.json');
const TOOLBOX = 'ai-tag-toolbox（star-abyss，MIT 风格社区标签库）';

const keyOf = s => String(s == null ? '' : s).trim().toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ');
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const parseFreq = v => {
  if (v == null || v === '') return null;
  const m = /^([\d.]+)\s*([kKmM]?)$/.exec(String(v).trim());
  if (!m) return null;
  const mult = m[2].toLowerCase() === 'k' ? 1e3 : m[2].toLowerCase() === 'm' ? 1e6 : 1;
  return Math.round(parseFloat(m[1]) * mult);
};
const aliasList = s => String(s || '').split(/\s+/).map(x => x.trim()).filter(Boolean);
const bigFileOf = big => {
  const dir = path.join(KB, 'bigs');
  const stem = String(big).replace(/^cb:/, 'cb-').replace(/^og:/, 'og-');
  const exact = path.join(dir, stem + '.json');
  if (fs.existsSync(exact)) return exact;
  const hit = fs.readdirSync(dir).find(f => new RegExp('^' + stem + '-\\d+\\.json$').test(f));
  return hit ? path.join(dir, hit) : null;
};
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

if (!fs.existsSync(KB)) { console.error('找不到词库目录：' + KB); process.exit(1); }
const INDEX_PATH = path.join(KB, 'search-index.json');
const MANIFEST_PATH = path.join(KB, 'manifest.json');
const index = readJson(INDEX_PATH);
const man = readJson(MANIFEST_PATH);
const src = readJson(SOURCE);

const F = index.fields;
const fi = n => F.indexOf(n);
const rows = index.rows;
const byKey = new Map();
for (const r of rows) { const k = keyOf(r[fi('tag')]); if (k && !byKey.has(k)) byKey.set(k, r); }

const MARK = src.mark || 'patch8';
const catOf = id => (man.categories || []).find(c => c.id === id);

// ---------- 1) 新标签行 ----------
const added = [], dup = [], badBig = [], badSub = [];
const perBig = new Map(), perSub = new Map();
const touchedDocs = new Map();          // file -> doc

for (const r of src.new_rows || []) {
  const k = keyOf(r.tag);
  if (byKey.has(k)) { dup.push({ tag: r.tag, note: '本地已有同名键，跳过' }); continue; }
  const cat = catOf(r.big);
  if (!cat) { badBig.push({ tag: r.tag, big: r.big }); continue; }
  const subs = (cat.subs || []).map(s => s.name);
  if (r.sub && subs.length && !subs.includes(r.sub)) badSub.push({ tag: r.tag, big: r.big, sub: r.sub, allowed: subs });

  const row = new Array(F.length).fill('');
  row[fi('tag')] = r.tag;
  row[fi('big')] = r.big;
  row[fi('order')] = r.order != null ? r.order : cat.order;
  row[fi('zh')] = r.zh || '';
  row[fi('aliases')] = r.aliases || '';
  row[fi('weight')] = r.weight || '';
  row[fi('freq')] = r.freq || '';
  row[fi('confidence')] = r.confidence || '待验证';
  row[fi('sub')] = r.sub || '';
  row[fi('bigName')] = r.bigName || cat.name;
  row[fi('slot')] = r.slot || '';
  row[fi('official')] = r.official ? 1 : 0;
  row.push(MARK + ':new');

  // bigs 分片条目：克隆同 sub 的本地条目形状
  const file = bigFileOf(r.big);
  if (!file) { badBig.push({ tag: r.tag, big: r.big, note: '找不到 bigs 分片' }); continue; }
  if (!touchedDocs.has(file)) touchedDocs.set(file, readJson(file));
  const doc = touchedDocs.get(file);
  doc.items = doc.items || [];
  const sib = doc.items.find(x => Array.isArray(x) && x[12] === r.sub && x[11] === 'local')
    || doc.items.find(x => Array.isArray(x) && x[11] === 'local')
    || doc.items.find(x => Array.isArray(x));
  const item = sib ? sib.slice() : [null, null, null, null, null, null, null, null, null, null, TOOLBOX, 'local', null, 0];
  for (const i of [6, 7, 8, 9, 15, 16]) if (item.length > i) item[i] = null;   // 清掉从模板抄来的个体字段
  item[0] = r.tag;
  item[1] = r.zh || '';
  item[2] = r.weight || null;
  item[3] = parseFreq(r.freq);
  item[4] = r.confidence || '待验证';
  item[5] = aliasList(r.aliases).length ? aliasList(r.aliases) : null;
  item[10] = TOOLBOX;
  item[11] = 'local';
  item[12] = r.sub || '';
  item[13] = r.official ? 1 : 0;
  if (item.length > 14) item[14] = 0;
  if (item.length > 17) item[17] = r.big;
  doc.items.push(item);

  rows.push(row);
  byKey.set(k, row);
  added.push({ tag: r.tag, big: r.big, sub: r.sub, order: row[fi('order')], freq: r.freq, file: path.basename(file) });
  perBig.set(r.big, (perBig.get(r.big) || 0) + 1);
  perSub.set(r.big + '|' + (r.sub || ''), (perSub.get(r.big + '|' + (r.sub || '')) || 0) + 1);
}

// ---------- 2) 别名补丁 ----------
const patched = [], aliasMissing = [];
for (const p of src.alias_patches || []) {
  const k = keyOf(p.target);
  const row = byKey.get(k);
  if (!row) { aliasMissing.push({ target: p.target, note: '词库里没有这个标签，补丁跳过' }); continue; }
  const adds = (p.add || []).map(a => String(a).trim()).filter(Boolean);
  const have = new Set(aliasList(row[fi('aliases')]).map(keyOf));
  have.add(keyOf(row[fi('tag')]));
  const fresh = adds.filter(a => !have.has(keyOf(a)));
  if (fresh.length) row[fi('aliases')] = aliasList(row[fi('aliases')]).concat(fresh).join(' ');

  // bigs 条目别名数组（第 5 位）
  const file = bigFileOf(row[fi('big')]);
  if (file) {
    if (!touchedDocs.has(file)) touchedDocs.set(file, readJson(file));
    const doc = touchedDocs.get(file);
    const item = (doc.items || []).find(x => Array.isArray(x) && keyOf(x[0]) === k);
    if (item) {
      const cur = Array.isArray(item[5]) ? item[5].slice() : aliasList(item[5]);
      const curKeys = new Set(cur.map(keyOf));
      curKeys.add(k);
      for (const a of fresh) if (!curKeys.has(keyOf(a))) { cur.push(a); curKeys.add(keyOf(a)); }
      item[5] = cur.length ? cur : null;
    }
  }
  patched.push({ target: p.target, added: fresh, skippedExisting: adds.length - fresh.length });
}

// ---------- 3) 计数同步（只在 --write 时落盘，但演练也先算出来） ----------
const addedCount = added.length;
const projectedTotal = (man.meta && man.meta.total ? man.meta.total : rows.length - addedCount) + addedCount;
for (const [big, n] of perBig) { const c = catOf(big); if (c) c.count = (c.count || 0) + n; }
for (const [key, n] of perSub) {
  const [big, sub] = key.split('|');
  const c = catOf(big); if (!c) continue;
  const s = (c.subs || []).find(x => x.name === sub);
  if (s) s.count = (s.count || 0) + n;
}
if (man.meta) man.meta.total = projectedTotal;
man.meta = man.meta || {};
man.meta.supplements = man.meta.supplements || [];
man.meta.supplements.push({
  name: MARK,
  file: 'data/patch8-tags.json',
  label: src.label || '本地缺口回填 · 第 7 期',
  added: addedCount,
  alias_patched: patched.reduce((a, p) => a + p.added.length, 0),
  applied_at: new Date().toISOString(),
  script: 'scripts/merge-patch8.mjs'
});

// ---------- 汇报 ----------
const line = s => console.log(s);
line('词库：' + KB);
line('源文件：' + SOURCE + '（' + (src.criteria ? 'criteria 已声明' : '无 criteria') + '）');
line('模式：' + (WRITE ? '写入（--write）' : '只读演练（不加 --write 不动盘）'));
line('');
line('【新增行】' + addedCount + ' 条');
for (const a of added) line('  + ' + a.tag.padEnd(18) + ' ' + a.big + ' / ' + a.sub + '  order=' + a.order + '  freq=' + (a.freq || '-') + '  -> ' + a.file);
if (dup.length) { line('【跳过·已存在】' + dup.length + ' 条：' + dup.map(d => d.tag).join(' · ')); }
if (badBig.length) { line('【大类不存在】' + badBig.length + ' 条：' + JSON.stringify(badBig)); }
if (badSub.length) { line('【sub 不在该大类里】' + badSub.length + ' 条：' + JSON.stringify(badSub)); }
line('');
line('【别名补丁】命中 ' + patched.length + ' 条，写入别名 ' + patched.reduce((a, p) => a + p.added.length, 0) + ' 个');
for (const p of patched) if (p.added.length) line('  ~ ' + p.target.padEnd(20) + ' += ' + p.added.join(' '));
if (aliasMissing.length) line('【别名目标缺失】' + aliasMissing.length + ' 条：' + aliasMissing.map(a => a.target).join(' · '));
line('');
line('【计数】rows: ' + (rows.length - addedCount) + ' -> ' + rows.length + '   meta.total: ' + (projectedTotal - addedCount) + ' -> ' + projectedTotal);
line('【将写盘】search-index.json · manifest.json · ' + touchedDocs.size + ' 个 bigs 分片：' + [...touchedDocs.keys()].map(f => path.basename(f)).join(' · '));

if (!WRITE) { line(''); line('（演练结束，未写盘。加 --write 执行。）'); process.exit(0); }

// ---------- 4) 备份 + 写盘 ----------
const bakDir = path.join(KB, '_backup', 'patch8-' + stamp());
fs.mkdirSync(bakDir, { recursive: true });
fs.copyFileSync(INDEX_PATH, path.join(bakDir, 'search-index.json'));
fs.copyFileSync(MANIFEST_PATH, path.join(bakDir, 'manifest.json'));
for (const f of touchedDocs.keys()) fs.copyFileSync(f, path.join(bakDir, path.basename(f)));

fs.writeFileSync(INDEX_PATH, JSON.stringify(index), 'utf8');
fs.writeFileSync(MANIFEST_PATH, JSON.stringify(man), 'utf8');
for (const [f, doc] of touchedDocs) fs.writeFileSync(f, JSON.stringify(doc), 'utf8');

const mergeDir = path.join(KB, '_merge');
fs.mkdirSync(mergeDir, { recursive: true });
const reportPath = path.join(mergeDir, 'patch8-merge-' + stamp() + '.json');
fs.writeFileSync(reportPath, JSON.stringify({
  merged_at: new Date().toISOString(),
  source_file: path.relative(REPO_ROOT, SOURCE).replace(/\\/g, '/'),
  kb: KB_NAME,
  added: addedCount,
  added_tags: added.map(a => a.tag),
  skipped_duplicates: dup.map(d => d.tag),
  bad_big: badBig,
  bad_sub: badSub,
  alias_targets_patched: patched.length,
  aliases_written: patched.reduce((a, p) => a + p.added.length, 0),
  alias_missing: aliasMissing.map(a => a.target),
  index_rows_after: rows.length,
  manifest_total_after: man.meta.total,
  bigs_written: [...touchedDocs.keys()].map(f => path.basename(f)),
  backup_dir: path.relative(KB, bakDir).replace(/\\/g, '/')
}, null, 2), 'utf8');

line('');
line('已写盘。备份：' + path.relative(KB, bakDir) + '   报告：' + path.relative(KB, reportPath));
