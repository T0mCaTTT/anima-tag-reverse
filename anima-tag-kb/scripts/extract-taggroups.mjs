// 从已落盘的 Danbooru tag_group 页面 HTML 中抽取标签清单 → data/tag-groups.json
// 用法: node scripts/extract-taggroups.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const HTML_DIR = path.join(ROOT, 'data', 'taggroups-html');
const LIST = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'taggroups-list.json'), 'utf8'));
const OUT = path.join(ROOT, 'data', 'tag-groups.json');
const TODAY = '2026-09-04';

const ZH = {
  'image-composition': '构图·视角·技法',
  lighting: '光影',
  colors: '色彩',
  'visual-aesthetic': '视觉美学与流派',
  hair: '头发（总）',
  'hair-color': '发色',
  'hair-styles': '发型',
  eyes: '眼睛',
  face: '面部',
  ears: '耳朵',
  'body-parts': '身体部位',
  posture: '姿态',
  gestures: '手势与动作',
  hands: '手部',
  backgrounds: '背景',
  'focus-tags': '焦点与镜头',
  'holding-tags': '手持物',
  locations: '地点',
  'real-world-locations': '现实地点',
  flowers: '花',
  accessories: '配饰',
  attire: '服装（总）',
  legwear: '腿足穿着',
  headwear: '头饰',
  handwear: '手部穿着',
  sleeves: '袖子',
  'neck-and-neckwear': '颈部与颈饰',
  eyewear: '眼镜',
  'fashion-style': '时尚风格',
  makeup: '妆容',
  'skin-color': '肤色',
  technology: '科技与器械',
  theme: '主题',
  metatags: '元标签',
  water: '水',
  fire: '火',
  'food-tags': '食物',
  patterns: '图案',
  prints: '印花',
  symbols: '符号',
  text: '文字',
  'verbs-and-gerunds': '动词与动名词',
  subjective: '主观评价',
  phrases: '短语',
  creatures: '传说生物',
  'animals-cats': '猫科',
  'animals-dogs': '犬科',
  birds: '鸟类',
  sports: '运动',
  jobs: '职业',
  holidays: '节日',
  companies: '公司与品牌',
  dances: '舞蹈',
  'audio-tags': '音频标签',
  censorship: '审查',
  'year-tags': '年份',
};

const NAV = /^(help|about|posts|comments|artists|tags|wiki_pages|forum_topics|users|notes|pools|my_account|explore|ads|news|statistics|dtext_help|api|discord|donate|rules|terms|source|bookmarks|reports|bans|moderator|staff|dmails|sessions|signup|login|logout|password|settings|favorites|subscriptions|post_versions|tag_aliases|tag_implications|artist_commentaries|artist_urls|related_tags|post_appeals|post_flags|post_replacements|tag_edit_requests|comments|uploads|saved_searches|tag_subscriptions|forum_posts|static|theme|site_map|shikishi|artists_or_uploads)\b/i;

// 抽取正文区里的标签链接（href 属性级解析，兼容 &amp; 转义）
function extractTags(html) {
  const start = html.indexOf('id="wiki-page-body"');
  const end = html.indexOf('id="wiki-page-history', start);
  const body = html.slice(start, end > start ? end : undefined);
  const hrefs = [...body.matchAll(/href="([^"]+)"/g)].map((m) =>
    m[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  );
  const tags = new Map();
  for (const href of hrefs) {
    let slug = null;
    if (href.startsWith('/wiki_pages/')) slug = href.slice('/wiki_pages/'.length);
    else if (href.startsWith('/posts?tags=')) slug = href.slice('/posts?tags='.length).split('+')[0];
    if (!slug) continue;
    slug = slug.split('#')[0].split('&')[0];
    if (!slug || slug.includes('%3A') || slug.includes(':')) continue; // 跳过子 tag_group
    let t;
    try { t = decodeURIComponent(slug).replace(/_/g, ' ').trim(); } catch { continue; }
    if (!t || t.length > 70) continue;
    if (NAV.test(t)) continue;
    if (/[<>{}\\/|@#*=+\[\]"]/.test(t)) continue;
    if (/^(all|next|previous|edit|history|show|hide|more|less|page \d+)$/i.test(t)) continue;
    tags.set(t, (tags.get(t) || 0) + 1);
  }
  return [...tags.entries()].map(([tag, hits]) => ({ tag, hits }));
}

const out = {
  meta: {
    source: 'https://danbooru.donmai.us/wiki_pages/tag_groups',
    note: 'Danbooru 官方 tag_group 分组页，逐页抓取正文并抽取标签链接',
    fetched_at: TODAY,
    groups: 0,
    tags: 0,
  },
  groups: {},
};

for (const [id, slug] of LIST) {
  const file = path.join(HTML_DIR, id + '.html');
  if (!fs.existsSync(file)) { out.groups[id] = { slug, name_zh: ZH[id] || id, error: 'missing html' }; continue; }
  const html = fs.readFileSync(file, 'utf8');
  const tags = extractTags(html);
  out.groups[id] = {
    slug,
    url: 'https://danbooru.donmai.us/wiki_pages/' + encodeURIComponent(slug),
    name_zh: ZH[id] || id,
    count: tags.length,
    tags,
  };
  out.meta.groups++;
  out.meta.tags += tags.length;
}

fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
const rows = Object.entries(out.groups).map(([k, v]) => `${k}=${v.count || 0}`).join(' ');
console.log(JSON.stringify({ ok: true, groups: out.meta.groups, tags: out.meta.tags, out: path.relative(ROOT, OUT) }));
console.log(rows);
