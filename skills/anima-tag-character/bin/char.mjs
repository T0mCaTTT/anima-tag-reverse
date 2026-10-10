#!/usr/bin/env node
/**
 * char.mjs —— 「具体作品 + 具体角色」→ 精确 Danbooru 标签
 *
 * 默认输出与另外两个技能一致：**一行逗号分隔的纯标签串**（stdout 干净），
 * 说明、候选、消歧提示全部走 stderr。
 *
 *   node bin/char.mjs 可莉 --series 原神                     # → klee (genshin impact), genshin impact
 *   node bin/char.mjs "klee (genshin impact)"                # → 同上（英文写法也认）
 *   node bin/char.mjs "《原神》的可莉"                        # → 同上（书名号 + 「的」也认）
 *   node bin/char.mjs 胡桃 -s 原神 --format md               # 消歧报告（同名角色会被列出来）
 *   node bin/char.mjs series 原神 --limit 30                 # 该作品下的角色清单
 *   node bin/char.mjs search 灵梦                             # 通用检索
 *   node bin/char.mjs verify "hakurei reimu"                 # 校验一个候选标签
 *   node bin/char.mjs patch 观察.json --out 修正.json         # 把观察 JSON 里的中文角色名改对
 *   node bin/char.mjs --info                                 # 词库概况
 *
 * 退出码：0 高置信 / 3 需要确认（低置信或有多个候选）/ 4 没找到 / 2 参数错误。
 * 这个约定让会话里的我可以「先跑一次看码，再决定要不要追问用户」。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  loadKb, kbInfo, resolveCharacter, resolveSeries, charactersOf, verifyTag, searchNames,
  patchSpec, buildPair, toTag,
  renderResolve, renderVerify, renderSeries, renderSearch, renderInfo, renderPatch
} from '../src/index.mjs';

const argv = process.argv.slice(2);
const opt = { format: 'tags', top: 5, limit: 20, sort: 'freq', kind: 'any', minScore: 0.85 };
const positional = [];

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const next = () => argv[++i];
  switch (a) {
    case '--series': case '-s': opt.series = next(); break;
    case '--format': opt.format = next(); break;
    case '--kb': opt.kbDir = next(); break;
    case '--top': opt.top = parseInt(next(), 10); break;
    case '--limit': opt.limit = parseInt(next(), 10); break;
    case '--sort': opt.sort = next(); break;
    case '--kind': opt.kind = next(); break;
    case '--min-score': opt.minScore = parseFloat(next()); break;
    case '--no-series': opt.withSeries = false; break;
    case '--out': opt.out = next(); break;
    case '--dry-run': opt.dryRun = true; break;
    case '--info': opt.info = true; break;
    case '-h': case '--help': opt.help = true; break;
    default: positional.push(a);
  }
}

const USAGE = `「具体作品 + 具体角色」→ 精确 Danbooru 标签

用法：
  node bin/char.mjs <角色名> [--series <作品>] [--format tags|md|json]
  node bin/char.mjs series <作品> [--limit 30] [--sort freq|name]
  node bin/char.mjs search <关键词> [--kind any|character|series]
  node bin/char.mjs verify <候选标签>
  node bin/char.mjs patch <观察.json> [--out 修正.json] [--dry-run]
  node bin/char.mjs --info

示例：
  node bin/char.mjs 可莉 -s 原神                → klee (genshin impact), genshin impact
  node bin/char.mjs "《原神》的可莉"             → 同上
  node bin/char.mjs 胡桃 -s 原神 --format md     → 消歧报告（列出被排除的同名角色）
  node bin/char.mjs series 蔚蓝档案 --limit 30   → 该作品下的角色清单（让你挑）
  node bin/char.mjs verify "hakurei reimu"      → 校验候选标签是否存在、属于哪个作品
  node bin/char.mjs patch 观察.json --out 修正.json

参数：
  -s, --series <作品>   指定作品（消歧的关键：归属对不上会直接排除）
  --format <形态>       tags(默认) | md | json
  --top <n>             候选数（默认 5）
  --limit <n>           series/search 的条数（默认 20）
  --no-series           输出不带作品标签
  --min-score <0-1>     判定为「可靠」的阈值（默认 0.85）
  --kb <目录>           指定词库目录

退出码：0 高置信 / 3 需要确认 / 4 没找到 / 2 参数错误`;

if (opt.help) { console.log(USAGE); process.exit(0); }

const kb = loadKb({ kbDir: opt.kbDir });

if (opt.info) { console.log(renderInfo(kbInfo({ kbDir: opt.kbDir }))); process.exit(0); }

const cmd = positional[0] === 'series' || positional[0] === 'search' || positional[0] === 'verify' || positional[0] === 'patch' || positional[0] === 'resolve'
  ? positional.shift()
  : 'resolve';
const arg = positional.join(' ').trim();

function out(text, { code = 0 } = {}) {
  if (opt.out) {
    const p = path.resolve(process.cwd(), opt.out);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text.endsWith('\n') ? text : text + '\n', 'utf8');
    console.error(`[写入] ${p}`);
  } else {
    console.log(text);
  }
  process.exit(code);
}

if (!arg) { console.error('[错误] 缺少参数。\n'); console.error(USAGE); process.exit(2); }

switch (cmd) {
  // ---------------- resolve ----------------
  case 'resolve': {
    const r = resolveCharacter(arg, { kb, series: opt.series, top: opt.top });
    if (opt.format === 'md') { console.log(renderResolve(r)); process.exit(r.best && r.best.score >= opt.minScore ? 0 : (r.best ? 3 : 4)); }
    if (opt.format === 'json') { out(JSON.stringify({ best: r.best, series: r.series, candidates: r.candidates, rejected: r.rejected, notes: r.notes }, null, 2)); }

    const built = buildPair(arg, { kb, series: opt.series, withSeries: opt.withSeries !== false });
    const L = [];
    if (r.series) L.push(`[角色] 作品：${r.series.tag}（${r.series.zh || '无中文'}）— ${r.series.via}，置信度 ${Math.round(r.series.score * 100)}%`);
    if (!built.ok) {
      L.push(`[角色] 词库里没有「${arg}」（精选库 5713 个角色）。`);
      for (const n of r.notes) L.push(`  - ${n}`);
      if (r.candidates.length) {
        L.push('  最接近的候选（都不是它，请确认）：');
        for (const c of r.candidates.slice(0, 3)) L.push(`  - ${toTag(c.tag)}${c.zh ? `（${c.zh}）` : ''}${c.series ? ` — ${c.series}` : ''} ${Math.round(c.score * 100)}%`);
      }
      console.error(L.join('\n'));
      process.exit(4);
    }
    L.push(`[角色] ${toTag(r.best.tag)}${r.best.zh ? `（${r.best.zh}）` : ''}${r.best.series ? ` — 属于 ${r.best.series}（${r.best.seriesVia}）` : ' — 词库未标注作品'}｜置信度 ${Math.round(r.best.score * 100)}%`);
    if (r.candidates.length > 1) {
      L.push(`  其他候选：${r.candidates.slice(1, 4).map(c => `${toTag(c.tag)}${c.zh ? `（${c.zh}）` : ''}${c.series ? `/${c.series}` : ''} ${Math.round(c.score * 100)}%`).join('；')}`);
    }
    for (const x of r.rejected.slice(0, 3)) L.push(`  已排除（属于别的作品）：${toTag(x.tag)}（${x.zh}）— ${x.series}`);
    for (const n of r.notes) L.push(`  - ${n}`);
    // 判定：达到阈值 → 直接交付；只有唯一候选且分数不低（多为前缀/部分匹配，如「玛修」→ mash kyrielight）
    // → 也交付，但在 stderr 说明是部分匹配；否则退出码 3 让人确认。
    // 只数**主标签**候选：变体（(cosplay)/(pc-98) 这类）不算竞品，
    // 否则「玛修」会因为旁边挂着 mash kyrielight (demi-servant) 而被判成「有多个候选」。
    const mains = r.candidates.filter(c => !c.variant);
    const single = mains.length === 1 && built.score >= 0.7;
    if (r.seriesFailed) L.push('  ⚠ 你指定的作品没解析出来，上面的结果**没有**做作品消歧，请确认。');
    if (!(built.score >= opt.minScore) && single) L.push(`  注：这是唯一候选，按部分匹配交付（${Math.round(built.score * 100)}%）。`);
    console.error(L.join('\n'));
    out(built.tags, { code: r.seriesFailed ? 3 : ((built.score >= opt.minScore || single) ? 0 : 3) });
    break;
  }

  // ---------------- series ----------------
  case 'series': {
    const s = charactersOf(arg, { kb, limit: opt.limit, sort: opt.sort });
    if (!s.series) { console.error(`[错误] ${s.note || `作品「${arg}」不在词库里`}`); process.exit(4); }
    if (opt.format === 'md') { console.log(renderSeries(s)); process.exit(0); }
    if (opt.format === 'json') { out(JSON.stringify(s, null, 2)); }
    console.error(`[作品] ${s.series.tag}（${s.series.zh || '无中文'}）｜词库收录 ${s.total} 个角色，显示前 ${s.characters.length} 个${s.note ? `｜${s.note}` : ''}`);
    out(s.characters.map(c => toTag(c.tag)).join(', '));
    break;
  }

  // ---------------- search ----------------
  case 'search': {
    const list = searchNames(arg, { kb, kind: opt.kind, limit: opt.limit });
    if (opt.format === 'md') { console.log(renderSearch(list, arg)); process.exit(list.length ? 0 : 4); }
    if (opt.format === 'json') { out(JSON.stringify(list, null, 2)); }
    if (!list.length) { console.error(`[检索] 没有命中「${arg}」`); process.exit(4); }
    console.error(`[检索] ${arg} → ${list.length} 条`);
    out(list.map(x => toTag(x.tag)).join(', '));
    break;
  }

  // ---------------- verify ----------------
  case 'verify': {
    const v = verifyTag(arg, { kb });
    if (opt.format === 'md') { console.log(renderVerify(v)); process.exit(v.found ? 0 : 4); }
    if (opt.format === 'json') { out(JSON.stringify(v, null, 2)); }
    if (!v.found) {
      console.error(`[校验] 「${arg}」不在词库里。${v.near.length ? `相近：${v.near.map(n => toTag(n.tag)).join(', ')}` : '没有相近候选。'}`);
      process.exit(4);
    }
    const bits = [`[校验] ${v.kind === 'character' ? '角色' : '作品'}：${toTag(v.tag)}`];
    if (v.zh) bits.push(`中文 ${v.zh}`);
    if (v.series) bits.push(`作品 ${v.series}（${v.seriesVia}）`);
    if (v.variant) bits.push('⚠ 异体/形态标签');
    if (v.hasSeriesInTag) bits.push('标签自带作品括号');
    console.error(bits.join('｜'));
    out(toTag(v.tag));
    break;
  }

  // ---------------- patch ----------------
  case 'patch': {
    const p = path.resolve(process.cwd(), arg);
    if (!fs.existsSync(p)) { console.error(`[错误] 观察文件不存在：${p}`); process.exit(2); }
    let spec;
    try { spec = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { console.error(`[错误] 不是合法 JSON：${e.message}`); process.exit(2); }
    const res = patchSpec(spec, { kb, series: opt.series, confidence: opt.minScore });
    if (opt.dryRun) { console.log(renderPatch(res)); process.exit(res.unresolved.length ? 3 : 0); }
    if (opt.format === 'md') { console.log(renderPatch(res)); process.exit(res.unresolved.length ? 3 : 0); }
    console.error(renderPatch(res));
    out(JSON.stringify(res.spec, null, 2), { code: res.unresolved.length ? 3 : 0 });
    break;
  }

  default:
    console.error(`[错误] 未知子命令：${cmd}\n`);
    console.error(USAGE);
    process.exit(2);
}
