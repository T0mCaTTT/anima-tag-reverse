---
name: anima-tag-reverse
description: 把自然语言描述或图像观察结果反推成 Anima 2B / Danbooru 可用的标签串，默认输出混合形态（分层标签块 + 一句英文自然语言 + 负向词）。Use when 用户给一段中文/英文/日文画面描述或一张图，想要「该用哪些 tag」「帮我配提示词」「这张图怎么还原」；也用于把已有标签串补全、查词、生成正负向提示词。不过滤内容：R18 / NSFL 描述照常转换，只把分级 token 写对，不说教、不打码。零依赖 Node，直接读本地 anima-tag-kb 词库（主索引 39,216 行 ＝ 构建基线 38,306 ＋ 第 4 期 ③ 的 171 条 ＋ 第 6 期并入外部模板的 739 条；另有 180 条长短语池默认关闭）。
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
| 默认就是交付形态 | 交付是**正/负两块**（第 7 期起）：正面块＝第一行质量/分级行，接着按层各一行标签（行尾保留逗号），空一行后一句英文自然语言；负面块＝负向串。两块各占一个 Markdown 代码块（自带复制按钮），块内不写标题行 |
| 面板同款 | 试跑面板的 `hybrid` 结果同样拆两块：`run-positive`（标签串＋自然语，一起复制）与 `run-negative`，各带复制按钮（`复制` → `已复制` / `复制失败`，2 秒复原） |
| CLI 仍是单块 | `--format hybrid` 的命令行输出保持单块「混合形态」（脚本与面板按它解析）；要单独一行纯标签串写 `--format tags`（别名 `line` / `bare`）；`--format prompt` 给带官方前缀的单行正向串 |
| 逗号分隔的纯标签 | `标签1, 标签2, 标签3`；空段/多余逗号都不会有（混合形态的每个标签行行尾保留一个逗号，方便直接接排下一行） |
| 官方前缀 | 混合形态的第一行就是前缀行（`masterpiece, best quality, score_7, safe,`）；`--format tags` 默认不带前缀，要带就 `--format prompt` |
| 标签权重（第 7 期） | 混合形态默认给标签配 **Anima 权重**：`(tag:1.2)` 形式、逗号依旧。档位按词库频次：`freq ≥ 100k` 裸标签 ｜ `10k–100k` → `1.1` ｜ `1k–10k` → `1.2` ｜ `<1k` → `1.3`；**库外词与人数层永远裸标签**；全串最多 6 个加权、每层最多 2 个（按 freq 由冷到热取）；要关掉写 `--no-weights`。质量/分级前缀行永不加权。**用户显式给的权重照搬不压缩**：1.5 以上、乃至 `(tag:10)` 都是合法写法，Anima 侧**没有上限**（2026-10-13 用户当场改的规则；旧档把高值一律压到 1.4 以下是过头了） |
| 手指脚趾常驻 | 负面块固定带 `bad hands, extra fingers, missing fingers, fused fingers, extra digits, fewer digits, five fingers, malformed hands, bad feet`；手或脚可见时正向给结构词（`open hand` / `spread fingers` / `barefoot` / `toes`），数目写自然语 |
| 不做内容审查 | R18 / NSFL 元素一个标签都不删；只在需要时把**分级 token**写对（见下） |
| 标签合规、无冗余 | 按 Anima 官方分层顺序输出；空格代替下划线（`score_*` 除外，库里 `cherry_tree` 输出成 `cherry tree`）；前缀里已有的标签不会重复出现 |
| 提醒不打断交付 | 一段话没接住只报条数（`另外：有 N 句没接住`，`--loose` 可换更啰嗦的四种放法）；互斥 / 标签总数提醒只加在末尾几行，交付串原样不动（`--no-hints` 关掉） |

分级自动适配：命中露骨标签（`explicit`，它本身是库里的内容标签）或成人内容分类（`cb:nsfw`，如裸体 / 性行为 / 情趣服饰）时，分级 token 升级为**当前档表的末档**（默认 `nsfw`）并放在行首；其余情况不写分级。v2.0.0 起内置回退档表收口成三档，旧名 `explicit` 只作迁移来源、不再被当成档位写进行首（旧名的报错口径见下条）。

**档位与五个行为面（第 1–2 期起；面 3 第 4 期起）**：档名从面板配置读（`$DSH_ANIMA_PANEL_CONFIG` > `$DSH_HOME/anima-panel/panel-config.json` > `<技能目录>/panel-config.json`，都没有则内置 `safe` / `sensitive` / `nsfw`），面板「档位管理」里改名加档即时生效；`--info` 打印配置来源、当前档位表与五个面的开关（没有候选文件时来源显示为「未找到，候选链：A → B → C」，与档名校验失败、「面被关掉」两处报错同口径，统一走 `panel-config.mjs` 的 `configRef()`）。显式 `--rating <档名>` 会按档位做五件事：① 档名进前缀（面板固定带 `--no-tier-token` 把它挡在交付串外）② 负面串按档追加压制词（顶档换成不打码纪律），再按 `NEG_DROP_RULES` 与面板 `negative.dropRules` 删掉误杀项 ③ **压字选篇**（`faces.dialogueSection`，第 4 期实装）：按档挑 `references/dialogue-style.md` 里该读的章节，`--dialogue` / `--format dialogue` 直接打印选篇，通用篇由 `dialogue.commonAlways` 决定（默认必过）④ 档位门按画面可见度挡下露骨/擦边标签，被挡的进 `tierBlocked` 并在 `--gaps` 里开一条 E1 缺口 ⑤ 缺项候选按档收紧（与 `--broad` 互相独立）。**不传 `--rating` 时以上五件都不发生，输出与旧版逐字节一致**。旧档名 `questionable` / `explicit` 在默认档位表下作废：写进 `--rating` 会 exit 1 并打印迁移对照表（绝不静默改名；若你把这套档名写进了面板配置，技能就照用不报错）。

## 三步流水线（本技能的实现结构）

| 步骤 | 文件 | 职责 |
| --- | --- | --- |
| ① 输入解析 | `src/parse.mjs`、`src/image-spec.mjs`、`src/jp-lexicon.mjs`、`src/hints.mjs` | 分句、否定识别、人数/画师强制命中、日文→英文桥接、规则补充层（口语人数、中文复合词拆分）、图像观察 schema → 别名归一 + 分句 + 层提示 + 必填维度自审（`notes` 降级为日志） |
| ② 标签匹配 | `src/lexicon.mjs`、`src/match.mjs` | 建表面/词元索引；三条召回（强制 / 最长表面 / 词元+相似度）+ 规则词条；打分 + 六道压制；可选备选池（`--broad`） |
| ③ 输出格式化 | `src/compose.mjs`、`src/nl.mjs`、`src/gaps.mjs` | 分层排序、分级适配、单行标签串、官方前缀形态、负向串、结构化 JSON、Markdown 报告；英文自然语言分支；缺项清单与候选项（六类缺口，含 `C-spec-*` 观察缺项） |

三个可选产物（宽召回与英文自然语言仍默认关；缺项自审两个入口都默认开）：

| 产物 | 开关 | 说明 |
| --- | --- | --- |
| 宽召回备选池 | `--broad` / `opts.broad` | 阈值放宽（`BROAD` 档）、候选池扩大，供缺项清单取候选 |
| 英文自然语言 | `--nl` / `--format nl` / `opts.nl` | 标签骨架 + 逐角色句 + 场景句，确定性生成，可再润色 |
| 缺项清单 | `--gaps` / `--check` / `opts.gaps` | 缺口 + 可勾选候选项，供技能侧提问补全（**两个入口默认开**；要关写 `--no-gaps` / `{gaps:false}`） |

**两个入口都默认带缺项自审、都默认不宽召回**：`reverseImageSpec(spec)`
不带任何 opts 时等价于 `reverse({ imageSpec: spec }, { gaps: true })`——返回的 `out.gaps` / `out.gapsSummary` /
`out.gapsMarkdown` 一定存在，召回档则与改造前一致（不传 `broad` 就等于 `{broad:false}`，标签行同规模）。
CLI 的两个入口同样默认打开自审；`--image-spec` 额外把一行缺项摘要打到 **stderr**（默认档 stdout 仍是干净的单行标签串），
文本入口不打 stderr 提示（要看清单写 `--format gaps` / `--check`，或 `--format json` 取 `gaps` 键）。
关掉自审：API 写 `{gaps:false}`，CLI 写 `--no-gaps`（显式 `--format gaps` / `--check` 不受它影响，仍出缺口）。
理由：缺项自审以前是可选产物，调不调都不报错，于是被静默跳过，交付的标签串漏了画风与光位没人发现。

- 宽召回（`--broad` / `opts.broad` / `{broad:true}`）是**显式档**：默认窄召回；样张 `tests/img-spec.sample.json`
  默认档 33 条、`--broad` 41 条，一条命令可复现：
  `node bin/rtag.mjs --image-spec tests/img-spec.sample.json --broad`（`--no-broad` 与默认同档）。
  旧文档里写的「`--broad` 38 条」是假口径：那是旧 CLI 默认 `top: 40` 在分层**之前**切掉的 3 条，API 一直是 41 条。
- `reverse()` 这层薄壳**不加**这个默认（默认值钉在两个具名入口 `reverseText()` / `reverseImageSpec()` 上），保持既有行为。
- 文本分支：`reverseText()` 现在同样默认带 `r.gaps` / `r.gapsSummary` / `r.gapsMarkdown`（以前不传就静默没有）；
  宽召回仍默认关，CLI 文本入口的 stdout 与 stderr 都与旧版逐字节一致，多出来的只是 `--format json` 里那几个自审键。
- 标签条数默认**不封顶**：CLI 旧默认 `top: 40`、API 旧默认 `top || 60` 都在分层之前先切一刀，
  砍掉的是全局分数最低的那几条（表现为「标签比预期少」，很容易误判成词库不够）；要封顶显式 `--top N` / `{top:N}`。

档位相关的产物（第 1–2 期 / 第 4 期）：显式 `--rating <档名>` 时才计算，`--format json` 里对应 `tierPolicy` /
`tierBlocked` / `dialogueSection` 三个键（不传档位时 `tierPolicy` 仍在但 `explicit=false`、`tierBlocked` 为空数组、
`dialogueSection` 不出现——内容输出与旧版逐字节一致）。压字选篇的实现是 `src/dialogue.mjs`，文档是
`references/dialogue-style.md`（第 4 期新增，五份 v4 对白参考合并稿）。

补充短语池（第 4 期 ③，默认关闭）：

| 项 | 值 |
| --- | --- |
| 文件 | `anima-tag-kb/补充短语池/phrase-pool.json`（180 条 ≥3 词形的长短语，schema `anima-tag-reverse/phrase-pool@1`） |
| 开关 | CLI `--pool` / `--no-pool`（缺省跟随面板 `lexicon.poolEnabled`，默认关）；JS API 是 **`phrasePool`**（`pool` 这个名字已被 `src/match.mjs` 的备选候选数组占用） |
| 主索引增量 | `anima-tag-kb/画师类/search-index.json` 追加两批共 910 条：第 4 期 ③ 的 171 条（第 13 个元素 `"luo-fe"`，**不写 manifest**）＋ 第 6 期并入外部模板的 739 条（第 13 个元素 `"anima3:mid|top|any"`，**写 manifest**：`meta.total` 38,306 → 39,045，并在 `meta.supplements[]` 留记录）。`--info` 现打印「增量：索引 39216 行 − manifest 记 39045 行 = 171 条」——差额仍只反映 Luofe 那批 |
| 并库脚本 | 第 6 期的 `node anima-tag-kb/scripts/merge-anima3.mjs`（默认只读演练，`--write` 才落盘；同时补 `bigs/*.json` 与 manifest 计数，写前备份到 `_backup/anima3-<ts>/`、报告落 `_merge/`）。重跑 `build-hierarchy.mjs` 会覆盖两批增量，之后按 `merge-luo-clean.mjs --apply` → `merge-anima3.mjs --write` 顺序补跑即可（都幂等） |
| 生成/回滚 | `node tools/merge-luo-clean.mjs --dry-run`（默认，只出差异与落点校验）→ `--apply`（先备份到 `anima-tag-kb/_backup/`，报告落 `_merge/`）→ `--rollback`（按 `src="luo-fe"` 回滚，不依赖备份） |
| 铁律 | 不打开池时词库就是主索引那一份，输出逐字节不变（`tests/merge-luo.mjs` 组C 锁死） |

## 第 6 期：并入的外部模板规则（「ANIMA3 提示词生成模板 v3.1」）

规则数据只有一份：`references/anima3-rules.json`（从外部模板逐条提取，带真实章节行号）；读表与判定全在 `src/rules.mjs`（**只有 `loadRules()` 读盘**，其余是纯函数——compose 的注入与 gaps 的提醒都从这里取判定，规则形状不散到渲染层）。

| 规则 | 出处 | 落地行为 |
| --- | --- | --- |
| 互斥提醒 | §3.1 五组 25 条对（视角 / 身份 / 服装 / 动作 / 细节过量） | 命中就加一行 `⚠ <组名>：A 与 B 通常不同时出现（<原因>）`；**只提醒、不自动删**；JSON 进 `annotate.mutex`，`gaps` 里开一条 `kind:'mutex'`。「足部整体」那组 a/b 是同一批标签，按「≥3 条即过度」判 |
| 标签总数区间 | §4.2 | 单人 20–36 / 双人 26–44 / 多人 34–54；出区间加一行 `· 标签共 N 条，单人建议 20–36 条（偏少——细节还能再补 / 偏多——会互相稀释）`；**在区间内一句不打** |
| 单人默认视线 | §4.3 | 单人场景、用户没要背影/侧脸、结果里也没有视角或睡姿标签时，补 `direct eye contact` + `facing viewer`；新形态（hybrid / check）默认注入，旧形态要显式 `--view-default`；注入的标签在 JSON 里带 `injected:true` / `source:'view-default'` |
| 主题配方 | §14 十二个主题（620 个标签） | `--theme-list` 列清单（`--format json` 出 schema `anima-tag-reverse/themes@1`）；`--theme <id>` 把该主题标签注入交付串，末尾报「注入 N 条 / 其中 M 条词库里查不到」+「这个主题还要满足：…」。主题是显式要求，**旧形态也会注入**；主题在场时不叠加默认视线 |
| 观众句 | §4.5 八条 `as if …` | 作为普通词条进了主词库（`gaps` 里出现时带原话），检索得到、可被匹配 |

要点与边界：

- 提醒只打在 **hybrid / check / gaps / json** 四种形态下（`--no-hints` 关掉）；旧形态 `--format tags|prompt|line|bare` 一个字符都不多，逐字节契约仍在（`tests/anima3.mjs` 组 B 锁死）。
- 「没接住」的口径：词库里查不到的、分数不够落选的算；**被档位挡下的不算**（那走 `--gaps` 的 `tier-blocked`）。
- 第 6 期新并入的标签在数据行第 13 个元素标了档位来源：`anima3:mid`（擦边，sensitive 起可见）/ `anima3:top`（露骨，nsfw 起可见）/ `anima3:any`（不挑档）；档位门 `gateNeed(tag, big, rowNeed)` 按这个标记判，词库里的旧行看不出这个位置（`fields` 只到下标 11）。
- 用户裁决**不采纳**的部分：模板 §13.6 的「禁光线 / 光影 / 色调 / 光学 / 发光」（不禁，保留光线与色调标签）、画师必填（未指定默认 `@eonsang`——本项目「用户不提就不加画师」）、以及「只许一行、禁换行」的硬格式（本项目默认就是多行混合形态）。

## 跑法

技能根目录：本文件（`SKILL.md`）所在目录。下面的命令都在技能根目录里跑；你的会话 cwd 不是那里时先切过去：

```bash
cd <技能根目录>          # Windows: cd /d "…\skills\anima-tag-reverse"
```
node bin/rtag.mjs "长发蓝发少女坐在教室里看书，夜晚，逆光，不要眼镜"   # 默认：混合形态（分层标签块 + 一句英文自然语言 + 负向词）
node bin/rtag.mjs "..." --format tags                                # 旧形态：单行纯标签（无前缀）
node bin/rtag.mjs "..." --format prompt                              # 带官方前缀的完整提示词
node bin/rtag.mjs "..." --loose plain                                # 「没接住」的中文原话跟在英文句尾（默认只报条数）
node bin/rtag.mjs "..." --theme ntr                                  # 套用第 6 期主题配方（--theme-list 看十二个 id）
node bin/rtag.mjs --theme-list                                       # 列出主题配方（id / 中文名 / 标签数 / 自带禁配 / 出处）
node bin/rtag.mjs "..." --no-view-default                            # 单人场景不加默认视线；--no-hints 关掉末尾提醒
node bin/rtag.mjs "..." --format negative                            # 只要负向串
node bin/rtag.mjs "..." --format md                                  # 带分层与分数（人看）
node bin/rtag.mjs "..." --format json                                # 给程序用
node bin/rtag.mjs "..." --rating nsfw                                # 手动指定分级
node bin/rtag.mjs --rating nsfw --dialogue                           # 压字选篇：本档该读的 dialogue-style 章节
node bin/rtag.mjs --rating safe --dialogue --format json             # 同上，选篇落在 dialogueSection 键
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
node bin/rtag.mjs --search "ankles behind neck" --pool                # 打开补充短语池再检索（默认关；也可写 --no-pool 显式关）
node bin/rtag.mjs --template                                         # 打印图像观察模板（含必填维度占位写法）
node bin/rtag.mjs --info                                             # 词库概况（含「索引行数 − manifest 总数 = 增量」与池条数）
node bin/rtag.mjs --info --format json                               # 同一份概况的结构化 JSON（schema anima-tag-reverse/info@1，面板用）
node tests/smoke.mjs                                                 # 自测（37 例：中/英/日/图像 + R18/NSFL + 兜底 + NL + 缺口 + CLI 默认混合形态）
node tests/tier-faces.mjs                                            # 五个行为面自测（45 例：档名/负面分档/档位门/候选松紧/压字）
node tests/panel-config.mjs                                         # 面板配置读层自测（58 例：三段候选链 + 校验 + dropRules + 配置来源文案）
node tests/dialogue.mjs                                             # 压字选篇自测（30 例：纯函数 + CLI + 隔离配置）
node tests/anima3.mjs                                               # 第 6 期规则自测（24 例：规则表 / 人数 / 总数区间 / 互斥 / 默认视线 / 主题 / CLI 提醒与注入）
node tests/merge-luo.mjs                                             # 词库分流自测（27 例：纯函数 + 临时词库真写盘 + 技能侧读池 + --info JSON 形状）
node tools/merge-luo-clean.mjs --dry-run                             # 词库分流差异清单（不写盘；--apply 才写，写前自动备份）
node tests/spec-audit.probe.mjs                                      # B+C 行为探针（notes 降级 / 默认自审 / 必填维度 / 别名归一 / 既有契约 / 16:35 归档真值）
```

会话内调用（我直接用）：

```js
import { reverseText, reverseImageSpec, buildNaturalLanguage, buildGaps } from '<技能目录>/src/index.mjs';

const r = reverseText('银发少女站在樱花树下，微笑，侧脸');
r.bare;               // 'profile, smile, cherry_tree, under_tree, silver hair'   ← 默认交付形态
r.tags;               // 同 r.bare（单行纯标签）
r.prompt;             // 'masterpiece, best quality, score_7, safe, ...'（带前缀）
r.rating;             // 'safe' | 'sensitive' | 'nsfw'（档名来自面板配置，自动适配落点是末档）
r.positive.tags;      // ['profile', 'smile', ...]
r.negativeTags;       // { string, base, added }

// 三项可选产物（r.gaps 现在默认就有，与图像入口一致；r.nl / r.broad 不带 opts 时仍是 undefined）
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

R18 例（分级自动升到行首的末档 `nsfw`，内容一个都不删；`explicit` 是命中到的内容标签，不是档位名）：

```
nsfw, 1girl, solo, girl, lying, naked, on bed, orgasm
```

要完整提示词时（`--format prompt`）：

```
masterpiece, best quality, score_7, nsfw, 1girl, solo, girl, lying, naked, on bed, orgasm
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

1. 跑一次宽召回 + 自审：`node bin/rtag.mjs "原描述" --broad --format check`；两个分支的自审都不用加开关（默认就带），
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

## 读图审计（看图之后必做，我执行）

出图不是终点。**读图一律多模态直接读**——敏感图与长篇派子代理读，别让敏感图进主对话，也不用外挂视觉通道。

每张图过一遍**四问清单**：

1. 提示词遵循如何？（该有的元素在不在）
2. 整体画面有没有崩坏？（手、五官、肢体、透视、文字）
3. 场景是否合理？（光照、道具、环境与描述一致吗）
4. 分镜想表达的意思有没有传达出来？——不是「画得好看」，是「读得懂」。

- 判定「元素存在 / 归属 / 数量」时必须 **zoom 或重读二次核实**：视觉模型会把祭坛上固定的大十字记成角色手里的新十字——一次读图不算数。
- 长篇**分批读 10 张 / 批**，读完**统一重 roll**：不要看一张改一张（风格会漂）。
- 重 roll 之后必须**复读验证**：改完不看等于没改。
- 结论按「元素存在 / 归属 / 数量 / 崩坏 / 分镜意图」分条写，别只写「不错」。

## 长篇成片压字（对话框）

**交付物 = 压好对话框的成片，只交无字原图不算完成。** 三种件：对白 = 白气泡 + 尾巴指向说话人；内心独白 = 思考泡 + 圆点；旁白 = 米色框。

写台词时激活 `references/dialogue-style.md`（对白写法参考）：

1. 先按分镜表给每页**标档位**（safe / sensitive / nsfw）。
2. 同档位页**集中一批**写台词 + 定坐标（避脸避主体），存 `captions_<书>.md`；写完全档再切下一档，**不按页码逐页写**（防档位腔调串味）。
3. 压完**抽查 3 页**，再全量压。
4. 产出：日期文件夹根层 = 成片（`P01_标题.png`），`_raw/` = 无字原图，`_reject/` = 废案（带原因命名）。

哪一档读哪一节由技能算：`node bin/rtag.mjs --rating <档名> --dialogue` 直接打印「本档该读的 dialogue-style 章节」（面 3 `faces.dialogueSection`；通用篇由 `dialogue.commonAlways` 决定，默认必过；不传档位就不替你挑篇）。压字脚本（bake_bubble 思路：台词 + 坐标表驱动）里换行、防超宽、**行尾孤字与行头标点两条禁则**都要有——实测长句会在行首掉出逗号。

## 出图踩坑速查（触发条件 → 建议写法 / 负面词）

| 触发条件 | 建议写法 / 负面词 |
| --- | --- |
| 双人 OC 同框，两人的发色 / 服装串染 | 写 `2girls` 锚 + 每角色一个连续段（句首 `the senior` / `the junior`），负面加 `heterochromia`；发色用强先验词（`blonde` / `black`），弱词（`flaxen`）会被服装染色 |
| 「对话 / 展示 / 讲解」类措辞 → 画面被拉成漫画分格 | 负面常驻 `multiple views, comic, speech bubble`；措辞避开 explain / show / present |
| 传递 / 交接动作，单帧里画成了半成品 | 只落**完成态**（糖已掰好、相机已在手中且对方空手）；屏幕内容用泛光 + 反应承担，禁可读文字；纸张保留模糊字迹 |
| 悬停 / 漂浮，角色变成站桩 | 先验极强：改俯拍 + 地面在脚下远处，负面加 `standing on ground` |
| 一个词两种画法（歧义渲染） | 写死：`shotgun microphone` 会渲成真枪 → 改 `a fuzzy interview microphone on a short handle`；湿身写 `soaked through` / `wet hair plastered`；时段页带暗度基线（`no daylight` / `dusk`） |
| 反射物件（镜子 / 水面 / 玻璃） | 只放进**没有第二角色**的页；「镜中像」梗改画中像或破镜框 |
| 人群页出现复制脸 / 全是对着镜头的人 | 正面**不写** `no other people`、负面**不压** `strangers, crowd`；人群用剪影 + 灯海，负面加 `cloned face` |
| 叙事钩子押在手部微动作上（笔悬空之类） | 手是弱载体，别押；能用 canon 角色就用（有名字即锚，重 roll 率 1/30，OC 群像 7/30） |

**不并入本技能的四件事**（v4 原文有、这里刻意不做）：`output/YYYY-MM-DD/` 轮次分层与 `_compare` / `_evolving` 这类目录纪律、多子代理对比测试、服务器跑批与卡死重启、点子库纪律。

## 出串决策：通用判据（出串前必读）

**怎么想** → `references/decision-rules.md`（三条底层机制 ＋ 五步决策流程 ＋ 判据表 ＋ 12 问自检）；**凭什么这么想** → `references/landing-rate.md`（十一个题材的实测台账）；**表情怎么配** → `references/mouth-codes.md`（四款嘴形码 `:d` / `d:` / `:3` / `:p` ＋ 十一组情绪配方，含冷词与叠写纪律）。这里只写判据，不写题材配方。

**三条底层机制**：① **自然语 ＞ 正向标签 ＞ 负向兜底**——「有什么」交给标签，「长什么样／放在哪／多大／和谁接触」这类关系与程度交给自然语；② **题材先验能压过标签**，判据是「画面主体是人还是物」；③ **名额有限**，单人 20–36 稳、超 ~50 显著稀释。

**五步流程**：定主体 → 写死易漂项（外观／物种部位／材质状态／尺度）→ 分名额（超了往自然语挪）→ 二选一与多出物件用负向解决 → 自然语钉死尺度／接触承重／空间关系／机位。

判据（一句话版）：

- **机位**：主体是人体本身（横陈占满画框）→ 别写机位词，只进自然语；主体是物件／环境 → 写 ≤2 条**同向**机位词。
- **手**：**默认要给**（不写泛词 `hands`，用具体动作：`outstretched arm`／`open hand`／`spread fingers`／`reaching towards viewer`；负向去掉 `hand focus`）；只有用户当轮点名"藏手"才省。**两只手都在画内时必崩一只** → 三招降风险：远侧半遮挡 / 远侧改简单形状 / 两只都靠近镜头；单手＋≲7% 画面高＋抓扁而宽有厚度的东西最稳。
- **同族多值**（发色／瞳色／部位）只留一个主值；**物种部位二选一用负向压对立项**（要龙尾就把 `fish tail, mermaid tail, fin` 挪进负向）。
- **尺度／接触／承重**：标签既没有刻度也没有「压在什么上」的语义，一律自然语写死。
- **同义标签别叠写**（`dumpster` ＋ `trash can` 会同框出现两个桶）；多余的用负向压。
- **`out of frame` 是真裁切**，不是「部分露出」——「人在容器里只露四肢」要用自然语写。
- **材质／浊度**：正向给「厚重／乳白／不透明」＋ 负向封反向（透明／稀薄／清水）＋ 自然语写程度；湿透写 soaked through，半透写 `see-through` 并压「全透」。
- **脸只押一头**（恐惧向 or 玩坏向），混押得到中间值。
- **会超额／会自长的词**（角类、发光类）降级或删掉，换小号词或只在自然语里说「小巧的」。
- **泛词换具体件**：衣服状态／饰品／鞋／颜色这类可数项，全落到具体名词。
- **共性落图规律**：写死的外观、材质质感、场景结构、实体道具稳落；「看不见的」内部解剖与插入细节、情绪玩坏眼系、机位群押不落。
- **不要「点名」不想出现的东西**：自然语里写「头在液面下」反而把头画到画面上——负面提及会激活该概念。要遮挡就正向给姿态标签（`face down`／`head down`／`in container`）＋负向压可见性线索（`looking at viewer`／`eye contact`），**不去描述被挡住的部位**。
- **删限制要补限制**：删掉 `out of frame` 这类限定标签时，必须用同向的另一条（姿态标签或负向）接住，否则模型按「展示角色」的先验把不想露的部位端出来；**接触关系只能给一套自洽方案**（矛盾描述 → 折中姿势，如横躺／悬空）。
- **藏部位用「结果类」标签**：要画面里没有某部位就写"画面里没有它"（`head out of frame`），别写它的姿态（`face down`／`head down` 压不住"露脸"先验）；再配负向 `looking at viewer`／`eye contact`／`face`。
- **接触与姿态由容器相对尺寸决定**：容器**比身体小**（`cramped`）→ 人被塞进去、四肢被迫弯在壁上；容器比身体大 → 平铺、头滑到沿上、腿直伸。要搭沿效果先把容器写小。
- **库外抽象词会被实体化**：不在词库的抽象概念（光尘、氛围颗粒）会被画成具体小物件（`dust motes` → 黄色蝴蝶贴片）；出串前用 `kb-audit --check` 换成库里词（`light particles`）。**库外的"关系与介质"（隔着玻璃、从屋内往外看）不用硬找标签，写进自然语就够**（实测：机位方向、谁在哪一侧、中间有什么，都能被完整表达）。
- **物种部位标签一律放大**：`fins`／`horns` 一类出的是放大版（巨型鳍耳／巨型角）；只要小特征就别写该标签，改在自然语里写尺寸。
- **总数压住**：单人 ≤40；要瘦**整行砍**，不逐条抠。

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
- **图像分支的默认档只加产物、不换召回档**：默认 = 自审开 + 窄召回。`reverseImageSpec()` 空 opts 的 `bare` 与 `{gaps:false}`、`{broad:false}` 逐字节相同（探针 `tests/spec-audit.probe.mjs` 锁住）；要宽召回必须显式 `--broad` / `{broad:true}`（样张两端同口径：窄召回 33 条 → 宽召回 41 条）。缺项摘要只走 stderr 与 md/json，不污染 stdout 的单行标签串；两个入口的 `bare` 都逐字节不受自审影响。
  **标签条数默认不封顶**：旧 CLI 默认输出 40 条、旧 API 默认 60 条，且都是在分层之前先切一刀，现已去掉（要封顶显式 `--top N`）。
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
| `BUILTIN_TIER_NAMES` | 内置回退档表（运行时档名来自面板配置，不再是硬编码）；`RATING_TAGS` 保留为指向同一冻结数组的 `@deprecated` 别名 | `safe → sensitive → nsfw`（旧名 `questionable` / `explicit` 已作废） |
| `NEG_BY_TIER` / `NEG_TOP_EXTRA` / `NEG_DROP_RULES` | 第 1–2 期面 2：按语义档位追加的压制词、顶档不打码纪律、误杀项删除规则；第 6 期补遗起，面板保存的 `negative.dropRules` 会在 `NEG_DROP_RULES` 之后叠加（只在该配置真来自文件时） | 见 `src/config.mjs` |
| `TIER_GATE` / `TIER_GATE_BIGS` / `TIER_GATE_ALLOW` | 第 1–2 期面 4：按画面可见度判级的词表（含永不被挡的环境词白名单） | 见 `src/config.mjs` |
| `FUNCTION_WORDS` | 英文虚词，用于切别名窗口 | 见文件 |
| `COUNT_GROUPS` / `CJK_DECOMPOSE` / `SHORT_ALIASES` | 规则补充层（`src/hints.mjs`）：口语人数、中文复合词拆分、常见中文短说法 | 见文件 |

## 依赖与边界

- 词库：`anima-tag-kb\画师类\`（`manifest.json` + `search-index.json`）。定位顺序：`--kb` 参数 → 环境变量 `ANIMA_KB_DIR` → 技能目录里的 `kb-path.json`（安装脚本写入）→ 仓库相对路径 → 用户主目录 → 当前目录，以目录里有没有 `manifest.json` 判定。
- 零依赖：只用 Node 内置模块（Node ≥ 18）。不联网、不下模型。
- 图像理解由多模态的我完成，脚本只吃结构化观察结果。
- 权重（第 7 期起从「不做建议」改成「默认给」）：混合形态的层行按 freq 档位配 `(tag:1.2)`，见上表；`--format tags` / `prompt` 的文本不带权重（`json` 每行另给 `weighted` 字段供面板渲染，面板显示的是 `--format json` 那条链路）。硬顶（6 / 每层 2）与「人数层裸标签」来自词库原话：人数标签权重过高会溢出角色、构图类建议不超过 2 个加权。权重只调存在感，**关系与几何仍只能写自然语**。权重**不设上限**：外部迁移一律照搬数值（`2.5::`→`(tag:2.5)`、`10::`→`(tag:10)`），高值只影响「谁抢到名额」，不影响语法。
- 库覆盖缺口（已知）：本词库里没有 `schoolgirl` / `high_school_girl` 这类通用「女高中生」标签，只有各校具体的校服标签，所以这类说法兜到 `girl`（不做硬凑）。详见 `README.md`。
