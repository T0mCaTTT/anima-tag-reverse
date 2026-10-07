/** extract-taggroup-sections.mjs —— 从 Danbooru tag_group 页面 HTML 抽取「小节 → 标签」结构。
 *  输入: data/taggroups-html/*.html
 *  输出: data/tag-groups-detail.json
 *    { slug: { slug, name_zh, intro, sections:[ {heading, heading_zh, tags:[{tag, hits, note}]} ], tagCount } }
 *  要点：
 *   - 标题可能带 id="dtext-xxx" 也可能没有 → 按所有 h1..h6 切段
 *   - 标签链接 = <a class="...tag-type-N..." href="/wiki_pages/xxx">，排除 dtext-tag-empty 与 tag_group:xxx
 *   - 标签名以 href 为准（页面显示名可能首字母大写）
 *   - 链接后的说明文字（如 ": may overlap with blue"）抓成 note，供中文翻译参考
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = path.join(ROOT, 'data', 'taggroups-html');
const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'tag-groups.json'), 'utf8'));
const NAME_ZH = Object.fromEntries(Object.entries(base.groups).map(([k, v]) => [k, v.name_zh]));

const decode = s => String(s)
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&nbsp;/g, ' ');
const strip = s => decode(String(s).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const titleize = s => s; // 保持原样

const SKIP = new Set(['tag_groups', 'tag_group', 'danbooru', 'help:home', 'about', 'posts', 'comments', 'artists', 'tags', 'wiki', 'forum', 'pools', 'users']);

// 小节中文名：优先读 data/section-zh.json（人工/模型翻译表），否则用内置种子表
const SEED_ZH = {
  'About': '说明', 'See also': '参见', 'Related tag groups': '相关标签组', 'Other': '其他', 'Others': '其他', 'Misc': '杂项', 'Miscellaneous': '杂项',
  'Headwear and Headgear': '头饰与头部装备', 'Shirts and Topwear': '上衣', 'Pants and Bottomwear': '下装', 'Legs and Feet': '腿部与脚部',
  'Shoes and Footwear': '鞋类', 'Uniforms and Costumes': '制服与装扮', 'Swimsuits and Bodysuits': '泳装与连体衣', 'Traditional Clothing': '传统服饰',
  'Jewelry and Accessories': '首饰与配饰', 'Head and Face': '头面部', 'Neck and Shoulders': '颈部与肩部', 'Limbs': '四肢', 'Torso and Misc': '躯干与杂项',
  'Styles and Patterns': '风格与图案', 'Patterns': '图案', 'Prints': '印花', 'Directional': '方向性光照', 'Types': '光照类型',
  'Time of day lighting': '时段光照', 'Light sources': '光源', 'Absence of light': '无光环境', 'Specific colors': '具体颜色', 'Multiple colors': '多色',
  'Real birds': '真实鸟类', 'Mythological birds': '神话鸟类', 'Colors': '颜色', 'Main tags / Legwear by height': '主体标签·按高度',
  'Additional Detail tags': '细节补充标签', 'Specific Color': '单色', 'Pattern': '图案', 'Bands': '条纹带', 'Style': '风格', 'Action': '动作',
  'General aesthetics': '通用美学', 'Art styles': '艺术风格', 'Design elements': '设计元素',
};
const ZH_FILE = path.join(ROOT, 'data', 'section-zh.json');
const H_ZH = Object.assign({}, SEED_ZH, fs.existsSync(ZH_FILE) ? JSON.parse(fs.readFileSync(ZH_FILE, 'utf8')) : {});
const out = {};
const allHeadings = new Map();   // heading -> groups count
const diag = [];
for (const f of fs.readdirSync(HTML).filter(x => x.endsWith('.html')).sort()) {
  const slug = f.replace(/\.html$/, '');
  const h = fs.readFileSync(path.join(HTML, f), 'utf8');
  const body = (h.split('<div id="wiki-page-body"')[1] || h).split('<div id="wiki-page-')[0] || '';
  const cut = body.indexOf('</div>', body.length - 400);
  const src = body;

  // 标题位置
  const marks = [];
  for (const m of src.matchAll(/<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/g)) {
    const heading = strip(m[3]);
    if (!heading || /^(Recent Changes|Options|Table of Contents)/i.test(heading)) continue;
    marks.push({ idx: m.index, end: m.index + m[0].length, heading });
  }
  // 组说明 = 第一个标题之前的散文
  const intro = strip((marks.length ? src.slice(0, marks[0].idx) : src)).replace(/^\[See .*?\]\.?\s*/, '').slice(0, 600);

  const sections = [];
  const push = (heading, seg) => {
    const tags = [];
    const seen = new Set();
    const re = /<a([^>]*)href="\/wiki_pages\/([^"?#]+)"([^>]*)>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = re.exec(seg))) {
      const attrs = m[1] + m[3];
      if (!/tag-type-\d/.test(attrs)) continue;
      if (/dtext-tag-empty/.test(attrs)) continue;
      let name = decodeURIComponent(m[2]).replace(/_/g, ' ').trim();
      if (!name || /[:%]/.test(name) || SKIP.has(name.toLowerCase())) continue;
      if (seen.has(name)) continue;
      seen.add(name);
      // 链接之后的文字 = 说明
      const rest = strip(seg.slice(m.index + m[0].length, m.index + m[0].length + 220))
        .replace(/^[:：\-–—]\s*/, '');
      const noteFull = rest.split(/<\/li>|<li>|<\/ul>|<ul>/)[0] || '';
      const note = noteFull.replace(/\s*\(?\d{1,3}(,\d{3})+\)?\s*$/, '').trim().slice(0, 140);
      const hits = (noteFull.match(/\((\d{1,3}(?:,\d{3})+)\)/) || [])[1];
      const rec = { tag: name };
      if (hits) rec.hits = Number(hits.replace(/,/g, ''));
      if (note && note.toLowerCase() !== name.toLowerCase() && !/^\(/.test(note)) rec.note = note;
      tags.push(rec);
    }
    if (tags.length) {
      sections.push({ heading, heading_zh: H_ZH[heading] || '', tags });
      allHeadings.set(heading, (allHeadings.get(heading) || 0) + 1);
    }
  };
  marks.forEach((mk, i) => push(mk.heading, src.slice(mk.end, i + 1 < marks.length ? marks[i + 1].idx : src.length)));
  const tagCount = sections.reduce((s, x) => s + x.tags.length, 0);
  out[slug] = { slug, name_zh: NAME_ZH[slug] || slug, intro, sections, tagCount };
  diag.push(`${slug.padEnd(28)} 小节 ${String(sections.length).padStart(2)}  标签 ${String(tagCount).padStart(5)}  说明 ${sections.filter(s => s.tags.some(t => t.note)).length}`);
}
fs.writeFileSync(path.join(ROOT, 'data', 'tag-groups-detail.json'), JSON.stringify(out));
console.log(diag.join('\n'));
const totalTags = Object.values(out).reduce((s, g) => s + g.tagCount, 0);
const totalSec = Object.values(out).reduce((s, g) => s + g.sections.length, 0);
const withNote = Object.values(out).reduce((s, g) => s + g.sections.reduce((a, x) => a + x.tags.filter(t => t.note).length, 0), 0);
console.log('\n合计:', Object.keys(out).length, '组 /', totalSec, '小节 /', totalTags, '标签 /', withNote, '条带英文说明');
console.log('\n所有小节标题（去重 ' + allHeadings.size + ' 个）:');
console.log([...allHeadings.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => k + '×' + v).join(' | '));
console.log('\nattire:', out.attire.sections.map(s => `${s.heading}[${s.tags.length}]`).join(' | '));
console.log('lighting:', out.lighting.sections.map(s => `${s.heading}[${s.tags.length}]`).join(' | '));
console.log('visual-aesthetic:', out['visual-aesthetic'].sections.map(s => `${s.heading}[${s.tags.length}]`).join(' | '));
