# 画师类/ —— Anima 标签工作台的数据分包

> 构建日期 **2026-10-06** ｜ 38,306 条标签 / 69 个大分类 · 711 个小分类 ｜ 模型 Anima 2B (CircleStone Labs × Comfy Org)
> 本目录由 `node scripts/build-hierarchy.mjs` 生成，**不要手改 json**（下次构建会整文件覆盖）。

## 文件结构

```
画师类/
├── manifest.json        大分类清单：meta（模型/统计/规范/来源/field_map）+ categories[]
├── bigs/<id>.json       每个大分类一个分片；超过 3500 条自动分片为 <id>-1.json、<id>-2.json …
└── search-index.json    检索索引：{ fields, cats, rows }，每行是一个标签的扁平记录
```

`categories[]` 每项字段：`id`（`cb:*` 策展分类 / `og:*` Danbooru 官方组）、`name`、`order`、`kind`（curated|official）、
`slug`（官方组 slug，策展类为空）、`intro`、`count`、`subs[]`（小分类名 + 数量）、`files[]`（分片路径）、`url`（官方 tag_group 页面）。

`meta.bigs` / `meta.subs` 是**大分类总数 / 小分类总数**两个整数（当前 69 / 711），不是数组；小分类明细在每项的 `subs[]` 里。

## 条目是稀疏数组

`bigs/*.json` 的 `items[]` 里每条标签都是一个**稀疏数组**，下标含义（= `manifest.meta.field_map`）：

| 下标 | 字段 |
| --- | --- |
| 0 | `tag` |
| 1 | `zh` |
| 2 | `weight` |
| 3 | `freq` |
| 4 | `confidence` |
| 5 | `aliases` |
| 6 | `note` |
| 7 | `slot` |
| 8 | `img` |
| 9 | `placeholder` |
| 10 | `source` |
| 11 | `srcKey` |
| 12 | `sub` |
| 13 | `official` |
| 14 | `nsfw` |
| 15 | `groups` |
| 16 | `srcs` |
| 17 | `big` |

空值不写（数组里留 `null`）。`freq` 是 Danbooru 真实投稿量；`official=1` 表示来自 Danbooru 官方 tag_group。

## search-index.json

`rows[]` 每行按 `fields` 顺序排列：
`['tag','big','order','zh','aliases','weight','freq','confidence','sub','bigName','slot','official']`
（`big` 是大分类 id，`sub` 是小分类名，`freq` 已格式化成 `12.3k` / `3M` 这样的短串）。

## 怎么更新

1. 改数据：动 `scripts/` 下的表（`taxonomy.mjs` 的层级规则、`build-hierarchy.mjs` 的译名补全、`data/sources/` 的原始数据），**不要改本目录的 json**。
2. 重建：`node scripts/build-hierarchy.mjs` → `node scripts/finish-build.mjs`。
3. 页面不用改：`viewer/template.html` 会读 `manifest.json` 自适应，分片变多变少都行。
4. 换机器/换盘符：整个 `anima-tag-kb/` 目录可以直接拷走，双击 `启动展览板.cmd` 即可。
