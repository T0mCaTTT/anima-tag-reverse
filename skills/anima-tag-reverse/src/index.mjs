/**
 * index.mjs —— 门面 API（技能对外只暴露这几个函数）
 *
 *   getLexicon(kbDir?)                      加载/复用词库（进程内缓存）
 *   reverse({ text } | { imageSpec }, opts)  一站式：解析 → 匹配 → 格式化
 *   reverseText(text, opts)                  文本分支
 *   reverseImageSpec(spec, opts)             图像分支（结构化观察结果）
 *   searchTags(query, opts)                  单条检索（"blue eyes" / "蓝眼睛" / "青い目"）
 *   kbInfo(kbDir?)                           词库元信息（条数/构建时间/覆盖情况）
 *
 * opts 常用项：{ top, perClause, minScore, minSim, maxPerLayer, prefix, negative, kbDir, limit }
 */
import { buildLexicon, loadIndex } from './lexicon.mjs';
import { parseText, parsePhrase } from './parse.mjs';
import { matchPlan, search } from './match.mjs';
import { compose } from './compose.mjs';
import { specToPlan, emptySpec, IMAGE_SPEC_TEMPLATE } from './image-spec.mjs';
import { resolveKbDir, LAYER_NAME, POSITIVE_PREFIX, NEGATIVE_DEFAULT, SCORE, RATING_TAGS } from './config.mjs';

let _lex = null;
let _lexKey = '';

/** 加载词库（同一进程内缓存；换目录才重建） */
export function getLexicon(kbDir) {
  const dir = resolveKbDir(kbDir);
  if (_lex && _lexKey === dir) return _lex;
  _lex = buildLexicon(dir);
  _lexKey = dir;
  return _lex;
}

/** 一站式反推 */
export function reverse(input, opts = {}) {
  const lex = getLexicon(opts.kbDir);
  let plan;
  if (typeof input === 'string') plan = parseText(input, opts);
  else if (input && input.imageSpec) plan = specToPlan(input.imageSpec, opts);
  else if (input && input.text) plan = parseText(input.text, opts);
  else if (input && input.spec) plan = specToPlan(input.spec, opts);
  else if (input && typeof input === 'object' && (input.subject || input.appearance || input.outfit || input.scene || input.style)) {
    plan = specToPlan(input, opts);          // 直接把观察对象传进来
  } else throw new Error('reverse() 需要字符串，或 { text } / { imageSpec } / 观察对象');

  const res = matchPlan(plan, lex, opts);
  res.query = plan.kind === 'image' ? 'image-spec' : plan.raw;
  res.kind = plan.kind;

  let negRes = null;
  if (plan.negatedClauses && plan.negatedClauses.length) {
    negRes = matchPlan({ ...plan, clauses: plan.negatedClauses }, lex, { ...opts, negMode: true });
  }
  const out = compose(res, negRes, opts);
  out.kind = plan.kind;
  // 顺手把结构化结果提到顶层，调用方不必再钻进 .json
  out.positive = out.json.positive;        // { prefix, tags, tagsString, rating, line, layers }
  out.negativeTags = out.json.negative;    // { string, base, added }
  out.positiveString = out.prompt;
  out.line = out.tags;                     // 单行纯标签串（对外交付的默认形态）
  out.bare = out.bare;                     // 单行标签串（不含官方前缀）
  out.rating = out.json.rating;            // safe / sensitive / questionable / nsfw / explicit
  out.plan = {
    clauses: plan.clauses.map(c => ({
      text: c.norm || c.raw, negated: !!c.negated, layerHint: c.layerHint ?? null,
      jp: (c.jpTerms || []).map(j => j.jp)
    })),
    negated: (plan.negatedClauses || []).map(c => c.norm || c.raw)
  };
  out.unmatched = out.stats.unmatchedClauses;
  return out;
}

export const reverseText = (text, opts = {}) => reverse({ text }, opts);
export const reverseImageSpec = (spec, opts = {}) => reverse({ imageSpec: spec }, opts);

/** 单条检索：给词库"查词"用 */
export function searchTags(query, opts = {}) {
  const lex = getLexicon(opts.kbDir);
  const clause = parsePhrase(query);
  if (opts.layerHint !== undefined && opts.layerHint !== null) clause.layerHint = opts.layerHint;
  return search(lex, query, { perClause: opts.limit || 10, ...opts });
}

/** 词库概况 */
export function kbInfo(kbDir) {
  const lex = getLexicon(kbDir);
  const m = lex.meta || {};
  return {
    kbDir: lex.kbDir,
    size: lex.size,
    total: m.total || lex.size,
    bigs: m.bigs, subs: m.subs,
    builtAt: m.built_at, model: m.model,
    officialTags: m.official_tags, verifiedFreq: m.verified_freq, zhMissing: m.zh_missing,
    surfaces: lex.surfaces.size,
    tokens: lex.tokens.size,
    maxFreq: lex.maxFreq
  };
}

export {
  buildLexicon, loadIndex,
  parseText, parsePhrase,
  matchPlan, search,
  compose,
  specToPlan, emptySpec, IMAGE_SPEC_TEMPLATE,
  resolveKbDir, LAYER_NAME, POSITIVE_PREFIX, NEGATIVE_DEFAULT, SCORE, RATING_TAGS
};
