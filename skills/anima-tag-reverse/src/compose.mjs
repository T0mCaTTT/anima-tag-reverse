/**
 * compose.mjs —— 第三步：输出格式化
 *
 * 一份匹配结果同时产出四种形态，按需取用：
 *   prompt    官方顺序的可复制标签串（前缀 + 分层标签，逗号分隔）
 *   negative  负向串（默认负向 + 用户「不要 X」反推出的负向标签）
 *   layers    分层视图（0 质量/元信息 … 8 其他），每层带中文与分数
 *   json      结构化结果（给程序用：分层、分数、频次、置信度、来源分句）
 *   markdown  给人看的分层报告（可直接贴进聊天窗口）
 */
import { POSITIVE_PREFIX, NEGATIVE_DEFAULT, LAYER_NAME, RATING_TAGS } from './config.mjs';
import { keyOf } from './normalize.mjs';

/** 前缀里已含的标签，输出时不再重复（官方约定：不必堆满） */
const PREFIX_KEYS = new Set(POSITIVE_PREFIX.split(',').map(s => keyOf(s)).filter(Boolean));

const RATING_SET = new Set(RATING_TAGS);
const ratingRank = t => RATING_TAGS.indexOf(t);

/**
 * 从命中结果里决定前缀的分级 token。
 * 命中的分级标签越强，前缀里的 safe 就换成越强的那个（safe → … → explicit）；
 * 这是格式适配，不是内容审查：R18 / NSFL 元素一律照常参与匹配与输出。
 * @param {object} res      matchPlan() 的结果
 * @param {string} override 调用方显式指定的分级（--rating）
 */
export function pickRating(res, override) {
  if (override) return override;
  let best = 'safe';
  for (const m of res?.matches || []) {
    const k = keyOf(m.tag);
    if (RATING_SET.has(k)) {
      if (ratingRank(k) > ratingRank(best)) best = k;
      continue;
    }
    // 命中的是成人内容分类（cb:nsfw，如裸体/性行为/情趣服饰）时至少给到 nsfw。
    // 这只是把分级 token 写对，内容本身一个标签都不会被删改。
    if (m.big === 'cb:nsfw' && ratingRank('nsfw') > ratingRank(best)) best = 'nsfw';
  }
  return best;
}

/** 把前缀里的分级 token 换成 rating；没有分级 token 时按官方位置（第 4 位）插入 */
function applyRating(prefix, rating, mode) {
  if (!prefix || !rating) return prefix || '';
  const parts = prefix.split(',').map(s => s.trim()).filter(Boolean);
  const idx = parts.findIndex(p => RATING_SET.has(keyOf(p)));
  if (idx >= 0) { parts[idx] = rating; return parts.join(', '); }
  if (mode === 'force') { parts.splice(Math.min(3, parts.length), 0, rating); return parts.join(', '); }
  return prefix;
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
  const rating = pickRating(res, opts.rating);
  const basePrefix = opts.prefix === undefined ? POSITIVE_PREFIX : opts.prefix;
  // 显式 --rating 时即使前缀里没有分级 token 也补上；自动适配只替换已有的 safe
  const prefix = applyRating(basePrefix, rating, opts.rating ? 'force' : 'auto');
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
      tag: m.tag, zh: m.zh, score: m.score, sim: m.sim, reason: m.reason,
      freqN: m.freqN, freqStr: m.freqStr || fmtFreq(m.freqN), conf: m.conf,
      big: m.big, bigName: m.bigName, sub: m.sub, official: m.official, clauses: m.clauses
    });
  }
  for (const l of layers) l.tags.sort((a, b) => b.score - a.score || b.freqN - a.freqN);

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
  // 交付形态（默认 --format tags）：不带官方质量前缀；分级不是 safe 时（或调用方用 --rating 显式指定时）
  // 把分级标签放到最前面——R18 内容照样一眼看出分级，格式依然符合标签库规范，但内容本身不做任何删改
  const needRatingTag = !!rating && (rating !== 'safe' || !!opts.rating);
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
          freq: t.freqStr, confidence: t.conf, big: t.big, category: t.bigName, sub: t.sub,
          official: !!t.official, fromClauses: t.clauses
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

export const _internal = { PREFIX_KEYS, fmtFreq, applyRating };
