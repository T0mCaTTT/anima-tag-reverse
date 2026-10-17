/**
 * tier-policy.mjs —— 第 1–2 期：把「档位」翻译成五个行为面的具体策略（零依赖）
 *
 * 输入：面板配置（档名表 + faces 开关 + negative/output 覆盖）+ 调用方显式档位
 * 输出：一份 policy 对象，供 compose() / index.mjs / CLI 使用：
 *   - 面 1 前缀里的分级 token（可用 --no-tier-token 关掉）
 *   - 面 2 负面行（基线 + 分档增补 + 误杀项删除规则：内置 scene-mirror + 面板 negative.dropRules）
 *   - 面 4 档位门（被挡的标签写进 gaps 的 tier-blocked，不静默消失）
 *   - 面 5 补全候选松紧（按档收紧；与 --broad 是两个独立维度）
 *   - 面 3 压字（第 4 期）：按档位挑 references/dialogue-style.md 的该读章节（本模块只算开关，
 *     选篇本身在 dialogue.mjs 的 dialoguePlan()）
 *
 * 铁律（回归用例锁着）：**没有显式档位时，一切行为与改造前逐字节一致**。
 * 档名可被面板改名，所以内置表一律用语义档位：'safe' = 最低档、'mid' = 中间档及以上、'top' = 最高档。
 */
import {
  NEG_BY_TIER, NEG_TOP_EXTRA, NEG_DROP_RULES, TIER_GATE, TIER_GATE_BIGS, TIER_GATE_ALLOW,
  NEGATIVE_DEFAULT, BUILTIN_TIER_NAMES
} from './config.mjs';
import { keyOf } from './normalize.mjs';

/** 档位表下标 → 语义档位（表长 1 时只有最低档，不存在 top/mid） */
export function semanticOf(index, count) {
  if (count <= 1) return 'safe';
  if (index <= 0) return 'safe';
  if (index === count - 1) return 'top';
  return 'mid';
}

/** 语义档位 → 需要的最小可见语义档（用于比较） */
const RANK = { safe: 0, mid: 1, top: 2 };
const needRank = need => RANK[need] ?? 0;

/** 某档位下标是否可见 need 级别的标签 */
export function visibleAt(index, count, need) {
  return RANK[semanticOf(index, count)] >= needRank(need);
}

/**
 * 标签的最低可见档（null = 全档可见）。
 * 判据顺序：白名单 → **词库行自带的档位标记** → 明确词表 → 大分类信号。
 * 第二项是第 6 期加的：ANIMA3 模板抄进来的标签在词库行里带 `anima3:mid|top`
 * （见 anima-tag-kb/scripts/merge-anima3.mjs），它比通用词表与分类信号都准，
 * 拿不准的默认是「宁严勿松」，所以排在词表前面。
 * @param {string} tag
 * @param {string} [big]
 * @param {'mid'|'top'|null} [rowNeed] 词库行自带的档位门（match 结果里的 `need` 字段）
 */
export function gateNeed(tag, big, rowNeed) {
  const k = keyOf(tag);
  if (!k) return null;
  if (TIER_GATE_ALLOW.has(k)) return null;
  if (rowNeed === 'mid' || rowNeed === 'top') return rowNeed;
  if (TIER_GATE.top.includes(k)) return 'top';
  if (TIER_GATE.mid.includes(k)) return 'mid';
  const byBig = big ? TIER_GATE_BIGS[big] : null;
  if (byBig) return byBig;
  return null;
}

/**
 * 组装策略。
 * @param {object} o
 * @param {object} o.panel       loadPanelConfig() 的返回值 {config, source, warnings}
 * @param {string} [o.rating]    调用方显式指定的档位（未指定 = undefined）
 * @param {boolean} [o.tierToken] 是否允许把档位 token 写进输出串（CLI `--no-tier-token` 传 false）
 * @param {boolean} [o.broad]    独立维度：宽召回（`--broad` / 面板 output.broad）
 * @returns {object} policy
 */
export function buildPolicy({ panel, rating, tierToken, broad } = {}) {
  const cfg = (panel && panel.config) || null;
  const tierNames = Array.isArray(cfg && cfg.tiers) && cfg.tiers.length
    ? cfg.tiers.slice().sort((a, b) => (a.order || 0) - (b.order || 0)).map(t => t.name)
    : BUILTIN_TIER_NAMES.slice();
  const faces = Object.assign(
    { prefixToken: true, negativeLines: true, dialogueSection: true, lexiconGate: true, gapsScope: true },
    (cfg && cfg.faces) || {}
  );
  const explicit = !!rating;
  const idx = explicit ? tierNames.indexOf(rating) : 0;
  const tierIndex = idx >= 0 ? idx : 0;
  const semantic = semanticOf(tierIndex, tierNames.length);
  // 面板配置文件真的被用上时才认它的 negative.core（没有文件 = 技能自带默认，逐字节不变）
  // 注：`source.used` 在命中文件时是**该文件的绝对路径**，只有回退内置默认时才是字符串 'builtin'
  const panelUsed = !!(panel && panel.source && panel.source.used && panel.source.used !== 'builtin');

  return {
    tierNames,
    tier: explicit ? rating : tierNames[0],
    explicit,
    tierIndex,
    semantic,
    tierToken: tierToken !== false && faces.prefixToken !== false,
    broad: !!broad,
    panelUsed,
    panelPath: (panel && panel.source && panel.source.path) || null,
    faces: {
      prefixToken: faces.prefixToken !== false,
      negativeLines: faces.negativeLines !== false,
      dialogueSection: faces.dialogueSection !== false,
      lexiconGate: faces.lexiconGate !== false,
      gapsScope: faces.gapsScope !== false
    },
    // 面 4 只在「显式档位 + 开关打开 + 档数 > 1」时生效
    gateEnabled: explicit && faces.lexiconGate !== false && tierNames.length > 1,
    // 面 5 只在显式档位时收紧候选
    gapScopeEnabled: explicit && faces.gapsScope !== false && tierNames.length > 1,
    // 面 2 只在显式档位时改动负面行
    negativeEnabled: explicit && faces.negativeLines !== false,
    // 面 3（第 4 期）只在显式档位时选篇：档位决定读哪一节 dialogue-style
    dialogueEnabled: explicit && faces.dialogueSection !== false,
    warnings: (panel && panel.warnings) || [],
    _panelConfig: cfg
  };
}

/** 面 4：把被档位挡下的命中项从结果里摘出来（不删内容，只是本档不出） */
export function gateMatches(matches, policy) {
  if (!policy || !policy.gateEnabled) return { kept: matches, blocked: [] };
  const kept = [];
  const blocked = [];
  const seen = new Set();
  for (const m of matches || []) {
    const need = gateNeed(m.tag, m.big, m.need);
    if (!need || visibleAt(policy.tierIndex, policy.tierNames.length, need)) { kept.push(m); continue; }
    const k = keyOf(m.tag);
    if (seen.has(k)) continue;
    seen.add(k);
    blocked.push({ tag: m.tag, display: m.tag, zh: m.zh, need, tier: policy.tier, layer: m.layer, confidence: m.conf });
  }
  return { kept, blocked };
}

/** 面 4 的可见版：被挡标签在更高档位下才可见，取「哪个档能给」 */
export function needLabel(need, tierNames) {
  const count = tierNames.length;
  for (let i = 0; i < count; i++) {
    if (visibleAt(i, count, need)) return tierNames[i];
  }
  return tierNames[count - 1] || '';
}

const splitList = s => String(s == null ? '' : s).split(',').map(x => x.trim()).filter(Boolean);

/**
 * 一条删除规则是否触发。
 * 内置规则（`config.mjs#NEG_DROP_RULES`）的 `when` 是正则；
 * 面板规则（`negative.dropRules[]`，见面板包 `config-types.ts`）的 `when` 是标签数组，
 * 命中任意一项即触发。两种形状在这里统一处理。
 * @param {{when: RegExp|string[], drop?: string[]}} rule
 * @param {Set<string>} keys 正向标签的 keyOf 集合
 * @returns {boolean}
 */
export function ruleFires(rule, keys) {
  const when = rule && rule.when;
  if (when instanceof RegExp) {
    for (const k of keys) if (when.test(k)) return true;
    return false;
  }
  if (Array.isArray(when)) return when.some(t => keys.has(keyOf(t)));
  return false;
}

/**
 * 本档生效的删除规则表：技能内置规则在前，面板额外规则（用户自己加的）在后。
 * 面板规则只在配置文件真的被用上时叠加（没有文件 = 技能自带行为，逐字节不变）；
 * 与面 2 的其它部分同开关：不显式传档位时 `negativeFor` 根本不走到这一步。
 * @param {object} policy buildPolicy() 的返回值
 * @returns {Array<object>}
 */
export function dropRulesOf(policy) {
  const cfg = policy && policy._panelConfig;
  const extra = policy && policy.panelUsed && cfg && cfg.negative && Array.isArray(cfg.negative.dropRules)
    ? cfg.negative.dropRules
    : [];
  return [...NEG_DROP_RULES, ...extra];
}

/**
 * 面 2：算出本档的负面串。
 * 顺序：`--negative` 显式串（最高优先）→ 面板 core（若配置文件生效）→ 内置基线
 *       → 该档增补（内置 + 面板 byTier）→ 删掉误杀项。
 * @param {object} policy
 * @param {string[]} positiveTags  正向标签（用于误杀项删除规则的触发判断）
 * @param {string} [explicitNegative] 调用方显式给的负面串（CLI `--negative`）
 */
export function negativeFor(policy, positiveTags = [], explicitNegative) {
  const pick = () => {
    if (typeof explicitNegative === 'string') return explicitNegative;
    const cfg = policy && policy._panelConfig;
    if (policy && policy.panelUsed && cfg && cfg.negative && typeof cfg.negative.core === 'string' && cfg.negative.core.trim()) {
      return cfg.negative.core;
    }
    return NEGATIVE_DEFAULT;
  };
  if (!policy || !policy.negativeEnabled) return pick();
  const cfg = policy._panelConfig || null;
  const parts = splitList(pick());
  const builtinAdd = splitList(NEG_BY_TIER[policy.semantic] || '');
  const topExtra = policy.semantic === 'top' ? splitList(NEG_TOP_EXTRA) : [];
  const panelAdd = splitList(cfg && cfg.negative && cfg.negative.byTier ? cfg.negative.byTier[policy.tier] : '');
  for (const extra of [...builtinAdd, ...topExtra, ...panelAdd]) {
    if (!parts.some(p => keyOf(p) === keyOf(extra))) parts.push(extra);
  }
  // 误杀项删除：内置规则（正则 when）+ 面板额外规则（标签数组 when）叠加生效
  const keys = new Set((positiveTags || []).map(keyOf));
  const dropped = new Set();
  for (const rule of dropRulesOf(policy)) {
    if (!ruleFires(rule, keys)) continue;
    for (const d of rule.drop) dropped.add(keyOf(d));
  }
  return parts.filter(p => !dropped.has(keyOf(p))).join(', ');
}

/**
 * 面 5：补全候选按档收紧（被挡的候选不进候选清单；与 --broad 独立叠加）。
 * @param {Array} candidates 备选项（含 tag / layer / score）
 */
export function narrowCandidates(candidates, policy) {
  if (!policy || !policy.gapScopeEnabled) return candidates || [];
  return (candidates || []).filter(c => {
    const need = gateNeed(c.tag, c.big, c.need);
    return !need || visibleAt(policy.tierIndex, policy.tierNames.length, need);
  });
}

export const _internal = { splitList, RANK, needRank };
