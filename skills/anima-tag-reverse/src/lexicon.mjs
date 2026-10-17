/**
 * lexicon.mjs —— 词库加载与索引构建（读展览板用的那套分包，零依赖）
 *
 * 数据来源：anima-tag-kb/画师类/search-index.json（39,216 行 = 构建基线 38,306 + luo-fe 增量 171 + ANIMA3 增量 739，4.9MB）
 *   字段顺序 fields = ["tag","big","order","zh","aliases","weight","freq","confidence","sub","bigName","slot","official"]
 *   可选增量：anima-tag-kb/补充短语池/phrase-pool.json（≥3 token 的长短语，只有 opts.pool 打开时才读）
 *
 * 建三类索引（都在内存里，一次构建 ~1s）：
 *   surfaceMap  「去空格去标点」的表面 → 条目        汉字句子的最长匹配扫描靠它
 *   tokenMap    词元 / 汉字 1-gram、2-gram → 条目 id  英文与中文的候选召回靠它
 *   byTagKey    规范标签 → 条目                      精确命中（含 @画师）靠它
 */
import fs from 'node:fs';
import path from 'node:path';
import { normalizeText, keyOf, stripGloss, asciiTokens, cjkRuns, parseFreq, fingerprint, stemWord } from './normalize.mjs';
import { BIG_LAYER, COUNT_SUB, EXCLUDE_BIGS, EXTRA_ZH, FUNCTION_WORDS } from './config.mjs';

const MAX_SURFACE_LEN = 32;      // 扫描窗口上限（字符数）
const MAX_CANDIDATES = 80;       // 每个分句进入精算的候选上限

/** 补充短语池（第 4 期 ③：Luo-fe 长短语分流，默认不参与召回） */
export const POOL_DIR = '补充短语池';
export const POOL_FILE = 'phrase-pool.json';

export function loadIndex(kbDir) {
  const file = path.join(kbDir, 'search-index.json');
  if (!fs.existsSync(file)) {
    throw new Error(`找不到词库文件：${file}\n请先构建标签库（node anima-tag-kb/scripts/build-hierarchy.mjs），或用 --kb 指定 画师类 目录。`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** 短语池文件在词库目录的隔壁：anima-tag-kb/补充短语池/phrase-pool.json */
export function poolPath(kbDir) {
  return path.join(path.dirname(kbDir), POOL_DIR, POOL_FILE);
}

/** 读短语池；文件缺失或坏了都返回 null（池是可选增量，绝不该把技能搞挂） */
export function loadPool(kbDir) {
  const file = poolPath(kbDir);
  if (!fs.existsSync(file)) return null;
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (!doc || !Array.isArray(doc.rows)) return null;
    return { file, doc, rows: doc.rows };
  } catch { return null; }
}

export function buildLexicon(kbDir, opts = {}) {
  const idx = loadIndex(kbDir);
  const rows = idx.rows || [];
  const baseSize = rows.length;
  // search-index.json 不带 meta，词库概况在 manifest.json 里
  let meta = idx.meta || {};
  let cats = idx.cats || [];
  const mf = path.join(kbDir, 'manifest.json');
  if (fs.existsSync(mf)) {
    try {
      const man = JSON.parse(fs.readFileSync(mf, 'utf8'));
      meta = { ...(man.meta || {}), ...meta };
      if (!cats.length && Array.isArray(man.categories)) {
        cats = man.categories.map(c => ({ id: c.id, name: c.name, order: c.order, count: c.count, subs: c.subs }));
      }
    } catch { /* manifest 坏了不影响匹配 */ }
  }

  // ---- 第 4 期 ③：补充短语池（lexicon.poolEnabled / --pool 才读，默认路径逐字节不变）----
  const catById = new Map(cats.map(c => [c.id, c]));
  const poolRowStart = rows.length;
  let poolInfo = { enabled: false, file: poolPath(kbDir), count: 0 };
  if (opts.pool) {
    const pool = loadPool(kbDir);
    if (pool) {
      for (const r of pool.rows) {
        const tag = String(r && r.tag || '').trim();
        if (!tag) continue;
        const cat = catById.get(r.big) || {};
        // 与 search-index 行同形（多出来的第 13 个元素只是来源标记，读表的下标 0–11 不受影响）
        rows.push([tag, r.big || '', cat.order ?? 69, '', '', '', '', '待验证', r.sub || '', cat.name || '其他', '', 0, r.src || 'pool']);
      }
      poolInfo = { enabled: true, file: pool.file, count: rows.length - poolRowStart, builtAt: pool.doc.built_at, source: pool.doc.source };
    } else {
      poolInfo = { enabled: true, file: poolPath(kbDir), count: 0, missing: true };
    }
  }
  const poolIdx = new Set();
  for (let i = poolRowStart; i < rows.length; i++) poolIdx.add(i);

  const surfaces = new Map();     // key → { i, kind, score }
  const tokens = new Map();       // token → number[]
  const byTagKey = new Map();
  const entries = new Array(rows.length);

  let maxFreq = 1;

  const pushToken = (tok, i) => {
    if (!tok || tok.length < 1) return;
    let arr = tokens.get(tok);
    if (!arr) { arr = []; tokens.set(tok, arr); }
    if (arr[arr.length - 1] !== i) arr.push(i);
  };

  const addToken = (tok, i) => {
    pushToken(tok, i);
    // 英文词元额外建一份词根键：输入 "twintail" 也要能召回标签 twintails
    if (tok.length > 4 && tok[1] === ':') {
      const w = tok.slice(2);
      if (/^[a-z]+$/.test(w) && w.length >= 4) {
        const st = stemWord(w);
        if (st !== w) pushToken('w#' + st, i);
      }
    }
  };

  const addSurface = (text, i, kind, score) => {
    const k = keyOf(text);
    if (!k) return;
    // 单字只允许汉字（"坐" 是 sitting 的官方释义），英文单字碎片一律不收
    if (k.length < 2 && !/^[\u4e00-\u9fff]$/.test(k)) return;
    if (k.length > MAX_SURFACE_LEN) return;
    const prev = surfaces.get(k);
    // 同键冲突时保留分更高的（例如某标签名恰好等于另一条的中文释义）
    if (!prev || prev.score < score) surfaces.set(k, { i, kind, score });
  };

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const tag = r[0] || '';
    const big = r[1] || '';
    const zh = r[3] || '';
    const aliasRaw = r[4] || '';
    const freqStr = r[6] || '';
    const conf = r[7] || '中';
    const sub = r[8] || '';
    const bigName = r[9] || '';
    const slot = r[10] || '';
    const official = r[11] ? 1 : 0;
    // 第 13 个元素（下标 12）是来源标记：补充短语池写来源串，ANIMA3 合并行写 `anima3:mid|top|any`。
    // fields 只有 0–11，读表方（展板 / 本文件）都只读那几个下标，多出来的这个当**档位门**用：
    // 明确露骨的标签因此能在 safe 档被挡下、sensitive/nsfw 档照常出现，不需要动 TIER_GATE 词表。
    const srcMark = typeof r[12] === 'string' ? r[12] : '';
    const need = srcMark === 'anima3:mid' ? 'mid' : srcMark === 'anima3:top' ? 'top' : null;

    const zhCore = stripGloss(zh);
    const freqN = parseFreq(freqStr);
    if (freqN > maxFreq) maxFreq = freqN;

    // 分层：人数标签按小分类提到第 1 层，其余按大分类
    let layer = BIG_LAYER[big];
    if (layer === undefined) layer = 8;
    if (sub === COUNT_SUB) layer = 1;

    const aliasTokens = asciiTokens(aliasRaw);
    const aliasCjk = cjkRuns(aliasRaw);

    entries[i] = {
      i, tag, tagKey: keyOf(tag), big, bigName, sub, slot, zh, zhCore,
      aliasRaw, aliasTokens, aliasCjk,
      freqN, freqStr, conf, official, layer, need,
      pool: poolIdx.has(i),
      excluded: EXCLUDE_BIGS.has(big)
    };

    if (entries[i].excluded && big === 'cb:negative') entries[i].negative = true;

    // ---- 表面索引 ----
    addSurface(tag, i, 'tag', 1.0);
    if (zhCore) addSurface(zhCore, i, 'zh', 0.96);
    if (zh && zh !== zhCore) addSurface(zh, i, 'zh', 0.93);
    // 别名里的中文说法当成表面收（"看书 读书" → reading）；人物条目的别名是整套标签，跳过
    if (big !== 'cb:character' && aliasTokens.length <= 8) {
      for (const run of aliasCjk) {
        if (run.length >= 2 && run.length <= 6) addSurface(run, i, 'alias', 0.93);
      }
    }
    // 手工补充的常见说法（EXTRA_ZH）——只补确认存在于库里的标签
    const extra = EXTRA_ZH[tag];
    if (extra) for (const w of extra) addSurface(w, i, 'zh', 0.95);
    // 池条目排在最后，同键时不许顶掉主表条目
    if (entries[i].pool) { if (!byTagKey.has(entries[i].tagKey)) byTagKey.set(entries[i].tagKey, i); }
    else byTagKey.set(entries[i].tagKey, i);

    // ---- 词元索引 ----
    // 别名只有当它"短"（≤8 段）时才进索引：人物条目的别名其实是该角色的整套标签，
    // 一旦入索引，任何描述词都会把它们捞出来（实测会把「蓝发长发」匹配成东方角色）。
    const cleanAlias = aliasTokens.length <= 8 && big !== 'cb:character' && big !== 'cb:series';
    for (const w of asciiTokens(tag)) {
      if (w.length >= 2 || /[0-9]/.test(w)) addToken('w:' + w, i);
    }
    if (cleanAlias) {
      for (const w of aliasTokens) {
        if (w.length >= 3) addToken('w:' + w, i);
      }
    }
    for (const run of cjkRuns(zhCore + ' ' + zh)) {
      for (let p = 0; p < run.length; p++) {
        addToken('1:' + run[p], i);
        if (p + 1 < run.length) addToken('2:' + run.slice(p, p + 2), i);
      }
    }
    for (const run of aliasCjk) {
      for (let p = 0; p + 1 < run.length; p++) addToken('2:' + run.slice(p, p + 2), i);
    }
  }

  return {
    kbDir,
    entries,
    surfaces,
    tokens,
    byTagKey,
    maxFreq,
    maxSurfaceLen: MAX_SURFACE_LEN,
    maxCandidates: MAX_CANDIDATES,
    meta: meta,
    cats: cats,
    size: entries.length,
    /** 主表行数（不含短语池增量） */
    baseSize,
    /** 短语池状态：{ enabled, file, count, source?, builtAt?, missing? } */
    pool: poolInfo,
    /** 条目用于相似度比较的表面文本（标签、释义核心、别名片段） */
    surfaceTexts(e) {
      if (e._st) return e._st;
      const list = [e.tag];
      if (e.zhCore) list.push(e.zhCore);
      if (e.zh && e.zh !== e.zhCore) list.push(e.zh);
      // 别名片段（英文别名按 1–3 词窗口拼，中文别名整段）——只取前若干段，避免人物大段标签污染
      if (e.aliasTokens.length <= 8 && e.big !== 'cb:character' && e.big !== 'cb:series') {
        const words = e.aliasTokens.slice(0, 12);
        // 只收 2–3 词的窗口：单词窗口（"hair"、"long"）会把任何含这个字的描述拉高分；
        // 且窗口不能以虚词结尾（"sitting on" 是 on_floor / on_desk / seiza 共有的碎片，
        // 会让 "sitting on a chair" 同时命中一堆位置标签）
        for (let n = 3; n >= 2; n--) {
          for (let p = 0; p + n <= words.length; p++) {
            const seg = words.slice(p, p + n);
            // 虚词不能收尾（"sitting on"）；两词窗口也不许虚词开头（"at viewer"、"on chair"）
            if (FUNCTION_WORDS.has(seg[n - 1])) continue;
            if (n === 2 && FUNCTION_WORDS.has(seg[0])) continue;
            list.push(seg.join(' '));
          }
        }
        for (const run of e.aliasCjk.slice(0, 4)) list.push(run);
      }
      e._st = list;
      return list;
    },
    /** 表面文本的指纹缓存（相似度计算热点） */
    fpOf(text) {
      let f = FP_CACHE.get(text);
      if (!f) { f = fingerprint(text); FP_CACHE.set(text, f); }
      return f;
    }
  };
}

const FP_CACHE = new Map();
export const _fpCache = FP_CACHE;
