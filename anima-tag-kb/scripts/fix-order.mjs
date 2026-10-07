// 一次性收尾脚本：把 tags.json 的类目 order 重排成连续、可读的官方层序，并回写
// 用法: node scripts/fix-order.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const file = path.join(ROOT, 'tags.json');
const kb = JSON.parse(fs.readFileSync(file, 'utf8'));

const PLAN = [
  'quality', 'meta-dataset', 'era', 'safety', 'count', 'character', 'series',
  'character-all', 'series-all',
  'hair-color', 'hair-style', 'tg-hair', 'tg-hair-color', 'tg-hair-styles',
  'eyes', 'tg-eyes', 'tg-eyebrow-eyes', 'face', 'expression', 'tg-face', 'tg-ears',
  'tg-body-parts', 'tg-skin', 'tg-makeup',
  'attire', 'uniform', 'traditional', 'attire-detail', 'clothing-sets',
  'tg-attire', 'tg-legwear', 'tg-headwear', 'tg-handwear', 'tg-sleeves',
  'tg-neck', 'tg-eyewear', 'tg-fashion', 'accessory', 'tg-accessories',
  'pose', 'tg-posture', 'tg-gestures', 'tg-hands', 'tg-holding', 'tg-verbs', 'tg-dances',
  'composition', 'tg-composition', 'tg-focus', 'lighting', 'tg-lighting-full',
  'background', 'tg-backgrounds', 'tg-locations', 'tg-locations-real',
  'background-sets', 'pose-sets', 'tg-theme', 'tg-flowers',
  'color', 'tg-colors-full', 'tg-subjective', 'tg-phrases', 'tg-aesthetic', 'style',
  'artist', 'artist-ranked',
  'tg-food', 'tg-technology', 'tg-water', 'tg-fire', 'tg-creatures',
  'tg-cats', 'tg-dogs', 'tg-birds', 'tg-sports', 'tg-jobs', 'tg-holidays',
  'tg-companies', 'tg-patterns', 'tg-prints', 'tg-symbols', 'tg-text',
  'tg-metatags', 'tg-year', 'tg-audio',
  'negative', 'tg-censorship',
];

const byId = new Map(kb.categories.map((c) => [c.id, c]));
const missing = PLAN.filter((id) => !byId.has(id));
const extra = kb.categories.map((c) => c.id).filter((id) => !PLAN.includes(id));
const finalOrder = [...PLAN.filter((id) => byId.has(id)), ...extra];
finalOrder.forEach((id, i) => { byId.get(id).order = (i + 1) * 10; });
kb.categories.sort((a, b) => a.order - b.order);

fs.writeFileSync(file, JSON.stringify(kb, null, 2), 'utf8');
console.log(JSON.stringify({ ok: true, categories: kb.categories.length, missing, extra, first: finalOrder.slice(0, 6), last: finalOrder.slice(-4) }));
