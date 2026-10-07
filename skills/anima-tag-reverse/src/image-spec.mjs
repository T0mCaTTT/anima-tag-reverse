/**
 * image-spec.mjs —— 第一步（图像分支）：把「看图得到的结构化描述」变成同样的分句计划
 *
 * 设计取舍：本技能不下本地视觉模型（环境里也没有任何模型权重）。
 * 图像走「多模态观察 → 结构化 JSON → 文本引擎」这条路：
 *   1. 调用方（在会话里看图的那个模型）按 IMAGE_SPEC_TEMPLATE 的结构写出观察结果；
 *   2. specToPlan() 把它摊平成与 parseText 完全同构的分句计划；
 *   3. 后续 matchPlan / compose 与文本输入一字不改地复用。
 * 好处：文本与图像两条输入共用同一套打分与排序，行为可预测、可解释。
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
  style: { medium: '', artist_style: '', lighting: '', camera: '', composition: '', palette: '', quality: '' },
  artists: ['@画师标签，若画面明显是某画师风格'],
  nsfw: '',
  negative: ['不要把画面里的杂物写进来——只写确实需要排除的'],
  notes: '其他值得记录的观察'
};

/** 键 → 层提示（决定打分时偏向哪一层） */
const KEY_HINT = [
  [/^(subject|count|gender|age)$/i, 1],
  [/^(characters?|character)$/i, 2],
  [/^(series|from|source)$/i, 3],
  [/^(appearance|hair|hair_style|eyes|expression|body|skin|special|face)$/i, 4],
  [/^(style|artist_style|medium|palette|lighting_carrier)$/i, 5],
  [/^(artists?|artist)$/i, 5],
  [/^(outfit|top|bottom|dress|legwear|footwear|headwear|accessories|held|clothes|clothing)$/i, 6],
  [/^(pose|action|hands|legs|facing|gesture)$/i, 6],
  [/^(scene|location|time|weather|props|background)$/i, 7],
  [/^(camera|composition|lighting|quality|focus|shot)$/i, 7]
];

const hintFor = key => {
  for (const [re, layer] of KEY_HINT) if (re.test(key)) return layer;
  return null;
};

/** 把 spec 摊平成 [{text, hint}]（subject.count/gender 不进分句，它们已由 parseCount 处理） */
function flatten(spec, prefix = '', out = []) {
  if (spec === null || spec === undefined) return out;
  if (Array.isArray(spec)) {
    for (const v of spec) flatten(v, prefix, out);
    return out;
  }
  if (typeof spec === 'object') {
    for (const [k, v] of Object.entries(spec)) {
      // 人数/性别已由 parseCount 换成强制标签，别再当分句送进匹配
      if (prefix === 'subject' && /^(count|gender)$/i.test(k)) continue;
      flatten(v, k, out);
    }
    return out;
  }
  const text = String(spec).trim();
  if (!text || text === '-') return out;
  if (text.includes('…') || /^(角色名|作品名|其他值得记录的观察|不要把画面里的杂物)/.test(text)) return out;   // 模板占位符不算内容
  const hint = hintFor(prefix);
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
  let input = spec;
  if (typeof spec === 'string') {
    try { input = JSON.parse(spec); } catch { input = { notes: spec }; }
  }
  const flat = flatten(input);
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

export const _internal = { flatten, hintFor };
