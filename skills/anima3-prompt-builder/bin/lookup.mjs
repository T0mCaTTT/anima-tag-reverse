#!/usr/bin/env node
/**
 * lookup.mjs —— 借用 anima-tag-reverse 的本地词库做「标签体检」
 *
 * 用途：模板本身是纯规则文本，不联网也不查库。生成完一行 prompt 后，
 * 可以用本脚本逐条查本地 38,306 条词库，标出：
 *   ✓ 库中有（附中文释义与投稿量，判断是否冷门/写错）
 *   ✗ 库中没有（可能是拼写错误，或模板里的自造标签）
 *
 * 注意：模板§6-13 里的标签是从实战 prompt 统计来的，**不保证都在本词库里**；
 * 「库中没有」只代表本词库没收录，不等于标签错误，仅作参考提示。
 *
 * 用法：
 *   node lookup.mjs "masterpiece, best quality, ..., @eonsang, ..."
 *   node lookup.mjs --file prompt.txt
 *   node lookup.mjs "..." --missing-only      # 只列没命中的
 *   node lookup.mjs "..." --json
 *
 * 退出码：0 恒为 0（这是体检，不是门禁）；有硬错误才会非 0。
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

// ---- 定位 anima-tag-reverse 词库 -------------------------------------------
const __self = path.dirname(fileURLToPath(import.meta.url));

/** 从本文件向上回溯到仓库根（含 skills/ 的那一层） */
function repoRoot() {
  let d = __self;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(d, 'skills'))) return d;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return null;
}

function resolveReverseSkill() {
  const _root = repoRoot();
  const candidates = [
    process.env.ANIMA_REVERSE_SKILL,
    // 同仓库的姊妹技能（克隆下来即可用）
    _root && path.join(_root, 'skills/anima-tag-reverse'),
    // 装到 DSH 技能目录时的常态
    path.join(process.env.HOME || '', '.dsh/skills/anima-tag-reverse'),
  ].filter(Boolean);
  for (const c of candidates) {
    try { if (fs.statSync(path.join(c, 'src/index.mjs')).isFile()) return c; } catch { /* 继续找 */ }
  }
  return null;
}

const skillDir = resolveReverseSkill();
if (!skillDir) {
  console.error('找不到 anima-tag-reverse 技能目录。设置 ANIMA_REVERSE_SKILL 环境变量指向它。');
  process.exit(2);
}

const { searchTags, getLexicon, kbInfo } = await import(path.join(skillDir, 'src/index.mjs'));

// ---- 解析 ------------------------------------------------------------------
function parseArgs(argv) {
  const out = { input: '', json: false, missingOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') { out.json = true; continue; }
    if (a === '--missing-only') { out.missingOnly = true; continue; }
    if (a === '--file') { out.input = fs.readFileSync(argv[++i], 'utf8'); continue; }
    if (a === '-') { out.input = fs.readFileSync(0, 'utf8'); continue; }
    out.input += (out.input ? ' ' : '') + a;
  }
  return out;
}

// 质量词/评分/画师/权重语法不查库（不是内容标签）
const SKIP_RE = /^(masterpiece|best quality|highres|newest|absurdres|high detail|score_\d+|@.+)$/;

const args = parseArgs(process.argv.slice(2));
if (!args.input.trim()) {
  console.error('用法：node lookup.mjs "prompt" [--missing-only] [--json] | --file <path>');
  process.exit(2);
}

const tags = args.input.split(',').map(s => s.trim()).filter(Boolean);
const results = [];

for (const raw of tags) {
  const t = raw.replace(/^\(+/, '').replace(/\)+$/, '').replace(/:\s*[\d.]+$/, '').trim();
  const low = t.toLowerCase();

  if (SKIP_RE.test(low)) {
    results.push({ tag: t, status: 'skip', note: '质量词/画师/评分，不查库' });
    continue;
  }

  // @画师名：词库里有画师目录，试查一次
  const q = low.startsWith('@') ? low.slice(1) : low;

  let hit = null;
  try {
    const r = searchTags(q, { top: 1 });
    if (r && r.length) {
      // 严格一些：命中项的英文键或显示名要能对上，避免「差不多」的噪声
      const t0 = r[0];
      hit = t0;
    }
  } catch (e) {
    results.push({ tag: t, status: 'error', note: e.message });
    continue;
  }

  if (hit) {
    results.push({
      tag: t, status: 'found',
      zh: hit.zh || '', freq: hit.freqStr || '-', layer: hit.layerName || '', score: hit.score,
    });
  } else {
    results.push({ tag: t, status: 'missing' });
  }
}

const found = results.filter(r => r.status === 'found');
const missing = results.filter(r => r.status === 'missing');
const skipped = results.filter(r => r.status === 'skip');

if (args.json) {
  console.log(JSON.stringify({ total: tags.length, found, missing, skipped }, null, 2));
  process.exit(0);
}

const info = (() => { try { return kbInfo(); } catch { return null; } })();
if (info) console.log(`词库：${info.size} 条 · ${info.kbDir || ''}\n`);

console.log(`共 ${tags.length} 条：命中 ${found.length} · 未收录 ${missing.length} · 跳过 ${skipped.length}\n`);

if (!args.missingOnly) {
  console.log('— 库中命中 —');
  for (const r of found) {
    console.log(`  ✓ ${r.tag}${r.zh ? '  「' + r.zh + '」' : ''}  ${r.freq}  ${r.layer}`);
  }
  console.log();
}

if (missing.length) {
  console.log('— 库中未收录（可能是拼写错误，也可能是本词库没收录的实战标签）—');
  for (const r of missing) console.log(`  ✗ ${r.tag}`);
  console.log();
}

const cold = found.filter(r => r.freq === '-' || /^[\d.]+k$/.test(r.freq) && parseFloat(r.freq) < 30);
if (cold.length) {
  console.log('— 冷门标签（投稿量低，模型可能不熟）—');
  for (const r of cold) console.log(`  ⚠ ${r.tag}  ${r.freq}`);
}

process.exit(0);
