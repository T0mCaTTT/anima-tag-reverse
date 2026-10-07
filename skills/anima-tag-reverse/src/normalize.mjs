/**
 * normalize.mjs —— 文本归一化与相似度工具（零依赖）
 *
 * 归一化统一三件事，后面所有匹配都建立在它上面：
 *   1. 全角 → 半角、去零宽字符、大小写折叠
 *   2. 下划线 → 空格（本库标签两种写法混用：white_thighhighs / white thighhighs）
 *   3. 中文与英文各自的切分：英文按词，中文/日文按 1-gram + 2-gram
 */

/** 全角字符（U+FF01–U+FF5E）转半角，并处理常见排版符号 */
export function normalizeText(input) {
  if (!input) return '';
  let s = String(input).normalize('NFKC');
  s = s.replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  s = s.replace(/[\u200B-\u200D\uFEFF]/g, '');
  s = s.replace(/[_\-–—]+/g, ' ');           // 下划线与各种破折号统一成空格
  s = s.replace(/[’‘`´]/g, "'");
  s = s.replace(/[“”]/g, '"');
  s = s.toLowerCase();
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/** 只用于「表面形式」的键：去空格、去标点，方便精确命中 */
export function keyOf(s) {
  return normalizeText(s).replace(/[^0-9a-z\u3040-\u30ff\u4e00-\u9fff@()]/g, '');
}

/** 去掉中文释义里的补充说明——画师释义常写成「大理由（清晰线条＋通透上色，通用安全牌）」 */
export function stripGloss(zh) {
  if (!zh) return '';
  let s = String(zh)
    .replace(/[（(][^（()）]{0,80}[)）]/g, ' ')
    .replace(/[【\[][^【\[\]】]{0,80}[】\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // 官方分组的条目释义常被写成「服装：glasses」「作品：xxx」——前缀是分组名噪音，去掉
  const m = s.match(/^[^：:]{1,8}[：:]\s*(.+)$/);
  if (m && /^[0-9a-z@][0-9a-z@ _'()-]*$/i.test(m[1].trim())) s = m[1].trim();
  return s;
}

const ASCII_WORD = /[0-9a-z@]+(?:'[0-9a-z]+)?/g;
const CJK_RUN = /[\u3040-\u30ff\u4e00-\u9fff]+/g;

/** 英文/数字词元（已归一化的小写串） */
export function asciiTokens(s) {
  return (normalizeText(s).match(ASCII_WORD) || []);
}

/** 中日文连续段 */
export function cjkRuns(s) {
  return (normalizeText(s).match(CJK_RUN) || []);
}

/**
 * 字符集合指纹：CJK 用 1-gram + 2-gram（短词靠 1-gram，长词靠 2-gram），
 * 英文用词元。返回 Set，配合 dice() 使用。
 */
export function fingerprint(s) {
  const out = new Set();
  const t = normalizeText(s);
  for (const w of t.match(ASCII_WORD) || []) {
    if (w.length > 1 || /[0-9]/.test(w)) out.add('w:' + w);
  }
  for (const run of t.match(CJK_RUN) || []) {
    for (let i = 0; i < run.length; i++) {
      out.add('1:' + run[i]);
      if (i + 1 < run.length) out.add('2:' + run.slice(i, i + 2));
    }
  }
  // 含空格的英文短语也进一个整体指纹，避免 "blue eyes" 被拆成两个词后到处命中
  const phrase = t.replace(/\s+/g, ' ').trim();
  if (/^[0-9a-z@' ]{3,}$/.test(phrase)) out.add('p:' + phrase);
  return out;
}

/** Dice 系数：2|A∩B| / (|A|+|B|)，对长度差异天然惩罚 */
export function dice(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of small) if (big.has(x)) inter++;
  return (2 * inter) / (a.size + b.size);
}

/** 编辑距离（带上限剪枝，超限直接返回上限） */
export function levenshtein(a, b, cap = 64) {
  if (a === b) return 0;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > cap) return cap;
  let prev = new Array(lb + 1);
  let cur = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    let best = cur[0];
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < best) best = cur[j];
    }
    if (best >= cap) return cap;
    [prev, cur] = [cur, prev];
  }
  return prev[lb];
}

/** 归一化编辑距离相似度（0–1） */
export function levSim(a, b) {
  const cap = Math.max(2, Math.ceil(Math.max(a.length, b.length) * 0.6));
  const d = levenshtein(a, b, cap);
  const m = Math.max(a.length, b.length) || 1;
  return Math.max(0, 1 - d / m);
}

/**
 * 综合相似度：谁高取谁（子串关系、字符集 Dice、编辑距离）。
 * 打错字（"masterpice"）靠编辑距离，语序不同（"双马尾的蓝发少女" vs "蓝发 双马尾"）靠 Dice。
 */
export function similarity(a, b) {
  const x = normalizeText(a), y = normalizeText(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const kx = keyOf(x), ky = keyOf(y);
  if (kx && kx === ky) return 1;
  let best = 0;
  if (kx.length >= 2 && ky.length >= 2 && (kx.includes(ky) || ky.includes(kx))) {
    // 子串关系：短的是长的多少——太短（1 个字）容易误命中，按长度压一压
    const ratio = Math.min(kx.length, ky.length) / Math.max(kx.length, ky.length);
    best = 0.78 + 0.2 * ratio;
  }
  const d = dice(fingerprint(x), fingerprint(y));
  if (d > best) best = d * 0.97;
  if (Math.abs(x.length - y.length) <= Math.max(2, Math.round(y.length * 0.34))) {
    const l = levSim(kx, ky);
    if (l > best) best = l * 0.98;
  }
  return Math.min(1, best);
}

/** 投稿量字符串（"8.5M" / "708.2k" / "1.2k" / ""）→ 数字 */
// 单复数/词尾规约：只用于「同词根」判定（twintail ↔ twintails、eye ↔ eyes）
// 不改动标签本身，只在索引与召回时多建一份 stem 键
export function stemWord(w) {
  const s = String(w || '').toLowerCase();
  if (s.length < 4) return s;
  if (/ies$/.test(s)) return s.slice(0, -3) + 'y';
  if (/(ss|sh|ch|x|z)es$/.test(s)) return s.slice(0, -2);
  if (/s$/.test(s)) return s.slice(0, -1);
  return s;
}

/**
 * 汉字字集 Jaccard（忽略非汉字）。
 * 用来兜「用字几乎一样、只是语序不同」的中文说法：女高中生 ↔ 高中女生（=1.0）；
 * 白色连衣裙 ↔ 绿色连衣裙 只差一个颜色字（≈0.67），会被门槛挡在门外。
 */
export function cjkJaccard(a, b) {
  const setOf = s => {
    const m = new Set();
    for (const ch of String(s || '')) if (ch >= '\u4e00' && ch <= '\u9fff') m.add(ch);
    return m;
  };
  const A = setOf(a), B = setOf(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const c of A) if (B.has(c)) inter++;
  return inter / (A.size + B.size - inter);
}

export function parseFreq(s) {
  if (!s) return 0;
  const m = String(s).trim().match(/^([\d.]+)\s*([kKmM]?)/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  if (!isFinite(n)) return 0;
  const unit = (m[2] || '').toLowerCase();
  return Math.round(n * (unit === 'k' ? 1e3 : unit === 'm' ? 1e6 : 1));
}

/** tag 是不是「画师标签」（本库约定：@ 前缀） */
export function isArtistTag(tag) {
  return typeof tag === 'string' && tag.trim().startsWith('@');
}
