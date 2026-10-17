/**
 * ANIMA3 模板规则（第 6 期并入技能）：互斥提醒 / 标签总数区间 / 单人默认视线 / 主题配方。
 *
 * 规则只有一份数据：`references/anima3-rules.json`（由 anima-tag-kb 侧从外部模板
 * 「ANIMA3 提示词生成模板 v3.1」提取，带真实章节行号）。本模块**只有 loadRules 读盘**，
 * 其余全是纯函数——compose（注入标签）与 gaps（互斥提醒）都从这里取判定，
 * 免得规则表的形状散到渲染层里。
 *
 * 用户裁决（第 6 期）：① 总数区间做末尾一行提醒 ② 单人默认加 direct eye contact / facing viewer
 * ③ 互斥发现就提醒（标准输出末尾一行 + json 的 gaps 记一条）④ 十二主题做成模板。
 * 注意：模板 §13.6 的「禁光线/光影/色调」**不采纳**（用户裁决不禁），所以本模块不做任何禁用过滤。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { keyOf } from './normalize.mjs';
import { LAYER_NAME } from './config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** 规则文件位置（技能自带；core 包不含 KB，规则必须活在技能内部） */
export const RULES_FILE = path.join(HERE, '..', 'references', 'anima3-rules.json');

const KIND_ZH = { single: '单人', duo: '双人', group: '多人' };

// 单人默认视线要跳过的情形：用户明确要背影/侧脸，或标签里已经有视角/失去意识。
const BACK_VIEW_RE = /背影|背对|背向|转身离开|回头|侧脸|侧脸|侧身|剪影|from behind|back view|facing away|from side|side profile|profile view/i;
const VIEW_BLOCK = [
  'from behind', 'back view', 'facing away', 'profile', 'from side', 'side profile',
  'looking at viewer', 'direct eye contact', 'facing viewer',
  'sleeping', 'unconscious'
].map(keyOf);

// 人数 token：solo / 1girl / 2boys / multiple girls …
const PERSON_RE = /^(\d{1,2})\s*(girl|boy|other)s?$/;
const MULTI = { 'multiple girls': ['girl', 3], 'multiple boys': ['boy', 3], 'multiple others': ['other', 3] };
// 没有数字的人称标签也算一个人：词库常常只给 girl / loli，不给 1girl、solo。
// 同一类（例如 girl + loli）只算一个，不同类（girl + boy）才加起来。
const PERSON_TYPE = {
  girl: 'girl', woman: 'girl', female: 'girl', loli: 'girl',
  boy: 'boy', man: 'boy', male: 'boy', shota: 'boy'
};

let cache = null;
let cacheFile = '';

/**
 * 读规则表（缓存）。传 file 可换一份（测试用）。
 * @param {string} [file]
 */
export function loadRules(file) {
  const f = file || RULES_FILE;
  if (cache && cacheFile === f) return cache;
  const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
  cache = {
    file: f,
    builtAt: raw.built_at || '',
    source: raw.source || '',
    mutex: Array.isArray(raw.mutex) ? raw.mutex : [],
    counts: raw.counts || {},
    viewDefaults: raw.viewDefaults || {},
    viewerClauses: Array.isArray(raw.viewerClauses) ? raw.viewerClauses : [],
    themes: Array.isArray(raw.themes) ? raw.themes : []
  };
  cacheFile = f;
  return cache;
}

/** 数人数：solo / 1girl / 2boys / multiple girls… → { n, kind, solo, tokens }（找不到人就是 n=0 / kind=null） */
export function personCount(tags) {
  let solo = false;
  const tokens = [];
  const cnt = { girl: 0, boy: 0, other: 0 };
  const bare = new Set();
  for (const t of tags || []) {
    const k = String(t || '').trim().toLowerCase().replace(/[_\s]+/g, ' ');
    if (!k) continue;
    if (k === 'solo') { solo = true; tokens.push(k); continue; }
    const m = k.match(PERSON_RE);
    if (m) {
      const v = Number(m[1]);
      if (v > cnt[m[2]]) cnt[m[2]] = v;
      tokens.push(k);
      continue;
    }
    const mu = MULTI[k];
    if (mu) { if (mu[1] > cnt[mu[0]]) cnt[mu[0]] = mu[1]; tokens.push(k); continue; }
    const ty = PERSON_TYPE[k];
    if (ty) { bare.add(ty); tokens.push(k); }
  }
  let n = 0;
  for (const ty of ['girl', 'boy', 'other']) n += Math.max(cnt[ty], bare.has(ty) ? 1 : 0);
  // 「solo」一个字都没配任何姓名标签时：就一个人
  if (!n && solo) n = 1;
  const kind = n <= 0 ? null : n === 1 ? 'single' : n === 2 ? 'duo' : 'group';
  return { n, kind, solo, tokens };
}

/**
 * 标签总数区间提醒（模板 §4.2：单 20–36 / 双 26–44 / 多 34–54，含质量词）。
 * 在区间内返回 ok=true（安静）；出区间给一句话。
 */
export function countHint(total, kind, rules) {
  const r = rules && rules.counts ? rules.counts[kind] : null;
  if (!kind || !Array.isArray(r) || r.length < 2) return null;
  const [min, max] = r;
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  const ok = total >= min && total <= max;
  return {
    total, kind, min, max, ok,
    text: ok ? '' : `标签共 ${total} 条，${KIND_ZH[kind] || kind}建议 ${min}–${max} 条（${total < min ? '偏少——细节还能再补' : '偏多——会互相稀释'}）`
  };
}

/**
 * 互斥检查（模板 §3.1 五组）。只报不拦：a 与 b 都有命中就是一条提醒。
 * 特例：§3.1「足部整体」那行 a/b 是同一组标签，真实规则是「≥3 条即过度」，按数量判。
 */
export function mutexHits(tags, rules) {
  const have = new Set((tags || []).map(t => keyOf(t)).filter(Boolean));
  const out = [];
  for (const g of (rules && rules.mutex) || []) {
    for (const p of g.pairs || []) {
      const A = (p.a || []).filter(t => have.has(keyOf(t)));
      if (!A.length) continue;
      const B = (p.b || []).filter(t => have.has(keyOf(t)));
      const sameSet = (p.a || []).length === (p.b || []).length
        && (p.a || []).every(t => (p.b || []).some(u => keyOf(u) === keyOf(t)));
      if (sameSet) {
        if (A.length >= 3) {
          out.push({
            kind: 'count', group: g.id, groupZh: g.zh || '', src: g.src || '', a: A, b: [], note: p.note || '',
            text: `${g.zh || '同组'}：${A.join('、')} 一次出现 ${A.length} 条（≥3 条就过度了）`
          });
        }
        continue;
      }
      if (!B.length) continue;
      out.push({
        kind: 'pair', group: g.id, groupZh: g.zh || '', src: g.src || '', a: A, b: B, note: p.note || '',
        text: `${g.zh || '互斥'}：${A.join('、')} 与 ${B.join('、')} 通常不同时出现${p.note ? '（' + p.note + '）' : ''}`
      });
    }
  }
  return out;
}

/** 单人默认视线要不要加（用户明确要背影/侧脸，或已经有视角标签时不加） */
export function needsViewDefault(queryText, tags) {
  if (BACK_VIEW_RE.test(String(queryText || ''))) return false;
  for (const t of tags || []) if (VIEW_BLOCK.includes(keyOf(t))) return false;
  return true;
}

/** 单人默认视线的标签名（模板 §4.3；缺表时给空数组，调用方不用判空） */
export function viewDefaultTags(rules) {
  const v = rules && rules.viewDefaults ? rules.viewDefaults.single : null;
  return Array.isArray(v) ? v.slice() : [];
}

/** 主题清单（`--theme-list` 用）：{ id, zh, count, src, forbids } */
export function themeList(rules) {
  return ((rules && rules.themes) || []).map(t => ({
    id: t.id, zh: t.zh || '', count: (t.tags || []).length, src: t.src || '', forbids: (t.forbids || []).length
  }));
}

/** 按 id 或中文名找主题（找不到返回 null） */
export function themeById(rules, id) {
  const q = keyOf(id);
  if (!q) return null;
  return ((rules && rules.themes) || []).find(t => t.id === String(id).trim().toLowerCase() || keyOf(t.zh) === q) || null;
}

/**
 * 把一列标签名补上词库信息（层 / 中文 / 大分类）。
 * lex 可以是 buildLexicon 的结果，也可以是 null——没有词库时照样能算出「查不到」的那几条。
 */
export function resolveTagRows(tags, lex) {
  return (tags || []).map(item => {
    const raw = typeof item === 'string' ? { tag: item } : item;
    const key = keyOf(raw.tag);
    const i = lex && lex.byTagKey ? lex.byTagKey.get(key) : undefined;
    const e = i === undefined || i === null ? null : lex.entries[i];
    const layer = raw.layer !== undefined && raw.layer !== null ? raw.layer : (e ? e.layer : 8);
    return {
      tag: raw.tag,
      zh: raw.zh || (e ? e.zh : ''),
      layer,
      layerName: LAYER_NAME[layer] || LAYER_NAME[8] || '其他',
      big: e ? e.big : '',
      bigName: e ? e.bigName : '',
      sub: e ? e.sub : '',
      known: !!e
    };
  });
}

/** 主题配方：解析成可直接注入 compose 的行（缺词库信息也能跑，missing 里报出来） */
export function themePlan(theme, lex) {
  if (!theme) return null;
  const rows = resolveTagRows(theme.tags, lex);
  return {
    id: theme.id,
    zh: theme.zh || '',
    src: theme.src || '',
    tags: rows.map(r => r.tag),
    rows,
    missing: rows.filter(r => !r.known).map(r => r.tag),
    requires: Array.isArray(theme.requires) ? theme.requires.slice() : [],
    forbids: Array.isArray(theme.forbids) ? theme.forbids.slice() : [],
    notes: Array.isArray(theme.notes) ? theme.notes.slice() : []
  };
}

/**
 * 一段交付结果的事后提醒（标准输出末尾一行 + json 的 annotate / gaps 都用它）。
 * @param {object} o { tags, query, persons?, theme?, rules, noViewDefault? }
 */
export function annotate(o) {
  const rules = o.rules || loadRules();
  const tags = o.tags || [];
  const persons = o.persons || personCount(tags);
  const mutex = mutexHits(tags, rules);
  const count = countHint(tags.length, persons.kind, rules);
  return {
    persons,
    mutex,
    count,
    theme: o.theme || null,
    lines: [
      ...mutex.map(m => '⚠ ' + m.text),
      ...(count && !count.ok ? ['· ' + count.text] : [])
    ]
  };
}
