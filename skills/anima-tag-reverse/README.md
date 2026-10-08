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
│   ├── config.mjs           阈值、层映射、官方前缀/负向、分级表、正则表、宽召回档 BROAD
│   ├── normalize.mjs        归一化、key、指纹、相似度、词根、汉字字集 Jaccard
│   ├── jp-lexicon.mjs       日文词表（日文 → 英文表面）
│   ├── hints.mjs            规则补充层（口语人数、中文复合词拆分、常见中文短说法）
│   ├── lexicon.mjs          载入 search-index.json，建表面/词元索引
│   ├── parse.mjs            分句、否定、强制命中、日文桥接、规则层接入
│   ├── match.mjs            召回 + 打分 + 六道压制 + 备选池（--broad）
│   ├── compose.mjs          分层、分级适配、单行形态、前缀、负向、JSON、Markdown
│   ├── nl.mjs               英文自然语言分支（标签骨架 + 逐角色句 + 场景句）
│   ├── gaps.mjs             缺项检测（六类缺口 + 可勾选候选项，含图像观察缺项 C-spec-*）
│   ├── image-spec.mjs       图像观察 schema → 别名归一 + 分句 + 层提示 + 必填维度自审（notes 降级为日志）
│   └── index.mjs            门面 API
├── tools/
│   ├── install-dsh-skill.mjs 同步到 ~/.dsh/skills（技能中心可见）
│   ├── toggle-dsh-skill.mjs  命令行版启用/禁用开关
│   └── list-single-cjk.mjs   列出词库单字表面（复核单字放行策略）
├── 功能说明-自然语言分支与补全.md  本轮改造的功能说明（含自审清单与待确认项）
├── tests/
│   ├── smoke.mjs            36 例自测（中/英/日/图像 + R18/NSFL + 中文兜底 + 自然语言 6 + 缺项 4 + CLI 6）
│   ├── spec-audit.probe.mjs B+C 行为探针（notes 降级 / 默认自审 / 必填维度 / 别名归一 / 既有契约 / 16:35 归档真值）
│   ├── cli-run.probe.mjs    CLI stdout/stderr 分离采集的小工具（给上面的探针用）
│   ├── img-spec.sample.json 图像观察样例（键路径与 IMAGE_SPEC_TEMPLATE 完全一致）
│   ├── fat-tags.diag.mjs    诊断工具（非断言套件）：旧快照 vs 当前仓库 A/B 对照，输出「变胖」逐条明细与汇总表
│   └── fat-tags-attrib.mjs  诊断工具（非断言套件）：把「变胖」逐条归因到机制层（读上一步的 audit.json）
```

## 快速上手

```bash
node bin/rtag.mjs "银发少女站在樱花树下，微笑，侧脸"        # 默认：一行纯标签（无前缀）
node bin/rtag.mjs "银发少女站在樱花树下" --format prompt    # 带官方前缀的完整提示词
node bin/rtag.mjs "银发少女站在樱花树下" --format nl        # 英文自然语言提示词
node bin/rtag.mjs "银发少女站在樱花树下" --broad --format gaps   # 缺项清单与候选项
node bin/rtag.mjs "银发少女站在樱花树下" --broad --format check  # 标签 + 自然语言 + 缺项
node bin/rtag.mjs --search "厚涂"
node bin/rtag.mjs --nl-template                             # 自然语言句子骨架
node bin/rtag.mjs --image-spec tests/img-spec.sample.json   # 图像入口：stdout 单行标签，缺项摘要进 stderr
node bin/rtag.mjs --image-spec tests/img-spec.sample.json --broad       # 图像入口要宽召回得显式写（33 条 → 38 条）
node bin/rtag.mjs --image-spec tests/img-spec.sample.json --format md   # 分层报告 + 缺项自审摘要
node tests/smoke.mjs
node tests/spec-audit.probe.mjs                             # B+C 行为探针
```

```js
import { reverse, reverseText, reverseImageSpec, analyzeImageSpec, searchTags, kbInfo, buildNaturalLanguage, buildGaps } from './src/index.mjs';

reverseText('twintails, blue eyes, school uniform').prompt;
reverseImageSpec({ subject: { count: 1, kind: '少女' }, appearance: ['银发'], scene: ['夜晚的教室'] }).positive.tags;
searchTags('blue eyes', { limit: 10 });
kbInfo();

// 可选产物（文本分支不传 opts 时完全不参与计算，默认输出与旧版逐字节一致）
reverseText('两个人，雨中，一个男孩一个女孩，撑伞', { broad: true, nl: true, gaps: true, alternatives: true });
buildNaturalLanguage(reverseText('银发少女站在樱花树下'));   // { text, sentences, meta, markdown, … }

// 图像分支默认带自审、默认窄召回：等价 { gaps: true }，标签串与空 opts/关掉自审/{broad:false} 逐字节相同
const ri = reverseImageSpec({ subject: { count: 1, gender: 'girl' }, appearance: { hair: 'silver hair' } });
ri.bare;                    // 单行标签串（只多挂字段，不换召回档、不变标签）
ri.gapsSummary.specMissing; // 必填观察维度缺了几条
ri.plan.specIssues;         // [{ key, label, severity, advice, group, srcKey? }]
ri.plan.notesText;          // notes 的值（纯日志，不产标签）
reverseImageSpec(spec, { broad: true });   // 要宽召回显式开（样张 33 条 → 41 条）
analyzeImageSpec(spec);     // 只做缺项自审，不跑匹配
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
| `plan` | 解析结果回显：分句、否定、层提示、识别到的日文词；**图像分支另挂** `notesText`（notes 日志）与 `specIssues`（观察缺项），文本分支的键集合与改造前完全一致（只有 `clauses` / `negated`） |

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
- 图像分支的输入收紧（本轮）：
  - `normalizeSpec()` 在摊平**之前**做键名别名归一（`lights` → `style.lighting`、`lighting_direction` → `style.light_direction`、`artstyle` → `style.artist_style`、`framing` → `style.framing`、`shot` → `style.camera`、`artist` → `artists`、`body_type` → `appearance.body` 等，别名表见 `KEY_ALIASES`）。别名只在「不是本层规范键」时生效，避免 `{ style: { framing: … } }` 被二次搬运；同路径合并值而不是覆盖。实测别名写法与规范键写法输出逐字节一致。
  - `notes` 降级为纯日志：结构化输入里 `stripNotes()` 先把 `notes` 整枝摘掉再摊平，值只进 `plan.notesText`。唯一例外是整份输入一个结构化键都没有（含 `JSON.parse` 失败包装出的 `{ notes: spec }`），此时仍按旧行为整段当文本分句——所以「直接丢一段自然语言」不受影响。
  - `analyzeImageSpec(spec)` 检查 `REQUIRED_OBSERVATIONS` 里的 9 个必填维度（画风/光位/景别/腿袜/体型/上衣/鞋/动作/视角），返回 `[{ key, label, severity, advice, group, srcKey? }]`；空值、空数组、模板占位（含 `…`）都算没写。`specToPlan()` 把它挂到 `plan.specIssues`。

### ② 匹配（`lexicon.mjs` / `match.mjs`）

索引三张表：`surfaces`（紧凑表面 → 条目）、`tokens`（英文词元 `w:`、词根 `w#`、汉字 1-gram `1:` / 2-gram `2:` → 条目）、`byTagKey`（规范标签 → 条目）。别名进索引的条件：段数 ≤ 8 且不是角色/作品类（人物的「别名」其实是整套标签，会把描述匹配到角色上）。

一个分句的候选来源：**A 强制 → A2 日文桥接 → B 表面最长匹配 → B2 规则词条（`hints.mjs`）→ C 词元召回 + 相似度**，合并去重后逐个打分：

```
score = sim × (0.68 + 0.32 × 频次分) × 置信度系数 × 层提示(×1.22 命中层 / ×0.9 其他层)
```

规则词条（B2）的分数固定 0.9，刻意低于任何真实表面命中（0.93–0.97），并且只在「同标签键已有更高分命中」或「拆出的中文核心已经在候选里」时跳过——这样「白色连衣裙的银发女孩」里规则拆出的 `dress` 不会顶掉词库真实命中的 `white dress`，也不会把 `silver hair` 挤出候选表。

随后六道压制（详见 `match.mjs` 注释）：

1. **泛词压制** —— 用户话里逐字命中的候选当「泛词」；`via` 表面严格包含泛词键的候选 ×0.5，低于阈值直接丢。整条标签被逐字命中的永不压制。**判定键用标签英文键**（`keyOf(s.tag)`）：用中文 via 键比较会得出「whitedress 包含 white」这种歪理，把真正命中的 `silver hair` 压掉（实测踩过）。
2. **表面组一表一winner** —— 同一个表面键只留分最高（同分取更短标签），其余 ×0.55。
3. **中文核分组** —— 按中文释义核心分组，winner 取 `freqN` 最大者：`坐` 组里 `sitting`(1,300,000) 胜出、`sitting on`(0 投稿) 落选（+0.55 降权后被门槛滤掉）。这是 `sitting on a chair` 能给出 `sitting` 的原因。
4. **变体压制** —— 自身标签名就是那个表面的候选胜出，`via` 撞上它们的 ×0.55（清掉 `u.a._school_uniform` 之类）。
5. **特异性压制** —— 更具体的标签命中时，被它包住的泛标签 ×0.88 排后面（不删）。
6. **单字去噪** —— 单字汉字表面被同分句更长的中文词覆盖时丢弃。

压制能生效的前提是候选带着 `via`（= 命中它的那段用户原话）：泛词压制从「逐字命中」的候选里取键，一表一winner 与变体压制都按 `via` 分组，而 A 段的 `forced` 项被这三道豁免。**A2 修复**（`src/match.mjs` 的 `push()`）：当分数更高的命中先落表、把 `via` 留空时，后到的低分命中必须把自己的 `via` 接管过去（`else if (via && !prev.via) prev.via = via;`）——旧代码直接丢掉这种候选的 `via`，泛词表里于是只剩英文键（`smile` 对中文原话「微笑」必然不中），三道压制整体空转，`微笑` 输出成 `smile, light smile, nervous smile, evil smile` 四条变体；恢复后为 `smile`（回归网见 `tests/spec-audit.probe.mjs` 第 6 节的归档真值）。

收尾：`filter(score ≥ minScore || forced)`，但 `LITERAL_RE = /^(surface:|forced:|jp:|rule:)/` 命中的逐字证据不受 `perClause` 名额限制（弱相似命中才限 3 条）；顺序是 `score → layer → freqN`。

**备选池**（`opts.alternatives`，`--broad` 时更宽）：够分但被名额挤掉的候选按层归拢，供缺项清单当候选项。层内上限 `BROAD.altPerLayer = 12`、总量 `BROAD.altTotal = 80`。

**频次先验**：`freqScore()` 对 `freqN = 0` 的标签返回 `SCORE.medianFs = 0.42`（全库归一化频次中位数；这类标签有 4,599 条，含 `silver hair`、`girl`、`sitting on`），而不是 0——否则它们会被当成最冷门直接淘汰。

**重叠表面命中**：`scanSurfaces()` 给命中打 `canon` 标记（用户写的串就是该条目本名），重叠时「更长优先、同长优先 canon」，于是 `sitting on a chair` 给出 `sitting` 而不是 `sitting on`。

相似度怎么算（`simFast`）：

- **英文↔英文**：按**词覆盖**。`bWords` 是候选表面的实词，`hit` 是它与用户词的交集；`covCand = hit/|bWords|`，`covClause = hit/|用户词|`，`v = covCand^2.2 × (0.7 + 0.3×min(1, covClause))`。真正的单个词只认完全一致（≥4 字符），或**词根相同**（`twintail` ↔ `twintails`）。含虚词的表面（`on book`、`at viewer`）必须整串逐字出现才算。
- **中文↔中文**：只认包含关系。`白色连衣裙` 与 `绿色连衣裙` 差的那一个字正是区分它们的修饰词，靠 dice 必然虚高，所以直接判死。唯一的例外是**字集兜底**：汉字字集 Jaccard ≥ 0.8 且长度差 ≤ 1 时放行（`女高中生` ↔ `高中女生` = 1.00 → sim 0.86），`白色连衣裙` ↔ `绿色连衣裙` 只有 0.67，仍然判死。
- **中文单字表面**：`高`→`gao`（姓氏）、`春`→`spring` 这类单字标签极易在更长的词里误命中（「女高中生」里的「高」），所以单字只放行 `SINGLE_CJK_OK` 白名单 + `freq ≥ SINGLE_CJK_MIN_FREQ`，被同分句更长的中文词覆盖时丢弃；还有一道**复合词护栏** `SINGLE_CJK_BLOCK_2G`（角色/风格/心情/眼球/鬼灭… 里的那个字不许单独成标签，但「鹿角」「风吹」照旧）。
- **拼写容错**：两侧各自最多一个词没对上，且这两个词是「同一个词写短了」（`blu` ↔ `blue`）时才用编辑距离兜底；`black` ↔ `blank` 这种两个真词不救。
- 靠数字区分的标签（`6+boys`）在用户没写数字时不算命中。

### ③ 格式化（`compose.mjs` / `nl.mjs` / `gaps.mjs`）

按 `LAYER_NAME` 分层输出，过滤掉已在生效前缀里的标签，负向每个否定分句最多取 2 条（`score ≥ 0.6`），并给出「未匹配片段」提醒用户补词或换说法。

- `bare` / `tags`：**默认交付形态**，一行纯标签；分级不是 `safe`（或被 `--rating` 显式指定）时，把分级 token 放行首，其余情况不写分级。
- `prompt`：前缀 + 标签；前缀里的分级 token 由 `pickRating()` 决定，`prefixKeys` 按**实际生效的前缀**动态重建，所以不会出现重复标签。
- `nl.mjs`（英文自然语言）：从 `res.layers[].tags[]`（每条带 `layer`，缺了会全落进 other）归拢，按角色分桶 → 定句子 → 渲染，句子骨架是「标签前缀行 + 每角色一句 + 场景/光影一句」。三层措辞：专属 `PHRASE` 表 → `inferPhrase`（中文名词核 / 词尾形态 / 服装 / 修饰关键词 / 介词短语 / 动作）→ 原样兜底（记进 `meta.fallback`）。
- `gaps.mjs`（缺项检测）：六类缺口 + 候选项（`source`：`alt` / `preset` / `manual` / `choice`），渲染成 markdown 勾选表；图像分支多一类 `C-spec-*`（kind `missingObservation`，必填观察维度没落成结构化字段），计入 `gapsSummary.specMissing`，建议写法可通过 `suggestions[].dimKey` 找回，同维度已在 `C*`/`B*` 里报过时改成往那条缺口上挂建议（不重复开条）。

## 缺项自审工作流（本轮新增）

CLI 没有界面，「前端多选」落在会话里：工具出结构化清单，技能侧整理成选项问用户，勾完回填重跑。

```
node bin/rtag.mjs "原描述" --broad --format check     # 文本入口：标签 + 自然语言 + 缺项，一次给全
node bin/rtag.mjs --image-spec 观察.json --format md  # 图像入口：默认就带缺项自审，不看开关
node bin/rtag.mjs --image-spec 观察.json --broad      # 图像入口要宽召回/更全候选池时显式写
```

**图像入口默认带自审、但不默认宽召回（文本入口默认两者都不带，差异就在自审这一处）**：

- `reverseImageSpec(spec)` / `reverseImageSpec(spec, {})` 等价于 `reverse({ imageSpec: spec }, { gaps: true })`，`out.gaps` / `out.gapsSummary` / `out.gapsMarkdown` 一定存在；显式 `{ gaps: false }` 关掉。
- 召回档默认是**窄召回**：不传 `broad` 就等于 `{ broad: false }`，标签行与改造前同规模；要更全的候选池显式写 `{ broad: true }`（样张 API 33 条 → 41 条）。
- `reverse({ imageSpec })` 本身**不加**这个默认（门面 API 保持原样），`reverseText` 与纯字符串输入一字未改。
- CLI：`--image-spec` 时默认打开 `gaps + alternatives`（宽召回不默认），把一行摘要（`[缺项自审] 缺口 N 条：…` + 每条缺项一行 `键（中文名 / 严重度）：建议写法` + notes 提醒）打到 **stderr**，stdout 仍是干净的单行标签串；`--format md` / `--format json` 里也带缺口信息（md 有「缺项自审摘要」段且逐条带建议写法，json 有 `gapsMarkdown`）。`--no-gaps` 关掉自审、`--broad` 打开宽召回（样张 CLI 默认 33 条、`--broad` 38 条，默认 stdout 与 `--no-broad` 逐字节相同；显式 `--format gaps` / `--check` 不受 `--no-gaps` 影响）。文本入口不加这些默认，也不打 stderr 提示。
- 理由：缺项自审以前是可选产物，调不调都不报错，于是被静默跳过——交付的标签串漏了 `anime`（画风）和光位，重复三轮都没人发现；而宽召回会改变默认标签行，所以按用户决定收回显式档。

六类缺口（`C-spec-*` 是本轮新增，算 C 的一类）：

| 前缀 | 类型 | 判定 |
| --- | --- | --- |
| `A*` | 未匹配片段 | `res.unmatched` 非空（输入里有词没映射到标签） |
| `B*` | 关键层为空 | 层 1 / 4 / 6 / 7 无标签（每层带「为什么会毁图」的解释） |
| `C*` | 粒度不足 | 14 个同维度分组（发色/发型/眼睛/表情/上衣/腿袜/景别/时间/光线/手势与持物/配饰/鞋/身体姿势/画风与媒介）一个取值都没给 |
| `C-spec-*` | 观察缺项（图像分支） | `plan.specIssues` 非空：必填观察维度没落成结构化字段（画风/光位/景别/腿袜/体型/上衣/鞋/动作/视角），带可照抄的建议写法 |
| `D*` | 多主体信息不全 | 层 1 总人数 >1，但层 4 的外观项不够每人 2 项 |
| `E*` | 同维度冲突 | `EXCLUSIVE` 表里的互斥对同时出现（`1girl×1boy` 在总人数 >1 时不报） |

候选项来源：`alt`（宽召回捞到的同层/同维度候选，带 score）、`preset`（固定建议，如 `upper body` / `backlighting`）、`manual`（词库里没有，需用户自己给英文标签；`C-spec-*` 的建议写法也走这里）。

## 调参速查

| 想要的效果 | 怎么改 |
| --- | --- |
| 候选太少（默认档「宁可少给」） | 先加 `--broad`（一次性放宽 `minScore 0.46→0.38`、`minSim 0.52→0.44`、`perClause 3→6`、词元预算 3000→6000）；还不够再手动 `--min 0.4 --per-clause 5 --max-per-layer 40` |
| 噪声太多 | 提高 `SCORE.minScore` / `minSim`，或把压制系数从 `0.5 / 0.55` 压得更低 |
| 某个说法匹配不到 | 加到 `EXTRA_ZH`（中文说法）或 `jp-lexicon.mjs`（日文说法），确保对应标签在词库里存在 |
| 中文复合词整串没命中（如「蓝白条纹水手服」） | 补 `hints.mjs` 的 `CJK_DECOMPOSE`（尾词 garments / 修饰 colors·patterns）或 `SHORT_ALIASES` |
| 口语人数没识别（如「两个人」「一男一女」） | 补 `hints.mjs` 的 `COUNT_GROUPS` 与 `GENDER_WORDS` |
| 自然语言句子错位（外观词跑到场景句） | `nl.mjs` 的 `APPEARANCE_FORM_RE` 与 `SCENE_KEEP_RE`；新标签有怪措辞时补 `PHRASE` 专属词条 |
| 缺项报得太少/太多 | `gaps.mjs` 的 `CRITICAL_LAYERS`（关键层）、`DIMENSIONS`（14 个粒度分组）、`EXCLUSIVE`（互斥对）；图像分支的必填维度清单在 `image-spec.mjs` 的 `REQUIRED_OBSERVATIONS`（每条 `{ key, label, severity, advice, group? }`） |
| 某类观察不再报警 / 想少报几条 | `REQUIRED_OBSERVATIONS` 里删掉那条即可；只列「缺了就静默丢标签」的维度，可选印象项（`composition` / `palette` / `quality` / `expression` / `accessories` / `time`）故意不入表 |
| 调用方写别的键名想归一 | `image-spec.mjs` 的 `KEY_ALIASES`（别名→规范路径）；只在「不是本层规范键」时生效 |
| 图像入口的默认档想改 | `index.mjs` 的 `reverseImageSpec` 与 `bin/rtag.mjs` 里那段 `isImageInput` 默认（`gaps + alternatives`；宽召回不默认，要宽召回得显式 `--broad` / `{broad:true}`）；文本入口不经过它 |
| 想多问出某类候选（手部/鞋/画风…） | 往 `gaps.mjs` 的 `DIMENSIONS` 加一组：`{ id, label, layer, test, suggest/expect }`。`test` 决定「已有值就不问」，`suggest` 是问出来的候选；判定式尽量复用文件顶部的 `anyOf` / `endsWith` 助手，别写裸正则（`keyOf` 把空格换成 `_`，`close-up` 也会存成 `close_up`） |
| 层序不对 | `config.mjs` 的 `BIG_LAYER` / `LAYER_NAME`，需要和展览板 `viewer/template.html` 的 `LAYER` 保持一致 |

## 自测

```
node tests/smoke.mjs        # 36 例：中文 8 / 英文 3 / 日文 1 / 图像 3 / R18+NSFL 2 / 中文兜底 4（单元）
                            #       + 自然语言 6（NL_CASES）+ 缺项自审 4（GAP_CASES）+ CLI 接线 6（CLI_CASES）
node tests/smoke.mjs -v     # 打印每例的完整标签串
node tests/spec-audit.probe.mjs   # B+C 行为探针 112 例（默认档/notes/必填维度/别名/既有契约/归档真值），失败时退出码 1
```

`tests/spec-audit.probe.mjs`（本轮新增，不进 smoke 主链）锁六件事：

1. **notes 降级**：结构化输入里 `notes` 的值不出现在分句、不进标签串，但回显在 `plan.notesText`；只有「整份输入一个结构化键都没有」与「`JSON.parse` 失败的字符串」才走旧行为整段当文本。
2. **默认自审 + 默认窄召回**：`reverseImageSpec(spec)` 空 opts 必须有 `gaps` / `gapsSummary` / `gapsMarkdown`，且裸串与 `{broad:false}` 逐字节相同；`{ gaps: false }` 能关，`reverse({ imageSpec })` 不受影响；文本分支空 opts 仍然没有 `gaps`。
3. **必填维度与报警**：`REQUIRED_OBSERVATIONS` 每条含 `key/label/severity/advice` 且键路径在模板里存在；空壳 spec 的 9 条都能被找到（要么自成 `C-spec-*`，要么作为 `dimKey` 挂进同组的 `C*`/`B*`）；只写 `style.lighting` 时会报 `style.light_direction` 并带 `srcKey`；`specMissing` 与 `byKind.missingObservation` 对得上；markdown 里带建议写法。
4. **别名归一**：任务点名的七个别名都归一；别名写法与规范键写法的标签串**逐字节一致**、层提示一致；`lights` 与 `style.lighting` 同路径合并、与 `style.light_direction` 不串位。
5. **既有契约**：文本分支默认输出 == 改造前基线（逐字节）；图像分支窄召回的标签串在「老形状样张」上只少掉 notes 硬凑出的 `sideways mouth`，**不多出任何标签**；样张窄召回 33 条（A2 之前 34 条，少掉的正是 `sideways mouth`，作为预期代价显式断言）；默认档 / 关掉自审 / 打开自审三种调用的 `bare` 相同，CLI 默认档与 `--no-broad` 逐字节相同且不含宽召回独有的 4 条（`braided twintails` / `short twintails` / `twintails with braided base` / `full-length mirror`），`--broad` 才出现（CLI 38 条）；`emptySpec` == `IMAGE_SPEC_TEMPLATE` == `--template`；`tests/img-spec.sample.json` 与模板键路径完全一致；CLI 图像入口 stdout 干净、缺项提示只在 stderr；CLI 文本入口不打提示。
6. **归档真值（2026-10-07 16:35）**：工作区两份探针记录共 23 条（去重后 22 条）逐条钉死 —— 17 条与归档**逐字节相等**，5 条是已记名的偏差（`蓝白条纹水手服` / `黑色和服` / `两个人` / `低角度仰拍，霓虹街区，雨夜` / `--rating explicit --format prompt 一个女孩`，都是规则层 `hints.mjs` 补录引入的 M1 家族，A2 不修、属产品决定），这 5 条连「多出 / 少掉」两个集合都钉住，偏差一扩大就红。这条断言对 A2 敏感：在 A2 未生效的副本上跑会红（`微笑` 实测 `smile, light smile, nervous smile, evil smile`、样张窄召回 34 条）。

新增的三段各自锁什么：

- `NL_CASES`：① 人数句要写 `one girl`，且 `silver hair` 不许出现在场景句（词库把银发挂在层 7）；② 动作（`reading`）归姿势句不进场景句；③ 多主体时人数与两种性别都要写出，且 `heart hands duo` 不得被当服装；④ 同一输入连跑两次输出逐字一致（确定性，模型想润色只能在这份骨架上改）；⑤ `两个女孩，一个男孩` 必须合起来读成 `Two girls and one boy`，不许写成 `One girl and one boy`；⑥ 紧写 `三男两女` 要出 `Three boys and two girls`。
- `GAP_CASES`：① 空输入要报 `emptyLayer` 且缺口 ≥2；② 「白天…夜晚」「长发…短发」要报 `E-day-night` / `E-longhair-shorthair`；③ 多主体缺外观要报 `multiSubject`；④ 描述完整时不许报 `conflict`（防误报）。
- `CLI_CASES`（会真的 spawn `bin/rtag.mjs`，所以这一段比前面慢几秒）：默认仍是单行标签串；`--gaps` / `--check` / `--nl` 必须真的改变输出形态（这三个开关曾经只置布尔量、不改 `opt.format`，静默返回默认标签串）；显式 `--format tags` 时它们只当附加产物；`--format json` 要带 `naturalLanguage` / `gapsSummary` / `alternatives`。

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
