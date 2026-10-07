---
name: anima-tag-reverse
description: 把自然语言描述或图像观察结果反推成 Anima 2B / Danbooru 可用的标签串，默认输出一行逗号分隔的纯英文标签（不带官方质量前缀）。Use when 用户给一段中文/英文/日文画面描述或一张图，想要「该用哪些 tag」「帮我配提示词」「这张图怎么还原」；也用于把已有标签串补全、查词、生成正负向提示词。不过滤内容：R18 / NSFL 描述照常转换，只把分级 token 写对，不说教、不打码。零依赖 Node，直接读本地 anima-tag-kb 词库（38,306 条）。
whenToUse: 用户描述一个画面想变成提示词；用户发图片要求反推标签或还原画风；用户问某个概念对应哪些 Danbooru 标签；需要输出分层标签串 / 结构化 JSON / 负向串 / 带官方前缀的完整提示词。
user-invocable: true
---

# Anima 标签反推（anima-tag-reverse）

把「人话 / 图像观察」翻译成 Danbooru 标签，按 Anima 官方规范分层排序，直接可贴进 Anima 2B 的提示词框。

## 什么时候用它

- 用户给一段描述：「长发蓝发少女坐在教室里看书，夜晚，逆光」→ 要标签
- 用户给一张图（我先看图写成结构化描述，再走图像分支）→ 要标签
- 用户问「双马尾怎么说」「厚涂是哪个 tag」→ 单条检索
- 用户要负向提示词、要分层结果、要结构化 JSON 给别的程序
- 用户要 R18 / NSFL 画面（露骨、猎奇、断肢……）：照常转换，不做内容审查

## 输出契约（用户定的硬要求）

| 要求 | 做法 |
| --- | --- |
| 单行文本 | 默认输出就是一行，无换行、无前后缀说明、无 Markdown 代码块 |
| 逗号分隔的纯标签 | `标签1, 标签2, 标签3`；空段/多余逗号都不会有 |
| 默认不带官方前缀 | `masterpiece, best quality, score_7, safe` 由用户自己拼；要带就用 `--format prompt` |
| 不做内容审查 | R18 / NSFL 元素一个标签都不删；只在需要时把**分级 token**写对（见下） |
| 标签合规、无冗余 | 按 Anima 官方分层顺序输出；空格代替下划线（`score_*` 除外，库里 `cherry_tree` 输出成 `cherry tree`）；前缀里已有的标签不会重复出现 |

分级自动适配：命中露骨标签（`explicit`）或成人内容分类（`cb:nsfw`，如裸体 / 性行为 / 情趣服饰）时，分级 token 升级为 `explicit` / `nsfw` 并放在行首；其余情况不写分级。要强制指定用 `--rating safe|sensitive|questionable|nsfw|explicit`。

## 三步流水线（本技能的实现结构）

| 步骤 | 文件 | 职责 |
| --- | --- | --- |
| ① 输入解析 | `src/parse.mjs`、`src/image-spec.mjs`、`src/jp-lexicon.mjs` | 分句、否定识别、人数/画师强制命中、日文→英文桥接、图像观察 schema → 分句 + 层提示 |
| ② 标签匹配 | `src/lexicon.mjs`、`src/match.mjs` | 建表面/词元索引；三条召回（强制 / 最长表面 / 词元+相似度）；打分 + 四道压制 |
| ③ 输出格式化 | `src/compose.mjs` | 分层排序、分级适配、单行标签串、官方前缀形态、负向串、结构化 JSON、Markdown 报告 |

## 跑法

技能根目录：本文件（`SKILL.md`）所在目录。下面的命令都在技能根目录里跑；你的会话 cwd 不是那里时先切过去：

```bash
cd <技能根目录>          # Windows: cd /d "…\skills\anima-tag-reverse"
```
node bin/rtag.mjs "长发蓝发少女坐在教室里看书，夜晚，逆光，不要眼镜"   # 默认：单行纯标签（无前缀）
node bin/rtag.mjs "..." --format prompt                              # 带官方前缀的完整提示词
node bin/rtag.mjs "..." --format negative                            # 只要负向串
node bin/rtag.mjs "..." --format md                                  # 带分层与分数（人看）
node bin/rtag.mjs "..." --format json                                # 给程序用
node bin/rtag.mjs "..." --rating nsfw                                # 手动指定分级
node bin/rtag.mjs --image-spec 观察.json --format prompt              # 图像观察 → 标签
node bin/rtag.mjs --search "blue eyes"                               # 单条检索
node bin/rtag.mjs --template                                         # 打印图像观察模板
node bin/rtag.mjs --info                                             # 词库概况
node tests/smoke.mjs                                                 # 自测（17 例）
```

会话内调用（我直接用）：

```js
import { reverseText, reverseImageSpec } from '<技能目录>/src/index.mjs';

const r = reverseText('银发少女站在樱花树下，微笑，侧脸');
r.bare;               // 'profile, smile, cherry_tree, under_tree, silver hair'   ← 默认交付形态
r.tags;               // 同 r.bare（单行纯标签）
r.prompt;             // 'masterpiece, best quality, score_7, safe, ...'（带前缀）
r.rating;             // 'safe' | 'explicit' | ...
r.positive.tags;      // ['profile', 'smile', ...]
r.negativeTags;       // { string, base, added }
```

## 输出长什么样

默认（`--format tags`，也是不带 `--format` 时的形态）：

```
long hair, blue hair, sitting, backlighting, reading, night, classroom
```

R18 例（分级自动升到行首，内容一个都不删）：

```
explicit, girl, naked, on_bed, orgasm
```

要完整提示词时（`--format prompt`）：

```
masterpiece, best quality, score_7, explicit, girl, naked, on_bed, orgasm
```

顺序固定为 `质量/元信息 → 人数 → 角色 → 作品 → 人物外观 → 画师/画风 → 服装与动作 → 构图光影场景 → 其他`，即 Anima 官方约定。

## 看图反推的标准流程（我执行）

1. 先按 `--template` 的 schema 写一份观察 JSON（只写看得到的：人数、发型发色、瞳色、服装、姿态、场景、光影、画风/画师、NSFW、不该出现的元素）。
2. `node bin/rtag.mjs --image-spec 观察.json --format md`
3. 检查 md 里的「未匹配片段」：词库没有的概念要么换成同义说法，要么在回答里说明。
4. 需要画风/画师时，在 `artists` 里写 `@画师名`（强制命中，不看相似度）。

## 在技能中心里启用 / 禁用

技能装在用户技能目录 `<用户主目录>/.dsh/skills/anima-tag-reverse/`（Windows 即 `C:\Users\<用户名>\.dsh\skills\anima-tag-reverse\`；技能中心面板里「用户技能」一栏，带开关）。安装与更新都跑同一条命令：

```bash
node tools/install-dsh-skill.mjs          # 复制一份到 ~/.dsh/skills/anima-tag-reverse 并写 kb-path.json
node tools/install-dsh-skill.mjs --check  # 只检查目标目录是否已是最新
```

装好后在技能中心点开关即可启用/禁用（面板写的是 SKILL.md frontmatter 的 `disable-model-invocation`，模型目录会热刷新）。源码改完要再跑一次安装脚本才会同步到用户技能目录；面板里如果编辑过拷贝的那份，重跑安装会以仓库版本为准覆盖（脚本会先备份到 `~/.dsh/skill-backups/`，刻意放在技能根目录外，避免加载器把副本当成第二个同名技能）。

## 关键设计（改代码前先读）

- **候选召回三条路**：① 强制（引号内容 / `@画师` / 人数）② 表面最长匹配（中文释义、别名、日文桥接都注册成「表面」）③ 词元 + 相似度（英文按**词覆盖**算，中文只认**包含**关系）。
- **四道压制**：泛词压制（说了「黑色和服」就别再给「和服」以外的一堆被包含的泛词）、一表一winner（同一个表面只留分最高的一个标签）、变体压制（`u.a._school_uniform` 这类变体）、特异性压制（更具体的标签命中时，被它包住的泛标签降权靠后）。
- **宁可少给，不要多给**：误召回比漏召回更烦人（用户得手动删）。所以阈值偏高、压制偏狠；要更多候选就 `--min 0.4 --per-clause 5`。
- **中文相似度不靠编辑距离**：`白色连衣裙` 和 `绿色连衣裙` 差一个字，dice 必然虚高，所以中文之间只认包含关系。
- **中文字集兜底**：语序不同但用字几乎一样的说法放行——`女高中生` ↔ `高中女生`（汉字字集 Jaccard 1.00 → sim 0.86）；`白色连衣裙` ↔ `绿色连衣裙` 只有 0.67，照旧判死。
- **中文单字门槛**：单字汉字表面（`高`→`gao`、`春`→`spring` 这类姓氏/季节标签）极易在更长的词里误命中，所以只放行高频字 + 白名单（`SINGLE_CJK_OK`），被同分句更长的词覆盖时丢弃；另有复合词护栏 `SINGLE_CJK_BLOCK_2G`（角色/风格/心情/眼球/鬼灭… 里的那个字不许单独成标签，但「鹿角」「风吹」照旧）。
- **分级不改内容**：`pickRating()` 只看匹配结果里的分级标签与 `cb:nsfw` 分类，只动前缀/行首那一个 token。

## 常用调参（`src/config.mjs`）

| 常量 | 作用 | 默认 |
| --- | --- | --- |
| `SCORE.minScore` | 候选进入结果的最低分 | `0.46` |
| `SCORE.minSim` | 纯相似度路径的下限 | `0.52` |
| `SCORE.base` / `SCORE.freq` | 打分里「基础可信度」与「频次」的权重 | `0.68 / 0.32` |
| `SCORE.hintBoost` | 命中层提示时的加成 | `1.22` |
| `SCORE.topPerClause` | 每个分句最多留几条 | `3` |
| `SINGLE_CJK_MIN_FREQ` / `SINGLE_CJK_OK` | 中文单字表面的门槛与白名单 | `8000` / 见文件 |
| `SINGLE_CJK_BLOCK_2G` | 复合词护栏（这些二字词里的字不许单独成标签） | 角色/风格/心情/眼球… |
| `EXTRA_ZH` | 词库缺释义、但确实需要的说法（如 `sitting` → 坐/坐着） | 见文件 |
| `RATING_TAGS` | 分级 token 的固定顺序 | `safe → sensitive → questionable → nsfw → explicit` |
| `FUNCTION_WORDS` | 英文虚词，用于切别名窗口 | 见文件 |

## 依赖与边界

- 词库：`anima-tag-kb\画师类\`（`manifest.json` + `search-index.json`）。定位顺序：`--kb` 参数 → 环境变量 `ANIMA_KB_DIR` → 技能目录里的 `kb-path.json`（安装脚本写入）→ 仓库相对路径 → 用户主目录 → 当前目录，以目录里有没有 `manifest.json` 判定。
- 零依赖：只用 Node 内置模块（Node ≥ 18）。不联网、不下模型。
- 图像理解由多模态的我完成，脚本只吃结构化观察结果。
- 不做权重建议：输出标签与顺序，具体权重交给用户/模型卡（`1.0–1.5` 之类的区间可在 `--format md` 的分数列旁参考词库里的 `weight` 字段）。
- 库覆盖缺口（已知）：本词库里没有 `schoolgirl` / `high_school_girl` 这类通用「女高中生」标签，只有各校具体的校服标签，所以这类说法兜到 `girl`（不做硬凑）。详见 `README.md`。
