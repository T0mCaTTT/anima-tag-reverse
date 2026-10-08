/**
 * parse.mjs —— 第一步：输入解析
 *
 * 把「人话」拆成可逐条打分的分句，并抽掉会干扰匹配的噪音：
 *   1. 归一化（全角→半角、去下划线、大小写、去零宽）
 *   2. 分句：逗号/顿号/分号/换行/「」等都算分隔
 *   3. 否定识别：本分句是否带「不要/没有/去掉/排除/no/without…」
 *   4. 强度识别：少し/とても/very/强烈 → 给权重提示用
 *   5. 层提示：正则判断这条大概属于哪一层（画师/构图/服装…）
 *   6. 日文桥接：用 jp-lexicon 把日文词翻成中文/英文表面
 *   7. 直接引用：反引号/引号里的内容、@画师、3girls 这类具体标签 → 强制精确命中
 */
import { normalizeText, keyOf, asciiTokens, cjkRuns } from './normalize.mjs';
import { buildJpTable } from './jp-lexicon.mjs';
import { SPLIT_RE, NEG_RE, INTENSITY, HINT_RULES, STOP_WORDS } from './config.mjs';
import { COUNT_GROUPS, GENDER_WORDS, CJK_DECOMPOSE, SHORT_ALIASES, ruleSurfaces, numeralToNumber } from './hints.mjs';

const JP = buildJpTable();

/** 引号里的内容 —— 用户明说要这个标签 */
const QUOTED_RE = /[`「『"'“”]([^`「』"'“”]{2,40})[`「』"'“”]/g;

/**
 * 人数：数字写法（1girl / 2 girls）+ 中文写法（三人）。
 * 中文口语的「两个人 / 一男一女 / 两个少女」走 hints.mjs 的 COUNT_GROUPS 表，
 * 这里只负责把「N 个 X」「N girls」「N 人」这类规律写法直接算出来。
 */
const COUNT_RE = /(\d+)\s*(girls?|boys?|人|个)|(ひとり|ふたり|さんにん|一人|二人|三人)/gi;
const CN_NUM = { 一人: '1girl', ひとり: '1girl', 二人: '2girls', ふたり: '2girls', 三人: '3girls', さんにん: '3girls' };
/**
 * 「两个少女」「三名少年」这类：数量词 + 性别词。
 * 量词只允许 个/名/位/只——绝不能把「人」也算进去：
 * 写成 `(?:个|名|位|只|人)?` 会让「两个人」被当成「两 + 性别词」，凭空多出 2girls。
 * 性别词后接的 儿/子 用 `(?:儿|子)?` 吃掉，避免「一个女孩儿」这类口语写法整条失配。
 */
const COUNT_GENDER_RE = /([一二两俩三四五六1-6])\s*(?:个|名|位|只)\s*(女孩|女生|少女|妹子|女人|女性|男孩|男生|少年|男人|男性)(?:儿|子)?/g;
/** 「两个女孩一个男孩」这类组合：逐个扫「数量 + 性别」片段（同样不许吃「人」） */
const COMBINE_RE = /([一二两俩三四五六1-6])\s*(?:个|名|位)?\s*(女孩|女生|少女|妹子|男孩|男生|少年|女人|男人|女性|男性)(?:儿|子)?/g;
/** 「三男两女」这类不带量词的紧写 */
const BI_GENDER_RE = /([一二两俩三四五六1-6])\s*(男|女)(?![孩人])/g;

/**
 * 人数解析：先试表（口语整串），再试规律（N 个 X / N girls），最后合并去重。
 * 合并规则：同时拿到 1girl 与 1boy 这类互补组合时全部保留；只有 girls 类时按最大数取一条。
 */
function parseCounts(compact, rawNorm) {
  const out = [];
  const DBG = !!process.env.RTAG_COUNT_DEBUG;
  const push = t => { if (t && !out.includes(t)) out.push(t); };

  // ① 整串分组词（最长优先，不提前退出）：性别明确的说法压过纯人数说法。
  //    「两个人，一个男孩一个女孩」里「一个人」是纯人数（默认 girls）、「一个女孩」才带性别信息，
  //    若把两条都收下会同时出现 2girls 与 1girl+1boy（组合读法里 2girls 是错的），故按优先级覆盖：
  //    第一条已是性别明确的说法时，后续的纯人数说法一律忽略。
  if (process.env.RTAG_COUNT_DEBUG) console.log('[count] enter compact', JSON.stringify(compact));
  const sorted = Object.keys(COUNT_GROUPS).sort((a, b) => b.length - a.length);
  const tableHits = [];
  for (const k of sorted) if (compact.includes(k)) tableHits.push({ k, tags: COUNT_GROUPS[k] });
  const genderExplicit = t => /(\d)(girls?|boys?)/.test(t) || t === 'solo';
  // 表里还有只管数量的裸量词（「两个」「一个」），它们的键里没有性别词，
  // 给的性别只是默认猜测（一律 girls）。一旦输入另有带性别的写法，这批猜测必须让位。
  // 注意不能靠 tag 反推裸量词：hints 里「两个」和「两个女孩」映射的是同一组 tag。
  const GENDER_WORD_RE = new RegExp(`(${[...GENDER_WORDS.girl, ...GENDER_WORDS.boy].join('|')})`);
  // 人数标签的性别判定：**必须写成 `boys?`/`girls?`** —— 标签是单数 `1boy`，
  // 只写 `boys` 会让 1boy 落空（这一处吃过一次：specificGenders 只收到 girl，1boy 被当成裸量词摘掉）。
  const COUNT_GENDER_TAG_RE = /^([1-6])(girl?s?|boy?s?)$/;
  const genderOfTag = t => {
    const c = COUNT_GENDER_TAG_RE.exec(String(t));
    return c ? (/^g/i.test(c[2]) ? 'girl' : 'boy') : null;
  };
  const bareCount = new Set();          // 由裸量词贡献的 tag（性别只是猜测）
  const specificGenders = new Set();    // 由带性别写法确证的性别
  let seeded = false;
  for (const h of tableHits) {
    const bare = !GENDER_WORD_RE.test(h.k);
    if (seeded && bare) continue;
    if (seeded && !genderExplicit(h.tags[0])) continue;
    for (const t of h.tags) {
      push(t);
      if (bare) bareCount.add(t);
    }
    if (!bare) for (const t of h.tags) {
      const g = genderOfTag(t);
      if (g) specificGenders.add(g);
    }
    seeded = true;
  }

  // ①b 输入里明确写了「N 个 + 性别词」时，没被点到的性别、以及裸量词默认给的性别一律摘掉。
  COUNT_GENDER_RE.lastIndex = 0;
  const explicitGenders = new Set();
  let m;
  while ((m = COUNT_GENDER_RE.exec(compact))) {
    const w = m[2];
    explicitGenders.add(GENDER_WORDS.girl.includes(w) ? 'girl' : 'boy');
  }
  if (specificGenders.size) {
    for (let i = out.length - 1; i >= 0; i--) {
      const g = genderOfTag(out[i]);
      // 带性别的写法能确证的性别标签留下；裸量词默认给的（2girls）、以及靠裸量词的 solo 摘掉
      if (g ? !specificGenders.has(g) : bareCount.has(out[i])) out.splice(i, 1);
    }
  }
  if (DBG) console.log('[count] explicit', JSON.stringify([...explicitGenders]), 'specific', JSON.stringify([...specificGenders]), 'bare', JSON.stringify([...bareCount]), 'out', JSON.stringify(out));

  // ② 「N 个 X」规律写法：按性别分别累计。
  //    specificGenders 里已有确证数字的性别不再累计——那是带性别写法的活，再数一遍只会
  //    把「两个女孩，一个男孩」的 2girls 盖成 1girl（「一个」是 COMBINE_RE 的子串）。
  const tallies = { girl: 0, boy: 0 };
  COMBINE_RE.lastIndex = 0;
  while ((m = COMBINE_RE.exec(compact))) {
    const n = numeralToNumber(m[1]);
    if (!n) continue;
    const g = GENDER_WORDS.girl.includes(m[2]) ? 'girl' : 'boy';
    if (!specificGenders.has(g)) tallies[g] += n;
  }
  if (tallies.girl && !specificGenders.has('girl')) push(tallies.girl === 1 ? '1girl' : `${tallies.girl}girls`);
  if (tallies.boy && !specificGenders.has('boy')) push(tallies.boy === 1 ? '1boy' : `${tallies.boy}boys`);
  if (!specificGenders.size && tallies.girl === 1 && !tallies.boy && !out.some(t => t === 'solo')) push('solo');

  // ②b 「三男两女」这类不带量词的紧写：只有表里没有整串组合条目时才用，
  //     否则「一男两女」（表里已有 → 1boy+2girls）会被拆成 1boy+1girl。
  if (!specificGenders.size) {
    const bi = { girl: 0, boy: 0 };
    BI_GENDER_RE.lastIndex = 0;
    while ((m = BI_GENDER_RE.exec(compact))) {
      const n = numeralToNumber(m[1]);
      if (n) bi[m[2] === '女' ? 'girl' : 'boy'] += n;
    }
    if (bi.girl) push(bi.girl === 1 ? '1girl' : `${bi.girl}girls`);
    if (bi.boy) push(bi.boy === 1 ? '1boy' : `${bi.boy}boys`);
  }

  // ③ 数字/日文写法
  COUNT_RE.lastIndex = 0;
  while ((m = COUNT_RE.exec(rawNorm))) {
    if (m[1] && m[2]) {
      const n = parseInt(m[1], 10);
      const isGirl = /^g/i.test(m[2]);
      push(`${n}${isGirl ? 'girls' : 'boys'}`);
      if (n === 1 && isGirl) push('solo');
    } else if (m[3] && CN_NUM[m[3]]) push(CN_NUM[m[3]]);
  }
  COUNT_GENDER_RE.lastIndex = 0;
  while ((m = COUNT_GENDER_RE.exec(compact))) {
    const n = numeralToNumber(m[1]);
    if (!n) continue;
    if (GENDER_WORDS.girl.includes(m[2])) push(n === 1 ? '1girl' : `${n}girls`);
    else push(n === 1 ? '1boy' : `${n}boys`);
  }

  // ④ 冲突收口：同一性别只留最大值；有 solo 时不允许出现多人标签
  const PLURAL_RE = /^\d+(girls|boys)$/;
  if (DBG) console.log('[count] after-table', JSON.stringify(out), 'hits', JSON.stringify(tableHits.map(h => h.k)));
  const girls = out.filter(t => /^\d+girls$/.test(t)).map(t => parseInt(t, 10));
  const boys = out.filter(t => /^\d+boys$/.test(t)).map(t => parseInt(t, 10));
  const plain = out.filter(t => PLURAL_RE.test(t));
  const pruned = out.filter(t => !PLURAL_RE.test(t));
  // 「1girl + 1boy」谁也不能代表总人数：「两个女孩，一个男孩」的 1boy 只说了有个男的，
  // 女的人数（2）得从未被点到的裸量词 2girls 里取。两边都在时按这个补一条确切读法。
  const singleGirl = pruned.includes('1girl');
  const singleBoy = pruned.includes('1boy');
  if (singleGirl && singleBoy) {
    const g = Math.max(1, ...girls.map(n => n - 1));     // 扣掉那一个男的
    for (const t of plain) if (t !== '1girl' && t !== '1boy') dropFrom(pruned, t);
    if (girls.length) pruned.push(g === 1 ? '1girl' : `${g}girls`);
    if (boys.length) pruned.push(Math.max(...boys) === 1 ? '1boy' : `${Math.max(...boys)}boys`);
  } else {
    if (girls.length) pruned.push(Math.max(...girls) === 1 ? '1girl' : `${Math.max(...girls)}girls`);
    if (boys.length) pruned.push(Math.max(...boys) === 1 ? '1boy' : `${Math.max(...boys)}boys`);
  }
  const multi = pruned.some(t => PLURAL_RE.test(t) && !t.startsWith('1'));
  const combo = pruned.includes('1girl') && pruned.includes('1boy');
  if (DBG) console.log('[count] girls', JSON.stringify(girls), 'boys', JSON.stringify(boys), 'pruned', JSON.stringify(pruned), 'multi', multi, 'combo', combo);
  return combo || multi ? pruned.filter(t => t !== 'solo') : pruned;
}

/** 从数组里摘掉一条（不存在则不动） */
function dropFrom(arr, t) {
  const i = arr.indexOf(t);
  if (i >= 0) arr.splice(i, 1);
}

/**
 * 中文复合词拆分（hints.mjs 的 CJK_DECOMPOSE 规则）：
 * 「蓝白条纹水手服」→ 尾词 water 服 + 颜色 + 图案三条并列命中。
 * 只在「整串本来查不到」时才补——查得到就不动，免得把好结果搅乱。
 */
export function decomposeCjk(compact) {
  const adds = [];
  const D = CJK_DECOMPOSE;
  // ① 款式尾词：从最长开始找，命中即切成「修饰 + 尾词」
  let tail = '', head = '', tailTag = '';
  const garments = Object.keys(D.garments).sort((a, b) => b.length - a.length);
  for (const g of garments) {
    const i = compact.indexOf(g);
    if (i < 0 || g.length < D.minTailLen) continue;
    tail = g; head = compact.slice(0, i); tailTag = D.garments[g];
    break;
  }
  if (!tail) return adds;
  // ② 修饰成分：先颜色（长词优先）再图案
  const colors = Object.keys(D.colors).sort((a, b) => b.length - a.length);
  const patterns = Object.keys(D.patterns).sort((a, b) => b.length - a.length);
  const colorHits = [];
  const patternHits = [];
  for (const c of colors) {
    if (c.length < D.minModifierLen) continue;
    const i = head.indexOf(c);
    if (i < 0) continue;
    // 单字颜色只在「不复用成别的名词」时才认：「白裙」的「白」可以，「银发」的「银」不行
    // （后者贴着的字构成另一个词，词库对「银发」已有更好释义 silver hair）。
    if (c.length === 1) {
      const next = head[i + 1];
      if (next && D.sortNounChars.includes(next)) continue;
    }
    colorHits.push(c);
  }
  for (const p of patterns) if (p.length >= D.minModifierLen && head.includes(p)) patternHits.push(p);
  // 颜色取最长的一个（「蓝白」优先于「蓝」），图案取最长的一个（「百褶」优先于「褶」）
  const color = colorHits.sort((a, b) => b.length - a.length)[0];
  const pattern = patternHits.sort((a, b) => b.length - a.length)[0];
  // ③ 组合：颜色 + 图案 + 尾词的英文表面，再交给词库查
  const parts = [];
  if (color) parts.push(D.colors[color]);
  if (pattern) parts.push(D.patterns[pattern]);
  adds.push({ kind: 'garment', zh: tail, en: tailTag, parts });
  // 「白」+「连衣裙」→ 除了 dress，再推一条「white dress」这种组合写法；
  // 组合写法查不到时（词库没有该组合）由 match.mjs 正常回落，不会凭空造标签。
  if (parts.length) adds.push({ kind: 'modifier', zh: (color || '') + (pattern || ''), en: parts.join(' ') + ' ' + tailTag, parts });
  return adds;
}

/**
 * 短别名命中：只扫 SHORT_ALIASES（整短语精确写法）。
 * 颜色/图案单字不在这里扫——它们由 decomposeCjk 在复合词里处理，
 * 否则「白天」会被拆出 white + day 这类噪声。
 */
export const RULE_SURFACES = Object.keys(SHORT_ALIASES).sort((a, b) => b.length - a.length);
function ruleHits(compact) {
  const hits = [];
  for (const s of RULE_SURFACES) {
    if (compact.includes(s)) hits.push({ from: s, to: SHORT_ALIASES[s] });
  }
  return hits;
}

/**
 * 日文桥接：在句中找最长的日文词条（含去假名的汉字骨架）
 * 返回 [{ jp, zh, en }]
 */
function bridgeJp(compact) {
  const out = [];
  if (!/[\u3040-\u30ff]/.test(compact)) return out;   // 没有假名就不做
  const win = Math.min(JP.maxLen, compact.length);
  let i = 0;
  while (i < compact.length) {
    let hit = null;
    for (let len = Math.min(win, compact.length - i); len >= 1; len--) {
      const seg = compact.slice(i, i + len);
      // 单字只认汉字（"夜""本""海"），避免假名单字到处命中
      if (len === 1 && !/[\u4e00-\u9fff]/.test(seg)) continue;
      const v = JP.map.get(seg);
      if (v) { hit = { jp: seg, ...v, len }; break; }
    }
    if (hit) {
      out.push({ jp: hit.jp, zh: hit.zh, en: hit.en });
      i += hit.len;
    } else i += 1;
  }
  return out;
}

/** 分句：按标点切，顺手去掉空白与过短的碎片 */
export function splitClauses(text) {
  const parts = String(text).split(SPLIT_RE);
  const out = [];
  for (const p of parts) {
    const t = p.trim();
    if (t.length >= 2) out.push(t);
  }
  return out.length ? out : [String(text).trim()].filter(Boolean);
}

/** 解析单个分句 */
function parseClause(raw, inheritedNeg = false) {
  const norm = normalizeText(raw);
  const compact = keyOf(norm);
  const negated = NEG_RE.test(norm) || inheritedNeg;
  let intensity = 'normal';
  for (const [k, re] of Object.entries(INTENSITY)) {
    if (re.test(norm)) { intensity = k; break; }
  }
  let layerHint = null;
  for (const { layer, re } of HINT_RULES) {
    if (re.test(norm)) { layerHint = layer; break; }
  }
  const jpTerms = bridgeJp(compact);

  // 直接引用：反引号 / 引号 / @画师 / by 画师 / 人数
  const forced = [];
  const ruleTerms = [];             // 规则层的软命中词条（不参与泛词压制，见 match.mjs）
  const forcedZh = [];              // 规则层补充的中文来源（仅供调试与 gap 解释用）
  const pushForced = t => {
    const s = String(t == null ? '' : t).trim();
    if (s && !forced.includes(s)) forced.push(s);
  };
  let m;
  QUOTED_RE.lastIndex = 0;
  while ((m = QUOTED_RE.exec(raw))) pushForced(normalizeText(m[1]));
  for (const a of norm.match(/@[0-9a-z_()\-. ]{2,40}/g) || []) pushForced(a.trim());
  // 「by dairi」「画师：dairi」→ 补上本库的画师前缀 @
  const byMatch = norm.match(/(?:^|\s)(?:by|artist[:：]?|画师[:：]?|作者[:：]?)\s*([0-9a-z][0-9a-z_()\-. ]{1,39})/);
  if (byMatch) {
    const name = byMatch[1].trim().replace(/\s+/g, ' ');
    pushForced('@' + name);
  }

  // ① 人数：表驱动 + 规律式（「两个人」「一男一女」「两个少女」都能出人数标签）。
  //    只对本分句试一次；整段的人数口径由 parseText 在文档级重算（见「人数是文档级信息」注释）。
  for (const t of parseCounts(compact, norm)) pushForced(t);

  // ② 短别名：词库没有的中文口语说法 → 直接给出标签写法
  for (const h of ruleHits(compact)) {
    if (h.to) { pushForced(h.to); forcedZh.push(h.from); }
  }

  // ③ 中文复合词拆分：整串查不到时补「颜色 / 图案 / 款式尾词」几条并列命中。
  //    整条只推「款式尾词」一条 forced（如「蓝白条纹水手服」→ sailor dress），
  //    修饰成分（颜色/图案/组合写法）走 ruleTerms —— 见 match.mjs 里 'rule:' 分支的说明。
  //    检查短开关：RTAG_NO_RULES=1 时不注入，方便判断召回问题是出在规则层还是词库层。
  if (!process.env.RTAG_NO_RULES) {
    for (const d of decomposeCjk(compact)) {
      if (d.kind === 'garment') {
        if (!d.parts.length) continue;
        pushForced(d.en);
        ruleTerms.push({ term: d.en, zh: d.zh, kind: 'garment' });
        for (const p of d.parts) ruleTerms.push({ term: p, zh: d.zh + '·修饰', kind: 'modifier' });
        continue;
      }
      // 修饰成分与尾词的英文组合（「白」+「连衣裙」→ white dress）
      ruleTerms.push({ term: d.en, zh: d.zh, kind: 'modifier' });
    }
  }

  return {
    raw,
    norm,
    compact,
    ascii: asciiTokens(norm),
    cjk: cjkRuns(norm),
    negated, intensity, layerHint, jpTerms, forced, ruleTerms, forcedZh
  };
}

/** 人数标签全集（用于文档级人数口径重算） */
const COUNT_TAGS = new Set([
  '1girl', '2girls', '3girls', '4girls', '5girls', '6girls', 'multiple girls',
  '1boy', '2boys', '3boys', '4boys', '5boys', '6boys', 'multiple boys',
  'solo', '1other', '2others', 'multiple others'
]);
const isCountTag = t => COUNT_TAGS.has(String(t));

/**
 * 解析整段文本 → 计划对象
 *
 * 人数是**文档级**信息，不是分句级的：「两个女孩，一个男孩」按分句各算一次会得到
 * 前句 2girls + 后句 1boy(+1girl)，拼在一起就是错的（真实人数是 2 女 1 男）。
 * 所以这里把各分句里的人数标签全部摘掉，改用整段文本算一次，再挂回第一个分句。
 * @param {string} text 用户的自然语言（中/英/日混输）
 * @param {object} [opts] { keepNegated?:boolean }
 */
export function parseText(text, opts = {}) {
  const clauses = splitClauses(text).map(c => parseClause(c));
  if (clauses.length) {
    const wholeNorm = normalizeText(text);
    const whole = parseCounts(keyOf(wholeNorm), wholeNorm);
    const docCounts = whole.length ? whole : clauses.flatMap(c => c.forced.filter(isCountTag));
    for (const c of clauses) c.forced = c.forced.filter(t => !isCountTag(t));
    for (const t of docCounts) if (!clauses[0].forced.includes(t)) clauses[0].forced.unshift(t);
  }
  // 「不要 X」这种否定分句默认丢掉（会变成负向串，见 compose.mjs）
  const positive = clauses.filter(c => !c.negated);
  const negative = clauses.filter(c => c.negated);
  return {
    kind: 'text',
    raw: String(text),
    clauses: opts.keepNegated ? clauses : positive,
    negatedClauses: negative,
    isEmpty: clauses.length === 0
  };
}

/** 单条英文/中文/日文短语 —— 供精确命中与 API 直调 */
export function parsePhrase(phrase) {
  return parseClause(String(phrase));
}

export const _jpTable = JP;
