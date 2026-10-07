# anima-tag-reverse —— 自然语言 / 图像 → Danbooru 标签反推

零依赖 Node 技能：读本地 `anima-tag-kb` 词库（38,306 条标签），把中文 / 英文 / 日文描述或图像观察结果，反推成符合 Anima 官方分层的提示词标签串。

默认交付形态是**一行、逗号分隔、纯英文标签、不带官方质量前缀**（前缀要的话用 `--format prompt`）；**不做内容审查**，R18 / NSFL 描述照常转换，只把分级 token 写对。

```
文本 ─┐
      ├─→ ① 解析 ─→ ② 匹配 ─→ ③ 格式化 ─→ 单行标签串 / 带前缀提示词 / 结构化 JSON / 负向串
图像 ─┘
```

## 目录

```
skills/anima-tag-reverse/
├── SKILL.md                 技能说明（给模型看的入口）
├── README.md                本文件（给开发者看的实现说明）
├── bin/rtag.mjs             CLI
├── src/
│   ├── config.mjs           阈值、层映射、官方前缀/负向、分级表、正则表
│   ├── normalize.mjs        归一化、key、指纹、相似度、词根、汉字字集 Jaccard
│   ├── jp-lexicon.mjs       日文词表（日文 → 英文表面）
│   ├── lexicon.mjs          载入 search-index.json，建表面/词元索引
│   ├── parse.mjs            分句、否定、强制命中、日文桥接
│   ├── match.mjs            召回 + 打分 + 压制
│   ├── compose.mjs          分层、分级适配、单行形态、前缀、负向、JSON、Markdown
│   ├── image-spec.mjs       图像观察 schema → 分句 + 层提示
│   └── index.mjs            门面 API
├── tools/
│   ├── install-dsh-skill.mjs 同步到 ~/.dsh/skills（技能中心可见）
│   ├── toggle-dsh-skill.mjs  命令行版启用/禁用开关
│   └── list-single-cjk.mjs   列出词库单字表面（复核单字放行策略）
└── tests/
    ├── smoke.mjs            17 例自测（中/英/日/图像 + R18/NSFL + 中文兜底）
    └── img-spec.sample.json 图像观察样例
```

## 快速上手

```bash
node bin/rtag.mjs "银发少女站在樱花树下，微笑，侧脸"        # 默认：一行纯标签（无前缀）
node bin/rtag.mjs "银发少女站在樱花树下" --format prompt    # 带官方前缀的完整提示词
node bin/rtag.mjs --search "厚涂"
node tests/smoke.mjs
```

```js
import { reverse, reverseText, reverseImageSpec, searchTags, kbInfo } from './src/index.mjs';

reverseText('twintails, blue eyes, school uniform').prompt;
reverseImageSpec({ subject: { count: 1, kind: '少女' }, appearance: ['银发'], scene: ['夜晚的教室'] }).positive.tags;
searchTags('blue eyes', { limit: 10 });
kbInfo();
```

`reverse()` 返回：

| 字段 | 说明 |
| --- | --- |
| `tags` / `bare` | **默认交付形态**：一行纯标签，无官方前缀（`explicit, girl, naked` 这种） |
| `rating` | 自动判定的分级 token（`safe` / `sensitive` / `questionable` / `nsfw` / `explicit`） |
| `prompt` | 正向串（含官方前缀，前缀里的分级 token 已按内容适配，已去重） |
| `negative` | 负向串（默认负向 + 「不要 X」反推结果） |
| `positive.tags` | 标签数组（按层排好序） |
| `positive.layers` | 分层明细：`tag / zh / score / sim / reason / freq / confidence / big / category / sub / official / fromClauses` |
| `positive.lineBare` | 与 `bare` 相同的单行串（放进 JSON 里方便程序取） |
| `negativeTags` | `{ string, base, added }` |
| `json` | 完整结构化结果（schema `anima-tag-reverse/v1`） |
| `markdown` | 人类可读报告（分层 + 分数 + 未匹配片段） |
| `stats` | `total / used / unmatchedClauses` |
| `plan` | 解析结果回显：分句、否定、层提示、识别到的日文词 |

## 输出契约与内容政策

| 契约 | 实现位置 |
| --- | --- |
| 单行、逗号分隔、无换行/无多余标记 | `compose.mjs` 的 `bare` 拼接；`bin/rtag.mjs` 默认 `--format tags` |
| 默认不带官方前缀 | `POSITIVE_PREFIX` 只进 `prompt`，不进 `tags`/`bare` |
| 官方写法：空格代替下划线（`score_*` 除外） | `compose.mjs#dispTag()`：库里的 `cherry_tree / on_bed / completely_nude` 输出成 `cherry tree / on bed / completely nude`；画师同理（官方快照就是 `@haruyama kazunori` 这种写法） |
| 不做内容审查（R18 / NSFL 照常转换） | 全库只有 `og:censorship` / `cb:nsfw` 等分类标签，没有任何过滤分支 |
| 分级 token 自动适配 | `compose.mjs#pickRating()`：命中分级标签取最强；命中 `cb:nsfw` 分类（裸体/性行为/情趣服饰）时至少 `nsfw`；`--rating` 可手动覆盖 |
| 无冗余 | 前缀里已有的标签不再出现在标签段里；同一表面只有一个 winner；按官方写法二次去重 |

## 实现要点

### ① 解析（`parse.mjs` / `image-spec.mjs`）

- 分句：按 `,，。；;、/／|｜` 与换行切；「不要 / 没有 / 别 / 去掉 / no / without」开头或含否定的分句进 `negatedClauses`。
- 归一化：NFKC → 全角转半角 → 去零宽 → 下划线/破折号变空格 → 小写；另存一份 `compact`（去所有空格标点，保留数字、字母、假名、汉字、`@`、括号）。
- 强制命中：引号内文本、`@画师`、`by X` / `画师：X`、人数（`3girls`、`二人`）——这些不看相似度，直接按标签取。
- 日文桥接：`jp-lexicon.mjs` 的日文词表在紧凑串上做最长匹配（同时注册「去平假名骨架」，`青い髪` → `青髪`），命中后换成对应的英文表面再走匹配。
- 图像分支：schema 见 `--template`；`subject.count` 归一化后生成强制人数标签（`1girl` + `solo` / `2girls` / `2boys`），键名决定层提示（`scene` → 第 7 层等）。

### ② 匹配（`lexicon.mjs` / `match.mjs`）

索引三张表：`surfaces`（紧凑表面 → 条目）、`tokens`（英文词元 `w:`、词根 `w#`、汉字 1-gram `1:` / 2-gram `2:` → 条目）、`byTagKey`（规范标签 → 条目）。别名进索引的条件：段数 ≤ 8 且不是角色/作品类（人物的「别名」其实是整套标签，会把描述匹配到角色上）。

一个分句的候选来源：**A 强制 → A2 日文桥接 → B 表面最长匹配 → C 词元召回 + 相似度**，合并去重后逐个打分：

```
score = sim × (0.68 + 0.32 × 频次分) × 置信度系数 × 层提示(×1.22 命中层 / ×0.9 其他层)
```

随后四道压制（详见 `match.mjs` 注释）：

1. **泛词压制** —— 用户话里逐字命中的候选当「泛词」；`via` 表面严格包含泛词键的候选 ×0.5，低于阈值直接丢。整条标签被逐字命中的永不压制。
2. **一表一winner** —— 同一个表面键只留分最高（同分取更短标签），其余 ×0.55。
3. **变体压制** —— 自身标签名就是那个表面的候选胜出，`via` 撞上它们的 ×0.55（清掉 `u.a._school_uniform` 之类）。
4. **特异性压制** —— 更具体的标签命中时，被它包住的泛标签 ×0.88 排后面（不删）。

相似度怎么算（`simFast`）：

- **英文↔英文**：按**词覆盖**。`bWords` 是候选表面的实词，`hit` 是它与用户词的交集；`covCand = hit/|bWords|`，`covClause = hit/|用户词|`，`v = covCand^2.2 × (0.7 + 0.3×min(1, covClause))`。真正的单个词只认完全一致（≥4 字符），或**词根相同**（`twintail` ↔ `twintails`）。含虚词的表面（`on book`、`at viewer`）必须整串逐字出现才算。
- **中文↔中文**：只认包含关系。`白色连衣裙` 与 `绿色连衣裙` 差的那一个字正是区分它们的修饰词，靠 dice 必然虚高，所以直接判死。唯一的例外是**字集兜底**：汉字字集 Jaccard ≥ 0.8 且长度差 ≤ 1 时放行（`女高中生` ↔ `高中女生` = 1.00 → sim 0.86），`白色连衣裙` ↔ `绿色连衣裙` 只有 0.67，仍然判死。
- **中文单字表面**：`高`→`gao`（姓氏）、`春`→`spring` 这类单字标签极易在更长的词里误命中（「女高中生」里的「高」），所以单字只放行 `SINGLE_CJK_OK` 白名单 + `freq ≥ SINGLE_CJK_MIN_FREQ`，被同分句更长的中文词覆盖时丢弃；还有一道**复合词护栏** `SINGLE_CJK_BLOCK_2G`（角色/风格/心情/眼球/鬼灭… 里的那个字不许单独成标签，但「鹿角」「风吹」照旧）。
- **拼写容错**：两侧各自最多一个词没对上，且这两个词是「同一个词写短了」（`blu` ↔ `blue`）时才用编辑距离兜底；`black` ↔ `blank` 这种两个真词不救。
- 靠数字区分的标签（`6+boys`）在用户没写数字时不算命中。

### ③ 格式化（`compose.mjs`）

按 `LAYER_NAME` 分层输出，过滤掉已在生效前缀里的标签，负向每个否定分句最多取 2 条（`score ≥ 0.6`），并给出「未匹配片段」提醒用户补词或换说法。

- `bare` / `tags`：**默认交付形态**，一行纯标签；分级不是 `safe`（或被 `--rating` 显式指定）时，把分级 token 放行首，其余情况不写分级。
- `prompt`：前缀 + 标签；前缀里的分级 token 由 `pickRating()` 决定，`prefixKeys` 按**实际生效的前缀**动态重建，所以不会出现重复标签。

## 调参速查

| 想要的效果 | 怎么改 |
| --- | --- |
| 候选太少 | `--min 0.4 --per-clause 5 --max-per-layer 40` 或调 `SCORE.minScore` |
| 噪声太多 | 提高 `SCORE.minScore` / `minSim`，或把压制系数从 `0.5 / 0.55` 压得更低 |
| 某个说法匹配不到 | 加到 `EXTRA_ZH`（中文说法）或 `jp-lexicon.mjs`（日文说法），确保对应标签在词库里存在 |
| 层序不对 | `config.mjs` 的 `BIG_LAYER` / `LAYER_NAME`，需要和展览板 `viewer/template.html` 的 `LAYER` 保持一致 |

## 自测

```
node tests/smoke.mjs        # 17 例：中文 5 / 英文 3 / 日文 1 / 图像 3 / R18+NSFL 2 / 中文兜底 4（单元）
node tests/smoke.mjs -v     # 打印每例的完整标签串
```

每个用例除了 `must`（必须命中）还带 `never`（历史上真实出现过的误召回），另外**每个用例都会跑交付契约检查**：单行、逗号格式正确、不带官方前缀；`rating` 和 `lineMust` 用来锁分级与「不过滤内容」这两条。改动匹配逻辑后这条防线会立刻报警。

## 装进技能中心（DSH 面板可见 + 可开关）

```bash
node tools/install-dsh-skill.mjs          # 同步一份到 ~/.dsh/skills/anima-tag-reverse，并写 kb-path.json
node tools/install-dsh-skill.mjs --check  # 只检查目标是否最新（不是最新时 exit 2）
node tools/toggle-dsh-skill.mjs           # 看启用状态
node tools/toggle-dsh-skill.mjs --disable # 等价于面板里关掉开关（写 disable-model-invocation）
```

- 用**复制一份 + 同步脚本**而不是软链：技能中心面板对符号链接的技能只允许开关，不允许编辑/删除；复制一份则三样都能用。代价是源码改完要再跑一次安装脚本（目标有本地改动时先备份到 `~/.dsh/skill-backups/<名字>-<时间戳>`，**刻意放在技能根目录之外**——加载器会扫 `skills/*/SKILL.md`，根目录里留一份副本会被当成第二个同名技能）。
- 面板只列出「SKILL.md frontmatter 有非空 `name` + `description`、且 `name` 符合 `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`」的技能；安装脚本会先自检这几条，不合格直接报错。
- **同步会保留面板里的开关状态**：脚本先把已安装副本的 `disable-model-invocation` 读出来，拷完再写回去，所以「面板里关掉 → 跑一次同步 → 又被打开」不会发生；`--check` 也把这一行排除在差异之外，只比真实内容。
- 安装后的副本靠 `kb-path.json` 找到词库（`resolveKbDir` 候选链的第三位），所以技能目录与词库可以放在不同盘。

## 依赖与已知缺口

- Node ≥ 18（实测 v24.20.0），仅用内置模块，无 npm 依赖。
- 词库定位顺序：`--kb DIR` → `ANIMA_KB_DIR` → 技能目录 `kb-path.json` → `<仓库>/anima-tag-kb/画师类` → `~/anima-tag-kb/画师类` → `<cwd>/anima-tag-kb/画师类`，以目录里存在 `manifest.json` 判定命中。
- 词库字段约定见 `anima-tag-kb/README.md`（`search-index.json` 的 12 列）与 `anima-tag-kb/画师类/README.md`（`manifest.json` 的字段与 `meta.bigs/subs` 含义）。
- 已知覆盖缺口：本库**没有** `schoolgirl` / `high_school_girl` 这类通用「女高中生」标签，只有各校具体的校服标签（`sakuragaoka_high_school_uniform` 等）。所以「女高中生 / 高中生 / 女生」在 `EXTRA_ZH` 里兜到通用的 `girl`，不硬凑具体校服。要补这类标签得动词库（展览板那边的策展数据）。
