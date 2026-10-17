/**
 * merge-anima3.mjs —— 把 ANIMA3 模板抄出来的标签并进主词库（可重跑、幂等）
 *
 * 背景：`画师类/` 是 `scripts/build-hierarchy.mjs` 的生成物，重跑构建会整目录覆盖，
 * 所以「照着外部模板补一批新标签」不能手改 json，得有一支**构建后合并**脚本：
 * 每次重跑构建之后，再跑一次本脚本即可把 ANIMA3 那批标签补回去（已存在的不会重复加）。
 *
 * 用法：
 *   node anima-tag-kb/scripts/merge-anima3.mjs            # 只报告，不写文件（默认）
 *   node anima-tag-kb/scripts/merge-anima3.mjs --write    # 真正写入
 *   node anima-tag-kb/scripts/merge-anima3.mjs --write --kb 画师类
 *
 * 输入：anima-tag-kb/data/anima3-tags.json
 *   { rows: [ { tag, zh, big, sub, tier, src } ] }    tier: '' | 'mid' | 'top'
 *   ＋ anima-tag-kb/data/anima3-rules.json 的 viewerClauses（模板 §4.5 八条观众句；
 *     它们在标签表里是自然语言、抓不到 token，所以从规则表补进 og:image-composition/视线）
 *
 * 写入（都在 画师类/ 下）：
 *   search-index.json   rows 追加 + cats[].count 同步
 *   bigs/<big>.json     items 追加（分片文件 <big>-1.json 也支持）
 *   manifest.json       meta.total / categories[].count / subs[].count
 * 备份：_backup/anima3-<ts>/（写入前先复制上述三个文件）
 * 报告：_merge/anima3-merge-<ts>.json
 *
 * 档位标记：新行第 13 个元素（下标 12）写 `anima3:mid` / `anima3:top` / `anima3:any`。
 * search-index 的 fields 只有 12 个（0–11），多出来的这个元素只是**来源 + 档位标记**，
 * 与既有的补充短语池行（第 13 个元素是来源串）同一套约定；技能侧 src/lexicon.mjs 读它当档位门，
 * 别的读表方（展板）只读 0–11，不受影响。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KB_ROOT = path.resolve(HERE, '..');
const argv = process.argv.slice(2);
const WRITE = argv.includes('--write');
const kbArg = (() => {
  const i = argv.indexOf('--kb');
  return i >= 0 ? argv[i + 1] : null;
})();
const KB_DIR = kbArg ? path.resolve(KB_ROOT, kbArg) : path.join(KB_ROOT, '画师类');
const SRC_FILE = path.join(KB_ROOT, 'data', 'anima3-tags.json');
const RULES_FILE = path.join(KB_ROOT, 'data', 'anima3-rules.json');
const SOURCE_LABEL = 'ANIMA3 提示词生成模板 v3.1';

/**
 * §4.5 的八条「观众句」在模板里是自然语言示例，抓标签时贡献 0（见 data/anima3-tags.json 的抽取报告），
 * 但用户裁决「这八条观众句也做成词库标签」，所以这里从规则表里补进主词库。
 * 归到 `og:image-composition`（构图·视角·技法）的「视线」小分类；档位按语义分：
 * 叙事类（逃走 / 审判 / 托付 / 求助）不挑档，观众互动带撩拨意味的四条按擦边（mid）起。
 */
const VIEWER_BIG = 'og:image-composition';
const VIEWER_SUB = '视线';
const VIEWER_TIER = ['', '', '', 'mid', '', 'mid', 'mid', 'mid'];

/** 词库侧的去重键：小写、下划线当空格、压缩空白（与技能 normalize.mjs#keyOf 同口径） */
const tagKey = s => String(s == null ? '' : s).trim().toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ');

const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v), 'utf8');

function die(msg) {
  console.error('[merge-anima3] ' + msg);
  process.exit(1);
}

// ---- 1. 读源 ----
if (!fs.existsSync(SRC_FILE)) die(`找不到源文件：${SRC_FILE}`);
const src = readJson(SRC_FILE);
const srcRows = Array.isArray(src.rows) ? src.rows : [];
if (!srcRows.length) die('源文件里没有 rows。');
// §4.5 观众句（模板里是自然语言，标签表里没有 → 从规则表补八条）
let clauseRows = [];
if (fs.existsSync(RULES_FILE)) {
  const rules = readJson(RULES_FILE);
  const list = Array.isArray(rules.viewerClauses) ? rules.viewerClauses : [];
  clauseRows = list.map((c, i) => ({
    tag: String(c && c.tag || '').trim(),
    zh: String(c && c.zh || '').trim(),
    big: VIEWER_BIG,
    sub: VIEWER_SUB,
    tier: VIEWER_TIER[i] || '',
    src: '§4.5'
  })).filter(r => r.tag);
}
for (const r of clauseRows) srcRows.push(r);
const idxFile = path.join(KB_DIR, 'search-index.json');
const manFile = path.join(KB_DIR, 'manifest.json');
if (!fs.existsSync(idxFile)) die(`找不到词库索引：${idxFile}`);
if (!fs.existsSync(manFile)) die(`找不到 manifest：${manFile}`);

const index = readJson(idxFile);
const man = readJson(manFile);
const rows = index.rows || [];
const cats = index.cats || [];
const categories = man.categories || [];

// ---- 2. 现有关键字集合 ----
const existing = new Map();      // tagKey → 主表行 tag（用于报告）
for (const r of rows) {
  const k = tagKey(r && r[0]);
  if (k && !existing.has(k)) existing.set(k, r[0]);
}

// ---- 3. 挑出要补的行 ----
const catById = new Map(categories.map(c => [c.id, c]));
const subNamesOf = c => new Set((c.subs || []).map(s => String(s.name || '').trim()));
const plan = [];
const skipped = [];              // 已在词库里（重复的不抄）
const badBig = [];
const badSub = [];
for (const raw of srcRows) {
  const tag = String(raw && raw.tag || '').trim();
  const key = tagKey(tag);
  if (!key) continue;
  if (existing.has(key)) { skipped.push(tag); continue; }
  const big = String(raw.big || '').trim();
  const cat = catById.get(big);
  if (!cat) { badBig.push(tag + ' → ' + big); continue; }
  let sub = String(raw.sub || '').trim();
  if (sub && !subNamesOf(cat).has(sub)) { if (sub !== cat.name) badSub.push(tag + ' → ' + big + ' / ' + sub); }
  if (!sub) sub = cat.name;
  const tier = String(raw.tier || '').trim().toLowerCase();
  const mark = tier === 'mid' || tier === 'top' ? 'anima3:' + tier : 'anima3:any';
  plan.push({
    tag,
    zh: String(raw.zh || '').trim(),
    big,
    bigName: cat.name || '其他',
    order: typeof cat.order === 'number' ? cat.order : 69,
    sub,
    tier: tier === 'mid' || tier === 'top' ? tier : '',
    mark,
    src: String(raw.src || '').trim()
  });
  existing.set(key, tag);        // 源文件内部也去重
}

// ---- 4. 报告（不写文件时到此为止）----
const byBig = new Map();
for (const p of plan) byBig.set(p.big, (byBig.get(p.big) || 0) + 1);
const tierCount = { '': 0, mid: 0, top: 0 };
for (const p of plan) tierCount[p.tier]++;

console.log(`[merge-anima3] 源文件 ${path.relative(KB_ROOT, SRC_FILE)}：${srcRows.length} 条${clauseRows.length ? `（其中 §4.5 观众句 ${clauseRows.length} 条取自 ${path.basename(RULES_FILE)}）` : ''}`);
console.log(`[merge-anima3] 主表现有 ${rows.length} 行 → 本次补 ${plan.length} 条（重复跳过 ${skipped.length} 条）`);
console.log(`[merge-anima3] 档位分布：不限 ${tierCount['']} / mid（sensitive 起）${tierCount.mid} / top（nsfw 起）${tierCount.top}`);
console.log(`[merge-anima3] 落到 ${byBig.size} 个大分类：`);
for (const [big, n] of [...byBig.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${big}  ${(catById.get(big) || {}).name || ''}  +${n}`);
}
if (badBig.length) console.log(`[merge-anima3] ⚠ ${badBig.length} 条 big 不在 manifest 清单里，已跳过：${badBig.slice(0, 5).join(' | ')}${badBig.length > 5 ? ' …' : ''}`);
if (badSub.length) console.log(`[merge-anima3] ⚠ ${badSub.length} 条 sub 不在该大分类的 subs 里（仍写入，只是 manifest 的 subs 计数不动）：${badSub.slice(0, 5).join(' | ')}${badSub.length > 5 ? ' …' : ''}`);
if (!WRITE) {
  console.log('[merge-anima3] 这是只读演练，什么也没写。加 --write 才真正写入。');
  process.exit(0);
}
if (!plan.length) {
  console.log('[merge-anima3] 没有要补的行，文件不动。');
  process.exit(0);
}

// ---- 5. 备份 ----
const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const backupDir = path.join(KB_ROOT, '_backup', 'anima3-' + ts);
fs.mkdirSync(backupDir, { recursive: true });
const touchedFiles = new Set();
for (const p of plan) {
  const f = bigFileOf(p.big);
  if (f) touchedFiles.add(f);
}
const backup = f => {
  const dest = path.join(backupDir, path.relative(KB_DIR, f).replace(/[\\/]/g, '__'));
  fs.copyFileSync(f, dest);
};
backup(idxFile);
backup(manFile);
for (const f of touchedFiles) backup(f);
console.log(`[merge-anima3] 备份写到 ${path.relative(KB_ROOT, backupDir)}/`);

// ---- 6. 找大分类的分片文件（build-hierarchy 超 3500 条会分片 <id>-1.json）----
function bigFileOf(big) {
  const exact = path.join(KB_DIR, 'bigs', big.replace(/^cb:/, 'cb-').replace(/^og:/, 'og-') + '.json');
  if (fs.existsSync(exact)) return exact;
  const dir = path.join(KB_DIR, 'bigs');
  if (!fs.existsSync(dir)) return null;
  const stem = big.replace(/^cb:/, 'cb-').replace(/^og:/, 'og-');
  const hit = fs.readdirSync(dir).find(f => f === stem + '.json' || new RegExp('^' + stem + '-\\d+\\.json$').test(f));
  return hit ? path.join(dir, hit) : null;
}

// ---- 7. 写：search-index / bigs / manifest ----
const bigItems = new Map();   // big → { file, doc }
for (const p of plan) {
  // 7a. search-index 行（与补充短语池行同形，第 13 个元素是来源+档位标记）
  rows.push([p.tag, p.big, p.order, p.zh, '', '', '', '待验证', p.sub, p.bigName, '', 0, p.mark]);
  // 7b. bigs item（下标含义见 manifest.meta.field_map）
  let slot = bigItems.get(p.big);
  if (!slot) {
    const f = bigFileOf(p.big);
    slot = f ? { file: f, doc: readJson(f) } : { file: null, doc: null };
    bigItems.set(p.big, slot);
  }
  if (slot.doc) {
    if (!Array.isArray(slot.doc.items)) slot.doc.items = [];
    slot.doc.items.push([
      p.tag, p.zh, null, null, '待验证', null, null, null, null, null,
      SOURCE_LABEL, 'anima3', p.sub, 0, p.tier === 'top' ? 1 : 0, null, null, p.big
    ]);
  }
  // 7c. manifest 计数
  const cat = catById.get(p.big);
  if (cat) {
    cat.count = (cat.count || 0) + 1;
    const s = (cat.subs || []).find(x => String(x.name || '').trim() === p.sub);
    if (s) s.count = (s.count || 0) + 1;
    const c2 = cats.find(x => x && x.id === p.big);
    if (c2) c2.count = (c2.count || 0) + 1;
  }
}
man.meta = man.meta || {};
man.meta.total = (man.meta.total || 0) + plan.length;
man.meta.supplements = (Array.isArray(man.meta.supplements) ? man.meta.supplements : []).concat([{
  name: 'anima3',
  file: 'data/anima3-tags.json',
  label: SOURCE_LABEL,
  added: plan.length,
  applied_at: new Date().toISOString(),
  script: 'scripts/merge-anima3.mjs'
}]);
index.rows = rows;
index.cats = cats;

writeJson(idxFile, index);
writeJson(manFile, man);
for (const [, slot] of bigItems) if (slot.doc) writeJson(slot.file, slot.doc);

// ---- 8. 合并报告 ----
const reportFile = path.join(KB_ROOT, '_merge', 'anima3-merge-' + ts + '.json');
fs.mkdirSync(path.dirname(reportFile), { recursive: true });
writeJson(reportFile, {
  merged_at: new Date().toISOString(),
  source_file: path.relative(KB_ROOT, SRC_FILE).replace(/\\/g, '/'),
  kb: path.relative(KB_ROOT, KB_DIR).replace(/\\/g, '/'),
  added: plan.length,
  skipped_duplicates: skipped.length,
  viewer_clauses_added: clauseRows.filter(r => plan.some(p => tagKey(p.tag) === tagKey(r.tag))).length,
  tier: tierCount,
  by_big: Object.fromEntries([...byBig.entries()]),
  bad_big: badBig,
  bad_sub: badSub,
  index_rows_after: rows.length,
  manifest_total_after: man.meta.total,
  bigs_written: [...bigItems.values()].filter(s => s.doc).map(s => path.relative(KB_ROOT, s.file).replace(/\\/g, '/'))
});
console.log(`[merge-anima3] 已写入：search-index.json（${rows.length} 行）、manifest.json（total ${man.meta.total}）、${[...bigItems.values()].filter(s => s.doc).length} 个大分类分片`);
console.log(`[merge-anima3] 报告：${path.relative(KB_ROOT, reportFile).replace(/\\/g, '/')}`);
