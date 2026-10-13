/**
 * normalize.mjs —— 名称归一化（Danbooru tag ↔ 中文名 ↔ 人话）
 *
 * 这一层解决的是「同一个东西的十种写法」，是本技能准确率的地基：
 *   下划线 ↔ 空格            hakurei_reimu / hakurei reimu
 *   全角括号 ↔ 半角括号      （原神） / (原神)
 *   大小写                    Klee / klee
 *   书名号/引号/空白          《原神》/『原神』/ 原神
 *   尾部形态括号             klee (genshin impact) → 主名 klee + 括号 genshin impact
 *
 * 约定：**所有比较都在 normalizeName 之后进行**，输出时再按 Anima 规范还原
 * （空格代替下划线，括号原样保留不加转义）。
 */

/** 全角 → 半角（只处理名称里常见的几种，避免过度处理） */
function toHalfWidth(s) {
  return String(s)
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/[［【]/g, '(')
    .replace(/[］】]/g, ')')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"');
}

/** 去掉装饰性引号/书名号（中文用户习惯写《原神》） */
const trimDecor = s => String(s).replace(/^[《〈「『\[【]+/, '').replace(/[》〉」』\]】]+$/, '');

/**
 * 归一化名称，用于比较。**不改变括号语义**（括号保留，因为 `klee (genshin impact)` 里它有意义）。
 * @param {string} s
 * @returns {string}
 */
export function normalizeName(s) {
  let t = toHalfWidth(s == null ? '' : String(s));
  t = trimDecor(t.trim());
  t = t.replace(/[_\-–—]+/g, ' ');          // 下划线/连字符 → 空格
  t = t.replace(/\s+/g, ' ');
  t = t.replace(/\s*\(\s*/g, ' (').replace(/\s*\)\s*/g, ')');   // 括号前后留规范空格
  return t.trim().toLowerCase();
}

/** 归一化后作为 Map 键使用 */
export const keyOf = normalizeName;

/**
 * 拆出尾部的形态/作品括号。
 *   `klee (genshin impact)` → { base:'klee', paren:'genshin impact' }
 *   `hakurei reimu`         → { base:'hakurei reimu', paren:null }
 * 只认**末尾**那个括号（中间括号另有含义，如 `fate (series)` 是作品名本身，走 base）。
 */
export function splitParen(name) {
  const n = normalizeName(name);
  const m = n.match(/^(.*?)\s*\(([^()]*)\)$/);
  if (!m) return { base: n, paren: null };
  return { base: m[1].trim(), paren: m[2].trim() };
}

/** 该名称是否带尾部括号（用于判断「是不是异体/形态标签」） */
export const hasTailParen = name => splitParen(name).paren !== null;

/**
 * 按 Anima 规范还原成可交付的 tag：
 *   - 空格代替下划线（`score_*` 例外，本技能不产出这类）；括号原样保留、不加反斜杠转义
 */
export function toTag(name) {
  const t = normalizeName(name);
  return t.replace(/(?<!^)\bscore_(\d)/g, 'score_$1').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

/** 频次字符串 → 数字（词库里是 '8.5M' / '318.9k' 这种） */
export function parseFreq(v) {
  if (typeof v === 'number') return v;
  const s = String(v == null ? '' : v).trim().toLowerCase().replace(/,/g, '');
  const m = s.match(/^([\d.]+)\s*([kmb]?)/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return 0;
  const mul = { '': 1, k: 1e3, m: 1e6, b: 1e9 }[m[2]] || 1;
  return Math.round(n * mul);
}
