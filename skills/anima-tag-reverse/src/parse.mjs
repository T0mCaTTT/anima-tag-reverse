/**
 * parse.mjs —— 第一步：输入解析
 *
 * 把「人话」拆成可逐条打分的分句，并抽掉会干扰匹配的噪音：
 *   1. 归一化（全角→半角、去下划线、大小写、去零宽）
 *   2. 分句：逗号/顿号/分号/换行/「」等都算分隔
 *   3. 否定识别：本分句是否带「不要/没有/去掉/排除/no/without…」
 *   4. 强度识别：少し/とても/very/强烈 → 给权重提示用
 *   5. 层提示：正则判断这条大概属于哪一层（画师/构图/服装…）
 *   6. 日文桥接：用 jp-lexicon 把日文词翻成中文/英文表面
 *   7. 直接引用：反引号/引号里的内容、@画师、3girls 这类具体标签 → 强制精确命中
 */
import { normalizeText, keyOf, asciiTokens, cjkRuns } from './normalize.mjs';
import { buildJpTable } from './jp-lexicon.mjs';
import { SPLIT_RE, NEG_RE, INTENSITY, HINT_RULES } from './config.mjs';

const JP = buildJpTable();

/** 引号里的内容 —— 用户明说要这个标签 */
const QUOTED_RE = /[`「『"'“”]([^`「』"'“”]{2,40})[`「』"'“”]/g;
/** 人数：1girl / 2 girls / 三人 */
const COUNT_RE = /(\d+)\s*(girls?|boys?|人)|(ひとり|ふたり|さんにん|一人|二人|三人)/gi;
const CN_NUM = { 一人: '1girl', ひとり: '1girl', 二人: '2girls', ふたり: '2girls', 三人: '3girls', さんにん: '3girls' };

/**
 * 日文桥接：在句中找最长的日文词条（含去假名的汉字骨架）
 * 返回 [{ jp, zh, en }]
 */
function bridgeJp(compact) {
  const out = [];
  if (!/[\u3040-\u30ff]/.test(compact)) return out;   // 没有假名就不做
  const win = Math.min(JP.maxLen, compact.length);
  let i = 0;
  while (i < compact.length) {
    let hit = null;
    for (let len = Math.min(win, compact.length - i); len >= 1; len--) {
      const seg = compact.slice(i, i + len);
      // 单字只认汉字（"夜""本""海"），避免假名单字到处命中
      if (len === 1 && !/[\u4e00-\u9fff]/.test(seg)) continue;
      const v = JP.map.get(seg);
      if (v) { hit = { jp: seg, ...v, len }; break; }
    }
    if (hit) {
      out.push({ jp: hit.jp, zh: hit.zh, en: hit.en });
      i += hit.len;
    } else i += 1;
  }
  return out;
}

/** 分句：按标点切，顺手去掉空白与过短的碎片 */
export function splitClauses(text) {
  const parts = String(text).split(SPLIT_RE);
  const out = [];
  for (const p of parts) {
    const t = p.trim();
    if (t.length >= 2) out.push(t);
  }
  return out.length ? out : [String(text).trim()].filter(Boolean);
}

/** 解析单个分句 */
function parseClause(raw, inheritedNeg = false) {
  const norm = normalizeText(raw);
  const compact = keyOf(norm);
  const negated = NEG_RE.test(norm) || inheritedNeg;
  let intensity = 'normal';
  for (const [k, re] of Object.entries(INTENSITY)) {
    if (re.test(norm)) { intensity = k; break; }
  }
  let layerHint = null;
  for (const { layer, re } of HINT_RULES) {
    if (re.test(norm)) { layerHint = layer; break; }
  }
  const jpTerms = bridgeJp(compact);

  // 直接引用：反引号 / 引号 / @画师 / by 画师 / 人数
  const forced = [];
  let m;
  QUOTED_RE.lastIndex = 0;
  while ((m = QUOTED_RE.exec(raw))) forced.push(normalizeText(m[1]));
  for (const a of norm.match(/@[0-9a-z_()\-. ]{2,40}/g) || []) forced.push(a.trim());
  // 「by dairi」「画师：dairi」→ 补上本库的画师前缀 @
  const byMatch = norm.match(/(?:^|\s)(?:by|artist[:：]?|画师[:：]?|作者[:：]?)\s*([0-9a-z][0-9a-z_()\-. ]{1,39})/);
  if (byMatch) {
    const name = byMatch[1].trim().replace(/\s+/g, ' ');
    forced.push('@' + name);
  }
  COUNT_RE.lastIndex = 0;
  while ((m = COUNT_RE.exec(norm))) {
    if (m[1] && m[2]) forced.push(`${m[1]}${m[2].toLowerCase().startsWith('g') ? 'girls' : 'boys'}`);
    else if (m[3] && CN_NUM[m[3]]) forced.push(CN_NUM[m[3]]);
  }

  return {
    raw,
    norm,
    compact,
    ascii: asciiTokens(norm),
    cjk: cjkRuns(norm),
    negated, intensity, layerHint, jpTerms, forced
  };
}

/**
 * 解析整段文本 → 计划对象
 * @param {string} text 用户的自然语言（中/英/日混输）
 * @param {object} [opts] { keepNegated?:boolean }
 */
export function parseText(text, opts = {}) {
  const clauses = splitClauses(text).map(c => parseClause(c));
  // 「不要 X」这种否定分句默认丢掉（会变成负向串，见 compose.mjs）
  const positive = clauses.filter(c => !c.negated);
  const negative = clauses.filter(c => c.negated);
  return {
    kind: 'text',
    raw: String(text),
    clauses: opts.keepNegated ? clauses : positive,
    negatedClauses: negative,
    isEmpty: clauses.length === 0
  };
}

/** 单条英文/中文/日文短语 —— 供精确命中与 API 直调 */
export function parsePhrase(phrase) {
  return parseClause(String(phrase));
}

export const _jpTable = JP;
