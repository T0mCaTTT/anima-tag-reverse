/**
 * resolve.mjs —— 「作品 + 角色名」→ 精确的 Danbooru 角色标签与作品标签
 *
 * 这是本技能的核心。要做对只有三件事：
 *   ① **召回**：中文名、罗马音、英文名、别名、带形态括号的写法，全都要能命中；
 *   ② **消歧**：同名角色（`胡桃` 既是原神的也是别的）必须靠**作品归属**分开 ——
 *      归属对上就加分，归属明确对不上就排除（而不是让它混在候选里）；
 *   ③ **不装懂**：库里没有的角色（词库只收了 5713 条精选，Danbooru 实际有十万级）如实说
 *      「库里没有，我这里给不出」，由会话里的我补候选再用 `verifyTag()` 校验，而不是硬凑一个相近的。
 *
 * 打分只依赖可解释的信号（命中方式 / 是否异体 / 长度 / 归属 / 频次），
 * 每条候选都会带上 reason，报告里能一眼看出为什么推荐它。
 */
import { normalizeName, keyOf, splitParen, toTag } from './normalize.mjs';

/** 依据同一批信号给候选打分；返回 null 表示明显不该收 */
function scoreEntry(entry, q, base, seriesKey) {
  let score = 0;
  const why = [];
  if (entry.key === q) { score = 1.0; why.push('标签精确命中'); }
  else if (entry.baseKey === q) { score = 0.98; why.push('标签主名精确命中'); }
  else if (entry.zhKey === q) { score = 0.95; why.push('中文名精确命中'); }
  else if (entry.zhBaseKey === q) { score = 0.94; why.push('中文主名精确命中'); }
  else if (entry.aliasSet && entry.aliasSet.has(q)) { score = 0.9; why.push('别名精确命中'); }
  else if (base && base !== q && entry.aliasSet && entry.aliasSet.has(base)) { score = 0.88; why.push('别名精确命中'); }
  else if (entry.key.startsWith(q) || entry.zhKey.startsWith(q) || (entry.zhBaseKey || '').startsWith(q)) { score = 0.74; why.push('前缀命中'); }
  else if (entry.key.includes(q) || entry.zhKey.includes(q) || (entry.zhBaseKey || '').includes(q)) { score = 0.68; why.push('包含命中'); }
  else return null;

  // 异体/形态标签（(cosplay) (pc-98) (append)…）不是主标签，压下去
  if (entry.variant) { score -= 0.16; why.push('异体/形态标签，降权'); }
  // 长度惩罚：以**主名**长度为基准。用整个标签长度会误伤 `hu tao (genshin impact)`
  // 这种「主名很短、带作品括号」的正规写法（实测：它会被 `hutao` 这种残条目压过去）。
  const extra = Math.max(0, (entry.baseKey || entry.key).length - q.length);
  if (extra) score -= Math.min(0.12, extra * 0.006);

  // 无作品归属的条目一律小幅降权：词库里 freq=0 且无归属的多是「别名式残条目」
  // （hutao / marin kitagawa 这类），它们在中文名上往往和正规条目一模一样，
  // 只能靠归属与频次分开。
  if (!entry.seriesKey) { score -= 0.05; why.push('词库未标注作品归属'); }

  // ---- 作品归属消歧 ----
  if (seriesKey) {
    if (entry.seriesKey === seriesKey) { score += 0.4; why.push('作品归属匹配'); }
    else if (entry.seriesKey) return { score, why, rejected: entry.seriesTag };
    else { score -= 0.04; why.push('无归属条目，按你给的作品放行'); }
  }

  // 频次先验：对数缩放，**上限 0.14 且下界从 log10≈2.5（几百）起算**。
  // 早期版本封顶 0.1 且低端截断，导致 14.6k 与 0 频次拿到同样的加成，区分度为零。
  const f = Math.max(0, Math.min(1, (Math.log10((entry.freq || 0) + 10) - 2.5) / 3.5));
  score += f * 0.14;
  return { score, why };
}

/** 在倒排索引里精确找 */
function exactHits(kb, name) {
  const k = keyOf(name);
  return k ? (kb.nameIndex.get(k) || []) : [];
}

/**
 * 找出名称里可能藏着的作品提示：
 *   《原神》的可莉        → seriesHint 原神（并剥掉「的」）
 *   可莉（原神）          → seriesHint 原神
 *   klee (genshin impact) → seriesHint genshin impact
 */
function parseQuery(kb, query) {
  const raw = String(query || '').trim();
  const hints = [];
  let rest = raw;

  // 书名号 / 「」 里的一般是作品
  const bookRe = /[《〈『]([^》〉』]+)[》〉』]/g;
  let m;
  while ((m = bookRe.exec(rest)) !== null) hints.push(m[1].trim());
  rest = rest.replace(bookRe, ' ');

  // 尾部括号：只有能在作品库里查到才算作品提示（`hakurei reimu (pc-98)` 不算）
  const { base, paren } = splitParen(rest);
  if (paren && kb.seriesByKey.has(keyOf(paren))) {
    hints.push(paren);
    rest = base;
  }
  rest = rest.replace(/[《〈『》〉』]/g, ' ').trim();
  // 剥掉「…的 X / …里的 X」里的连接词，避免把「的」带进角色名
  rest = rest.replace(/^\s*(?:里|中|内)?的\s*/, '').trim();
  return { raw, charPart: rest || raw, seriesHints: hints.filter(Boolean) };
}

/** 从「原神的可莉」「原神里的可莉」里拆出作品与角色 */
function splitByDe(text) {
  const m = String(text).match(/^(.+?)\s*(?:里|中|内)?\s*的\s*(.+)$/);
  if (!m) return null;
  const series = m[1].replace(/^[《〈『]|[》〉』]$/g, '').trim();
  const char = m[2].trim();
  return series && char ? { series, char } : null;
}

/** 在给定关键词上召回角色候选（精确 + 包含） */
function recallCharacters(kb, q, base) {
  const seen = new Set();
  const out = [];
  const push = (entry, field) => {
    if (!entry || seen.has(entry.tag)) return;
    seen.add(entry.tag);
    out.push({ entry, field });
  };
  for (const h of exactHits(kb, q)) if (h.entry.kind === 'character') push(h.entry, h.field);
  if (base && base !== q) for (const h of exactHits(kb, base)) if (h.entry.kind === 'character') push(h.entry, h.field);
  if (q.length >= 2) {
    for (const c of kb.characters) {
      if (seen.has(c.tag)) continue;
      if (c.key.includes(q) || c.zhKey.includes(q) || (c.zhBaseKey || '').includes(q)) push(c, 'contains');
    }
  }
  return out;
}

/** 作品名 → 作品条目（含候选） */
export function resolveSeries(query, { kb, top = 5, minScore = 0.5 } = {}) {
  const q = keyOf(query);
  if (!q) return { query, best: null, candidates: [] };
  const cands = [];
  const seen = new Set();
  const consider = (s, field) => {
    if (!s || seen.has(s.tag)) return;
    seen.add(s.tag);
    let score = 0;
    if (s.key === q) score = 1.0;
    else if (s.zhBaseKey === q || s.zhKey === q) score = 0.95;
    else if (s.extraAliases && s.extraAliases.has(q)) score = 0.92;   // 人工策划的中文别名
    else if (s.zhBaseKey.startsWith(q) || s.key.startsWith(q)) score = 0.78;
    else if (s.key.includes(q) || (s.zhBaseKey || '').includes(q)) score = 0.7;
    else return;
    score -= Math.min(0.15, Math.max(0, s.key.length - q.length) * 0.01);
    score += Math.min(0.1, Math.log10((s.freq || 0) + 10) / 12);
    cands.push({ tag: toTag(s.tag), zh: s.zh, score: +score.toFixed(4), field, freq: s.freq });
  };
  for (const h of exactHits(kb, q)) if (h.entry.kind === 'series') consider(h.entry, h.field);
  for (const s of kb.series) consider(s, 'contains');
  cands.sort((a, b) => b.score - a.score);
  const filtered = cands.filter(c => c.score >= minScore);
  return { query: String(query), best: filtered[0] || null, candidates: filtered.slice(0, top) };
}

/**
 * 核心：解析一个角色名（可带作品提示）。
 * @param {string} query 角色名（中文 / 罗马音 / 英文 / 带作品括号）
 * @param {{kb:object, series?:string, top?:number}} opts series = 用户指定的作品名
 * @returns {{query, series:{tag,zh}|null, best, candidates, rejected, notes}}
 */
export function resolveCharacter(query, { kb, series, top = 5 } = {}) {
  if (!kb) throw new Error('resolveCharacter 需要 kb（先 loadKb()）');
  const parsed = parseQuery(kb, query);
  const notes = [];

  // 「原神的可莉」这种没有书名号的写法：先整体试，整体召回不到再按「的」拆开重试
  let charPart = parsed.charPart;
  const deSplit = splitByDe(charPart);
  if (deSplit && !parsed.seriesHints.length) {
    const pre = resolveSeries(deSplit.series, { kb });
    if (pre.best) {
      parsed.seriesHints.push(deSplit.series);
      charPart = deSplit.char;
      notes.push(`从「…的…」结构里把「${deSplit.series}」当作品、「${deSplit.char}」当角色。`);
    }
  }

  let seriesResolved = null;
  let seriesFailed = false;   // 用户**显式**指定了作品却查不到 —— 这时不该静默降级成「无作品约束」
  const seriesQuery = series || parsed.seriesHints[0] || null;
  if (seriesQuery) {
    const sr = resolveSeries(seriesQuery, { kb });
    if (sr.best) {
      seriesResolved = { tag: sr.best.tag, zh: sr.best.zh, via: series ? '--series' : '名称里的作品提示', score: sr.best.score };
      if (sr.candidates.length > 1) {
        notes.push(`作品「${seriesQuery}」还可能是：${sr.candidates.slice(1, 4).map(c => `${c.tag}（${c.zh || '无中文'}）`).join('、')}`);
      }
    } else {
      seriesFailed = !!series;
      if (series) {
        notes.push(`⚠ 你指定的作品「${seriesQuery}」不在词库作品表里（词库只有 1098 个作品），无法用它消歧。请换英文/罗马音写法，或先确认作品标签。`);
      } else {
        notes.push(`名称里的作品提示「${seriesQuery}」不在词库里，已忽略。`);
      }
    }
  }

  let q = keyOf(charPart);
  let base = splitParen(charPart).base;
  let recalled = recallCharacters(kb, q, base);

  // 兜底：整体召回不到时，再按「X的Y」拆一次（这次不要求 X 已能解析成作品）
  if (!recalled.length) {
    const alt = splitByDe(charPart);
    if (alt && alt.char !== charPart) {
      const q2 = keyOf(alt.char);
      const r2 = recallCharacters(kb, q2, splitParen(alt.char).base);
      if (r2.length) {
        notes.push(`按「…的…」结构改为把「${alt.char}」当角色名重试。`);
        q = q2; base = splitParen(alt.char).base; recalled = r2;
        if (!seriesResolved) {
          const pre = resolveSeries(alt.series, { kb });
          if (pre.best) seriesResolved = { tag: pre.best.tag, zh: pre.best.zh, via: '名称里的「的」结构', score: pre.best.score };
        }
      }
    }
  }

  const seriesKey = seriesResolved ? keyOf(seriesResolved.tag) : null;

  const scored = [];
  const rejected = [];
  for (const { entry, field } of recalled) {
    const r = scoreEntry(entry, q, base, seriesKey);
    if (!r) continue;
    if (r.rejected) { rejected.push({ tag: toTag(entry.tag), zh: entry.zh, series: toTag(r.rejected), score: +Math.min(1, r.score).toFixed(4) }); continue; }
    scored.push({
      tag: toTag(entry.tag),        // 交付形态（空格代替下划线）
      rawTag: entry.tag,            // 词库原始写法，供查库/去重
      zh: entry.zh,
      series: entry.seriesTag ? toTag(entry.seriesTag) : null,
      seriesVia: entry.seriesVia,
      variant: entry.variant,
      freq: entry.freq,
      score: +Math.min(1, Math.max(0, r.score)).toFixed(4),   // 对外展示的置信度（0–1，封顶）
      scoreRaw: +r.score.toFixed(4),                          // 排序用（原始分，允许 >1）
      why: r.why,
      field
    });
  }
  // 排序用原始分，避免封顶后多个候选并列
  scored.sort((a, b) => b.scoreRaw - a.scoreRaw || b.freq - a.freq);

  if (!scored.length && rejected.length && seriesKey) {
    notes.push(`「${parsed.charPart}」在${seriesResolved.zh || seriesResolved.tag}里没找到；库里有同名角色属于别的作品（见 rejected），已按你的作品要求排除。`);
  }
  if (!scored.length && !rejected.length) {
    notes.push(`词库里没有「${parsed.charPart}」（精选库只收 5713 个角色）。可以让我给一个罗马音候选，再用 verify 校验；或直接按英文标签写。`);
  }

  return {
    query: String(query),
    queryParts: parsed,
    series: seriesResolved,
    seriesFailed,
    best: scored[0] || null,
    candidates: scored.slice(0, top),
    rejected: rejected.sort((a, b) => b.score - a.score).slice(0, 5),
    notes
  };
}

/**
 * 校验一个候选标签是否真实存在、属于谁。
 * 冷门角色不在精选库里时的兜底：我在会话里凭世界知识给出罗马音候选，用这个确认。
 */
export function verifyTag(tag, { kb } = {}) {
  const q = keyOf(tag);
  if (!q) return { query: tag, found: false, kind: null, exact: false, near: [] };
  const hits = exactHits(kb, q).filter(h => h.entry.kind === 'character' || h.entry.kind === 'series');
  const exactChar = hits.find(h => h.entry.kind === 'character');
  if (exactChar) {
    const e = exactChar.entry;
    return {
      query: tag, found: true, kind: 'character', exact: e.key === q,
      tag: toTag(e.tag), rawTag: e.tag, zh: e.zh,
      series: e.seriesTag ? toTag(e.seriesTag) : null, seriesVia: e.seriesVia,
      variant: e.variant, freq: e.freq,
      // 这个角色标签是否已自带作品括号
      hasSeriesInTag: !!e.paren && !!e.seriesKey && e.paren === e.seriesKey,
      near: []
    };
  }
  const exactSeries = hits.find(h => h.entry.kind === 'series');
  if (exactSeries) {
    return { query: tag, found: true, kind: 'series', exact: true, tag: toTag(exactSeries.entry.tag), rawTag: exactSeries.entry.tag, zh: exactSeries.entry.zh, freq: exactSeries.entry.freq, near: [] };
  }
  // 没精确命中 → 给相近候选（可能是拼写/顺序差异，如 kitagawa marin ↔ marin kitagawa）
  const near = [];
  for (const c of kb.characters) {
    if (c.key.includes(q) || q.includes(c.key)) {
      near.push({ tag: toTag(c.tag), zh: c.zh, series: c.seriesTag ? toTag(c.seriesTag) : null, score: c.key === q ? 1 : 0.6 });
      if (near.length >= 6) break;
    }
  }
  return { query: tag, found: false, kind: null, exact: false, near };
}

/** 某个作品下的角色清单（消歧用：让用户挑） */
export function charactersOf(seriesQuery, { kb, limit = 40, sort = 'freq' } = {}) {
  const sr = resolveSeries(seriesQuery, { kb });
  if (!sr.best) return { series: null, characters: [], note: `作品「${seriesQuery}」不在词库里。` };
  const sk = keyOf(sr.best.tag);
  let list = kb.characters.filter(c => c.seriesKey === sk);
  list = list.slice().sort(sort === 'freq'
    ? (a, b) => b.freq - a.freq
    : (a, b) => a.tag.localeCompare(b.tag));
  return {
    series: { tag: toTag(sr.best.tag), zh: sr.best.zh, score: sr.best.score },
    total: list.length,
    characters: list.slice(0, limit).map(c => ({ tag: toTag(c.tag), zh: c.zh, freq: c.freq, variant: c.variant })),
    note: sr.best.zh && /收录/.test(sr.best.zh) ? `词库注：${sr.best.zh}` : ''
  };
}

/** 通用名称检索（角色 + 作品一起），给「我知道个大概」的场景用 */
export function searchNames(query, { kb, kind = 'any', limit = 20 } = {}) {
  const q = keyOf(query);
  if (!q) return [];
  const out = [];
  const push = (entry, kindName, score, why) => {
    if (kind !== 'any' && kind !== kindName) return;
    out.push({ tag: toTag(entry.tag), zh: entry.zh, kind: kindName, series: entry.seriesTag ? toTag(entry.seriesTag) : null, score: +score.toFixed(4), freq: entry.freq, why });
  };
  for (const c of kb.characters) {
    if (c.key === q || c.zhKey === q || c.zhBaseKey === q) push(c, 'character', 1, '精确');
    else if (c.key.includes(q) || c.zhKey.includes(q) || c.zhBaseKey.includes(q)) push(c, 'character', 0.7, '包含');
  }
  for (const s of kb.series) {
    if (s.key === q || s.zhBaseKey === q) push(s, 'series', 1, '精确');
    else if (s.key.includes(q) || s.zhBaseKey.includes(q)) push(s, 'series', 0.7, '包含');
  }
  return out.sort((a, b) => b.score - a.score || b.freq - a.freq).slice(0, limit);
}

/**
 * 交付形态：Anima / Danbooru 规范的角色 + 作品标签串片段。
 * 默认**两个都写**（官方槽位顺序里角色与作品是两层；booru 上它们也是两个独立分类）。
 * 只想要角色标签用 `withSeries:false`（`--no-series`）。
 */
export function toTagPair(best, { withSeries = true } = {}) {
  if (!best) return '';
  const parts = [toTag(best.tag)];
  if (withSeries && best.series) parts.push(toTag(best.series));
  return parts.join(', ');
}
