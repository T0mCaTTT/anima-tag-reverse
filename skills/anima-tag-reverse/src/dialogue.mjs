/**
 * dialogue.mjs —— 第 4 期（面 3「压字」）：按档位挑 dialogue-style 的该读章节（零依赖）
 *
 * 背景：长篇成片写对话框（压字）时，对白写法参考分成「通用篇 + Safe / Sensitive / NSFW」，
 * 只有**本档那一节 + 通用节**要读，别的节不翻开（省上下文预算，也防别档腔调串味）。
 * 这个模块把「该读哪几节」算成一份计划，供 CLI（`--dialogue` / `--format json`）与面板使用。
 *
 * 铁律（与其余四个面一致）：**没有显式档位时这一面整体关闭**——
 * dialoguePlan() 返回 null，`--format json` 不多一个键，默认输出与改造前逐字节一致。
 *
 * 档名可被面板改名，所以选篇走**语义档位**：safe → Safe 篇、mid → Sensitive 篇、top → NSFW 篇；
 * 档名恰好就叫 safe / sensitive / nsfw 时结果相同（内置三档表就是一一映射）。
 *
 * `heading` 必须与 `references/dialogue-style.md` 的 `## N. 标题` 逐字相同——
 * `dialogueRefIssues()` 就是拿它去校验文档没被改歪（tests/dialogue.mjs 锁着）。
 */

/** 参考文档（相对技能目录） */
export const DIALOGUE_REF_FILE = 'references/dialogue-style.md';

/** 本机路径分隔符（这个模块刻意不 import 任何东西，连 node:path 都不用） */
const SEP = process.platform === 'win32' ? '\\' : '/';

/** 压字交付流程那一节（第五节，压字阶段必读，但不属于「按档选篇」） */
export const DIALOGUE_DELIVERY_HEADING = '长篇成片压字交付（压字阶段必读）';

/** 四个节 + 通用节（always = 三档都必过） */
const SECTION_LIST = [
  { id: 'common', no: 1, heading: '通用篇（三档都必过）', label: '通用篇', always: true, hint: '红线 / 符号表 / 落笔流程 / 纪律' },
  { id: 'safe', no: 2, heading: 'Safe 篇（日常 / 热血 / 悲伤 / 压抑）', label: 'Safe 篇', hint: '日常 / 热血 / 悲伤 / 压抑' },
  { id: 'sensitive', no: 3, heading: 'Sensitive 篇（擦边 / 暧昧，过渡用）', label: 'Sensitive 篇', hint: '擦边 / 暧昧（过渡用）' },
  { id: 'nsfw', no: 4, heading: 'NSFW 篇（色气 / 亲密）', label: 'NSFW 篇', hint: '色气 / 亲密' }
];

export const DIALOGUE_SECTIONS = Object.freeze(
  Object.fromEntries(SECTION_LIST.map(s => [s.id, Object.freeze({ ...s, always: !!s.always })]))
);

/** 语义档位 → 章节 id（档名被面板改掉时靠这个兜底） */
export const SECTION_BY_SEMANTIC = Object.freeze({ safe: 'safe', mid: 'sensitive', top: 'nsfw' });

/**
 * 档位 → 章节 id。优先认档名（面板把某档直接叫 nsfw 时最直观），
 * 否则按语义档位映射（改名成 r18 这类也照样选到 NSFW 篇）。
 */
export function sectionIdFor(tierName, semantic) {
  const byName = tierName ? DIALOGUE_SECTIONS[String(tierName).toLowerCase()] : null;
  if (byName && !byName.always) return byName.id;
  return SECTION_BY_SEMANTIC[semantic] || 'safe';
}

/**
 * 面 3 的选篇计划。
 * @param {object} policy buildPolicy() 的返回值（需要 dialogueEnabled）
 * @returns {object|null} 面关 / 没有显式档位时返回 null
 */
export function dialoguePlan(policy) {
  if (!policy || !policy.dialogueEnabled) return null;
  const cfg = policy._panelConfig || null;
  // dialogue.commonAlways 默认 true：只有配置显式写 false 才不带通用篇
  const commonAlways = !(cfg && cfg.dialogue && cfg.dialogue.commonAlways === false);
  const id = sectionIdFor(policy.tier, policy.semantic);
  const main = DIALOGUE_SECTIONS[id];
  const list = commonAlways ? [main, DIALOGUE_SECTIONS.common] : [main];
  return {
    enabled: true,
    file: DIALOGUE_REF_FILE,
    tier: policy.tier,
    semantic: policy.semantic,
    section: id,
    commonAlways,
    sections: list.map(s => ({ id: s.id, no: s.no, heading: s.heading, label: s.label, always: !!s.always })),
    discipline: '对白永远用中文（禁日式语尾与翻译腔）；只吸收结构不抄原文；同档位页集中一批写完再切档'
  };
}

/** 人读形态（`--dialogue` 打印这段；面板与脚本要看结构请用 `--format json`） */
export function formatDialoguePlan(plan, { skillDir, policy } = {}) {
  if (!plan) return '（压字选篇未生效：需要显式档位，且 faces.dialogueSection 未关掉）';
  const abs = skillDir
    ? `${skillDir.replace(/[\\/]+$/, '')}${SEP}${DIALOGUE_REF_FILE.split('/').join(SEP)}`
    : DIALOGUE_REF_FILE;
  const main = plan.sections.find(s => !s.always) || plan.sections[0];
  const lines = [];
  lines.push('## 压字选篇（面 3 · dialogueSection）');
  lines.push(`- 档位：${plan.tier}（语义档位 ${plan.semantic}）`);
  lines.push(`- 本档要读：§${main.no} ${main.heading}`);
  if (plan.commonAlways) {
    const c = DIALOGUE_SECTIONS.common;
    lines.push(`- 通用篇：§${c.no} ${c.heading}（三档都过一遍，很短）`);
  } else {
    lines.push('- 通用篇：已关掉（配置 `dialogue.commonAlways = false`）');
  }
  lines.push(`- 参考文档：${abs}`);
  lines.push('');
  lines.push('纪律：' + plan.discipline);
  lines.push('**只读这几节**：不写的那几节不翻开（省上下文预算，也防别档腔调串味）。');
  if (policy && policy.panelPath) lines.push('（档位表来自：' + policy.panelPath + '）');
  return lines.join('\n');
}

/**
 * 文档体检：`references/dialogue-style.md` 里该有的节标题齐不齐。
 * @returns {string[]} 缺失项（空数组 = 齐全）
 */
export function dialogueRefIssues(text) {
  const t = String(text || '');
  const missing = [];
  for (const s of SECTION_LIST) {
    if (!t.includes(`## ${s.no}. ${s.heading}`)) missing.push(`§${s.no} ${s.heading}`);
  }
  if (!t.includes(`## 5. ${DIALOGUE_DELIVERY_HEADING}`)) missing.push(`§5 ${DIALOGUE_DELIVERY_HEADING}`);
  return missing;
}
