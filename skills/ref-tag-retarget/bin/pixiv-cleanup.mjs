#!/usr/bin/env node
/**
 * pixiv-cleanup.mjs —— 反推完成后清理原图
 *
 * 用途：抓取 → 反推 tag → 立即删除原图（只留 tag 与清单）。
 * 默认只删图片文件，保留 manifest.json（tag 记录）。
 *
 * 用法：
 *   node pixiv-cleanup.mjs                          # 清理默认目录 /tmp/pixiv-r18
 *   node pixiv-cleanup.mjs --dir /tmp/pixiv-test
 *   node pixiv-cleanup.mjs --dir /tmp/x --all       # 连清单一起删
 *   node pixiv-cleanup.mjs --dir /tmp/x --dry-run   # 只列出要删什么
 */

import fs from 'node:fs';
import path from 'node:path';

const a = process.argv.slice(2);
let dir = '/tmp/pixiv-r18';
let all = false, dry = false;
for (let i = 0; i < a.length; i++) {
  if (a[i] === '--dir') dir = a[++i];
  else if (a[i] === '--all') all = true;
  else if (a[i] === '--dry-run') dry = true;
}

if (!fs.existsSync(dir)) {
  console.error(`目录不存在：${dir}`);
  process.exit(0);
}

const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);
const files = fs.readdirSync(dir);
const targets = [];
let freed = 0;

for (const f of files) {
  const full = path.join(dir, f);
  const ext = path.extname(f).toLowerCase();
  const isImg = IMG_EXT.has(ext);
  const isManifest = f === 'manifest.json';
  if (isImg || (all && isManifest)) {
    const size = fs.statSync(full).size;
    targets.push({ f, size });
    freed += size;
  }
}

if (!targets.length) {
  console.error(`[清理] ${dir} 没有可删的文件`);
  process.exit(0);
}

const mb = (freed / 1024 / 1024).toFixed(1);
if (dry) {
  console.error(`[预演] 将删除 ${targets.length} 个文件，释放 ${mb} MB：`);
  for (const t of targets) console.error(`  - ${t.f}  ${(t.size / 1024 / 1024).toFixed(1)}MB`);
  process.exit(0);
}

let n = 0;
for (const t of targets) {
  try { fs.unlinkSync(path.join(dir, t.f)); n++; } catch (e) { console.error(`  ✗ ${t.f}: ${e.message}`); }
}

console.error(`[清理] 已删除 ${n}/${targets.length} 个文件，释放 ${mb} MB（目录 ${dir}）`);
if (!all) console.error('  manifest.json 已保留（含 tag 记录）');
