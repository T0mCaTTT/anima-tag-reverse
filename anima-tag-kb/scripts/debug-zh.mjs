/** debug-zh.mjs —— 检查单词词表与组合译名 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const keyOf = t => { const s = String(t).toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim(); return s.startsWith('@') ? s.slice(1) : s; };
const isHan = s => /[\u4e00-\u9fff]/.test(s);
const wlZh = new Map();
for (const line of fs.readFileSync(path.join(ROOT, 'data/sources/weilin-danbooru.jsonl'), 'utf8').split('\n')) {
  if (!line.trim()) continue; const o = JSON.parse(line);
  if (o.zh && isHan(o.zh)) wlZh.set(keyOf(o.tag), o.zh);
}
const singles = [...wlZh].filter(([k]) => !k.includes(' '));
console.log('wlZh 总数', wlZh.size, ' 单词', singles.length);
for (const w of ['hair', 'slime', 'chocolate', 'burnt', 'energy', 'intestine', 'cyberlox', 'marumage', 'star-shaped', 'blunt', 'kinky', 'pigtails']) {
  console.log(' ', w.padEnd(12), '→', wlZh.get(w) ?? '(无)');
}
