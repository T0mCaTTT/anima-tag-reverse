/**
 * compose.mjs —— 第三步：输出格式化
 *
 * 一份匹配结果同时产出五种形态，按需取用：
 *   prompt    官方顺序的可复制标签串（前缀 + 分层标签，逗号分隔）
 *   hybrid    混合形态（第 6 期，CLI 默认）：按 0–8 层分行、行尾带逗号，末尾再跟一句自然语言
 *   negative  负向串（默认负向 + 用户「不要 X」反推出的负向标签）
 *   layers    分层视图（0 质量/元信息 … 8 其他），每层带中文与分数
 *   json      结构化结果（给程序用：分层、分数、频次、置信度、来源分句）
 *   markdown  给人看的分层报告（可直接贴进聊天窗口）
 */
import { POSITIVE_PREFIX, NEGATIVE_DEFAULT, LAYER_NAME, BUILTIN_TIER_NAMES } from './config.mjs';
import { keyOf } from './normalize.mjs';
import { personCount, needsViewDefault } from './rules.mjs';

/** 前缀里已含的标签，输出时不再重复（官方约定：不必堆满） */
const PREFIX_KEYS = new Set(POSITIVE_PREFIX.split(',').map(s => keyOf(s)).filter(Boolean));

/**
 * 运行时档名表（第 5 期）：优先用调用方注入的 `opts.tierNames`（来自 `panel-config.mjs`，
 * 即面板配置里的档位表，用户可能改名或加档），否则回退内置 `BUILTIN_TIER_NAMES`（三档）。
 * 默认档名的判定也走这张表——`BUILTIN_TIER_NAMES[0]` 与内置档表的第 1 档都是 safe，
 * 所以不传 `tierNames` 时行为与改造前逐字节一致（回归用例锁着这一点）。
 */
const tiersOf = opts => (Array.isArray(opts && opts.tierNames) && opts.tierNames.length ? opts.tierNames : BUILTIN_TIER_NAMES);
const rankOf = (tiers, t) => tiers.indexOf(t);
/** 「画面里出现成人内容分类时至少给到哪一档」：档表里有 nsfw 就用它，否则用最强的一档 */
const explicitFloor = tiers => (tiers.includes('nsfw') ? 'nsfw' : tiers[tiers.length - 1]);

/**
 * 从命中结果里决定前缀的分级 token。
 * 命中的分级标签越强，前缀里的 safe 就换成越强的那个（safe → … → 末档）；
 * 这是格式适配，不是内容审查：R18 / NSFL 元素一律照常参与匹配与输出。
 * @param {object} res      matchPlan() 的结果
 * @param {string} override 调用方显式指定的分级（--rating）：原样采用，不做档表映射
 *                          （档名校验在 CLI 入口做，见 panel-config.mjs 的 resolveTier）
 * @param {string[]} tiers  运行时档名表（由 order 排序）
 */
export function pickRating(res, override, tiers = BUILTIN_TIER_NAMES) {
  if (override) return override;
  const set = new Set(tiers);
  let best = tiers[0] || 'safe';
  for (const m of res?.matches || []) {
    const k = keyOf(m.tag);
    if (set.has(k)) {
      if (rankOf(tiers, k) > rankOf(tiers, best)) best = k;
      continue;
    }
    // 命中的是成人内容分类（cb:nsfw，如裸体/性行为/情趣服饰）时至少给到 nsfw 那一档。
    // 这只是把分级 token 写对，内容本身一个标签都不会被删改。
    const floor = explicitFloor(tiers);
    if (m.big === 'cb:nsfw' && rankOf(tiers, floor) > rankOf(tiers, best)) best = floor;
  }
  return best;
}

/** 把前缀里的分级 token 换成 rating；没有分级 token 时按官方位置（第 4 位）插入 */
function applyRating(prefix, rating, mode, tiers = BUILTIN_TIER_NAMES) {
  if (!prefix || !rating) return prefix || '';
  const set = new Set(tiers);
  const parts = prefix.split(',').map(s => s.trim()).filter(Boolean);
  const idx = parts.findIndex(p => set.has(keyOf(p)));
  if (idx >= 0) { parts[idx] = rating; return parts.join(', '); }
  if (mode === 'force') { parts.splice(Math.min(3, parts.length), 0, rating); return parts.join(', '); }
  return prefix;
}

/**
 * 面 1 的「不出档位名」形态：把前缀里属于档位表的 token 摘掉。
 * 用户裁决：面板总是显式传档位（负面词、候选、档位门都跟档位走），但**分级 token 不得进输出串**。
 * 摘掉的只是那个词，前缀里的 masterpiece / best quality / score_7 一个不动。
 */
function stripRating(prefix, tiers = BUILTIN_TIER_NAMES) {
  if (!prefix) return '';
  const set = new Set(tiers);
  return prefix.split(',').map(s => s.trim()).filter(Boolean).filter(p => !set.has(keyOf(p))).join(', ');
}

const fmtFreq = n => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n || '-'));

/**
 * 官方硬规范第 1 条：标签一律小写、**空格代替下划线**（仅 score_* 保留下划线）。
 * 本库为了能和 Danbooru 对照，保留了部分下划线写法（cherry_tree / on_bed /
 * completely_nude），官方训练快照里这些是多词空格写法——画师标签同理
 * （`@haruyama kazunori`、`@mika pikazo`）。所以输出前统一转写法，
 * 库内 key 不动（查找、去重仍用原写法）。
 */
export function dispTag(tag) {
  const t = String(tag == null ? '' : tag).trim();
  if (!t) return '';
  if (/^score[_-]/.test(t)) return t;          // score_7 官方就是下划线
  return t.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** 逗号串 → 逐段转官方写法后再拼回来（整串直接换会把 score_1 也改掉） */
const dispList = s => String(s == null ? '' : s).split(',').map(dispTag).filter(Boolean).join(', ');

/**
 * @param {object} res      matchPlan() 的结果
 * @param {object} negRes   matchPlan() 对否定分句的结果（可省）
 * @param {object} opts     { prefix, negative, maxPerLayer, limit, dedupeImplied, rating }
 */
export function compose(res, negRes = null, opts = {}) {
  const tiers = tiersOf(opts);
  const rating = pickRating(res, opts.rating, tiers);
  const basePrefix = opts.prefix === undefined ? POSITIVE_PREFIX : opts.prefix;
  // 显式 --rating 时即使前缀里没有分级 token 也补上；自动适配只替换已有的 safe
  const withRating = applyRating(basePrefix, rating, opts.rating ? 'force' : 'auto', tiers);
  // 面 1：`--no-tier-token`（或面板关掉 faces.prefixToken）→ 任何交付串里都不写档位名
  const tierToken = opts.tierToken !== false;
  const prefix = tierToken ? withRating : stripRating(withRating, tiers);
  const prefixKeys = prefix === POSITIVE_PREFIX
    ? PREFIX_KEYS
    : new Set(prefix.split(',').map(s => keyOf(s)).filter(Boolean));
  const negativeBase = opts.negative === undefined ? NEGATIVE_DEFAULT : opts.negative;
  const maxPerLayer = opts.maxPerLayer || 24;
  const dedupeImplied = opts.dedupeImplied !== false;

  // 1) 分层归位
  const layers = LAYER_NAME.map((name, idx) => ({ layer: idx, name, tags: [] }));
  const seen = new Set();
  for (const m of res.matches) {
    const k = keyOf(m.tag);
    if (!k || seen.has(k)) continue;
    if (prefixKeys.has(k)) continue;               // 前缀已有
    if (dedupeImplied && m.implied && m.score < 0.72) continue;   // 被更具体标签包住的泛标签，分数不高就不要
    seen.add(k);
    const bucket = layers[m.layer] || layers[8];
    if (bucket.tags.length >= maxPerLayer) continue;
    bucket.tags.push({
      tag: m.tag, layer: m.layer, zh: m.zh, score: m.score, sim: m.sim, reason: m.reason,
      freqN: m.freqN, freqStr: m.freqStr || fmtFreq(m.freqN), conf: m.conf,
      big: m.big, bigName: m.bigName, sub: m.sub, official: m.official, clauses: m.clauses
    });
  }
  // 1b) 第 6 期：注入标签（主题配方 --theme / 单人默认视线）。
  // 它们不是从用户原话反推的，所以固定给 1 分、reason 记来源，好让人一眼看出这条是哪来的；
  // 已经被交付过的标签不重复注入。注入的前提是调用方显式给了数据（opts.extraTags / opts.viewDefault），
  // 所以**不传时行为与改造前逐字节一致**。
  const injected = [];
  const pushInjected = (x) => {
    const tag = typeof x === 'string' ? x : x && x.tag;
    const k = keyOf(tag);
    if (!k || seen.has(k) || prefixKeys.has(k)) return;
    seen.add(k);
    const layer = typeof x === 'object' && x && Number.isInteger(x.layer) ? x.layer : 8;
    const bucket = layers[layer] || layers[8];
    if (bucket.tags.length >= maxPerLayer) return;
    const row = {
      tag, layer, zh: (x && x.zh) || '', score: 1, sim: 1,
      reason: (x && x.source) || 'injected',
      freqN: 0, freqStr: '', conf: '高',
      big: (x && x.big) || '', bigName: (x && x.bigName) || '', sub: (x && x.sub) || '',
      official: false, clauses: [], injected: true, source: (x && x.source) || 'injected'
    };
    bucket.tags.push(row);
    injected.push(row);
  };
  const extraTags = Array.isArray(opts.extraTags) ? opts.extraTags : [];
  for (const x of extraTags) pushInjected(x);
  // 单人默认视线（模板 §4.3，用户裁决「单人默认加」）：
  // 只在一人场景、用户没要求背影/侧脸、也没被 --no-view-default 关掉时才加。
  const viewDefault = Array.isArray(opts.viewDefault) ? opts.viewDefault : [];
  if (viewDefault.length && !opts.noViewDefault) {
    const pc = personCount(res.matches.map(m => m.tag));
    if (pc.kind === 'single' && needsViewDefault(res.query, res.matches.map(m => m.tag))) {
      for (const t of viewDefault) pushInjected({ tag: t, source: 'view-default' });
    }
  }
  for (const l of layers) l.tags.sort((a, b) => b.score - a.score || b.freqN - a.freqN);
  // 第 7 期：权重计划（JSON 行与 hybrid 文本共用同一份表，保证两边一致）
  const plan = weightPlan({ layers });

  // 2) 标签串（官方顺序：层 0 → 8），并统一成官方写法（空格代替下划线 + 按写法去重）
  const ordered = layers.flatMap(l => l.tags.map(t => t.tag));
  const seenDisp = new Set();
  const orderedOut = [];
  for (const t of ordered) {
    const d = dispTag(t);
    const dk = d.toLowerCase();
    if (!d || seenDisp.has(dk)) continue;   // 库里同时存在两种写法时只留分高的那个
    seenDisp.add(dk);
    orderedOut.push(d);
  }
  const bareOrdered = orderedOut.join(', ');
  // 交付形态（默认 --format tags）：不带官方质量前缀；分级不是默认档时（或调用方用 --rating 显式指定时）
  // 把分级标签放到最前面——R18 内容照样一眼看出分级，格式依然符合标签库规范，但内容本身不做任何删改
  const needRatingTag = tierToken && !!rating && (rating !== (tiers[0] || 'safe') || !!opts.rating);
  const bareList = needRatingTag ? [rating, ...orderedOut.filter(t => t.toLowerCase() !== rating)] : orderedOut;
  const bare = bareList.join(', ');
  const prompt = [dispList(prefix), bareOrdered].filter(Boolean).join(', ');

  // 3) 负向串：用户「不要 X」反推出的标签，每个分句最多取 2 个（宁少勿滥）
  const negTags = [];
  if (negRes) {
    const perClause = new Map();
    for (const m of negRes.matches) {
      const k = keyOf(m.tag);
      if (m.layer === 0 && /^(score_|safe$|masterpiece|best quality)/.test(m.tag)) continue;
      if (m.score < 0.6 && !m.forced) continue;
      if (!k || negTags.some(t => keyOf(t) === k)) continue;
      const ci = (m.clauses && m.clauses[0]) || 0;
      const n = perClause.get(ci) || 0;
      if (n >= 2) continue;
      perClause.set(ci, n + 1);
      negTags.push(m.tag);
      if (negTags.length >= 8) break;
    }
  }
  const negative = [dispList(negativeBase), dispList(negTags.join(','))].filter(Boolean).join(', ');

  // 4) 结构化 JSON
  const json = {
    schema: 'anima-tag-reverse/v1',
    query: res.query || null,
    rating,
    positive: {
      prefix: dispList(prefix),
      tags: orderedOut,
      tagsString: bareOrdered,
      rating,
      line: prompt,
      lineBare: bare,
      layers: layers.filter(l => l.tags.length).map(l => ({
        layer: l.layer, name: l.name,
        tags: l.tags.map(t => ({
          tag: t.tag, display: dispTag(t.tag), zh: t.zh, score: t.score, sim: t.sim, reason: t.reason,
          freq: t.freqStr, confidence: t.conf, weighted: plan.get(dispTag(t.tag).toLowerCase()) || 1,
          big: t.big, category: t.bigName, sub: t.sub,
          official: !!t.official, fromClauses: t.clauses,
          ...(t.injected ? { injected: true, source: t.source } : {})
        }))
      }))
    },
    negative: { string: negative, base: dispList(negativeBase), added: negTags.map(dispTag) },
    stats: {
      total: res.total,
      used: orderedOut.length,
      unmatchedClauses: (res.groups || []).filter(g => !g.matches.length).map(g => g.clause)
    }
  };
  // 第 6 期：用户原话里「没能成为标签的说法」（整句落空 + 分数不够/被压制落选），不静默消失。
  // 只有真出现时才加这个键——一条都没有时 json 与改造前逐字节一致。
  const looseAll = looseItems(res);
  if (looseAll.length) json.stats.loose = looseAll;
  // 第 6 期：注入来的标签（主题 / 默认视线）单独点一下名，方便调用方区分「反推的」与「配方给的」
  if (injected.length) json.stats.injected = injected.map(t => t.tag);

  // 5) Markdown 报告
  const md = [];
  md.push('### 反推标签');
  if (res.query) md.push('> 输入：' + res.query);
  md.push('');
  md.push('**正向串**');
  md.push('```');
  md.push(prompt);
  md.push('```');
  md.push('');
  md.push('**分层视图**（' + orderedOut.length + ' 条 / 候选池 ' + res.total + ' 条）');
  for (const l of layers) {
    if (!l.tags.length) continue;
    md.push('');
    md.push(`**${l.layer}·${l.name}**`);
    for (const t of l.tags) {
      md.push(`- \`${dispTag(t.tag)}\`${t.zh ? '（' + t.zh + '）' : ''} · ${t.score.toFixed(2)} · ${t.freqStr} · ${t.conf}`);
    }
  }
  if (negTags.length) {
    md.push('');
    md.push('**负向串**');
    md.push('```');
    md.push(negative);
    md.push('```');
  }
  const unmatched = json.stats.unmatchedClauses;
  if (unmatched.length) {
    md.push('');
    md.push('**没匹配上的片段**（词库里确实没有，需要人工确认）：' + unmatched.map(s => '`' + s + '`').join('、'));
  }

  // tags = 默认交付形态：单行、逗号分隔、不带官方质量前缀（前缀请自行拼接，或用 prompt/带前缀形态）
  return { prompt, tags: bare, bare, rating, negative, layers, json, markdown: md.join('\n'), stats: json.stats };
}

/**
 * Anima 权重档位表（第 7 期）：混合形态默认给标签配 `(tag:1.2)` 形式的权重。
 * 依据＝本地词库每条自带的 weight 参考区间 ＋ 实测结论「冷词才有收益、热词给不给都在」：
 *   freq ≥ 100k（主流写法）→ 裸标签
 *   10k ≤ freq < 100k      → 1.1
 *   1k  ≤ freq < 10k       → 1.2
 *   freq < 1k（冷词）      → 1.3
 *   库外词 / 无 freq        → 裸标签（权重救不了词库里没有的词）
 * 硬顶：全串最多 {@link WEIGHT_CAP_TOTAL} 个、每层最多 {@link WEIGHT_CAP_PER_LAYER} 个，
 * 都按 freq 升序取（最冷的先给）。人数层永不加权 —— 词库原话「人数标签务必保留，权重过高会溢出角色」。
 */
export const WEIGHT_CAP_TOTAL = 6;
export const WEIGHT_CAP_PER_LAYER = 2;

/** 人数与画面规模标签：一律裸标签 */
const PERSON_TAGS = new Set([
  '1girl', '1boy', '2girls', '2boys', '3girls', '3boys', '4boys', '5boys',
  'multiple girls', 'multiple boys', 'solo', 'no humans', 'everyone', '1other', 'hetero'
]);

/**
 * freq → 权重档位（纯函数，便于单测）。
 * @param {number} freqN Danbooru 投稿量级（词库 freq）
 * @returns {number} 1 表示裸标签
 */
export function weightForFreq(freqN) {
  if (!freqN || freqN <= 0) return 1;
  if (freqN >= 100000) return 1;
  if (freqN >= 10000) return 1.1;
  if (freqN >= 1000) return 1.2;
  return 1.3;
}

/**
 * 算出这一串里哪些标签加权、各给多少。
 * @param {object} out compose()/reverse() 的结果
 * @returns {Map<string, number>} 显示形态的小写标签 → 权重（只收 >1 的）
 */
export function weightPlan(out) {
  const cand = [];
  for (const l of (out && out.layers) || []) {
    const perLayer = [];
    for (const t of l.tags || []) {
      const tag = String(t.tag || '');
      if (!tag || PERSON_TAGS.has(tag.toLowerCase())) continue;
      const w = weightForFreq(t.freqN);
      if (w <= 1) continue;
      const key = dispTag(tag).toLowerCase();
      if (!key || PERSON_TAGS.has(key)) continue;
      perLayer.push({ key, w, freqN: t.freqN });
    }
    perLayer.sort((a, b) => a.freqN - b.freqN);
    cand.push(...perLayer.slice(0, WEIGHT_CAP_PER_LAYER));
  }
  cand.sort((a, b) => a.freqN - b.freqN);
  const map = new Map();
  for (const c of cand.slice(0, WEIGHT_CAP_TOTAL)) map.set(c.key, c.w);
  return map;
}

/**
 * 混合形态的「行块」（第 6 期，CLI 默认输出）：按官方 0–8 层分行，每行一条语义块。
 *   第 1 行 = 前缀行（质量词 + 画质分 + 分级 token）——与用户给的样板同形；
 *   其后每层一行（层号顺序 = LAYER_NAME 顺序，也就是官方顺序）；
 *   行内逗号 + 空格分隔、行尾由 {@link hybridBlock} 补一个逗号。
 * 只做排版：标签集合与 `prompt` 完全相同（一条不多、一条不少），
 * 所以「0–8 层分行」不会改变内容，也不会重新排序。
 *
 * 权重（Anima 语法 `(tag:1.2)`）默认就加：按 {@link weightPlan} 的档位表给每层标签配权重；
 * 传 `opts.weights === false`（CLI 的 `--no-weights`）时退回全裸标签。
 *
 * @param {object} out compose() 的结果（或 reverse() 的结果，后者带同样的键）
 * @returns {string[]} 每行一个字符串（不含行尾逗号）
 */
export function hybridLines(out, opts = {}) {
  const seen = new Set();
  const wmap = opts.weights === false ? new Map() : weightPlan(out);
  const take = (list, isPrefix) => {
    const parts = [];
    for (const raw of list) {
      const d = dispTag(raw);
      const k = d.toLowerCase();
      if (!d || seen.has(k)) continue;   // 跨行去重：前缀里有的标签不会在层行里再出现一次
      seen.add(k);
      const w = isPrefix ? 1 : (wmap.get(k) || 1);
      parts.push(w > 1 ? `(${d}:${w})` : d);
    }
    return parts.join(', ');
  };
  const lines = [];
  const prefix = String((out && out.json && out.json.positive && out.json.positive.prefix) || '');
  const head = take(prefix.split(','), true);
  if (head) lines.push(head);
  for (const l of (out && out.layers) || []) {
    const line = take(l.tags.map(t => t.tag), false);
    if (line) lines.push(line);
  }
  return lines;
}

/** 混合形态的整块标签文本：每行末尾保留一个逗号（照搬样板），行间换行 */
export function hybridBlock(out, opts = {}) {
  return hybridLines(out, opts).map(l => l + ',').join('\n');
}

/**
 * 第 6 期：混合形态的两块「收尾料」。
 * 用户裁决：词库里查不到对应标签的说法（含分数不够而落选的），要转成人话写进输出，不能静默丢。
 * 被档位挡下的那些**不算**（用户裁决「保持档位的门」，档位挡下的不写进人话）。
 * 这里只负责找齐与排版，不含翻译：脚本不会翻译，中文原话照抄带回，
 * 翻成英文并补进最后那句自然语言，由对话侧（我）完成。
 */

/**
 * 第 6 期：只有这些落选原因算「真·分数不够 / 没接住」，才写进人话；
 * 其余（同一张表里挑掉的近义词）不算信息丢失。改这里就能放开/收紧。
 */
const LOOSE_KEEP_WHY = Object.freeze(['below-min-score']);

/**
 * 把「没能成为标签的说法」收齐（不静默丢）。
 *   unmatched  整个分句一条标签都没接住
 *   dropped    分句里本来有词库对应，只是分数不够 / 被泛词、同表、同核、变体压制而落选
 * @param {object} res matchPlan 的返回值（含 groups）
 * @returns {Array<{kind:string,text:string,tag?:string,zh?:string,score?:number,why?:string,clause?:string}>}
 */
export function looseItems(res) {
  const out = [];
  for (const g of (res && res.groups) || []) {
    if (!g.matches.length && g.clause) out.push({ kind: 'unmatched', text: g.clause, clause: g.clause });
    for (const d of g.dropped || []) {
      // 只收「真·分数不够」的：被泛词/同表/同核/变体压制而落选的那些，是同一张表里
      // 主动挑掉的多余近义词（用户说「微笑」时被挑掉的「邪恶微笑、淡淡微笑…」），
      // 含义已由留下的那条代表，写进人话只会变噪音。
      if (!LOOSE_KEEP_WHY.includes(d.why)) continue;
      const text = d.via || d.zh || d.tag;
      if (!text) continue;
      out.push({ kind: 'dropped', text, tag: d.tag, zh: d.zh, score: d.score, why: d.why, clause: g.clause });
    }
  }
  const seen = new Set();
  return out.filter(x => {
    const k = x.kind + '|' + x.text;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * 混合形态末尾怎么交代「查不到对应标签的说法」。
 * 默认 note：只写一行「另外：有 N 句没接住」——不打印中文原话（用户裁决：中文原话不进输出，
 * 免得跟英文句混在一起被误当提示词）。要原话时用 --loose marker / plain / line。
 * @param {object} out  reverse() 的返回值
 * @param {string} mode off（不说）/ note（只报条数，默认）/ plain（中文原话直接接在句子后面）/
 *                      marker（原话加「（另外：…）」）/ line（原话另起一行单独列）
 * @returns {string}
 */
export function looseTail(out, mode = 'note') {
  if (!mode || mode === 'off') return '';
  const items = (out.stats && Array.isArray(out.stats.loose)) ? out.stats.loose.slice() : [];
  const texts = [...new Set(items.map(i => String(i.text || '').trim()).filter(Boolean))];
  if (!texts.length) return '';
  const joined = texts.join('、');
  if (mode === 'note') return `另外：有 ${texts.length} 句没接住`;
  if (mode === 'plain') return ' ' + joined;
  if (mode === 'line') return '另外（词库里没接住、要翻成英文补进上面那句）：' + joined;
  return '（另外：' + joined + '）';
}

export const _internal = { PREFIX_KEYS, fmtFreq, applyRating, stripRating };
