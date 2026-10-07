/** parse-weilin.mjs —— 解析 weilin9999/WeiLin-Comfyui-Tools-Prompt 的 SQL 标签库。
 *  输出:
 *    data/sources/weilin-danbooru.jsonl   {tag, cat, zh, hot, alias}
 *    data/sources/weilin-tags.json        {groups, subgroups, tags}
 *    data/sources/weilin-report.json      统计
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'data', 'sources', 'weilin');
const OUT = path.join(ROOT, 'data', 'sources');

/** 拆 SQL 值列表（处理单引号转义 '' 与 \' 两种写法） */
function splitValues(s) {
  const out = [];
  let cur = '', inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "'" ) {
        if (s[i + 1] === "'") { cur += "'"; i++; continue; }
        inStr = false; continue;
      }
      if (c === '\\' && s[i + 1] === "'") { cur += "'"; i++; continue; }
      cur += c; continue;
    }
    if (c === "'") { inStr = true; continue; }
    if (c === ',') { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

/* ---- 1. danbooru_tag ---- */
const dRows = [];
let dFiles = 0;
for (const f of fs.readdirSync(SRC).filter(x => /^danbooru_.*\.sql$/.test(x)).sort()) {
  dFiles++;
  const txt = fs.readFileSync(path.join(SRC, f), 'utf8');
  for (const m of txt.matchAll(/VALUES\s*\(([^;]*?)\);/g)) {
    const v = splitValues(m[1]);
    if (v.length < 6) continue;
    const tag = v[1];
    if (!tag) continue;
    dRows.push({ tag, cat: Number(v[2]) || 0, zh: v[3] || '', hot: Number(v[4]) || 0, alias: Number(v[5]) || 0 });
  }
}
fs.writeFileSync(path.join(OUT, 'weilin-danbooru.jsonl'), dRows.map(r => JSON.stringify(r)).join('\n') + '\n');

/* ---- 2. tag_groups / tag_subgroups / tag_tags ---- */
const tTxt = fs.readFileSync(path.join(SRC, 'tags_2025_03_31.sql'), 'utf8');
const grab = table => {
  const re = new RegExp('INSERT(?:\\s+OR\\s+REPLACE)?\\s+INTO\\s+"?' + table + '"?\\s*\\(([^)]*)\\)\\s*VALUES\\s*\\(([^;]*?)\\);', 'g');
  const out = [];
  for (const m of tTxt.matchAll(re)) out.push(splitValues(m[2]));
  return out;
};
const groups = grab('tag_groups').map(v => ({ id: +v[0], name: v[1], uuid: v[4] }));
const subgroups = grab('tag_subgroups').map(v => ({ id: +v[0], group_id: +v[1], name: v[2], uuid: v[6] }));
const ttags = grab('tag_tags').map(v => v);
// 打印 tag_tags 第一条以便确认列序
fs.writeFileSync(path.join(OUT, 'weilin-tags.json'), JSON.stringify({
  groups, subgroups,
  tag_columns: ttags[0] || [],
  tag_rows: ttags, nsfw_rows: (() => {
    const f = fs.readdirSync(SRC).find(x => /NSFW/.test(x));
    if (!f) return [];
    const s = fs.readFileSync(path.join(SRC, f), 'utf8');
    const out = [];
    for (const m of s.matchAll(/VALUES\s*\(([^;]*?)\);/g)) { const v = splitValues(m[1]); if (v.length >= 2) out.push(v); }
    return out;
  })()
}, null, 1));

const report = {
  danbooru: {
    files: dFiles, rows: dRows.length,
    by_cat: dRows.reduce((a, r) => (a[r.cat] = (a[r.cat] || 0) + 1, a), {}),
    with_zh: dRows.filter(r => /[\u4e00-\u9fff]/.test(r.zh)).length,
    max_hot: dRows.reduce((m, r) => Math.max(m, r.hot), 0),
  },
  tags_db: { groups: groups.length, subgroups: subgroups.length, tag_rows: ttags.length, tag_cols: ttags[0]?.length },
  groups,
  subgroups,
  nsfw_rows: 0,
};
report.nsfw_rows = JSON.parse(fs.readFileSync(path.join(OUT, 'weilin-tags.json'), 'utf8')).nsfw_rows.length;
fs.writeFileSync(path.join(OUT, 'weilin-report.json'), JSON.stringify(report, null, 1));

console.log('danbooru 行数', dRows.length, '（', dFiles, '个文件） 有中文', report.danbooru.with_zh);
console.log('cat 分布', JSON.stringify(report.danbooru.by_cat));
console.log('hot 最大', report.danbooru.max_hot);
console.log('tag_groups', groups.length, '→', groups.map(g => g.name).join(' / '));
console.log('tag_subgroups', subgroups.length);
console.log('tag_tags 行数', ttags.length, ' 列数', ttags[0]?.length);
console.log('tag_tags 首行:', JSON.stringify(ttags[0]));
const sgNames = subgroups.map(s => `${groups.find(g => g.id === s.group_id)?.name || '?'}>${s.name}`);
console.log('二级分类（前 60）:', sgNames.slice(0, 60).join(' | '));
console.log('NSFW 词库行数', report.nsfw_rows);
