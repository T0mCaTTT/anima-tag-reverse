/** fetch-weilin.mjs —— 抓取 weilin9999/WeiLin-Comfyui-Tools-Prompt 仓库的 SQL 标签库。
 *  优先 jsDelivr CDN（本机可达），失败再试 raw.githubusercontent.com。
 *  用法: node scripts/fetch-weilin.mjs [--all]   默认只抓 README + 1 个 danbooru 文件做样本
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'sources', 'weilin');
fs.mkdirSync(OUT, { recursive: true });
const REPO = 'weilin9999/WeiLin-Comfyui-Tools-Prompt';
const BRANCH = 'master';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36';

const urls = p => [
  `https://cdn.jsdelivr.net/gh/${REPO}@${BRANCH}/${p.split('/').map(encodeURIComponent).join('/')}`,
  `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${p.split('/').map(encodeURIComponent).join('/')}`,
];

async function grab(rel, force = false) {
  const local = path.join(OUT, path.basename(rel));
  if (!force && fs.existsSync(local) && fs.statSync(local).size > 0) return { rel, skipped: true, bytes: fs.statSync(local).size };
  for (const u of urls(rel)) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(120000) });
      if (!r.ok) { console.log(`  ${r.status} ${u}`); continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      fs.writeFileSync(local, buf);
      return { rel, bytes: buf.length, from: u.includes('jsdelivr') ? 'jsdelivr' : 'raw' };
    } catch (e) { console.log(`  ERR ${e.name} ${u}`); }
  }
  return { rel, failed: true };
}

const list = ['README.md', 'tags/2025_03_31/tags_2025_03_31.sql'];
const all = process.argv.includes('--all');
for (let i = 1; i <= 30; i++) list.push(`danbooru/2025_04_01/danbooru_2025_04_01_${String(i).padStart(3, '0')}.sql`);
list.push('tags/2025_04_01/weilin_NSFW词库_2025_04_01_001.sql');

const todo = all ? list : [list[0], list[1], list[2]];
for (const rel of todo) {
  const r = await grab(rel);
  console.log(JSON.stringify(r));
}
const files = fs.readdirSync(OUT).map(f => ({ f, kb: Math.round(fs.statSync(path.join(OUT, f)).size / 1024) }));
console.log('\n已下载:', files.length, '个文件, 共', files.reduce((s, x) => s + x.kb, 0), 'KB');
console.log(files.map(x => `${x.f} ${x.kb}KB`).join('\n'));
