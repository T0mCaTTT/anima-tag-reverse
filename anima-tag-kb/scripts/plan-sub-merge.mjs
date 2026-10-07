/**
 * plan-sub-merge.mjs —— 小分类近义归并的「试算」脚本（只读，不改数据）
 *
 * 背景：小分类来自三套互相独立的词表（Danbooru 官方小节名 / WeiLin 131 个二级分类 / ai-tag-toolbox
 * 138 个 cat||sub），同一主题常出现 3–4 个近义桶，例如 og:food-tags 里同时有
 * 「甜点·零食·点心」「甜点零食」「甜点与零食」「其他零食」。
 *
 * 规则：把名字按分隔符（· 、 / 空格 与 和 及）切成词元集合，两个小分类若
 *   ①词元集合互为子集（A ⊆ B 或 B ⊆ A）且交集非空，或 ②Jaccard ≥ 0.5
 * 则并为一个；合并后取「词元更多」的名字（并列取条目更多的一方）。
 * 另外把纯兜底名（其他 / 参见 / 说明 / 杂项 …）统一并入「其他」。
 *
 * 输出：控制台摘要 + data/sub-merge-plan.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPLIT = path.join(ROOT, '画师类');
const DATA = path.join(ROOT, 'data');

const JUNK = new Set(['其他', '其它', '参见', '说明', '杂项', '其他标签', '其他类', '未分类', '待归类']);
const SPLIT_RE = /[·、・/／\s]+|与|和|及/g;

function tokens(name) {
  return name.split(SPLIT_RE).map(s => s.trim()).filter(Boolean);
}
function isJunk(name) { return JUNK.has(name); }

/** 在给定 subs 上求合并方案：返回 { groups: [[from,to],…], merged: Map<name,name>, after: [{name,count}] } */
function plan(subs) {
  const parent = new Map();
  const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  for (const s of subs) parent.set(s.name, s.name);

  const keep = subs.filter(s => !isJunk(s.name));
  for (let i = 0; i < keep.length; i++) {
    for (let j = i + 1; j < keep.length; j++) {
      const a = tokens(keep[i].name), b = tokens(keep[j].name);
      if (!a.length || !b.length) continue;
      const sa = new Set(a), sb = new Set(b);
      const inter = [...sa].filter(x => sb.has(x)).length;
      if (!inter) continue;
      const subset = inter === sa.size || inter === sb.size;
      const jac = inter / (sa.size + sb.size - inter);
      if (subset || jac >= 0.5) union(keep[i].name, keep[j].name);
    }
  }
  // 每个连通分量的代表名：词元多者优先，并列取条目多者
  const comp = new Map();
  for (const s of keep) {
    const r = find(s.name);
    if (!comp.has(r)) comp.set(r, []);
    comp.get(r).push(s);
  }
  const merged = new Map();
  const pairs = [];
  const after = [];
  for (const [, list] of comp) {
    const best = list.slice().sort((x, y) =>
      (tokens(y.name).length - tokens(x.name).length) || (y.count - x.count))[0];
    const total = list.reduce((n, s) => n + s.count, 0);
    after.push({ name: best.name, count: total, from: list.map(s => s.name) });
    for (const s of list) if (s.name !== best.name) { merged.set(s.name, best.name); pairs.push([s.name, best.name]); }
  }
  const junkTotal = subs.filter(s => isJunk(s.name)).reduce((n, s) => n + s.count, 0);
  if (junkTotal) {
    after.push({ name: '其他', count: junkTotal, from: subs.filter(s => isJunk(s.name)).map(s => s.name) });
    for (const s of subs) if (isJunk(s.name) && s.name !== '其他') { merged.set(s.name, '其他'); pairs.push([s.name, '其他']); }
  }
  return { merged, pairs, after };
}

const man = JSON.parse(fs.readFileSync(path.join(SPLIT, 'manifest.json'), 'utf8'));
const report = { generated_from: 'manifest.json', bigs: [] };
let beforeTotal = 0, afterTotal = 0, mergedPairs = 0;

for (const c of man.categories) {
  const subs = c.subs || [];
  if (!subs.length) continue;
  const { pairs, after } = plan(subs);
  beforeTotal += subs.length;
  afterTotal += after.length;
  mergedPairs += pairs.length;
  if (pairs.length) {
    report.bigs.push({ id: c.id, name: c.name, before: subs.length, after: after.length, pairs: pairs.slice(0, 40), after_list: after.map(a => ({ name: a.name, count: a.count })) });
  }
}

fs.writeFileSync(path.join(DATA, 'sub-merge-plan.json'), JSON.stringify(report, null, 1));
console.log('大分类总数:', man.categories.length, '｜ 有小分类的:', report.bigs.length);
console.log('小分类桶: ', beforeTotal, '→', afterTotal, '（减少', beforeTotal - afterTotal, '个，归并', mergedPairs, '次）');
console.log('\n合并最集中的 12 个大分类：');
for (const b of report.bigs.slice().sort((x, y) => (y.before - y.after) - (x.before - x.after)).slice(0, 12)) {
  console.log(`  ${b.name}（${b.id}）  ${b.before} → ${b.after}`);
  for (const [from, to] of b.pairs.slice(0, 6)) console.log(`      ${from}  →  ${to}`);
}
