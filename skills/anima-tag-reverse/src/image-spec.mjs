/**
 * image-spec.mjs —— 第一步（图像分支）：把「看图得到的结构化描述」变成同样的分句计划
 *
 * 设计取舍：本技能不下本地视觉模型（环境里也没有任何模型权重）。
 * 图像走「多模态观察 → 结构化 JSON → 文本引擎」这条路：
 *   1. 调用方（在会话里看图的那个模型）按 IMAGE_SPEC_TEMPLATE 的结构写出观察结果；
 *   2. specToPlan() 把它摊平成与 parseText 完全同构的分句计划；
 *   3. 后续 matchPlan / compose 与文本输入一字不改地复用。
 * 好处：文本与图像两条输入共用同一套打分与排序，行为可预测、可解释。
 *
 * 本轮收紧（踩过的坑，勿回退）：
 *   - `notes` 是**纯日志**，不再产出分句、不参与匹配（只收集进 plan.notesText）。
 *     实测：把「anime」「晨光从左侧射入」写在 notes 里，标签串就静默少掉画风与光位，
 *     而且没有任何报警。现在这类观察必须落到结构化字段，否则会在缺项清单里被点名。
 *   - 键名别名归一（`lights` / `framing` / `artstyle` / `artist` / `body_type` …）在
 *     摊平之前做，避免同一件事因为写法不同落错层或落错分句。
 *   - `analyzeImageSpec()` 列出「必须落成结构化字段的观察维度」里缺了哪些，供
 *     gaps.mjs 亮出来（缺项清单的 `C-spec-*` 组）。
 */
import { parsePhrase } from './parse.mjs';

/** 观察模板：键名即语义，值写自然语言（中/英/日都行） */
export const IMAGE_SPEC_TEMPLATE = {
  subject: { count: '1girl / 2girls…', gender: '', age: '' },
  characters: ['角色名（知名作品角色，写原名）'],
  series: ['作品名'],
  appearance: { hair: '', hair_style: '', eyes: '', expression: '', body: '', skin: '', special: '' },
  outfit: { top: '', bottom: '', dress: '', legwear: '', footwear: '', headwear: '', accessories: [], held: '' },
  pose: { action: '', hands: '', legs: '', facing: '' },
  scene: { location: '', time: '', weather: '', props: [] },
  style: {
    medium: 'anime screenshot / official art / realistic / sketch…',   // 画风 / 媒介：单写 anime 词库里没有对应标签，anime screenshot 才命中
    artist_style: '',                                                  // 具体画师风格（画师名写进 artists[]，这里写风格描述）
    lighting: 'soft lighting / hard light / rim light…',               // 打光方式
    light_direction: '背光 / 来自左侧 / 顶光 backlighting…',            // 光位（光源方向）：只写「柔光」不算光位
    camera: '平视 / 俯视 / 仰视 eye level / from above…',               // 镜头 / 视角
    framing: '全身 / 半身 / 特写 full body / upper body / close-up…',   // 景别（取景范围）
    composition: '',                                                   // 构图：居中 / 三分法
    palette: '冷色调 / 暖色调 cool colors / warm colors…',              // 色调
    quality: '厚涂感 / 电影感 painterly / film grain…'                  // 画面质感
  },
  artists: ['@画师标签，若画面明显是某画师风格'],
  nsfw: '',
  negative: ['不要把画面里的杂物写进来——只写确实需要排除的'],
  notes: '纯日志：这里写的内容不产出标签、不参与匹配；要落标签请写进上面的结构化字段'
};

/** 有内容的结构化键：一个都没有时才算「没走结构化」（走 notes 兼容分支） */
const STRUCTURED_KEYS = ['subject', 'appearance', 'outfit', 'pose', 'scene', 'style', 'characters', 'series', 'artists'];

/**
 * 键名别名归一表：`别名 → 规范键路径`。
 * 调用方（看图的那个模型）常按自己的习惯起名，这里统一收到模板的键上，
 * 与 `KEY_HINT` / `hintFor()` 同层处理，避免「同一个观察落错层 / 落错分句」。
 * 规则：
 *   - 带点的值是「从根出发的绝对路径」（`artstyle` → `style.artist_style`）；
 *   - 不带点的值是「本层同级键」（`framing` 在 style 内、`artist` 在根上）；
 *   - 已经是模板规范键的（如 `style` 里的 `framing`）不会被二次搬运。
 */
export const KEY_ALIASES = Object.freeze({
  // ---- 光 ----
  lights: 'style.lighting', light: 'style.lighting',
  lighting_direction: 'style.light_direction', light_dir: 'style.light_direction',
  light_source: 'style.light_direction', lightsource: 'style.light_direction',
  // ---- 画风 / 媒介 ----
  artstyle: 'style.artist_style', art_style: 'style.artist_style', painter_style: 'style.artist_style',
  style_medium: 'style.medium', medium: 'medium', render: 'style.medium',
  render_style: 'style.medium', style_type: 'style.medium',
  // ---- 景别 / 镜头 / 构图 ----
  framing: 'style.framing', shot: 'style.camera', camera_angle: 'style.camera',
  angle: 'style.camera', view_angle: 'style.camera', viewpoint: 'style.camera',
  composition_style: 'style.composition',
  // ---- 画师 ----
  artist: 'artists', artist_tag: 'artists', artist_name: 'artists', painter: 'artists',
  draw_by: 'artists', by: 'artists',
  // ---- 人物外观 ----
  body_type: 'appearance.body', bodytype: 'appearance.body', figure: 'appearance.body', build: 'appearance.body',
  hairstyle: 'appearance.hair_style', hair_style: 'appearance.hair_style', haircut: 'appearance.hair_style',
  hair_color: 'appearance.hair', haircolor: 'appearance.hair',
  eye_color: 'appearance.eyes', eyecolor: 'appearance.eyes',
  // ---- 服装 ----
  leg_wear: 'outfit.legwear', legwear_type: 'outfit.legwear', socks: 'outfit.legwear',
  shoes: 'outfit.footwear', hat: 'outfit.headwear'
});

/**
 * 必须落成结构化字段的观察维度（图像分支的强制自审清单）。
 *
 * 判据只有两条：① 没有专属标签载体时该观察会静默丢掉；② 丢了就改变出图结果。
 * `key` 是规范键路径，`severity` 是缺了之后的影响档，`advice` 是可以直接照抄的写法。
 * `group` 是给 gaps.mjs 去重用：同名 group 已经在「C 粒度不足」里报过就不重复报。
 */
export const REQUIRED_OBSERVATIONS = Object.freeze([
  {
    key: 'style.medium',
    label: '画风 / 媒介',
    severity: 'high',
    group: 'art-style',
    advice: '在 style.medium 写一个明确取值：anime screenshot / official art / realistic / sketch / pixel art。注意单写 anime 词库里没有对应标签（实测会落进未匹配片段），anime screenshot 才命中。'
  },
  {
    key: 'style.light_direction',
    label: '光位（光源方向）',
    severity: 'high',
    sibling: ['style.lighting'],   // 只写了打光方式不算光位，但要指出来（srcKey）
    advice: '在 style.light_direction 写：backlighting（背光）/ light source on the left / on the right / from above。只写「柔光」不算光位，会照报缺项。'
  },
  {
    key: 'style.framing',
    label: '景别（取景范围）',
    severity: 'medium',
    group: 'framing',
    advice: '在 style.framing 写：full body / upper body / close-up / portrait。空着时工具会自己挑一个景别，结果不可控。'
  },
  {
    key: 'outfit.legwear',
    label: '腿袜 / 腿部穿着',
    severity: 'medium',
    group: 'legwear',
    advice: '在 outfit.legwear 写：thighhighs（过膝袜）/ kneehighs / pantyhose / boots（长筒靴）；确实没有就显式写「无」（腿被裁掉时也算「无」）。'
  },
  {
    key: 'appearance.body',
    label: '体型',
    severity: 'medium',
    group: 'body',
    advice: '在 appearance.body 写：slim（纤细）/ curvy / petite / tall。体型不写时模型按默认体型出，多角色构图容易崩。'
  },
  {
    key: 'outfit.top',
    label: '上衣',
    severity: 'medium',
    group: 'outfit-top',
    advice: '在 outfit.top（或 outfit.dress / outfit.uniform）写看到的上装：shirt / sweater / school uniform / dress。'
  },
  {
    key: 'outfit.footwear',
    label: '鞋',
    severity: 'low',
    group: 'footwear',
    advice: '在 outfit.footwear 写：boots / loafers / sneakers / barefoot；景别看不到脚时显式写 barefoot 或「无」。'
  },
  {
    key: 'pose.action',
    label: '身体动作',
    severity: 'medium',
    group: 'pose',
    advice: '在 pose.action 写一个明确动作：standing / sitting / lying / kneeling / walking。'
  },
  {
    key: 'style.camera',
    label: '镜头 / 视角',
    severity: 'low',
    group: 'camera',
    advice: '在 style.camera 写：eye level（平视）/ from above（俯视）/ from below（仰视）/ wide angle。视角不写时默认平视。'
  }
]);

/** 键 → 层提示（决定打分时偏向哪一层） */
const KEY_HINT = [
  [/^(subject|count|gender|age)$/i, 1],
  [/^(characters?|character)$/i, 2],
  [/^(series|from|source)$/i, 3],
  [/^(appearance|hair|hair_style|eyes|expression|body|skin|special|face)$/i, 4],
  [/^(artists?|artist|artist_tag|artist_name|painter|draw_by)$/i, 5],
  [/^(style|artist_style|medium|render|render_style|style_type|lighting)$/i, 5],
  [/^(outfit|top|bottom|dress|legwear|footwear|headwear|accessories|hat|held|clothes|clothing)$/i, 6],
  [/^(pose|action|hands|legs|facing|gesture)$/i, 6],
  [/^(scene|location|time|weather|props|background)$/i, 7],
  [/^(camera|composition|light_direction|lights?|light_source|quality|focus|shot|framing|palette|angle|viewpoint)$/i, 7]
];

const hintFor = key => {
  for (const [re, layer] of KEY_HINT) if (re.test(key)) return layer;
  return null;
};

/** 空白值 / 别名未命中时，正常键名把 alias 提到 hint 兜底（也决定空键该不该留） */
const isEmptyValue = v => v === undefined || v === null ||
  (typeof v === 'string' && v.trim() === '') ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === 'object' && !Array.isArray(v) && v !== null && Object.keys(v).length === 0);

const isPlainObject = v => !!v && typeof v === 'object' && !Array.isArray(v);

/** 归并同路径的两个值时把值摊平（`'a'` 与 `['b']` → `['a','b']`），避免后写覆盖先写 */
function mergeValue(prev, next) {
  // 两边都是对象时逐键深并，避免整棵子树被第二个值替换
  if (isPlainObject(prev) && isPlainObject(next)) {
    const out = { ...prev };
    for (const [k, v] of Object.entries(next)) out[k] = k in out ? mergeValue(out[k], v) : v;
    return out;
  }
  const list = [];
  const push = v => {
    if (Array.isArray(v)) { for (const x of v) push(x); return; }
    if (!isEmptyValue(v)) list.push(v);
  };
  push(prev);
  push(next);
  if (list.length === 1) return list[0];
  return list.length ? list : '';
}

/** 模板里本层是否有这个规范键（有就说明是规范写法，不做别名搬运） */
function isCanonicalHere(pathParts, key) {
  let cur = IMAGE_SPEC_TEMPLATE;
  for (const seg of pathParts) {
    if (!isPlainObject(cur) || !(seg in cur)) return false;
    cur = cur[seg];
  }
  return isPlainObject(cur) && key in cur;
}

function normValue(v, pathParts) {
  if (Array.isArray(v)) return v.map(x => normValue(x, pathParts)).filter(x => !isEmptyValue(x));
  if (isPlainObject(v)) return normObj(v, pathParts);
  return v;
}

/**
 * 递归归一：键名收到规范路径（别名合并），空键丢弃。
 * 别名只在「不是本层规范键」时才生效，所以 `{ style: { framing: … } }`
 * 不会被二次搬运成 `style.style.framing`。
 */
function normObj(obj, pathParts = []) {
  const out = {};
  const isRoot = pathParts.length === 0;
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    const alias = isCanonicalHere(pathParts, k) ? null : KEY_ALIASES[k];
    // 带点别名只在根层当绝对路径用；嵌套层里取它的叶子名，避免把整棵路径套两遍
    const target = !alias ? null
      : (alias.includes('.') ? (isRoot ? alias.split('.') : [alias.split('.').pop()]) : [alias]);
    const value = normValue(v, target ? pathParts.concat(target) : pathParts.concat([k]));
    if (target) {
      const leaf = target.pop();
      let bucket = out;
      for (const seg of target) {
        if (!isPlainObject(bucket[seg])) bucket[seg] = {};
        bucket = bucket[seg];
      }
      bucket[leaf] = leaf in bucket ? mergeValue(bucket[leaf], value) : value;
      continue;
    }
    out[k] = k in out ? mergeValue(out[k], value) : value;
  }
  // 清空键：值空且没被别名合并带出内容的，直接丢弃
  for (const [k, v] of Object.entries(out)) {
    if (isEmptyValue(v)) delete out[k];
  }
  return out;
}

/** 键名别名归一（导出供测试与调用方预览） */
export function normalizeSpec(spec) {
  const raw = typeof spec === 'string'
    ? (() => { try { return JSON.parse(spec); } catch { return { notes: spec }; } })()
    : spec;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return normObj(raw, '');
}

/** 规范化后的 spec 是否含结构化键（决定 notes 走不走兼容分支） */
function hasStructured(spec) {
  return STRUCTURED_KEYS.some(k => !isEmptyValue(spec && spec[k]));
}

/** 沿点路径取值（`style.light_direction`），空值为 undefined */
function valueAt(spec, dotted) {
  let cur = spec;
  for (const seg of String(dotted).split('.')) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = cur[seg];
  }
  return cur;
}

/** 占位写法（模板示例带 …，`-` 是空槽）一律不算「观察到了」 */
const isPlaceholderText = t => typeof t === 'string' && (t.includes('…') || t.trim() === '-' || t.trim() === '');

/**
 * 必填观察维度的缺失报告（图像分支自审的核心）。
 * 判据：本维度没有「真实的」结构化取值（空值、模板占位、或只有备注都不算）。
 * @param {object|string} spec 观察对象（或 JSON 串）
 * @returns {Array<{key,label,severity,advice,srcKey?}>} 缺了就报，够了就不报
 */
export function analyzeImageSpec(spec) {
  const normalized = normalizeSpec(spec);
  const filled = k => {
    const v = valueAt(normalized, k);
    if (isEmptyValue(v)) return false;
    if (typeof v === 'string') return !isPlaceholderText(v);
    if (Array.isArray(v)) return v.some(x => !isPlaceholderText(String(x)));
    return true;
  };
  const issues = [];
  for (const d of REQUIRED_OBSERVATIONS) {
    const accepts = d.accepts && d.accepts.length ? d.accepts : [d.key];
    if (accepts.some(filled)) continue;
    const issue = { key: d.key, label: d.label, severity: d.severity, advice: d.advice, group: d.group || '' };
    // 写了同一个维度的别处键（如只写柔光没写光位）时，指出来让调用方搬回去
    const wrote = (d.sibling || []).concat(accepts.slice(1)).find(k => valueAt(normalized, k) !== undefined);
    if (wrote) issue.srcKey = wrote;
    issues.push(issue);
  }
  return issues;
}

/** notes 是纯日志：只收集值，不产出分句 */
function collectNotes(v, out = []) {
  if (v === undefined || v === null) return out;
  if (typeof v === 'string') { const t = v.trim(); if (t) out.push(t); return out; }
  if (Array.isArray(v)) { for (const x of v) collectNotes(x, out); return out; }
  if (isPlainObject(v)) { for (const x of Object.values(v)) collectNotes(x, out); return out; }
  return out;
}

/** 只沿 `notes` 键取日志（别的键的字符串不进 notesText） */
function notesOf(spec, out = []) {
  if (Array.isArray(spec)) { for (const x of spec) notesOf(x, out); return out; }
  if (isPlainObject(spec)) {
    for (const [k, v] of Object.entries(spec)) {
      if (k === 'notes') collectNotes(v, out); else notesOf(v, out);
    }
  }
  return out;
}

/** 摊平前把 notes 整枝摘掉：结构化输入里它是日志，不是分句 */
function stripNotes(spec) {
  if (Array.isArray(spec)) return spec.map(stripNotes);
  if (isPlainObject(spec)) {
    const o = {};
    for (const [k, v] of Object.entries(spec)) { if (k === 'notes') continue; o[k] = stripNotes(v); }
    return o;
  }
  return spec;
}

/**
 * 把 spec 摊平成 [{text, hint, key}]
 *
 * - `subject.count` / `subject.gender` 跳过（它们已由 parseCount 处理成强制标签）
 * - notes 不在这里处理：结构化输入由 specToPlan 事先摘掉（stripNotes），
 *   兼容分支（整份输入没有结构化键）则原样当文本摊平——这才是旧行为
 */
function flatten(spec, prefix = '', out = []) {
  if (spec === null || spec === undefined) return out;
  if (Array.isArray(spec)) {
    for (const v of spec) flatten(v, prefix, out);
    return out;
  }
  if (typeof spec === 'object') {
    for (const [k, v] of Object.entries(spec)) {
      if (prefix === 'subject' && /^(count|gender)$/i.test(k)) continue;
      flatten(v, k, out);
    }
    return out;
  }
  const text = String(spec).trim();
  if (!text || text === '-') return out;
  if (text.includes('…') || /^(角色名|作品名|其他值得记录的观察|不要把画面里的杂物|纯日志)/.test(text)) return out;   // 模板占位符不算内容
  const hint = hintFor(prefix) ?? (KEY_ALIASES[prefix] ? hintFor(String(KEY_ALIASES[prefix]).split('.').pop()) : null);
  // 值里常写成 "长发, 蓝色" 或 "long hair / blue hair" —— 交给解析器分句
  for (const piece of text.split(/[,，;；、/／|｜]+/)) {
    const t = piece.trim();
    if (t) out.push({ text: t, hint, key: prefix });
  }
  return out;
}

/**
 * 观察结果 → 计划对象（与 parseText 的输出同构，可直接喂 matchPlan）
 * @param {object|string} spec 结构化观察，或直接一段自然语言（等价于 parseText）
 * @param {object} opts { source:'image' }
 */
export function specToPlan(spec, opts = {}) {
  // 只有「整份输入都没有结构化键」时才走旧行为（整段按笔记分句）。
  // JSON.parse 失败时在外面包成 { notes: spec }，同样落进这条兼容分支。
  const raw = typeof spec === 'string'
    ? (() => { try { return JSON.parse(spec); } catch { return { notes: spec }; } })()
    : spec;
  const structured = isPlainObject(raw) && hasStructured(raw);
  const input = structured ? normalizeSpec(raw) : raw;
  // notes 是纯日志：只收进 plan.notesText 保留可见性，不产分句、不参与匹配
  const notesText = notesOf(input).join(' / ');

  const flat = flatten(structured ? stripNotes(input) : input);
  const clauses = [];
  const negatedClauses = [];
  for (const f of flat) {
    const isNeg = /^(negative|exclude|avoid|不要|排除)$/i.test(f.key);
    const c = parsePhrase(f.text);
    if (f.hint !== null) c.layerHint = f.hint;
    c.fromKey = f.key;
    (isNeg ? negatedClauses : clauses).push(c);
  }
  // 人数单独补一条强制标签（图像分支最容易漏的就是这个）
  // 允许写法：1 / "1" / "1girl" / "2girls" / "单人" / "二人" / "两个人"
  const subj = (input && input.subject) || {};
  const n = parseCount(subj.count);
  if (n > 0) {
    const who = String(subj.gender || subj.kind || '');
    const noun = /boy|男|少年|男性|汉子/.test(who) ? 'boys' : 'girls';
    const forced = [n === 1 ? `1${noun.slice(0, -1)}` : `${n}${noun}`];
    if (n === 1) forced.push('solo');
    // 载体分句不写任何可匹配的文字（写 "solo" 会让它自己命中 solo 标签）
    const c = parsePhrase(' ');
    c.layerHint = 1;
    c.forced.push(...forced);
    clauses.unshift(c);
  }
  return {
    kind: 'image',
    raw: typeof spec === 'string' ? spec : JSON.stringify(input),
    spec: input,
    notesText,
    specIssues: structured ? analyzeImageSpec(input) : [],
    clauses,
    negatedClauses,
    isEmpty: clauses.length === 0
  };
}

/** 人数写法归一：1 / "1" / "1girl" / "2girls" / "单人" / "二人" / "两个人" → 数字 */
export function parseCount(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.round(v));
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s) return 0;
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const m = s.match(/^(\d+)\s*(girls?|boys?|people|persons?|characters?)$/);
  if (m) return parseInt(m[1], 10);
  if (/^(单人|一人|一个|ひとり|solo)$/.test(s)) return 1;
  if (/^(二人|双人|两人|两个人|ふたり)$/.test(s)) return 2;
  const cn = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
  const m2 = s.match(/^([一二两三四五六])人$/);
  if (m2) return cn[m2[1]] || 0;
  return 0;
}

/** 给调用方的空白模板（写文件时用） */
export function emptySpec() {
  return JSON.parse(JSON.stringify(IMAGE_SPEC_TEMPLATE));
}

export const _internal = { flatten, hintFor, hasStructured, collectNotes, normObj, KEY_HINT, STRUCTURED_KEYS };
