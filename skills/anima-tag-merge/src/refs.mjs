/**
 * refs.mjs —— 「图1 / 图2 / 图3 / 前面那张 / 左边 / 原图」这类指代的解析
 *
 * 规则只有一条：**把用户嘴里的说法映射成图的编号（1..MAX_IMAGES）**。
 *   1 = 先给的那张（图1、第一张、上图、左图、原图、底图）
 *   N = 最后一张（后一张、下图、右图、参考图、素材图）—— 两张图时 N=2
 *   中间编号只认显式写法（图3 / 第三张 / 图C）
 *
 * 为什么要单独一个文件：
 *   - 指代识别必须**先于**维度识别跑，因为「图2的**人**」里的「人」是宿主证据而不是
 *     subject 维度词，必须在维度匹配前把这段区间占掉（否则人数会被错误换源）。
 *   - 「原图 / 底图 / 参考图」这类**角色化指代**与序数指代方向常常相反
 *     （参考图通常是提供风格的那张），所以单独标 kind，供 intent.mjs 加权/提示。
 *   - `--swap` 的语义是「口头顺序与文件顺序相反」，所以在 N 张图时是**整体反转**
 *     （口头的第 k 张 = 文件里的第 N+1-k 张），不是只对调前两张。
 */

export const MAX_IMAGES = 6;

/** 中文数字 / 全角数字 → 阿拉伯数字 */
const NUM_MAP = {
  '1': 1, '一': 1, '１': 1, '2': 2, '二': 2, '两': 2, '２': 2,
  '3': 3, '三': 3, '３': 3, '4': 4, '四': 4, '４': 4,
  '5': 5, '五': 5, '５': 5, '6': 6, '六': 6, '６': 6
};
const NUM_RE = '[1-6１-６一二两三四五六]';
const LETTER_MAP = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 };

/**
 * 指代模式表。kind 决定后续怎么解读：
 *   ordinal 序数 / name 直接命名 / role 角色化 / edge 前后上下左右（末尾 = 最后一张）
 * `pick` 返回 1..6 的数字，或字符串 'last'（由调用方按图片总数换算）。
 */
const REF_PATTERNS = [
  // ---- 直接命名：图A / 图片C ----
  { re: /(?:图|图片)\s*([A-Fa-f])(?![\w])/g, kind: 'name', pick: m => LETTER_MAP[m[1].toLowerCase()] },
  // ---- 「第 N 张 / 第 N 幅」 ----
  { re: new RegExp(`第\\s*(${NUM_RE})\\s*(?:张|幅|个)(?:图|画|片)?`, 'g'), kind: 'ordinal', pick: m => NUM_MAP[m[1]] },
  // ---- 「图 N / 图片 N」 ----
  { re: new RegExp(`(?:图|图片)\\s*(${NUM_RE})`, 'g'), kind: 'ordinal', pick: m => NUM_MAP[m[1]] },
  // ---- 前 / 后 ----
  { re: /(?:前|后)\s*(?:面|边)?\s*(?:那)?\s*(?:一)?\s*(?:张|幅)\s*(?:图|画|片)?/g, kind: 'edge', pick: m => (m[0].startsWith('前') ? 1 : 'last') },
  // ---- 上 / 下 ----
  { re: /(?:上|下)\s*(?:面|边)?\s*(?:那)?\s*(?:一)?\s*(?:张|幅)?\s*(?:图|画|片)/g, kind: 'edge', pick: m => (m[0].startsWith('上') ? 1 : 'last') },
  // ---- 左 / 右 ----
  { re: /(?:左|右)\s*(?:边|面)?\s*(?:那)?\s*(?:一)?\s*(?:张|幅)?\s*(?:图|画|片)/g, kind: 'edge', pick: m => (m[0].startsWith('左') ? 1 : 'last') },
  // ---- 角色化：提供画面的底子 ----
  { re: /(?:原图|底图|基础图|主图|本体图)/g, kind: 'role', pick: () => 1 },
  // ---- 角色化：提供素材 / 参考 ----
  { re: /(?:参考图|素材图|来源图|借鉴图|样例图)/g, kind: 'role', pick: () => 'last' },
  // ---- 英文 ----
  { re: /\b(?:the\s+)?first\s+(?:image|picture|one)\b/gi, kind: 'ordinal', pick: () => 1 },
  { re: /\b(?:the\s+)?second\s+(?:image|picture|one)\b/gi, kind: 'ordinal', pick: () => 2 },
  { re: /\b(?:the\s+)?third\s+(?:image|picture|one)\b/gi, kind: 'ordinal', pick: () => 3 },
  { re: /\bimage\s*([A-F])\b/gi, kind: 'name', pick: m => LETTER_MAP[m[1].toLowerCase()] }
];

/** 编号 → 实际下标，处理 'last' 与 --swap */
function toIndex(picked, { count = 2, swap = false } = {}) {
  let n = picked === 'last' ? count : picked;
  if (!Number.isInteger(n) || n < 1) return null;
  n = Math.min(n, count);
  if (swap) n = count + 1 - n;      // 整体反转：口头的第 k 张 = 文件里的第 N+1-k 张
  return n;
}

/**
 * 找文本里的所有图指代。
 * @param {string} text
 * @param {{swap?: boolean, count?: number}} opts count = 图片总数（决定「后一张/参考图」指向谁）
 * @returns {Array<{side:number, raw:string, kind:string, start:number, end:number}>} side 是 1..N 的编号
 */
export function findRefs(text, opts = {}) {
  const src = String(text || '');
  const count = Math.max(1, Math.min(MAX_IMAGES, opts.count || 2));
  const taken = [];
  const hits = [];
  for (const p of REF_PATTERNS) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(src)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (taken.some(([s, e]) => start < e && s < end)) continue;   // 区间独占，长的先扫到
      const picked = p.pick(m);
      if (picked === undefined || picked === null || picked === '') continue;
      const side = toIndex(picked, { count, swap: opts.swap });
      if (side === null) continue;
      taken.push([start, end]);
      hits.push({ side, raw: m[0], kind: p.kind, start, end });
    }
  }
  return hits.sort((x, y) => x.start - y.start);
}

/**
 * 宿主（base / 被修改的那一方）证据。
 * 这几类说法都说明「这个图是底子，别的图往上套」：
 *   1. `放到/换到/套到/移到/转到/加到/用在 + 图N (+上/身上)`  —— 最强
 *   2. `图N的人 / 人物 / 主体 / 角色 / 身上 / 身体`        —— 强
 *   3. `以图N为基础 / 底子 / 主体 / 打底`                  —— 最强
 * 命中的区间会被 intent.mjs 从「维度词」和「未匹配片段」里排除。
 */
const BASE_PATTERNS = [
  { re: new RegExp(`(?:放到|换到|套到|移到|转到|加到|贴在|用在|装到|安到|放上|丢到|扔到|换给|套给|加给|接到)\\s*(?:图|图片)?\\s*(${NUM_RE}|[A-Fa-f])(?:\\s*(?:上|身上|上面|里|中))?`, 'g'), weight: 3 },
  { re: new RegExp(`以\\s*(?:图|图片)?\\s*(${NUM_RE}|[A-Fa-f])\\s*(?:为|做|作)\\s*(?:基础|底|底子|主体|主|骨架|基准|蓝本)`, 'g'), weight: 4 },
  // 「底图是图1 / 主体用图2」——显式点名的宿主，权重最高
  { re: new RegExp(`(?:底图|宿主|主体|基准|基础|打底|底板)\\s*(?:是|用|取|为|选|按)\\s*(?:图|图片)?\\s*(${NUM_RE}|[A-Fa-f])`, 'g'), weight: 4 },
  { re: new RegExp(`(?:图|图片)\\s*(${NUM_RE}|[A-Fa-f])\\s*(?:的)?\\s*(?:人|人物|主体|角色|主角|身上|身体|人物形象)`, 'g'), weight: 2 },
  // 「替换成图2上 / 移到图2里」这类没有动词的落点说法（弱证据，只在没说别的时生效）
  { re: new RegExp(`(?:图|图片)\\s*(${NUM_RE}|[A-Fa-f])\\s*(?:上|身上|上面|里|中)(?![\\u4e00-\\u9fa5])`, 'g'), weight: 2 },
  { re: new RegExp(`(?:图|图片)\\s*(${NUM_RE}|[A-Fa-f])\\s*(?:保持|不变|不动|原样|维持|照旧)`, 'g'), weight: 3 },
  { re: new RegExp(`(?:主体|主角|人物)\\s*(?:用|是|取)\\s*(?:图|图片)?\\s*(${NUM_RE}|[A-Fa-f])`, 'g'), weight: 3 }
];

/** 单个 token（数字 / 中文数字 / 字母 / 'last'）→ 编号 */
function tokenToIndex(token, opts = {}) {
  const t = String(token).toLowerCase();
  if (t === 'last') return toIndex('last', opts);
  if (LETTER_MAP[t]) return toIndex(LETTER_MAP[t], opts);
  const n = NUM_MAP[String(token).trim()];
  return n ? toIndex(n, opts) : null;
}

/**
 * 找宿主证据。
 * @returns {Array<{side:number, raw:string, weight:number, start:number, end:number}>}
 */
export function findBaseEvidence(text, opts = {}) {
  const src = String(text || '');
  const hits = [];
  for (const p of BASE_PATTERNS) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(src)) !== null) {
      const side = tokenToIndex(m[1], opts);
      if (side === null) continue;
      hits.push({ side, raw: m[0], weight: p.weight, start: m.index, end: m.index + m[0].length });
    }
  }
  return hits.sort((x, y) => x.start - y.start);
}

/** 按分数定宿主：权重高者胜；同分取**后出现**的（中文里「放到图2上」是句末落点） */
export function pickBase(evidence) {
  if (!evidence || !evidence.length) return null;
  let best = null;
  for (const e of evidence) {
    if (!best) { best = e; continue; }
    if (e.weight > best.weight || (e.weight === best.weight && e.start >= best.start)) best = e;
  }
  return best;
}

export { NUM_RE, NUM_MAP, LETTER_MAP, toIndex };
