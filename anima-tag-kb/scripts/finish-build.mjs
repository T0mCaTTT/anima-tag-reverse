/**
 * finish-build.mjs —— 构建收尾（由 build-hierarchy.mjs 生成数据后运行）
 *
 *   1. 清理旧结构（画师类/tags/*.json）
 *   2. 把 viewer/template.html 复制成根目录的 anima-tag-exhibition.html
 *   3. 写 画师类/README.md（分包结构与更新约定）
 *   4. 写 anima-tag-kb/README.md（总手册）
 *   5. 写 分类树概览.md 与 官方组中英对照表.md 两份交付文档
 *
 * 用法：node scripts/build-hierarchy.mjs && node scripts/finish-build.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const SPLIT = path.join(ROOT, '画师类');
const TAGS = path.join(SPLIT, 'tags');

const man = JSON.parse(fs.readFileSync(path.join(SPLIT, 'manifest.json'), 'utf8'));
const meta = man.meta;
const cats = man.categories.slice().sort((a, b) => a.order - b.order);
const readJSON = p => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null);
const detail = readJSON(path.join(DATA, 'tag-groups-detail.json')) || {};
const report = readJSON(path.join(DATA, 'hierarchy-report.json')) || {};
const nf = n => (n == null ? '—' : Number(n).toLocaleString('en-US'));

/* ---------- 1. 清理旧结构 ---------- */
let removedOld = 0;
if (fs.existsSync(TAGS)) {
  for (const f of fs.readdirSync(TAGS)) if (f.endsWith('.json')) { fs.unlinkSync(path.join(TAGS, f)); removedOld++; }
  if (!fs.readdirSync(TAGS).length) fs.rmdirSync(TAGS);
}

/* ---------- 2. 复制展览板（并把收藏夹逻辑内联进去，成品单文件也能跑） ---------- */
const tplPath = path.join(ROOT, 'viewer', 'template.html');
const outHtml = path.join(ROOT, 'anima-tag-exhibition.html');
const CORE_DEV_TAG = '<script src="collections-core.js"></script>';
const corePath = path.join(ROOT, 'viewer', 'collections-core.js');
let html = fs.readFileSync(tplPath, 'utf8');
let inlinedCore = 0;
if (html.includes(CORE_DEV_TAG)) {
  if (!fs.existsSync(corePath)) throw new Error(`缺少 ${corePath}（收藏夹逻辑），无法构建`);
  const core = fs.readFileSync(corePath, 'utf8');
  // 内联时把 </script 转义掉，避免源码里的字符串提前闭合脚本块
  const safe = core.replace(/<\/script/gi, '<\\/script');
  html = html.replace(CORE_DEV_TAG, '<script>\n/* ===== viewer/collections-core.js（构建时自动内联，别改这里） ===== */\n' + safe + '\n</script>');
  inlinedCore = 1;
} else if (!html.includes('KBCollections')) {
  throw new Error('viewer/template.html 里既没有 collections-core.js 的开发用 script 标签，也没有内联的核心代码');
}
fs.writeFileSync(outHtml, html);
console.log(`展览板：${path.basename(outHtml)}（${(fs.statSync(outHtml).size / 1024).toFixed(1)} KB${inlinedCore ? '，已内联收藏夹核心 ' + (fs.statSync(corePath).size) + ' B' : ''}）`);

/* ---------- 3. 画师类/README.md ---------- */
const fieldRows = Object.entries(meta.field_map || {}).sort((a, b) => a[1] - b[1])
  .map(([k, v]) => `| ${v} | \`${k}\` |`).join('\n');

const splitReadme = `# 画师类/ —— Anima 标签工作台的数据分包

> 构建日期 **${meta.built_at}** ｜ ${nf(meta.total)} 条标签 / ${meta.bigs} 个大分类 · ${meta.subs} 个小分类 ｜ 模型 ${meta.model}
> 本目录由 \`node scripts/build-hierarchy.mjs\` 生成，**不要手改 json**（下次构建会整文件覆盖）。

## 文件结构

\`\`\`
画师类/
├── manifest.json        大分类清单：meta（模型/统计/规范/来源/field_map）+ categories[]
├── bigs/<id>.json       每个大分类一个分片；超过 3500 条自动分片为 <id>-1.json、<id>-2.json …
└── search-index.json    检索索引：{ fields, cats, rows }，每行是一个标签的扁平记录
\`\`\`

\`categories[]\` 每项字段：\`id\`（\`cb:*\` 策展分类 / \`og:*\` Danbooru 官方组）、\`name\`、\`order\`、\`kind\`（curated|official）、
\`slug\`（官方组 slug，策展类为空）、\`intro\`、\`count\`、\`subs[]\`（小分类名 + 数量）、\`files[]\`（分片路径）、\`url\`（官方 tag_group 页面）。

## 条目是稀疏数组

\`bigs/*.json\` 的 \`items[]\` 里每条标签都是一个**稀疏数组**，下标含义（= \`manifest.meta.field_map\`）：

| 下标 | 字段 |
| --- | --- |
${fieldRows}

空值不写（数组里留 \`null\`）。\`freq\` 是 Danbooru 真实投稿量；\`official=1\` 表示来自 Danbooru 官方 tag_group。

## search-index.json

\`rows[]\` 每行按 \`fields\` 顺序排列：
\`['tag','big','order','zh','aliases','weight','freq','confidence','sub','bigName','slot','official']\`
（\`big\` 是大分类 id，\`sub\` 是小分类名，\`freq\` 已格式化成 \`12.3k\` / \`3M\` 这样的短串）。

## 怎么更新

1. 改数据：动 \`scripts/\` 下的表（\`taxonomy.mjs\` 的层级规则、\`build-hierarchy.mjs\` 的译名补全、\`data/sources/\` 的原始数据），**不要改本目录的 json**。
2. 重建：\`node scripts/build-hierarchy.mjs\` → \`node scripts/finish-build.mjs\`。
3. 页面不用改：\`viewer/template.html\` 会读 \`manifest.json\` 自适应，分片变多变少都行。
4. 换机器/换盘符：整个 \`anima-tag-kb/\` 目录可以直接拷走，双击 \`启动展览板.cmd\` 即可。
`;
fs.writeFileSync(path.join(SPLIT, 'README.md'), splitReadme);

/* ---------- 4. 根 README.md ---------- */
const bigTable = cats.map(c =>
  `| ${c.order} | \`${c.id}\` | ${c.name} | ${c.kind === 'official' ? '官方组' : '策展'} | ${nf(c.count)} | ${c.subs.length} |`
).join('\n');

const rootReadme = `# Anima 标签工作台 · 本地知识库

> 构建日期 **${meta.built_at}** ｜ ${nf(meta.total)} 条标签 / ${meta.bigs} 个大分类 · ${meta.subs} 个小分类 ｜ Danbooru 官方组条目 ${nf(meta.official_tags)} 条 ｜ 已取证投稿量 ${nf(meta.verified_freq)} 条
> 面向 **Anima 2B**（CircleStone Labs × Comfy Org）的动漫向提示词标签库：全部为英文标签 + 中文译名，含来源与投稿量，可直接拼装成出图提示词。

## 1. 怎么用（最快路径）

双击 **\`启动展览板.cmd\`** —— 会起一个本地小服务并自动打开浏览器（页面：\`anima-tag-exhibition.html\`）。
**不要直接双击 HTML 文件**：数据是用 \`fetch\` 按需加载的，\`file://\` 下浏览器会拦掉。

手动方式：\`cd anima-tag-kb\` → \`node scripts/serve-kb.mjs\` → 访问 \`http://127.0.0.1:8100/anima-tag-exhibition.html\`

## 2. 目录结构

\`\`\`
anima-tag-kb/
├── 启动展览板.cmd            ← 双击即用
├── anima-tag-exhibition.html ← 展览板（由 viewer/template.html 复制而来）
├── README.md                 ← 本文件（构建时覆盖）
├── 分类树概览.md              ← 交付文档①：69 个大分类 → 849 个小分类
├── 官方组中英对照表.md         ← 交付文档②：56 个官方组的小节中英对照
├── viewer/template.html      ← 展览板唯一源文件（改界面只改这里）
├── viewer/collections-core.js ← 收藏夹纯逻辑（浏览器/Node 双用；构建时内联进展览板副本）
├── data/collections.json     ← 标签串收藏数据（页面通过 /api/collections 读写）
├── 设计规范.md                ← 交付文档③：双主题 / 毛玻璃 / 圆角 / 动效 / 响应式规范
├── assets/                   ← 设计资产
│   ├── tokens.json           ← 设计令牌（Tokens Studio 可直接导入 Figma）
│   ├── theme-toggle.json     ← 主题切换 Lottie 动画（48×48 @30fps / 60 帧）
│   └── lottie-preview.html   ← Lottie 预览页（含无依赖 CSS 对照版）
├── 画师类/                    ← 数据分包（manifest.json + bigs/*.json + search-index.json + README.md）
├── data/                     ← 原始数据与中间产物（sources/ 原始抓取、tag-groups-detail.json、hierarchy-report.json …）
├── scripts/                  ← 构建脚本
│   ├── build-hierarchy.mjs   ← 主构建器：层级 + 译名 + 分包
│   ├── finish-build.mjs      ← 收尾：README、交付文档、复制网页（并把收藏夹核心内联进副本）、清理旧结构
│   ├── taxonomy.mjs          ← 层级规则唯一真源（大分类/小分类/正则规则）
│   ├── serve-kb.mjs          ← 本地静态服务器（含 /api/collections 收藏数据接口）
│   ├── selftest-collections.mjs ← 收藏夹自测（逻辑 + HTTP 接口，45/55 条断言）
│   └── …（采集与对账脚本，见 data/sources/）
├── vendor/fuse.min.js        ← 模糊搜索（离线自包含）
└── categories/               ← 旧版按类别的 md 存档（不再更新）
\`\`\`

## 3. 数据规模

- 标签总数 **${nf(meta.total)}**：策展库 ＋ Danbooru 官方 tag_group（56 组 / 662 小节）＋ ai-tag-toolbox 社区库 ＋ WeiLin 官方译名词库 ＋ Danbooru 全站标签榜（投稿量 ≥200 的扩充）。
- **${nf(meta.official_tags)}** 条来自 Danbooru 官方 tag_group；**${nf(meta.verified_freq)}** 条带真实投稿量（\`freq\`）。
- 中文：WeiLin 词库 + 社区库 + 官方条目英文释义 + 规则合成；仍缺译名 **${nf(meta.zh_missing)}** 条（极冷门条目，悬浮窗标注「待补译」，不编造）。

## 4. 层级（两级分类）

第一级 **${meta.bigs} 个大分类** = 13 个策展分类 + 56 个 Danbooru 官方组；第二级 **${meta.subs} 个小分类** = 官方小节名（已中文化）＋ WeiLin 二级分类名 ＋ 按语义拆分的主题。
> 展览板在这两级**数据**之上又加了一层**纯视图分组**：把 ${meta.bigs} 个大分类归成 24 个一级入口（映射表见 §5），数据文件、分类 id、搜索索引与收藏内容都不受影响。

| # | id | 名称 | 类型 | 标签数 | 小分类 |
| --- | --- | --- | --- | --- | --- |
${bigTable}

完整树见 [分类树概览.md](<分类树概览.md>)。

## 5. 展览板功能

- **左侧分类栏（两级就到标签）**：竖栏把 ${meta.bigs} 个大分类归成 **24 个一级入口**（图标 + 条目数，悬停看组内成员），点一级 → 右边「细分」条出现组内成员分类与小分类，点一下收窄、再点回「全部」。**宽度可拖**：把鼠标移到竖栏右缘拖那条竖线即可调宽（168–380px，不超视口 34%），双击复位、聚焦后 \`←\`/\`→\` 每次 ±16px。**可收起**：\`☰\` 或 \`Ctrl/Cmd+Shift+B\` 在「完整 ⇄ 窄条」间切换，\`Shift+\`点击 \`☰\` 则完全隐藏（再按恢复）；宽度与状态都记在本地，刷新保持。窄屏（≤900）自动变可滑动抽屉 + 遮罩。改版只动**视图层映射**：原始分类 id、数据分片、搜索索引、收藏里存的类别都不变。
- **主区工具条**：常驻「当前一级/成员/小分类名 + 条目数 + 搜索状态」，配「✕ 清除搜索」；「全部分类」总览仍每类先铺 48 条、滚动到才载入。
- **点标签名 = 加入已选 + 立即复制**，就地弹「已复制」浮标。
- **已选托盘**：底部常驻，每个标签可单独 \`×\` 删除、可一键清空、可复制、可导出 txt。**高度可拖**：鼠标移到托盘顶缘拖那条短杠即可改高（96–560px，不超视口 62%），双击复位、聚焦后 \`↑\`/\`↓\` 每次 ±16px，多出来的高度给输出框。**可收起**：「收起」按钮或 \`Ctrl/Cmd+Shift+T\` 在「完整 ⇄ 窄条」间切换，\`Shift+\`点击「收起」则整条隐藏（右下角出现「▲ 装配台」小胶囊可随时召回）；高度与状态都记在本地，刷新保持。
- **收藏夹**：卡片右上角 \`☆\` 收藏常用单标签，点左侧分类栏最上「★ 收藏」只看收藏。
- **标签串收藏**（页头「★ 收藏夹」/ \`Ctrl/Cmd+Shift+F\`）：托盘「☆ 收藏这串」把当前已选整串存下，可改名 / 备注 / 置顶 / 上下移动，「复用为已选」回填装配台、「用这串搜索」当搜索词；按内容自动去重，支持导出 / 导入 JSON；存 localStorage ＋ 服务端 \`data/collections.json\`（\`/api/collections\`）双份，按 id 合并、删除用墓碑同步。
- **装配台**：按官方顺序自动分层（质量/元信息 → 人数 → 角色 → 作品 → 画师 → 服装与动作 → 构图光影场景），自动补正向前缀与负向串、去重。
- **缩略图**：\`成品方案库\`（1,746 个成套方案）用 AnimaTags-DB / Dressing-doll 的真实预览图（jsDelivr CDN），其余标签用网页即时生成的 data URI 占位图（零文件、零额外请求）；右上角按钮可整体关闭。
- **两种搜索**：精准（子串匹配标签/中文/别名）与模糊（Fuse.js 容错，\`masterpice\` → \`masterpiece\`）。
- **悬浮检视窗**：中文释义、推荐权重、投稿量、别名、置信度、来源、小分类。
- **日间 / 夜间双主题**：首次打开跟随系统（\`prefers-color-scheme\`），点页头按钮或 \`Ctrl/Cmd+Shift+L\` 切换，切换时圆形扩散揭幕（View Transitions，不支持则整页过渡），选择记在 localStorage（\`animaKB.theme\`），刷新不闪白。
- **毛玻璃与圆角**：页头、底部托盘、装配台抽屉、悬浮窗、浮标统一 \`blur(22px) saturate(1.7)\` + 1px 描边 + 顶部内高光；全部可点元素圆角化（卡片 18px / 面板 16 / 控件 12 / 胶囊 999）。
- **响应式**：1440 桌面 → 1180 → 980 → 820 → 760 → 520 六档；手机竖屏（360–430px）标题与搜索框各占一行、卡片单列、托盘在无已选且从未设置过时自动收成窄条。
- 快捷键：\`/\` 或 \`Ctrl/Cmd+K\` 搜索，\`Ctrl/Cmd+B\` 装配台，\`Ctrl/Cmd+Shift+L\` 切换主题，\`Esc\` 关闭。

> 视觉规范的完整说明见 **\`设计规范.md\`**；设计令牌见 \`assets/tokens.json\`（可用 Tokens Studio 导入 Figma），主题切换 Lottie 见 \`assets/theme-toggle.json\`（预览页 \`assets/lottie-preview.html\`）。

## 6. 重建与更新

\`\`\`sh
cd anima-tag-kb
node scripts/build-hierarchy.mjs     # 重建数据分包（画师类/）
node scripts/finish-build.mjs        # 重建 README、交付文档、网页副本（内联收藏夹核心）
node scripts/selftest-collections.mjs # 收藏夹自测：纯逻辑 + 接口（-v 明细 / --no-http 只测逻辑）
\`\`\`

- 改**界面/交互**：只改 \`viewer/template.html\`，然后跑 \`finish-build.mjs\` 复制到根目录。
- 改**收藏夹逻辑**：改 \`viewer/collections-core.js\`（构建时自动内联进副本），跑 \`selftest-collections.mjs\` 与 \`finish-build.mjs\`。
- 改**层级归属**：改 \`scripts/taxonomy.mjs\` 的规则表，重建。
- 改**中文译名**：改 \`scripts/build-hierarchy.mjs\` 的词表段，重建。
- 旧的 \`scripts/build-kb.mjs\` 是第一代构建器（87 类目结构），**已被取代**，运行会被拒绝（避免覆盖新数据）。

## 7. 来源

${(meta.sources || []).map(s => `- ${s.label} —— ${s.url}`).join('\n')}

## 8. 官方硬规范（构建时写进 manifest.meta.conventions）

${(meta.conventions || []).map((c, i) => `${i + 1}. ${c}`).join('\n')}
`;
fs.writeFileSync(path.join(ROOT, 'README.md'), rootReadme);

/* ---------- 5. 分类树概览.md ---------- */
const tree = cats.map(c => {
  const subs = (c.subs || []).slice(0, 40).map(s => `    - ${s.name}（${nf(s.count)}）`).join('\n');
  const more = (c.subs || []).length > 40 ? `\n    - …另有 ${c.subs.length - 40} 个小分类` : '';
  const slug = c.slug ? ` ｜ tag_group:\`${c.slug}\`` : '';
  return `- **${c.name}**（${c.id}，${c.kind === 'official' ? 'Danbooru 官方组' : '策展分类'}）— ${nf(c.count)} 条 / ${c.subs.length} 个小分类${slug}\n${subs}${more}`;
}).join('\n');

const treeDoc = `# Anima 标签库 · 分类树概览

> 构建日期 **${meta.built_at}** ｜ ${nf(meta.total)} 条标签 ｜ ${meta.bigs} 个大分类 / ${meta.subs} 个小分类 ｜ 官方组条目 ${nf(meta.official_tags)} 条
> 两级结构：第一级 = 13 个策展分类 + 56 个 Danbooru 官方组；第二级 = 官方小节（已中文化）/ WeiLin 131 个二级分类 / 按语义主题拆分。

## 统计

| 指标 | 数值 |
| --- | --- |
| 标签总数 | ${nf(meta.total)} |
| 大分类 | ${meta.bigs}（策展 13 + 官方组 56） |
| 小分类 | ${meta.subs} |
| 官方组条目 | ${nf(meta.official_tags)} |
| 带真实投稿量 | ${nf(meta.verified_freq)} |
| 缺中文译名 | ${nf(meta.zh_missing)}（多为极冷门条目，标注「待补译」） |
| 归属来源分布 | ${report.attribution ? Object.entries(report.attribution).map(([k, v]) => `${k}:${v}`).join(' / ') : '—'} |

归属优先级：官方小节 → 官方组成员（组内小分类记「其他」）→ WeiLin 二级分类 → ai-tag-toolbox → 本地策展类目 → 关键词规则 → 待归类。

## 分类树

${tree}

## 说明

- 「小分类」的名字优先取 **Danbooru 官方 tag_group 小节名**的中译（如 attire 的「上衣 / 下装 / 鞋袜 / 制服 / 传统服饰 / 珠宝与配饰」），其余取 WeiLin 官方二级分类名，再其余按语义规则归并。
- 「其他 / 待归类」是保底桶：官方组里不属于任何小节的标签都落在「其他」，规则也命中不了的落到 \`cb:misc\` 的「待归类」。
- 全部数值由 \`node scripts/build-hierarchy.mjs\` 生成，改规则后重建即可刷新本文档（\`node scripts/finish-build.mjs\`）。
`;
fs.writeFileSync(path.join(ROOT, '分类树概览.md'), treeDoc);

/* ---------- 6. 官方组中英对照表.md ---------- */
const ogCats = cats.filter(c => c.kind === 'official');
const rows = ogCats.map(c => {
  const d = detail[c.slug] || {};
  const secs = (d.sections || []).map(s => {
    const tags = (s.tags || []).slice(0, 12).map(t => t.tag).join(', ');
    return `| ${s.heading} | ${s.heading_zh || '—'} | ${(s.tags || []).length} | ${tags}${(s.tags || []).length > 12 ? ' …' : ''} |`;
  }).join('\n');
  return `## ${c.name}（\`tag_group:${c.slug}\`）

- 标签数：**${nf(c.count)}** ｜ 小节数：${(d.sections || []).length} ｜ 官方页面：${c.url || '—'}
- 小分类（本库内）：${(c.subs || []).map(s => `${s.name}(${s.count})`).join('、') || '—'}

${secs ? `| 官方小节（EN） | 中译 | 标签数 | 示例标签 |\n| --- | --- | --- | --- |\n${secs}` : '（该组没有分小节，整组作为一个分类）'}`;
}).join('\n\n');

const ogDoc = `# Danbooru 官方 tag_group · 中英对照表

> 共 **${ogCats.length} 组**（本库把它们作为第一级大分类，官方小节作为第二级小分类）
> 来源：<https://danbooru.donmai.us/wiki_pages/tag_groups> ｜ 抽取脚本 \`scripts/extract-taggroup-sections.mjs\` ｜ 中译表 \`data/section-zh.json\`
> 构建日期 **${meta.built_at}**

${rows}
`;
fs.writeFileSync(path.join(ROOT, '官方组中英对照表.md'), ogDoc);

console.log('清理旧 tags/*.json：', removedOld, '个');
console.log('展览板副本：', path.basename(outHtml), fs.statSync(outHtml).size, 'B');
console.log('已写出：画师类/README.md、README.md、分类树概览.md、官方组中英对照表.md');
