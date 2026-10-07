// 抓取 Danbooru 官方 tag_group wiki 页，抽取其中的标签链接，落盘为 data/tag-groups.json
// 用法: node scripts/fetch-taggroups.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'data', 'tag-groups.json');

const GROUPS = [
  ['image-composition', 'tag_group:image_composition'],
  ['lighting', 'tag_group:lighting'],
  ['colors', 'tag_group:colors'],
  ['visual-aesthetic', 'tag_group:visual_aesthetic'],
  ['hair', 'tag_group:hair'],
  ['hair-color', 'tag_group:hair_color'],
  ['hair-styles', 'tag_group:hair_styles'],
  ['eyes', 'tag_group:eyes_tags'],
  ['face', 'tag_group:face_tags'],
  ['ears', 'tag_group:ears_tags'],
  ['body-parts', 'tag_group:body_parts'],
  ['posture', 'tag_group:posture'],
  ['gestures', 'tag_group:gestures'],
  ['hands', 'tag_group:hands'],
  ['backgrounds', 'tag_group:backgrounds'],
  ['focus-tags', 'tag_group:focus_tags'],
  ['holding-tags', 'tag_group:holding_tags'],
  ['locations', 'tag_group:locations'],
  ['real-world-locations', 'tag_group:real_world_locations'],
  ['flowers', 'tag_group:flowers'],
  ['accessories', 'tag_group:accessories'],
  ['attire', 'tag_group:attire'],
  ['legwear', 'tag_group:legwear'],
  ['headwear', 'tag_group:headwear'],
  ['handwear', 'tag_group:handwear'],
  ['sleeves', 'tag_group:sleeves'],
  ['neck-and-neckwear', 'tag_group:neck_and_neckwear'],
  ['eyewear', 'tag_group:eyewear'],
  ['fashion-style', 'tag_group:fashion_style'],
  ['makeup', 'tag_group:makeup'],
  ['skin-color', 'tag_group:skin_color'],
  ['technology', 'tag_group:technology'],
  ['theme', 'tag_group:theme'],
  ['metatags', 'tag_group:metatags'],
  ['water', 'tag_group:water'],
  ['fire', 'tag_group:fire'],
  ['food-tags', 'tag_group:food_tags'],
  ['patterns', 'tag_group:patterns'],
  ['prints', 'tag_group:prints'],
  ['symbols', 'tag_group:symbols'],
  ['text', 'tag_group:text'],
  ['verbs-and-gerunds', 'tag_group:verbs_and_gerunds'],
  ['subjective', 'tag_group:subjective'],
  ['phrases', 'tag_group:phrases'],
  ['creatures', 'tag_group:legendary_creatures'],
  ['animals-cats', 'tag_group:cats'],
  ['animals-dogs', 'tag_group:dogs'],
  ['birds', 'tag_group:birds'],
  ['sports', 'tag_group:sports'],
  ['jobs', 'tag_group:jobs'],
  ['holidays', 'tag_group:holidays_and_celebrations'],
  ['companies', 'tag_group:companies_and_brand_names'],
  ['dances', 'tag_group:dances'],
  ['audio-tags', 'tag_group:audio_tags'],
  ['censorship', 'tag_group:censorship'],
  ['year-tags', 'tag_group:year_tags'],
];

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

// 把 wiki 链接 slug 还原成标签写法：下划线→空格，去掉消歧括号反斜杠，做最小清洗
function slugToTag(slug) {
  let t = decodeEntities(slug);
  t = t.replace(/\\([()']) /g, '$1'); // 保留 (x) 原名
  t = t.replace(/_/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

function extractTags(html) {
  // 只取正文容器，避免导航/侧栏链接污染
  const m = html.match(/<div id="wiki-page-body"[\s\S]*?<\/div>\s*<div/);
  const body = m ? m[0] : html;
  const tags = new Map(); // tag -> 该标签在正文出现的次数
  const re = /href="\/wiki_pages\/([^"#?]+)"/g;
  let x;
  while ((x = re.exec(body))) {
    const slug = x[1];
    if (!slug) continue;
    if (/%3A|%3a/.test(slug)) continue; // 子 tag_group 链接不算标签
    const tag = slugToTag(slug);
    if (!tag || tag.length > 60) continue;
    if (/^[0-9a-z .'()+,\-/&!:%_-]+$/i.test(tag) === false) continue;
    tags.set(tag, (tags.get(tag) || 0) + 1);
  }
  return tags;
}

async function main() {
  const result = {};
  let ok = 0;
  for (const [id, page] of GROUPS) {
    const url = `https://danbooru.donmai.us/wiki_pages/${encodeURIComponent(page)}`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) {
        console.log(`${id}: HTTP ${res.status}`);
        continue;
      }
      const html = await res.text();
      const tags = extractTags(html);
      // 只保留在正文里至少出现一次、且看起来像标签的项
      const list = [...tags.entries()].filter(([t]) => t.length >= 2).map(([t]) => t);
      result[id] = { url, source: 'Danbooru wiki ' + page, retrieved: new Date().toISOString().slice(0, 10), tags: list };
      console.log(`${id}: ${list.length} tags`);
      ok++;
      await sleep(400);
    } catch (e) {
      console.log(`${id}: FAIL ${e.message}`);
    }
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
  console.log(`\nwrote ${OUT} (${ok}/${GROUPS.length} groups, ${Object.values(result).reduce((n, g) => n + g.tags.length, 0)} tag entries)`);
}

main();
