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

**两张图要拼成一张**（「图1的姿势换到图2的人身上」「场景换成另一张的」「图1的形象微调成图2的某方面」）
不属于本技能：走姊妹技能 `anima-tag-merge`（词库与排序仍是本技能的，本技能只处理单图与纯文本）。

**要给「具体作品 + 具体角色」加标签**（「原神 可莉」「星野（少女与战车）」）走姊妹技能 `anima-tag-character`：
它带作品消歧、能排除同名角色与残条目。观察 JSON 的 `characters` / `series` 若写的是中文名，
先用它的 `patch` 就地修正再喂回本技能（`node <anima-tag-character>/bin/char.mjs patch 观察.json --out 修正.json`）。

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
| ① 输入解析 | `src/parse.mjs`、`src/image-spec.mjs`、`src/jp-lexicon.mjs`、`src/hints.mjs` | 分句、否定识别、人数/画师强制命中、日文→英文桥接、规则补充层（口语人数、中文复合词拆分）、图像观察 schema → 别名归一 + 分句 + 层提示 + 必填维度自审（`notes` 降级为日志） |
| ② 标签匹配 | `src/lexicon.mjs`、`src/match.mjs` | 建表面/词元索引；三条召回（强制 / 最长表面 / 词元+相似度）+ 规则词条；打分 + 六道压制；可选备选池（`--broad`） |
| ③ 输出格式化 | `src/compose.mjs`、`src/nl.mjs`、`src/gaps.mjs` | 分层排序、分级适配、单行标签串、官方前缀形态、负向串、结构化 JSON、Markdown 报告；英文自然语言分支；缺项清单与候选项（六类缺口，含 `C-spec-*` 观察缺项） |

三个可选产物（文本分支默认全关，行为与旧版完全一致）：

| 产物 | 开关 | 说明 |
| --- | --- | --- |
| 宽召回备选池 | `--broad` / `opts.broad` | 阈值放宽（`BROAD` 档）、候选池扩大，供缺项清单取候选 |
| 英文自然语言 | `--nl` / `--format nl` / `opts.nl` | 标签骨架 + 逐角色句 + 场景句，确定性生成，可再润色 |
| 缺项清单 | `--gaps` / `--check` / `opts.gaps` | 缺口 + 可勾选候选项，供技能侧提问补全 |

**图像分支默认带缺项自审、但默认不宽召回（与文本分支的不同就在这两处）**：`reverseImageSpec(spec)`
不带任何 opts 时等价于 `reverse({ imageSpec: spec }, { gaps: true })`——返回的 `out.gaps` / `out.gapsSummary` /
`out.gapsMarkdown` 一定存在，召回档则与改造前一致（不传 `broad` 就等于 `{broad:false}`，标签行同规模）。
CLI 的 `--image-spec` 入口同样默认打开自审，并把一行缺项摘要打到 **stderr**（默认档 stdout 仍是干净的单行标签串）。
关掉自审：API 写 `{gaps:false}`，CLI 写 `--no-gaps`（显式 `--format gaps` / `--check` 不受它影响，仍出缺口）。
理由：缺项自审以前是可选产物，调不调都不报错，于是被静默跳过，交付的标签串漏了画风与光位没人发现。

- 宽召回（`--broad` / `opts.broad` / `{broad:true}`）是**显式档**：默认窄召回；样张 `tests/img-spec.sample.json`
  默认档 33 条、`--broad` 38 条，一条命令可复现：
  `node bin/rtag.mjs --image-spec tests/img-spec.sample.json --broad`（`--no-broad` 与默认同档）。
- `reverse()`（显式 `{imageSpec}`）**不加**这个默认，保持既有行为；`reverseText()` 与纯字符串输入一字未改。
- 文本分支默认档完全没动：不传 opts 时 `r.gaps` 仍是 `undefined`，宽召回也仍默认关。

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
node bin/rtag.mjs "..." --format nl                                  # 英文自然语言提示词
node bin/rtag.mjs "..." --format gaps --broad                        # 缺项清单与候选项（供勾选补全）
node bin/rtag.mjs "..." --format check --broad                       # 标签 + 自然语言 + 缺项，一次给全
node bin/rtag.mjs --nl-template                                      # 打印自然语言句子骨架
node bin/rtag.mjs --image-spec 观察.json                              # 图像观察 → 单行标签（自审摘要自动进 stderr；默认窄召回）
node bin/rtag.mjs --image-spec 观察.json --broad                      # 同上，但走宽召回（标签与缺项候选都更多）
node bin/rtag.mjs --image-spec 观察.json --format prompt              # 图像观察 → 标签 + 官方前缀
node bin/rtag.mjs --image-spec 观察.json --format md                  # 分层报告 + 缺项自审摘要 + 候选项
node bin/rtag.mjs --image-spec 观察.json --no-gaps                    # 只出标签（关掉默认的缺项自审；召回档不变）
node bin/rtag.mjs --search "blue eyes"                               # 单条检索
node bin/rtag.mjs --template                                         # 打印图像观察模板（含必填维度占位写法）
node bin/rtag.mjs --info                                             # 词库概况
node tests/smoke.mjs                                                 # 自测（36 例：中/英/日/图像 + R18/NSFL + 兜底 + NL + 缺口 + CLI）
node tests/spec-audit.probe.mjs                                      # B+C 行为探针（notes 降级 / 默认自审 / 必填维度 / 别名归一 / 既有契约 / 16:35 归档真值）
```

会话内调用（我直接用）：

```js
import { reverseText, reverseImageSpec, buildNaturalLanguage, buildGaps } from '<技能目录>/src/index.mjs';

const r = reverseText('银发少女站在樱花树下，微笑，侧脸');
r.bare;               // 'profile, smile, cherry_tree, under_tree, silver hair'   ← 默认交付形态
r.tags;               // 同 r.bare（单行纯标签）
r.prompt;             // 'masterpiece, best quality, score_7, safe, ...'（带前缀）
r.rating;             // 'safe' | 'explicit' | ...
r.positive.tags;      // ['profile', 'smile', ...]
r.negativeTags;       // { string, base, added }

// 三项可选产物（文本分支不带对应 opts 时 r.nl / r.gaps 为 undefined，输出与旧版一致）
const r2 = reverseText('两个人，雨中，一个男孩一个女孩，撑伞', { broad: true, gaps: true, alternatives: true, nl: true });
r2.nl.text;           // 'Two girls and one boy. She is holding an umbrella, …'
r2.gaps;              // [{ id, kind, severity, title, detail, why, suggestions[] }]
r2.gapsSummary;       // { total, byKind, layers, optionCount, specMissing, specIssues, notesText }
// 单独调用也行：
buildNaturalLanguage(r);                              // { text, sentences, tagLine, negative, rating, meta, markdown }
buildGaps(r, { clauses: [] }, { alternatives: [] });  // { gaps, summary, checklists }

// 图像分支：默认就带自审、默认窄召回（等价 { gaps: true }），标签串与不传 opts 时逐字节相同
const ri = reverseImageSpec(spec);                    // spec 可以是对象或 JSON 字符串
ri.bare;              // 单行标签串（不受自审影响）      ← 默认交付形态
ri.gapsSummary;       // { total, byKind, layers, optionCount, specMissing, specIssues, notesText }
ri.gapsMarkdown;      // 缺项清单（含 C-spec-* 观察缺项与建议写法）
ri.plan.notesText;    // notes 的值（纯日志，不产标签）
ri.plan.specIssues;   // [{ key, label, severity, advice, group, srcKey? }] 必填维度缺了什么
analyzeImageSpec(spec);   // 只问缺项，不跑匹配
const riBroad = reverseImageSpec(spec, { broad: true });   // 要宽召回得显式开（同一样张 33 条 → 41 条）
const ri2 = reverseImageSpec(spec, { gaps: false });   // 想静音自审时才显式关
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

## 观察 JSON：notes 是纯日志，必填维度缺了就报警

图像分支的输入是「我（多模态）看完图手写的观察 JSON」。这一步有两个坑，工具现在都会当面报出来。

### notes 是纯日志，不产标签

`notes` 的值**不参与匹配、不产出任何标签**，只收集到 `plan.notesText` 保留可见性（`gapsSummary.notesText` 也能看到），
方便在报告里提醒「这句只是备注」。要落标签的观察必须写进结构化字段：

| 常见的错写法 | 现在的行为 | 正确写法 |
| --- | --- | --- |
| `notes: "anime 晨光从左侧射入"` | 只当日志，标签串里什么都没有（旧版会硬凑出别的标签） | `style.medium: "anime screenshot"` + `style.light_direction: "来自左侧"` |
| `subject.notes: "银发，侧脸"` | 同上（旧版从「侧脸」硬凑出 `sideways mouth`） | `appearance.hair: "silver hair"` + `appearance.expression: "profile"` |

兼容例外只有一个：整份输入**一个结构化键都没有**（`subject` / `appearance` / `outfit` / `pose` / `scene` /
`style` / `characters` / `series` / `artists` 全都没有），才按旧行为把整段当文本分句；`JSON.parse` 失败时
包装出来的 `{ notes: spec }` 也走这条兼容分支，所以「直接丢一段自然语言」照旧可用。

### 必填观察维度（缺了就报 `C-spec-*`）

`analyzeImageSpec(spec)` 会检查下表；缺哪条，`gaps` 里就多一条 `C-spec-<键路径>`（kind `missingObservation`），
计入 `gapsSummary.specMissing`，并带上可直接照抄的建议写法。同一维度已经在 `C*` 粒度不足里报过时，建议写法
会挂到那条已有缺口上（带 `dimKey`），不重复开条。

| 键路径 | 中文名 | 严重度 | 建议写法 |
| --- | --- | --- | --- |
| `style.medium` | 画风 / 媒介 | high | `anime screenshot` / `official art` / `realistic` / `sketch`（只写 `anime` 词库里没有对应标签） |
| `style.light_direction` | 光位（光源方向） | high | `backlighting` / `light source on the left` / `on the right` / `from above`；只写「柔光」不算光位 |
| `style.framing` | 景别 / 构图 | medium | `full body` / `upper body` / `close-up` / `portrait` |
| `outfit.legwear` | 腿袜 / 腿部穿着 | medium | `thighhighs` / `kneehighs` / `pantyhose` / `boots`；确实没有就显式写「无」（腿被裁掉也算「无」） |
| `appearance.body` | 体型 | medium | `slim` / `curvy` / `petite` / `tall` |
| `outfit.top` | 上衣 | medium | `shirt` / `sweater` / `school uniform`（写在 `outfit.dress` / `outfit.uniform` 也算） |
| `outfit.footwear` | 鞋 | low | `boots` / `loafers` / `sneakers` / `barefoot` |
| `pose.action` | 身体动作 | medium | `standing` / `sitting` / `lying` / `kneeling` / `walking` |
| `style.camera` | 镜头 / 视角 | low | `eye level` / `from above` / `from below` / `wide angle` |

判定细节：
- 空值、空数组、模板占位写法（含 `…` 或 `-`）都算「没写」；`{"style": {"lighting": "soft lighting"}}` 不会因为写了打光就免掉光位，缺项里会带 `srcKey: style.lighting` 提示把它搬过去。
- 只列「缺了就静默丢标签」的维度；`composition` / `palette` / `quality` / `expression` / `accessories` / `time` 等属于可选印象项，缺了不报，避免每条观察都刷出十几条低优先缺口。

### 键名别名归一（与 `KEY_HINT` 同层处理）

调用方常写同义的短键名，`normalizeSpec()` 在摊平**之前**把它们搬到规范路径，避免落错层：

| 别名 | 归一到 |
| --- | --- |
| `lights` / `light` | `style.lighting` |
| `lighting_direction` / `light_dir` / `light_source` | `style.light_direction` |
| `artstyle` / `art_style` / `painter_style` | `style.artist_style` |
| `framing` | `style.framing` |
| `shot` / `camera_angle` / `angle` / `view_angle` / `viewpoint` | `style.camera` |
| `artist` / `artist_tag` / `artist_name` / `painter` / `draw_by` | `artists` |
| `body_type` / `bodytype` / `figure` / `build` | `appearance.body` |
| `hairstyle` / `haircut` | `appearance.hair_style` |
| `hair_color` | `appearance.hair` |
| `eye_color` | `appearance.eyes` |
| `leg_wear` / `legwear_type` / `socks` | `outfit.legwear` |
| `shoes` | `outfit.footwear` |
| `hat` | `outfit.headwear` |

别名只在「不是本层规范键」时生效，所以 `{ style: { framing: … } }` 不会被二次搬成 `style.style.framing`；
别名与规范键落到同一路径时合并值（不覆盖）。实测：别名写法与规范键写法的标签串逐字节一致。

## 缺项自审与「多选补全」的工作流（我执行）

CLI 没有界面，所以「前端多选」落在会话里：工具出结构化清单，我把它整理成选项问用户，勾完再回填重跑。

1. 跑一次宽召回 + 自审：`node bin/rtag.mjs "原描述" --broad --format check`；图像分支自审不用加开关（默认就带），
   但要更全的候选池同样得显式写 `--broad`。
2. 看 `gaps`：六类缺口分别是
   - `A*` 未匹配片段（输入里有词没映射到标签）
   - `B*` 关键层为空（人数 / 外观 / 服装动作 / 场景）
   - `C*` 粒度不足（只写了大类，没给具体取值）
   - `C-spec-*` 观察缺项（kind `missingObservation`：必填观察维度压根没落成字段，见上一节的清单）
   - `D*` 多主体信息不全（人数 >1 但外观描述不够分）
   - `E*` 同维度冲突（白天×夜晚、长发×短发、站姿×坐姿…）
3. 把候选项按缺口分组列给用户勾选（候选项带 `source`：`alt` 宽召回、`preset` 固定建议、`manual` 需他自己写；
   `C-spec-*` 的建议写法也走 `manual`，可以直接照抄进观察 JSON）。
4. 用户勾完，把选中的标签追加进原描述重跑；改完再跑一次 `--format check` 确认缺口归零。
5. 用户明确跳过的缺口记下来，不再重复问。

## 看图反推的标准流程（我执行）

1. 先按 `--template` 的 schema 写一份观察 JSON（只写看得到的：人数、发型发色、瞳色、服装、姿态、场景、光影、画风/画师、NSFW、不该出现的元素）。
   - 上面「必填观察维度」表里的 9 条必须落成结构化字段；**不要**把画风、光位、景别、腿袜塞进 `notes` —— 写进去等于没写。
   - 拿不准的键名可以先用别名（`artstyle` / `lights` / `framing` / `shot` / `artist` / `body_type`），工具会自动归一。
2. `node bin/rtag.mjs --image-spec 观察.json --format md`
   - 默认入口（`--format tags`）stdout 单行纯标签串、缺项摘要进 stderr；`--format md` 时 stdout 是分层报告（实测 124 行），带「缺项自审摘要」与 `C-spec-*` 建议写法。
3. 看缺项：有 `C-spec-*` 就照着里面的建议写法补回观察 JSON 再跑一次，直到 `specMissing` 归零（看不到的维度也要显式写「无」）。
4. 检查 md 里的「未匹配片段」：词库没有的概念要么换成同义说法，要么在回答里说明。
5. 需要画风/画师时，在 `artists` 里写 `@画师名`（强制命中，不看相似度）。

## 在技能中心里启用 / 禁用

技能装在用户技能目录 `<用户主目录>/.dsh/skills/anima-tag-reverse/`（Windows 即 `C:\Users\<用户名>\.dsh\skills\anima-tag-reverse\`；技能中心面板里「用户技能」一栏，带开关）。安装与更新都跑同一条命令：

```bash
node tools/install-dsh-skill.mjs          # 复制一份到 ~/.dsh/skills/anima-tag-reverse 并写 kb-path.json
node tools/install-dsh-skill.mjs --check  # 只检查目标目录是否已是最新
```

装好后在技能中心点开关即可启用/禁用（面板写的是 SKILL.md frontmatter 的 `disable-model-invocation`，模型目录会热刷新）。源码改完要再跑一次安装脚本才会同步到用户技能目录；面板里如果编辑过拷贝的那份，重跑安装会以仓库版本为准覆盖（脚本会先备份到 `~/.dsh/skill-backups/`，刻意放在技能根目录外，避免加载器把副本当成第二个同名技能）。

## 关键设计（改代码前先读）

- **候选召回三条路**：① 强制（引号内容 / `@画师` / 人数）② 表面最长匹配（中文释义、别名、日文桥接都注册成「表面」）③ 词元 + 相似度（英文按**词覆盖**算，中文只认**包含**关系）；另有规则补充层（`src/hints.mjs`）在表面扫描之后补录口语人数与中文复合词拆分结果，分数刻意压到 0.9 低于真实表面命中（0.93–0.97）。
- **六道压制**（顺序即优先级）：泛词压制 → 表面组一表一winner → 中文核分组 → 变体压制 → 特异性压制 → 单字去噪；末尾按门槛过滤，但**逐字命中**（`surface:` / `forced:` / `jp:` / `rule:`）不受每分句名额限制。
- **泛词压制按标签英文键判定**：词库的表面键常是裸颜色（`white` / `black`），若拿中文 via 键比较会得出「whitedress 包含 white」这种歪理，把真正命中的 `silver hair` 压掉——实测踩过，勿回退。
- **频次先验**：`freqScore()` 对 `freqN=0` 的标签（库里有 4,599 条，含 `silver hair`、`girl`）返回 `SCORE.medianFs = 0.42`（全库归一化频次的中位数），而不是 0，否则这些标签会被当成最冷门直接淘汰。
- **重叠表面命中**：`scanSurfaces()` 给命中打 `canon` 标记（用户打的就是该条目本名），重叠时「更长优先、同长优先 canon」——`sitting on a chair` 因此给出 `sitting` 而不是 `sitting on`。
- **宁可少给，不要多给**：误召回比漏召回更烦人（用户得手动删）。所以阈值偏高、压制偏狠；要更多候选走 `--broad`（不动默认档，默认档被 25 条回归用例锁着）。
- **中文相似度不靠编辑距离**：`白色连衣裙` 和 `绿色连衣裙` 差一个字，dice 必然虚高，所以中文之间只认包含关系。
- **中文字集兜底**：语序不同但用字几乎一样的说法放行——`女高中生` ↔ `高中女生`（汉字字集 Jaccard 1.00 → sim 0.86）；`白色连衣裙` ↔ `绿色连衣裙` 只有 0.67，照旧判死。
- **中文单字门槛**：单字汉字表面（`高`→`gao`、`春`→`spring` 这类姓氏/季节标签）极易在更长的词里误命中，所以只放行高频字 + 白名单（`SINGLE_CJK_OK`），被同分句更长的词覆盖时丢弃；另有复合词护栏 `SINGLE_CJK_BLOCK_2G`（角色/风格/心情/眼球/鬼灭… 里的那个字不许单独成标签，但「鹿角」「风吹」照旧）。
- **分级不改内容**：`pickRating()` 只看匹配结果里的分级标签与 `cb:nsfw` 分类，只动前缀/行首那一个 token。
- **自然语言分支是「确定性骨架」**：`src/nl.mjs` 只查表 + 拼接，不引入随机、不做二次创作；查不到专属措辞的标签原样进句子并记进 `meta.fallback`，句子后附标签串供核对。句子骨架与角色分工见 `--nl-template`。
- **缺项判定不猜内容**：`src/gaps.mjs` 只报「能证明的缺口」——未匹配片段、关键层为空、同维度没有取值、多主体外观不足、同维度互斥标签并存、以及图像分支的必填观察维度缺项（`C-spec-*`，判据是「该字段没有真实取值」，含模板占位与「只写了打光没写光位」）；候选项一律带 `source`（`alt` 宽召回 / `preset` 固定建议 / `manual` 需人工），不臆造用户没说过的东西。
- **图像分支的默认档只加产物、不换召回档**：默认 = 自审开 + 窄召回。`reverseImageSpec()` 空 opts 的 `bare` 与 `{gaps:false}`、`{broad:false}` 逐字节相同（探针 `tests/spec-audit.probe.mjs` 锁住）；要宽召回必须显式 `--broad` / `{broad:true}`（样张 CLI 33 条 → 38 条、API 33 条 → 41 条）。缺项摘要只走 stderr 与 md/json，不污染 stdout 的单行标签串；文本分支默认输出与改造前一致。
- **notes 降级是兼容改造**：旧行为把 `notes` 当普通分句摊平，会从备注里硬凑标签（实测「侧脸」凑出 `sideways mouth`）；现在结构化输入里的 `notes` 只当日志。这条改动会让**老形状样张**少掉那些硬凑标签（探针里锁的就是这一个差异），想恢复旧行为就把内容挪进结构化字段。

## 常用调参（`src/config.mjs`）

| 常量 | 作用 | 默认 |
| --- | --- | --- |
| `SCORE.minScore` | 候选进入结果的最低分 | `0.46` |
| `SCORE.minSim` | 纯相似度路径的下限 | `0.52` |
| `SCORE.base` / `SCORE.freq` | 打分里「基础可信度」与「频次」的权重 | `0.68 / 0.32` |
| `SCORE.hintBoost` | 命中层提示时的加成 | `1.22` |
| `SCORE.topPerClause` | 每个分句最多留几条 | `3` |
| `SCORE.medianFs` | `freqN=0` 时给的频次分（全库中位数） | `0.42` |
| `BROAD.*` | 宽召回档（`--broad` 才生效，默认档不动） | `minScore 0.38` / `topPerClause 6` / `altPerLayer 12` / `altTotal 80` |
| `SINGLE_CJK_MIN_FREQ` / `SINGLE_CJK_OK` | 中文单字表面的门槛与白名单 | `8000` / 见文件 |
| `SINGLE_CJK_BLOCK_2G` | 复合词护栏（这些二字词里的字不许单独成标签） | 角色/风格/心情/眼球… |
| `EXTRA_ZH` | 词库缺释义、但确实需要的说法（如 `sitting` → 坐/坐着） | 见文件 |
| `RATING_TAGS` | 分级 token 的固定顺序 | `safe → sensitive → questionable → nsfw → explicit` |
| `FUNCTION_WORDS` | 英文虚词，用于切别名窗口 | 见文件 |
| `COUNT_GROUPS` / `CJK_DECOMPOSE` / `SHORT_ALIASES` | 规则补充层（`src/hints.mjs`）：口语人数、中文复合词拆分、常见中文短说法 | 见文件 |

## 依赖与边界

- 词库：`anima-tag-kb\画师类\`（`manifest.json` + `search-index.json`）。定位顺序：`--kb` 参数 → 环境变量 `ANIMA_KB_DIR` → 技能目录里的 `kb-path.json`（安装脚本写入）→ 仓库相对路径 → 用户主目录 → 当前目录，以目录里有没有 `manifest.json` 判定。
- 零依赖：只用 Node 内置模块（Node ≥ 18）。不联网、不下模型。
- 图像理解由多模态的我完成，脚本只吃结构化观察结果。
- 不做权重建议：输出标签与顺序，具体权重交给用户/模型卡（`1.0–1.5` 之类的区间可在 `--format md` 的分数列旁参考词库里的 `weight` 字段）。
- 库覆盖缺口（已知）：本词库里没有 `schoolgirl` / `high_school_girl` 这类通用「女高中生」标签，只有各校具体的校服标签，所以这类说法兜到 `girl`（不做硬凑）。详见 `README.md`。
