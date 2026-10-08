#!/usr/bin/env node
/**
 * smoke.mjs —— 自测：四类输入（中 / 英 / 日 / 图像规格）的反推质量门
 *
 * 跑法： node tests/smoke.mjs        （在技能根目录）
 *        node tests/smoke.mjs -v     打印每条实际输出
 *
 * 每个用例给 must（必须命中）与 never（绝不能出现）两组断言。
 * never 里的标签都是历史上真实出现过的误召回，留着当回归护栏。
 */
import { reverseText, reverseImageSpec, getLexicon, kbInfo, buildNaturalLanguage } from '../src/index.mjs';
import { _internal as M } from '../src/match.mjs';

const { simFast } = M;

const VERBOSE = process.argv.includes('-v') || process.argv.includes('--verbose');

const TEXT_CASES = [
  {
    name: '中文 · 教室看书',
    text: '长发蓝发少女坐在教室里看书，夜晚，逆光，不要眼镜',
    must: ['long hair', 'blue hair', 'sitting', 'reading', 'night', 'classroom', 'backlighting'],
    never: ['glasses']
  },
  {
    name: '中文 · 樱花树下的白裙',
    text: '一个穿白色连衣裙的银发女孩站在樱花树下，微笑，侧脸',
    must: ['white dress', 'silver hair', 'smile', 'profile', 'cherry_tree'],
    never: ['green dress', 'brown dress', 'grey dress', 'two-tone dress']
  },
  {
    name: '中文 · 双马尾（修饰词不该外溢）',
    text: '双马尾',
    must: ['twintails'],
    never: ['high ponytail', 'short ponytail', 'wide_ponytail', 'side ponytail']
  },
  {
    name: '中文 · 分句写的人数（两个女孩，一个男孩）',
    text: '两个女孩，一个男孩',
    must: ['2girls', '1boy'],
    never: ['1girl', '2boys', '3girls']
  },
  {
    name: '中文 · 人数紧写（三男两女）',
    text: '三男两女',
    must: ['3boys', '2girls'],
    never: ['1girl', '1boy', 'solo']
  },
  {
    name: '中文 · 单人仍出 solo',
    text: '一个女孩站在阳台上',
    must: ['1girl', 'solo', 'balcony'],
    never: ['2girls', '1boy']
  },
  {
    name: '英文 · 长句',
    text: '1girl, long blue hair, sitting on a chair, reading a book in the classroom at night, backlighting, no glasses',
    must: ['1girl', 'long hair', 'blue hair', 'sitting', 'reading', 'night', 'classroom'],
    never: ['on book', 'glasses', 'blonde hair', 'grey hair']
  },
  {
    name: '英文 · 动作与服装',
    text: 'twintails, blue eyes, school uniform, standing, holding a sword',
    must: ['twintails', 'blue eyes', 'school uniform', 'standing', 'sword'],
    never: ['u.a._school_uniform', 'nijigasaki_school_uniform', 'tail', 'blue_footwear', 'blue_halo']
  },
  {
    name: '英文 · 拼写容错（stem / 缩写）',
    text: 'twintail, blu hair, standing',
    must: ['twintails', 'blue hair', 'standing'],
    never: ['slime girl']
  },
  {
    name: '日文 · 混排',
    text: '青い髪の長髪の少女が夜の教室で本を読んでいる、逆光',
    must: ['long hair', 'blue hair', 'reading', 'night', 'backlighting'],
    never: []
  },
  {
    // 契约①：反推不做内容审查 —— R18 内容照常转换，只把分级 token 写对
    name: '中文 · R18 不过滤（分级自动升级）',
    text: '两个裸体女高中生在床上做爱，露骨，高潮',
    must: ['naked', 'orgasm'],
    never: [],
    lineMust: ['explicit'],
    rating: 'explicit'
  },
  {
    name: '中文 · NSFL（猎奇/断肢照常转换）',
    text: '触手侵犯，血腥猎奇，断肢，内脏',
    must: ['guro', 'severed limb', 'entrails', 'tentacle'],
    never: [],
    rating: 'nsfw'
  },
  {
    // 通用词兜底：本库没有 schoolgirl / high_school_girl，这类说法落到 girl
    name: '中文 · 通用词兜底（女高中生 → girl）',
    text: '女高中生',
    must: ['girl'],
    never: []
  }
];

const SPEC_CASES = [
  {
    name: '图像规格 · 单人少女',
    spec: {
      subject: { count: 1, kind: '少女' },
      appearance: ['长银发', '红瞳'],
      outfit: ['黑色连衣裙'],
      pose: ['坐在窗台'],
      scene: ['夜晚的教室', '逆光'],
      style: ['柔光'],
      artists: ['@dairi'],
      negative: ['眼镜']
    },
    must: ['1girl', 'solo', 'silver hair', 'red eyes', 'backlighting', 'classroom', '@dairi', 'sitting'],
    never: ['2girls']
  },
  {
    name: '图像规格 · 双人男生',
    spec: { subject: { count: 2, gender: 'boys' }, appearance: ['black eyes'], scene: ['室内', '夜晚'] },
    must: ['2boys', 'black eyes', 'night'],
    never: ['1girl', 'solo', '6+boys']
  },
  {
    name: '图像规格 · 中文数字人数',
    spec: { subject: { count: '二人', kind: '少女' }, appearance: ['银发'] },
    must: ['2girls'],
    never: ['1girl', 'solo']
  }
];

function tagsOf(res) {
  return res.positive.tags.slice();
}

/**
 * 交付契约（用户定的硬要求）：
 *   ① 单行文本，没有换行
 *   ② 逗号 + 空格分隔，首尾无逗号、无空段
 *   ③ 默认形态不带官方质量前缀（masterpiece / best quality / score_7 / safe 是可选前缀，用 --format prompt 才加）
 *   ④ 官方写法：空格代替下划线，只有 score_* 保留下划线（库里的 cherry_tree 输出成 cherry tree）
 */
function checkContract(res) {
  const bad = [];
  const line = res.bare || '';
  if (/\r|\n/.test(line)) bad.push('含换行');
  if (/^,|,$|,\s*,/.test(line)) bad.push('逗号格式不对');
  if (/masterpiece|best quality/.test(line)) bad.push('带了官方前缀');
  const underscored = line.split(',').map(s => s.trim()).filter(t => t.includes('_') && !/^score_\d/.test(t));
  if (underscored.length) bad.push(`非 score_* 标签仍带下划线：${underscored.join(' / ')}`);
  return bad;
}

function runCase(c) {
  const res = c.text !== undefined ? reverseText(c.text, {}) : reverseImageSpec(c.spec, {});
  const tags = tagsOf(res);
  const set = new Set(tags);
  // must / never 按官方写法比较：库里写 cherry_tree，输出写 cherry tree，都算命中
  const flat = s => String(s).toLowerCase().replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
  const miss = c.must.filter(t => !set.has(flat(t)));
  const bad = c.never.filter(t => set.has(flat(t)));
  for (const t of c.lineMust || []) if (!res.bare.toLowerCase().includes(flat(t))) miss.push(`${t}(单行串)`);
  if (c.rating && res.rating !== c.rating) bad.push(`分级=${res.rating}（期望 ${c.rating}）`);
  bad.push(...checkContract(res));
  return { res, tags, miss, bad, ok: !miss.length && !bad.length };
}

let pass = 0, fail = 0;
const t0 = Date.now();

const info = kbInfo();
console.log(`词库：${info.kbDir}`);
console.log(`规模：${(info.size || 0).toLocaleString()} 条标签 · 模型 ${info.model || '-'}\n`);
getLexicon();   // 预热（后面每条都能测到真实耗时）
const lex = getLexicon();

for (const c of [...TEXT_CASES, ...SPEC_CASES]) {
  const r = runCase(c);
  if (r.ok) { pass++; console.log(`[通过] ${c.name}`); }
  else {
    fail++;
    console.log(`[失败] ${c.name}`);
    if (r.miss.length) console.log(`   缺： ${r.miss.join(', ')}`);
    if (r.bad.length) console.log(`   多了： ${r.bad.join(', ')}`);
  }
  if (VERBOSE || !r.ok) console.log(`   → ${r.tags.join(', ')}`);
}

// ---- 中文字集兜底（语序不同但用字几乎一样才放行）----
// 只在「候选已经被召回」时才起作用，所以这里直接单元测试相似度函数本身
for (const [a, b, min, why] of [
  ['女高中生', '高中女生', 0.8, '语序不同'],
  ['白色连衣裙', '绿色连衣裙', 0, '颜色字不同'],
  ['双马尾', '高马尾', 0, '修饰词不同'],
  ['过膝袜', '大腿袜', 0, '不同物品']
]) {
  const s = simFast(a, lex.fpOf(a), b, lex);
  const ok = s >= min;
  if (ok) { pass++; console.log(`[通过] 中文字集兜底 · ${a} ↔ ${b}（${why}，sim=${s.toFixed(2)}）`); }
  else { fail++; console.log(`[失败] 中文字集兜底 · ${a} ↔ ${b}（${why}，sim=${s.toFixed(2)}，期望 ≥${min}）`); }
}

// ---- 英文自然语言分支（新功能回归）----
// 只断言「句子里必须出现什么」与「不能出现什么」，不锁死整句措辞，避免措辞微调就红。
const NL_CASES = [
  {
    name: '自然语言 · 人数句用 one girl',
    text: '一个穿白色连衣裙的银发女孩站在樱花树下，微笑，侧脸',
    has: [/^One girl\./, /white dress/, /seen in profile|profile/],
    never: [/^Girl\./, /The scene is set[^.]*silver hair/]
  },
  {
    name: '自然语言 · 动作不进场景句',
    text: '长发蓝发少女坐在教室里看书，夜晚，逆光',
    has: [/One girl\./, /sitting/, /reading/, /classroom/],
    never: [/The scene is set[^.]*reading/]
  },
  {
    name: '自然语言 · 多主体人数与性别都要写出',
    text: '两个人，雨中，一个男孩一个女孩，撑伞',
    has: [/Two girls and one boy|One girl and one boy/, /umbrella/],
    never: [/^Two girls\.$/m, /heart hands duo(?!\s*$)/, /She is wearing.*heart/]
  },
  {
    name: '自然语言 · 确定性（同一输入两次结果一致）',
    text: '银色长发的女孩坐在窗边，夕阳',
    has: [/One girl\./],
    deterministic: true
  },
  {
    name: '自然语言 · 分句写的人数要合起来读',
    text: '两个女孩，一个男孩',
    has: [/Two girls and one boy/],
    never: [/One girl and one boy/, /^One girl\./]
  },
  {
    name: '自然语言 · 人数紧写（三男两女）',
    text: '三男两女',
    has: [/Three boys and two girls/],
    never: [/Three girls/]
  }
];

for (const c of NL_CASES) {
  const a = buildNaturalLanguage(reverseText(c.text, {}));
  const b = c.deterministic ? buildNaturalLanguage(reverseText(c.text, {})) : null;
  const bad = [];
  for (const re of c.has) if (!re.test(a.text)) bad.push(`缺 ${re}`);
  for (const re of c.never || []) if (re.test(a.text)) bad.push(`多了 ${re}`);
  if (b && a.text !== b.text) bad.push('两次结果不同');
  if (bad.length) { fail++; console.log(`[失败] ${c.name}`); console.log(`   问题： ${bad.join(', ')}`); console.log(`   → ${a.text}`); }
  else { pass++; console.log(`[通过] ${c.name}`); }
}

// ---- 缺项检测（新功能回归）----
// 断言「该报的缺口报了、不该报的别报」，不锁死候选项数量。
const GAP_CASES = [
  {
    name: '缺项 · 空输入应报关键层为空',
    text: '站在那里',
    needKinds: ['emptyLayer'],
    minTotal: 2
  },
  {
    name: '缺项 · 同维度冲突要报出来',
    text: '一个女孩，白天，夜晚，长发，短发',
    needKinds: ['conflict'],
    needIds: ['E-day-night', 'E-longhair-shorthair']
  },
  {
    name: '缺项 · 多主体缺外观要报 multiSubject',
    text: '两个人，一个男孩一个女孩，撑伞',
    needKinds: ['multiSubject']
  },
  {
    name: '缺项 · 完整描述不该报冲突',
    text: '一个银发蓝眼的女孩穿着白色连衣裙站在樱花树下，微笑，侧脸，上半身，白天',
    neverKinds: ['conflict'],
    neverIds: []
  }
];

for (const c of GAP_CASES) {
  const res = reverseText(c.text, { gaps: true, alternatives: true, broad: true });
  const gaps = res.gaps || [];
  const kinds = new Set(gaps.map(g => g.kind));
  const ids = new Set(gaps.map(g => g.id));
  const bad = [];
  for (const k of c.needKinds || []) if (!kinds.has(k)) bad.push(`缺 kind=${k}`);
  for (const id of c.needIds || []) if (!ids.has(id)) bad.push(`缺 id=${id}`);
  for (const k of c.neverKinds || []) if (kinds.has(k)) bad.push(`多了 kind=${k}`);
  for (const id of c.neverIds || []) if (ids.has(id)) bad.push(`多了 id=${id}`);
  if (c.minTotal && gaps.length < c.minTotal) bad.push(`缺口只有 ${gaps.length} 条（期望 ≥${c.minTotal}）`);
  if (bad.length) { fail++; console.log(`[失败] ${c.name}`); console.log(`   问题： ${bad.join(', ')}`); console.log(`   缺口： ${gaps.map(g => g.id).join(', ') || '（无）'}`); }
  else { pass++; console.log(`[通过] ${c.name}`); }
}

// ---- CLI 接线（新开关必须真的改变输出形态）----
// 教训：--gaps / --check / --nl 起初只置布尔开关、不改 opt.format，而输出分支判的是 opt.format，
// 于是这三个开关静默返回默认标签串。这条回归就是防止再犯。
const { execFileSync } = await import('node:child_process');
const { fileURLToPath } = await import('node:url');
const { dirname, join } = await import('node:path');

const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(SKILL_DIR, 'bin', 'rtag.mjs');

function runCli(args) {
  return execFileSync(process.execPath, [CLI, ...args], {
    cwd: SKILL_DIR,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024
  });
}

const CLI_CASES = [
  {
    name: 'CLI · 默认输出仍是单行标签串',
    args: ['一个女孩站在阳台上'],
    has: [/^1girl, solo, balcony/],
    never: [/^##/m, /\n/]
  },
  {
    name: 'CLI · --gaps 输出勾选表',
    args: ['一个女孩站在阳台上', '--gaps'],
    has: [/^### 缺项清单与候选项/m, /\[ \] `/]
  },
  {
    name: 'CLI · --check 四段齐全',
    args: ['一个女孩站在阳台上', '--check'],
    has: [/^## 标签串/m, /^## 负向串/m, /^## 英文自然语言/m, /^### 缺项清单与候选项/m]
  },
  {
    name: 'CLI · --nl 输出自然语言而非标签串',
    args: ['一个女孩站在阳台上', '--nl'],
    has: [/^One girl\./],
    never: [/^1girl, solo/]
  },
  {
    name: 'CLI · --format tags 时 --nl 只当附加产物',
    args: ['一个女孩站在阳台上', '--nl', '--format', 'tags'],
    has: [/^1girl, solo, balcony/],
    never: [/^One girl\./]
  },
  {
    name: 'CLI · --format json 附带新产物',
    args: ['一个女孩站在阳台上', '--broad', '--nl', '--gaps', '--format', 'json'],
    has: [/"naturalLanguage"/, /"gapsSummary"/, /"alternatives"/]
  }
];

for (const c of CLI_CASES) {
  let out = '';
  const bad = [];
  try {
    out = runCli(c.args).replace(/\n$/, ''); // console.log 的收尾换行不算多行
  } catch (e) {
    bad.push(`CLI 退出非 0：${e.message.split('\n')[0]}`);
  }
  for (const re of c.has) if (!re.test(out)) bad.push(`缺 ${re}`);
  for (const re of c.never || []) if (re.test(out)) bad.push(`多了 ${re}`);
  if (bad.length) { fail++; console.log(`[失败] ${c.name}`); console.log(`   问题： ${bad.join(', ')}`); console.log(`   → ${out.slice(0, 200).replace(/\n/g, '⏎')}`); }
  else { pass++; console.log(`[通过] ${c.name}`); }
}

console.log(`\n${pass} 通过 / ${fail} 失败 · ${Date.now() - t0}ms`);
process.exitCode = fail ? 1 : 0;
