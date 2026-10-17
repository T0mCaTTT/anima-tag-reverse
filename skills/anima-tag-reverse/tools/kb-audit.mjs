#!/usr/bin/env node
/**
 * kb-audit.mjs —— 词库批量核查 / 维度普查工具（零依赖，只读）
 *
 * 为什么有它：验一个标签存不存在、某维度到底有什么，以前每轮都得现写临时脚本。
 * 这个工具把「维度普查」与「批量覆盖率核查」固定下来，随时可跑。
 *
 * 用法：
 *   node tools/kb-audit.mjs --stats                      规模、增量、supplements、字段
 *   node tools/kb-audit.mjs --tree                       69 个大分类（含计数）
 *   node tools/kb-audit.mjs --big og:attire              某个大分类的小分类（含计数）
 *   node tools/kb-audit.mjs --sub "手持道具"              某个小分类下的标签
 *   node tools/kb-audit.mjs --near "路灯"                 查近似标签（不知道真名时用）
 *   node tools/kb-audit.mjs --check "a, b, c"            批量核查（逗号 / 换行都行）
 *   node tools/kb-audit.mjs --check --file list.txt      从文件批量核查（一行一个）
 *   type list.txt | node tools/kb-audit.mjs --check      stdin 也行
 *   …以上任意命令加 --json 出结构化结果
 *
 * 词库定位顺序：--kb <dir> → 环境变量 ANIMA_KB_DIR → 本工具上级目录的 kb-path.json
 *   → 仓库相对路径 ../../anima-tag-kb/画师类 → 当前目录。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(HERE, '..');

// ── 词库定位 ────────────────────────────────────────────────
function resolveKbDir(explicit) {
  const cands = [];
  if (explicit) cands.push(explicit);
  if (process.env.ANIMA_KB_DIR) cands.push(process.env.ANIMA_KB_DIR);
  const kbPathFile = path.join(SKILL_DIR, 'kb-path.json');
  if (fs.existsSync(kbPathFile)) {
    try {
      const j = JSON.parse(fs.readFileSync(kbPathFile, 'utf8').replace(/^\uFEFF/, ''));
      for (const v of [j.kbDir, j.dir, j.path]) if (typeof v === 'string') cands.push(v);
    } catch { /* 坏文件忽略 */ }
  }
  cands.push(path.resolve(SKILL_DIR, '..', '..', 'anima-tag-kb', '画师类'));
  cands.push(process.cwd());
  for (const c of cands) {
    if (c && fs.existsSync(path.join(c, 'manifest.json')) && fs.existsSync(path.join(c, 'search-index.json'))) {
      return path.resolve(c);
    }
  }
  console.error(`找不到词库目录（需要含 manifest.json + search-index.json）。试过：\n  ${cands.join('\n  ')}`);
  process.exit(1);
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const norm = (s) => String(s).trim().toLowerCase().replace(/[_]+/g, ' ').replace(/\s+/g, ' ');

// ── 参数 ────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) flags[key] = true;
    else { flags[key] = next; i += 1; }
  } else positional.push(a);
}
const asJson = !!flags.json;
const limit = Number(flags.limit || 60);
const KB = resolveKbDir(flags.kb === true ? null : flags.kb);

const index = readJson(path.join(KB, 'search-index.json'));
const manifest = readJson(path.join(KB, 'manifest.json'));
const rows = index.rows || [];
const F = ['tag', 'big', 'order', 'zh', 'aliases', 'weight', 'freq', 'confidence', 'sub', 'bigName', 'slot', 'official', 'mark'];
const col = (r, name) => r[F.indexOf(name)];
const mark = (r) => (r.length > 12 ? String(r[12] || '') : '');

// 索引：tag / 别名 / 中文 → 行号
const byTag = new Map();
const bySurface = new Map();
for (let i = 0; i < rows.length; i += 1) {
  const r = rows[i];
  byTag.set(norm(col(r, 'tag')), i);
  for (const s of [col(r, 'zh'), ...String(col(r, 'aliases') || '').split(/[\s,;|]+/)]) {
    const k = norm(s || '');
    if (k && !bySurface.has(k)) bySurface.set(k, i);
  }
}

// ── 子命令 ─────────────────────────────────────────────────
function stats() {
  const official = rows.filter((r) => Number(col(r, 'official')) === 1).length;
  const withFreq = rows.filter((r) => String(col(r, 'freq') || '').trim()).length;
  const noZh = rows.filter((r) => !String(col(r, 'zh') || '').trim()).length;
  const marks = new Map();
  for (const r of rows) { const m = mark(r); if (m) marks.set(m, (marks.get(m) || 0) + 1); }
  const out = {
    kb: KB,
    rows: rows.length,
    manifest_total: manifest?.meta?.total,
    delta_rows_minus_total: rows.length - (manifest?.meta?.total || 0),
    bigs: manifest?.meta?.bigs, subs: manifest?.meta?.subs,
    official_rows: official, freq_rows: withFreq, zh_missing_rows: noZh,
    supplements: (manifest?.meta?.supplements || []).map((s) => `${s.name}+${s.added}`),
    marks: Object.fromEntries(marks),
    fields: index.fields || [],
  };
  if (asJson) { console.log(JSON.stringify(out, null, 2)); return; }
  console.log(`词库：${out.kb}`);
  console.log(`索引行数：${out.rows}   manifest 记：${out.manifest_total}   增量（索引−manifest）：${out.delta_rows_minus_total}`);
  console.log(`大分类：${out.bigs}   小分类：${out.subs}   带官方标记的条目：${out.official_rows}   有投稿量：${out.freq_rows}   缺中文：${out.zh_missing_rows}`);
  console.log(`并入的增量批次：${out.supplements.join('  ')}`);
  console.log(`行内来源标记：${Object.entries(out.marks).map(([k, v]) => `${k}×${v}`).join('  ') || '（无）'}`);
  console.log(`列顺序：${out.fields.join(' | ') || F.join(' | ')}`);
}

function tree() {
  const cats = manifest?.categories || [];
  if (asJson) { console.log(JSON.stringify(cats.map((c) => ({ id: c.id, name: c.name, order: c.order, kind: c.kind, count: c.count, subs: c.subs })), null, 2)); return; }
  console.log(`${cats.length} 个大分类（${cats.filter((c) => c.kind === 'official').length} 官方组 + ${cats.filter((c) => c.kind !== 'official').length} 策展）：`);
  for (const c of cats) {
    console.log(`${String(c.order).padStart(2)}. ${c.name.padEnd(12, '　')} ${String(c.id).padEnd(28)} ${String(c.count).padStart(5)} 条 · ${(c.subs || []).length} 小分类`);
  }
}

function big(idOrName) {
  const cats = manifest?.categories || [];
  const c = cats.find((x) => x.id === idOrName) || cats.find((x) => (x.name || '').includes(idOrName));
  if (!c) { console.error(`没有这个分类：${idOrName}（用 --tree 看全部）`); process.exit(1); }
  if (asJson) { console.log(JSON.stringify(c, null, 2)); return; }
  console.log(`${c.name}（${c.id}）· ${c.count} 条 · order=${c.order} · 类型=${c.kind}`);
  for (const s of c.subs || []) console.log(`   ${String(s.name).padEnd(22, '　')} ${String(s.count).padStart(5)} 条`);
}

function lint() {
  const cats = manifest?.categories || [];
  const bigIds = new Set(cats.map((c) => c.id));
  const subOf = new Map(cats.map((c) => [c.id, new Set((c.subs || []).map((s) => String(s.name)))]));
  const classes = { 下划线标签: [], 括号不配平: [], 首尾异常: [], 太短: [], 重复标签: [], 大分类不存在: [], 小分类不在该大类下: [], 官方标记但不在官方组: [] };
  const seen = new Map();
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    const tag = String(col(r, 'tag') ?? '');
    const key = norm(tag);
    const open = (tag.match(/[(（]/g) || []).length;
    const close = (tag.match(/[)）]/g) || []).length;
    const rec = { row: i, tag, big: col(r, 'big'), sub: col(r, 'sub'), zh: col(r, 'zh') };
    if (tag.includes('_')) classes.下划线标签.push(rec);
    if (open !== close) classes.括号不配平.push(rec);
    if (!tag.trim() || tag !== tag.trim() || /^_|_$/.test(tag)) classes.首尾异常.push(rec);
    if (tag.trim().length <= 1) classes.太短.push(rec);
    if (seen.has(key)) classes.重复标签.push({ ...rec, 与第几行重复: seen.get(key) + 1 });
    else seen.set(key, i);
    if (!bigIds.has(col(r, 'big'))) classes.大分类不存在.push(rec);
    else if (!subOf.get(col(r, 'big')).has(String(col(r, 'sub')))) classes.小分类不在该大类下.push(rec);
    if (Number(col(r, 'official')) === 1 && !String(col(r, 'big')).startsWith('og:')) classes.官方标记但不在官方组.push(rec);
  }
  const summary = Object.fromEntries(Object.entries(classes).map(([k, v]) => [k, v.length]));
  if (asJson) {
    console.log(JSON.stringify({ kb: KB, rows: rows.length, summary, samples: Object.fromEntries(Object.entries(classes).map(([k, v]) => [k, v.slice(0, limit)])) }, null, 2));
    return;
  }
  console.log(`词库体检：${rows.length} 行`);
  for (const [k, v] of Object.entries(classes)) {
    console.log(`  ${k.padEnd(22, '　')} ${String(v.length).padStart(6)} 行`);
    for (const s of v.slice(0, limit)) {
      console.log(`      #${s.row + 1}  ${String(s.tag).padEnd(30)} ${String(s.zh || '-').padEnd(14, '　')} ${s.big || ''} / ${s.sub || ''}${s.与第几行重复 ? '（与第 ' + s.与第几行重复 + ' 行重复）' : ''}`);
    }
    if (v.length > limit) console.log(`      …其余 ${v.length - limit} 行（--limit N 看更多）`);
  }
}

function listSub(name) {
  const hit = rows.filter((r) => String(col(r, 'sub') || '').includes(name));
  if (!hit.length) { console.error(`没有小分类包含「${name}」（示例：--sub 手持道具 / --sub 服装 · 细则）`); process.exit(1); }
  if (asJson) { console.log(JSON.stringify(hit.map((r) => ({ tag: col(r, 'tag'), zh: col(r, 'zh'), freq: col(r, 'freq'), big: col(r, 'big') })), null, 2)); return; }
  console.log(`小分类含「${name}」共 ${hit.length} 条（显示前 ${Math.min(limit, hit.length)}）：`);
  for (const r of hit.slice(0, limit)) {
    console.log(`   ${String(col(r, 'tag')).padEnd(30)} ${String(col(r, 'zh') || '-').padEnd(18, '　')} freq=${String(col(r, 'freq') || '-').padEnd(8)} ${col(r, 'big')}`);
  }
}

function near(q) {
  const k = norm(q);
  const scored = [];
  for (let i = 0; i < rows.length; i += 1) {
    const t = norm(col(rows[i], 'tag'));
    const zh = String(col(rows[i], 'zh') || '');
    let s = 0;
    if (t === k) s = 100;
    else if (t.includes(k)) s = 60 - Math.abs(t.length - k.length);
    else if (zh.includes(q)) s = 50;
    else {
      const tk = k.split(' ').filter(Boolean);
      const tt = t.split(' ');
      if (tk.length && tk.every((w) => tt.some((x) => x.includes(w) || w.includes(x)))) s = 40;
    }
    if (s > 0) scored.push([s, i]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  const out = scored.slice(0, limit).map(([, i]) => {
    const r = rows[i];
    return { tag: col(r, 'tag'), zh: col(r, 'zh'), big: col(r, 'big'), sub: col(r, 'sub'), freq: col(r, 'freq'), mark: mark(r) };
  });
  if (asJson) { console.log(JSON.stringify(out, null, 2)); return; }
  if (!out.length) { console.log(`「${q}」没有任何近似条目。`); return; }
  console.log(`「${q}」的近似条目 ${out.length} 条：`);
  for (const o of out) console.log(`   ${String(o.tag).padEnd(32)} ${String(o.zh || '-').padEnd(20, '　')} freq=${String(o.freq || '-').padEnd(8)} ${o.big} / ${o.sub}`);
}

function check(items) {
  const hit = [];
  const miss = [];
  for (const raw of items) {
    const q = String(raw).trim();
    if (!q) continue;
    const k = norm(q);
    let idx = byTag.has(k) ? byTag.get(k) : undefined;
    let how = 'tag';
    if (idx === undefined && bySurface.has(k)) { idx = bySurface.get(k); how = 'zh/别名'; }
    if (idx === undefined) {
      const sug = [];
      for (let i = 0; i < rows.length && sug.length < 5; i += 1) {
        const t = norm(col(rows[i], 'tag'));
        if (t.includes(k) || k.includes(t)) sug.push(col(rows[i], 'tag'));
      }
      miss.push({ input: q, near: sug });
      continue;
    }
    const r = rows[idx];
    hit.push({
      input: q, matched_by: how, tag: col(r, 'tag'), zh: col(r, 'zh'), big: col(r, 'big'),
      sub: col(r, 'sub'), freq: col(r, 'freq'), official: Number(col(r, 'official')) ? 1 : 0,
      mark: mark(r), aliases: col(r, 'aliases'),
    });
  }
  if (asJson) { console.log(JSON.stringify({ total: hit.length + miss.length, hit: hit.length, miss: miss.length, hits: hit, misses: miss }, null, 2)); return; }
  console.log(`核查 ${hit.length + miss.length} 条：命中 ${hit.length} · 缺失 ${miss.length}`);
  for (const h of hit) {
    const src = h.official ? '官方组' : '策展';
    const mk = h.mark ? ` [${h.mark}]` : '';
    console.log(`   ✅ ${String(h.input).padEnd(24)} → ${String(h.tag).padEnd(30)} ${String(h.zh || '-').padEnd(16, '　')} ${h.big} / ${h.sub} · freq=${h.freq || '-'} · ${src}${mk}${h.matched_by !== 'tag' ? '（经' + h.matched_by + '命中）' : ''}`);
  }
  for (const m of miss) console.log(`   ❌ ${String(m.input).padEnd(24)} → 词库里没有${m.near.length ? '；近似：' + m.near.join(' / ') : ''}`);
}

function readItems() {
  if (flags.file) return fs.readFileSync(String(flags.file), 'utf8').replace(/^\uFEFF/, '').split(/[\r\n,]+/);
  if (typeof flags.check === 'string') return flags.check.split(/[\r\n,]+/);
  const chunks = positional.slice();
  if (chunks.length) return chunks;
  if (!process.stdin.isTTY) {
    try { return fs.readFileSync(0, 'utf8').split(/[\r\n,]+/); } catch { return []; }
  }
  return [];
}

// ── 分发 ───────────────────────────────────────────────────
if (flags.stats) stats();
else if (flags.tree) tree();
else if (flags.lint) lint();
else if (typeof flags.big === 'string') big(flags.big);
else if (typeof flags.sub === 'string') listSub(flags.sub);
else if (typeof flags.near === 'string') near(flags.near);
else if (flags.check || flags.file || positional.length) {
  const items = readItems();
  if (!items.filter((x) => String(x).trim()).length) {
    console.error('没给要核查的内容。示例：node tools/kb-audit.mjs --check "marble floor, blank sign"');
    process.exit(1);
  }
  check(items);
} else {
  console.log(`kb-audit —— 词库批量核查 / 维度普查（只读）

词库：${KB}    索引 ${rows.length} 行

用法：
  --stats                       规模、增量、supplements、行内列顺序
  --tree                        69 个大分类一览
  --big <id|名字>               某大分类下的小分类与计数
  --sub <小分类名>              该小分类下的标签（--limit N 控制条数）
  --near <词>                   不知道真名时的近似查找
  --lint                        词库体检：形态可疑行 / 重复 / 分类归属错位
  --check "a, b, c"             批量核查（也可 --file x.txt 或管道 stdin）
  任意命令加 --json             结构化输出
  任意命令加 --kb <词库目录>     显式指定词库（默认自动定位）`);
}
