/**
 * intent.mjs —— 自然语言 → 融合意图（哪一张图提供哪一块）
 *
 * 输入：「把图1的姿势换到图2的人身上」「图1的上身特写换给图3」「场景用图2的，画风照图1」
 * 输出：{ base, sources, assumptions, ambiguous, unknown }
 *
 * 解析策略（刻意保守：**宁可报歧义，也不猜着换源**）
 *   1. 切子句（标点 + 然后/并且/同时…），在每个子句内部做局部判断，跨子句不互相污染；
 *   2. 先抽**宿主证据**（放到图2上 / 图2的人 / 以图1为基础 / 整体照图1），它决定「底子是谁」；
 *   3. 再抽**组合宏**（`上身特写` / `氛围感` / `人物全套`，见 dims.mjs 的 PRESETS）并展开成普通槽位，
 *      展开项与手写维度走同一套换源判定，不引入第二套语义；
 *   4. 再抽**维度词**（见 dims.mjs），并剔除落在宿主证据 / 组合宏区间里的命中——
 *      「图2的人物形象」里的「人物形象」是宿主证据，不是 appearance 换源指令；
 *   5. 每个槽位找源，优先级：同款句式（和…一样）> 源动词宾语（换成图1的）> 左侧最近的指代（图1的姿势）；
 *   6. 宿主缺失时的兜底：外观/角色若一致指向同一张图，就以那张为底（这是「图1的形象微调成图2的某方面」
 *      这类说法的正确读法）；否则默认以**最后一张**为底，并把这条假设明写进 assumptions；
 *   7. 剩下的碎片（「某方面」「更可爱一点」）进 unknown / ambiguous，交给会话里的我追问用户，
 *      而不是编一条他不认识的换源规则。
 */
import { matchDims, matchPresets, resolveSlotPath, resolvePreset, expandPreset, SLOTS } from './dims.mjs';
import { findRefs, findBaseEvidence, pickBase, NUM_RE, NUM_MAP, LETTER_MAP, toIndex, MAX_IMAGES } from './refs.mjs';

/** 源动词：宾语是**提供内容**的那张图（`换成图1的` → 姿势取图1） */
const SOURCE_VERB_SRC = '换成|换为|替换成|替换为|改成|改为|变成|变为|转为|转成|来自|取自|参考|参照|照着|学|抄|借用|沿用|套用|采用|使用|用|取|是|为';

/** 图编号的通用写法（阿拉伯 / 全角 / 中文 / 字母） */
const REF_TOKEN = `${NUM_RE}|[A-Fa-f]`;

/** 同款句式：`姿势和图1一样` */
const SAME_RE = new RegExp(`^\\s*(?:和|跟|与|同)\\s*(?:图|图片)?\\s*(${REF_TOKEN})\\s*(?:一样|相同|一致|同款|同步|保持)`);

/** 整体换底：`整体照图1` / `全部换成图3` */
const WHOLE_RE = new RegExp(`(?:全部|整体|完全|整个|全都|所有|整个画面)\\s*(?:都)?\\s*(?:换成|照|用|参考|套用|按|走)\\s*(?:图|图片)?\\s*(${REF_TOKEN})`);

/** 指令里出现的图指代（用于「这个动词的宾语是不是另一张图」的前置检查） */
const ANY_REF_RE = new RegExp(`(?:图|图片)\\s*(${REF_TOKEN})`);

/** 微调语汇：说明「底子不动、只改局部」，是宿主的弱证据 */
const REFINE_RE = /(?:微调|小改|轻微调整|局部修改|局部调整|稍微改|稍改|保留大部分|大体保留|大体不变|主要保留|稍微调整)/;

/** 「某方面 / 某些地方」：用户说了要改，但没说改哪儿 → 必须追问 */
const VAGUE_DIM_RE = /(?:某|哪|几)?\s*(?:些|个)?\s*(?:方面|地方|部分|部位|处)/;

/** 未知碎片提取时的停用词（这些不构成「没听懂的内容」） */
const STOPWORDS = new Set([
  '的', '了', '着', '把', '将', '被', '和', '与', '跟', '同', '或', '但', '而', '就', '还', '也', '都', '要', '请', '帮我', '给我', '来', '去',
  '是', '为', '有', '没', '之', '其', '即', '则', '让', '使', '给', '对', '从', '向', '按', '挺', '很', '太', '特', '别',
  '在', '上', '下', '里', '中', '上面', '下面', '身上', '身体', '人', '人物', '主体', '主角', '角色', '这个', '那个', '这张', '那张', '这样', '那样',
  '然后', '接着', '并且', '同时', '顺便', '以及', '而且', '另外', '再', '又', '一下', '一点', '一些', '稍微', '有点', '比较', '更', '最',
  '全部', '整体', '完全', '整个', '全都', '所有', '一样', '相同', '一致', '同款', '保持', '不变', '不动', '原样', '维持', '照旧',
  '基础', '底子', '蓝本', '骨架', '基准', '图', '图片', '第一', '第二', '一张', '两张', '干净', '请把', '改成', '换成', '替换', '变成', '转成',
  '替换成', '替换为', '换为', '改为', '变为', '转为', '放到', '换到', '套到', '移到', '转到', '用到', '加到', '装在', '取自', '来自', '参考', '参照', '照', '沿用', '套用', '采用', '使用', '搬', '挪',
  '微调', '小改', '局部', '修改', '调整', '方面', '地方', '部分', '某', '某些', '哪个', '哪些', '哪里'
]);

const CLAUSE_RE = /[，,。；;！!？?\n]+|然后|接着|并且|同时|顺便|以及|而且/g;

/** 切子句，保留绝对位置（后面算距离要用） */
function splitClauses(text) {
  const src = String(text || '');
  const parts = [];
  let start = 0;
  CLAUSE_RE.lastIndex = 0;
  let m;
  while ((m = CLAUSE_RE.exec(src)) !== null) {
    parts.push({ text: src.slice(start, m.index), start, end: m.index });
    start = m.index + m[0].length;
  }
  parts.push({ text: src.slice(start), start, end: src.length });
  return parts.filter(p => p.text.trim());
}

const overlaps = (a, b) => a.start < b.end && b.start < a.end;

/** 把区间打上掩码，用于「未知碎片」提取 */
function buildMask(len, spans) {
  const mask = new Array(len).fill(false);
  for (const s of spans) {
    for (let i = Math.max(0, s.start); i < Math.min(len, s.end); i++) mask[i] = true;
  }
  return mask;
}

/** 停用词按长度降序，供「整块可切分」判定使用 */
const STOP_SORTED = [...STOPWORDS].sort((x, y) => y.length - x.length);

/**
 * 把词块里能识别的虚词/动词逐个吃掉，返回剩下的「真正没听懂」的部分。
 * 中文没有词边界，靠单字停用词表贪心切分效果意外地好：
 *   `但是要更可爱一点` → `可爱`（这才是我该追问的东西）
 *   `的人身上` → ``（整块都是虚词，不该报）
 */
function residueOf(word) {
  let k = 0;
  let out = '';
  while (k < word.length) {
    const hit = STOP_SORTED.find(s => word.startsWith(s, k));
    if (hit) { k += hit.length; continue; }
    out += word[k];
    k += 1;
  }
  return out;
}

function extractUnknown(text, spans) {
  const mask = buildMask(text.length, spans);
  const out = [];
  const wordRe = /[\u4e00-\u9fa5a-zA-Z0-9]+/g;
  let i = 0;
  while (i < text.length) {
    if (mask[i]) { i++; continue; }
    let j = i;
    while (j < text.length && !mask[j]) j++;
    // 未打掩码的区间里再按「连续中文/字母数字」切词块：标点与空白天然断开，
    // 避免把 `身上，但保持` 当成一个词块（那样整块进不了停用词表，就会被误报）。
    const seg = text.slice(i, j);
    wordRe.lastIndex = 0;
    let m;
    while ((m = wordRe.exec(seg)) !== null) {
      const piece = m[0];
      const residue = residueOf(piece);
      if (residue.length < 2) continue;
      out.push({ text: residue, raw: piece, start: i + m.index, end: i + m.index + piece.length });
    }
    i = j;
  }
  return out;
}

/** 单个 token（数字 / 中文数字 / 字母）→ 图编号（考虑 count 与 swap） */
const sideOf = (token, opts = {}) => {
  const t = String(token).toLowerCase();
  const n = LETTER_MAP[t] || NUM_MAP[String(token).trim()];
  return n ? toIndex(n, { count: opts.count || 2, swap: !!opts.swap }) : null;
};

/** `--map pose=1,scene=2,上身特写=1` → 结构化换源表（组合宏会被展开） */
export function parseDimMap(text) {
  const sources = [];
  const errors = [];
  const raw = String(text || '').trim();
  if (!raw) return { sources, errors };
  for (const chunk of raw.split(/[,，;；]+/)) {
    const item = chunk.trim();
    if (!item) continue;
    const m = item.match(/^\s*(.+?)\s*(?:=|:|<-|→|->|@)\s*(.+?)\s*$/);
    if (!m) { errors.push(`无法解析的映射：${item}（应形如 pose=1 或 pose.hands=图2）`); continue; }
    const v = m[2].trim();
    const vm = v.match(new RegExp(`(${REF_TOKEN})`));
    if (!vm) { errors.push(`无法识别的图编号：${v}（写 1 / 2 / 图1 / a / b）`); continue; }
    const side = sideOf(vm[1], { count: MAX_IMAGES });   // 不裁剪：图编号上限由 refs.mjs 定
    if (!side) { errors.push(`无法识别的图编号：${v}`); continue; }
    const name = m[1];
    const path = resolveSlotPath(name);
    if (path) {
      sources.push({ path, side, evidence: item, confidence: 'explicit', from: 'map', label: SLOTS.get(path)?.label });
      continue;
    }
    const preset = resolvePreset(name);
    if (preset) {
      sources.push(...expandPreset(preset, side).map(s => ({ ...s, evidence: item, from: 'map' })));
      continue;
    }
    errors.push(`未知维度或组合：${name}（用 --dims / --presets 看全部可用项）`);
  }
  return { sources, errors };
}

/** `--base` 参数解析（支持 1/2/3、abc、图2、中文数字） */
export function normalizeSideArg(v, swap = false, count = MAX_IMAGES) {
  if (v === undefined || v === null || v === '') return null;
  const m = String(v).trim().match(new RegExp(`(${REF_TOKEN})`));
  if (!m) return null;
  return sideOf(m[1], { count, swap });
}

/** 给槽位找源（在同一个子句里） */
function resolveDimSource(clause, dim, win) {
  const tail = clause.text.slice(dim.end - clause.start);

  // ① 同款句式：`姿势和图1一样`
  const same = tail.match(SAME_RE);
  if (same) return { side: sideOf(same[1], win), confidence: 'high', rule: 'same-as' };

  // ② 源动词宾语：`姿势换成图1的` / `背景用图2` / `发型和瞳色都用图2的`（并列维度共享一个宾语）
  //    在 dim 右侧一小段窗口里找「源动词 + 图指代」，允许中间夹着别的维度词与连接词（和/、/与/跟）。
  const seg = tail.slice(0, 16);
  const verbRe = new RegExp(`(?:${SOURCE_VERB_SRC})\\s*(?:图|图片)?\\s*(${REF_TOKEN})`);
  const verb = seg.match(verbRe);
  if (verb) {
    const before = seg.slice(0, verb.index);
    // 宾语后面跟着「上 / 身上 / 里」说明这是**落点**（宿主）而不是来源：
    // 「图1的场景替换成图2上」= 图1出场景、图2当底，不能读成 scene←图2。
    const after = seg.slice(verb.index + verb[0].length, verb.index + verb[0].length + 2);
    const isLanding = /^(?:上|身上|上面|里|中)/.test(after);
    if (!isLanding && !ANY_REF_RE.test(before)) {
      return { side: sideOf(verb[1], win), confidence: 'high', rule: 'verb-object' };
    }
    ANY_REF_RE.lastIndex = 0;
  }

  // ③ 左侧最近的指代：`图1的姿势`
  const left = [...win.refs].reverse().find(r => r.end <= dim.start);
  if (left) {
    const between = clause.text.slice(left.end - clause.start, dim.start - clause.start);
    const gap = between.replace(/[\s的之那这个张幅]/g, '').length;
    return { side: left.side, confidence: gap <= 4 ? 'high' : 'medium', rule: gap <= 4 ? 'possessive' : 'left-ref' };
  }

  // ④ 右侧最近的指代（兜底：`姿势，图1的那种`）
  const right = win.refs.find(r => r.start >= dim.end);
  if (right && right.start - dim.end <= 6) {
    return { side: right.side, confidence: 'medium', rule: 'right-ref' };
  }
  return null;
}

/**
 * 解析融合指令。
 * @param {string} instruction 用户的自然语言
 * @param {{swap?:boolean, base?:number, count?:number}} opts count = 图片总数
 */
export function parseFusionIntent(instruction, opts = {}) {
  const text = String(instruction || '');
  const count = Math.max(1, Math.min(MAX_IMAGES, opts.count || 2));
  const swap = !!opts.swap;
  const win = { swap, count };
  const sideLabel = n => `图${n}`;
  const refs = findRefs(text, { swap, count });
  const baseEv = findBaseEvidence(text, { swap, count });

  // 整体换底：`整体照图1`
  const whole = text.match(WHOLE_RE);
  if (whole) {
    const side = sideOf(whole[1], win);
    if (side) {
      baseEv.push({
        side, raw: whole[0], weight: 3,
        start: whole.index, end: whole.index + whole[0].length, whole: true
      });
    }
  }

  // 组合宏：整组换源（`上身特写` / `氛围感` / `人物全套`）
  const presetHits = matchPresets(text).filter(h => !baseEv.some(ev => overlaps(h, ev)));

  // 维度命中：剔除落在宿主证据与组合宏里的（`图2的人物形象` 是宿主，不是换源）
  const dimHits = matchDims(text).filter(d => !baseEv.some(ev => overlaps(d, ev)) && !presetHits.some(h => overlaps(d, h)));

  // 组合宏展开成普通槽位（位置 = 宏的位置，判定源的方式与手写维度完全一致）
  const expanded = presetHits.flatMap(h => expandPreset(h.preset, null).map(s => ({
    path: s.path, label: s.label, group: s.group, isGroup: s.isGroup,
    alias: h.alias, preset: h.preset.id, start: h.start, end: h.end
  })));

  const allHits = [...dimHits, ...expanded].sort((a, b) => a.start - b.start || a.path.localeCompare(b.path));

  const clauses = splitClauses(text);
  const sources = [];
  const ambiguous = [];
  const assumptions = [];
  const consumed = [
    ...refs.map(r => ({ start: r.start, end: r.end })),
    ...baseEv.map(r => ({ start: r.start, end: r.end })),
    ...allHits.map(r => ({ start: r.start, end: r.end }))
  ];

  if (REFINE_RE.test(text)) {
    const m = text.match(REFINE_RE);
    consumed.push({ start: m.index, end: m.index + m[0].length });
  }
  if (VAGUE_DIM_RE.test(text)) {
    const m = text.match(VAGUE_DIM_RE);
    consumed.push({ start: m.index, end: m.index + m[0].length });
  }

  const pending = [];
  for (const dim of allHits) {
    const clause = clauses.find(c => dim.start >= c.start && dim.start < c.end) || { text, start: 0, end: text.length };
    const localRefs = refs.filter(r => r.start >= clause.start && r.start < clause.end);
    if (!localRefs.length) {
      pending.push(dim);
      continue;
    }
    const hit = resolveDimSource(clause, dim, { swap, count, refs: localRefs });
    if (!hit) { pending.push(dim); continue; }
    pending.push({ ...dim, ...hit });
  }

  // 同一槽位被指定了两次：取后者，并把冲突报出来（子级覆盖组级不算冲突）
  const byPath = new Map();
  for (const p of pending) {
    if (p.side === undefined || p.side === null) continue;
    const prev = byPath.get(p.path);
    if (prev && prev.side !== p.side) {
      ambiguous.push({
        code: 'dim-conflict',
        message: `「${p.label}（${p.path}）」被同时指向${sideLabel(prev.side)}和${sideLabel(p.side)}，我按后出现的${sideLabel(p.side)}处理。`,
        options: [
          { label: `用${sideLabel(p.side)}的${p.label}`, value: `${p.path}=${p.side}` },
          { label: `用${sideLabel(prev.side)}的${p.label}`, value: `${p.path}=${prev.side}` }
        ]
      });
    }
    byPath.set(p.path, p);
  }

  for (const p of pending) {
    if (p.side === undefined || p.side === null) continue;
    sources.push({
      path: p.path, label: p.label, group: p.group, isGroup: p.isGroup,
      side: p.side, alias: p.alias, preset: p.preset || null,
      evidence: text.slice(Math.max(0, p.start - 6), p.end + 6).trim(),
      confidence: p.confidence, rule: p.rule, start: p.start
    });
  }

  // 有维度词但没有图指代：
  //   全部都没指代 → 必须追问（否则等于默默按底图处理，用户会以为换源了）
  //   只有一部分没指代 → 回落到底图，但明写成假设，别让他以为换过源
  const unresolved = pending.filter(p => p.side === undefined || p.side === null);
  if (unresolved.length && unresolved.length === pending.length) {
    const labels = [...new Set(unresolved.map(p => p.label))].join('、');
    ambiguous.push({
      code: 'missing-ref',
      message: `提到了「${labels}」，但没说取自哪张图。`,
      options: [
        { label: '取自图1', value: '1' },
        { label: '取自最后一张', value: String(count) },
        { label: '保持底图不变', value: 'keep' }
      ]
    });
  } else if (unresolved.length) {
    for (const p of unresolved) {
      assumptions.push(`「${p.label}（${p.path}）」没指定来源，按底图处理（要换源请写「${p.label}用图1/图2的」，或用 --map ${p.path}=1）。`);
    }
  }

  // 「某方面」：说了要微调但没说改哪儿（「其他方面按图2」这种纯分配句不报）
  if (VAGUE_DIM_RE.test(text) && (REFINE_RE.test(text) || sources.length === 0)) {
    ambiguous.push({
      code: 'unspecified-dim',
      message: '你说「某个方面」但没说是哪一方面，需要明确到具体维度（发型 / 瞳色 / 服装 / 姿势 / 场景 / 画风…）或组合宏（上身特写 / 氛围感 / 人物全套）。',
      options: [
        { label: '发色 / 发型', value: 'appearance.hair,appearance.hair_style' },
        { label: '瞳色 / 眼睛', value: 'appearance.eyes' },
        { label: '上身特写（姿势+表情+景别+视角）', value: '上身特写' },
        { label: '服装', value: 'outfit' },
        { label: '姿势表情', value: '姿势表情' },
        { label: '场景光影', value: '场景光影' },
        { label: '色调氛围', value: '色调氛围' }
      ]
    });
  }

  // 完全没听出维度：可能用户想整体融合
  if (!allHits.length) {
    ambiguous.push({
      code: 'no-dim',
      message: '这句里我没识别出「要搬哪一块」（姿势 / 场景 / 服装 / 画风 / 发型…或组合宏），也没有明确的整体换底说法。',
      options: [
        { label: '整张以图1为底', value: 'base=1' },
        { label: `整张以${sideLabel(count)}为底`, value: `base=${count}` },
        { label: '我来指定维度', value: 'map' }
      ]
    });
  }

  // ---- 宿主（base）判定 ----
  let base = null;
  let baseConfidence = 'low';
  let baseReason = '';
  const picked = pickBase(baseEv);
  // 宿主兜底：**组级**外观/角色指向同一张图时以它为准（「图1的形象…」这种说法里，
  // 被并列点名的子级维度会把集合撑成两个来源，若不加区分就会误判成「没有一致指向」）。
  // 组级完全没出现时，只有**同一组的两条以上子级**指向同一张图才认：单条子级太弱，
  // 「上身特写」这类组合宏会顺带展开出 appearance.expression，拿它定宿主会误判。
  const mainSides = new Set(sources.filter(s => s.path === 'appearance' || s.path === 'characters').map(s => s.side));
  const subSources = sources.filter(s => s.path.startsWith('appearance.'));
  const subSet = new Set(subSources.map(s => s.side));
  const appearSides = mainSides.size ? mainSides : ((subSources.length >= 2 && subSet.size === 1) ? subSet : new Set());

  if (opts.base) {
    base = opts.base;
    baseConfidence = 'explicit';
    baseReason = '`--base` 显式指定';
  } else if (picked) {
    base = picked.side;
    baseConfidence = picked.whole ? 'high' : (picked.weight >= 3 ? 'high' : 'medium');
    baseReason = `「${picked.raw.trim()}」`;
  } else if (appearSides.size === 1) {
    base = [...appearSides][0];
    baseConfidence = 'medium';
    baseReason = '外观/角色一致指向这一张（我据此把它当底子）';
  } else {
    // 默认宿主 = 口头上的「最后一张」。--swap 把口头顺序与文件顺序对调，这里跟着翻。
    base = swap ? 1 : count;
    baseConfidence = 'low';
    baseReason = `没有明确宿主，默认以最后一张（${sideLabel(base)}）为底`;
  }

  // 宿主假设要明写出来（低/中置信时必须让用户有机会纠正）
  if (baseConfidence !== 'explicit') {
    assumptions.push(`宿主判定：${baseReason}。若不对，用 --base 覆盖。`);
  }

  // 源里有「整组 + 组内子级」不同源时，子级优先（更具体，不报冲突，但记一条说明）
  for (const s of sources.filter(x => x.isGroup)) {
    const kids = sources.filter(x => !x.isGroup && x.path.startsWith(s.path + '.') && x.side !== s.side);
    if (kids.length) {
      const detail = kids.map(k => `${k.label}←${sideLabel(k.side)}`).join('、');
      assumptions.push(`「${s.label}」整组取自${sideLabel(s.side)}，其中 ${detail}（更具体的维度优先）。`);
    }
  }

  const unknown = extractUnknown(text, consumed);

  // 融合说明：不产标签，只写进 notes 供人核对
  const summary = [
    `底图 = ${sideLabel(base)}`,
    ...sources.map(s => `${s.label}(${s.path}) ← ${sideLabel(s.side)}`)
  ].join('；');

  return {
    text,
    swap,
    count,
    base,
    baseConfidence,
    baseReason,
    sources: sources.sort((x, y) => x.path.localeCompare(y.path)),
    presets: presetHits.map(h => ({ id: h.preset.id, label: h.preset.label, alias: h.alias, slots: h.slots })),
    assumptions,
    ambiguous,
    unknown,
    refs: refs.map(r => ({ side: r.side, raw: r.raw, kind: r.kind })),
    summary
  };
}

export const _internal = { splitClauses, extractUnknown, residueOf, resolveDimSource, SOURCE_VERB_SRC, SLOTS, ANY_REF_RE };
