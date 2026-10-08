/**
 * index.mjs —— 门面 API（技能对外只暴露这几个函数）
 *
 *   getLexicon(kbDir?)                      加载/复用词库（进程内缓存）
 *   reverse({ text } | { imageSpec }, opts)  一站式：解析 → 匹配 → 格式化
 *   reverseText(text, opts)                  文本分支
 *   reverseImageSpec(spec, opts)             图像分支（结构化观察结果，默认带自审）
 *   searchTags(query, opts)                  单条检索（"blue eyes" / "蓝眼睛" / "青い目"）
 *   kbInfo(kbDir?)                           词库元信息（条数/构建时间/覆盖情况）
 *
 * opts 常用项：{ top, perClause, minScore, minSim, maxPerLayer, prefix, negative, kbDir, limit }
 * 本轮新增：{ broad, alternatives, gaps, nl, nlOptions }
 *   broad        宽召回档（BROAD）—— 默认关闭（文本分支、图像分支都一样，保证标签行与旧版同规模）；
 *                要更全的候选池显式开：API 写 { broad: true }，CLI 写 --broad
 *   alternatives 额外返回按层归拢的备选池（缺项清单的候选来源；图像入口默认开）
 *   gaps         额外返回缺项清单 + 可勾选候选项（图像分支默认开启）
 *   nl           额外返回英文自然语言分支（标签骨架 + 逐句描述）
 */
import { buildLexicon, loadIndex } from './lexicon.mjs';
import { parseText, parsePhrase } from './parse.mjs';
import { matchPlan, search } from './match.mjs';
import { compose } from './compose.mjs';
import { specToPlan, emptySpec, IMAGE_SPEC_TEMPLATE, analyzeImageSpec, normalizeSpec, REQUIRED_OBSERVATIONS, KEY_ALIASES } from './image-spec.mjs';
import { resolveKbDir, LAYER_NAME, POSITIVE_PREFIX, NEGATIVE_DEFAULT, SCORE, RATING_TAGS } from './config.mjs';
import { buildNaturalLanguage, nlTemplate } from './nl.mjs';
import { buildGaps, gapsMarkdown } from './gaps.mjs';

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
  // 图像分支专属回显：文本分支的 plan 键集合与改造前逐字一致（多出来的键只挂图像计划）
  if (plan.kind === 'image') {
    // notes 是纯日志：只回显，不产分句、不参与匹配（见 image-spec.mjs 顶部说明）
    out.plan.notesText = plan.notesText || '';
    out.plan.specIssues = plan.specIssues || [];
  }
  out.unmatched = out.stats.unmatchedClauses;

  // 英文自然语言分支（用户确认的「两者都要」：工具出确定性骨架，模型可再润色）
  if (opts.nl) {
    out.nl = buildNaturalLanguage(out, opts.nlOptions || {});
  }
  // 备选池：够分但被名额挤掉的候选，缺项清单的候选来源；也可单独取用（--broad 时更宽）
  if (opts.alternatives && res.alternatives) {
    out.alternatives = res.alternatives;
  }
  // 缺项清单（用户确认的「结构化 gaps JSON + 技能侧提问」）
  if (opts.gaps) {
    const g = buildGaps(out, plan, {
      alternatives: res.alternatives,
      broad: !!opts.broad,
      isImage: plan.kind === 'image',
      specIssues: plan.specIssues || [],
      notesText: plan.notesText || ''
    });
    out.gaps = g.gaps;
    out.gapsSummary = g.summary;
    out.gapsMarkdown = gapsMarkdown(g, res.query);
  }
  return out;
}

export const reverseText = (text, opts = {}) => reverse({ text }, opts);
/**
 * 图像分支入口：默认带缺项自审（gaps），**不**默认宽召回。
 * 踩过的坑：自审原本是可选产物，调不调都不报错，于是被静默跳过——
 * 交付的标签串漏了画风与光位也没人发现。这里把默认值钉死：
 *   - 默认产出 out.gaps / out.gapsSummary / out.gapsMarkdown；
 *   - 默认走窄召回（不传 broad 时等价于 { broad: false }），标签行与改造前同规模；
 *     要更全的候选池显式写 { broad: true }；
 *   - 显式传 { gaps:false } 仍可关掉；自审只在结果对象上多挂字段，不改标签串。
 */
export const reverseImageSpec = (spec, opts = {}) => reverse({ imageSpec: spec }, { gaps: true, ...opts });

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
  analyzeImageSpec, normalizeSpec, REQUIRED_OBSERVATIONS, KEY_ALIASES,
  resolveKbDir, LAYER_NAME, POSITIVE_PREFIX, NEGATIVE_DEFAULT, SCORE, RATING_TAGS,
  buildNaturalLanguage, nlTemplate, buildGaps, gapsMarkdown
};
