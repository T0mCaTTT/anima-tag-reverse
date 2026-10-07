# Anima 标签工作台 · 本地知识库

> 构建日期 **2026-10-06** ｜ 38,306 条标签 / 69 个大分类 · 711 个小分类 ｜ Danbooru 官方组条目 9,645 条 ｜ 已取证投稿量 33,707 条
> 面向 **Anima 2B**（CircleStone Labs × Comfy Org）的动漫向提示词标签库：全部为英文标签 + 中文译名，含来源与投稿量，可直接拼装成出图提示词。

## 1. 怎么用（最快路径）

双击 **`启动展览板.cmd`** —— 会起一个本地小服务并自动打开浏览器（页面：`anima-tag-exhibition.html`）。
**不要直接双击 HTML 文件**：数据是用 `fetch` 按需加载的，`file://` 下浏览器会拦掉。

手动方式：`cd anima-tag-kb` → `node scripts/serve-kb.mjs` → 访问 `http://127.0.0.1:8100/anima-tag-exhibition.html`

## 2. 目录结构

```
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
```

## 3. 数据规模

- 标签总数 **38,306**：策展库 ＋ Danbooru 官方 tag_group（56 组 / 662 小节）＋ ai-tag-toolbox 社区库 ＋ WeiLin 官方译名词库 ＋ Danbooru 全站标签榜（投稿量 ≥200 的扩充）。
- **9,645** 条来自 Danbooru 官方 tag_group；**33,707** 条带真实投稿量（`freq`）。
- 中文：WeiLin 词库 + 社区库 + 官方条目英文释义 + 规则合成；仍缺译名 **3,840** 条（极冷门条目，悬浮窗标注「待补译」，不编造）。

## 4. 层级（两级分类）

第一级 **69 个大分类** = 13 个策展分类 + 56 个 Danbooru 官方组；第二级 **711 个小分类** = 官方小节名（已中文化）＋ WeiLin 二级分类名 ＋ 按语义拆分的主题。
> 展览板在这两级**数据**之上又加了一层**纯视图分组**：把 69 个大分类归成 24 个一级入口（映射表见 §5），数据文件、分类 id、搜索索引与收藏内容都不受影响。

| # | id | 名称 | 类型 | 标签数 | 小分类 |
| --- | --- | --- | --- | --- | --- |
| 1 | `cb:base` | 基础与元信息 | 策展 | 148 | 5 |
| 2 | `cb:character` | 角色 | 策展 | 5,713 | 3 |
| 3 | `cb:series` | 作品与 IP | 策展 | 1,098 | 3 |
| 4 | `cb:artist` | 画师 | 策展 | 6,422 | 3 |
| 5 | `og:hair` | 头发 | 官方组 | 493 | 16 |
| 6 | `og:hair-color` | 发色 | 官方组 | 27 | 3 |
| 7 | `og:hair-styles` | 发型 | 官方组 | 186 | 14 |
| 8 | `og:face` | 面部 | 官方组 | 355 | 13 |
| 9 | `og:eyes` | 眼睛 | 官方组 | 380 | 15 |
| 10 | `og:ears` | 耳朵 | 官方组 | 48 | 4 |
| 11 | `og:makeup` | 妆容 | 官方组 | 123 | 8 |
| 12 | `og:skin-color` | 肤色 | 官方组 | 32 | 5 |
| 13 | `og:body-parts` | 身体部位 | 官方组 | 1,822 | 14 |
| 14 | `og:attire` | 服装 | 官方组 | 2,682 | 24 |
| 15 | `og:headwear` | 头饰 | 官方组 | 345 | 13 |
| 16 | `og:legwear` | 腿足穿着 | 官方组 | 318 | 12 |
| 17 | `og:handwear` | 手部穿着 | 官方组 | 111 | 6 |
| 18 | `og:sleeves` | 袖子 | 官方组 | 74 | 10 |
| 19 | `og:neck-and-neckwear` | 颈部与颈饰 | 官方组 | 276 | 14 |
| 20 | `og:eyewear` | 眼镜 | 官方组 | 92 | 8 |
| 21 | `og:accessories` | 配饰 | 官方组 | 1,530 | 17 |
| 22 | `og:fashion-style` | 时尚风格 | 官方组 | 168 | 13 |
| 23 | `og:patterns` | 图案 | 官方组 | 3 | 2 |
| 24 | `og:prints` | 印花 | 官方组 | 37 | 6 |
| 25 | `og:posture` | 姿态 | 官方组 | 464 | 24 |
| 26 | `og:gestures` | 手势与动作 | 官方组 | 128 | 10 |
| 27 | `og:hands` | 手部 | 官方组 | 99 | 9 |
| 28 | `og:holding-tags` | 手持物 | 官方组 | 354 | 59 |
| 29 | `og:verbs-and-gerunds` | 动词 | 官方组 | 506 | 5 |
| 30 | `og:dances` | 舞蹈 | 官方组 | 100 | 7 |
| 31 | `og:image-composition` | 构图·视角·技法 | 官方组 | 360 | 15 |
| 32 | `og:focus-tags` | 焦点与镜头 | 官方组 | 45 | 4 |
| 33 | `og:lighting` | 光影 | 官方组 | 130 | 10 |
| 34 | `og:colors` | 色彩 | 官方组 | 73 | 10 |
| 35 | `og:backgrounds` | 背景 | 官方组 | 570 | 22 |
| 36 | `og:locations` | 场景地点 | 官方组 | 365 | 13 |
| 37 | `og:real-world-locations` | 现实地点 | 官方组 | 487 | 9 |
| 38 | `og:water` | 水 | 官方组 | 34 | 7 |
| 39 | `og:fire` | 火 | 官方组 | 87 | 8 |
| 40 | `og:flowers` | 花 | 官方组 | 275 | 5 |
| 41 | `og:animals-cats` | 猫科 | 官方组 | 191 | 15 |
| 42 | `og:animals-dogs` | 犬科 | 官方组 | 119 | 10 |
| 43 | `og:birds` | 鸟类 | 官方组 | 280 | 3 |
| 44 | `og:creatures` | 传说生物 | 官方组 | 191 | 4 |
| 45 | `og:food-tags` | 食物 | 官方组 | 1,225 | 22 |
| 46 | `og:technology` | 科技与器械 | 官方组 | 383 | 29 |
| 47 | `og:audio-tags` | 音频 | 官方组 | 349 | 13 |
| 48 | `og:sports` | 运动 | 官方组 | 366 | 15 |
| 49 | `og:jobs` | 职业 | 官方组 | 92 | 7 |
| 50 | `og:holidays` | 节日 | 官方组 | 115 | 22 |
| 51 | `og:companies` | 公司与品牌 | 官方组 | 274 | 14 |
| 52 | `og:text` | 文字 | 官方组 | 272 | 16 |
| 53 | `og:symbols` | 符号 | 官方组 | 435 | 26 |
| 54 | `og:phrases` | 短语 | 官方组 | 101 | 3 |
| 55 | `og:metatags` | 元标签 | 官方组 | 200 | 10 |
| 56 | `og:year-tags` | 年份标签 | 官方组 | 69 | 2 |
| 57 | `og:subjective` | 主观评价 | 官方组 | 51 | 3 |
| 58 | `og:theme` | 主题 | 官方组 | 18 | 1 |
| 59 | `og:censorship` | 审查 | 官方组 | 84 | 7 |
| 60 | `og:visual-aesthetic` | 视觉美学 | 官方组 | 299 | 17 |
| 61 | `cb:body` | 身体与面部 | 策展 | 58 | 2 |
| 62 | `cb:items` | 物品与器物 | 策展 | 152 | 1 |
| 63 | `cb:animals` | 动物（其他） | 策展 | 464 | 6 |
| 64 | `cb:effects` | 特效与滤镜 | 策展 | 124 | 4 |
| 65 | `cb:nsfw` | 成人内容 | 策展 | 890 | 3 |
| 66 | `cb:negative` | 负向与安全 | 策展 | 19 | 3 |
| 67 | `cb:scheme` | 成品方案库 | 策展 | 1,607 | 3 |
| 68 | `cb:hanfu` | 汉服（WeiLin 策展） | 策展 | 13 | 1 |
| 69 | `cb:misc` | 其他 | 策展 | 3,305 | 1 |

完整树见 [分类树概览.md](<分类树概览.md>)。

## 5. 展览板功能

- **左侧分类栏（两级就到标签）**：竖栏把 69 个大分类归成 **24 个一级入口**（图标 + 条目数，悬停看组内成员），点一级 → 右边「细分」条出现组内成员分类与小分类，点一下收窄、再点回「全部」。**宽度可拖**：把鼠标移到竖栏右缘拖那条竖线即可调宽（168–380px，不超视口 34%），双击复位、聚焦后 `←`/`→` 每次 ±16px。**可收起**：`☰` 或 `Ctrl/Cmd+Shift+B` 在「完整 ⇄ 窄条」间切换，`Shift+`点击 `☰` 则完全隐藏（再按恢复）；宽度与状态都记在本地，刷新保持。窄屏（≤900）自动变可滑动抽屉 + 遮罩。改版只动**视图层映射**：原始分类 id、数据分片、搜索索引、收藏里存的类别都不变。
- **主区工具条**：常驻「当前一级/成员/小分类名 + 条目数 + 搜索状态」，配「✕ 清除搜索」；「全部分类」总览仍每类先铺 48 条、滚动到才载入。
- **点标签名 = 加入已选 + 立即复制**，就地弹「已复制」浮标。
- **已选托盘**：底部常驻，每个标签可单独 `×` 删除、可一键清空、可复制、可导出 txt。**高度可拖**：鼠标移到托盘顶缘拖那条短杠即可改高（96–560px，不超视口 62%），双击复位、聚焦后 `↑`/`↓` 每次 ±16px，多出来的高度给输出框。**可收起**：「收起」按钮或 `Ctrl/Cmd+Shift+T` 在「完整 ⇄ 窄条」间切换，`Shift+`点击「收起」则整条隐藏（右下角出现「▲ 装配台」小胶囊可随时召回）；高度与状态都记在本地，刷新保持。
- **收藏夹**：卡片右上角 `☆` 收藏常用单标签，点左侧分类栏最上「★ 收藏」只看收藏。
- **标签串收藏**（页头「★ 收藏夹」/ `Ctrl/Cmd+Shift+F`）：托盘「☆ 收藏这串」把当前已选整串存下，可改名 / 备注 / 置顶 / 上下移动，「复用为已选」回填装配台、「用这串搜索」当搜索词；按内容自动去重，支持导出 / 导入 JSON；存 localStorage ＋ 服务端 `data/collections.json`（`/api/collections`）双份，按 id 合并、删除用墓碑同步。
- **装配台**：按官方顺序自动分层（质量/元信息 → 人数 → 角色 → 作品 → 画师 → 服装与动作 → 构图光影场景），自动补正向前缀与负向串、去重。
- **缩略图**：`成品方案库`（1,746 个成套方案）用 AnimaTags-DB / Dressing-doll 的真实预览图（jsDelivr CDN），其余标签用网页即时生成的 data URI 占位图（零文件、零额外请求）；右上角按钮可整体关闭。
- **两种搜索**：精准（子串匹配标签/中文/别名）与模糊（Fuse.js 容错，`masterpice` → `masterpiece`）。
- **悬浮检视窗**：中文释义、推荐权重、投稿量、别名、置信度、来源、小分类。
- **日间 / 夜间双主题**：首次打开跟随系统（`prefers-color-scheme`），点页头按钮或 `Ctrl/Cmd+Shift+L` 切换，切换时圆形扩散揭幕（View Transitions，不支持则整页过渡），选择记在 localStorage（`animaKB.theme`），刷新不闪白。
- **毛玻璃与圆角**：页头、底部托盘、装配台抽屉、悬浮窗、浮标统一 `blur(22px) saturate(1.7)` + 1px 描边 + 顶部内高光；全部可点元素圆角化（卡片 18px / 面板 16 / 控件 12 / 胶囊 999）。
- **响应式**：1440 桌面 → 1180 → 980 → 820 → 760 → 520 六档；手机竖屏（360–430px）标题与搜索框各占一行、卡片单列、托盘在无已选且从未设置过时自动收成窄条。
- 快捷键：`/` 或 `Ctrl/Cmd+K` 搜索，`Ctrl/Cmd+B` 装配台，`Ctrl/Cmd+Shift+L` 切换主题，`Esc` 关闭。

> 视觉规范的完整说明见 **`设计规范.md`**；设计令牌见 `assets/tokens.json`（可用 Tokens Studio 导入 Figma），主题切换 Lottie 见 `assets/theme-toggle.json`（预览页 `assets/lottie-preview.html`）。

## 6. 重建与更新

```sh
cd anima-tag-kb
node scripts/build-hierarchy.mjs     # 重建数据分包（画师类/）
node scripts/finish-build.mjs        # 重建 README、交付文档、网页副本（内联收藏夹核心）
node scripts/selftest-collections.mjs # 收藏夹自测：纯逻辑 + 接口（-v 明细 / --no-http 只测逻辑）
```

- 改**界面/交互**：只改 `viewer/template.html`，然后跑 `finish-build.mjs` 复制到根目录。
- 改**收藏夹逻辑**：改 `viewer/collections-core.js`（构建时自动内联进副本），跑 `selftest-collections.mjs` 与 `finish-build.mjs`。
- 改**层级归属**：改 `scripts/taxonomy.mjs` 的规则表，重建。
- 改**中文译名**：改 `scripts/build-hierarchy.mjs` 的词表段，重建。
- 旧的 `scripts/build-kb.mjs` 是第一代构建器（87 类目结构），**已被取代**，运行会被拒绝（避免覆盖新数据）。

## 7. 来源

- 本地策展库（前 13 轮构建） —— anima-tag-kb/
- Danbooru 全站标签榜（16 万条，含真实投稿量） —— https://danbooru.donmai.us/tags?search%5Border%5D=count
- Danbooru 官方 tag_group（56 组 / 662 小节） —— https://danbooru.donmai.us/wiki_pages/tag_groups
- stars-abyss/ai-tag-toolbox（18,093 行社区标签） —— https://github.com/star-abyss/ai-tag-toolbox
- weilin9999/WeiLin-Comfyui-Tools-Prompt（4.98 万条官方译名 + 131 二级分类） —— https://github.com/weilin9999/WeiLin-Comfyui-Tools-Prompt
- yande.re / safebooru / e-shuushuu（画廊站点对照） —— data/sources/

## 8. 官方硬规范（构建时写进 manifest.meta.conventions）

1. 标签一律小写；空格代替下划线（仅 score_* 保留下划线）
2. 画师标签必须带 @ 前缀，否则权重极弱
3. 正向提示词顺序：质量/元信息/年份/安全档 → 人数 → 角色 → 作品 → 画师 → 外观动作 → 构图光影场景
4. 官方正向前缀：masterpiece, best quality, score_7, safe, 
5. 官方负向：worst quality, low quality, score_1, score_2, score_3, artist name, blurry, jpeg artifacts, chromatic aberration
6. 数据集标签 ye-pop / deviantart 必须放在提示词最行首并换行
7. 加权比 SDXL 更重（例 (chibi:2)）；训练含随机 tag dropout，不必堆满标签
