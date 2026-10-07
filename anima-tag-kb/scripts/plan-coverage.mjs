/** plan-coverage.mjs —— 估算层级归属的来源覆盖率，决定还需要多少人工规则 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
// ai-tag-toolbox 快照目录：仓库里不留作者本机路径，用环境变量或同级目录指定
const STUDY = (() => {
  const cands = [
    process.env.ANIMA_STUDY_DIR,
    path.join(ROOT, '..', '.ai-tag-toolbox-study'),
    path.join(ROOT, '..', 'ai-tag-toolbox')
  ].filter(Boolean);
  const hit = cands.find(d => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
  if (!hit) throw new Error('找不到 ai-tag-toolbox 快照目录。请设 ANIMA_STUDY_DIR=<目录>（需含 data-tags.js / extra-tags.js / synonyms.js）。已试过：\n  ' + cands.join('\n  '));
  return hit;
})();
const norm = s => String(s || '').toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
const key = t => { const s = norm(t); return s.startsWith('@') ? s.slice(1) : s; };

const unified = JSON.parse(fs.readFileSync(path.join(DATA, 'unified-tags.json'), 'utf8'));
const detail = JSON.parse(fs.readFileSync(path.join(DATA, 'tag-groups-detail.json'), 'utf8'));
const wt = JSON.parse(fs.readFileSync(path.join(DATA, 'sources', 'weilin-tags.json'), 'utf8'));

// 官方组小节归属: key -> [slug, heading]
const secOf = new Map();
for (const g of Object.values(detail)) for (const s of g.sections) for (const t of s.tags) {
  const k = key(t.tag); if (!secOf.has(k)) secOf.set(k, [g.slug, s.heading, s.heading_zh]);
}
// WeiLin 归属: key -> [一级, 二级]
const wlOf = new Map();
const wg = new Map(wt.groups.map(g => [g.id, g.name])), ws = new Map(wt.subgroups.map(s => [s.id, s.name]));
for (const r of wt.tag_rows) {
  const k = key(r[2]); if (!k) continue;
  if (!wlOf.has(k)) wlOf.set(k, [wg.get(+r[1]) || '?', ws.get(+r[1 + 1]) || '?']);
}
// toolbox 归属
const rowsRe = /\[\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*,\s*(\d)\s*\]/g;
const tbOf = new Map();
for (const f of ['data-tags.js', 'extra-tags.js']) {
  const src = fs.readFileSync(path.join(STUDY, f), 'utf8');
  let m; rowsRe.lastIndex = 0;
  while ((m = rowsRe.exec(src))) { const k = key(m[1]); if (k && !tbOf.has(k)) tbOf.set(k, [norm(m[4]), norm(m[5])]); }
}
// 本地类目归属
const localOf = new Map();
const tagsDir = path.join(ROOT, '画师类', 'tags');
for (const f of fs.readdirSync(tagsDir)) {
  const c = JSON.parse(fs.readFileSync(path.join(tagsDir, f), 'utf8'));
  for (const it of c.items) { const k = key(it[0]); if (k && !localOf.has(k)) localOf.set(k, c.id); }
}

const tags = unified.tags;
let bySec = 0, byWl = 0, byTb = 0, byLocal = 0, none = 0;
const unmatched = [];
for (const t of tags) {
  const k = key(t.tag);
  if (secOf.has(k)) bySec++;
  else if (wlOf.has(k)) byWl++;
  else if (tbOf.has(k)) byTb++;
  else if (localOf.has(k)) byLocal++;
  else { none++; unmatched.push(t.tag); }
}
console.log('unified 标签总数:', tags.length);
console.log('  官方组小节可归属:', bySec);
console.log('  WeiLin 二级可归属:', byWl);
console.log('  toolbox (cat,sub) 可归属:', byTb);
console.log('  仅本地策展类目:', byLocal);
console.log('  无任何来源分类:', none);
console.log('无来源样例:', unmatched.slice(0, 40).join(' | '));

// 只看扩充池（Danbooru general 缺口中 >=200）
const pool = [];
for (const line of fs.readFileSync(path.join(DATA, 'sources', 'danbooru-tags.jsonl'), 'utf8').split('\n')) {
  if (!line.trim()) continue;
  let o; try { o = JSON.parse(line); } catch { continue; }
  if (o.category === 0 && o.post_count >= 200) pool.push(o);
}
const have = new Set(tags.map(t => key(t.tag)));
const need = pool.filter(o => !have.has(key(o.name)));
let pSec = 0, pWl = 0, pTb = 0, pNone = 0;
const pNoneList = [];
for (const o of need) {
  const k = key(o.name);
  if (secOf.has(k)) pSec++; else if (wlOf.has(k)) pWl++; else if (tbOf.has(k)) pTb++; else { pNone++; pNoneList.push(o.name); }
}
console.log('\n扩充池 general>=200:', pool.length, ' 本地已有:', pool.length - need.length, ' 需新增:', need.length);
console.log('  其中 官方组小节:', pSec, ' WeiLin:', pWl, ' toolbox:', pTb, ' 无来源分类:', pNone);
console.log('  无来源样例:', pNoneList.slice(0, 40).join(' | '));
