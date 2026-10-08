// fat-tags-attrib.mjs — 诊断工具（非断言套件）：把「变胖」逐条归因到机制层
//
// 输入：fat-tags.diag.mjs 产出的 fat-tags-audit.json（只读其中「有差异」的条目）
// 做法：对每条有差异的输入，用 RTAG_DEBUG=1 跑当前仓库 CLI，抓 stderr 里的机制行：
//         [rtag] clause N norm ... forced [...]        → 规则层强制词条（clause.forced）
//         [rtag] rules {"literals":[...],"ruleTerms":[...]} → 去冗余块看到的逐字命中与规则词条
//         [rtag] cands [...] [rtag] generic [...] [rtag] kept [...]
//       再与 JSON 明细里每个新增标签的 reason 对照，给出机制标签与原始证据。
//
// 用法：
//   node tests/fat-tags-attrib.mjs --in <fat-tags-audit.json> --out <输出目录>
//
// 输出：
//   <out>/fat-tags-attrib.json   逐条归因原始数据（含 forced / generic / kept / 候选 reason）
//   <out>/fat-tags-attrib.md     中文归因表
//   stdout 打印机制分布摘要。
//
// 注意：旧快照没有 RTAG_DEBUG 开关，所以老侧只能靠 fat-tags-audit.json 里的 --format json 明细
//      （tag / reason / sim / score / via 都在 detail.old.tags 里）。

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i += 1; }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.in) {
  console.error('用法：node tests/fat-tags-attrib.mjs --in <fat-tags-audit.json> [--out <目录>]');
  process.exit(2);
}
const IN = resolve(String(args.in));
const OUT_DIR = resolve(String(args.out || dirname(IN)));
const audit = JSON.parse(readFileSync(IN, 'utf8'));
const NEW_DIR = audit.meta.newDir;
const KB = audit.meta.kb;

/** 跑当前仓库 CLI，带 RTAG_DEBUG=1，返回 stdout 标签行与 stderr 机制行 */
function debugRun(text) {
  const cli = join(NEW_DIR, 'bin', 'rtag.mjs');
  const r = spawnSync(process.execPath, [cli, '--kb', KB, '--format', 'tags', text], {
    cwd: NEW_DIR,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, RTAG_DEBUG: '1' },
  });
  const stdout = (r.stdout || '').replace(/\r\n/g, '\n');
  const stderr = (r.stderr || '').replace(/\r\n/g, '\n');
  // 调试行分两处：matchPlan 的 clause 行走 stdout（console.log），其余走 stderr（console.error）
  const line = stdout.split('\n').find((l) => l.trim() !== '' && !l.startsWith('[rtag]')) || '';
  const clauses = [];
  let rules = null;
  let cands = null;
  let generic = null;
  let kept = null;
  for (const raw of `${stdout}\n${stderr}`.split('\n')) {
    const l = raw.trim();
    const m = l.match(/^\[rtag\] clause (\d+) norm ("(?:[^"\\]|\\.)*") forced (.*?) (?:→|->|â†’) (.*)$/);
    if (m) {
      const norm = JSON.parse(m[2]);
      const forced = m[3].trim().startsWith('[') ? JSON.parse(m[3]) : [];
      const keptTags = m[4].trim().startsWith('[') ? JSON.parse(m[4]) : [];
      clauses.push({ index: Number(m[1]), norm, forced, kept: keptTags });
      continue;
    }
    if (l.startsWith('[rtag] rules ')) { rules = JSON.parse(l.slice('[rtag] rules '.length)); continue; }
    if (l.startsWith('[rtag] cands ')) { cands = JSON.parse(l.slice('[rtag] cands '.length)); continue; }
    if (l.startsWith('[rtag] generic ')) { generic = JSON.parse(l.slice('[rtag] generic '.length)); continue; }
    if (l.startsWith('[rtag] kept ')) { kept = JSON.parse(l.slice('[rtag] kept '.length)); continue; }
  }
  // cands 行格式：`tag|reason|via|sim`（forced 项另有 |F 标记）→ 拆出每个候选的 via
  const candMap = new Map();
  for (const c of cands || []) {
    const parts = String(c).split('|');
    candMap.set(parts[0], { reason: parts[1], via: parts[2] === '-' ? '' : parts[2], sim: parts[3] ? Number(parts[3]) : null });
  }
  return { line, clauses, rules, cands, candMap, generic, kept, stderr };
}

/** via 与输入是否共享 2 字中文/日文片段（判断「这条 via 就是用户说的那个词」） */
function sharesCjkRun(a, b) {
  if (!a || !b) return false;
  const runs = String(a).match(/[\u4e00-\u9fff\u3040-\u30ff]{2,}/g) || [];
  for (const r of runs) {
    for (let i = 0; i + 2 <= r.length; i += 1) {
      if (String(b).includes(r.slice(i, i + 2))) return true;
    }
  }
  return false;
}

const rows = [];
const mechCount = new Map();
for (const c of audit.cases) {
  if (c.same) continue;
  const dbg = debugRun(c.text);
  const newDetail = new Map((c.detail?.new?.tags || []).map((t) => [t.tag, t]));
  const oldDetail = new Map((c.detail?.old?.tags || []).map((t) => [t.tag, t]));
  const forcedAll = dbg.clauses.flatMap((x) => x.forced || []);
  const generic = dbg.generic || [];
  const entries = c.added.map((tag) => {
    const n = newDetail.get(tag) || null;
    const cd = dbg.candMap.get(tag) || null;
    const via = cd?.via || '';
    let mech;
    if (n && /^(forced|rule):/.test(n.reason)) mech = 'M1-规则层强制词条';
    else if (n && /^sim$/.test(n.reason)) {
      // 锚点丢失：这条 sim 命中的 via 就是用户原话里的词，而新侧泛词锚点是空的
      // （旧版这条 via 会被记成泛词，再按变体压制把同族长标签压掉）
      const anchored = sharesCjkRun(via, c.text);
      if (anchored && generic.length === 0) mech = 'M2-泛词锚点丢失（via 是用户原词但没进泛词表）';
      else if (anchored && !generic.some((g) => sharesCjkRun(g, via))) mech = 'M2b-泛词表没收到这个词';
      else mech = 'M3-相似路径过门槛（压制未覆盖）';
    } else mech = 'M4-其他';
    mechCount.set(mech, (mechCount.get(mech) || 0) + 1);
    return {
      tag,
      mech,
      newReason: n?.reason ?? null,
      newVia: via || null,
      newSim: n?.sim ?? null,
      newScore: n?.score ?? null,
      oldSideSameFamily: [...oldDetail.keys()].filter((k) => k !== tag && k.split(' ').some((w) => tag.split(' ').includes(w))),
    };
  });
  rows.push({
    id: c.id,
    group: c.group,
    text: c.text,
    oldLine: c.oldLine,
    newLine: c.newLine,
    added: entries,
    removed: c.removed,
    forced: forcedAll,
    ruleTerms: dbg.rules?.ruleTerms || [],
    literals: dbg.rules?.literals || [],
    generic,
    kept: dbg.kept,
    clauseNorm: dbg.clauses.map((x) => x.norm),
  });
  process.stdout.write(`[attrib] ${c.id} +${c.added.length} forced=${JSON.stringify(forcedAll)} generic=${JSON.stringify(generic)}\n`);
}

// 机制分布（按新增标签计）
const totalAdded = rows.reduce((n, r) => n + r.added.length, 0);
const mechLine = [...mechCount.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join('；');

mkdirSync(OUT_DIR, { recursive: true });
const jsonPath = join(OUT_DIR, 'fat-tags-attrib.json');
writeFileSync(jsonPath, JSON.stringify({ meta: { from: IN, generatedAt: new Date().toISOString() }, mechanismByAddedTag: mechCount.size ? Object.fromEntries(mechCount) : {}, totalAdded, rows }, null, 2), 'utf8');

const MD = [];
MD.push('# 「变胖标签」机制归因表');
MD.push('');
MD.push(`来源：\`${IN}\`；对每条有差异的输入用 \`RTAG_DEBUG=1\` 复跑当前仓库 CLI 抓 \`clause.forced\` / \`rules\` / \`generic\` / \`kept\`。`);
MD.push('');
MD.push(`新增标签合计 ${totalAdded} 个；机制分布：${mechLine || '无'}`);
MD.push('');
MD.push('| id | 输入 | 新增标签 | 机制 | 新侧 reason@score（via） | 该分句被强制的词条（规则层） | generic（泛词锚点） |');
MD.push('| --- | --- | --- | --- | --- | --- | --- |');
for (const r of rows) {
  const esc = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|');
  if (r.added.length === 0) {
    MD.push(`| ${r.id} | ${esc(r.text)} | （无新增，只有减少） | - | - | ${esc(JSON.stringify(r.forced))} | ${esc(JSON.stringify(r.generic))} |`);
    continue;
  }
  MD.push(`| ${r.id} | ${esc(r.text)} | ${esc(r.added.map((a) => a.tag).join(', '))} | ${esc(r.added.map((a) => a.mech).join(' / '))} | ${esc(r.added.map((a) => `${a.tag}:${a.newReason}@${a.newScore}（via ${a.newVia || '-'}）`).join(' ; '))} | ${esc(JSON.stringify(r.forced))} | ${esc(JSON.stringify(r.generic))} |`);
}
const mdPath = join(OUT_DIR, 'fat-tags-attrib.md');
writeFileSync(mdPath, `${MD.join('\n')}\n`, 'utf8');

process.stdout.write(`\nMECH totalAdded=${totalAdded} :: ${mechLine}\n`);
process.stdout.write(`OUT ${jsonPath}\nOUT ${mdPath}\n`);
