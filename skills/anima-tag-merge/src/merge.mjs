/**
 * merge.mjs —— 按「意图」把 N 份观察结果拼成一份（纯函数，不依赖标签引擎）
 *
 * 合并语义（重要，决定了行为可预期）：
 *   - **宿主（base）提供骨架**：base 的整份观察原样留下，包括它没被点名的所有维度；
 *   - **点名的维度整体换源**：说「场景用图1的」就把 scene 整棵子树换成图1的 scene，
 *     base 里原来的 scene.location 之类**全部丢弃**（不清空会出现多张图混在一起的鬼影场景）；
 *   - **子级覆盖组级**：`pose` ← 图1 且 `pose.hands` ← 图2 时，先整组用图1，再把手换成图2的；
 *   - **与宿主同源也要写回**：组级换源会覆盖宿主整棵子树，同源子级若不写回，宿主原本的值就丢了；
 *   - **源里该维度是空的**：不删也不编，如实报成 `emptySources` 让人补观察（这是最常见的翻车点：
 *     用户以为「图1的姿势」有东西，其实图1的观察 JSON 里 pose 压根没写）；
 *   - **negative 取并集**：所有图的排除项都留着，去重；
 *   - **notes 只写溯源日志**：引擎侧 notes 不产标签（见 anima-tag-reverse 的 image-spec.mjs），
 *     正好用来记录「哪一块来自哪张图」，方便人核对。
 *
 * 三张以上：语义与两张完全一致，只是编号变成 1..N、底图可以是任意一张。
 * 想「先融 A+B 再融 C」的链式用法：把上一轮的合并结果（`--format spec`）当成新一轮的一张图即可。
 *
 * 冲突检测只报「能证明的矛盾」，不猜内容（与原技能的 gaps.mjs 同一原则）。
 */
import { SLOTS, leafPathsOf } from './dims.mjs';

const isPlainObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** 沿点路径取值 */
export function getPath(obj, dotted) {
  let cur = obj;
  for (const seg of String(dotted).split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = cur[seg];
  }
  return cur;
}

/** 沿点路径写值（中间层缺失则补空对象） */
export function setPath(obj, dotted, value) {
  const segs = String(dotted).split('.');
  let cur = obj;
  for (let i = 0; i < segs.length - 1; i++) {
    if (!isPlainObject(cur[segs[i]])) cur[segs[i]] = {};
    cur = cur[segs[i]];
  }
  cur[segs[segs.length - 1]] = value;
}

const isEmptyValue = v => v === undefined || v === null ||
  (typeof v === 'string' && v.trim() === '') ||
  (Array.isArray(v) && v.length === 0) ||
  (isPlainObject(v) && Object.keys(v).length === 0);

/** 值是否「有内容」（含字符串/数组/对象三种形态） */
const hasValue = v => {
  if (isEmptyValue(v)) return false;
  if (typeof v === 'string') return v.trim() !== '' && v.trim() !== '-';
  return true;
};

/** 组级换源时把整棵子树深拷过来；空源返回 undefined（由调用方报空） */
function takeFrom(spec, path) {
  const v = getPath(spec, path);
  return hasValue(v) ? clone(v) : undefined;
}

const sideLabel = n => `图${n}`;

/**
 * 合并 N 份观察。
 * @param {object} p
 * @param {object[]} p.images 观察数组，索引 0 = 图1（至少 2 份）
 * @param {object} p.intent parseFusionIntent() 的结果
 * @param {string[]} [p.extra] 追加的自然语言片段（落进 spec.extra，会被引擎当额外分句匹配）
 * @returns {{spec:object, base:number, applied:Array, emptySources:Array, conflicts:Array, provenance:Array}}
 */
export function mergeSpecs({ images, intent, extra = [] } = {}) {
  if (!Array.isArray(images) || images.length < 2) {
    throw new Error('mergeSpecs 需要至少两份观察（images 数组）；纯文本描述请先用引擎的 --template 写成结构化观察');
  }
  for (const [i, im] of images.entries()) {
    if (!isPlainObject(im)) throw new Error(`第 ${i + 1} 份观察不是对象`);
  }
  const count = images.length;
  const specOf = n => images[n - 1];
  const base = Number(intent.base) >= 1 && Number(intent.base) <= count ? Number(intent.base) : count;
  const spec = clone(specOf(base));

  const sources = [...(intent.sources || [])].sort((x, y) => {
    // 组级先应用（路径短的先），子级后覆盖；同级按指令里出现的顺序
    const dx = x.path.split('.').length - y.path.split('.').length;
    return dx !== 0 ? dx : (x.start ?? 0) - (y.start ?? 0);
  });

  const applied = [];
  const emptySources = [];

  for (const s of sources) {
    if (!(s.side >= 1 && s.side <= count)) continue;
    const from = specOf(s.side);
    const value = takeFrom(from, s.path);
    if (value === undefined) {
      if (s.side !== base) emptySources.push({ path: s.path, label: s.label, side: s.side, isGroup: !!s.isGroup });
      applied.push({ ...s, note: s.side === base ? '与宿主同源（宿主此处为空）' : '源里为空，未替换' });
      continue;
    }
    // 注意：**与宿主同源的维度也要写回**。组级换源（appearance ← 图1）会把宿主这一整棵子树
    // 覆盖掉，若此时子级（appearance.hair_style ← 宿主）被当作「无需搬运」跳过，
    // 宿主原本的发型就丢了。写回同一个值代价为零，能保证「子级永远赢」。
    setPath(spec, s.path, value);
    applied.push({ ...s, note: s.side === base ? '与宿主同源，按宿主写回' : (s.isGroup ? '整组换源' : '字段换源') });
  }

  // 追加的补充描述：走一个自定义键，引擎摊平时会当成普通分句（hint 为空）
  if (extra && extra.length) {
    spec.extra = [...(spec.extra || []), ...extra.filter(x => String(x).trim())];
  }

  // negative 取并集（保序去重）
  const neg = [];
  for (const im of images) {
    const v = im.negative;
    const list = Array.isArray(v) ? v : (v ? [v] : []);
    for (const x of list) {
      const s = String(x).trim();
      if (s && !neg.includes(s)) neg.push(s);
    }
  }
  if (neg.length) spec.negative = neg; else delete spec.negative;

  // 溯源日志（notes 不产标签，正好用来记录来源）
  const log = [
    `双图融合：底图 = ${sideLabel(base)}`,
    ...applied.filter(x => x.side !== base).map(x => `${x.label}(${x.path}) ← ${sideLabel(x.side)}`),
    ...emptySources.map(x => `${x.label}(${x.path}) ← ${sideLabel(x.side)}【源里是空的，未替换】`)
  ];
  spec.notes = log.join('；');

  // ---- 溯源表：每个叶子字段来自哪张图 ----
  // 取**最具体**的匹配：`appearance` 与 `appearance.eyes` 同时存在时，
  // 更长的路径赢（否则整组换源会盖掉子级换源的真相，报告就成了假的）。
  const originOf = leafPath => {
    let best = null;
    for (const s of sources) {
      if (leafPath === s.path || leafPath.startsWith(s.path + '.')) {
        if (!best || s.path.length > best.path.length) best = s;
      }
    }
    return best ? best.side : base;
  };
  const provenance = [];
  for (const sp of SLOTS.values()) {
    if (sp.isGroup) continue;
    for (const leaf of leafPathsOf(sp.path)) {
      if (!hasValue(getPath(spec, leaf))) continue;
      provenance.push({ path: leaf, label: sp.label, side: originOf(leaf) });
    }
  }
  // characters / series / nsfw 不在叶子槽位网格里（它们是根级数组/文本），单独补
  for (const [p, label] of [['characters', '角色身份'], ['series', '作品'], ['nsfw', '分级']]) {
    if (hasValue(getPath(spec, p))) provenance.push({ path: p, label, side: originOf(p) });
  }

  const conflicts = detectConflicts({ spec, base, count, sources, originOf, emptySources, images });

  return { spec, base, count, applied, emptySources, conflicts, provenance };
}

/**
 * 跨源冲突检测：只报能证明的（同源维度撕开、景别裁掉姿势、场景与光位打架、分级抬升）。
 * severity：warn = 大概率出图不对；info = 大概率没问题，但值得知道。
 */
function detectConflicts({ spec, base, count, sources, originOf, emptySources, images }) {
  const out = [];
  const specOf = n => images[n - 1];
  const sideOfPath = p => originOf(p);
  const moved = p => sideOfPath(p) !== base;

  // ① 源里该维度是空的 —— 这是最常见的翻车点
  for (const e of emptySources) {
    out.push({
      severity: 'warn',
      code: 'empty-source',
      message: `${sideLabel(e.side)} 的${e.label}是空的，这一块没换过来。请补 ${e.path} 的观察后重跑。`
    });
  }

  // ② 角色身份与外观被撕开
  const chars = getPath(spec, 'characters');
  if (hasValue(chars) && moved('appearance') && sideOfPath('appearance') !== sideOfPath('characters')) {
    out.push({
      severity: 'warn',
      code: 'char-vs-appearance',
      message: `角色身份取自${sideLabel(sideOfPath('characters'))}，外观取自${sideLabel(sideOfPath('appearance'))}：结果里会同时出现「某角色的名字」和「另一张图的脸/发色」，模型容易把两者当冲突概念。`
    });
  }

  // ③ 景别裁掉姿势
  const framing = String(getPath(spec, 'style.framing') || '');
  const closeUp = /close[- ]?up|upper body|portrait|bust|half body|半身|特写|胸像/i.test(framing);
  const sitLike = /sitting|lying|kneeling|on back|on stomach|坐|躺|跪|趴/i.test(String(getPath(spec, 'pose.action') || ''));
  if (closeUp && moved('pose') && sitLike) {
    out.push({
      severity: 'warn',
      code: 'framing-vs-pose',
      message: `景别是「${framing}」（来自${sideLabel(sideOfPath('style.framing') || sideOfPath('style'))}），而要搬过来的姿势是「${getPath(spec, 'pose.action')}」（来自${sideLabel(sideOfPath('pose'))}）：半身/特写下坐姿躺姿会被裁掉。建议把景别一起换源，或改成 full body。`
    });
  }

  // ④ 场景与光位打架
  const sceneOrigin = sideOfPath('scene');
  const lightOrigin = sideOfPath('style.light_direction');
  if (hasValue(getPath(spec, 'scene')) && hasValue(getPath(spec, 'style.light_direction')) && sceneOrigin !== lightOrigin) {
    out.push({
      severity: 'info',
      code: 'scene-vs-light',
      message: `场景来自${sideLabel(sceneOrigin)}、光位来自${sideLabel(lightOrigin)}：两者不同源，出图前请确认光源与环境光能对上（夜晚场景配白天顺光会打架）。`
    });
  }

  // ⑤ 多主体 + 姿势换源
  const n = Number(getPath(spec, 'subject.count')) || 0;
  if (n >= 2 && moved('pose')) {
    out.push({
      severity: 'info',
      code: 'multi-subject-pose',
      message: `画面是 ${n} 人，而姿势取自${sideLabel(sideOfPath('pose'))}的单人姿势：人数多的那张通常需要每人单独描述姿势，标签会偏向「整体动作」。`
    });
  }

  // ⑥ 分级抬升：底图是安全级，而要搬过来的那张带 R18 标记
  const baseNsfw = String(getPath(specOf(base), 'nsfw') || '');
  const srcNsfw = sources
    .filter(s => s.side !== base)
    .map(s => `${getPath(specOf(s.side), 'nsfw') || ''} ${getPath(specOf(s.side), 'pose.action') || ''} ${getPath(specOf(s.side), 'outfit.dress') || ''}`)
    .join(' ');
  if (!/explicit|nsfw|r-?18|露骨|色情/i.test(baseNsfw) && /explicit|nsfw|r-?18|露骨|色情/i.test(srcNsfw)) {
    out.push({ severity: 'info', code: 'rating-raised', message: '源图带 R18 标记，合并后的分级会自动升到限制级。' });
  }

  // ⑦ 画风与场景不同源
  if (hasValue(getPath(spec, 'style.medium')) && moved('style') && !moved('scene') &&
      (hasValue(getPath(spec, 'style.palette')) || hasValue(getPath(spec, 'style.lighting')))) {
    out.push({
      severity: 'info',
      code: 'style-vs-scene',
      message: `画风/光影取自${sideLabel(sideOfPath('style'))}、场景仍在${sideLabel(sideOfPath('scene'))}：色调与光比需要人工确认，必要时把 scene 也一起换源。`
    });
  }

  // ⑧ 三张以上：底图之外的图如果只贡献了很少的维度，提醒可能漏了
  if (count >= 3) {
    const used = new Set(sources.map(s => s.side));
    used.add(base);
    const idle = [];
    for (let i = 1; i <= count; i++) if (!used.has(i)) idle.push(i);
    if (idle.length) {
      out.push({
        severity: 'info',
        code: 'unused-image',
        message: `${idle.map(sideLabel).join('、')} 在这条指令里没有被用到（它的观察不会进入结果）。如果本来就该用，请补一条换源指令。`
      });
    }
  }

  // ⑨ 画风换源了，但画师标签没跟着换 —— artists 是**独立槽位**，不在 style 组里。
  //    这是最容易被忽略的一处：Danbooru 上「画风」的主要载体恰恰是 @画师标签。
  if (moved('style')) {
    const srcArtists = getPath(specOf(sideOfPath('style')), 'artists');
    if (hasValue(srcArtists)) {
      const cur = getPath(spec, 'artists') || [];
      if (JSON.stringify(cur) !== JSON.stringify(srcArtists)) {
        out.push({
          severity: 'info',
          code: 'style-vs-artists',
          message: `画风整组取自${sideLabel(sideOfPath('style'))}，但画师标签（artists）是独立槽位、没有跟着换（当前仍是 ${JSON.stringify(cur)}）。要连带画师请用组合宏「画风全套」或 --map artists=${sideOfPath('style')}。`
        });
      }
    }
  }

  return out;
}
