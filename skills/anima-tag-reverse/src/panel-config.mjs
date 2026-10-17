/**
 * panel-config.mjs —— 第 5 期：面板配置读取层（唯一真理源）
 *
 * 设计裁决（用户拍板，2026-05）：
 *   1. 面板配置文件是档位/五面/负面词等设置的**唯一真理源**，技能启动时读它；
 *   2. 技能侧的档位定义不再硬编码，`config.mjs` 里的 `BUILTIN_TIER_NAMES`（三档）降级为「内置回退默认」；
 *   3. 旧档位名（questionable / explicit）**硬报错退出**，并打印迁移对照表；
 *   4. 面板侧「缺项自审面」与「候选松紧」是两个独立开关：
 *      面 5 = 缺项候选是否按档位收紧；候选松紧 = `output.broad`（默认召回档，与档位无关）。
 *
 * 本模块的硬约束：
 *   - 零依赖、不写盘、**绝不抛异常**（读不到 / 坏 JSON / 非法结构都降级并给 warning）；
 *   - 「绝不半生效」：一个文件要么整体被判合法并采用，要么整体跳过（字段缺失按内置默认补，
 *     但结构性错误——档名非法、重名、defaultTier 不在表内、数值越界——直接判该文件非法）；
 *   - 键名与面板包冻结契约 `packages/dsh-anima-tag-reverse/src/config-types.ts` 的
 *     `DEFAULT_PANEL_CONFIG` 保持一致；跨仓库不能 import TS，靠 `tests/panel-config.mjs`
 *     第 7 组用例比对字段名集合，防止两边漂移。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** 档名规范：小写字母开头，只允许小写字母、数字、下划线（与面板契约同一条正则） */
export const TIER_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

/** 档数上下限（与面板契约 MIN_TIERS / MAX_TIERS 一致） */
export const MIN_TIERS = 1;
export const MAX_TIERS = 6;

/** 误杀项删除规则的 id 规范（与面板契约 DROP_RULE_ID_PATTERN 同一条正则） */
export const DROP_RULE_ID_PATTERN = /^[a-z][a-z0-9_-]*$/;

/** 删除规则条数与词数上限（与面板契约 MAX_DROP_RULES / MAX_DROP_TERMS / MAX_DROP_TERM_LENGTH 一致） */
export const MAX_DROP_RULES = 16;
export const MAX_DROP_TERMS = 24;
export const MAX_DROP_TERM_LENGTH = 64;

/** 旧档位名 → 新三档的迁移对照（questionable → 擦边，explicit → 露骨） */
export const LEGACY_TIERS = Object.freeze({ questionable: 'sensitive', explicit: 'nsfw' });

/** 内置默认配置：与面板包 `config-types.ts` 的 `DEFAULT_PANEL_CONFIG` 逐字段等价 */
export const BUILTIN_PANEL_CONFIG = Object.freeze({
  version: 1,
  tiers: [
    { name: 'safe', label: '全年龄', order: 1, criteria: '无露点、无性暗示' },
    { name: 'sensitive', label: '擦边', order: 2, criteria: '内衣/泳装/湿身/挑逗，无露点（含旧 questionable）' },
    { name: 'nsfw', label: '露骨', order: 3, criteria: '露乳房或露性器官（含旧 explicit）' }
  ],
  defaultTier: 'safe',
  faces: { prefixToken: true, negativeLines: true, dialogueSection: true, lexiconGate: true, gapsScope: true },
  negative: { core: 'worst quality, low quality, artist name', byTier: { safe: '', sensitive: '', nsfw: '' }, dropRules: [] },
  dialogue: { commonAlways: true },
  lexicon: { poolEnabled: false, tierGateStrict: true, kbDir: null },
  output: { format: 'hybrid', withPrefix: false, broad: false },
  appearance: { preset: 'standard', alpha: 0.86, blur: 14, radius: 14, motion: 'subtle' }
});

/** 深拷贝一份内置默认（调用方随便改，不影响常量） */
export function builtinConfig() {
  return JSON.parse(JSON.stringify(BUILTIN_PANEL_CONFIG));
}

const clone = o => JSON.parse(JSON.stringify(o));
const isRecord = v => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * 读一组词（删除规则的 `when` / `drop`）：必须是非空数组，逐项去空白，
 * 单项 ≤ 64 字符、最多 24 项；不合法处推 issue，并尽量保留可用部分。
 * 文案与面板契约 `config-types.ts#readTerms` 逐字一致（两侧报同一句话）。
 * @param {unknown} raw
 * @param {string} path 形如 `negative.dropRules[0].when`
 * @param {string} label 「触发标签」/「要删的项」
 * @param {{path: string, message: string}[]} issues
 * @returns {string[]}
 */
function readRuleTerms(raw, path, label, issues) {
  if (raw === undefined) {
    issues.push({ path, message: `${label}不能为空，至少写一项` });
    return [];
  }
  if (!Array.isArray(raw)) {
    issues.push({ path, message: `${label}必须是数组` });
    return [];
  }
  if (raw.length === 0) {
    issues.push({ path, message: `${label}不能为空，至少写一项` });
    return [];
  }
  const terms = [];
  raw.forEach((value, i) => {
    if (typeof value !== 'string' || value.trim() === '') {
      issues.push({ path: `${path}[${i}]`, message: `${label}不能是空项` });
      return;
    }
    const term = value.trim();
    if (term.length > MAX_DROP_TERM_LENGTH) {
      issues.push({ path: `${path}[${i}]`, message: `${label}单项最长 ${MAX_DROP_TERM_LENGTH} 个字符` });
      return;
    }
    terms.push(term);
  });
  if (terms.length > MAX_DROP_TERMS) {
    issues.push({ path, message: `${label}最多 ${MAX_DROP_TERMS} 项` });
  }
  return terms.slice(0, MAX_DROP_TERMS);
}

/**
 * 读误杀项删除规则表（面板编辑的额外规则，叠加在技能内置规则之上）。
 * 字段缺失 = 没有额外规则，合法；结构坏了才判非法（该文件整体回退内置默认）。
 * 文案与面板契约 `config-types.ts#readDropRules` 一致。
 * @param {unknown} raw
 * @param {{path: string, message: string}[]} issues
 * @returns {{id: string, when: string[], drop: string[]}[]}
 */
function readDropRules(raw, issues) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    issues.push({ path: 'negative.dropRules', message: '删除规则必须是数组' });
    return [];
  }
  if (raw.length > MAX_DROP_RULES) {
    issues.push({ path: 'negative.dropRules', message: `删除规则最多 ${MAX_DROP_RULES} 条` });
  }
  const rules = [];
  const seenIds = new Set();
  raw.slice(0, MAX_DROP_RULES).forEach((entry, i) => {
    const path = `negative.dropRules[${i}]`;
    if (!isRecord(entry)) {
      issues.push({ path, message: '删除规则必须是对象' });
      return;
    }
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    if (!DROP_RULE_ID_PATTERN.test(id)) {
      issues.push({ path: `${path}.id`, message: '规则 id 只允许小写字母、数字、短横线与下划线，且以字母开头' });
    } else if (seenIds.has(id)) {
      issues.push({ path: `${path}.id`, message: `规则 id「${id}」重复` });
    } else {
      seenIds.add(id);
    }
    const when = readRuleTerms(entry.when, `${path}.when`, '触发标签', issues);
    const drop = readRuleTerms(entry.drop, `${path}.drop`, '要删的项', issues);
    rules.push({ id, when, drop });
  });
  return rules;
}

/**
 * 配置候选链（顺序固定，第一个「存在且合法」的胜出）：
 *   ① `$DSH_ANIMA_PANEL_CONFIG`  —— 显式覆写（测试与高级用法）
 *   ② `$DSH_HOME/anima-panel/panel-config.json` —— 面板写入的真位置（DSH_HOME 缺省 ~/.dsh）
 *   ③ `<skillDir>/panel-config.json` —— 技能目录自带副本，脱离面板也能用
 * @param {{env?: object, dshHome?: string, skillDir?: string}} opts
 * @returns {string[]} 绝对路径数组
 */
export function configCandidates(opts = {}) {
  const env = opts.env || process.env;
  const dshHome = opts.dshHome
    || env.DSH_HOME
    || path.join(os.homedir(), '.dsh');
  const list = [];
  if (env.DSH_ANIMA_PANEL_CONFIG) list.push(path.resolve(env.DSH_ANIMA_PANEL_CONFIG));
  list.push(path.join(dshHome, 'anima-panel', 'panel-config.json'));
  if (opts.skillDir) list.push(path.join(opts.skillDir, 'panel-config.json'));
  return list;
}

/**
 * 配置来源的一行文案（错误信息与 `--info` 共用，避免各写一份）。
 * 命中文件 → 返回该文件绝对路径；**没有可用文件 → 返回「未找到，候选链：A → B → C」**，
 * 绝不把一个其实并不存在的候选路径打印成「配置文件：<path>」（那会让人以为配置生效了）。
 * @param {{path?: string, exists?: boolean, used?: string, candidates?: string[]}} source loadPanelConfig().source
 * @returns {string}
 */
export function configRef(source) {
  const s = source || {};
  if (s.used && s.used !== 'builtin') return s.used;
  const chain = Array.isArray(s.candidates) && s.candidates.length
    ? s.candidates
    : (s.path ? [s.path] : []);
  return `未找到，候选链：${chain.join(' → ')}`;
}

/**
 * 校验一份未知文档，并把缺失字段按内置默认补齐。
 * @param {unknown} input 解析后的 JSON（或任何东西）
 * @returns {{ok: boolean, issues: {path: string, message: string}[], config: object}}
 */
export function validatePanelConfig(input) {
  const issues = [];
  const config = builtinConfig();
  if (input === undefined) return { ok: true, issues, config };
  if (!isRecord(input)) {
    issues.push({ path: '', message: '配置必须是 JSON 对象' });
    return { ok: false, issues, config };
  }

  // ---- 档位表：结构性错误一律判非法（档名/重名/条数/defaultTier） ----
  let tiers = config.tiers;
  if (input.tiers !== undefined) {
    if (!Array.isArray(input.tiers)) {
      issues.push({ path: 'tiers', message: '档位必须是数组' });
    } else if (input.tiers.length < MIN_TIERS || input.tiers.length > MAX_TIERS) {
      issues.push({ path: 'tiers', message: `档数必须在 ${MIN_TIERS}–${MAX_TIERS} 之间` });
    } else {
      const seenNames = new Set();
      const seenOrders = new Set();
      tiers = [];
      input.tiers.forEach((entry, i) => {
        if (!isRecord(entry)) {
          issues.push({ path: `tiers[${i}]`, message: '档位必须是对象' });
          return;
        }
        const name = typeof entry.name === 'string' ? entry.name : '';
        const label = typeof entry.label === 'string' ? entry.label : '';
        const order = Number.isInteger(entry.order) ? entry.order : i + 1;
        if (!TIER_NAME_PATTERN.test(name)) {
          issues.push({ path: `tiers[${i}].name`, message: '档名只允许小写字母、数字与下划线，且以字母开头' });
        } else if (seenNames.has(name)) {
          issues.push({ path: `tiers[${i}].name`, message: `档名「${name}」重复` });
        } else {
          seenNames.add(name);
        }
        if (label.trim() === '') issues.push({ path: `tiers[${i}].label`, message: '显示名不能为空' });
        if (seenOrders.has(order)) issues.push({ path: `tiers[${i}].order`, message: `排序值 ${order} 重复` });
        else seenOrders.add(order);
        tiers.push({
          name,
          label,
          order,
          criteria: typeof entry.criteria === 'string' ? entry.criteria : ''
        });
      });
      if (tiers.length === 0) tiers = config.tiers;
      else tiers = tiers.slice().sort((a, b) => a.order - b.order);
    }
  }

  const names = tiers.map(t => t.name);
  const defaultTier = typeof input.defaultTier === 'string' ? input.defaultTier : config.defaultTier;
  if (names.length && !names.includes(defaultTier)) {
    issues.push({ path: 'defaultTier', message: `默认档「${defaultTier}」不在档位表里` });
  }

  // ---- 五面开关：非布尔按默认补，不算非法 ----
  const facesRaw = isRecord(input.faces) ? input.faces : {};
  const faces = {};
  for (const key of Object.keys(config.faces)) {
    faces[key] = typeof facesRaw[key] === 'boolean' ? facesRaw[key] : config.faces[key];
  }

  // ---- 负面词：core 必为字符串；byTier 按档名补空串；dropRules 是面板额外删除规则 ----
  const negRaw = isRecord(input.negative) ? input.negative : {};
  const byTierRaw = isRecord(negRaw.byTier) ? negRaw.byTier : {};
  const byTier = {};
  for (const name of names) {
    const v = byTierRaw[name];
    byTier[name] = typeof v === 'string' ? v : (config.negative.byTier[name] || '');
  }
  const dropRules = readDropRules(negRaw.dropRules, issues);

  const dialogueRaw = isRecord(input.dialogue) ? input.dialogue : {};
  const lexiconRaw = isRecord(input.lexicon) ? input.lexicon : {};
  const outputRaw = isRecord(input.output) ? input.output : {};
  const appearanceRaw = isRecord(input.appearance) ? input.appearance : {};

  // ---- 输出默认：format 白名单；broad 是「候选松紧」独立开关（与档位无关） ----
  const format = typeof outputRaw.format === 'string' ? outputRaw.format : config.output.format;
  if (!['hybrid', 'tags', 'prompt', 'json', 'gaps'].includes(format)) {
    issues.push({ path: 'output.format', message: 'format 只能是 hybrid / tags / prompt / json / gaps' });
  }

  // ---- 外观：数值越界判非法（面板表单能就地标红） ----
  const preset = typeof appearanceRaw.preset === 'string' ? appearanceRaw.preset : config.appearance.preset;
  if (!['compact', 'standard', 'wide'].includes(preset)) {
    issues.push({ path: 'appearance.preset', message: 'preset 只能是 compact / standard / wide' });
  }
  const numIn = (key, min, max, fallback) => {
    const v = appearanceRaw[key];
    if (v === undefined) return fallback;
    if (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max) return v;
    issues.push({ path: `appearance.${key}`, message: `${key} 必须在 ${min}–${max} 之间` });
    return fallback;
  };
  const radius = appearanceRaw.radius === undefined
    ? config.appearance.radius
    : ([10, 14, 18].includes(appearanceRaw.radius) ? appearanceRaw.radius
      : (issues.push({ path: 'appearance.radius', message: 'radius 只能是 10 / 14 / 18' }), config.appearance.radius));
  const motion = appearanceRaw.motion === undefined
    ? config.appearance.motion
    : (['full', 'subtle', 'off'].includes(appearanceRaw.motion) ? appearanceRaw.motion
      : (issues.push({ path: 'appearance.motion', message: 'motion 只能是 full / subtle / off' }), config.appearance.motion));

  const merged = {
    version: 1,
    tiers,
    defaultTier: names.length && names.includes(defaultTier) ? defaultTier : tiers[0].name,
    faces,
    negative: {
      core: typeof negRaw.core === 'string' ? negRaw.core : config.negative.core,
      byTier,
      dropRules
    },
    dialogue: {
      commonAlways: typeof dialogueRaw.commonAlways === 'boolean' ? dialogueRaw.commonAlways : config.dialogue.commonAlways
    },
    lexicon: {
      poolEnabled: typeof lexiconRaw.poolEnabled === 'boolean' ? lexiconRaw.poolEnabled : config.lexicon.poolEnabled,
      tierGateStrict: typeof lexiconRaw.tierGateStrict === 'boolean' ? lexiconRaw.tierGateStrict : config.lexicon.tierGateStrict,
      kbDir: typeof lexiconRaw.kbDir === 'string' ? lexiconRaw.kbDir : null
    },
    output: {
      format: ['hybrid', 'tags', 'prompt', 'json', 'gaps'].includes(format) ? format : config.output.format,
      withPrefix: typeof outputRaw.withPrefix === 'boolean' ? outputRaw.withPrefix : config.output.withPrefix,
      broad: typeof outputRaw.broad === 'boolean' ? outputRaw.broad : config.output.broad
    },
    appearance: {
      preset: ['compact', 'standard', 'wide'].includes(preset) ? preset : config.appearance.preset,
      alpha: numIn('alpha', 0.7, 1, config.appearance.alpha),
      blur: numIn('blur', 0, 24, config.appearance.blur),
      radius,
      motion
    }
  };

  return { ok: issues.length === 0, issues, config: merged };
}

/** 一行 stderr 文案，形如 `[anima-tag-reverse] …，已回退内置默认：safe / sensitive / nsfw` */
export function warnLine(warnings, config) {
  const names = tierNames(config || BUILTIN_PANEL_CONFIG).join(' / ');
  return `[anima-tag-reverse] ${warnings.join('；')}，已回退内置默认：${names}`;
}

/**
 * 读取唯一真理源。逐个候选尝试，返回第一个合法文件；都不行则内置默认。
 * @param {{env?: object, dshHome?: string, skillDir?: string}} opts
 * @returns {{config: object, source: {path: string, exists: boolean, used: string}, warnings: string[]}}
 */
export function loadPanelConfig(opts = {}) {
  const candidates = configCandidates(opts);
  const warnings = [];
  let sawAnyFile = false;
  let lastPath = candidates[candidates.length - 1] || '';

  for (const file of candidates) {
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch {
      continue;                                  // 不存在／读不了：静默跳过（候选链的正常路径）
    }
    sawAnyFile = true;
    lastPath = file;
    let parsed;
    try {
      parsed = JSON.parse(stripBom(raw));
    } catch (e) {
      warnings.push(`${file} 不是合法 JSON（${e.message}）`);
      continue;
    }
    const result = validatePanelConfig(parsed);
    if (result.ok) {
      return { config: result.config, source: { path: file, exists: true, used: file, candidates }, warnings };
    }
    const first = result.issues.slice(0, 3).map(i => `${i.path || '<root>'} ${i.message}`).join('、');
    warnings.push(`${file} 不合法（${first}${result.issues.length > 3 ? ` 等 ${result.issues.length} 处` : ''}）`);
  }

  return {
    config: builtinConfig(),
    source: { path: lastPath, exists: sawAnyFile, used: 'builtin', candidates },
    warnings
  };
}

/** Windows 记事本／PowerShell 存出的 UTF-8 常带 BOM，JSON.parse 会直接报错 */
function stripBom(s) {
  return s && s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** 按 order 排序后的档名表——所有需要「档位顺序」的地方都从这里取，别再硬编码 */
export function tierNames(config) {
  const tiers = Array.isArray(config?.tiers) && config.tiers.length ? config.tiers : BUILTIN_PANEL_CONFIG.tiers;
  return tiers.slice().sort((a, b) => (a.order || 0) - (b.order || 0)).map(t => t.name);
}

/** 档名 → 显示名（报错文案用） */
export function tierLabel(config, name) {
  const t = (config?.tiers || []).find(x => x.name === name);
  return t ? t.label : name;
}

/**
 * 校验一个 --rating 取值。
 *   合法        → { ok: true, name }
 *   旧档位名    → { ok: false, kind: 'legacy', message }  （硬报错退出，附迁移对照表）
 *   其它未知值  → { ok: false, kind: 'unknown', message }（硬报错退出，列出当前档名）
 */
export function resolveTier(config, value) {
  const names = tierNames(config);
  const v = String(value == null ? '' : value).trim();
  if (!v) return { ok: false, kind: 'unknown', message: '分级不能为空' };
  if (names.includes(v)) return { ok: true, name: v };
  if (Object.prototype.hasOwnProperty.call(LEGACY_TIERS, v)) {
    const to = LEGACY_TIERS[v];
    return {
      ok: false,
      kind: 'legacy',
      message: `分级「${v}」是旧档位名，已改名为「${to}」（${tierLabel(config, to)}）`
    };
  }
  return {
    ok: false,
    kind: 'unknown',
    message: `分级「${v}」不在档位表里；当前档名：${names.join(' / ')}`
  };
}

/** 迁移对照表（多行字符串，逐条列出旧档位 → 新档位） */
export function migrationTable(config) {
  const lines = ['旧档位名 → 新档位名（迁移对照表）'];
  for (const [from, to] of Object.entries(LEGACY_TIERS)) {
    lines.push(`  --rating ${from}  →  --rating ${to}    （${tierLabel(config, to)}）`);
  }
  lines.push(`当前档位表：${tierNames(config).map(n => `${n}（${tierLabel(config, n)}）`).join('、')}`);
  return lines.join('\n');
}
