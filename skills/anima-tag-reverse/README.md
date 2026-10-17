# anima-tag-reverse —— 自然语言 / 图像 → Danbooru 标签反推

零依赖 Node 技能：读本地 `anima-tag-kb` 词库（主索引 39,216 行 ＝ 2026-10-06 构建的 38,306 行 ＋ 第 4 期 ③ 从 Luo-fe 分流的 171 条 ＋ 第 6 期并入外部模板的 739 条；另有 180 条长短语放在补充短语池里默认关闭），把中文 / 英文 / 日文描述或图像观察结果，反推成符合 Anima 官方分层的提示词标签串。

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
│   ├── panel-config.mjs     第 5 期：读面板配置（$DSH_ANIMA_PANEL_CONFIG > $DSH_HOME > 技能目录）+ 档名校验 + 迁移表
│   ├── tier-policy.mjs      第 1–2 期：档位驱动的五个行为面开关（前缀 token / 负面分档 / 压字选篇 / 档位门 / 候选松紧）
│   ├── dialogue.mjs         第 4 期：压字选篇（按档挑 references/dialogue-style.md 的章节，dialoguePlan()）
│   ├── normalize.mjs        归一化、key、指纹、相似度、词根、汉字字集 Jaccard
│   ├── jp-lexicon.mjs       日文词表（日文 → 英文表面）
│   ├── hints.mjs            规则补充层（口语人数、中文复合词拆分、常见中文短说法）
│   ├── lexicon.mjs          载入 search-index.json，建表面/词元索引（第 4 期 ③ 起可选叠加补充短语池）
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
│   ├── merge-luo-clean.mjs   第 4 期 ③：把 Luo-fe 分流结果合进词库（--dry-run 先看差异，--apply 才写盘并备份）
│   └── list-single-cjk.mjs   列出词库单字表面（复核单字放行策略）
├── references/
│   └── dialogue-style.md    第 4 期：对白写法参考（五份 v4 参考 + 压字交付流程合并稿；节标题就是代码要引用的 heading）
├── 功能说明-自然语言分支与补全.md  本轮改造的功能说明（含自审清单与待确认项）
├── tests/
│   ├── smoke.mjs            36 例自测（中/英/日/图像 + R18/NSFL + 中文兜底 + 自然语言 6 + 缺项 4 + CLI 6）
│   ├── spec-audit.probe.mjs B+C 行为探针（notes 降级 / 默认自审 / 必填维度 / 别名归一 / 既有契约 / 16:35 归档真值）
│   ├── cli-run.probe.mjs    CLI stdout/stderr 分离采集的小工具（给上面的探针用）
│   ├── panel-config.mjs     第 5 期：面板配置读取层 58 例（含旧档名硬报错、误杀项删除规则与配置来源文案）
│   ├── tier-faces.mjs       第 1–2 期：五个行为面 45 例（含「默认路径逐字节不变」回归与面板删除规则）
│   ├── dialogue.mjs         第 4 期：压字选篇 30 例（纯函数 + CLI 铁律 + 隔离配置）
│   ├── merge-luo.mjs        第 4 期 ③：词库分流 27 例（纯函数 + 临时词库里真 dry-run/apply/幂等/回滚 + 技能侧读池 + --info JSON 形状）
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
node bin/rtag.mjs --image-spec tests/img-spec.sample.json --broad       # 图像入口要宽召回得显式写（33 条 → 41 条；旧文档的 38 条是旧 CLI top:40 切出来的假口径）
node bin/rtag.mjs --image-spec tests/img-spec.sample.json --format md   # 分层报告 + 缺项自审摘要
node tests/smoke.mjs
node tests/spec-audit.probe.mjs                             # B+C 行为探针
node tests/merge-luo.mjs                                    # 词库分流（第 4 期 ③）
node tools/merge-luo-clean.mjs --dry-run                    # 词库分流差异清单（不写盘）
```

```js
import { reverse, reverseText, reverseImageSpec, analyzeImageSpec, searchTags, kbInfo, buildNaturalLanguage, buildGaps } from './src/index.mjs';

reverseText('twintails, blue eyes, school uniform').prompt;
reverseImageSpec({ subject: { count: 1, kind: '少女' }, appearance: ['银发'], scene: ['夜晚的教室'] }).positive.tags;
searchTags('blue eyes', { limit: 10 });
kbInfo();

// 可选产物（r.gaps 两个入口都默认就有；r.nl / r.broad / alternatives 仍要显式传，默认标签串与旧版逐字节一致）
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
| `rating` | 分级 token。档名来自面板配置（默认 `safe` / `sensitive` / `nsfw`）；旧名 `questionable` / `explicit` 已作废，写进 `--rating` 会 exit 1 并打印迁移对照表 |
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

## 档位与「五个行为面」（第 1–2 期起；③ 压字选篇 第 4 期实装）

档名不再写死在代码里：运行时从面板配置读，配置优先级
`$DSH_ANIMA_PANEL_CONFIG` > `$DSH_HOME/anima-panel/panel-config.json` > `<技能目录>/panel-config.json`，
全都没有就用内置三档（`safe` 全年龄 / `sensitive` 擦边 / `nsfw` 露骨）。**配置文件是唯一真理源**：
面板「档位管理」里改名、加档、调顺序，CLI 下一次调用就跟着变。`--info` 会打印配置来源与当前档位表。

面板「负面词」里保存的**误杀项删除规则**（`negative` 的 `dropRules`：触发标签 → 要删的项，最多 16 条、每侧 24 项、单项 64 字符）也在这条链上：技能自己读配置文件，规则在档位增补之后执行，所以保存后下一次调用即生效，不需要重启。

显式传 `--rating <档名>` 时，下面**五个行为面**按档位生效——配置 `faces` 里正好五个开关
（`prefixToken` / `negativeLines` / `dialogueSection` / `lexiconGate` / `gapsScope`），第 4 期起 ③ `dialogueSection`
（压字选篇）也已实装：按档挑 `references/dialogue-style.md` 该读的章节，`--dialogue` / `--format dialogue` 直接打印选篇；
**不传档位时这些面整体不参与计算**，默认输出与改造前逐字节相同（`tests/tier-faces.mjs` 组B 与 `tests/dialogue.mjs` 组B 锁死这条）。

| 面 | 开关（面板配置 `faces`） | 显式档位时的行为 |
| --- | --- | --- |
| ① 分级词 | `prefixToken` | 档名进 `prompt` / `bare` 的前缀；`--no-tier-token`（面板固定带）把它挡在串外，内容前缀完好 |
| ② 负面分档 | `negativeLines` | 负面串 = 面板 `negative.core`（或 `--negative`）+ 按语义档位追加的压制词；顶档换成不打码纪律（`mosaic censoring, bar censor, censored`）；最后按删除规则删误杀项——内置 `NEG_DROP_RULES`（画面出现雨/水面/镜面就删 `mirror / reflection / duplicate`）恒生效，面板「负面词」里保存的 `negative.dropRules` 再叠加在其后，所以面板规则也能删掉档位追加的压制词 |
| ③ 压字选篇 | `dialogueSection` | 按档挑对白写作该读的章节：`safe` → §2 Safe 篇、`sensitive` → §3 Sensitive 篇、`nsfw` → §4 NSFW 篇；通用篇（§1）由 `dialogue.commonAlways` 决定（默认必过，关掉就只给本档那一节）。`--dialogue` / `--format dialogue` 打印选篇；字符串输出不受影响（选篇只在 JSON 的 `dialogueSection` 键与 `--dialogue` 报告里）。**档位改名后按语义档位兜底**（末档 → NSFW 篇、中档 → Sensitive 篇、最低档 → Safe 篇） |
| ④ 档位门 | `lexiconGate` | 按画面可见度判级：`safe` 档挡下露骨/擦边标签（`naked`、`lingerie`…），纯环境词（`water`、`rain`、`mirror`…）永不被挡。被挡的标签**不静默丢弃**：进 `tierBlocked`，并在 `--gaps` 里开一条 **E1 缺口**。换档 / 关掉这张脸就能拿回来 |
| ⑤ 候选松紧 | `gapsScope` | 缺项候选项按档收紧；**与 `--broad` 是两件独立的事**（候选松紧另由 `output.broad` 控制），互不绑架 |

- 新开关：`--no-tier-token`（档名不进串）、`--tier-token`（显式打开，默认就是开）、`--dialogue`（打印压字选篇，**必须配显式档位**，没有档位或这张脸被关掉就 exit 1）。
- 没读到任何候选文件时，来源文案统一由 `configRef()`（`src/panel-config.mjs`）给成 **「未找到，候选链：A → B → C」**——`--info` 的「配置来源」、`--rating` 档名校验失败的提示、`--dialogue` 「面被关掉」的报错三处口径一致，不再把最后一条候选路径印成「配置文件：`<path>`」。
- 旧档位名 `questionable` / `explicit` 在默认档位表下**硬报错**：exit 1 + 迁移对照表，绝不静默改名（把这套档名写进面板配置就照用、不报错）。
- `--format json` 里 `tierPolicy`（`tier / tierNames / explicit / semantic / tierToken / faces / panelPath / warnings`）与
  `tierBlocked`（被挡标签及需要的档位）**一直给出**：不传档位时 `explicit=false`、`tierBlocked` 为空数组；
  第三个键 `dialogueSection`（选篇计划：`section` / `sections` / `file` / `commonAlways`）只在**显式档位且面 3 开着**时出现。
- 面板（`packages/dsh-anima-tag-reverse`）的「试跑」总是显式报档位并固定带 `--no-tier-token`：
  用户在面板里选的是内容档位，不是往交付串里塞一个 `safe` / `nsfw` 词。

```
node bin/rtag.mjs "少女在教室里读书" --rating safe                     # safe, girl, reading, classroom
node bin/rtag.mjs "少女在教室里读书" --rating safe --no-tier-token      # girl, reading, classroom（面板的形态）
node bin/rtag.mjs "裸体少女在浴室里" --rating safe --gaps              # 挡下 naked，并列出 E1 缺口
node bin/rtag.mjs --rating nsfw --dialogue                            # 压字选篇：§4 NSFW 篇 + §1 通用篇
node bin/rtag.mjs "少女在教室里读书" --rating questionable             # exit 1 + 迁移对照表
```

## 输出契约与内容政策

| 契约 | 实现位置 |
| --- | --- |
| 单行、逗号分隔、无换行/无多余标记 | `compose.mjs` 的 `bare` 拼接；`bin/rtag.mjs` 默认 `--format tags` |
| 默认不带官方前缀 | `POSITIVE_PREFIX` 只进 `prompt`，不进 `tags`/`bare` |
| 官方写法：空格代替下划线（`score_*` 除外） | `compose.mjs#dispTag()`：库里的 `cherry_tree / on_bed / completely_nude` 输出成 `cherry tree / on bed / completely nude`；画师同理（官方快照就是 `@haruyama kazunori` 这种写法） |
| 不做内容审查（R18 / NSFL 照常转换） | 全库只有 `og:censorship` / `cb:nsfw` 等分类标签，没有任何过滤分支 |
| 分级 token 自动适配 | `compose.mjs#pickRating()`：命中分级标签取最强；命中 `cb:nsfw` 分类（裸体/性行为/情趣服饰）时至少 `nsfw`；`--rating` 可手动覆盖（档名见下一节） |
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

- `bare` / `tags`：**默认交付形态**，一行纯标签；分级不是 `safe`（或被 `--rating` 显式指定）时，把分级 token 放行首，其余情况不写分级。面板调用固定带 `--no-tier-token`，档位名不会进交付串（见下一节）。
- `prompt`：前缀 + 标签；前缀里的分级 token 由 `pickRating()` 决定，`prefixKeys` 按**实际生效的前缀**动态重建，所以不会出现重复标签。
- `nl.mjs`（英文自然语言）：从 `res.layers[].tags[]`（每条带 `layer`，缺了会全落进 other）归拢，按角色分桶 → 定句子 → 渲染，句子骨架是「标签前缀行 + 每角色一句 + 场景/光影一句」。三层措辞：专属 `PHRASE` 表 → `inferPhrase`（中文名词核 / 词尾形态 / 服装 / 修饰关键词 / 介词短语 / 动作）→ 原样兜底（记进 `meta.fallback`）。
- `gaps.mjs`（缺项检测）：六类缺口 + 候选项（`source`：`alt` / `preset` / `manual` / `choice`），渲染成 markdown 勾选表；图像分支多一类 `C-spec-*`（kind `missingObservation`，必填观察维度没落成结构化字段），计入 `gapsSummary.specMissing`，建议写法可通过 `suggestions[].dimKey` 找回，同维度已在 `C*`/`B*` 里报过时改成往那条缺口上挂建议（不重复开条）。

### ④ 压字选篇（`dialogue.mjs` + `references/dialogue-style.md`）

第 4 期新增：长篇成片写对话框时，技能按档位告诉你**该读哪一节**，别把整份对白参考都塞进上下文。

- 数据源是 `references/dialogue-style.md`（五份 v4 对白参考 + 压字交付流程的合并稿）；节标题与代码里的 `DIALOGUE_SECTIONS` **逐字对应**，`dialogueRefIssues(text)` 就是拿真文档校验这份对应关系，文档被改坏会在自测里红。
- `sectionIdFor(tierName, semantic)` **档名优先**（`safe` / `sensitive` / `nsfw` 直接命中），认不出来再按语义档位兜底（最低档 → Safe 篇、中档 → Sensitive 篇、末档 → NSFW 篇），所以面板里把档名改成 `r18` 之类也照样给得出章节。
- 只有「显式档位 + `faces.dialogueSection` 开着」才有计划（`dialoguePlan()` 返回 `null` 就是**不参与**，与其余四面同开关）；`dialogue.commonAlways` 决定要不要带上 §1 通用篇，默认带。
- 出口：CLI `--dialogue` / `--format dialogue` 打印 `formatDialoguePlan()` 的报告（含「只读这几节」清单），API 侧是 `out.dialogueSection`，JSON 里是同名的键。

## 缺项自审工作流（本轮新增）

CLI 没有界面，「前端多选」落在会话里：工具出结构化清单，技能侧整理成选项问用户，勾完回填重跑。

```
node bin/rtag.mjs "原描述" --broad --format check     # 文本入口：标签 + 自然语言 + 缺项，一次给全
node bin/rtag.mjs --image-spec 观察.json --format md  # 图像入口：默认就带缺项自审，不看开关
node bin/rtag.mjs --image-spec 观察.json --broad      # 图像入口要宽召回/更全候选池时显式写
```

**两个入口都默认带自审、都默认不宽召回（差异只在产物形态：图像入口额外把摘要打到 stderr，文本入口不打）**：

- `reverseImageSpec(spec)` / `reverseImageSpec(spec, {})` 等价于 `reverse({ imageSpec: spec }, { gaps: true })`，`out.gaps` / `out.gapsSummary` / `out.gapsMarkdown` 一定存在；显式 `{ gaps: false }` 关掉。
- 召回档默认是**窄召回**：不传 `broad` 就等于 `{ broad: false }`，标签行与改造前同规模；要更全的候选池显式写 `{ broad: true }`（样张 API 33 条 → 41 条）。
- `reverse({ imageSpec })` / `reverse({ text })` 这层薄壳**不加**这个默认（默认值钉在两个具名入口 `reverseImageSpec()` / `reverseText()` 上）；`reverseText` 现在同样默认带自审，标签串与旧版逐字节一致（多出来的只是结果对象上那几个键），`{gaps:false}` 可关。
- CLI：`--image-spec` 时默认打开 `gaps + alternatives`（宽召回不默认），把一行摘要（`[缺项自审] 缺口 N 条：…` + 每条缺项一行 `键（中文名 / 严重度）：建议写法` + notes 提醒）打到 **stderr**，stdout 仍是干净的单行标签串；`--format md` / `--format json` 里也带缺口信息（md 有「缺项自审摘要」段且逐条带建议写法，json 有 `gapsMarkdown`）。`--no-gaps` 关掉自审、`--broad` 打开宽召回（样张 CLI 默认 33 条、`--broad` 41 条，默认 stdout 与 `--no-broad` 逐字节相同；显式 `--format gaps` / `--check` 不受 `--no-gaps` 影响）。文本入口同样默认开自审、同样不打 stderr 提示（要看清单写 `--format gaps` / `--check`，或 `--format json` 取 `gaps` 键）；两个入口的 stdout 与 stderr 都与旧版逐字节一致。
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
| 两个入口的默认档想改 | `index.mjs` 的 `reverseImageSpec` / `reverseText`，以及 `bin/rtag.mjs` 里那段 `if (!gapsSet)` 默认（两个入口都补 `gaps + alternatives`；宽召回不默认，要宽召回得显式 `--broad` / `{broad:true}`；只有 `--image-spec` 会把摘要打到 stderr） |
| 想多问出某类候选（手部/鞋/画风…） | 往 `gaps.mjs` 的 `DIMENSIONS` 加一组：`{ id, label, layer, test, suggest/expect }`。`test` 决定「已有值就不问」，`suggest` 是问出来的候选；判定式尽量复用文件顶部的 `anyOf` / `endsWith` 助手，别写裸正则（`keyOf` 把空格换成 `_`，`close-up` 也会存成 `close_up`） |
| 层序不对 | `config.mjs` 的 `BIG_LAYER` / `LAYER_NAME`，需要和展览板 `viewer/template.html` 的 `LAYER` 保持一致 |

## 自测

```
node tests/smoke.mjs        # 36 例：中文 8 / 英文 3 / 日文 1 / 图像 3 / R18+NSFL 2 / 中文兜底 4（单元）
                            #       + 自然语言 6（NL_CASES）+ 缺项自审 4（GAP_CASES）+ CLI 接线 6（CLI_CASES）
node tests/smoke.mjs -v     # 打印每例的完整标签串
node tests/spec-audit.probe.mjs   # B+C 行为探针 120 例（默认档/notes/必填维度/别名/既有契约/归档真值），失败时退出码 1
node tests/panel-config.mjs       # 第 5 期 + 第 6 期补遗：面板配置读取层 58 例（候选链 / 判非法 / 旧档名硬报错 / 与面板契约字段名一致 / 误杀项删除规则 13 例 / 配置来源文案 6 例）
node tests/tier-faces.mjs         # 第 1–2 期 + 第 6 期补遗：五个行为面 45 例（纯函数 + CLI 默认路径逐字不变 + 面板配置真能改行为 + 面板删除规则 + 内置三档表收口）
node tests/dialogue.mjs           # 第 4 期：压字选篇 30 例（纯函数 / CLI 铁律 / 隔离配置：面关、改名档位、通用篇关）
node tests/merge-luo.mjs          # 第 4 期 ③：词库分流 27 例（纯函数 / 临时词库里真 dry-run·apply·幂等·回滚 / 技能侧读池 / --info JSON）
```

`tests/tier-faces.mjs` 与 `tests/dialogue.mjs` 的两条铁律（用户裁决，改代码前先读）：不传 `--rating` 时输出与改造前**逐字节一致**；
面板调用总是「显式档位 + `--no-tier-token`」。所有 CLI 用例都注入临时 `$DSH_HOME`，
否则会读到开发机上真实的 `~/.dsh/anima-panel/panel-config.json`，用例就不再确定。
`tests/merge-luo.mjs` 同理守着第三条：**不传 `--pool`（面板默认也是关）时词库就是主索引那一份，输出逐字节不变**；
它只在临时小词库里真写盘，仓库词库一个字节都不碰。

`tests/spec-audit.probe.mjs`（本轮新增，不进 smoke 主链）锁六件事：

1. **notes 降级**：结构化输入里 `notes` 的值不出现在分句、不进标签串，但回显在 `plan.notesText`；只有「整份输入一个结构化键都没有」与「`JSON.parse` 失败的字符串」才走旧行为整段当文本。
2. **默认自审 + 默认窄召回**：`reverseImageSpec(spec)` 空 opts 必须有 `gaps` / `gapsSummary` / `gapsMarkdown`，且裸串与 `{broad:false}` 逐字节相同；`{ gaps: false }` 能关，`reverse({ imageSpec })` 不受影响；文本分支空 opts 现在**同样**带 `gaps`（与图像入口一致），用 `{gaps:false}` 可关。
3. **必填维度与报警**：`REQUIRED_OBSERVATIONS` 每条含 `key/label/severity/advice` 且键路径在模板里存在；空壳 spec 的 9 条都能被找到（要么自成 `C-spec-*`，要么作为 `dimKey` 挂进同组的 `C*`/`B*`）；只写 `style.lighting` 时会报 `style.light_direction` 并带 `srcKey`；`specMissing` 与 `byKind.missingObservation` 对得上；markdown 里带建议写法。
4. **别名归一**：任务点名的七个别名都归一；别名写法与规范键写法的标签串**逐字节一致**、层提示一致；`lights` 与 `style.lighting` 同路径合并、与 `style.light_direction` 不串位。
5. **既有契约**：文本分支默认**标签串** == 改造前基线（逐字节；自审只在结果对象上多挂字段）；**标签条数默认不封顶**（CLI 旧默认 40 / API 旧默认 60 都已在分层前切过一刀，现已去掉，只有显式 `--top N` / `{top:N}` 才截断）；图像分支窄召回的标签串在「老形状样张」上只少掉 notes 硬凑出的 `sideways mouth`，**不多出任何标签**；样张窄召回 33 条（A2 之前 34 条，少掉的正是 `sideways mouth`，作为预期代价显式断言）；默认档 / 关掉自审 / 打开自审三种调用的 `bare` 相同，CLI 默认档与 `--no-broad` 逐字节相同且不含宽召回独有的 4 条（`braided twintails` / `short twintails` / `twintails with braided base` / `full-length mirror`），`--broad` 才出现（CLI 41 条，与 API 同口径；去掉条数封顶之前是 38 条，那 3 条差就是旧 `top: 40` 在分层前砍掉的）；`emptySpec` == `IMAGE_SPEC_TEMPLATE` == `--template`；`tests/img-spec.sample.json` 与模板键路径完全一致；CLI 图像入口 stdout 干净、缺项提示只在 stderr；CLI 文本入口不打提示。
6. **归档真值（2026-10-07 16:35）**：工作区两份探针记录共 23 条（去重后 22 条）逐条钉死 —— **18 条与归档逐字节相等**，**4 条是已记名的偏差**（`蓝白条纹水手服` / `黑色和服` / `两个人` / `低角度仰拍，霓虹街区，雨夜`，都是规则层 `hints.mjs` 补录引入的 M1 家族，A2 不修、属产品决定），这 4 条连「多出 / 少掉」两个集合都钉住，偏差一扩大就红。归档里第 5 条偏差 `--rating explicit --format prompt 一个女孩` 在 v2.0.0 起**不可复现**（旧档名硬报错 exit 1），该行已改成钉 v2 契约：`--rating nsfw --no-tier-token --format prompt 一个女孩` 必须逐字节等于 `masterpiece, best quality, score_7, 1girl, solo, girl`。这条断言对 A2 敏感：在 A2 未生效的副本上跑会红（`微笑` 实测 `smile, light smile, nervous smile, evil smile`、样张窄召回 34 条）。

新增的三段各自锁什么：

- `NL_CASES`：① 人数句要写 `one girl`，且 `silver hair` 不许出现在场景句（词库把银发挂在层 7）；② 动作（`reading`）归姿势句不进场景句；③ 多主体时人数与两种性别都要写出，且 `heart hands duo` 不得被当服装；④ 同一输入连跑两次输出逐字一致（确定性，模型想润色只能在这份骨架上改）；⑤ `两个女孩，一个男孩` 必须合起来读成 `Two girls and one boy`，不许写成 `One girl and one boy`；⑥ 紧写 `三男两女` 要出 `Three boys and two girls`。
- `GAP_CASES`：① 空输入要报 `emptyLayer` 且缺口 ≥2；② 「白天…夜晚」「长发…短发」要报 `E-day-night` / `E-longhair-shorthair`；③ 多主体缺外观要报 `multiSubject`；④ 描述完整时不许报 `conflict`（防误报）。
- `CLI_CASES`（会真的 spawn `bin/rtag.mjs`，所以这一段比前面慢几秒）：默认仍是单行标签串；`--gaps` / `--check` / `--nl` 必须真的改变输出形态（这三个开关曾经只置布尔量、不改 `opt.format`，静默返回默认标签串）；显式 `--format tags` 时它们只当附加产物；`--format json` 要带 `naturalLanguage` / `gapsSummary` / `alternatives`。

每个用例除了 `must`（必须命中）还带 `never`（历史上真实出现过的误召回），另外**每个用例都会跑交付契约检查**：单行、逗号格式正确、不带官方前缀；`rating` 和 `lineMust` 用来锁分级与「不过滤内容」这两条。改动匹配逻辑后这条防线会立刻报警。

## 补充短语池（第 4 期 ③，默认关闭）

从 Luo-fe 的 635 条差异里严格分流出来的**长短语**（≥3 词形）另放一份文件，默认**不参与**召回；短词（≤2 词形）已经并进主索引。

```
anima-tag-kb/画师类/search-index.json          主表：38,306（构建基线）+ 171（第 4 期 ③，第 13 个元素写 "luo-fe"）+ 739（第 6 期，写 "anima3:mid|top|any"）＝ 39,216 行
anima-tag-kb/补充短语池/phrase-pool.json       短语池：180 条（schema anima-tag-reverse/phrase-pool@1）
```

```bash
node bin/rtag.mjs --search "ankles behind neck"          # 池未开：按主表拆成 ankle, neck
node bin/rtag.mjs --search "ankles behind neck" --pool   # 池打开：整条短语命中（score 0.77 / sim 1.00 / 待验证）
node bin/rtag.mjs "少女在教室里读书" --pool                # 文本入口也能带池跑
node bin/rtag.mjs --info                                 # rows 39216 − manifest 39045 = 增量 171（Luofe 那批）；池 180（未启用）
node bin/rtag.mjs --info --format json                   # 同一份概况的结构化 JSON（schema anima-tag-reverse/info@1；面板「词库概况」块读的就是它）
```

- 面板侧的「词库概况」块（第 4 期 ②）只认 `--info --format json`：host 用一个子进程跑它，把 `kb.rows / kb.total / kb.pool / kb.poolPath` 转发给悬浮窗，面板自己**不解析词库**。人类那份 `--info` 输出不受影响，两边数字同源。

- 开关：CLI `--pool` / `--no-pool`（缺省跟随面板 `lexicon.poolEnabled`，**默认关**）；JS API 上叫 **`phrasePool`**（不是 `pool`——`src/match.mjs` 早把 `opts.pool` 当备选候选数组用了，传布尔会炸）。
- **第 6 期并入的那 739 条会写 manifest**：`tools` 之外另有一支 `anima-tag-kb/scripts/merge-anima3.mjs`（默认只读演练，`--write` 才落盘），把外部模板抄出来的标签并进主索引与 `bigs/*.json`，同时把 `meta.total` 从 38,306 抬到 **39,045**，并在 `meta.supplements[]` 里留一条记录（来源文件 / 增补条数 / 时间 / 脚本名）。也就是说 `--info` 里「索引 39,216 − manifest 39,045 = 171」的差额**仍然只有 Luofe 那批**，第 6 期的 739 条两边都算了。
- **重跑构建要按顺序补跑合并**：`画师类/` 是 `anima-tag-kb/scripts/build-hierarchy.mjs` 的生成物，重跑会把两批增量一起覆盖掉；构建完再依次跑 `tools/merge-luo-clean.mjs --apply` 与 `scripts/merge-anima3.mjs --write` 即可恢复（两支都幂等，重复的不会再加）。
- 词库由 `tools/merge-luo-clean.mjs` 生成/回滚：`--dry-run`（默认）只出差异清单与落点校验，`--apply` 才写盘并先把原 index 备份到 `anima-tag-kb/_backup/`，报告落在 `anima-tag-kb/_merge/`；`--report` 看最近一次，`--rollback` 按来源（`src="luo-fe"`）回滚，**不依赖备份**。这一批（第 4 期 ③）刻意**不重写** `manifest.json` 与 `bigs/*.json`，免得展览板页头数字与分类页打架——所以 171 条差额一直显式打出来。`_backup/`、`_merge/` 两个目录已被打包/仓库/inventory 三处排除规则挡住，不会随发布物发出去。
- 池的候选来自 `anima-skill-refs/_diff/luo-only-classified.json`：clean 363 条里 171 条进主索引、180 条进池，其余 284 条按「status 272 + 长串预设重复 11 + 黑名单 1」跳过（黑名单沿用 Luo-fe `validate_prompt_md.py` 的 `BANNED_TAGS`，另拦 `wax on pubic area`）。

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
- 配套**面板插件**（`packages/dsh-anima-tag-reverse`：可视化改三档、五个行为面、负面词与误杀项删除规则，还带试跑框与悬浮窗）**尚未发布到 npm**；现阶段用 `dsh plugin --profile web add link:<仓库>/packages/dsh-anima-tag-reverse` 装（详见该包的中文 README）。面板只认这份技能目录，不负责安装技能。

## 依赖与已知缺口

- Node ≥ 18（实测 v24.20.0），仅用内置模块，无 npm 依赖。
- 词库定位顺序：`--kb DIR` → `ANIMA_KB_DIR` → 技能目录 `kb-path.json` → `<仓库>/anima-tag-kb/画师类` → `~/anima-tag-kb/画师类` → `<cwd>/anima-tag-kb/画师类`，以目录里存在 `manifest.json` 判定命中。
- 词库字段约定见 `anima-tag-kb/README.md`（`search-index.json` 的 12 列）与 `anima-tag-kb/画师类/README.md`（`manifest.json` 的字段与 `meta.bigs/subs` 含义）。
- 已知覆盖缺口：本库**没有** `schoolgirl` / `high_school_girl` 这类通用「女高中生」标签，只有各校具体的校服标签（`sakuragaoka_high_school_uniform` 等）。所以「女高中生 / 高中生 / 女生」在 `EXTRA_ZH` 里兜到通用的 `girl`，不硬凑具体校服。要补这类标签得动词库（展览板那边的策展数据）。
