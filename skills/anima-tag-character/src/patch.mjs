/**
 * patch.mjs —— 把观察 JSON 里的中文角色名 / 作品名就地换成正确标签
 *
 * 这是本技能与 `anima-tag-reverse` / `anima-tag-merge` 串起来的关键：
 * 那两份技能吃的是结构化观察，而 `characters` / `series` 两个字段最容易被写成中文
 * （「可莉」「原神」），写中文等于没写 —— 引擎只会把它当普通词去凑标签。
 * 这里把这两个字段就地修正，输出仍是一份标准观察 JSON，可以直接喂回去。
 *
 * 两个刻意的取舍：
 *   - **置信度不够就不改**：分数低于阈值的条目原样保留，并进 `unresolved` 让人来定，
 *     而不是把「胡桃」硬改成某个恰好的胡桃。
 *   - **只补空、不覆盖**：`series` 为空时可以由角色归属反推补上；用户已经写了作品就不动它。
 */
import { resolveCharacter, resolveSeries } from './resolve.mjs';
import { toTag } from './normalize.mjs';

const asArray = v => (Array.isArray(v) ? v : (v ? [v] : []));
const isEmpty = v => v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length);

/**
 * @param {object|string} spec 观察 JSON
 * @param {{kb:object, series?:string, confidence?:number}} opts
 * @returns {{spec:object, changes:Array, unresolved:Array, notes:string[]}}
 */
export function patchSpec(spec, { kb, series, confidence = 0.85 } = {}) {
  if (!kb) throw new Error('patchSpec 需要 kb（先 loadKb()）');
  const raw = typeof spec === 'string' ? JSON.parse(spec) : JSON.parse(JSON.stringify(spec));
  const changes = [];
  const unresolved = [];
  const notes = [];
  const seriesFromChars = [];

  // ---- characters ----
  const chars = asArray(raw.characters);
  if (chars.length) {
    const out = [];
    const seenTags = new Set();
    for (const item of chars) {
      const text = String(item);
      const r = resolveCharacter(text, { kb, series });
      notes.push(...r.notes);
      const best = r.best;
      if (best && best.score >= confidence) {
        // 去重：中文名与英文名同时写着（["可莉","klee"]）会解析成同一个标签，只留一个
        if (seenTags.has(best.tag)) {
          changes.push({ field: 'characters', from: text, to: '(去掉重复)', score: best.score, why: ['与前面的角色标签重复'] });
          continue;
        }
        seenTags.add(best.tag);
        out.push(best.tag);
        if (best.series) seriesFromChars.push(best.series);
        if (best.tag !== text) {
          changes.push({
            field: 'characters', from: text, to: best.tag, score: best.score,
            why: best.why, series: best.series, seriesVia: best.seriesVia
          });
        }
      } else {
        out.push(item);
        unresolved.push({
          field: 'characters', input: text,
          best: best ? best.tag : null, score: best ? best.score : 0,
          candidates: r.candidates.slice(0, 3).map(c => ({ tag: c.tag, zh: c.zh, series: c.series, score: c.score })),
          rejected: r.rejected.slice(0, 3),
          notes: r.notes
        });
      }
    }
    raw.characters = Array.isArray(raw.characters) ? out : (out[0] ?? '');
  }

  // ---- series ----
  const sarr = asArray(raw.series);
  if (sarr.length) {
    const out = [];
    for (const item of sarr) {
      const text = String(item);
      const sr = resolveSeries(text, { kb });
      const best = sr.best;
      if (best && best.score >= confidence) {
        out.push(best.tag);
        if (best.tag !== text) {
          changes.push({ field: 'series', from: text, to: best.tag, score: best.score, why: ['作品名精确命中'] });
        }
      } else {
        out.push(item);
        unresolved.push({
          field: 'series', input: text,
          best: best ? best.tag : null, score: best ? best.score : 0,
          candidates: sr.candidates.slice(0, 3).map(c => ({ tag: c.tag, zh: c.zh, score: c.score }))
        });
      }
    }
    raw.series = Array.isArray(raw.series) ? out : (out[0] ?? '');
  } else if (seriesFromChars.length) {
    const uniq = [...new Set(seriesFromChars)];
    raw.series = uniq;
    changes.push({ field: 'series', from: '(空)', to: uniq.join(', '), score: 1, why: ['由角色归属补全'] });
  }

  return { spec: raw, changes, unresolved, notes: [...new Set(notes)] };
}

/** 直接产出可交付的 tag 片段（不需要完整观察 JSON 时的快捷路径） */
export function buildPair(query, { kb, series, withSeries = true } = {}) {
  const r = resolveCharacter(query, { kb, series });
  if (!r.best) return { ok: false, result: r, tags: '' };
  const parts = [toTag(r.best.tag)];
  if (withSeries && r.best.series) parts.push(toTag(r.best.series));
  return { ok: true, result: r, tags: parts.join(', '), series: r.best.series, score: r.best.score };
}
