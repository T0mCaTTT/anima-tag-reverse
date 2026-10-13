#!/usr/bin/env node
/**
 * merge.mjs —— 多图融合命令行入口
 *
 * 默认输出与 rtag.mjs 一致：**一行逗号分隔的纯标签串**（stdout 干净），
 * 换源摘要、跨源提示、歧义、缺项全部走 stderr。要人读报告用 --format md。
 *
 *   node bin/merge.mjs --img a.json --img b.json "把图1的姿势换到图2的人身上"
 *   node bin/merge.mjs --a a.json --b b.json "图1的场景替换成图2上"          # --a/--b 是 --img 的简写
 *   node bin/merge.mjs --img a.json --img b.json --img c.json "图1的姿势，图2的服装，画风照图3"
 *   node bin/merge.mjs --img a.json --img b.json --preset 上身特写=1 --base 2
 *   node bin/merge.mjs --img a.json --img b.json "把图1的上身特写换给图2"      # 组合宏也能用自然语言说
 *   node bin/merge.mjs --img a.json --img b.json "…" --format explain        # 只看指令怎么解析的
 *   node bin/merge.mjs --img a.json --img b.json "…" --format spec           # 只要合并后的观察 JSON
 *   node bin/merge.mjs --dims / --presets / --template
 *
 * 链式（三张以上的另一种玩法）：先融两张导出 --format spec merged.json，
 * 再 `--img merged.json --img c.json "…"`，中间结果就是新一轮的一张图。
 *
 * 命令行里的「图1 / 图2 / 图3」= --img 的出现顺序。传图顺序与用户口头顺序相反时写 --swap。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fuse, parseFusionIntent, normalizeSideArg, renderExplain, renderDims, renderPresets, SKILL_DIR } from '../src/index.mjs';

const argv = process.argv.slice(2);
const opt = { format: 'tags', extra: [], images: [], presets: [] };
const positional = [];

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const next = () => argv[++i];
  switch (a) {
    case '--img': case '--image': opt.images.push(next()); break;
    case '--a': case '--image-a': opt.a = next(); break;
    case '--b': case '--image-b': opt.b = next(); break;
    case '--c': case '--image-c': opt.c = next(); break;
    case '--d': case '--image-d': opt.d = next(); break;
    case '--text': case '--instruction': positional.push(next()); break;
    case '--map': case '--mapping': opt.map = next(); break;
    case '--preset': case '--macro': opt.presets.push(next()); break;
    case '--base': opt.base = next(); break;
    case '--swap': opt.swap = true; break;
    case '--extra': case '--add': opt.extra.push(next()); break;
    case '--format': opt.format = next(); break;
    case '--engine': opt.engineDir = next(); break;
    case '--kb': opt.kbDir = next(); break;
    case '--out': opt.out = next(); break;
    case '--broad': opt.broad = true; break;
    case '--no-broad': opt.broad = false; break;
    case '--nl': opt.nl = true; break;
    case '--explain': if (opt.format === 'tags') opt.format = 'explain'; break;
    case '--dims': opt.dims = true; break;
    case '--presets': opt.presetsList = true; break;
    case '--template': opt.template = true; break;
    case '-h': case '--help': opt.help = true; break;
    default: positional.push(a);
  }
}

const USAGE = `双图 / 多图融合 → 可直接使用的 Anima / Danbooru 标签

用法：
  node bin/merge.mjs --img 图1.json --img 图2.json "把图1的姿势换到图2的人身上"
  node bin/merge.mjs --img a.json --img b.json --img c.json "图1的姿势，图2的服装，画风照图3"

常用指令写法（自然语言，随便说，认不出的会列出来问你）：
  把图1的姿势换到图2的人身上        姿势 ← 图1，其余以图2为底
  图1的场景替换成图2上              场景 ← 图1，图2为底
  图1的形象，但发型和瞳色用图2的     外观 ← 图1，发型/瞳色 ← 图2
  把图1的上身特写换给图3            组合宏：姿势+表情+景别+视角 ← 图1
  画风照图1，场景不变               style ← 图1，底图按语境推断
  整体照图1                        整张以图1为底

参数：
  --img <文件|JSON>      一张图的观察（可重复，顺序即图1/图2/图3…）
  --a --b --c --d        同上，按位置简写
  --preset <组合[=图N]>  组合宏换源：上身特写 / 换头 / 全身像 / 整套服装 / 人物全套 /
                         姿势表情 / 场景光影 / 构图取景 / 色调氛围 / 画风全套（见 --presets）
  --map <表>             显式换源，绕过自然语言：pose=1,scene=2,上身特写=3
  --base <图N>           显式指定底图（宿主）
  --swap                 把口头的图顺序整体反转（图1 ↔ 图N）
  --extra <文本>         追加描述（可重复），会作为额外分句参与匹配
  --format <形态>        tags(默认) | prompt | md | json | spec | check | explain
  --broad                宽召回（更多候选，默认档不变）
  --nl                   额外产出英文自然语言
  --engine <目录>        指定 anima-tag-reverse 引擎目录
  --dims / --presets     打印维度 / 组合宏清单
  --out <文件>           把结果写到文件

链式（三张以上）：先融两张并用 --format spec 导出，再把结果当成新一轮的一张图。
观察 JSON 的模板：node <anima-tag-reverse>/bin/rtag.mjs --template`;

if (opt.help) { console.log(USAGE); process.exit(0); }
if (opt.dims || opt.format === 'dims') { console.log(renderDims()); process.exit(0); }
if (opt.presetsList || opt.format === 'presets') { console.log(renderPresets()); process.exit(0); }
if (opt.template) { console.log(USAGE); process.exit(0); }

/** 参数既可以是文件路径，也可以是内联 JSON */
function readSpecArg(v, name) {
  if (v === undefined) return undefined;
  if (typeof v !== 'string') return v;
  const t = v.trim();
  if (t.startsWith('{') || t.startsWith('[')) {
    try { return JSON.parse(t); } catch (e) { console.error(`[错误] ${name} 的内联 JSON 解析失败：${e.message}`); process.exit(2); }
  }
  const p = path.resolve(process.cwd(), t);
  if (!fs.existsSync(p)) {
    console.error(`[错误] ${name} 的观察文件不存在：${p}`);
    process.exit(2);
  }
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) {
    console.error(`[错误] ${name} 的观察文件不是合法 JSON：${e.message}`);
    process.exit(2);
  }
}

const instruction = positional.join(' ').trim();

const A = readSpecArg(opt.a, '--a（图1）');
const B = readSpecArg(opt.b, '--b（图2）');
const C = readSpecArg(opt.c, '--c（图3）');
const D = readSpecArg(opt.d, '--d（图4）');
const IMAGES = opt.images.map((v, i) => readSpecArg(v, `--img #${i + 1}`));

// 图数量：--img 优先，否则数简写键
const count = IMAGES.length || [A, B, C, D].filter(v => v !== undefined).length || 0;

// ---- 只解析指令（不碰词库，秒出） ----
if (opt.format === 'explain') {
  if (!instruction) { console.error('[错误] --format explain 需要一段指令文本。'); process.exit(2); }
  const intent = parseFusionIntent(instruction, {
    swap: !!opt.swap,
    base: normalizeSideArg(opt.base, !!opt.swap, count || 2),
    count: count || 2
  });
  console.log(renderExplain(intent));
  process.exit(intent.ambiguous.length ? 3 : 0);   // exit 3 = 有歧义待确认，调用方可据此追问
}

if (!count || count < 2) {
  console.error('[错误] 至少需要两份观察：--img 图1.json --img 图2.json（或 --a / --b）');
  console.error('       （观察 JSON 由看图的人写成，模板见 rtag.mjs --template）');
  console.error('');
  console.error(USAGE);
  process.exit(2);
}

const sideLabel = n => `图${n}`;

/** 摘要走 stderr，保证 stdout 只有交付物 */
function printHints(r) {
  const L = [];
  L.push(`[融合] 图片 ${r.count} 张｜底图=${sideLabel(r.base)}｜换源 ${r.applied.filter(x => x.side !== r.base).length} 项｜指令：${r.instruction || '(未给，按 --preset / --map 或整张融合)'}`);
  for (const p of (r.intent.presets || []).filter(p => p.from === 'cli')) {
    L.push(`  - 组合宏「${p.label}」→ ${p.slots.join(' + ')} ← ${sideLabel(p.side)}`);
  }
  for (const s of r.applied.filter(x => x.side !== r.base)) {
    L.push(`  - ${s.label}(${s.path}) ← ${sideLabel(s.side)}${s.preset ? `（组合宏 ${s.preset}）` : ''}`);
  }
  for (const e of r.emptySources) {
    L.push(`  ! ${sideLabel(e.side)} 的${e.label}(${e.path})是空的，未替换 —— 请补这份观察`);
  }
  for (const c of r.conflicts) L.push(`  [${c.severity}] ${c.message}`);
  for (const a of r.intent.ambiguous) L.push(`  [待确认] ${a.message}`);
  for (const u of r.intent.unknown) {
    L.push(`  [没听懂] "${u.text}"${u.raw && u.raw !== u.text ? `（原句片段：${u.raw}）` : ''}`);
  }
  for (const e of (r.mapErrors || [])) L.push(`  [参数] ${e}`);
  if (r.gapsSummary) {
    const s = r.gapsSummary;
    const kinds = Object.entries(s.byKind || {}).map(([k, v]) => `${k} ${v}`).join(' · ');
    L.push(`[缺项自审] 缺口 ${s.total} 条：${kinds || '无'}（合并后观察仍有必填维度没写，可用 --format md 看建议写法）`);
    for (const i of (s.specIssues || [])) L.push(`  - ${i.key}（${i.label}）建议：${i.advice}`);
  }
  console.error(L.join('\n'));
}

function writeOut(text) {
  if (opt.out) {
    const p = path.resolve(process.cwd(), opt.out);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text.endsWith('\n') ? text : text + '\n', 'utf8');
    console.error(`[写入] ${p}`);
  } else {
    console.log(text);
  }
}

const r = await fuse({
  images: IMAGES.length ? IMAGES : undefined,
  a: A, b: B, c: C, d: D,
  instruction,
  map: opt.map,
  presets: opt.presets,
  base: opt.base,
  swap: opt.swap,
  extra: opt.extra,
  broad: opt.broad,
  nl: opt.nl || opt.format === 'check',
  engineDir: opt.engineDir,
  kbDir: opt.kbDir
});

switch (opt.format) {
  case 'explain':
    console.log(renderExplain(r.intent));
    break;
  case 'spec':
    writeOut(JSON.stringify(r.spec, null, 2));
    printHints(r);
    break;
  case 'json': {
    const slim = {
      base: r.base,
      count: r.count,
      instruction: r.instruction,
      tags: r.tags,
      prompt: r.prompt,
      rating: r.rating,
      negative: r.negative,
      presets: r.intent.presets || [],
      sources: r.applied.map(s => ({ path: s.path, label: s.label, side: s.side, note: s.note, preset: s.preset || null })),
      emptySources: r.emptySources,
      conflicts: r.conflicts,
      provenance: r.provenance,
      assumptions: r.intent.assumptions,
      ambiguous: r.intent.ambiguous,
      unknown: r.intent.unknown,
      mapErrors: r.mapErrors,
      specIssues: r.specIssues,
      gapsSummary: r.gapsSummary,
      spec: r.spec
    };
    console.log(JSON.stringify(slim, null, 2));
    break;
  }
  case 'md':
    writeOut(r.report());
    break;
  case 'prompt':
    writeOut(r.prompt);
    printHints(r);
    break;
  case 'check': {
    writeOut(r.tags);
    console.log('');
    if (r.nl && r.nl.text) { console.log(r.nl.text); console.log(''); }
    if (r.gapsMarkdown) console.log(r.gapsMarkdown);
    printHints(r);
    break;
  }
  case 'tags':
  default:
    writeOut(r.tags);
    printHints(r);
    break;
}
