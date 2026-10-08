#!/usr/bin/env node
/**
 * rtag.mjs —— 命令行入口（技能在会话里调用它，也可以单独跑）
 *
 *   默认输出就是交付形态：一行逗号分隔的纯标签串，没有解释、没有 markdown、没有多余行。
 *
 *   node bin/rtag.mjs "长发蓝发少女坐在教室里读书，夜晚，逆光"
 *   node bin/rtag.mjs --file 描述.txt --format bare     # 不含官方前缀的纯标签
 *   node bin/rtag.mjs - < 描述.txt
 *   node bin/rtag.mjs --image-spec 观察.json
 *   node bin/rtag.mjs --search "blue eyes" --top 8
 *   node bin/rtag.mjs --info
 *   node bin/rtag.mjs --template > 观察模板.json
 *   node bin/rtag.mjs "…" --format md                   # 带分层与分数的人类报告
 *
 * 内容不作任何审查 / 过滤：R18、NSFL 元素照常解析、照常匹配、照常出现在输出的标签串里；
 * 只有前缀里的分级 token 会按命中内容自动升级（safe → sensitive → questionable → nsfw → explicit），
 * 以便标签串符合常见标签库的规定格式。
 */
import fs from 'node:fs';
import path from 'node:path';
import { getLexicon, reverse, searchTags, kbInfo, emptySpec, LAYER_NAME, nlTemplate } from '../src/index.mjs';

const argv = process.argv.slice(2);
const opt = { format: 'tags', top: 40 };
const positional = [];

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const next = () => argv[++i];
  switch (a) {
    case '--text': positional.push(next()); break;
    case '--file': opt.file = next(); break;
    case '--image-spec': opt.spec = next(); break;
    case '--search': opt.search = next(); break;
    case '--kb': opt.kbDir = next(); break;
    case '--top': opt.top = parseInt(next(), 10); break;
    case '--per-clause': opt.perClause = parseInt(next(), 10); break;
    case '--min': opt.minScore = parseFloat(next()); break;
    case '--min-sim': opt.minSim = parseFloat(next()); break;
    case '--max-per-layer': opt.maxPerLayer = parseInt(next(), 10); break;
    case '--format': opt.format = next(); break;
    case '--rating': opt.rating = next(); break;
    case '--prefix': opt.prefix = next(); break;
    case '--no-prefix': opt.prefix = ''; break;
    case '--negative': opt.negative = next(); break;
    case '--info': opt.info = true; break;
    case '--template': opt.template = true; break;
    // ---- 本轮新增 ----
    case '--broad': opt.broad = true; break;                       // 宽召回档（多捞候选，默认档位不变）
    case '--no-broad': opt.broad = false; break;
    // 这三个开关同时改变输出形态：只有用户没显式写 --format 时才接管它，
    // 否则 --gaps / --check / --nl 只是生成附加产物（默认输出仍是单行标签串）。
    case '--gaps':
      opt.gaps = true; opt.alternatives = true;
      if ((opt.format || 'tags') === 'tags') opt.format = 'gaps';
      break;
    case '--check':
      opt.gaps = true; opt.alternatives = true; opt.nl = true;
      if ((opt.format || 'tags') === 'tags') opt.format = 'check';
      break;
    case '--nl':
      opt.nl = true;
      if ((opt.format || 'tags') === 'tags') opt.format = 'nl';
      break;
    // 关掉缺项自审（图像入口默认开）；文本入口本来就不带默认，写这个等于显式关掉
    case '--no-gaps': opt.gaps = false; break;
    case '--with-tags': opt.nlWithTags = true; break;
    case '--no-tags': opt.nlWithTags = false; break;
    case '--max-per-sentence': opt.maxPerSentence = parseInt(next(), 10); break;
    case '--nl-template': opt.nlTemplate = true; break;
    case '-h': case '--help': opt.help = true; break;
    case '-': opt.stdin = true; break;
    default: positional.push(a);
  }
}

// --format 决定了需要哪些附加产物，这里补齐开关，避免用户还得再写一遍 --nl / --gaps
if (opt.format === 'nl') opt.nl = true;
if (opt.format === 'gaps') { opt.gaps = true; opt.alternatives = true; }
if (opt.format === 'check') { opt.nl = true; opt.gaps = true; opt.alternatives = true; }
if (opt.nlWithTags === true) opt.nlOptions = { ...(opt.nlOptions || {}), withTags: true };
if (opt.nlWithTags === false) opt.nlOptions = { withTags: false };
if (opt.maxPerSentence) opt.nlOptions = { ...(opt.nlOptions || {}), maxPerSentence: opt.maxPerSentence };

// ---- 图像规格入口：缺项自审默认开启，宽召回不默认 ----------------------------
// 踩过的坑：自审原本要另外写 --gaps / --format gaps 才出，不写也不报错，于是被静默跳过，
// 交付的标签串漏了画风与光位。这里把图像入口的默认档改掉，并且把缺项提示打到 stderr，
// 让「没自审」在界面上直接可见（stdout 仍是单行纯标签串，文本分支一字未动）。
// 宽召回是显式档：默认窄召回，标签行与旧版同规模（用户拍板：默认只多出「自审」这一样产物），
// 要更全的候选池写 --broad / --no-broad 与默认同档。
const isImageInput = !!opt.spec;
const gapsSet = 'gaps' in opt;
if (isImageInput) {
  if (!gapsSet) { opt.gaps = true; opt.alternatives = true; }
  opt.imageSpecDefault = !gapsSet && opt.broad !== true;   // 供文档/调试判断是否走了默认档
}

/** 缺项提示打到 stderr：一行摘要 + 缺口条数 + 观察缺项的建议写法（stdout 保持干净） */
function printGapHints(out, where = '') {
  if (!out || !out.gapsSummary) return;
  const s = out.gapsSummary;
  const kinds = Object.entries(s.byKind || {}).map(([k, v]) => `${k} ${v}`).join(' · ');
  const why = s.specIssues && s.specIssues.length ? '（观察 JSON 有必填维度没落成结构化字段）' : '（可用 --format gaps 看候选项）';
  console.error(`[缺项自审] 缺口 ${s.total} 条：${kinds || '无'}${where ? ' ' + where : ''}${why}`);
  // 全量打印观察缺项（上限由 REQUIRED_OBSERVATIONS 定死，共 9 条）：
  // 截断会正好吞掉低严重度的 outfit.footwear / pose.action / style.camera，
  // 而它们是「没有专属载体、最容易被漏写」的维度，最需要看见建议写法。
  for (const i of (s.specIssues || [])) {
    console.error(`  - ${i.key}（${i.label} / ${i.severity}）：${i.advice}`);
  }
  if (s.notesText) {
    console.error('  - notes 只当日志，不产标签；要落标签请写进结构化字段（--template 可看模板）');
  }
}

/** 同一个摘要的 markdown 版（贴进报告里，省得再单独跑 --format gaps） */
function printGapSummaryMd(s) {
  const kinds = Object.entries(s.byKind || {}).map(([k, v]) => `${k} ${v}`).join(' · ');
  console.log(`## 缺项自审摘要（缺口 ${s.total} 条）`);
  console.log('');
  console.log(`- 分类：${kinds || '无'}`);
  if (s.specIssues && s.specIssues.length) {
    console.log(`- 观察缺项 ${s.specIssues.length} 条（必填维度没落成结构化字段）：`);
    // 同上：全量打印（9 条上限），保证 style.camera / pose.action / outfit.footwear 的建议写法可见
    for (const i of s.specIssues) console.log(`  - \`${i.key}\`（${i.label} / ${i.severity}）：${i.advice}`);
  }
  if (s.notesText) console.log(`- notes（纯日志，未参与匹配）：${s.notesText}`);
  console.log('');
}

const HELP = `Anima 标签反推 · rtag
用法
  node bin/rtag.mjs "自然语言描述"                文本 → 单行标签串
  node bin/rtag.mjs --file 描述.txt               从文件读描述
  node bin/rtag.mjs -                             从 stdin 读描述
  node bin/rtag.mjs --image-spec 观察.json        图像观察结果 → 标签（默认带缺项自审）
  node bin/rtag.mjs --search "blue eyes"          单条检索
  node bin/rtag.mjs --info                        词库概况
  node bin/rtag.mjs --template                    打印图像观察模板
  node bin/rtag.mjs --nl-template                 打印英文自然语言句子骨架
  node bin/rtag.mjs "…" --nl                      文本 → 英文自然语言提示词
  node bin/rtag.mjs "…" --gaps                    文本 → 缺项清单与候选项（供勾选补全）
  node bin/rtag.mjs "…" --broad --gaps            宽召回后再列缺项（候选更多）
  node bin/rtag.mjs "…" --check                   自审：标签 + 缺项清单一并输出

选项
  --format tags      单行逗号分隔的纯标签串（默认；别名 line / bare）
  --format bare      单行纯标签串，与默认的 tags 同义（别名）
  --format prompt    单行正向串，带官方前缀（masterpiece, best quality, score_7, 分级 token）
  --format negative  只要负向串
  --format json      结构化结果（分层 / 分数 / 频次 / 置信度；图像入口附带 gaps / gapsSummary）
  --format md        人类可读的分层报告（图像入口附带缺项摘要）
  --format nl        英文自然语言提示词（标签前缀行 + 逐角色句 + 场景句）
  --format gaps      缺项清单与候选项（markdown 勾选表）
  --format check     tags + nl + gaps 一次给全
  --rating R         手动指定分级：safe|sensitive|questionable|nsfw|explicit（默认按内容自动升级）
  --top N            最多输出多少条标签（默认 40）
  --per-clause N     每个分句保留几个候选（默认 3）
  --min S            最低得分阈值（默认 0.46）
  --min-sim S        纯相似度路径的下限（默认 0.52）
  --max-per-layer N  每层上限（默认 24）
  --broad            宽召回档：阈值放宽、候选池扩大（默认关闭，图像入口也一样；--no-broad 与默认同档）
  --gaps / --check   输出缺项清单（未匹配 / 关键层为空 / 粒度不足 / 观察缺项缺失 / 多主体不全 / 同维度冲突）
  --no-gaps          关掉缺项自审（图像入口默认开；显式 --format gaps / --check 时无效）
  --nl               输出英文自然语言提示词
  --no-tags          自然语言里不再句末附标签兜底串
  --max-per-sentence N  每句最多几个短语（默认 12；层内按分数取前 N）
  --no-prefix        不加官方正向前缀
  --prefix "…"       自定义正向前缀
  --negative "…"     自定义负向串
  --kb DIR           指定 画师类 目录（默认自动定位：--kb > ANIMA_KB_DIR > kb-path.json > 仓库 > 家目录 > cwd）

图像入口的默认档（与文本入口不同，仅限 --image-spec）
  1. 缺项自审默认开启：结果对象上始终有 gaps / gapsSummary / gapsMarkdown，
     并把一行缺项摘要与「观察缺项的建议写法」打到 stderr（stdout 仍是单行纯标签串）；
     --no-gaps 可关掉（显式 --format gaps / --check 不受它影响，仍出缺口）。
  2. 宽召回默认关闭（图像入口也一样）：默认走窄召回，标签行与旧版同规模；
     要更全的候选池（例如让缺项候选更多）显式写 --broad。
  3. notes 是纯日志：写在 notes 里的观察不产出标签、不参与匹配，只回显在 plan.notesText；
     要落标签必须写进结构化字段，否则会被列成 C-spec-* 观察缺项。
  文本入口的默认档没有任何变化（不传对应开关时行为与旧版一致）。
`;

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return stripBom(Buffer.concat(chunks).toString('utf8'));
}

/** Windows 上记事本 / PowerShell 存出的 UTF-8 常带 BOM，JSON.parse 会直接报错 */
function stripBom(s) {
  return s && s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function printSearch(list) {
  if (!list.length) { console.log('（没有命中）'); return; }
  const w = Math.max(...list.map(t => t.tag.length), 4);
  for (const t of list) {
    console.log(
      `${t.tag.padEnd(w)}  ${String(t.zh || '').slice(0, 18).padEnd(20)} ` +
      `score ${t.score.toFixed(2)}  sim ${t.sim.toFixed(2)}  ${t.freqStr || '-'}  ${t.conf}  ${t.layerName}`
    );
  }
}

async function main() {
  if (opt.help) { console.log(HELP); return; }
  if (opt.template) { console.log(JSON.stringify(emptySpec(), null, 2)); return; }
  if (opt.nlTemplate) { console.log(nlTemplate()); return; }

  if (opt.info) {
    const info = kbInfo(opt.kbDir);
    console.log('词库：' + info.kbDir);
    for (const [k, v] of Object.entries(info)) {
      if (k !== 'kbDir') console.log(`  ${k}: ${v}`);
    }
    return;
  }

  if (opt.search) {
    console.log(`检索「${opt.search}」：`);
    printSearch(searchTags(opt.search, { limit: opt.top || 10, kbDir: opt.kbDir }));
    return;
  }

  let input = null;
  if (opt.spec) {
    const raw = opt.spec === '-' ? await readStdin() : stripBom(fs.readFileSync(path.resolve(opt.spec), 'utf8'));
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      console.error('出错：图像规格不是合法 JSON（' + e.message + '）');
      process.exitCode = 1;
      return;
    }
    input = { imageSpec: parsed };
  } else {
    let text = positional.join(' ').trim();
    if (!text && opt.file) text = stripBom(fs.readFileSync(path.resolve(opt.file), 'utf8'));
    if (!text && opt.stdin) text = await readStdin();
    if (!text) { console.error(HELP); process.exitCode = 1; return; }
    input = { text };
  }

  const t0 = Date.now();
  const out = reverse(input, opt);
  const ms = Date.now() - t0;

  // 图像入口：缺项提示自动去 stderr（不污染 stdout 的标签串）
  if (isImageInput) printGapHints(out, opt.imageSpecDefault ? '｜默认档' : '');

  if (opt.format === 'json') {
    const j = { ...out.json, elapsedMs: ms };
    if (out.gaps) { j.gaps = out.gaps; j.gapsSummary = out.gapsSummary; j.gapsMarkdown = out.gapsMarkdown; }
    if (out.alternatives) j.alternatives = out.alternatives;
    if (out.nl) j.naturalLanguage = out.nl;
    console.log(JSON.stringify(j, null, 2));
    return;
  }
  // 默认交付形态：单行、逗号分隔、纯标签（不带官方质量前缀）；bare 是同义别名
  if (opt.format === 'tags' || opt.format === 'line' || opt.format === 'bare') { console.log(out.bare); return; }
  // 需要官方前缀时用 prompt（前缀 + 标签，分级 token 已按内容自动适配）
  if (opt.format === 'prompt') { console.log(out.prompt); return; }
  if (opt.format === 'negative') { console.log(out.negative); return; }
  // 英文自然语言分支
  if (opt.format === 'nl') { console.log(out.nl ? out.nl.text : '（未生成自然语言，请加 --nl）'); return; }
  // 缺项清单
  if (opt.format === 'gaps') { console.log(out.gapsMarkdown || '（没有缺项）'); return; }
  // 一次给全：标签 + 自然语言 + 缺项清单
  if (opt.format === 'check') {
    console.log('## 标签串');
    console.log('```');
    console.log(out.prompt);
    console.log('```');
    console.log('');
    console.log('## 负向串');
    console.log('```');
    console.log(out.negative);
    console.log('```');
    console.log('');
    console.log('## 英文自然语言');
    console.log('```');
    console.log(out.nl ? out.nl.text : '（未生成）');
    console.log('```');
    if (out.nl && out.nl.meta && out.nl.meta.fallback.length) {
      console.log('');
      console.log('（以下标签没有专属措辞，以原文出现在句子里：' + out.nl.meta.fallback.map(t => '`' + t + '`').join('、') + '）');
    }
    console.log('');
    console.log(out.gapsMarkdown || '（缺项检测未运行）');
    return;
  }

  const used = out.layers.filter(l => l.tags.length);
  console.log(`# 反推结果（${out.stats.used} 条 / 候选池 ${out.stats.total} 条 / 分级 ${out.rating} / ${ms}ms）`);
  console.log('');
  console.log('## 正向串');
  console.log('```');
  console.log(out.prompt);
  console.log('```');
  for (const l of used) {
    console.log('');
    console.log(`## ${l.layer}·${l.name}（${l.tags.length}）`);
    for (const t of l.tags) {
      console.log(`- \`${t.tag}\`${t.zh ? '（' + t.zh + '）' : ''} · ${t.score.toFixed(2)} · ${t.freqStr} · ${t.conf}${t.reason.startsWith('forced') || t.reason.startsWith('jp') ? ' · ' + t.reason : ''}`);
    }
  }
  console.log('');
  console.log('## 负向串');
  console.log('```');
  console.log(out.negative);
  console.log('```');
  if (out.unmatched.length) {
    console.log('');
    console.log('## 未匹配片段（词库里没有，需人工确认）');
    console.log(out.unmatched.map(s => '`' + s + '`').join('、'));
  }
  if (out.gapsMarkdown) {
    console.log('');
    // 图像入口：md 报告里也要有缺口信息，不用再单独跑 --format gaps
    if (out.gapsSummary) printGapSummaryMd(out.gapsSummary);
    console.log(out.gapsMarkdown);
  }
}

main().catch(e => { console.error('出错：' + e.message); if (process.env.RTAG_DEBUG) console.error(e.stack); process.exitCode = 1; });
