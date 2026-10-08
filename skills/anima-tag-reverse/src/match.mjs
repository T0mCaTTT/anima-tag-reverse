/**
 * match.mjs —— 第二步：标签匹配引擎
 *
 * 三条召回通道并行，再统一打分排序：
 *   A. 精确/强制  用户写死的标签（`backticks`、@画师、3girls）→ 直接命中
 *   B. 表面扫描  在「去空格去标点」的紧凑串上做最长匹配（中文/英文标签都能中）
 *   C. 词元召回  英文词元 + 汉字 2-gram 反查候选，再算综合相似度
 *
 * 打分 = 相似度 × (base + (1-base)×频次分) × 置信度系数 × 层提示加成
 * 频次用 log 刻度，避免 8.5M 的 1girl 压死所有冷门但精准的标签。
 */
import { keyOf, normalizeText, asciiTokens, dice, levenshtein, stemWord, cjkJaccard } from './normalize.mjs';
import { parsePhrase } from './parse.mjs';
import { SCORE, BROAD, STOP_WORDS, LAYER_NAME, SINGLE_CJK_OK, SINGLE_CJK_MIN_FREQ, SINGLE_CJK_BLOCK_2G } from './config.mjs';

/**
 * 「逐字命中」的 reason 前缀：强制精确、表面扫描、日文桥接、规则词条。
 * 这些候选是用户原话里真实出现的片段（或它的一对一桥接），保留时不受 perClause 名额限制。
 * 写成完整的候选式而不是字符类，避免「jp:xxx→yyy」这类含全角箭头的 reason 被正则漏掉。
 */
const LITERAL_RE = /^(surface:|forced:|jp:|rule:)/;

/** 调试开关：RTAG_DEBUG=1 时把候选表与压制后的得分打到 stderr（排查召回问题用，正常跑不输出） */
const DBG = !!process.env.RTAG_DEBUG;
const dbg = (...a) => { if (DBG) console.error('[rtag]', ...a); };

/** 相似度速算：直接用调用方给的紧凑串与指纹，省掉重复归一化 */
function simFast(aCompact, aFp, bText, lex) {
  const bKey = keyOf(bText);
  if (!bKey) return 0;
  if (aCompact === bKey) return 1;
  const bNorm = normalizeText(bText);
  // 候选词表保留单字母词（u.a._school_uniform 的 "u" 也是它的一部分，
  // 少算了就会让一堆 "xx school uniform" 变体拿到满分）
  const bRaw = asciiTokens(bNorm).filter(w => !STOP_WORDS.has(w));
  const bAll = asciiTokens(bNorm);
  const bWords = [...new Set(bRaw)];
  const aWords = [];
  for (const k of aFp) {
    if (k.charCodeAt(0) === 119 && k[1] === ':') {            // 'w:'
      const w = k.slice(2);
      if (w.length >= 2 || /[0-9]/.test(w)) aWords.push(w);
    }
  }
  // 两边都是英文词：按「词覆盖」算，比字符相似度靠谱得多
  // ——「long blue hair」应当命中 long hair 与 blue hair，但不该带上 light blue hair
  // 注意去重：别名里重复的词（"blue boots blue"）不能让覆盖率虚高
  const aWordSet = new Set(aWords);
  if (bWords.length && aWordSet.size && !/[\u3040-\u30ff\u4e00-\u9fff]/.test(aCompact)) {
    let hit = 0;
    for (const w of bWords) if (aWordSet.has(w)) hit++;
    if (bWords.length <= 1 && bAll.length > 1) {
      // 表面里夹了虚词（"on book" / "at viewer"）：只有整串逐字出现在用户输入里才算，
      // 否则「book」一个实词就能把 "on book" 顶到 0.7 以上
      if (!aCompact.includes(bKey)) return 0;
      return 0.85;
    }
    if (bWords.length === 1 && bAll.length === 1) {
      // 真正的单个英文词：只有完全一致才算（免得 footwear / eyes 互串），长度≥4 才给分
      if (hit === 1 && bWords[0].length >= 4) return 0.85;
      // 只差单复数/词尾：twintail ↔ twintails、eye ↔ eyes
      const bw = bWords[0];
      if (bw.length >= 4) {
        const st = stemWord(bw);
        if (st !== bw) for (const aw of aWordSet) {
          if (aw.length >= 4 && stemWord(aw) === st) return 0.8;
        }
      }
      return 0;
    }
    const covCand = hit / bWords.length;                       // 标签自己的词被说了多少
    const covClause = hit / aWordSet.size;                      // 用户说的词被标签覆盖多少
    let v = Math.pow(covCand, 2.2) * (0.7 + 0.3 * Math.min(1, covClause));
    // 拼写容错：只在「词都基本对上、只差一两个字符」时才用编辑距离兜底
    // —— 未命中的词两侧各最多一个，且这两个词本身要够像：
    //    "blu hair" → "blue hair"（blu↔blue 距离 1）放行；
    //    "red eyes" → "grey eyes"（red↔grey 距离 3）不放行
    if (hit >= 1 && Math.abs(aCompact.length - bKey.length) <= 3) {
      const freeA = [...aWordSet].filter(w => !bWords.includes(w));
      const freeB = bWords.filter(w => !aWordSet.has(w));
      // 未被命中的词要像「同一个词写短了」（blu ↔ blue），而不是两个真词（black ↔ blank）
      const okPair = !freeA.length || !freeB.length ||
        ((freeA[0].startsWith(freeB[0]) || freeB[0].startsWith(freeA[0])) &&
         Math.abs(freeA[0].length - freeB[0].length) <= 2);
      const okTypo = freeA.length <= 1 && freeB.length <= 1 && okPair;
      if (okTypo) {
        const dist = levenshtein(aCompact, bKey, 3);
        if (dist <= 2) {
          const l = Math.max(0, 1 - dist / (Math.max(aCompact.length, bKey.length) || 1)) * 0.98;
          if (l > v) v = l;
        }
      }
    }
    return Math.min(1, v);
  }
  let best = 0;
  if (aCompact.length >= 2 && bKey.length >= 2 && (aCompact.includes(bKey) || bKey.includes(aCompact))) {
    const short = Math.min(aCompact.length, bKey.length);
    const ratio = short / Math.max(aCompact.length, bKey.length);
    const asciiShort = /^[a-z]+$/.test(bKey.length <= aCompact.length ? bKey : aCompact);
    // 标签靠数字区分（6+boys / 2girls / 1girl）：用户没写数字就不算命中
    const extra = bKey.length > aCompact.length ? bKey.replace(aCompact, '') : '';
    const digitMismatch = /\d/.test(extra) && !/\d/.test(aCompact);
    // 英文碎片（"hair" 落在 "longbluehair" 里）不算真命中，要短键够长或占比够大
    if (!digitMismatch && (!asciiShort || short >= 6 || ratio >= 0.6)) best = 0.78 + 0.2 * ratio;
  }
  // 中文标签之间只认「包含」关系：双马尾 ≠ 高马尾/短马尾/宽马尾，
  // 白色连衣裙 ≠ 绿色连衣裙/棕色连衣裙 —— 修饰词（颜色/尺寸/方向）正是区分它们的那一个字，
  // 靠 dice 相似度必然虚高，所以这里直接判死。
  const cjkBoth = /[\u4e00-\u9fff]/.test(aCompact) && /[\u4e00-\u9fff]/.test(bKey);
  if (cjkBoth && Math.min(aCompact.length, bKey.length) >= 3 &&
      !aCompact.includes(bKey) && !bKey.includes(aCompact)) {
    // 例外：用字几乎一样、只是语序/搭配不同的中文说法（女高中生 ↔ 高中女生）。
    // 判据是汉字字集 Jaccard ≥ 0.8 且长度差 ≤ 1 —— 白色连衣裙 vs 绿色连衣裙 只有 0.67，照旧判死。
    const ja = cjkJaccard(aCompact, bKey);
    if (ja >= 0.8 && Math.abs(aCompact.length - bKey.length) <= 1) return 0.55 + ja * 0.31;
    return 0;
  }
  const bFp = lex.fpOf(bText);
  const d = dice(aFp, bFp);
  if (d > best) best = d * 0.97;
  if (Math.abs(aCompact.length - bKey.length) <= Math.max(2, Math.round(bKey.length * 0.34))) {
    // 编辑距离只用来兜「拼写/复数差异」（twintail / twintails、blu hair / blue hair），
    // 首字母就对不上的（long blue hair vs light blue hair）不能算相近
    let pre = 0;
    while (pre < aCompact.length && pre < bKey.length && aCompact[pre] === bKey[pre]) pre++;
    if (pre >= 3 || d >= 0.6) {
      const cap = Math.max(2, Math.ceil(Math.max(aCompact.length, bKey.length) * 0.6));
      const dist = levenshtein(aCompact, bKey, cap);
      const l = Math.max(0, 1 - dist / (Math.max(aCompact.length, bKey.length) || 1)) * 0.98;
      if (l > best) best = l;
    }
  }
  return Math.min(1, best);
}

/** 单字是否落在复合词护栏里（左邻 1 字 + 自身，或自身 + 右邻 1 字） */
function inBlocked2g(s, i) {
  if (!SINGLE_CJK_BLOCK_2G.length) return false;
  if (i > 0 && SINGLE_CJK_BLOCK_2G.includes(s.slice(i - 1, i + 1))) return true;
  return SINGLE_CJK_BLOCK_2G.includes(s.slice(i, i + 2));
}

/** 表面扫描：紧凑串上的最长匹配（返回 [{i,score,kind,span}]） */
function scanSurfaces(clause, lex) {
  const s = clause.compact;
  const out = [];
  if (!s) return out;
  const maxLen = Math.min(lex.maxSurfaceLen, s.length);
  let i = 0;
  while (i < s.length) {
    let hit = null;
    // 英文不能在词中间起头：否则 "twintail" 会从第 4 个字母起命中 tail，
    // "blu hair" 会从 hair 中间命中 air
    if (i > 0 && /[a-z0-9]/.test(s[i]) && /[a-z0-9]/.test(s[i - 1])) { i += 1; continue; }
    for (let len = Math.min(maxLen, s.length - i); len >= 1; len--) {
      const seg = s.slice(i, i + len);
      // 单字只认汉字：sitting 的官方释义就是一个「坐」字
      if (len === 1 && !/^[\u4e00-\u9fff]$/.test(seg)) continue;
      const v = lex.surfaces.get(seg);
      if (v) {
        // 单字命中只认「通用词」：不让「夜」命中 yoru (chainsaw man) 这类角色/作品
        if (len === 1) {
          const e = lex.entries[v.i];
          if (e && (e.big === 'cb:character' || e.big === 'cb:series')) { i += 1; continue; }
          // 单字很容易在更长的词里误命中（「女高中生」里的「高」→ gao）：
          // 只放行常见单字标签与明确的独立动作/季节词，其余交给多字表面命中
          if (e && !SINGLE_CJK_OK.has(seg) && e.freqN < SINGLE_CJK_MIN_FREQ) { i += 1; continue; }
          // 「角色」里的「角」→ horns 这类复合词虚命中，直接挡掉
          if (inBlocked2g(s, i)) { i += 1; continue; }
        }
        // 单字与两三字的英文碎片容易误命中，压一压
        const shortPenalty = len <= 3 && /^[a-z]+$/.test(seg) ? 0.88 : len === 1 ? 0.95 : 1;
        // canonical = 命中的那一串正好就是这个条目自己的标签键（用户说的就是它本名），
        // 而不是靠某个别名/子串凑上的。重叠加减时按这个优先，避免「on a chair」里的
        // 「on chair」压掉用户真正打的「chair」。
        const ent0 = lex.entries[v.i];
        const canon = !!ent0 && String(ent0.tagKey) === seg;
        hit = { i: v.i, score: v.score * shortPenalty, kind: v.kind, span: [i, i + len], text: seg, canon };
        break;
      }
    }
    if (hit) { out.push(hit); i = hit.span[1]; }
    else i += 1;
  }

  // 重叠命中收口：一个 span 包住另一个 span 时只留一个，优先「更长」，同长度优先 canonical
  for (let a = out.length - 2; a >= 0; a--) {
    const x = out[a];
    const y = out[a + 1];
    if (!y || y.span[0] >= x.span[1]) continue;
    const xLen = x.span[1] - x.span[0];
    const yLen = y.span[1] - y.span[0];
    let keep;
    if (xLen !== yLen) keep = xLen > yLen ? x : y;
    else keep = x.canon && !y.canon ? x : (!x.canon && y.canon ? y : x);
    if (keep === x) out.splice(a + 1, 1);
    else { out.splice(a, 1); }
  }
  return out;
}

/** 词元召回：英文词元 + 汉字 n-gram 反查候选条目 */
function recallTokens(clause, lex, budget = 3000) {
  const counts = new Map();
  const toks = [];
  for (const w of clause.ascii) {
    if (w.length >= 3 && !STOP_WORDS.has(w)) {
      toks.push('w:' + w);
      // 词根键：twintail 也要召回 twintails（标签侧的词根键是去掉复数后建的）
      if (/^[a-z]+$/.test(w) && w.length >= 4) {
        const st = stemWord(w);
        if (st.length >= 3) toks.push('w#' + st);
      }
    }
  }
  for (const run of clause.cjk) {
    if (run.length === 1) toks.push('1:' + run);
    for (let i = 0; i + 1 < run.length; i++) toks.push('2:' + run.slice(i, i + 2));
    if (run.length >= 3) toks.push('1:' + run[0], '1:' + run[run.length - 1]);
  }
  let seen = 0;
  for (const t of toks) {
    const arr = lex.tokens.get(t);
    if (!arr) continue;
    seen += arr.length;
    for (const i of arr) counts.set(i, (counts.get(i) || 0) + 1);
    if (seen > budget) break;
  }
  return counts;
}

/** 官方写法：空格代替下划线，只有 score_* 保留下划线 */
const dispTag = (t) => String(t).replace(/_/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * 频次分（log 刻度 0–1）。
 * 词库里有一批条目没有投稿量数据（freqN=0，约 12%，多为策展补录的官方标签）。
 * 早期实现让它们吃满 (1-base) 那一档惩罚，等于「没数据 = 最冷门」，
 * 结果「银发」「女孩」这类精确命中的标签会被 0.552 压到门槛边上，
 * 靠 layerHint 的加成碰巧活下来——「银发」活着、「女孩」掉了，完全看运气。
 * 现在按中位标签的频次给中性先验，无数据者只靠相似度与置信度说话。
 */
function freqScore(freqN, maxFreq) {
  if (!freqN) return SCORE.medianFs;
  return Math.log10(1 + freqN) / Math.log10(1 + maxFreq);
}

/**
 * 给一个分句算分
 * @returns {Array} 候选数组（未排序裁剪）
 */
function matchClause(clause, lex, opts = {}) {
  const B = opts.broad ? BROAD : null;
  const perClause = opts.perClause || (B ? B.topPerClause : SCORE.topPerClause);
  const minScore = opts.minScore ?? (B ? B.minScore : SCORE.minScore);
  const minSim = opts.minSim ?? (B ? B.minSim : SCORE.minSim);
  const cands = new Map();       // entryId → { sim, reason, forced }
  const clauseFp = lex.fpOf(clause.norm);
  const push = (i, sim, reason, forced = false, via = '') => {
    const prev = cands.get(i);
    if (!prev || prev.sim < sim || (forced && !prev.forced)) {
      cands.set(i, { sim, reason, forced, via: via || (prev && prev.via) || '' });
    } else if (via && !prev.via) {
      // A2 修复：分数更高的命中（尤其是 A 段 forced:tag 1.0）先落表并占着 via=''，
      // 后到的低分命中（surface:zh 等）只会走进这个 else，必须把它的 via 接管过来。
      //
      // 为什么非接管不可：下游三道压制都以 via（= 命中它的那段用户原话）为锚点 ——
      //   泛词压制（见下方 generic）先从「逐字命中」的候选里取 keyOf(s.via) 当泛词，
      //   一表一winner / 变体压制用 keyOf(s.via) 分组。
      // 而 forced 项被这三道压制豁免（它们自己就是用户原话里最硬的那个命中）。
      // forced 项一旦没有 via，泛词表就只剩英文键（`smile` 对中文原话「微笑」必然不中），
      // generic 直接为空 → 压制整体空转：`淡淡微笑 / 邪恶微笑 / 不安地微笑` 这些
      // sim 命中带着各自的中文表面（via）全部留下，「微笑」输出成 4 条变体。
      // 接管 via 之后 generic 里就有「微笑」，变体们的 via 包含它 → 分数砍半掉到门槛下。
      prev.via = via;
    }
  };

  // ---- A. 强制精确 ----
  for (const f of clause.forced) {
    const k = keyOf(f);
    if (!k) continue;
    const byTag = lex.byTagKey.get(k);
    if (byTag !== undefined) { push(byTag, 1.0, 'forced:tag', true); continue; }
    const bySurface = lex.surfaces.get(k);
    if (bySurface) push(bySurface.i, SCORE.exact[bySurface.kind] || 0.95, 'forced:' + bySurface.kind, true);
  }

  // ---- A2. 日文桥接 ----
  for (const jp of clause.jpTerms) {
    const zk = keyOf(jp.zh), ek = keyOf(jp.en);
    for (const k of [zk, ek]) {
      if (!k) continue;
      const byTag = lex.byTagKey.get(k);
      if (byTag !== undefined) { push(byTag, SCORE.exact.jp, 'jp:' + jp.jp, true); continue; }
      const s = lex.surfaces.get(k);
      if (s) push(s.i, Math.min(SCORE.exact.jp, s.score), 'jp:' + jp.jp + '→' + (k === zk ? jp.zh : jp.en), true);
    }
  }

  // ---- B. 表面扫描 ----
  for (const hit of scanSurfaces(clause, lex)) {
    push(hit.i, hit.score, 'surface:' + hit.kind, false, hit.text);
  }

  // ---- B2. 规则词条的补录与去冗余 ----
  // 规则词条排在表面扫描之后：候选表按 entryId 去重，谁先落谁定调，而词库自己的表面命中比规则拆分更可信。
  //
  // 去冗余（实测踩出来的两处回归）：
  //   ① 规则拆出来的组合若和已被更长标签完整包含，就不再补录；
  //      「白色连衣裙」拆出 dress，而 white dress 已经逐字命中，dress 属冗余，
  //      它会白占一个 perClause 名额，把真正命中的 silver hair 挤出去。
  //   ② 规则层早期用 pushForced 插进去的 garment 词条（forced:tag）同样要去冗余：
  //      同分句里已有更长的逐字命中标签、且那个标签的中文表面里完整包含这条词条的表面时，丢掉它。
  {
    const coreHit = new Set();
    const longKeys = [];
    const literals = [];
    for (const [i, c] of cands) {
      const e = lex.entries[i];
      const zk = keyOf(e.zhCore || e.zh || '');
      if (zk) coreHit.add(zk);
      const tk = keyOf(e.tag);
      if (c.sim >= 0.9 && tk.length >= 8) longKeys.push(tk);
      // 逐字命中（surface:* / forced:*）的条目留档，供去冗余比对；
      // 日文桥接（jp:*）用中文键建候选，不能参与去冗余——否则「夜」会被「夜晚」的
      // jp→zh 比对误判成冗余项直接摘掉（日文用例实测踩到）。
      if (/^(surface|forced):/.test(c.reason) && c.via) literals.push({ tk, zk, via: keyOf(c.via) });
    }
    const redundant = (k) =>
      longKeys.some(lk => lk !== k && lk.includes(k) && lk.length - k.length >= 3);
    dbg('rules', JSON.stringify({ literals: literals.map(l => l.zk), ruleTerms: (clause.ruleTerms || []).map(r => r.term) }));

    const ZK_RE = /[\u4e00-\u9fff\u3040-\u30ff]/;
    const absorbed = (term, zk) => {
      if (!zk || zk.length < 2 || !ZK_RE.test(zk)) return false;
      return literals.some(l => l.zk.length > zk.length && l.zk.includes(zk) && l.tk.length > term.length);
    };
    for (const rt of clause.ruleTerms || []) {
      const k = keyOf(rt.term);
      if (!k) continue;
      if (redundant(k)) { dbg('rule-skip redundant', k); continue; }
      const byTag = lex.byTagKey.get(k);
      const i = byTag !== undefined ? byTag : (lex.surfaces.get(k) || {}).i;
      if (i === undefined) continue;
      const prev = cands.get(i);
      if (prev && !prev.forced && prev.sim >= 0.9) continue;
      const e = lex.entries[i];
      const zk = keyOf(e.zhCore || e.zh || '');
      if (zk && coreHit.has(zk)) continue;
      if (absorbed(k, zk)) {
        // 冗余的早期 forced 词条直接摘掉，避免它继续占名额
        if (prev && prev.forced && /^forced:/.test(prev.reason)) cands.delete(i);
        continue;
      }
      push(i, 0.9, byTag !== undefined ? 'rule:tag' : 'rule:surface', true, rt.term);
    }
  }

  // ---- C. 词元召回 + 相似度 ----
  const counts = recallTokens(clause, lex, B ? B.candidateBudget : 3000);
  if (counts.size) {
    const ranked = [...counts.entries()]
      .sort((a, b) => (b[1] - a[1]) || (lex.entries[b[0]].freqN - lex.entries[a[0]].freqN))
      .slice(0, lex.maxCandidates);
    for (const [i] of ranked) {
      if (cands.get(i)?.forced) continue;
      const e = lex.entries[i];
      // 只比少量最有代表性的表面（标签 / 释义 / 干净的别名片段），控制耗时与噪声
      const surfaces = lex.surfaceTexts(e).slice(0, B ? B.surfaceTexts : 14);
      let best = 0;
      let hitSurface = '';
      for (const s of surfaces) {
        const v = simFast(clause.compact, clauseFp, s, lex);
        if (v > best) { best = v; hitSurface = s; }
        if (best === 1) break;
      }
      // 只收真的够像的：宁可少给，也别把 "blue eyes" 扯成 blue_footwear / blue_halo
      if (best >= minSim) push(i, best * SCORE.exact.phrase, 'sim', false, hitSurface);
    }
  }

  // ---- 打分 ----
  let scored = [];
  const maxFreq = lex.maxFreq || 1;
  dbg('cands', JSON.stringify([...cands].map(([i, c]) => `${lex.entries[i].tag}|${c.reason}|${c.via || '-'}${c.forced ? '|F' : ''}|${c.sim}`)));
  for (const [i, c] of cands) {
    const e = lex.entries[i];
    if (e.excluded && !c.forced) continue;
    const fs = freqScore(e.freqN, maxFreq);
    let score = c.sim * (SCORE.base + (1 - SCORE.base) * fs);
    score *= SCORE.conf[e.conf] || 1;
    if (clause.layerHint !== null && clause.layerHint !== undefined) {
      score *= (e.layer === clause.layerHint ? SCORE.hintBoost : SCORE.hintPenalty);
    }
    if (clause.intensity === 'up') score *= 1.04;
    if (clause.intensity === 'down') score *= 0.97;
    if (DBG) {
      const e2 = lex.entries[i];
      dbg('score', JSON.stringify({ tag: e2.tag, reason: c.reason, via: c.via || '', sim: c.sim, fs: Math.round(fs * 1000) / 1000, layer: e2.layer, hint: clause.layerHint, conf: e2.conf, score: Math.round(score * 1000) / 1000 }));
    }
    scored.push({
      i, tag: e.tag, zh: e.zh, zhCore: e.zhCore, big: e.big, bigName: e.bigName, sub: e.sub, slot: e.slot,
      layer: e.layer, layerName: LAYER_NAME[e.layer] || '其他',
      freqN: e.freqN, freqStr: e.freqStr, conf: e.conf, official: !!e.official,
      score: Math.round(Math.min(1, score) * 1000) / 1000,
      sim: Math.round(c.sim * 1000) / 1000,
      via: c.via, reason: c.reason, forced: !!c.forced
    });
  }

  scored.sort((a, b) => b.score - a.score || b.freqN - a.freqN);

  // ---- 泛词压制：用户话里已经逐字命中的通用标签，不该再带上围着它转的更具体的标签 ----
  // 「微笑」已经给了 smile，就别再给「邪恶微笑 / 淡淡微笑」；「school uniform」同理
  // 判定要以标签自身的英文键为准：词库的表面键有时是裸颜色（white / black），
  // 拿它当泛词会把 silver hair 按「whitedress 包含 white」这种歪理压掉——实测踩过。
  if (!opts.negMode) {
    const anchor = clause.compact || '';
    const generic = [];
    const genericSet = new Set();
    for (const s of scored) {
      // 泛词只从「用户的话里逐字命中」的候选来；弱相似命中的别名片段不算
      if (!/^(surface|forced)/.test(s.reason)) continue;
      for (const g of new Set([keyOf(s.tag), s.via ? keyOf(s.via) : ''])) {
        if (!g || genericSet.has(g)) continue;
        // 泛词必须真的出现在用户原话里：英文键查原话，中文/日文键查紧排串
        const inText = /[\u4e00-\u9fff\u3040-\u30ff]/.test(g) ? anchor.includes(g) : anchor.toLowerCase().includes(g);
        if (!inText) continue;
        genericSet.add(g);
        generic.push(g);
      }
    }
    dbg('generic', JSON.stringify(generic));
    // 规则/显式来源已经占住的标签：它们的词形不该再当「泛词」去压别的长标签。
    // 例：「白色连衣裙的银发女孩」里 dress 来自规则拆分（白+连衣裙），若它继续当泛词，
    // 就会把用户原话里真正命中的 silver hair 压到 0.48 以下丢掉——这是实测踩到的坑。
    const forcedKeys = new Set();
    for (const s of scored) {
      if (!s.forced) continue;
      forcedKeys.add(keyOf(s.tag));
      if (s.via) forcedKeys.add(keyOf(s.via));
    }
    if (generic.length) {
      let dropped = 0;
      for (const s of scored) {
        // 自己整条标签被逐字命中的，绝不能被泛词压（black_kimono 不该被 kimono 压掉）
        if (s.forced || /^(surface:tag|forced:tag)$/.test(s.reason)) continue;
        const vk = s.via ? keyOf(s.via) : '';
        if (!vk) continue;
        const tkeys = [keyOf(s.tag)];
        for (const fk of forcedKeys) if (fk.length >= 4 && vk.includes(fk)) tkeys.push(fk);
        let owner = '';
        for (const g of generic) {
          if (g === vk) continue;
          if (tkeys.includes(g)) continue;      // 这个词形已被规则/显式来源占用，不算泛词
          const minLen = /[\u4e00-\u9fff\u3040-\u30ff]/.test(g) ? 2 : 4;
          if (g.length >= minLen && vk.length > g.length && vk.includes(g)) { owner = g; break; }
        }
        if (owner) {
          s.score = Math.round(s.score * 0.5 * 1000) / 1000;
          s.genericOf = owner;
          if (s.score < minScore) { s.dropped = true; dropped++; }
        }
      }
      if (dropped) scored = scored.filter(s => !s.dropped);
      scored.sort((a, b) => b.score - a.score || b.freqN - a.freqN);
    }
  }
  // ---- 一表一winner：同一个表面（同一个中文释义/别名片段）只留分最高的那个 ----
  // "微笑" 只该给出 smile，不该把 light smile / evil smile / nervous smile 一起带出来
  // 中文侧的字典序也按同一个道理收口：用户说「坐」，"sitting" 与 "sitting on" 都是同一个
  // 中文核（zhCore）扩出来的变体，只该留最贴的那个——实测「女孩坐在椅子上看书」会把
  // sitting on 顶到 sitting 前面，把 user 真正说的「坐」挤掉。
  if (!opts.negMode) {
    const groups = new Map();
    for (const s of scored) {
      if (s.forced) continue;
      const gk = s.via ? keyOf(s.via) : keyOf(s.tag);
      if (!gk) continue;
      const arr = groups.get(gk);
      if (arr) arr.push(s); else groups.set(gk, [s]);
    }
    let dropped = 0;
    // 表面组：按 via 键分组的经典「一表一winner」，非 winner 降权，降到门槛下就丢
    const bySurface = new Map();
    for (const s of scored) {
      if (s.forced) continue;
      const gk = s.via ? keyOf(s.via) : keyOf(s.tag);
      if (!gk) continue;
      const arr = bySurface.get(gk);
      if (arr) arr.push(s); else bySurface.set(gk, [s]);
    }
    for (const arr of bySurface.values()) {
      if (arr.length < 2) continue;
      arr.sort((a, b) => b.score - a.score || a.tag.length - b.tag.length);
      for (let k = 1; k < arr.length; k++) {
        const s = arr[k];
        s.score = Math.round(s.score * 0.55 * 1000) / 1000;
        s.sameSurface = arr[0].tag;
        if (s.score < minScore) { s.dropped = true; dropped++; }
      }
    }
    if (dropped) scored = scored.filter(s => !s.dropped);
    scored.sort((a, b) => b.score - a.score || b.freqN - a.freqN);

    // 中文核组的收口：同一个中文核（zhCore）下并存的两条（「坐」→ sitting / sitting on）里，
    // 用户说的那个中文词只对应其中「更常被这么用」的那条。这里不罚落选者（会误伤），
    // 只把它从这一组的名额里摘掉；名额是否真被摘掉要看降权后是否够得到门槛。
    const byCore = new Map();
    for (const s of scored) {
      const zk = keyOf(s.zhCore || '');
      if (!zk || !/[\u4e00-\u9fff]/.test(zk)) continue;
      const arr = byCore.get(zk);
      if (arr) arr.push(s); else byCore.set(zk, [s]);
    }
    let coreDropped = 0;
    for (const [zk, arr] of byCore) {
      if (arr.length < 2) continue;
      const winner = arr.slice().sort((a, b) => (b.freqN - a.freqN) || (b.score - a.score))[0];
      for (const s of arr) {
        if (s === winner || s.forced) continue;
        s.score = Math.round(s.score * 0.55 * 1000) / 1000;
        s.sameCore = winner.tag;
        if (s.score < minScore) { s.dropped = true; coreDropped++; }
      }
      if (arr.length > 1 && (!winner.score || winner.score < minScore)) { /* 保底：winner 自己在后续门槛处理 */ }
      void zk;
    }
    if (coreDropped) scored = scored.filter(s => !s.dropped);
    scored.sort((a, b) => b.score - a.score || b.freqN - a.freqN);
  }
  // ---- 变体压制：靠「已被命中的通用标签」当别名命中的，多半是它的某个变体 ----
  // 例：nijigasaki_school_uniform 的别名开头就是 "school uniform"，
  //     用户只说 school uniform 时不该把一堆校服变体一起带出来
  const tagKeys = new Set();
  for (const s of scored) {
    const tk = keyOf(s.tag);
    if (s.reason === 'surface:tag' || s.reason === 'forced:tag' || (s.via && keyOf(s.via) === tk)) tagKeys.add(tk);
  }
  if (tagKeys.size) {
    for (const s of scored) {
      if (!s.via || s.forced) continue;
      const vk = keyOf(s.via);
      if (vk !== keyOf(s.tag) && tagKeys.has(vk)) {
        s.score = Math.round(s.score * 0.55 * 1000) / 1000;
        s.variantOf = s.via;
        s.dropped = s.score < minScore;      // 降权后够不到门槛的，直接不要
      }
    }
    scored = scored.filter(s => !s.dropped);
    scored.sort((a, b) => b.score - a.score || b.freqN - a.freqN);
  }
  // ---- 特异性压制：更长的标签命中时，把被它包住的更泛的标签降权（不删，只排到后面） ----
  // 负向模式不压制：用户说「不要眼镜」时要的是最泛的那个标签（glasses），不是「圆框眼镜」
  if (!opts.negMode) {
    for (const s of scored) {
      if (s.forced) continue;
      const k = keyOf(s.tag);
      for (const o of scored) {
        if (o === s || o.forced) continue;
        const ok = keyOf(o.tag);
        if (ok.length > k.length && ok.includes(k) && o.score >= s.score * 0.98) {
          s.implied = true;
          s.score = Math.round(s.score * 0.88 * 1000) / 1000;
          break;
        }
      }
    }
    scored.sort((a, b) => b.score - a.score || b.freqN - a.freqN);
  } else {
    // 负向：精确表面命中优先，其次分数，再其次标签越短越泛
    scored.sort((a, b) => {
      const ea = a.reason.startsWith('surface') || a.reason.startsWith('forced') ? 1 : 0;
      const eb = b.reason.startsWith('surface') || b.reason.startsWith('forced') ? 1 : 0;
      if (ea !== eb) return eb - ea;
      if (Math.abs(b.score - a.score) > 0.08) return b.score - a.score;
      const la = keyOf(a.tag).length, lb = keyOf(b.tag).length;
      if (la !== lb) return la - lb;
      return b.freqN - a.freqN;
    });
  }
  // ---- 单字去噪：靠单个汉字命中的候选，若该位置已被同分句里更长的中文词覆盖，就丢掉 ----
  // 「高潮」已经给出 orgasm，不该再让单字表面「高」带出 gao；「坐在」里的「坐」没有被更长的词覆盖，照旧保留
  {
    const CJK = /[\u4e00-\u9fff]/;
    const covered = (text, ch, idx) => {
      for (const s of scored) {
        if (s.forced) continue;
        const z = String(s.zhCore || s.zh || '').trim();
        if (z.length < 2 || !CJK.test(z) || !z.includes(ch)) continue;
        let p = text.indexOf(z);
        while (p >= 0) {
          if (p <= idx && idx < p + z.length) return z;
          p = text.indexOf(z, p + 1);
        }
      }
      return '';
    };
    let dropped = 0;
    for (const s of scored) {
      if (s.forced) continue;
      const v = s.via || '';
      if (v.length !== 1 || !CJK.test(v)) continue;
      const idx = clause.compact.indexOf(v);
      if (idx < 0) continue;
      const by = covered(clause.compact, v, idx);
      if (by) { s.dropped = true; s.charCoveredBy = by; dropped++; }
    }
    if (dropped) {
      scored = scored.filter(s => !s.dropped);
      scored.sort((a, b) => b.score - a.score || b.freqN - a.freqN);
    }
  }

  
  // 逐字命中（surface / forced / jp 桥接 / rule 规则词条）是用户原话的直接映射，保证进结果：
  // 规则层与召回层很容易在一个分句里凑出好几条高分标签，把 perClause 名额占满，
  // 于是「银发」这种明明逐字命中的词反而被切掉（回归用例「樱花树下的白裙」的失败原因）。
  // 注意正则必须写全，`^(surface|forced):` 在「jp:長髪→长发」上会因为字符类里多了个
  // 全角箭头而匹配失败，把日文命中误判成弱命中、再被弱命中配额砍掉（日文用例实测踩到）。
  const kept = [];
  const seen = new Set();
  let weakKept = 0;
  for (const s of scored) {
    if (!(s.score >= minScore || s.forced)) continue;      // 门槛：原本就够不到的不留
    const literal = LITERAL_RE.test(s.reason);
    if (opts.pool) opts.pool.push(s);                      // 备选池：够分但可能被名额挤掉的都在这里
    if (!literal) {
      if (weakKept >= perClause) continue;                 // 弱相似命中仍受每分句条数限制
      weakKept++;
    }
    if (seen.has(s.tag)) continue;
    seen.add(s.tag);
    kept.push(s);
  }
  dbg('kept', JSON.stringify(kept.map(s => `${s.tag}:${s.score}`)));
  return kept;
}

/**
 * 匹配整个计划（parseText 的输出）
 * @param {object} plan parseText / parseImageSpec 的结果
 * @param {object} lex  buildLexicon 的结果
 * @param {object} opts { top, minScore, perClause, broad, alternatives }
 */
export function matchPlan(plan, lex, opts = {}) {
  const top = opts.top || 60;
  const groups = [];
  const flat = new Map();     // tag → match（跨分句去重，留最高分）

  plan.clauses.forEach((clause, ci) => {
    const pool = opts.alternatives ? [] : null;
    const list = matchClause(clause, lex, pool ? { ...opts, pool } : opts);
    if (DBG) console.log('[rtag] clause', ci, 'norm', JSON.stringify(clause.norm), 'forced', JSON.stringify(clause.forced || []), '→', JSON.stringify(list.map(m => m.tag)));
    groups.push({ clause: clause.norm || clause.text, layerHint: clause.layerHint, matches: list, pool });
    for (const m of list) {
      const prev = flat.get(m.tag);
      if (!prev) flat.set(m.tag, { ...m, clauses: [ci] });
      else {
        prev.clauses.push(ci);
        if (m.score > prev.score) { const cs = prev.clauses; flat.set(m.tag, { ...m, clauses: cs }); }
      }
    }
  });

  // 全局排序：先按分数，再按层（官方顺序越靠前越优先），最后按频次
  const all = [...flat.values()].sort(
    (a, b) => b.score - a.score || a.layer - b.layer || b.freqN - a.freqN
  );

  // 备选池：按层归拢本分句里所有够分的候选（含被 perClause 名额挤掉的），
  // 供补全清单（gaps）在同层里挑替代项。只在需要时算，免得默认路径多花时间。
  let alternatives = null;
  if (opts.alternatives) {
    const cap = opts.broad ? BROAD.altPerLayer : 6;
    const totalCap = opts.broad ? BROAD.altTotal : 24;
    const perLayer = new Map();
    const pushAlt = (key, s) => {
      const arr = perLayer.get(key) || [];
      arr.push(s);
      perLayer.set(key, arr);
    };
    for (const m of all) pushAlt(m.layer, m);     // 先放进已命中的，保证备选池里一定有它们
    for (const g of groups) {
      for (const s of g.pool || g.matches) pushAlt(s.layer, s);   // pool 含被名额挤掉的落选候选
    }
    alternatives = [];
    for (const [layer, arr] of [...perLayer.entries()].sort((a, b) => a[0] - b[0])) {
      const seenTag = new Set();
      const uniq = [];
      for (const s of arr) {
        if (seenTag.has(s.tag)) continue;
        seenTag.add(s.tag);
        uniq.push(s);
        if (uniq.length >= cap) break;
      }
      for (const s of uniq) {
        if (alternatives.length >= totalCap) break;
        alternatives.push({
          tag: s.tag, display: dispTag(s.tag), zh: s.zh, layer, layerName: LAYER_NAME[layer] || '其他',
          score: s.score, reason: s.reason, big: s.big, sub: s.sub, freqStr: s.freqStr
        });
      }
    }
  }

  return { groups, matches: all.slice(0, top), total: all.length, alternatives };
}

/** 单条短语直接检索（API/CLI 用），返回按分排序的条目 */
export function search(lex, text, opts = {}) {
  const clause = parsePhrase(text);                 // 复用解析器：中文/英文/日文都走同一条路
  if (opts.layerHint !== undefined && opts.layerHint !== null) clause.layerHint = opts.layerHint;
  return matchClause(clause, lex, { perClause: opts.limit || 10, ...opts });
}

export const _internal = { matchClause, scanSurfaces, recallTokens, simFast };
