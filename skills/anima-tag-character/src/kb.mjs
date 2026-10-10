/**
 * kb.mjs —— 从 anima-tag-reverse 的词库里建「角色 / 作品」索引
 *
 * 数据现成，不需要联网、不需要额外数据集：词库的 `search-index.json` 里已经有
 *   5713 条 `cb:character`（其中 5559 条带中文名）
 *   1098 条 `cb:series`（作品，zh 里常写着「（收录 N 个角色）」）
 * 本文件把它整理成三个索引：
 *   characters  角色条目（含中文名 / 别名 / 频次 / **作品归属**）
 *   series      作品条目
 *   nameIndex   「任何写法 → 条目」的倒排，供 resolve.mjs 召回
 *
 * 角色 → 作品的归属（这是「精确到具体作品的具体角色」的关键）按三条路径推断，**必须先于打分**：
 *   ① 词库 slot 字段（1402 条，最准）
 *   ② tag 尾部括号，且括号内容**能在作品库里查到**（`klee (genshin impact)` ✓；`hakurei_reimu_(pc-98)` ✗ 那是形态）
 *   ③ zh 尾部括号能在作品库里查到（`老师（蔚蓝档案）` ✓）
 * 三条都不认的（1844 条，多为 hetero / muscular_male 这类泛角色）归属留空，
 * 打分时按「无归属」处理并在输出里如实显示 —— 不猜。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveEngineDir } from './engine.mjs';
import { normalizeName, keyOf, splitParen, parseFreq } from './normalize.mjs';
import { SERIES_ZH } from './series-zh.mjs';

/**
 * 作品中文别名表 → `{ 作品key: [别名…] }`。
 * **逐条用词库校验**：series-zh.mjs 里写的英文标签必须在词库作品表里存在，
 * 查不到的直接丢弃（避免手写表把不存在的作品标签带进结果，也保证词库升级后自动失效）。
 */
function seriesZhAliases(seriesByKey) {
  const map = {};
  let dropped = 0;
  for (const [tag, aliases] of Object.entries(SERIES_ZH)) {
    const k = keyOf(tag);
    if (!k || !seriesByKey.has(k)) { dropped++; continue; }
    const list = [...new Set((aliases || []).map(a => String(a).trim()).filter(Boolean))];
    if (list.length) map[k] = list;
  }
  return { map, dropped };
}

/** anima-tag-reverse 会把词库位置写进自己的 kb-path.json */
function kbFromEngine(engineDir) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(engineDir, 'kb-path.json'), 'utf8'));
    if (j.kbDir) return j.kbDir;
  } catch { /* 没写就继续找 */ }
  return null;
}

const isKbDir = d => !!d && fs.existsSync(path.join(d, 'search-index.json')) && fs.existsSync(path.join(d, 'manifest.json'));

/** 词库定位：显式 → 环境变量 → 本技能 → 引擎 → 常见路径 */
export function resolveKbDir({ kbDir, skillDir, engineDir } = {}) {
  const cands = [];
  if (kbDir) cands.push(kbDir);
  if (process.env.ANIMA_KB_DIR) cands.push(process.env.ANIMA_KB_DIR);
  const here = skillDir || path.dirname(path.dirname(new URL(import.meta.url).pathname));
  for (const dir of [here]) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, 'kb-path.json'), 'utf8'));
      if (j.kbDir) cands.push(j.kbDir);
    } catch { /* ignore */ }
  }
  try {
    const eng = engineDir || resolveEngineDir({ skillDir: here });
    cands.push(kbFromEngine(eng));
    cands.push(path.resolve(eng, '..', 'anima-tag-kb', '画师类'));
  } catch { /* 引擎找不到时继续试下面的 */ }
  cands.push(path.join(os.homedir(), '.dsh', 'skills', 'anima-tag-reverse', 'kb-path.json'));
  cands.push(path.resolve(here, '..', 'anima-tag-reverse', 'anima-tag-kb', '画师类'));

  for (const c of cands) {
    if (!c) continue;
    if (String(c).endsWith('.json')) {
      try {
        const j = JSON.parse(fs.readFileSync(c, 'utf8'));
        if (j.kbDir && isKbDir(j.kbDir)) return fs.realpathSync(j.kbDir);
      } catch { /* ignore */ }
      continue;
    }
    if (isKbDir(c)) return fs.realpathSync(c);
  }
  throw new Error(
    '找不到 anima-tag-kb 词库目录（需要含 search-index.json + manifest.json）。请任选一种方式指定：\n' +
    '  1) --kb <词库目录>\n' +
    '  2) 环境变量 ANIMA_KB_DIR\n' +
    '  3) 本技能目录下 kb-path.json 写 {"kbDir":"…"}\n' +
    '已尝试：\n  ' + cands.filter(Boolean).join('\n  ')
  );
}

let _cache = null;

/**
 * 加载并索引词库（进程内缓存）。
 * @returns {{dir:string, meta:object, characters:Array, series:Array, seriesByKey:Map, charByKey:Map, nameIndex:Map, stats:object}}
 */
export function loadKb(opts = {}) {
  const dir = resolveKbDir(opts);
  if (_cache && _cache.dir === dir) return _cache;

  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'search-index.json'), 'utf8'));
  const idx = {};
  raw.fields.forEach((f, i) => { idx[f] = i; });
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).meta || {}; } catch { /* ignore */ }

  const series = [];
  const seriesByKey = new Map();
  for (const r of raw.rows) {
    if (r[idx.big] !== 'cb:series') continue;
    const tag = r[idx.tag];
    const entry = {
      tag,
      key: keyOf(tag),
      zh: r[idx.zh] || '',
      zhKey: keyOf(r[idx.zh] || ''),
      zhBaseKey: keyOf(splitParen(r[idx.zh] || '').base),   // zh 里常有「（收录 401 个角色）」，比 zhKey 更好用
      aliases: String(r[idx.aliases] || ''),
      freq: parseFreq(r[idx.freq]),
      sub: r[idx.sub] || '',
      kind: 'series'
    };
    series.push(entry);
    seriesByKey.set(entry.key, entry);
    if (entry.zhKey && !seriesByKey.has(entry.zhKey)) seriesByKey.set(entry.zhKey, entry);
  }

  const characters = [];
  const charByKey = new Map();
  for (const r of raw.rows) {
    if (r[idx.big] !== 'cb:character') continue;
    const tag = r[idx.tag];
    const { base, paren } = splitParen(tag);
    const zh = r[idx.zh] || '';
    const zhParen = splitParen(zh).paren;
    const slot = String(r[idx.slot] || '').trim();

    // ---- 作品归属：三条路径，先准后宽 ----
    let seriesTag = null;
    let seriesVia = '';
    const slotKey = keyOf(slot);
    if (slotKey && seriesByKey.has(slotKey)) {
      seriesTag = seriesByKey.get(slotKey).tag; seriesVia = 'slot';
    }
    if (!seriesTag && paren && seriesByKey.has(paren)) {
      seriesTag = seriesByKey.get(paren).tag; seriesVia = 'tag 括号';
    }
    if (!seriesTag && zhParen && seriesByKey.has(keyOf(zhParen))) {
      seriesTag = seriesByKey.get(keyOf(zhParen)).tag; seriesVia = '中文括号';
    }
    const seriesKey = seriesTag ? keyOf(seriesTag) : null;

    // 异体/形态标签：尾部括号不是作品 → 多半是 (cosplay) (pc-98) (append) 这类衍生条目
    const variant = !!(paren && !(seriesKey && paren === seriesKey));

    const aliasList = String(r[idx.aliases] || '').split(/\s+/).map(normalizeName).filter(a => a && a.length >= 2 && !/^\d/.test(a));
    const entry = {
      tag,
      key: keyOf(tag),
      baseKey: base,
      paren,
      variant,
      zh,
      zhKey: keyOf(zh),
      zhBaseKey: keyOf(splitParen(zh).base),
      aliases: aliasList,
      aliasSet: new Set(aliasList),
      freq: parseFreq(r[idx.freq]),
      slot,
      seriesTag,
      seriesKey,
      seriesVia,
      sub: r[idx.sub] || '',
      kind: 'character'
    };
    characters.push(entry);
    charByKey.set(entry.key, entry);
  }

  // ---- 倒排索引：任何写法 → 条目 ----
  // 注意要把 **baseKey**（去掉尾部括号的主名）也登记进去：
  // 否则「空（原神）」这种条目，用户写单字「空」时精确匹配不到（前缀/包含匹配因为要求长度≥2 也被跳过）。
  const nameIndex = new Map();
  const addName = (name, entry, field) => {
    const k = keyOf(name);
    if (!k) return;
    if (!nameIndex.has(k)) nameIndex.set(k, []);
    nameIndex.get(k).push({ entry, field });
  };
  for (const e of characters) {
    addName(e.tag, e, 'tag');
    if (e.baseKey && e.baseKey !== e.key) addName(e.baseKey, e, 'tag-base');
    if (e.zh) addName(e.zh, e, 'zh');
    if (e.zhBaseKey && e.zhBaseKey !== e.zhKey) addName(e.zhBaseKey, e, 'zh-base');
    for (const a of e.aliases) addName(a, e, 'alias');
  }
  // 人工策划的作品中文别名（词库本身只有 55 个作品带中文名，缺口靠这张表补）
  const zhAlias = seriesZhAliases(seriesByKey);
  const zhAliasTable = zhAlias.map;
  let zhAliasHits = 0;
  for (const s of series) {
    const extras = zhAliasTable[s.key] || [];
    if (!extras.length) continue;
    s.extraAliases = new Set(extras.map(keyOf));
    for (const a of extras) { addName(a, s, 'zh-alias'); zhAliasHits++; }
  }
  for (const s of series) {
    addName(s.tag, s, 'tag');
    if (s.zh) addName(s.zh, s, 'zh');
    if (s.zhBaseKey && s.zhBaseKey !== s.key) addName(s.zhBaseKey, s, 'zh-base');
  }

  const stats = {
    characters: characters.length,
    series: series.length,
    withZh: characters.filter(c => c.zh).length,
    withSeries: characters.filter(c => c.seriesTag).length,
    seriesZhAlias: zhAliasHits,
    seriesZhAliasDropped: zhAlias.dropped,
    names: nameIndex.size,
    total: raw.rows.length,
    builtAt: meta.built_at || ''
  };

  _cache = { dir, meta, characters, series, seriesByKey, charByKey, nameIndex, stats };
  return _cache;
}

/** 词库概况（CLI --info / API kbInfo） */
export function kbInfo(opts = {}) {
  const kb = loadKb(opts);
  const bySeries = {};
  for (const c of kb.characters) if (c.seriesTag) bySeries[c.seriesTag] = (bySeries[c.seriesTag] || 0) + 1;
  return {
    dir: kb.dir,
    meta: kb.meta,
    stats: kb.stats,
    topSeries: Object.entries(bySeries).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([tag, n]) => ({ tag, characters: n }))
  };
}
