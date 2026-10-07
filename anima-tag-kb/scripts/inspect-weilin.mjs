/** inspect-weilin.mjs —— 读取 weilin 仓库 SQL 的结构摘要（UTF-8 正确解析）。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'sources', 'weilin');

const tagsPath = path.join(DIR, 'tags_2025_03_31.sql');
const t = fs.readFileSync(tagsPath, 'utf8');
console.log('=== tags_2025_03_31.sql（' + t.length + ' 字符）前 1100 字符 ===');
console.log(t.slice(0, 1100));

const tableRe = /INSERT(?:\s+OR\s+REPLACE)?\s+INTO\s+"?([^"\s(]+)"?/gi;
const cnt = {};
for (const m of t.matchAll(tableRe)) cnt[m[1]] = (cnt[m[1]] || 0) + 1;
console.log('\n各表插入条数:', JSON.stringify(cnt, null, 1));

console.log('\n=== CREATE TABLE 语句 ===');
for (const m of t.matchAll(/CREATE\s+TABLE[^;]{0,400};/gi)) console.log(m[0].replace(/\s+/g, ' ').slice(0, 400), '\n');

const d = fs.readFileSync(path.join(DIR, 'danbooru_2025_04_01_001.sql'), 'utf8');
console.log('=== danbooru 样例（前 700 字符）===');
console.log(d.slice(0, 700));
console.log('\n=== danbooru CREATE TABLE ===');
for (const m of d.matchAll(/CREATE\s+TABLE[^;]{0,400};/gi)) console.log(m[0].replace(/\s+/g, ' ').slice(0, 400));
const rows = [...d.matchAll(/VALUES\s*\((\d+),\s*'((?:[^'\\]|\\.)*)',\s*(\d+),\s*'((?:[^'\\]|\\.)*)',\s*(\d+),\s*(\d+)\)/g)];
console.log('\n解析到 danbooru 行数:', rows.length);
console.log('前 5 行:', rows.slice(0, 5).map(r => `${r[1]} | cat=${r[3]} | ${r[4]} | hot=${r[5]} | alias=${r[6]}`).join('\n'));
