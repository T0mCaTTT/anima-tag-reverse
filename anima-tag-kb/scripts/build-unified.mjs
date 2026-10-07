/**
 * build-unified.mjs —— 把「本地知识库 + ai-tag-toolbox + Danbooru 官方 tag_group」
 * 合并成一份统一标签数据（data/unified-tags.json），供后续层级重构与页面使用。
 *
 * 合并规则（按用户要求）：
 *   1. 按英文标签规范化去重（小写、下划线→空格、画师前缀 @ 参与匹配时剥离）
 *   2. 字段统一：tag / zh / big(大分类) / sub(小分类) / official / group / sources / aliases / nsfw / weight / freq / confidence
 *   3. 冲突以「官方组」为准：分类归属、别名以官方组为准；中文译名优先取非占位符
 *   4. 每条保留 sources[] 来源标记，绝不丢来源
 *
 * 只读输入，只写 data/unified-tags.json 与 data/unified-report.json。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
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

const norm = s => String(s == null ? '' : s).toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
const keyOf = t => { const s = norm(t); return s.startsWith('@') ? s.slice(1) : s; };
const isHan = s => /[\u4e00-\u9fff]/.test(s) && !/[\u3040-\u30ff]/.test(s);
const placeholderZh = zh => !zh || !isHan(zh) || /^Danbooru 官方组/.test(zh) || /^AnimaTags-DB/.test(zh) || /数据集$/.test(zh);

/* ================= 1. 官方组 ================= */
const tgRaw = JSON.parse(fs.readFileSync(path.join(DATA, 'tag-groups.json'), 'utf8'));
const GROUPS = tgRaw.groups;                       // slug -> {slug,url,name_zh,count,tags[]}
const groupOfTag = new Map();                      // key -> [slug...]
for (const [slug, g] of Object.entries(GROUPS)) {
  for (const t of (g.tags || [])) {
    const k = keyOf(t.tag);
    if (!k) continue;
    if (!groupOfTag.has(k)) groupOfTag.set(k, []);
    if (!groupOfTag.get(k).includes(slug)) groupOfTag.get(k).push(slug);
  }
}

/* ================= 2. 本地知识库 ================= */
const local = new Map();                            // key -> record
let localTotal = 0;
const tagsDir = path.join(ROOT, '画师类', 'tags');
const catMeta = [];                                 // 类别元信息（保留 order/group 以免破坏页面）
for (const f of fs.readdirSync(tagsDir)) {
  const c = JSON.parse(fs.readFileSync(path.join(tagsDir, f), 'utf8'));
  const isOfficialCat = /^tg-/.test(c.id);
  const srcLabel = (c.sources && c.sources[0] && c.sources[0].label) || '本地策展';
  const srcUrl = (c.sources && c.sources[0] && c.sources[0].url) || '';
  const gslug = (() => {
    const s = (c.sources || []).map(x => x.url).join(' ');
    const m = s.match(/tag_group(?:%3A|:)([a-z_-]+)/i);
    return m ? m[1] : '';
  })();
  catMeta.push({ id: c.id, name: c.name, order: c.order, group: c.group, count: c.count, file: c.file, official: isOfficialCat, gslug, srcLabel, srcUrl });
  for (const it of c.items) {
    localTotal++;
    const tag = String(it[0] || '');
    const k = keyOf(tag);
    if (!k) continue;
    const zhRaw = String(it[1] || '');
    const rec = local.get(k) || {
      tag, zh: '', zhSrc: '', big: '', sub: '', official: false, group: '', tbCat: '', tbSub: '',
      sources: [], aliases: [], nsfw: false, weight: '', freq: null, confidence: '', notes: [], cats: [], slots: []
    };
    if (!rec.zh && !placeholderZh(zhRaw)) { rec.zh = zhRaw; rec.zhSrc = '本地策展'; }
    if (!rec.tag || (rec.tag.startsWith('@') && !tag.startsWith('@'))) rec.tag = tag;
    if (!rec.weight && it[2]) rec.weight = String(it[2]);
    if (rec.freq === null && it[3]) rec.freq = it[3];
    if (!rec.confidence && it[4]) rec.confidence = String(it[4]);
    const al = it[5]; if (al) for (const a of (Array.isArray(al) ? al : String(al).split(/[,，、;；]/))) { const s = a.trim(); if (s && !rec.aliases.includes(s)) rec.aliases.push(s); }
    if (it[6]) rec.notes.push(String(it[6]));
    if (it[7] && !rec.slots.includes(it[7])) rec.slots.push(it[7]);
    if (!rec.sources.some(s => s.label === srcLabel)) rec.sources.push({ label: srcLabel, url: srcUrl });
    if (!rec.cats.includes(c.id)) rec.cats.push(c.id);
    if (isOfficialCat) { rec.official = true; if (gslug && !rec.group) rec.group = gslug; }
    local.set(k, rec);
  }
}

/* ================= 3. ai-tag-toolbox ================= */
const readStudy = f => fs.readFileSync(path.join(STUDY, f), 'utf8');
const rowsRe = /\[\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*,\s*(\d)\s*\]/g;
function parseRows(file) {
  const src = readStudy(file), out = [];
  let m; rowsRe.lastIndex = 0;
  while ((m = rowsRe.exec(src))) out.push({ en: m[1], zh: m[2], al: m[3], cat: m[4], sub: m[5], nsfw: +m[6] === 1 });
  return out;
}
const tbRows = [...parseRows('data-tags.js'), ...parseRows('extra-tags.js')];
const TB_SRC = { label: 'ai-tag-toolbox（star-abyss，MIT 风格社区标签库）', url: 'https://github.com/star-abyss/ai-tag-toolbox' };

// 运行时求值 synonyms.js，取出三张表
const ctx = { window: {}, console };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(readStudy('synonyms.js'), ctx, { timeout: 30000 });
const SYN_BY_EN = ctx.SYNONYMS_BY_EN || {};
const SYN_ALIASES = ctx.SYNONYM_ALIASES || {};
const SYN_ZH2EN = ctx.SYNONYMS || {};

// 中文别名表：en(规范键) -> [zh...]（来自 SYNONYMS_BY_EN + 反向 SYNONYMS）
const zhDict = new Map();
const pushZh = (k, v) => {
  if (!k || !v || !isHan(v)) return;
  if (!zhDict.has(k)) zhDict.set(k, []);
  const arr = zhDict.get(k);
  if (!arr.includes(v)) arr.push(v);
};
for (const [en, list] of Object.entries(SYN_BY_EN)) {
  const k = keyOf(en);
  for (const v of (Array.isArray(list) ? list : [])) pushZh(k, v);
}
for (const [zh, list] of Object.entries(SYN_ZH2EN)) {
  for (const en of (Array.isArray(list) ? list : [])) pushZh(keyOf(en), zh);
}
const aliasDict = new Map();
for (const [en, list] of Object.entries(SYN_ALIASES)) {
  const k = keyOf(en);
  if (!aliasDict.has(k)) aliasDict.set(k, []);
  for (const v of (Array.isArray(list) ? list : [])) { const s = String(v).trim(); if (s && !aliasDict.get(k).includes(s)) aliasDict.get(k).push(s); }
}

let tbAdded = 0, tbMerged = 0;
for (const r of tbRows) {
  const k = keyOf(r.en);
  if (!k) continue;
  let rec = local.get(k);
  if (rec) {
    tbMerged++;
    if (!rec.zh && !placeholderZh(r.zh)) { rec.zh = r.zh; rec.zhSrc = 'ai-tag-toolbox'; }
    if (r.nsfw) rec.nsfw = true;
    if (!rec.tbCat && r.cat) { rec.tbCat = r.cat; rec.tbSub = r.sub; }
    for (const a of String(r.al || '').split(/\s+/)) { const s = a.trim(); if (s && !rec.aliases.includes(s)) rec.aliases.push(s); }
    if (!rec.sources.some(s => s.label === TB_SRC.label)) rec.sources.push(TB_SRC);
    // 官方组优先：不覆盖已有分组
  } else {
    tbAdded++;
    rec = {
      tag: r.en, zh: placeholderZh(r.zh) ? '' : r.zh, zhSrc: placeholderZh(r.zh) ? '' : 'ai-tag-toolbox',
      big: '', sub: '', official: false, group: '', tbCat: r.cat, tbSub: r.sub,
      sources: [TB_SRC], aliases: String(r.al || '').split(/\s+/).filter(Boolean),
      nsfw: !!r.nsfw, weight: '', freq: null, confidence: '', notes: [], cats: [], slots: []
    };
    local.set(k, rec);
  }
}

/* ================= 4. 别名 / 中文 词典兜底 ================= */
let zhFromDict = 0, aliasFromDict = 0;
for (const [k, rec] of local) {
  if (!rec.zh) {
    const cand = (zhDict.get(k) || []).slice().sort((a, b) => a.length - b.length);
    if (cand.length) { rec.zh = cand[0]; rec.zhSrc = '工具箱同义词表'; zhFromDict++; }
  }
  const al = aliasDict.get(k) || [];
  for (const a of al) { if (!rec.aliases.includes(a) && keyOf(a) !== k) { rec.aliases.push(a); aliasFromDict++; } }
}

/* ================= 5. 官方组归属 ================= */
let officialTagged = 0;
for (const [k, rec] of local) {
  const gs = groupOfTag.get(k);
  if (gs && gs.length) {
    rec.official = true;
    if (!rec.group) rec.group = gs[0];
    rec.groups = gs;
    officialTagged++;
    const g = GROUPS[gs[0]];
    if (!rec.sources.some(s => s.label === 'Danbooru 官方 tag_group')) {
      rec.sources.push({ label: 'Danbooru 官方 tag_group', url: g ? g.url : 'https://danbooru.donmai.us/wiki_pages/tag_groups' });
    }
  }
}

/* ================= 6. 输出 ================= */
const tags = [...local.values()].sort((a, b) => a.tag.localeCompare(b.tag));
const zhMissing = tags.filter(r => !r.zh);
const out = {
  meta: {
    built_at: new Date().toISOString().slice(0, 10),
    generators: ['本地知识库 画师类/', 'ai-tag-toolbox@study', 'Danbooru 官方 tag_group（56 组）'],
    local_items: localTotal,
    toolbox_rows: tbRows.length,
    merged_unique: tags.length,
    official_tags: officialTagged,
    zh_missing: zhMissing.length,
    note: '字段：tag/zh/big/sub/official/group/groups/sources/aliases/nsfw/weight/freq/confidence/cats/tbCat/tbSub'
  },
  groups: Object.fromEntries(Object.entries(GROUPS).map(([s, g]) => [s, { name_zh: g.name_zh, url: g.url, count: (g.tags || []).length }])),
  categories: catMeta,
  tags
};
fs.writeFileSync(path.join(DATA, 'unified-tags.json'), JSON.stringify(out));
fs.writeFileSync(path.join(DATA, 'unified-report.json'), JSON.stringify({
  meta: out.meta,
  tb: { rows: tbRows.length, added: tbAdded, merged: tbMerged },
  zh: { from_toolbox_row: tags.filter(r => r.zhSrc === 'ai-tag-toolbox').length, from_dict: zhFromDict, from_local: tags.filter(r => r.zhSrc === '本地策展').length, missing: zhMissing.length },
  alias: { from_dict: aliasFromDict },
  official: { tagged: officialTagged },
  zhMissingSample: zhMissing.slice(0, 60).map(r => r.tag)
}, null, 2));

console.log('unique 标签:', tags.length);
console.log('  本地条目:', localTotal, '→ unique:', local.size);
console.log('  toolbox 行:', tbRows.length, ' 新增:', tbAdded, ' 合并进已有:', tbMerged);
console.log('  官方组标签:', officialTagged);
console.log('  中文有:', tags.length - zhMissing.length, ' 缺:', zhMissing.length, '（其中来自同义词表', zhFromDict, '）');
console.log('  缺中文样例:', zhMissing.slice(0, 20).map(r => r.tag).join(' | '));
