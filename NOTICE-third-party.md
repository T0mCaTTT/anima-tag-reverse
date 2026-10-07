# 第三方内容与数据来源声明

本仓库（`anima-tag-reverse`：Anima 反推提示词技能 + 中文标签知识库）中的标签数据与部分静态资源整理自若干公开项目与站点。**这些内容的著作权归各自原作者所有**，本仓库仅做整理、翻译对齐与格式转换，并在此按其原有来源逐项说明。二次使用、二次分发或商用前，请自行向原作者确认授权。

## 1. 标签数据来源

| 来源 | 内容 | 在本仓库中的用途 | 出处 |
|---|---|---|---|
| **WeiLin-Comfyui-Tools-Prompt**（weilin9999） | 约 4.98 万条官方中文译名，131 个二级分类 | 中文译名对齐、二级分类命名 | https://github.com/weilin9999/WeiLin-Comfyui-Tools-Prompt |
| **Danbooru** | 官方 `tag_group`（56 组 / 662 小节）、全站标签榜（含真实投稿量 `freq`） | 官方组层级、中文对照、投稿量 | https://danbooru.donmai.us/wiki_pages/tag_groups<br>https://danbooru.donmai.us/tags?search%5Border%5D=count |
| **ai-tag-toolbox**（star-abyss） | 约 18,093 行社区标签与同义词 | 社区标签补充、同义词归一 | https://github.com/star-abyss/ai-tag-toolbox |
| 画廊站点对照（yande.re / safebooru / e-shuushuu） | 标签使用频次对照 | 校验译名与频次 | 原始 dump 未随仓库分发 |
| 本地策展库（本项目自建，13 轮构建） | 策展分类、中文释义、置信度 | 顶层 13 个策展分类 | 本仓库 |

## 2. WeiLin 提示词库内容的使用说明

本知识库**使用了 `weilin9999/WeiLin-Comfyui-Tools-Prompt` 的中文译名词库作为译名与二级分类的对齐依据**，具体体现在：

- `anima-tag-kb/画师类/manifest.json` 与 `anima-tag-kb/画师类/bigs/*.json` 中，大量标签的 `zh`（中文名）字段与该库的官方译名一致或以其为准；
- 711 个小分类里有相当一部分沿用该库的二级分类名称；
- 构建时以该库条目作为译名优先级较高的一路来源，其余来源仅作补充。

该库的原始文件（`weilin-*.sql` / `weilin-danbooru.jsonl` / `weilin-tags.json` 等 dump）**未包含在本仓库中**，也未包含在发布包的任何一档里；仓库中只保留经整理后的译文与分类结果。如果你是该库作者并希望调整署名方式或使用范围，请开 issue，我们会立即配合修改或移除相关内容。

## 3. 第三方代码与静态资源

| 组件 | 版本/位置 | 许可 |
|---|---|---|
| Fuse.js | `anima-tag-kb/vendor/fuse.min.js` | Apache-2.0（许可证随库文件一并保留，未修改） |

`anima-tag-kb/assets/`、`anima-tag-kb/viewer/` 为本项目自有的静态资源与页面脚本。

## 4. 本项目代码

`skills/anima-tag-reverse/`（`bin/`、`src/`、`tests/`、`tools/`）与 `anima-tag-kb/scripts/` 为本项目自有的整理与检索代码。**本仓库当前未附开源许可证文件**，即默认保留所有权利；如需在其它项目中使用，请先联系作者。

## 5. 如果你要再分发

- 保留本文件与 `anima-tag-kb/README.md` 的「来源」章节，不要删掉来源链接；
- 不要把它包装成 WeiLin 官方或 Danbooru 官方的产物；
- 标签数据属于「事实性整理 + 翻译」，但译名与分类结构带有原作者的整理劳动，请一并署名。
