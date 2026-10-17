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
 * 本轮新增：{ broad, alternatives, gaps, nl, nlOptions, phrasePool }
 *   broad        宽召回档（BROAD）—— 默认关闭（文本分支、图像分支都一样，保证标签行与旧版同规模）；
 *                要更全的候选池显式开：API 写 { broad: true }，CLI 写 --broad
 *   phrasePool   读取「补充短语池」（anima-tag-kb/补充短语池/phrase-pool.json）—— 默认关闭，
 *                面板开关 lexicon.poolEnabled / CLI --pool；关着时输出与旧版逐字节一致。
 *                名字不叫 pool 是刻意的：match.mjs 的 opts.pool 是「备选候选数组」，两者不能混。
 *   broad        宽召回档（BROAD）—— 默认关闭（文本分支、图像分支都一样，保证标签行与旧版同规模）；
 *                要更全的候选池显式开：API 写 { broad: true }，CLI 写 --broad
 *   alternatives 额外返回按层归拢的备选池（缺项清单的候选来源；图像入口默认开）
 *   gaps         额外返回缺项清单 + 可勾选候选项（图像分支默认开启）
 *   nl           额外返回英文自然语言分支（标签骨架 + 逐句描述）
 */
import { buildLexicon, loadIndex, loadPool, poolPath } from './lexicon.mjs';
import { parseText, parsePhrase } from './parse.mjs';
import { matchPlan, search } from './match.mjs';
import { compose, hybridLines, hybridBlock, looseItems, looseTail, weightPlan, weightForFreq, WEIGHT_CAP_TOTAL, WEIGHT_CAP_PER_LAYER } from './compose.mjs';
import { specToPlan, emptySpec, IMAGE_SPEC_TEMPLATE, analyzeImageSpec, normalizeSpec, REQUIRED_OBSERVATIONS, KEY_ALIASES } from './image-spec.mjs';
import { resolveKbDir, LAYER_NAME, POSITIVE_PREFIX, NEGATIVE_DEFAULT, SCORE, BUILTIN_TIER_NAMES } from './config.mjs';
import { gateMatches, negativeFor, narrowCandidates } from './tier-policy.mjs';
import { dialoguePlan } from './dialogue.mjs';
import { buildNaturalLanguage, nlTemplate } from './nl.mjs';
import { buildGaps, gapsMarkdown } from './gaps.mjs';
import {
  annotate, loadRules, RULES_FILE, mutexHits, countHint, personCount,
  needsViewDefault, viewDefaultTags, themeList, themeById, themePlan, resolveTagRows
} from './rules.mjs';

let _lex = null;
let _lexKey = '';

/**
 * 加载词库（同一进程内缓存；换目录或换短语池开关才重建）
 * opts.pool = true 时额外加载「补充短语池」（第 4 期 ③；默认关闭，输出逐字节不变）
 */
export function getLexicon(kbDir, opts = {}) {
  const dir = resolveKbDir(kbDir);
  const pool = !!opts.pool;
  const key = dir + (pool ? '|pool' : '');
  if (_lex && _lexKey === key) return _lex;
  _lex = buildLexicon(dir, { pool });
  _lexKey = key;
  return _lex;
}

/** 一站式反推 */
export function reverse(input, opts = {}) {
  const lex = getLexicon(opts.kbDir, { pool: opts.phrasePool });
  let plan;
  if (typeof input === 'string') plan = parseText(input, opts);
  else if (input && input.imageSpec) plan = specToPlan(input.imageSpec, opts);
  else if (input && input.text) plan = parseText(input.text, opts);
  else if (input && input.spec) plan = specToPlan(input.spec, opts);
  else if (input && typeof input === 'object' && (input.subject || input.appearance || input.outfit || input.scene || input.style)) {
    plan = specToPlan(input, opts);          // 直接把观察对象传进来
  } else throw new Error('reverse() 需要字符串，或 { text } / { imageSpec } / 观察对象');

  const res0 = matchPlan(plan, lex, opts);
  res0.query = plan.kind === 'image' ? 'image-spec' : plan.raw;
  res0.kind = plan.kind;

  // ---- 第 1–2 期起：档位驱动的五个行为面（面 1 在 compose 里，面 4/5 在这里，面 2 走 negative，面 3 走 dialogue）----
  // 没有 opts.tierPolicy（= 没显式给档位）时这一段整体不生效，行为与改造前逐字节一致
  const policy = opts.tierPolicy || null;
  const gate = policy && policy.gateEnabled
    ? gateMatches(res0.matches, policy)
    : { kept: res0.matches, blocked: [] };
  const res = gate.blocked.length ? { ...res0, matches: gate.kept } : res0;
  if (policy && gate.blocked.length) res.tierBlocked = gate.blocked;
  if (policy && policy.gapScopeEnabled && Array.isArray(res0.alternatives)) {
    res.alternatives = narrowCandidates(res0.alternatives, policy);
  }

  let negRes = null;
  if (plan.negatedClauses && plan.negatedClauses.length) {
    negRes = matchPlan({ ...plan, clauses: plan.negatedClauses }, lex, { ...opts, negMode: true });
  }
  const composeOpts = { ...opts };
  if (policy) {
    composeOpts.tierToken = policy.tierToken;
    if (policy.negativeEnabled) {
      // 面 2：基线 + 分档增补 + 误杀项删除（删除规则看正向标签里有没有雨景/水面/镜面）
      composeOpts.negative = negativeFor(policy, res.matches.map(m => m.tag), opts.negative);
    }
  }
  const out = compose(res, negRes, composeOpts);
  out.kind = plan.kind;
  // 顺手把结构化结果提到顶层，调用方不必再钻进 .json
  out.positive = out.json.positive;        // { prefix, tags, tagsString, rating, line, layers }
  out.negativeTags = out.json.negative;    // { string, base, added }
  out.positiveString = out.prompt;
  out.line = out.tags;                     // 单行纯标签串（对外交付的默认形态）
  out.bare = out.bare;                     // 单行标签串（不含官方前缀）
  out.rating = out.json.rating;            // 档位名（可被面板改；默认三档 safe / sensitive / nsfw）
  // 面 4 的可见性：本档被挡下的标签（绝不静默丢弃——同时写进 gaps 的 tier-blocked）
  out.tierBlocked = res.tierBlocked || [];
  out.tierPolicy = policy
    ? { tier: policy.tier, tierNames: policy.tierNames, explicit: policy.explicit, semantic: policy.semantic, tierToken: policy.tierToken, faces: policy.faces, panelPath: policy.panelPath, warnings: policy.warnings }
    : null;
  // 面 3（第 4 期）：显式档位 + faces.dialogueSection 打开时才给「压字选篇」；
  // 否则恒为 null（默认路径不多一个键，JSON 与改造前逐字节一致）
  out.dialogueSection = dialoguePlan(policy);
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
  // 第 6 期：ANIMA3 模板规则的事后提醒（互斥组合 / 标签总数区间 / 人数判定）。
  // 只在调用方要（--format hybrid|check|gaps|json，或面板/脚本显式 opts.annotate）时才算，
  // 且只往结果对象上加字段——不参与匹配、不改任何交付串。
  if (opts.annotate) {
    out.annotate = annotate({
      tags: out.json.positive.tags,
      query: out.json.query || '',
      theme: opts.themeInfo || null,
      rules: opts.rules
    });
  }
  // 缺项清单（用户确认的「结构化 gaps JSON + 技能侧提问」）
  if (opts.gaps) {
    const g = buildGaps(out, plan, {
      alternatives: res.alternatives,
      broad: !!opts.broad,
      isImage: plan.kind === 'image',
      specIssues: plan.specIssues || [],
      notesText: plan.notesText || '',
      tierBlocked: res.tierBlocked || [],
      policy,
      annotate: out.annotate || null
    });
    out.gaps = g.gaps;
    out.gapsSummary = g.summary;
    out.gapsMarkdown = gapsMarkdown(g, res.query);
  }
  return out;
}

/**
 * 文本分支入口：与图像入口对齐，**默认同样带缺项自审**（gaps），**不**默认宽召回。
 * 踩过的坑：文本入口的 gaps 以前是「传了才有」的可选产物，不传就一声不响地跳过，
 * 于是 r.gaps 恒为 undefined，后面「照缺口补候选」的整条流水线没有输入。
 * 这里把默认值钉死：
 *   - 默认产出 out.gaps / out.gapsSummary / out.gapsMarkdown；
 *   - 默认走窄召回（不传 broad 时等价于 { broad: false }），标签串与改造前逐字节相同；
 *   - 显式传 { gaps: false } 仍可关掉；自审只在结果对象上多挂字段，不改标签串。
 */
export const reverseText = (text, opts = {}) => reverse({ text }, { gaps: true, ...opts });
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
  const lex = getLexicon(opts.kbDir, { pool: opts.phrasePool });
  const clause = parsePhrase(query);
  if (opts.layerHint !== undefined && opts.layerHint !== null) clause.layerHint = opts.layerHint;
  return search(lex, query, { perClause: opts.limit || 10, ...opts });
}

/** 词库概况 */
export function kbInfo(kbDir, opts = {}) {
  const lex = getLexicon(kbDir, { pool: opts.phrasePool });
  const m = lex.meta || {};
  // 池文件条数单独读一次：关着池时也要能报「池里有几条」，而且 kbDir 可能没传（要用解析后的 lex.kbDir）
  const poolFile = lex.pool.enabled ? null : loadPool(lex.kbDir);
  const poolCount = lex.pool.enabled ? lex.pool.count : (poolFile ? poolFile.rows.length : 0);
  return {
    kbDir: lex.kbDir,
    size: lex.size,
    rows: lex.baseSize,
    total: m.total || lex.baseSize,
    bigs: m.bigs, subs: m.subs,
    builtAt: m.built_at, model: m.model,
    officialTags: m.official_tags, verifiedFreq: m.verified_freq, zhMissing: m.zh_missing,
    pool: poolCount,
    poolEnabled: !!lex.pool.enabled,
    surfaces: lex.surfaces.size,
    tokens: lex.tokens.size,
    maxFreq: lex.maxFreq
  };
}

export {
  buildLexicon, loadIndex, loadPool, poolPath,
  parseText, parsePhrase,
  matchPlan, search,
  compose, hybridLines, hybridBlock, looseItems, looseTail, weightPlan, weightForFreq, WEIGHT_CAP_TOTAL, WEIGHT_CAP_PER_LAYER,
  specToPlan, emptySpec, IMAGE_SPEC_TEMPLATE,
  analyzeImageSpec, normalizeSpec, REQUIRED_OBSERVATIONS, KEY_ALIASES,
  resolveKbDir, LAYER_NAME, POSITIVE_PREFIX, NEGATIVE_DEFAULT, SCORE, BUILTIN_TIER_NAMES,
  buildNaturalLanguage, nlTemplate, buildGaps, gapsMarkdown,
  // 第 6 期：ANIMA3 模板规则（互斥提醒 / 总数区间 / 单人默认视线 / 主题配方）
  loadRules, RULES_FILE, annotate, mutexHits, countHint, personCount,
  needsViewDefault, viewDefaultTags, themeList, themeById, themePlan, resolveTagRows
};
