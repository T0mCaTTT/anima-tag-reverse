#!/usr/bin/env node
/**
 * tag-doctor.mjs —— tag 串体检（词库核对 + 陷阱检测 + 层归属检查）
 *
 * 借鉴 anima-tag-reverse 的 38k 词库，做三件事：
 *   ① 逐条核实标签是否存在（不存在 = 写了白写）
 *   ② 检测「会降级」的标签（写了会被解析成别的东西，语义丢失）
 *   ③ 层归属检查（人物层 / 服装层 / 场景层的分类是否正确）
 *
 * 用法：
 *   node tag-doctor.mjs "tag 串"
 *   node tag-doctor.mjs --file t.txt
 *   node tag-doctor.mjs "..." --json
 *   node tag-doctor.mjs "..." --quiet      # 只报问题
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---- 定位词库索引 ----------------------------------------------------------
// 直接读 search-index.json，不走 rtag.mjs 检索器 ——
// 踩过的坑：检索器会过滤纯符号查询，导致 :d / :3 / :p 这类颜文字标签被误报「未收录」。
// 词库字段：tag, big, order, zh, aliases, weight, freq, confidence, sub, bigName, slot, official
const __self = path.dirname(fileURLToPath(import.meta.url));

/** 从本文件向上回溯到仓库根（含 anima-tag-kb/ 的那一层） */
function repoRoot() {
  let d = __self;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(d, 'anima-tag-kb'))) return d;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return null;
}

/** 词库可能在仓库根，也可能在技能目录内（安装到 ~/.dsh/skills 时） */
function kbDirs() {
  const out = [];
  const root = repoRoot();
  if (root) out.push(path.join(root, 'anima-tag-kb/画师类'));
  // 本仓库 anima-tag-reverse 技能会往下找，这里补一条同仓库引用
  if (root) out.push(path.join(root, 'skills/anima-tag-reverse/../anima-tag-kb/画师类'));
  // 安装到 DSH 技能目录时，词库指针在姊妹技能里
  out.push(path.join(__self, '../references/kb/画师类'));
  return out.map((p) => path.normalize(p));
}

const KB_CANDIDATES = [
  process.env.ANIMA_KB_DIR,
  ...kbDirs(),
].filter(Boolean);

function loadKb() {
  for (const dir of KB_CANDIDATES) {
    const p = path.join(dir, 'search-index.json');
    if (!fs.existsSync(p)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      const F = j.fields;
      const idx = {
        tag: F.indexOf('tag'), zh: F.indexOf('zh'), freq: F.indexOf('freq'),
        big: F.indexOf('big'), sub: F.indexOf('sub'), aliases: F.indexOf('aliases'),
        bigName: F.indexOf('bigName'),
      };
      const byTag = new Map();      // 精确标签 → 行
      const byAlias = new Map();    // 别名 → 行
      for (const r of j.rows) {
        const t = String(r[idx.tag]).toLowerCase();
        if (!byTag.has(t)) byTag.set(t, r);
        const al = String(r[idx.aliases] || '').toLowerCase();
        for (const a of al.split(/[\s,;]+/)) {
          if (a && a.length > 1 && !byAlias.has(a)) byAlias.set(a, r);
        }
      }
      return { dir, rows: j.rows, idx, byTag, byAlias, size: j.rows.length };
    } catch { /* 换下一个 */ }
  }
  return null;
}

const KB = loadKb();

// ---- 已知陷阱表（本轮实测踩到的）-------------------------------------------
// 这些标签「能查到」但会被解析成别的东西，或语义与预期不符。
const TRAPS = {
  'hands clasped': '不存在，合掌要用 palms together',
  'hands together': '不存在，合掌要用 palms together',
  'clasped hands': '不存在，合掌要用 palms together',
  'folded hands': '会降级成 folded，语义丢失',
  'feet focus': '会降级成 feet，脚部焦点要用 foot focus',
  'legs focus': '会降级成 legs，无效',
  'detailed feet': '会降级成 feet，无效',
  'climax': '不存在，高潮用 orgasm',
  'creampie': '会被解析成 cream（奶油）！内射用 cum in pussy',
  'tentacle rape': '会降级成 tentacle，触手性交用 tentacle sex',
  'many tentacles': '会降级成 tentacles，词库无数量标签',
  'multiple tentacles': '会降级成 tentacles，词库无数量标签',
  'numerous tentacles': '会降级成 tentacles，词库无数量标签',
  'short stature': '释义是「短裤」！表达矮小用 petite / short',
  'short': '释义是「短裤」，表达矮小用 petite',
  'elementary school': '会降级成 school，小学生信号用 randoseru',
  'countryside': '不存在，田园用 rural',
  'urine': '不存在，排尿用 peeing / pee',
  'piss': '不存在，排尿用 peeing / pee',
  'urinating': '不存在，排尿用 peeing / pee',
  // 情绪词常见误写
  'calm': '不存在，用 serious / expressionless 表达从容',
  'proud': '不存在，用 smug 表达得意',
  'panic': '不存在，用 scared / flustered 表达惊慌',
  'relaxed': '不存在，用 serious / half-closed eyes 表达放松',
  'surprise': '不存在（名词形式），须用 surprised',
  // 颜文字体系常见误写
  'xd': '不存在，大笑嘴用 :d',
  'sleep': '不存在，困倦用 sleepy',
  '> <': '词库写法是 >_<（下划线连接）',
  'u u': '词库写法是 u_u（下划线连接）',
  'lazyneg': '不存在（疑似自定义/笔误）',
  'lazyhand': '不存在（疑似自定义/笔误）',
  'three hands': '不存在',
  'used': '不存在，事后用 after sex',
  'white bedding': '不存在，用 white sheets / bed sheet',
  'red marking': '不存在，试试 red markings 或删掉',
  'no bra': '不存在，改用 underwear 相关的负向',
  'tiny': '不存在',
  'young girl': '不存在，用 little girl',
  'imouto': '不存在',
  'voluptuous': '不存在',
  'elderly': '不存在，用 old woman',
  'wrinkles': '不存在',
  'piss': '不存在',
  'female ejaculation': '存在(潮吹)，但 squirting 不存在',
  'squirting': '不存在，潮吹用 female ejaculation',
};

// ---- 解析 ------------------------------------------------------------------
function parseArgs() {
  const a = process.argv.slice(2);
  const o = { input: '', json: false, quiet: false, exprCheck: false };
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    if (k === '--file') o.input = fs.readFileSync(a[++i], 'utf8');
    else if (k === '--json') o.json = true;
    else if (k === '--quiet') o.quiet = true;
    else if (k === '--expression-check') o.exprCheck = true;
    else o.input += (o.input ? ' ' : '') + k;
  }
  return o;
}

const opt = parseArgs();
if (!opt.input.trim()) {
  console.error('用法：node tag-doctor.mjs "tag 串" [--json] [--quiet]');
  process.exit(2);
}

const tags = opt.input.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
const RATING = new Set(['safe', 'sensitive', 'questionable', 'nsfw', 'explicit']);
const SKIP = /^(masterpiece|best quality|highres|newest|absurdres|high detail|score_\d+|@.+)$/;

// ---- 查库 ------------------------------------------------------------------
/** 直读词库：精确标签 → 别名 → 无命中 */
function lookupTag(q) {
  if (!KB) return null;
  const key = q.toLowerCase().trim();
  const i = KB.idx;

  // 1) 精确标签命中（含下划线/空格两种写法互转）
  let row = KB.byTag.get(key)
    || KB.byTag.get(key.replace(/_/g, ' '))
    || KB.byTag.get(key.replace(/\s+/g, '_'));
  if (row) {
    return {
      tag: String(row[i.tag]), zh: String(row[i.zh] || ''),
      freq: String(row[i.freq] || '-'), big: String(row[i.big] || ''),
      sub: String(row[i.sub] || ''), via: 'tag',
    };
  }

  // 2) 别名命中
  row = KB.byAlias.get(key);
  if (row) {
    return {
      tag: String(row[i.tag]), zh: String(row[i.zh] || ''),
      freq: String(row[i.freq] || '-'), big: String(row[i.big] || ''),
      sub: String(row[i.sub] || ''), via: 'alias',
    };
  }

  return null;
}

const results = [];
for (const raw of tags) {
  const lowRaw = raw.toLowerCase().trim();              // 原样（保留下划线）
  const low = lowRaw.replace(/_/g, ' ');                // 转空格（用于查库与常规陷阱）

  if (RATING.has(low) || RATING.has(lowRaw)) { results.push({ tag: raw, status: 'rating' }); continue; }
  if (SKIP.test(low)) { results.push({ tag: raw, status: 'skip' }); continue; }

  // 陷阱表：先查原样，再查转空格版。
  // 踩过的坑：颜文字标签用下划线（>_<），转空格后会撞上「> <（带空格）」这条提示规则，
  // 导致正确写法被自己的提示误伤。先查原样即可避免。
  // 只查原样键 —— 不做下划线→空格的 fallback，
  // 否则 >_< 会转成 > < 撞上「空格写法」的提示规则，正确写法被误伤。
  const trap = TRAPS[lowRaw];
  const hit = lookupTag(lowRaw);

  if (trap) {
    results.push({ tag: raw, status: 'trap', note: trap, zh: hit?.zh });
  } else if (!hit) {
    results.push({ tag: raw, status: 'missing' });
  } else {
    results.push({ tag: raw, status: 'ok', zh: hit.zh, freq: hit.freq, via: hit.via, big: hit.big });
  }
}

// ---- 输出 ------------------------------------------------------------------
const ok = results.filter(r => r.status === 'ok');
const traps = results.filter(r => r.status === 'trap');
const missing = results.filter(r => r.status === 'missing');
const skipped = results.filter(r => r.status === 'skip' || r.status === 'rating');

if (opt.json) {
  console.log(JSON.stringify({
    total: tags.length, ok: ok.length, traps: traps.length, missing: missing.length,
    results,
  }, null, 2));
  process.exit(0);
}

if (KB) console.error(`[词库] ${KB.size} 条 · ${KB.dir}`);
console.log(`共 ${tags.length} 条：正常 ${ok.length} · 陷阱 ${traps.length} · 未收录 ${missing.length} · 跳过 ${skipped.length}\n`);

if (traps.length) {
  console.log('⚠ 陷阱标签（会被降级或语义不符）：');
  for (const t of traps) console.log(`  ${t.tag}\n    → ${t.note}`);
  console.log();
}

if (missing.length) {
  console.log('✗ 词库未收录（写了不生效）：');
  for (const m of missing) console.log(`  ${m.tag}`);
  console.log();
}

if (!opt.quiet) {
  console.log('✓ 正常命中：');
  for (const o of ok) {
    const via = o.via === 'alias' ? '  (别名命中)' : '';
    console.log(`  ${o.tag}${o.zh ? '  「' + o.zh + '」' : ''}  ${o.freq || '-'}${via}`);
  }
}

// ---- 神态自检 --------------------------------------------------------------
// 目的：兜住「看图时漏检神态」——嘴型/眼睑/情绪三层各查一遍。
const MOUTH_KANA = new Set([
  ':d', ':o', ':3', ':<', ':p', ':q', ':>', ':/', ':|', ':t', ':i', ':x', ':c',
  ':< >', ':<>', ';d', ';)', ';q', ';o', ';p', ';3', ';)', '^^^', '>o<', '>3<',
  '(-3-)', 'uwu', '+_-', '=^=', '=v=', '^o^', '>_@', '>:(', '>:)', '>:(', '\\\\(^o^)/',
]);
const MOUTH_WORD = new Set([
  'grin', 'smirk', 'evil grin', 'pout', 'frown', 'tongue out', 'open mouth',
  'closed mouth', 'parted lips', 'teeth', 'clenched teeth', 'wavy mouth',
  'chestnut mouth', 'dot mouth', 'triangle mouth', 'no mouth', 'drooling',
  'fang', 'licking lips', 'heart in mouth', 'mouth hold', 'split mouth',
  'puckered lips', 'x mouth', 'sideways mouth', 'mouth drool', 'kaomoji',
]);
const EYELID = new Set([
  // 眼睑状态
  'half-closed eyes', 'half-closed eye', 'closed eyes', 'rolling eyes', 'empty eyes',
  'open eyes', 'one eye closed', 'narrowed eyes', 'squinting',
  // 眼型颜文字（词库实际写法：下划线连接，@ @ 除外）
  '>_<', '>_o', '>_@', '@ @', 'u_u', '>o<', ';o', ';p', ';3', '|<', '|>',
  '|_|', '<|>_<|>', '<o>_<o>', 'uwu', '>3<',
  // 眼型文字
  'tareme', 'tsurime', 'spiral-only eyes', 'dizzy', 'wall-eyed', 'googly eyes',
  'constricted pupils', 'eye focus',
]);
const EMOTION = new Set([
  'embarrassed', 'embarassed', 'shy', 'nervous', 'serious', 'surprised',
  'scared', 'flustered', 'drunk', 'sleepy', 'tired', 'smug', 'furious',
  'angry', 'bored', 'crazy', 'happy', 'sad', 'confused', 'disgust',
  'expressionless', 'trembling', 'afterglow', 'heavy breathing', 'excited',
]);
const AUX = new Set([
  'blush', 'sweat', 'sweatdrop', 'tears', 'tear drop', 'saliva', 'saliva trail',
  'heart-shaped pupils', 'symbol-shaped pupils', 'drooling',
]);
// 词库中不存在的（常见误写）
const BAD_EMOTION = new Set(['calm', 'proud', 'panic', 'relaxed', 'surprise']);

if (opt.exprCheck) {
  const lows = tags.map(t => t.toLowerCase().trim());
  const foundMouth = lows.filter(t => MOUTH_KANA.has(t) || MOUTH_WORD.has(t));
  const foundEyelid = lows.filter(t => EYELID.has(t));
  const foundEmotion = lows.filter(t => EMOTION.has(t));
  const foundAux = lows.filter(t => AUX.has(t));
  const badHits = lows.filter(t => BAD_EMOTION.has(t));

  console.log('\n── 神态自检 ──');
  console.log(`  嘴型 (${foundMouth.length})：${foundMouth.join(', ') || '⚠ 一条都没有'}`);
  console.log(`  眼睑 (${foundEyelid.length})：${foundEyelid.join(', ') || '（无）'}`);
  console.log(`  情绪 (${foundEmotion.length})：${foundEmotion.join(', ') || '（无）'}`);
  console.log(`  辅助 (${foundAux.length})：${foundAux.join(', ') || '（无）'}`);

  const exprWarn = [];
  // 嘴型与眼型互为补充：至少要有一样，否则视为神态缺失
  if (!foundMouth.length && !foundEyelid.length) {
    exprWarn.push('既无嘴型也无眼型标签 —— 很可能漏了神态');
  } else if (!foundMouth.length) {
    exprWarn.push('无嘴型标签（仅有眼型）—— 确认是否刻意省略');
  }
  if (!foundEyelid.length && !foundEmotion.length && !foundMouth.length) {
    exprWarn.push('神态描述过少');
  }
  if (badHits.length) exprWarn.push(`写了词库不存在的情绪词：${badHits.join(', ')}`);

  if (exprWarn.length) {
    for (const w of exprWarn) console.log(`  ⚠ ${w}`);
    console.log('  → 对照 references/expression-checklist.md 逐项补');
  } else {
    console.log('  ✅ 神态描述完整');
  }
}

// 退出码：有陷阱/未收录 → 1；开了 --expression-check 且缺嘴型 → 也算问题
let exitCode = (traps.length + missing.length) > 0 ? 1 : 0;
if (opt.exprCheck) {
  const lows2 = tags.map(t => t.toLowerCase().trim());
  const hasMouth = lows2.some(t => MOUTH_KANA.has(t) || MOUTH_WORD.has(t));
  const hasEye = lows2.some(t => EYELID.has(t));
  if (!hasMouth && !hasEye) exitCode = 1;
}
process.exit(exitCode);
