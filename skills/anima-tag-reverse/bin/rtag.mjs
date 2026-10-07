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
import { getLexicon, reverse, searchTags, kbInfo, emptySpec, LAYER_NAME } from '../src/index.mjs';

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
    case '-h': case '--help': opt.help = true; break;
    case '-': opt.stdin = true; break;
    default: positional.push(a);
  }
}

const HELP = `Anima 标签反推 · rtag

用法
  node bin/rtag.mjs "自然语言描述"                文本 → 单行标签串
  node bin/rtag.mjs --file 描述.txt               从文件读描述
  node bin/rtag.mjs -                             从 stdin 读描述
  node bin/rtag.mjs --image-spec 观察.json        图像观察结果 → 标签
  node bin/rtag.mjs --search "blue eyes"          单条检索
  node bin/rtag.mjs --info                        词库概况
  node bin/rtag.mjs --template                    打印图像观察模板

选项
  --format tags      单行逗号分隔的纯标签串（默认；别名 line / bare）
  --format bare      单行纯标签串，与默认的 tags 同义（别名）
  --format prompt    单行正向串，带官方前缀（masterpiece, best quality, score_7, 分级 token）
  --format negative  只要负向串
  --format json      结构化结果（分层 / 分数 / 频次 / 置信度）
  --format md        人类可读的分层报告
  --rating R         手动指定分级：safe|sensitive|questionable|nsfw|explicit（默认按内容自动升级）
  --top N            最多输出多少条标签（默认 40）
  --per-clause N     每个分句保留几个候选（默认 3）
  --min S            最低得分阈值（默认 0.46）
  --min-sim S        纯相似度路径的下限（默认 0.52）
  --max-per-layer N  每层上限（默认 24）
  --no-prefix        不加官方正向前缀
  --prefix "…"       自定义正向前缀
  --negative "…"     自定义负向串
  --kb DIR           指定 画师类 目录（默认自动定位：--kb > ANIMA_KB_DIR > kb-path.json > 仓库 > 家目录 > cwd）
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

  if (opt.format === 'json') {
    console.log(JSON.stringify({ ...out.json, elapsedMs: ms }, null, 2));
    return;
  }
  // 默认交付形态：单行、逗号分隔、纯标签（不带官方质量前缀）；bare 是同义别名
  if (opt.format === 'tags' || opt.format === 'line' || opt.format === 'bare') { console.log(out.bare); return; }
  // 需要官方前缀时用 prompt（前缀 + 标签，分级 token 已按内容自动适配）
  if (opt.format === 'prompt') { console.log(out.prompt); return; }
  if (opt.format === 'negative') { console.log(out.negative); return; }

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
}

main().catch(e => { console.error('出错：' + e.message); if (process.env.RTAG_DEBUG) console.error(e.stack); process.exitCode = 1; });
