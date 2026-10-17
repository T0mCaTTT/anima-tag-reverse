/**
 * 缺项检测（gaps）——把「信息够不够」显式化，输出可勾选的多选清单。
 *
 * 动机：用户要的是「生成后严格自审并继续补全」，而 CLI 没有界面，
 * 所以这里不做 TTY 交互，只产出结构化 JSON + 人读 md：
 * 每条缺口带 id、severity、现况、为什么算缺口、以及可勾选的候选项（含来源证据）。
 * 调用方（技能侧 / 对话侧）拿到这份清单后向用户提问，用户勾选完再回填重跑。
 *
 * 六类判定（对应用户确认的「四类全要」并额外补一类冲突、一类观察缺失）：
 *   A unmatched   输入里有片段没映射到任何标签
 *   B emptyLayer  关键层为空（人数 / 外观 / 服装动作 / 场景）
 *   C granularity 只拿到粗标签，缺同维度的细分（发色有、发型无 之类）
 *   C-spec-missing 观察 JSON 里缺了「必须落成结构化字段的观察维度」
 *                 （画风 / 光位 / 景别 / 腿袜…）——只对图像分支生效。
 *                 这类缺失不会被 B 类抓到：层里有别的标签，缺的那一项却静默丢了。
 *   D multiSubject 多主体信息不全（人数 >1 但只描述了一个人）
 *   E conflict    同维度互相冲突的标签并存
 *   E1 tier-blocked（第 1–2 期新增）本档被档位门挡下的标签——须显式列出，
 *                 否则会被误当成「词库没词」，重演自审静默跳过的老坑。
 *
 * 候选项的四种来源，逐条带 source 字段以便核对：
 *   alt      反推时宽召回（BROAD 档）多捞到的备选
 *   sibling  词库里与已命中标签同子类/同层的高频邻居
 *   preset   固定建议项（姿势、镜头、时间等结构性缺项）
 *   manual   词库里没有、需调用方按建议写法自己补的项（`C-spec-*` 全是这一类）
 *   tier     被档位门挡下的标签（换更高档位即可拿回）
 */
import { dispTag } from './compose.mjs';
import { keyOf } from './normalize.mjs';
import { LAYER_NAME } from './config.mjs';
import { visibleAt } from './tier-policy.mjs';
import { PHRASE, phraseOf } from './nl.mjs';

/** 层号升序表（LAYER_NAME 本身按 0-8 排列） */
const LAYER_ORDER = Object.keys(LAYER_NAME).map(Number).sort((a, b) => a - b);

/** 关键层：这几层缺内容会直接改变出图结果，必须显式提示 */
const CRITICAL_LAYERS = [
  { layer: 1, label: '人数', why: '没有人数标签时模型会自由发挥主体数量，多角色构图尤其容易崩' },
  { layer: 4, label: '人物外观', why: '发色/发型/眼睛/表情至少有一样才能锁定长相' },
  { layer: 6, label: '服装与动作', why: '没有动作时模型倾向给一个静止站姿' },
  { layer: 7, label: '构图与场景', why: '没有景别与场景时默认出半身无背景' }
];

/** 结构性建议：与具体输入无关、但多数题材都值得补的项 */
const PRESET_SUGGESTIONS = {
  4: [
    { tag: 'looking at viewer', zh: '看向镜头', why: '锁定视线方向，避免视线游移' },
    { tag: 'blush', zh: '脸红', why: '给面部加一点状态，避免死板' },
    { tag: 'open mouth', zh: '张嘴', why: '与 closed mouth 二选一，决定口型' }
  ],
  6: [
    { tag: 'standing', zh: '站姿', why: '最常用的基础姿势' },
    { tag: 'sitting', zh: '坐姿', why: '与场景搭配时更自然' },
    { tag: 'holding book', zh: '拿着书', why: '给手一个明确动作，减少手指崩坏' }
  ],
  7: [
    { tag: 'upper body', zh: '上半身', why: '景别不写时默认可能是全身或特写' },
    { tag: 'from above', zh: '俯视', why: '提供一个视角，避免完全平视' },
    { tag: 'day', zh: '白天', why: '时间不写时明暗会随机' },
    { tag: 'simple background', zh: '简单背景', why: '不需要背景细节时用它压住杂乱' }
  ]
};

/** 关键词转正则：短语内部的空格允许被 _ 或 - 替代（keyOf 会保留这两种写法） */
const alt = (phrase) => phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[ _-]+');
const anyOf = (phrases) => new RegExp(`(${phrases.map(alt).join('|')})`);
const endsWith = (phrases) => new RegExp(`(${phrases.map(alt).join('|')})$`);

/** 手部/道具的判定式在 DIMENSIONS 与「多主体外观计数」两处复用，必须只写一份 */
const HANDS_RE = anyOf(['holding', 'hand on own', 'hand to ', 'hands on', 'crossed arms', 'arms behind back', 'hand up', 'hands up', 'holding hands', 'waving', 'clenched hand', 'outstretched arm', 'arm up', 'paw pose']);
/** 人体取景（景别）：framing 维度与构图冲突判定共用 */
const FRAMING_RE = anyOf(['full body', 'upper body', 'cowboy shot', 'close-up', 'portrait', 'headshot', 'face focus', 'feet out of frame', 'head out of frame', 'wide shot']);

/** 同维度分组：用于「粒度不足」与「冲突」两类判定；group 同时用于与观察缺项去重 */
const DIMENSIONS = [
  { id: 'hair-color', label: '发色', layer: 4, test: t => /hair$/.test(t) && !/^long|^short|^twintails|^ponytail|^braid/.test(t), expect: ['black hair', 'blonde hair', 'brown hair', 'silver hair', 'blue hair', 'pink hair', 'white hair', 'red hair'] },
  { id: 'hair-style', label: '发型', layer: 4, test: t => /(twintails|ponytail|braid|bob cut|hime cut|bangs|ahoge|hair intakes|sidelocks|wavy hair|curly hair|straight hair)/.test(t), suggest: ['long hair', 'short hair', 'twintails', 'blunt bangs'] },
  { id: 'eyes', label: '眼睛', layer: 4, test: t => /eyes?$/.test(t), expect: ['blue eyes', 'red eyes', 'green eyes', 'purple eyes', 'brown eyes', 'silver eyes'] },
  { id: 'expression', label: '表情', layer: 4, test: t => PHRASE[keyOf(t).replace(/\s+/g, ' ')] && /smil|grin|cry|frown|pout|surpris|embarrass|angry|serious|expression|mouth/.test(t), suggest: ['smile', 'open mouth', 'closed mouth'] },
  { id: 'outfit-top', label: '上衣', layer: 6, group: 'outfit-top', test: t => /(shirt|sweater|hoodie|jacket|coat|uniform|dress|blouse|kimono|yukata|sailor|serafuku)/.test(t), suggest: ['shirt', 'school uniform', 'sailor dress'] },
  { id: 'legwear', label: '腿袜', layer: 6, group: 'legwear', test: t => endsWith(['thighhighs', 'socks', 'stockings', 'pantyhose', 'garter belt', 'legwear']).test(t) || anyOf(['thighhighs', 'kneehighs', 'pantyhose', 'garter belt']).test(t), suggest: ['thighhighs', 'black thighhighs', 'kneehighs', 'pantyhose'] },
  { id: 'framing', label: '景别', layer: 7, group: 'framing', test: t => FRAMING_RE.test(t), suggest: ['upper body', 'full body', 'cowboy shot', 'close-up'] },
  { id: 'time', label: '时间', layer: 7, test: t => /^(day|night|sunset|sunrise|morning|evening|noon|midnight)/.test(t), suggest: ['day', 'night', 'sunset'] },
  { id: 'lighting', label: '光线', layer: 7, group: 'lighting', test: t => /(lighting|backlight|light|shadow|glow|silhouette|sunlight|moonlight)/.test(t), suggest: ['backlighting', 'soft lighting', 'rim light'] },

  // —— 以下五组为「候选更全」而补：词库已覆盖，此前只是没被 preset 表问出来 ——
  { id: 'hand-gesture', label: '手势与持物', layer: 6, test: t => HANDS_RE.test(t), suggest: ['holding book', 'holding cup', 'holding umbrella', 'hand on own chest', 'crossed arms'] },
  { id: 'accessories', label: '配饰', layer: 6, test: t => anyOf(['hair ornament', 'hair ribbon', 'hair flower', 'hairband', 'necklace', 'earrings', 'ring', 'bracelet', 'glasses', 'choker', 'hairclip', 'hat']).test(t), suggest: ['hair ornament', 'hair ribbon', 'necklace', 'earrings'] },
  { id: 'footwear', label: '鞋', layer: 6, group: 'footwear', test: t => anyOf(['boots', 'loafers', 'sneakers', 'mary janes', 'high heels', 'sandals', 'barefoot']).test(t), suggest: ['boots', 'loafers', 'sneakers', 'barefoot'] },
  { id: 'pose', label: '身体姿势', layer: 6, group: 'pose', test: t => anyOf(['standing', 'sitting', 'lying', 'on back', 'on stomach', 'kneeling', 'crouching', 'squatting', 'walking', 'running', 'jumping', 'leaning forward']).test(t), suggest: ['standing', 'sitting', 'kneeling', 'walking'] },
  { id: 'art-style', label: '画风与媒介', layer: 7, group: 'art-style', test: t => anyOf(['anime screenshot', 'official art', 'monochrome', 'greyscale', 'sketch', 'lineart', 'flat color', 'cel shading', 'chibi', 'pixel art', '3d', 'realistic']).test(t), suggest: ['anime screenshot', 'official art', 'sketch', 'monochrome'] }
];

/** 互斥对：同维度同时出现会互相打架 */
const EXCLUSIVE = [
  { a: 'day', b: 'night', dim: '时间' },
  { a: 'open mouth', b: 'closed mouth', dim: '口型' },
  { a: 'long hair', b: 'short hair', dim: '发长' },
  { a: 'standing', b: 'sitting', dim: '姿势' },
  { a: 'standing', b: 'lying', dim: '姿势' },
  { a: 'sitting', b: 'lying', dim: '姿势' },
  { a: 'from above', b: 'from below', dim: '视角' },
  { a: 'looking at viewer', b: 'looking away', dim: '视线' },
  { a: 'full body', b: 'close-up', dim: '景别' },
  { a: 'full body', b: 'upper body', dim: '景别' },
  { a: '1girl', b: '1boy', dim: '主体性别（多主体题材正常，单主体题材需确认）' },
  { a: 'indoors', b: 'outdoors', dim: '场所' },
  { a: 'smile', b: 'crying', dim: '情绪' }
];

const uniq = arr => [...new Set(arr.filter(Boolean))];

/**
 * 生成缺项清单
 * @param {object} res     compose() 的返回值（含 layers / matches / unmatched 等）
 * @param {object} plan    反推计划（plan.clauses / plan.negatedClauses）用于定位缺失片段
 * @param {object} ctx     { alternatives, broad, isImage, imageSpec }
 * @returns {{ gaps, summary, checklists }}
 */
export function buildGaps(res, plan = {}, ctx = {}) {
  const layers = res.layers || [];
  const layerTags = new Map(layers.map(l => [l.layer, l.tags.map(t => t.tag)]));
  const allTags = uniq(layers.flatMap(l => l.tags.map(t => t.tag)));
  const keySet = new Set(allTags.map(keyOf));

  // 宽召回备选池：按层归拢，作为候选项的主要来源
  const altByLayer = new Map();
  for (const a of ctx.alternatives || []) {
    const arr = altByLayer.get(a.layer) || [];
    if (arr.length < 12 && !keySet.has(keyOf(a.tag))) arr.push(a);
    altByLayer.set(a.layer, arr);
  }

  const gaps = [];
  const add = g => gaps.push(g);

  // ---- A. 未匹配片段 ----------------------------------------------------
  const unmatched = uniq(res.unmatched || plan.unmatched || []);
  if (unmatched.length) {
    add({
      id: 'A1',
      kind: 'unmatched',
      severity: 'medium',
      title: '输入里有片段没被识别',
      detail: unmatched.map(s => `「${s}」`).join(' '),
      why: '这些片段没有映射到任何标签，出图时等于没写',
      suggestions: unmatched.map(s => ({
        id: `A1-${s}`,
        label: `为「${s}」补一个英文标签`,
        tag: '',
        source: 'manual',
        why: '词库里没有对应表面词，需要你给一个等价英文标签（例：把「水手服」写成 sailor dress）'
      }))
    });
  }

  // ---- B. 关键层为空 ----------------------------------------------------
  for (const c of CRITICAL_LAYERS) {
    const tags = layerTags.get(c.layer) || [];
    if (tags.length) continue;
    const alts = (altByLayer.get(c.layer) || []).map(a => ({
      id: `B${c.layer}-${a.tag}`,
      label: a.display,
      zh: a.zh,
      tag: a.tag,
      score: a.score,
      source: 'alt',
      why: '宽召回捞到的同层候选'
    }));
    const presets = (PRESET_SUGGESTIONS[c.layer] || []).map(p => ({
      id: `B${c.layer}-${p.tag}`,
      label: p.tag,
      zh: p.zh,
      tag: p.tag,
      source: 'preset',
      why: p.why
    }));
    add({
      id: `B${c.layer}`,
      kind: 'emptyLayer',
      severity: c.layer === 4 ? 'high' : 'medium',
      title: `第 ${c.layer} 层「${c.label}」为空`,
      detail: `当前没有 ${c.label} 类标签`,
      why: c.why,
      // 兜底：宽召回也没捞到同层候选时，至少给一条「人工指定」选项，保证每条缺口都可勾选
      suggestions: ([...alts, ...presets].length ? [...alts, ...presets] : [{
        id: `B${c.layer}-manual`, label: `手动指定${c.label}标签`, tag: '', source: 'manual', why: '按题材自行补写一条该层标签'
      }]).slice(0, 14)
    });
  }

  // ---- C. 粒度不足 ------------------------------------------------------
  for (const d of DIMENSIONS) {
    const hits = allTags.filter(t => d.test(keyOf(t)));
    if (hits.length) continue;
    const candidates = uniq([
      ...(d.expect || []).filter(t => !keySet.has(t)),
      ...(d.suggest || []).filter(t => !keySet.has(t)),
      ...((altByLayer.get(d.layer) || []).map(a => a.tag))
    ]).slice(0, 10);
    if (!candidates.length) continue;
    const cands = candidates.slice(0, 8).map(t => {
      const alt = (altByLayer.get(d.layer) || []).find(a => a.tag === t);
      return alt
        ? { id: `C-${d.id}-${t}`, label: alt.display, zh: alt.zh, tag: t, score: alt.score, source: 'alt', why: '宽召回捞到的同维度候选' }
        : { id: `C-${d.id}-${t}`, label: dispTag(t), tag: t, source: 'preset', why: `常见的${d.label}写法` };
    });
    add({
      id: `C-${d.id}`,
      kind: 'granularity',
      severity: 'low',
      title: `${d.label}没有细分值`,
      detail: `只写了大类，没有给出${d.label}的具体取值`,
      why: `模型会自己挑一个${d.label}，结果不可控`,
      specGroup: d.group || '',
      suggestions: cands
    });
  }

  // ---- D. 多主体信息不全 ------------------------------------------------
  const girlN = /([1-6]|multiple)\s*girls?/.exec(allTags.map(keyOf).join(' '));
  const boyN = /([1-6]|multiple)\s*boys?/.exec(allTags.map(keyOf).join(' '));
  const total = (girlN ? (girlN[1] === 'multiple' ? 3 : Number(girlN[1])) : 0) + (boyN ? (boyN[1] === 'multiple' ? 2 : Number(boyN[1])) : 0);
  const appearanceCount = (layerTags.get(4) || []).filter(t => /(hair|eyes|skin|ears|tail|wings)/.test(keyOf(t))).length
    + (layerTags.get(6) || []).filter(t => HANDS_RE.test(keyOf(t))).length;
  if (total > 1) {
    const perSubject = Math.floor(appearanceCount / Math.max(1, total));
    if (perSubject < 2) {
      add({
        id: 'D1',
        kind: 'multiSubject',
        severity: 'high',
        title: `画面里有 ${total} 个主体，但只描述了 ${appearanceCount} 项外观`,
        detail: '多角色提示词需要逐个角色点名，否则模型会把特征混在同一个人身上',
        why: '官方提示词规范要求多角色时先命名角色再描述外观，逐个角色分开写',
        suggestions: [
          { id: 'D1-name', label: '逐个角色补名字或身份标签', tag: '', source: 'manual', why: '例：角色名、hair color 等按角色分别写' },
          ...(altByLayer.get(4) || []).slice(0, 6).map(a => ({ id: `D1-${a.tag}`, label: a.display, zh: a.zh, tag: a.tag, score: a.score, source: 'alt', why: '可分配给其中一个角色的外观值' }))
        ]
      });
    }
  }

  // ---- E. 同维度冲突 ----------------------------------------------------
  for (const e of EXCLUSIVE) {
    const ka = keyOf(e.a);
    const kb = keyOf(e.b);
    if (!keySet.has(ka) || !keySet.has(kb)) continue;
    // 1girl×1boy 在多主体题材里是正常组合（层 1 已判定总人数 >1），不算冲突，
    // 否则「男女各一」这种正当写法会被当成错误提示。
    if (ka === '1girl' && kb === '1boy' && total > 1) continue;
    add({
      id: `E-${ka}-${kb}`,
      kind: 'conflict',
      severity: 'medium',
      title: `${e.dim}冲突：${dispTag(e.a)} 与 ${dispTag(e.b)} 同时出现`,
      detail: '两个标签互相排斥，模型会随机偏向其中一个',
      why: '同维度只保留一个取值最稳',
      suggestions: [
        { id: `E-${ka}`, label: `保留 ${dispTag(e.a)}`, tag: e.a, source: 'choice', why: '二选一' },
        { id: `E-${kb}`, label: `保留 ${dispTag(e.b)}`, tag: e.b, source: 'choice', why: '二选一' }
      ]
    });
  }

  // ---- C-spec. 观察 JSON 缺必填维度（图像分支）----------------------------
  // 这些是「没有专属载体、缺了就静默丢标签」的观察维度（画风 / 光位 / 景别 / 腿袜…）。
  // 与 C 粒度不足的区别：C 是「层里有粗标签、缺细分」，这里是「观察压根没落成字段」。
  // 去重：同一个 group 已经在 C 或 B 里报过时，把建议写法挂到那条已有缺口上，不重复开条。
  const specIssues = (plan && plan.specIssues) || ctx.specIssues || [];
  const specGaps = [];
  for (const s of specIssues) {
    const existing = s.group
      ? gaps.find(g => g.specGroup === s.group || g.id === `C-${s.group}` || g.id === `B-${s.group}`)
      : null;
    const suggestion = {
      id: `C-spec-${s.key}`,
      label: s.label,
      zh: s.label,
      tag: '',
      source: 'manual',
      why: `建议写法 —— ${s.advice}`,
      advice: s.advice,
      dimKey: s.key
    };
    if (existing) {
      if (!existing.suggestions.some(x => x.dimKey === s.key)) existing.suggestions.push(suggestion);
      continue;
    }
    const id = `C-spec-${s.key}${s.srcKey ? `-${s.srcKey}` : ''}`;
    const gap = {
      id,
      key: s.key,
      kind: 'missingObservation',
      severity: s.severity,
      title: `观察缺项：${s.label}`,
      detail: s.srcKey
        ? `只写了 ${s.srcKey}，取值不构成「${s.label}」的结构化字段（现在只当备注，不产标签）`
        : `观察 JSON 里没有落「${s.label}」的结构化字段`,
      why: '这类观察没有专属标签载体：写进 notes 不会产出标签，工具也不报错，出图时等于没写',
      specGroup: s.group || '',
      suggestions: [suggestion]
    };
    add(gap);
    specGaps.push(gap);
  }

  // ---- E. 档位门挡下的标签（第 1–2 期 · 面 4）----------------------------
  // 「被内容门挡下」是最容易被误当成「词库没有」的一类缺口，必须显式列出来：
  // 老坑是自审静默跳过，交付的标签串少了东西也没人说。
  const blocked = ctx.tierBlocked || [];
  if (blocked.length) {
    const tier = (ctx.policy && ctx.policy.tier) || '';
    const needTier = need => {
      const names = (ctx.policy && ctx.policy.tierNames) || [];
      for (let i = 0; i < names.length; i++) {
        if (visibleAt(i, names.length, need)) return names[i];
      }
      return names[names.length - 1] || '';
    };
    add({
      id: 'E1',
      kind: 'tier-blocked',
      severity: 'low',
      title: `有 ${blocked.length} 条标签被「${tier}」档挡下了`,
      detail: blocked.map(b => `\`${b.tag}\`（需 ${needTier(b.need) || b.need} 档）`).join('、'),
      why: '档位门按画面可见度判级（当前档越低，露骨标签越不出）；这不是词库缺词，换档就能拿回来',
      suggestions: blocked.map(b => ({
        id: `E1-${b.tag}`,
        label: b.display || b.tag,
        zh: b.zh,
        tag: b.tag,
        source: 'tier',
        why: `需要 ${needTier(b.need) || b.need} 档；当前档「${tier}」不出这条`
      }))
    });
  }

  // ---- F. 第 6 期：ANIMA3 模板规则的两类提醒（互斥组合 / 标签总数区间）----
  // 只报不拦：交付串已经发出去了，这里只让人知道「这几条通常不同时出现」。
  // 数据来自 ctx.annotate（index.mjs 里 rules.mjs 的 annotate()），没有就是没开这项。
  const ann = ctx.annotate || null;
  let fIdx = 0;
  for (const m of (ann && ann.mutex) || []) {
    fIdx += 1;
    add({
      id: `F${fIdx}`,
      kind: 'mutex',
      severity: 'low',
      title: m.kind === 'count' ? `同组标签堆多了：${m.groupZh || m.group}` : `互斥：${m.groupZh || m.group}`,
      detail: m.text,
      why: (m.src ? m.src + '；' : '') + '模板规则：这类组合通常不同时出现，一般只留其中一条。只提醒，不自动删。',
      suggestions: []
    });
  }
  if (ann && ann.count && !ann.count.ok) {
    fIdx += 1;
    add({
      id: `F${fIdx}`,
      kind: 'tagCount',
      severity: 'low',
      title: '标签总数不在模板区间里',
      detail: ann.count.text,
      why: 'ANIMA3 模板 §4.2 的实战统计区间；偏少常是细节没写全，偏多会互相稀释。只提醒，不自动增删。',
      suggestions: []
    });
  }

  // ---- 汇总 --------------------------------------------------------------
  const byKind = {};
  for (const g of gaps) byKind[g.kind] = (byKind[g.kind] || 0) + 1;
  const summary = {
    total: gaps.length,
    byKind,
    layers: (LAYER_ORDER || Object.keys(LAYER_NAME)).map(l => {
      const n = (layerTags.get(Number(l)) || []).length;
      return { layer: Number(l), name: LAYER_NAME[l] || '其他', count: n, empty: n === 0 };
    }),
    optionCount: gaps.reduce((s, g) => s + g.suggestions.length, 0),
    specMissing: specGaps.length,
    specIssues: specIssues.map(s => ({ key: s.key, label: s.label, severity: s.severity, advice: s.advice })),
    notesText: ctx.notesText || (plan && plan.notesText) || ''
  };
  return { gaps, summary, checklists: { exclusive: EXCLUSIVE.map(e => `${e.a} × ${e.b}（${e.dim}）`) } };
}

/** 把缺口清单渲染成 markdown，便于贴进对话让用户勾选 */
export function gapsMarkdown(gapResult, input = '') {
  const { gaps, summary } = gapResult;
  const L = [];
  L.push('### 缺项清单与候选项');
  L.push('');
  if (input) L.push(`- 输入：${input}`);
  L.push(`- 缺口 ${summary.total} 条，候选项合计 ${summary.optionCount} 个`);
  const kinds = Object.entries(summary.byKind).map(([k, v]) => `${k} ${v}`).join(' · ');
  if (kinds) L.push(`- 分类：${kinds}`);
  // 观察缺项（C-spec-missing）单独点名：这类是「写了但没落成结构化字段」，
  // 与别的缺口不同，必须让调用方看到建议写法，否则下次还是漏。
  const issues = summary.specIssues || [];
  if (issues.length) {
    L.push(`- 观察缺项 ${issues.length} 条（须落成结构化字段，写进 notes 不产标签）：`);
    // 全量打印，不再 slice：这类缺项由 REQUIRED_OBSERVATIONS 定死（上限 9 条），
    // 而截断恰好会吞掉排在最后、严重度最低的那几条（outfit.footwear / pose.action / style.camera）
    // ——它们才是「没有专属载体、最容易被漏写」的维度，正是最需要看见建议写法的一批。
    for (const s of issues) L.push(`  - \`${s.key}\`（${s.label}，${s.severity}）：${s.advice}`);
  }
  if (summary.notesText) L.push(`- notes（纯日志，未参与匹配）：${summary.notesText}`);
  L.push('');
  for (const g of gaps) {
    L.push(`#### ${g.id} ${g.title}（${g.severity}）`);
    L.push(`- 现况：${g.detail}`);
    L.push(`- 原因：${g.why}`);
    L.push('- 候选项：');
    for (const s of g.suggestions) {
      // 建议写法（source: manual 的 C-spec 项）必须印进勾选行：这类项没有候选标签可勾，
      // 唯一可执行的信息就是 advice，漏印的话整行只剩一句「（需你补写）」。
      const extra = [
        s.zh ? `中文「${s.zh}」` : '',
        s.score ? `score ${Number(s.score).toFixed(2)}` : '',
        `来源 ${s.source}`,
        s.advice ? `建议写法：${s.advice}` : ''
      ].filter(Boolean).join('；');
      L.push(`  - [ ] \`${s.tag || '（需你补写）'}\`${s.label && s.label !== s.tag ? ` ${s.label}` : ''}${extra ? `　（${extra}）` : ''}`);
    }
    L.push('');
  }
  L.push('勾选后回填示例：把选中的标签直接追加进输入文本，或写 `只保留 X`、`补充 Y` 让工具重跑。');
  return L.join('\n');
}

export const _internal = { CRITICAL_LAYERS, DIMENSIONS, EXCLUSIVE, PRESET_SUGGESTIONS };
