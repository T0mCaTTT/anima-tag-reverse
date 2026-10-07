/** dump-vocab.mjs —— 导出层级重构需要的各种词表，便于人工映射/翻译 */
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

const out = {};

/* 1) toolbox 24 一级 + (cat,sub) 组合 */
const rowsRe = /\[\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*,\s*(\d)\s*\]/g;
const tb = new Map();
for (const f of ['data-tags.js', 'extra-tags.js']) {
  const src = fs.readFileSync(path.join(STUDY, f), 'utf8');
  let m; rowsRe.lastIndex = 0;
  while ((m = rowsRe.exec(src))) {
    const k = (norm(m[4]) || '-') + '||' + (norm(m[5]) || '-');
    tb.set(k, (tb.get(k) || 0) + 1);
  }
}
out.toolbox_pairs = [...tb.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ pair: k, n: v }));
out.toolbox_cats = [...new Set(out.toolbox_pairs.map(p => p.pair.split('||')[0]))];

/* 2) WeiLin 10 大类 / 131 二级分类 */
const wt = JSON.parse(fs.readFileSync(path.join(DATA, 'sources', 'weilin-tags.json'), 'utf8'));
out.weilin_groups = (wt.groups || []).map(g => ({ id: g.id, name: g.name, n: (wt.subgroups || []).filter(s => s.group_id === g.id).length }));
out.weilin_subgroups = (wt.subgroups || []).map(s => ({ id: s.id, name: s.name, group: s.group_id, group_name: (wt.groups || []).find(g => g.id === s.group_id)?.name }));

/* 3) 本地 87 类目 */
out.local_cats = [];
const tagsDir = path.join(ROOT, '画师类', 'tags');
for (const f of fs.readdirSync(tagsDir)) {
  const c = JSON.parse(fs.readFileSync(path.join(tagsDir, f), 'utf8'));
  const g = (c.sources || []).map(x => x.url).join(' ').match(/tag_group(?:%3A|:)([a-z_-]+)/i);
  out.local_cats.push({ id: c.id, name: c.name, order: c.order, group: c.group, count: c.count, slug: g ? g[1] : '' });
}
out.local_cats.sort((a, b) => a.order - b.order);

/* 4) 官方组 / 小节 */
const detail = JSON.parse(fs.readFileSync(path.join(DATA, 'tag-groups-detail.json'), 'utf8'));
out.official_groups = Object.values(detail).map(g => ({
  slug: g.slug, name_zh: g.name_zh, tags: g.tagCount,
  sections: g.sections.map(s => ({ heading: s.heading, heading_zh: s.heading_zh, n: s.tags.length }))
}));

fs.writeFileSync(path.join(DATA, 'vocab.json'), JSON.stringify(out, null, 1));
console.log('toolbox (cat||sub) 组合:', out.toolbox_pairs.length, ' 一级:', out.toolbox_cats.length);
console.log('toolbox 一级:', out.toolbox_cats.map(c => c + '(' + out.toolbox_pairs.filter(p => p.pair.startsWith(c + '||')).reduce((s, p) => s + p.n, 0) + ')').join(' '));
console.log('\nWeiLin 一级:', out.weilin_groups.map(g => g.name + '(' + g.n + ')' ).join(' '));
console.log('\n本地类目 87 项（id | 名 | 数 | 官方 slug）:');
console.log(out.local_cats.map(c => `${c.id}|${c.name}|${c.count}|${c.slug}`).join('\n'));
console.log('\n官方组小节数统计:');
console.log(out.official_groups.map(g => `${g.slug}|${g.name_zh}|${g.tags}|${g.sections.length}`).join('\n'));
