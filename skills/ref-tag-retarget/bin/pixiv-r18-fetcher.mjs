#!/usr/bin/env node
/**
 * pixiv-r18-fetcher.mjs —— Pixiv R18 图抓取（按收藏数筛选 + 下载）
 *
 * 用途：随机抓一批 1k+ 收藏的 R18 图，供反推 tag 用。
 * 门槛、数量、标签都可调。
 *
 * 用法：
 *   node pixiv-r18-fetcher.mjs --min-bookmark 1000 --count 10
 *   node pixiv-r18-fetcher.mjs --min-bookmark 3000 --count 20 --tag ロリ
 *   node pixiv-r18-fetcher.mjs --min-bookmark 1000 --count 10 --out ./imgs
 *
 * 依赖：curl（系统自带）。零 npm 依赖。
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// ---- 配置 ------------------------------------------------------------------
const COOKIE_FILE = process.env.PIXIV_COOKIE_FILE || '/tmp/pixiv_cookie.txt';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function parseArgs() {
  const a = process.argv.slice(2);
  const o = { minBookmark: 1000, count: 10, out: '/tmp/pixiv-r18', tag: '', modes: 'weekly,daily', keep: false, timeout: 300 };
  if (a.includes('--help') || a.includes('-h')) {
    console.log(`pixiv-r18-fetcher —— 按收藏数筛选并下载 Pixiv 图

用法：
  node pixiv-r18-fetcher.mjs --min-bookmark 1000 --count 10
  node pixiv-r18-fetcher.mjs --min-bookmark 3000 --count 20 --tag ロリ
  node pixiv-r18-fetcher.mjs --min-bookmark 1000 --count 10 --out ./imgs

参数：
  --min-bookmark N   收藏数下限（默认 1000）
  --count N          抓取张数（默认 10）
  --tag  TAG         额外按标签检索
  --modes a,b        榜单模式（默认 weekly,daily）
  --out  DIR         输出目录（默认 /tmp/pixiv-r18）
  --timeout SEC      单张下载超时秒数（默认 300）
  --keep             保留原图（默认也保留，此参数保留兼容）
  -h, --help         显示本帮助

注意：i.pximg.net 出网慢，2MB 原图常需 3-5 分钟，超时默认已放宽到 300s。`);
    process.exit(0);
  }
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    if (k === '--timeout') o.timeout = parseInt(a[++i], 10);
    else if (k === '--min-bookmark') o.minBookmark = parseInt(a[++i], 10);
    else if (k === '--count') o.count = parseInt(a[++i], 10);
    else if (k === '--out') o.out = a[++i];
    else if (k === '--tag') o.tag = a[++i];
    else if (k === '--modes') o.modes = a[++i];
    else if (k === '--keep') o.keep = true;   // 保留原图（默认用完即删）
    else if (k === '--tag-only') o.tagOnly = true;  // 只用标签检索，跳过榜单
  }
  return o;
}

function cookie() {
  if (!fs.existsSync(COOKIE_FILE)) {
    console.error(`找不到 Cookie 文件：${COOKIE_FILE}`);
    console.error('把一行 Cookie 写进去（至少含 PHPSESSID=xxx），或用 PIXIV_COOKIE_FILE 指定路径。');
    process.exit(2);
  }
  return fs.readFileSync(COOKIE_FILE, 'utf8').trim().replace(/^Cookie:\s*/i, '');
}

function curl(url, extra = []) {
  const args = ['-s', '--max-time', '30', '-H', `User-Agent: ${UA}`,
    '-H', 'Referer: https://www.pixiv.net/', '-b', cookie(), ...extra, url];
  try { return execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
  catch { return ''; }
}

/** 榜单抓取：ranking 接口自带 rating_count，不用逐张查详情 */
function fetchRanking(mode, page) {
  const url = `https://www.pixiv.net/ranking.php?mode=${mode}_r18&format=json&p=${page}`;
  const raw = curl(url);
  if (!raw) return [];
  try {
    const d = JSON.parse(raw);
    return (d.contents || []).map(x => ({
      id: String(x.illust_id),
      title: x.title || '',
      bookmark: x.rating_count || 0,
      view: x.view_count || 0,
      tags: x.tags || [],
      url: x.url || '',
      userId: x.user_id,
    }));
  } catch { return []; }
}

/** 按标签检索（注意：检索接口无收藏数，需详情补查） */
function searchByTag(tag, page) {
  const url = `https://www.pixiv.net/ajax/search/artworks/${encodeURIComponent(tag)}?word=${encodeURIComponent(tag)}&mode=r18&p=${page}&s_mode=s_tag`;
  const raw = curl(url);
  if (!raw) return [];
  try {
    const d = JSON.parse(raw);
    return (d.body?.illustManga?.data || []).map(x => ({
      id: String(x.id), title: x.title || '', bookmark: -1, view: 0,
      tags: x.tags || [], url: x.url || '', userId: x.userId,
    }));
  } catch { return []; }
}

/** 详情补查收藏数（检索来的条目才需要） */
function fetchDetail(id) {
  const raw = curl(`https://www.pixiv.net/ajax/illust/${id}`);
  try {
    const b = JSON.parse(raw).body || {};
    return {
      bookmark: b.bookmarkCount ?? 0,
      view: b.viewCount ?? 0,
      tags: (b.tags?.tags || []).map(t => t.tag),
      urls: (b.urls?.original ? [b.urls.original] : []),
      pageCount: b.pageCount ?? 1,
      xRestrict: b.xRestrict,
    };
  } catch { return null; }
}

/** 下载原图（需 Referer + Cookie，否则 403 / 防盗链；超时默认 300s） */
function download(imgUrl, dest, timeoutSec = 300) {
  try {
    execFileSync('curl', ['-s', '--max-time', String(timeoutSec),
      '-H', `User-Agent: ${UA}`,
      '-H', 'Referer: https://www.pixiv.net/',
      '-b', cookie(),
      '-o', dest, imgUrl], { stdio: 'ignore' });
    if (!fs.existsSync(dest)) return false;
    const sz = fs.statSync(dest).size;
    if (sz <= 1024) return false;

    // 完整性校验：避免把下载中途的半截文件当成成功
    const fd = fs.openSync(dest, 'r');
    const head = Buffer.alloc(4);
    const tail = Buffer.alloc(8);
    fs.readSync(fd, head, 0, 4, 0);
    fs.readSync(fd, tail, 0, 8, sz - 8);
    fs.closeSync(fd);
    const headHex = head.toString('hex');
    const tailHex = tail.toString('hex');

    if (headHex.startsWith('89504e47')) {                 // PNG
      if (tailHex !== '49454e44ae426082') {
        console.error(`    (警告：${path.basename(dest)} PNG 缺 IEND 收尾，可能不完整)`);
        return false;
      }
    } else if (headHex.startsWith('ffd8')) {              // JPEG
      if (!tailHex.includes('ffd9')) {
        console.error(`    (警告：${path.basename(dest)} JPEG 缺 FFD9 收尾，可能不完整)`);
        return false;
      }
    }
    return true;
  } catch { return false; }
}

// ---- 主流程 ----------------------------------------------------------------
const opt = parseArgs();
fs.mkdirSync(opt.out, { recursive: true });

console.error(`[抓取] 门槛 ${opt.minBookmark}+ 收藏 · 目标 ${opt.count} 张 · 输出 ${opt.out}`);

const pool = [];
const seen = new Set();

// 1) 榜单（--tag-only 时跳过，避免普通图占满池子）
for (const mode of opt.tagOnly ? [] : opt.modes.split(',')) {
  for (let p = 1; p <= 10; p++) {
    const items = fetchRanking(mode, p);
    if (!items.length) break;
    for (const it of items) {
      if (seen.has(it.id)) continue;
      if (it.bookmark >= opt.minBookmark) { seen.add(it.id); pool.push({ ...it, mode }); }
    }
    console.error(`  ${mode} p${p}: 池内累计 ${pool.length}`);
    if (pool.length >= opt.count * 4) break;
  }
}

// 2) 标签检索（可选，需详情补查）
if (opt.tag) {
  for (let p = 1; p <= 5; p++) {
    const items = searchByTag(opt.tag, p);
    if (!items.length) break;
    for (const it of items) {
      if (seen.has(it.id)) continue;
      const d = fetchDetail(it.id);
      if (!d) continue;
      seen.add(it.id);
      if (d.bookmark >= opt.minBookmark) {
        pool.push({ ...it, bookmark: d.bookmark, view: d.view, tags: d.tags, mode: 'search' });
      }
    }
    if (pool.length >= opt.count * 4) break;
  }
}

if (!pool.length) {
  console.error('没抓到符合条件的图。降低 --min-bookmark 或换 --tag 试试。');
  process.exit(1);
}

// 3) 随机抽样
for (let i = pool.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [pool[i], pool[j]] = [pool[j], pool[i]];
}
const picked = pool.slice(0, opt.count);

// 4) 下载
const manifest = [];
let ok = 0;
for (const it of picked) {
  const d = fetchDetail(it.id);
  if (!d || !d.urls?.length) { console.error(`  ✗ ${it.id} 详情失败`); continue; }
  const dest = path.join(opt.out, `${it.id}_p0.jpg`);
  if (download(d.urls[0], dest, opt.timeout)) {
    ok++;
    manifest.push({
      id: it.id, title: it.title, bookmark: d.bookmark, view: d.view,
      tags: d.tags, file: dest, xRestrict: d.xRestrict, mode: it.mode,
    });
    console.error(`  ✓ ${it.id}  收藏 ${d.bookmark}  ${it.title.slice(0, 30)}`);
  } else {
    console.error(`  ✗ ${it.id} 下载失败`);
  }
}

// 5) 落清单
const mf = path.join(opt.out, 'manifest.json');
fs.writeFileSync(mf, JSON.stringify(manifest, null, 2), 'utf8');

console.error(`\n[完成] 成功 ${ok}/${picked.length} 张 · 清单：${mf}`);
console.error('下一步：逐张看图反推 tag，或直接把图发给我。');
console.log(mf);
