// 快速查看 画师类/manifest.json 的元信息与首个大类结构（排查用）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const man = JSON.parse(fs.readFileSync(path.join(ROOT, '画师类', 'manifest.json'), 'utf8'));

console.log('top keys:', Object.keys(man).join(', '));
console.log('meta:', JSON.stringify(man.meta, null, 1).slice(0, 1400));
console.log('categories:', man.categories.length);
const kinds = {};
for (const c of man.categories) kinds[c.kind] = (kinds[c.kind] || 0) + 1;
console.log('kinds:', JSON.stringify(kinds));
console.log('cat[0]:', JSON.stringify(man.categories[0]).slice(0, 700));
const big = man.categories.slice().sort((a, b) => b.count - a.count)[0];
console.log('biggest cat:', JSON.stringify({ ...big, subs: big.subs.slice(0, 6), files: big.files }).slice(0, 700));

const f = path.join(ROOT, '画师类', big.files[0]);
const part = JSON.parse(fs.readFileSync(f, 'utf8'));
console.log('big file keys:', Object.keys(part).join(', '), '| part', part.part, '/', part.parts, '| items', (part.items || []).length);
console.log('item[0]:', JSON.stringify(part.items[0]));
console.log('item[1]:', JSON.stringify(part.items[1]));

const idx = JSON.parse(fs.readFileSync(path.join(ROOT, '画师类', 'search-index.json'), 'utf8'));
console.log('index keys:', Object.keys(idx).join(', '), '| fields', JSON.stringify(idx.fields));
console.log('tmp:', JSON.stringify(idx.rows.slice(0, 1)));
