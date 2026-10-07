// 数据集驱动的类目构造：把 data/ 下已取证的社区数据集并入知识库
// 由 scripts/build-kb.mjs 调用；独立维护以便扩充数据源。
import fs from 'node:fs';
import path from 'node:path';

const SRC = (root, rel) => path.join(root, 'data', rel);

/* ---------- 读取工具 ---------- */
function loadJson(root, rel) {
  const p = SRC(root, rel);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}
function loadArrayLike(root, rel) {
  const p = SRC(root, rel);
  if (!fs.existsSync(p)) return null;
  const s = fs.readFileSync(p, 'utf8');
  const a = s.indexOf('[');
  const b = s.lastIndexOf(']');
  if (a < 0 || b < 0) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}
const lower = (t) => String(t || '').toLowerCase().trim();
const danbooruEscape = (t) => lower(t).replace(/[()]/g, (c) => '\\' + c);
const fmt = (n) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/* ---------- 数据驱动类目：来自已取证的数据文件 ---------- */
export function readAttireData(root) {
  return loadJson(root, 'danbooru_attire_data.json');
}

/* ---------- Danbooru tag_group 类目 ---------- */
const TG_PLAN = {
  'image-composition': ['tg-composition', 62, '构图 · 视角 · 画幅（Danbooru 官方组）', 'D 构图与镜头', '1.0–1.3（构图类建议不超过 2 个，互相冲突）'],
  lighting: ['tg-lighting-full', 63, '光影 · Danbooru 官方全量组', 'D 构图与镜头', '1.0–1.5'],
  colors: ['tg-colors-full', 64, '色彩 · Danbooru 官方全量组', 'F 氛围与色彩', '1.0–1.4'],
  'visual-aesthetic': ['tg-aesthetic', 65, '视觉美学与流派 · 官方组', 'E 风格与题材', '1.0–1.4'],
  backgrounds: ['tg-backgrounds', 66, '背景 · 官方组全量', 'D 构图与镜头', '1.0–1.4'],
  locations: ['tg-locations', 67, '场景地点 · 官方组', 'D 构图与镜头', '1.0–1.4'],
  'real-world-locations': ['tg-locations-real', 68, '现实世界地点 · 官方组', 'D 构图与镜头', '1.0–1.4'],
  'focus-tags': ['tg-focus', 69, '焦点与镜头语言 · 官方组', 'D 构图与镜头', '1.0–1.3'],
  posture: ['tg-posture', 70, '姿态 · 官方组全量', 'C 人物动作', '1.0–1.3'],
  gestures: ['tg-gestures', 71, '手势与动作 · 官方组', 'C 人物动作', '1.0–1.3'],
  hands: ['tg-hands', 72, '手部 · 官方组', 'C 人物动作', '1.0–1.3'],
  'body-parts': ['tg-body-parts', 73, '身体部位 · 官方组', 'A 人物外观', '1.0–1.3'],
  hair: ['tg-hair', 74, '头发（总览）· 官方组', 'A 人物外观', '0.9–1.3'],
  'hair-color': ['tg-hair-color', 75, '发色 · 官方组全量', 'A 人物外观', '0.9–1.3'],
  'hair-styles': ['tg-hair-styles', 76, '发型 · 官方组全量', 'A 人物外观', '0.9–1.3'],
  eyes: ['tg-eyes', 77, '眼睛 · 官方组全量', 'A 人物外观', '0.9–1.2'],
  face: ['tg-face', 78, '面部 · 官方组全量', 'A 人物外观', '0.8–1.2'],
  ears: ['tg-ears', 79, '耳朵 · 官方组', 'A 人物外观', '0.9–1.2'],
  attire: ['tg-attire', 80, '服装（总览）· 官方组', 'B 服装与配饰', '1.0–1.5'],
  legwear: ['tg-legwear', 81, '腿足穿着 · 官方组', 'B 服装与配饰', '1.0–1.4'],
  headwear: ['tg-headwear', 82, '头饰 · 官方组', 'B 服装与配饰', '1.0–1.4'],
  handwear: ['tg-handwear', 83, '手部穿着 · 官方组', 'B 服装与配饰', '1.0–1.4'],
  sleeves: ['tg-sleeves', 84, '袖子 · 官方组', 'B 服装与配饰', '1.0–1.4'],
  'neck-and-neckwear': ['tg-neck', 85, '颈部与颈饰 · 官方组', 'B 服装与配饰', '1.0–1.4'],
  eyewear: ['tg-eyewear', 86, '眼镜 · 官方组', 'B 服装与配饰', '1.0–1.4'],
  'fashion-style': ['tg-fashion', 87, '时尚风格 · 官方组', 'E 风格与题材', '1.0–1.4'],
  makeup: ['tg-makeup', 88, '妆容 · 官方组', 'A 人物外观', '1.0–1.3'],
  'skin-color': ['tg-skin', 89, '肤色 · 官方组', 'A 人物外观', '1.0–1.3'],
  accessories: ['tg-accessories', 90, '配饰 · 官方组全量', 'B 服装与配饰', '1.0–1.4'],
  'holding-tags': ['tg-holding', 91, '手持物 · 官方组', 'C 人物动作', '1.0–1.4'],
  flowers: ['tg-flowers', 92, '花 · 官方组', 'D 构图与镜头', '1.0–1.4'],
  'food-tags': ['tg-food', 93, '食物 · 官方组全量', 'G 主题与物件', '1.0–1.4'],
  technology: ['tg-technology', 94, '科技与器械 · 官方组', 'G 主题与物件', '1.0–1.4'],
  water: ['tg-water', 95, '水 · 官方组', 'G 主题与物件', '1.0–1.4'],
  fire: ['tg-fire', 96, '火 · 官方组', 'G 主题与物件', '1.0–1.4'],
  creatures: ['tg-creatures', 97, '传说生物 · 官方组', 'G 主题与物件', '1.0–1.4'],
  'animals-cats': ['tg-cats', 98, '猫科 · 官方组', 'G 主题与物件', '1.0–1.4'],
  'animals-dogs': ['tg-dogs', 99, '犬科 · 官方组', 'G 主题与物件', '1.0–1.4'],
  birds: ['tg-birds', 100, '鸟类 · 官方组', 'G 主题与物件', '1.0–1.4'],
  theme: ['tg-theme', 101, '主题题材 · 官方组', 'E 风格与题材', '1.0–1.4'],
  patterns: ['tg-patterns', 102, '图案 · 官方组', 'G 主题与物件', '1.0–1.4'],
  prints: ['tg-prints', 103, '印花 · 官方组', 'G 主题与物件', '1.0–1.4'],
  symbols: ['tg-symbols', 104, '符号 · 官方组', 'G 主题与物件', '1.0–1.4'],
  text: ['tg-text', 105, '文字 · 官方组', 'G 主题与物件', '1.0–1.3（模型文字渲染弱，慎用）'],
  'verbs-and-gerunds': ['tg-verbs', 106, '动词与动名词 · 官方组', 'C 人物动作', '1.0–1.3'],
  subjective: ['tg-subjective', 107, '主观评价词 · 官方组', 'F 氛围与色彩', '1.0–1.3'],
  phrases: ['tg-phrases', 108, '短语 · 官方组', 'F 氛围与色彩', '1.0–1.3'],
  metatags: ['tg-metatags', 109, '元标签 · 官方组', 'H 质量与元信息', '1.0（建议保持裸标签）'],
  'year-tags': ['tg-year', 110, '年份标签 · 官方组', 'H 质量与元信息', '1.0–1.3'],
  censorship: ['tg-censorship', 111, '审查与遮挡 · 官方组', 'I 安全与负向', '1.0–1.3'],
  'audio-tags': ['tg-audio', 112, '音频标签 · 官方组', 'H 质量与元信息', '1.0–1.2'],
  sports: ['tg-sports', 113, '运动 · 官方组', 'G 主题与物件', '1.0–1.4'],
  jobs: ['tg-jobs', 114, '职业 · 官方组', 'G 主题与物件', '1.0–1.4'],
  holidays: ['tg-holidays', 115, '节日 · 官方组', 'G 主题与物件', '1.0–1.4'],
  companies: ['tg-companies', 116, '公司与品牌 · 官方组', 'G 主题与物件', '1.0–1.4'],
  dances: ['tg-dances', 117, '舞蹈 · 官方组', 'C 人物动作', '1.0–1.3'],
};

export function buildTagGroupCategories(root, s) {
  const data = loadJson(root, 'tag-groups.json');
  if (!data || !data.groups) return [];
  const out = [];
  for (const [gid, plan] of Object.entries(TG_PLAN)) {
    const g = data.groups[gid];
    if (!g || !g.tags || !g.tags.length) continue;
    const [id, order, name, group, weight] = plan;
    const seen = new Set();
    const items = [];
    for (const t of g.tags) {
      const tag = lower(t.tag);
      if (!tag || tag === 'tag groups' || seen.has(tag)) continue;
      seen.add(tag);
      items.push({
        tag,
        zh: `Danbooru 官方组 ${g.name_zh || gid}`,
        aliases: [],
        weight,
        freq: null,
        freq_note: '未取证：投稿量待验证',
        confidence: '中',
        note: '取自 Danbooru 官方 tag group 正文',
        slot: g.name_zh || gid,
        source: { label: `Danbooru wiki: tag group:${gid}`, url: g.url },
      });
    }
    if (!items.length) continue;
    out.push({
      id, name, order, group,
      intro: `来自 Danbooru 官方页 [\`tag group:${gid}\`](${g.url}) 的完整标签清单（${items.length} 条），逐页抓取正文链接后抽取，检索日期 ${data.meta?.fetched_at || ''}。`,
      count: items.length,
      sources: [{ label: 'Danbooru 官方 tag_group 分组页（56 组）', url: 'https://danbooru.donmai.us/wiki_pages/tag_groups' }, { label: `Danbooru wiki: tag group:${gid}`, url: g.url }],
      items,
    });
  }
  return out;
}

/* ---------- 角色 / 作品 / 数据集类目 ---------- */
export function buildDatasetCategories(root, s, opts = {}) {
  const out = [];
  const charLimit = opts.charLimit ?? 1200;

  /* 角色 */
  const official = loadJson(root, 'character_official_data.json');
  const cdata = loadArrayLike(root, 'character_data.js');
  const postMap = new Map();
  if (Array.isArray(cdata)) for (const c of cdata) postMap.set(lower(c.name), c.post_count || 0);
  if (official) {
    const rows = [];
    for (const [key, v] of Object.entries(official)) {
      const [cname, series] = key.split('||');
      const tags = [...new Set((v.tags || []).map(lower).filter(Boolean))];
      const charTag = tags.find((t) => lower(t).replace(/[()\\]/g, '') === lower(cname).replace(/[()\\]/g, '')) || lower(cname);
      rows.push({ cname, series: series || '', tags, charTag, post: postMap.get(lower(cname)) || 0 });
    }
    rows.sort((a, b) => b.post - a.post || a.cname.localeCompare(b.cname));
    const items = rows.slice(0, charLimit).map((r) => ({
      tag: r.charTag,
      zh: `${r.cname}（${r.series || '未知作品'}）`,
      aliases: r.tags.filter((t) => t !== r.charTag).slice(0, 14),
      weight: '1.0–1.3',
      freq: r.post || null,
      freq_note: r.post ? `Danbooru 投稿量约 ${r.post}` : '未取证：投稿量待验证',
      confidence: r.post ? '高' : '中',
      note: `完整标签串（可直接复制）：${r.charTag}${r.series ? ', ' + lower(r.series) : ''}${r.tags.filter((t) => t !== r.charTag).length ? ', ' + r.tags.filter((t) => t !== r.charTag).join(', ') : ''}`,
      slot: r.series || '其他作品',
      img: `https://danbooru.donmai.us/posts?tags=${encodeURIComponent(danbooruEscape(r.cname))}`,
      source: { label: 'Anima-Tools character_official_data.json（7,999 角色）', url: 'https://github.com/nregret/Comfyui-Anima-Tools/blob/main/js/character_official_data.json' },
    }));
    out.push({
      id: 'character-all', name: `角色 · 全量（Top ${items.length} / 共 ${rows.length}）`, order: 52, group: 'E 风格与题材',
      intro: `Anima-Tools 官方角色数据共 **${rows.length} 个「角色 × 作品」组合**，此处列出 Danbooru 投稿量最高的 ${items.length} 位。每条 note 字段给出**可直接复制的完整标签串**（角色 + 作品 + 官方配套标签），别名栏为官方配套标签。全量离线文件见 \`data/character_official_data.json\`。`,
      count: items.length,
      sources: [s('charOfficial'), s('tools'), s('hf')],
      items,
    });
  }

  /* 作品 */
  if (official) {
    const seriesMap = new Map();
    for (const [key, v] of Object.entries(official)) {
      const [cname, series] = key.split('||');
      if (!series) continue;
      const cur = seriesMap.get(lower(series)) || { series, chars: 0, post: 0 };
      cur.chars++;
      cur.post += postMap.get(lower(cname)) || 0;
      seriesMap.set(lower(series), cur);
    }
    const rows = [...seriesMap.values()].sort((a, b) => b.post - a.post || a.series.localeCompare(b.series));
    out.push({
      id: 'series-all', name: `作品 / 版权 · 全量（${rows.length}）`, order: 53, group: 'E 风格与题材',
      intro: '从 7,999 条角色数据反推的作品（版权）标签，频率字段为**该作品下全部角色的 Danbooru 投稿量合计**，可视为作品热度参考。写法上作品标签紧跟在角色标签之后。',
      count: rows.length,
      sources: [s('charOfficial'), s('tools')],
      items: rows.map((r) => ({
        tag: lower(r.series),
        zh: `${r.series}（收录 ${r.chars} 个角色）`,
        aliases: [],
        weight: '1.0–1.3',
        freq: r.post || null,
        freq_note: r.post ? `角色投稿量合计约 ${r.post}（${r.chars} 角色）` : '未取证：投稿量待验证',
        confidence: '中',
        note: '跟在角色标签之后书写；作品标签能显著收束角色外观',
        source: s('charOfficial'),
      })),
    });
  }

  /* 画师全量（真实投稿量） */
  const gallery = loadArrayLike(root, 'data.js');
  if (Array.isArray(gallery) && gallery.length) {
    const rows = gallery
      .map((a) => ({ name: String(a.name || ''), post: a.post_count || 0, uniq: a.uniqueness_score || 0 }))
      .filter((a) => a.name && a.post > 250)
      .sort((a, b) => b.post - a.post);
    out.push({
      id: 'artist-ranked', name: `画师 · 投稿量榜（Top ${rows.length} / 共 ${gallery.length}）`, order: 54, group: 'E 风格与题材',
      intro: `Anima-Tools 画师数据集共 **${gallery.length} 位**画师的 Danbooru 真实投稿量与独特性评分，此处列出投稿量 > 250 的 ${rows.length} 位。**频率字段为真实投稿量**（不再是样本量）。独特性高的画师风格更鲜明（如 tacfigure / ria (baka-neearts) / mimo lm）。`,
      count: rows.length,
      sources: [s('gallery40k'), s('tools'), s('explorer')],
      items: rows.map((r) => ({
        tag: `@${r.name}`,
        zh: `Danbooru 投稿 ${fmt(r.post)} · 独特性 ${r.uniq}`,
        aliases: [],
        weight: '0.8–1.4',
        freq: r.post,
        freq_note: `Danbooru 投稿量 ${r.post}（独特性评分 ${r.uniq}）`,
        confidence: '高',
        note: r.uniq >= 25 ? '独特性高，风格强，适合做风格锚点' : '通用型画师，适合做稳定基线',
        img: `https://danbooru.donmai.us/posts?tags=${encodeURIComponent('artist:' + danbooruEscape(r.name))}`,
        source: s('gallery40k'),
      })),
    });
  }

  /* 背景 / 姿势 / 服装 方案库 */
  const sets = [
    ['bgDataset', 'background_data.js', 'background-sets', 55, '背景方案库 · 成套可复制（%N）', 'D 构图与镜头',
      'AnimaTags-DB 的背景方案库：每条都是**一组完整可复制的背景标签串**（含时间/天气/光效/构件），点开悬浮窗即可整串拿走。预览图来自 AnimaTags-DB 图床。'],
    ['poseDataset', 'pose_data.js', 'pose-sets', 56, '姿势方案库 · 成套可复制（%N）', 'C 人物动作',
      'AnimaTags-DB 的姿势方案库：按「手势与手臂 / 坐姿 / 躺姿」等分组的完整姿势标签串，含预览图。'],
    ['clothDataset', 'clothing_data.json', 'clothing-sets', 57, '服装方案库 · 成套可复制（%N）', 'B 服装与配饰',
      'Dressing-doll 服装库：430 组成套服装（礼服 / 泳装 / 日常 / 制服 / 奇幻），每条含中英双语的完整标签串与预览图。'],
  ];
  for (const [srcKey, file, id, order, nameTpl, group, intro] of sets) {
    const arr = loadArrayLike(root, file);
    if (!Array.isArray(arr) || !arr.length) continue;
    const items = arr.map((d) => ({
      tag: lower(d.tags || '').replace(/,\s*$/, '') || lower(d.name),
      zh: `${d.name_zh || d.name || ''}${d.categories && d.categories.length ? ' · ' + d.categories.join(' / ') : ''}`,
      aliases: [],
      weight: id === 'clothing-sets' ? '1.0–1.5' : '1.0–1.4',
      freq: null,
      freq_note: '未取证：投稿量待验证',
      confidence: '中',
      note: d.tags_zh ? `中文对照：${d.tags_zh}` : '中文对照暂无',
      slot: (d.categories && d.categories[0]) || d.folder || '未分类',
      img: d.preview || null,
      source: s(srcKey),
    })).filter((i) => i.tag);
    if (!items.length) continue;
    const subs = [...new Set(items.map((i) => i.slot))];
    out.push({
      id, name: nameTpl.replace('%N', items.length), order, group,
      intro: `${intro}（共 ${items.length} 条，检索日期 ${opts.today || ''}）`,
      count: items.length,
      sources: [s(srcKey)],
      items,
      subgroups: subs.map((n) => ({ name: n, count: items.filter((i) => i.slot === n).length })),
    });
  }

  return out;
}
