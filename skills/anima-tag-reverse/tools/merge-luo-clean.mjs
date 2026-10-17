#!/usr/bin/env node
/**
 * merge-luo-clean.mjs —— 把「Luo-fe 635 条」严格分流进本地 Anima 词库（第 4 期 ③）
 *
 * 设计口径（docs/anima-tag-reverse-v2-设计方案.md §5 / §10 第 4 期）：
 *   · 只收 `status === "clean"` 的候选（tokenVariant / aliasWord / flatVariant / noise 一律淘汰）
 *   · ≤2 token 的进**主索引**（anima-tag-kb/画师类/search-index.json，追加在 rows 末尾）
 *   · ≥3 token 的进**补充短语池**（anima-tag-kb/补充短语池/phrase-pool.json，技能侧按 lexicon.poolEnabled 读）
 *   · 黑名单先行：Luo-fe 仓库 validate_prompt_md.py 的 BANNED_TAGS（pubic hair 系 + 打码词）
 *   · 只增不改：不重排既有行、不动 manifest.json 与 bigs/*.json
 *   · 来源可追：每条新增都带 `src: "luo-fe"`，报告文件能按来源回滚
 *
 * 用法：
 *   node tools/merge-luo-clean.mjs --dry-run            # 默认档：只出清单，不写一个字节
 *   node tools/merge-luo-clean.mjs --apply              # 备份 → 追加 → 写池 → 写报告
 *   node tools/merge-luo-clean.mjs --report             # 看最近一次 apply 的报告
 *   node tools/merge-luo-clean.mjs --rollback           # 按最近一次报告回滚（删掉 luo-fe 增量）
 *   可选：--kb <目录>  --classified <文件>  --json  --quiet
 *
 * 零第三方依赖；只读 classified + 词库，写入前一定先备份。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(SKILL_ROOT, '..', '..');

export const SRC_TAG = 'luo-fe';
export const POOL_DIR = '补充短语池';
export const POOL_FILE = path.join(POOL_DIR, 'phrase-pool.json');
export const MERGE_DIR = '_merge';
export const BACKUP_DIR = '_backup';

/** Luo-fe 仓库的黑名单原样搬过来（aniprompt-skill-main/scripts/validate_prompt_md.py:28-32） */
export const BANNED_TAGS = Object.freeze([
  'pubic hair', 'female pubic hair', 'male pubic hair', 'pubic hairless',
  'hairless pussy', 'censored', 'mosaic censoring', 'bar censor'
]);
/** 判定用的正则：Luo-fe 那 8 条 + 一个刻意放宽的 `pubic` 系词（wax on pubic area 这类除毛标签） */
const BANNED_RE = /pubic|hairless pussy|censored|mosaic censoring|bar censor/i;

/**
 * 语义桶 → 本地大分类 / 小分类（sub 必须是该大分类里真实存在的 subs 名，
 * 否则看板会把它归到「其他」甚至不显示）。第二级规则只用来把明显属于另一个 sub 的词挑出来。
 */
export const BUCKET_MAP = Object.freeze({
  '人数/规模': { big: 'cb:base', sub: '人数与画面规模' },
  '性行为/成人': { big: 'cb:nsfw', sub: '性行为' },
  '动作/姿势': { big: 'og:posture', sub: '其他' },
  '服装/配饰': { big: 'og:attire', sub: '其他' },
  '表情/情绪': { big: 'og:face', sub: '情绪' },
  '视角/构图': { big: 'og:image-composition', sub: '其他' },
  '场景/背景/光影': { big: 'og:backgrounds', sub: '其他' },
  '身体特征/外观': { big: 'og:body-parts', sub: '其他' },
  '其他/未分类': { big: 'cb:misc', sub: '其他' }
});

/**
 * 桶内细分：命中第一条正则就用它的 sub（第三条是可选的换 big）。
 * 注意 sub 必须是那个大分类里真实存在的 subs 名，否则看板会把它归到「其他」甚至不显示；
 * 「场景/背景/光影」这个桶混了两种词，光影词要换到 og:lighting 去，否则 sub 名对不上。
 */
const SUB_RULES = Object.freeze({
  '视角/构图': [
    [/view|angle|shot|lens|focus|perspectiv|camera|close-?up|zoom/i, '视角与镜头'],
    [/composition|framing|centered|symmetr|rule of thirds|balance/i, '构图 · 精选']
  ],
  '表情/情绪': [
    [/expression|face|smile|smirk|grin|frown|pout|blush|tear|cry|crying|sweat|mouth/i, '表情']
  ],
  '场景/背景/光影': [
    [/light|lit|glow|shadow|silhouette|lamp|dim|bright|backlit|fluorescent|neon/i, '光影氛围', 'og:lighting'],
    [/sun|dusk|dawn|night|day|season|rain|snow|cloud|sky|weather/i, '天气与时间']
  ],
  '身体特征/外观': [
    [/body|chest|breast|nipple|thigh|leg|arm|hand|finger|belly|waist|hip|butt|skin|muscle/i, '身体部位']
  ]
});

export const flatKey = (s) => String(s || '').toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();
const wordKey = (s) => flatKey(s).replace(/ /g, '');
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** 归类：桶 → {big}；未知桶落 cb:misc */
export function bigOf(bucket) {
  return (BUCKET_MAP[bucket] || BUCKET_MAP['其他/未分类']).big;
}

/** 用候选词本身（不是桶名）挑 sub —— 只返回 sub */
export function pickSub(bucket, tag) {
  return pickTarget(bucket, tag).sub;
}

/** 用候选词本身挑落点：{ big, sub }（有的桶会按词形换大分类，例如光影词进 og:lighting） */
export function pickTarget(bucket, tag) {
  const base = BUCKET_MAP[bucket] || BUCKET_MAP['其他/未分类'];
  const rules = SUB_RULES[bucket];
  if (rules) for (const [re, sub, big] of rules) if (re.test(tag)) return { big: big || base.big, sub };
  return { big: base.big, sub: base.sub };
}

export function loadKb(kbDir) {
  const idxFile = path.join(kbDir, 'search-index.json');
  const manFile = path.join(kbDir, 'manifest.json');
  if (!fs.existsSync(idxFile)) throw new Error(`找不到词库索引：${idxFile}`);
  const idx = JSON.parse(fs.readFileSync(idxFile, 'utf8'));
  const man = fs.existsSync(manFile) ? JSON.parse(fs.readFileSync(manFile, 'utf8')) : {};
  return { idx, man, idxFile, manFile };
}

/**
 * 本地已有的判定材料：整表键集合 + 含逗号的长串预设。
 * poolRows 传进来时，池里已有的标签也算「本地已有」——否则重复 --apply 会把同一条池短语再加一遍。
 */
export function localFacts(rows, poolRows = []) {
  const keys = new Set();
  const words = new Set();
  const presets = [];
  for (const r of rows) {
    const tag = r[0] || '';
    keys.add(flatKey(tag));
    words.add(wordKey(tag));
    if (tag.includes(',')) {
      presets.push(' ' + flatKey(tag).replace(/[,:;|/]+/g, ' ').replace(/\s+/g, ' ') + ' ');
    }
  }
  for (const r of poolRows) keys.add(flatKey(r && r.tag));
  return { keys, words, presets };
}

/**
 * 分流一批候选：返回 { plan: [...], skipped: [...] }，纯函数、不碰磁盘。
 * plan 项：{ tag, bucket, target: 'main'|'pool', big, sub, tokens, src }
 */
export function planMerge(classified, facts, opts = {}) {
  const maxTokens = opts.maxMainTokens ?? 2;
  const plan = [];
  const skipped = [];
  const seen = new Set();
  for (const it of classified) {
    const tag = flatKey(it.tag);
    const tokens = tag ? tag.split(' ').length : 0;
    const push = (reason, extra = '') => skipped.push({ tag: it.tag, bucket: it.bucket, status: it.status, reason, why: extra });
    if (!tag) { push('empty'); continue; }
    if (it.status !== 'clean') { push('status', `${it.status}${it.why ? '：' + it.why : ''}`); continue; }
    if (BANNED_TAGS.includes(tag) || BANNED_RE.test(tag)) { push('banned', 'Luo-fe BANNED_TAGS（含 pubic 系词放宽）'); continue; }
    if (seen.has(tag)) { push('duplicate', '同批重复'); continue; }
    if (facts.keys.has(tag) || facts.words.has(wordKey(tag))) { push('exists', '本地整表已有'); continue; }
    const needle = ' ' + tag + ' ';
    const host = facts.presets.find(p => p.includes(needle));
    if (host) { push('preset', '已出现在本地长串预设里'); continue; }
    seen.add(tag);
    const target = pickTarget(it.bucket, tag);
    plan.push({
      tag, bucket: it.bucket, status: it.status,
      target: tokens <= maxTokens ? 'main' : 'pool',
      tokens, big: target.big, sub: target.sub, src: SRC_TAG
    });
  }
  return { plan, skipped };
}

function fmtTable(plan) {
  const byKey = new Map();
  for (const p of plan) {
    const k = `${p.target} · ${p.big} / ${p.sub}`;
    byKey.set(k, (byKey.get(k) || 0) + 1);
  }
  return [...byKey].sort();
}

/** 落点校验：每个 (big, sub) 必须能在词库 cats 里找到（否则看板会把这行归到「其他」甚至不显示） */
export function checkTargets(plan, cats) {
  // 两种形状都要吃：search-index.json 的 cats[].subs 是字符串数组，manifest 的是 {name,count}
  const subName = (s) => (typeof s === 'string' ? s : (s && s.name) || '');
  const byId = new Map((cats || []).map(c => [c.id, new Set((c.subs || []).map(subName))]));
  const bad = [];
  for (const p of plan) {
    const subs = byId.get(p.big);
    if (!subs) bad.push({ tag: p.tag, big: p.big, sub: p.sub, why: '大分类不存在' });
    else if (!subs.has(p.sub)) bad.push({ tag: p.tag, big: p.big, sub: p.sub, why: '小分类不在该大分类下' });
  }
  return bad;
}

function latestReport(kbDir) {
  const dir = path.join(path.dirname(kbDir), MERGE_DIR);
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter(f => /^luo-clean-.*\.json$/.test(f)).sort();
  return files.length ? path.join(dir, files[files.length - 1]) : null;
}

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

/** 同一秒里连跑两次时给名字加 -2 / -3，避免覆盖掉上一次的备份或报告 */
function uniqueFile(file) {
  if (!fs.existsSync(file)) return file;
  const dir = path.dirname(file);
  const ext = path.extname(file);
  const stem = path.basename(file, ext);
  for (let n = 2; n < 100; n++) {
    const cand = path.join(dir, `${stem}-${n}${ext}`);
    if (!fs.existsSync(cand)) return cand;
  }
  return file;
}

/** 追加后写回：保持 search-index.json 原有的「单行压缩」格式 */
function writeIndex(idxFile, idx) {
  fs.writeFileSync(idxFile, JSON.stringify(idx));
}

export function buildPoolDoc(rows, kbDir, ts) {
  return {
    schema: 'anima-tag-reverse/phrase-pool@1',
    built_at: ts,
    source: SRC_TAG,
    note: '≥3 token 的长短语候选，只在技能侧 lexicon.poolEnabled / --pool 打开时参与召回；不进主索引',
    fields: ['tag', 'big', 'sub', 'bucket', 'tokens', 'src'],
    rows
  };
}

export function runApply({ kbDir, classified, plan, skipped }) {
  const { idx, idxFile } = loadKb(kbDir);
  const cats = new Map((idx.cats || []).map(c => [c.id, c]));
  const ts = stamp();

  const mainPlan = plan.filter(p => p.target === 'main');
  const poolPlan = plan.filter(p => p.target === 'pool');

  // 幂等：一条都不加就不要动盘（不备份、不重写、不留报告，免得把上一次的报告顶掉）
  if (!mainPlan.length && !poolPlan.length) {
    return { noop: true, report: null, reportFile: null, backupFile: null, poolFile: null, rows: idx.rows.length };
  }

  const before = fs.readFileSync(idxFile);
  const backupDir = path.join(path.dirname(kbDir), BACKUP_DIR);
  fs.mkdirSync(backupDir, { recursive: true });
  const backupFile = uniqueFile(path.join(backupDir, `search-index.${ts}.json`));
  fs.copyFileSync(idxFile, backupFile);

  for (const p of mainPlan) {
    const cat = cats.get(p.big) || {};
    // 字段顺序与既有行一致：tag, big, order, zh, aliases, weight, freq, confidence, sub, bigName, slot, official
    // 第 13 个元素是增量标记（lexicon.mjs 只读前 12 个，多余元素被忽略）
    idx.rows.push([p.tag, p.big, cat.order ?? 69, '', '', '', '', '待验证', p.sub, cat.name || '其他', '', 0, SRC_TAG]);
  }
  writeIndex(idxFile, idx);

  // 池文件按标签合并：别的来源已经写进去的行不许被这次覆盖掉
  const poolFile = path.join(path.dirname(kbDir), POOL_FILE);
  const oldPool = fs.existsSync(poolFile) ? (JSON.parse(fs.readFileSync(poolFile, 'utf8').replace(/^\uFEFF/, '')).rows || []) : [];
  const have = new Set(oldPool.map(r => flatKey(r && r.tag)));
  const fresh = poolPlan.filter(p => !have.has(flatKey(p.tag)));
  const poolRows = [
    ...oldPool,
    ...fresh.map(p => ({ tag: p.tag, big: p.big, sub: p.sub, bucket: p.bucket, tokens: p.tokens, src: SRC_TAG }))
  ];
  if (fresh.length) {
    fs.mkdirSync(path.dirname(poolFile), { recursive: true });
    fs.writeFileSync(poolFile, JSON.stringify(buildPoolDoc(poolRows, kbDir, ts), null, 2) + '\n');
  }

  const after = fs.readFileSync(idxFile);
  const report = {
    schema: 'anima-tag-reverse/luo-merge-report@1',
    tool: 'tools/merge-luo-clean.mjs',
    source: SRC_TAG,
    applied_at: new Date().toISOString(),
    kb_dir: kbDir,
    classified_file: classified,
    backup: backupFile,
    before: { rows: before ? JSON.parse(before.toString('utf8')).rows.length : 0, sha256: sha256(before) },
    after: { rows: idx.rows.length, sha256: sha256(after) },
    added: { main: mainPlan.map(p => ({ tag: p.tag, big: p.big, sub: p.sub, bucket: p.bucket })),
      pool: fresh.map(p => ({ tag: p.tag, big: p.big, sub: p.sub, bucket: p.bucket, tokens: p.tokens })) },
    skipped,
    counts: {
      classified: plan.length + skipped.length,
      addedMain: mainPlan.length,
      addedPool: fresh.length,
      skipped: skipped.length
    }
  };
  const mergeDir = path.join(path.dirname(kbDir), MERGE_DIR);
  fs.mkdirSync(mergeDir, { recursive: true });
  const reportFile = uniqueFile(path.join(mergeDir, `luo-clean-${ts}.json`));
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
  return { report, reportFile, backupFile, poolFile };
}

export function runRollback({ kbDir, reportFile }) {
  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  const { idx, idxFile } = loadKb(kbDir);
  const drop = new Set(report.added.main.map(a => a.tag));
  const keepTag = new Set(report.added.pool.map(a => a.tag));
  const before = idx.rows.length;
  idx.rows = idx.rows.filter(r => !(r[12] === SRC_TAG && drop.has(flatKey(r[0]))));
  const after = idx.rows.length;
  writeIndex(idxFile, idx);

  const poolFile = path.join(path.dirname(kbDir), POOL_FILE);
  let poolRemoved = 0;
  if (fs.existsSync(poolFile)) {
    const doc = JSON.parse(fs.readFileSync(poolFile, 'utf8'));
    const rows = Array.isArray(doc.rows) ? doc.rows : [];
    const kept = rows.filter(r => !keepTag.has(flatKey(r.tag)));
    poolRemoved = rows.length - kept.length;
    if (kept.length) {
      doc.rows = kept;
      doc.built_at = stamp();
      fs.writeFileSync(poolFile, JSON.stringify(doc, null, 2) + '\n');
    } else {
      fs.rmSync(poolFile);
    }
  }
  const out = { rolledBack: true, report: reportFile, rowsBefore: before, rowsAfter: after, removed: before - after, poolRemoved };
  const mergeDir = path.join(path.dirname(kbDir), MERGE_DIR);
  fs.mkdirSync(mergeDir, { recursive: true });
  fs.writeFileSync(path.join(mergeDir, `rollback-${stamp()}.json`), JSON.stringify(out, null, 2) + '\n');
  return out;
}

// ---------------------------------------------------------------- CLI

function parseArgs(argv) {
  const o = { mode: 'dry-run' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--kb') o.kb = next();
    else if (a === '--classified') o.classified = next();
    else if (a === '--apply') o.mode = 'apply';
    else if (a === '--dry-run') o.mode = 'dry-run';
    else if (a === '--report') o.mode = 'report';
    else if (a === '--rollback') { o.mode = 'rollback'; if (argv[i + 1] && !argv[i + 1].startsWith('--')) o.reportFile = argv[++i]; }
    else if (a === '--json') o.json = true;
    else if (a === '--quiet') o.quiet = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`未知参数：${a}（--help 看用法）`);
  }
  return o;
}

function defaultKb(opt) {
  if (opt.kb) return path.resolve(opt.kb);
  const guess = path.join(REPO_ROOT, 'anima-tag-kb', '画师类');
  if (fs.existsSync(path.join(guess, 'search-index.json'))) return guess;
  throw new Error('找不到词库目录，请显式写 --kb <anima-tag-kb/画师类>');
}

function defaultClassified(opt) {
  if (opt.classified) return path.resolve(opt.classified);
  const guess = path.join(REPO_ROOT, 'anima-skill-refs', '_diff', 'luo-only-classified.json');
  if (fs.existsSync(guess)) return guess;
  throw new Error('找不到候选清单，请显式写 --classified <luo-only-classified.json>');
}

const HELP = `merge-luo-clean.mjs —— Luo-fe 635 条严格分流（第 4 期 ③）

用法：
  node tools/merge-luo-clean.mjs --dry-run     只出清单（默认档，不写盘）
  node tools/merge-luo-clean.mjs --apply       备份 → 追加主索引 → 写短语池 → 写报告
  node tools/merge-luo-clean.mjs --report      打印最近一次 apply 的报告
  node tools/merge-luo-clean.mjs --rollback    按最近一次报告删掉 luo-fe 增量

规则：
  · status=clean 才收；≤2 token 进主索引，≥3 token 进「补充短语池」
  · 黑名单先行（Luo-fe BANNED_TAGS：pubic hair 系 + 打码词）
  · 本地已有 / 已出现在长串预设里的候选跳过
  · 只追加、不重排；manifest.json 与 bigs/*.json 不动
`;

export function main(argv = process.argv.slice(2)) {
  const opt = parseArgs(argv);
  if (opt.help) { console.log(HELP); return 0; }
  const kbDir = defaultKb(opt);

  if (opt.mode === 'report') {
    const f = opt.reportFile || latestReport(kbDir);
    if (!f) { console.log('没有找到报告（还没执行过 --apply）'); return 1; }
    const r = JSON.parse(fs.readFileSync(f, 'utf8'));
    console.log(`报告：${f}`);
    console.log(`  时间：${r.applied_at}    词库：${r.kb_dir}`);
    console.log(`  行数：${r.before.rows} → ${r.after.rows}（+${r.added.main.length}）`);
    console.log(`  短语池：+${r.added.pool.length}    跳过：${r.counts.skipped}`);
    const skipBy = new Map();
    for (const s of r.skipped) skipBy.set(s.reason, (skipBy.get(s.reason) || 0) + 1);
    console.log('  跳过原因：' + [...skipBy].map(([k, v]) => `${k} ${v}`).join(' · '));
    console.log(`  备份：${r.backup}`);
    return 0;
  }

  if (opt.mode === 'rollback') {
    const f = opt.reportFile || latestReport(kbDir);
    if (!f) { console.log('没有找到报告，无法回滚（可写 --rollback <报告文件>）'); return 1; }
    const out = runRollback({ kbDir, reportFile: f });
    console.log(`回滚完成：行数 ${out.rowsBefore} → ${out.rowsAfter}（删 ${out.removed} 条），短语池删 ${out.poolRemoved} 条`);
    return 0;
  }

  const classifiedFile = defaultClassified(opt);
  const classified = JSON.parse(fs.readFileSync(classifiedFile, 'utf8').replace(/^\uFEFF/, ''));
  const { idx } = loadKb(kbDir);
  const poolFile = path.join(path.dirname(kbDir), POOL_FILE);
  const poolRows = fs.existsSync(poolFile)
    ? (JSON.parse(fs.readFileSync(poolFile, 'utf8').replace(/^\uFEFF/, '')).rows || [])
    : [];
  const facts = localFacts(idx.rows || [], poolRows);
  const { plan, skipped } = planMerge(classified, facts);
  const mainPlan = plan.filter(p => p.target === 'main');
  const poolPlan = plan.filter(p => p.target === 'pool');
  const badTargets = checkTargets(plan, idx.cats || []);

  if (opt.json) {
    console.log(JSON.stringify({
      mode: opt.mode, kbDir, classifiedFile,
      counts: { classified: classified.length, addedMain: mainPlan.length, addedPool: poolPlan.length, skipped: skipped.length },
      byTarget: fmtTable(plan),
      skipByReason: [...skipped.reduce((m, s) => m.set(s.reason, (m.get(s.reason) || 0) + 1), new Map())],
      badTargets,
      main: mainPlan, pool: poolPlan, skipped
    }, null, 2));
  } else {
    console.log(`# Luo-fe 分流${opt.mode === 'apply' ? '（apply）' : '（dry-run）'}`);
    console.log(`候选：${classifiedFile}`);
    console.log(`词库：${kbDir}（现有 ${idx.rows.length} 行）`);
    console.log('');
    console.log(`加主索引 ${mainPlan.length} 条：`);
    for (const [k, v] of fmtTable(mainPlan)) console.log(`  ${String(v).padStart(3)}  ${k}`);
    console.log(`短语池 ${poolPlan.length} 条：`);
    for (const [k, v] of fmtTable(poolPlan)) console.log(`  ${String(v).padStart(3)}  ${k}`);
    const skipBy = skipped.reduce((m, s) => m.set(s.reason, (m.get(s.reason) || 0) + 1), new Map());
    console.log(`跳过 ${skipped.length} 条：` + [...skipBy].map(([k, v]) => `${k} ${v}`).join(' · '));
    console.log(badTargets.length
      ? `落点校验：✗ ${badTargets.length} 个落点在大分类里查不到 `
      + `${[...new Set(badTargets.map(b => `${b.big} / ${b.sub}`))].join('、')}`
      : `落点校验：✓ ${new Set(plan.map(p => p.big + '/' + p.sub)).size} 个 (大分类 / 小分类) 落点全部存在`);
    if (!opt.quiet) {
      console.log('\n跳过明细（前 40 条）：');
      for (const s of skipped.slice(0, 40)) console.log(`  - [${s.reason}] ${s.tag}${s.why ? '（' + s.why + '）' : ''}`);
    }
  }

  if (opt.mode === 'apply') {
    const out = runApply({ kbDir, classified: classifiedFile, plan, skipped });
    // --json 时机器要读 stdout，人类那几行走 stderr，别把 JSON 弄脏
    const say = opt.json ? console.error : console.log;
    if (out.noop) {
      say(`没有新增：${idx.rows.length} 行原样不动（全部已存在或被跳过），未写盘`);
      return 0;
    }
    say('');
    say(`已写入：主索引 ${out.report.before.rows} → ${out.report.after.rows} 行，短语池 ${out.report.added.pool.length} 条`);
    say(`备份：${out.backupFile}`);
    say(`报告：${out.reportFile}`);
    return 0;
  }
  (opt.json ? console.error : console.log)('\n（dry-run：没有写任何文件；要落盘请加 --apply）');
  return 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]).startsWith(HERE);
if (invokedDirectly) {
  try {
    process.exitCode = main();
  } catch (e) {
    console.error('出错：' + (e && e.message ? e.message : e));
    process.exitCode = 1;
  }
}
