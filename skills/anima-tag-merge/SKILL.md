---
name: anima-tag-merge
description: 把两张或多张图的观察结果按自然语言指令融合成一条可直接使用的 Anima/Danbooru 标签串——「图1的姿势换到图2的人身上」「图1的场景替换到图2」「图1的形象微调成图2的某方面」「图1的姿势、图2的服装、画风照图3」都能听懂；支持成组换源（组合宏：上身特写 / 换头 / 人物全套 / 氛围感 / 场景光影 / 画风全套…）、按维度换源、子级优先、自动报跨源冲突（景别裁掉姿势、角色与外观撕开、场景与光位打架、画师没跟着画风换、有图没用上）。Use when 用户给两张以上图片并说「把这张的姿势用到那张」「场景换成另一张的」「两张图拼一下」「融合成一张」「这个人换上那个姿势」「背景换掉」「三张图各取一部分」；也用于把多份已有观察 JSON 按维度换源后出标签。复用 anima-tag-reverse 的 38k 词库与分层排序，零依赖 Node，默认输出一行逗号分隔的纯英文标签。不过滤内容：R18 / NSFL 照常融合，只把分级 token 写对。
whenToUse: 用户给两张以上图要「拼」成一张的出图标签；需要按维度跨图取用（姿势/场景/服装/发型/画风/光影各取一张）；需要成组换源（上身特写、氛围感、人物全套…）；已有两份以上结构化观察 JSON 要按指令换源；融合结果要先看来源与冲突再出标签。
user-invocable: true
---

# 多图融合（anima-tag-merge）

若干张图各出一份观察，用自然语言说「哪一块要哪张的」，输出一条能直接贴进提示词框的标签串。

本技能**不重复实现标签引擎**：词库索引、六道压制、分层排序、分级适配、缺项自审全部复用
`anima-tag-reverse`，这里只做三件它不做的事 —— **听懂跨图的自然语言**、**按维度换源**、**报跨源冲突**。

## 什么时候用它

- 「把图1的姿势换到图2的人身上」→ 图2 的人 + 图1 的姿势
- 「图1的场景替换成图2上」→ 图2 为底 + 图1 的场景
- 「图1的形象，但发型和瞳色用图2的」→ 图1 为底 + 图2 的发型瞳色
- 「图1的姿势，图2的服装，画风照图3」→ 三张图各取一块
- 「把图1的上身特写换给图2」→ 组合宏：姿势 + 表情 + 景别 + 视角一起换
- 用户贴几张图说「融一下」但没说细节 → 本技能会列出待确认项，我来追问
- 已经有多份观察 JSON（比如上一轮反推或上一轮融合存的），要按维度拼
- 观察 JSON 的 `characters` / `series` 写的是中文（「可莉」「原神」）→ 先过姊妹技能 `anima-tag-character` 的
  `patch` 换成规范标签，再接本技能（它带作品消歧，能排掉同名角色与残条目）

**不适用**：只有一张图（走 `anima-tag-reverse` 的图像分支）；每张图分别出标签（各跑一次 rtag）。

## 输出契约（与原技能一致）

| 要求 | 做法 |
| --- | --- |
| 单行文本 | 默认 stdout 就是一行，无换行、无前后缀、无 Markdown |
| 逗号分隔的纯标签 | `标签1, 标签2, 标签3` |
| 默认不带官方前缀 | 要带用 `--format prompt` |
| 提示不污染交付物 | 换源摘要、冲突、歧义、缺项全部走 **stderr** |
| 不做内容审查 | R18 / NSFL 元素一个标签都不删，只把分级 token 写对 |

## 三步流水线（本技能的实现结构）

| 步骤 | 文件 | 职责 |
| --- | --- | --- |
| ① 听懂指令 | `src/dims.mjs`、`src/refs.mjs`、`src/intent.mjs` | 维度槽位表（组级 + 子级）、组合宏（PRESETS）、图指代解析（图1/图3/前一张/左图/原图，最多 6 张）、宿主证据、方向判定、歧义与未识别片段 |
| ② 合并观察 | `src/merge.mjs` | 底图保骨架、点名维度整组换源、子级覆盖组级、空源告警、负向并集、溯源表、跨源冲突检测 |
| ③ 出标签 | `src/engine.mjs` + `anima-tag-reverse/src/*` | 合并后的观察直接喂原引擎的 `reverseImageSpec()`，排序与分级行为与原技能逐字节一致 |

## 标准流程（我执行）

1. **看图，各写一份观察 JSON**（结构见 `rtag.mjs --template`，必填维度一篇不落）。
   - **顺序约定：先给的那张 = 图1 = `--img` 的第一个**；口头说的「图2/图3」按这个顺序数。
   - 顺序与用户口头说法相反时用 `--swap`（**整体反转**：口头的第 k 张 = 文件里的第 N+1-k 张），不要改文件。
   - 存盘：`a.json` / `b.json` / `c.json`，放临时目录即可。
2. **先看指令怎么解析的**（秒出，不碰词库）：
   ```bash
   node bin/merge.mjs --img a.json --img b.json --img c.json "图1的姿势，图2的服装，画风照图3" --format explain
   ```
   - 退出码 **3** = 有歧义待确认；**0** = 解析确定。
   - 看「底图判定」「换源表」「命中的组合宏」是否与用户意图一致；不一致就用 `--base` / `--map` / `--preset` 纠正，或问用户。
3. **有歧义就问用户**（见下面「歧义处理」），别猜。用户答完，用 `--map` / `--preset` 或重写指令重跑。
4. **出标签**：默认档直接跑，拿单行标签串。
5. **把冲突与缺项告诉用户**：stderr 里的 `[warn]` 一定要转述（景别裁掉姿势、角色与外观撕开这类问题不修就白跑）；
   `[info]` 里最容易漏的两条是 `unused-image`（有图白给了）与 `style-vs-artists`（画师没跟着画风换）。

## 自然语言支持哪些说法（实测样例）

| 用户说法 | 底图 | 结果 |
| --- | --- | --- |
| 把图1的姿势换到图2的人身上 | 图2 | `pose` ← 图1 |
| 图1的场景替换成图2上 | 图2 | `scene` ← 图1（「图2上」是落点，不是来源） |
| 图1的形象，但发型和瞳色用图2的 | 图1 | `appearance` ← 图1；`appearance.hair_style`、`appearance.eyes` ← 图2 |
| 图2的形象，姿势和图1一样 | 图2 | `appearance` ← 图2；`pose` ← 图1 |
| 把图1的上身特写换给图2 | 图2 | 组合宏：`pose` + `appearance.expression` + `style.framing` + `style.camera` ← 图1 |
| 图1的姿势，图2的服装，画风照图3 | 图3 | `pose`←图1、`outfit`←图2、`style`←图3（三张图） |
| 图3的姿势换到图1的人身上 | 图1 | `pose` ← 图3 |
| 把图2的姿势和场景都用上，底图是图1 | 图1 | `pose`、`scene` ← 图2 |
| 画风照图1，其余按图2 | 图2 | `style`（整组）← 图1 |
| 整体照图1 | 图1 | 不逐维度换源，整张以图1为底 |
| 背景用图2的，人物保持图1 | 图1 | `scene` ← 图2 |
| 用图1的衣服，脸还是图2的 | 图2 | `outfit` ← 图1 |
| 图1的形象微调成图2的某方面 | 图1 | **歧义**：没说改哪方面 → 追问 |
| 把两张图融合一下 | 最后一张 | **歧义**：没识别出维度 → 列维度/组合宏让用户挑 |

指代写法都认：`图1 / 图片2 / 第一张 / 第二张 / 前一张 / 后一张 / 上图 / 下图 / 左图 / 右图 / 图A / 图B / 图C / 原图 / 参考图`
（`后一张 / 下图 / 右图 / 参考图` 在 N 张图时指**最后一张**）。

## 组合宏：一次点名一组维度

用户嘴里常说的是**成组**的词，不是单个维度。组合宏把它们打包，展开成普通换源指令，后续流程完全一致。

| 组合 | 也可以说 | 覆盖的槽位 |
| --- | --- | --- |
| 上身特写 | 上半身 / 上身部分 / 半身像 / 胸像 | `pose` + `appearance.expression` + `style.framing` + `style.camera` |
| 换头 | 头部特写 / 脸和头发 / 头发和眼睛 / 五官 | `appearance`（整组） |
| 全身像 | 全身照 / 整个身体 / 全身造型 | `pose.action` + `pose.legs` + `outfit.legwear` + `outfit.footwear` + `style.framing` |
| 整套服装 | 全套装扮 / 服装全套 / 整套穿搭 | `outfit`（整组） |
| 人物全套 | 整个角色 / 角色整体 / 整个人设 | `appearance` + `outfit` + `pose` |
| 姿势表情 | 动作表情 / 姿势和表情 | `pose` + `appearance.expression` |
| 场景光影 | 环境光影 / 场景打光 / 环境光线 | `scene` + `style.lighting` + `style.light_direction` |
| 构图取景 | 取景构图 / 镜头构图 / 机位构图 | `style.framing` + `style.composition` + `style.camera` |
| 色调氛围 | 氛围感 / 整体氛围 / 画面氛围 | `style.palette` + `style.lighting` + `style.light_direction` + `style.quality` |
| 画风全套 | 整体画风 / 全套画风 | `style` + **`artists`**（画师是独立槽位，只有「全套」才连带） |

三种用法等价：

```bash
node bin/merge.mjs --img a.json --img b.json "把图1的上身特写换给图2"          # 自然语言
node bin/merge.mjs --img a.json --img b.json --preset 上身特写=1 --base 2      # 显式参数
node bin/merge.mjs --img a.json --img b.json --map "上身特写=1" --base 2       # --map 里也能写组合宏
```

`--preset` 不写编号时：**两张图自动取「底图之外的那张」**；三张以上必须写编号（有歧义就报错，不猜）。
`--presets` 打印完整清单，`--dims` 打印单维度清单。

**命名纪律**：组合宏的别名不能是某个具体维度的取值或短别名。反例：`全身`（会和「景别改成全身」打架）、
`上衣`（是 `outfit.top` 的别名）。所以只收「全身像 / 全身照」这类明显是**成组**的说法。

## 三张以上 & 链式融合

```bash
# N 图原生支持（最多 6 张，--img 出现顺序即图1/图2/图3…，--a/--b/--c/--d 是等价简写）
node bin/merge.mjs --img a.json --img b.json --img c.json "图1的姿势，图2的服装，画风照图3"
node bin/merge.mjs --img a.json --img b.json --img c.json --map "pose=1,outfit=2,style=3" --base 3

# 链式：两两融合，中间结果当成下一轮的一张图（适合"先定人再定景"的分步确认）
node bin/merge.mjs --img a.json --img b.json "把图1的姿势换到图2的人身上" --format spec --out mid.json
node bin/merge.mjs --img mid.json --img c.json "图2的画风全套套到图1上"
```

多图下的约定：

| 规则 | 说明 |
| --- | --- |
| 默认底图 | 口头上**最后一张**（`--swap` 时跟着翻成第一张） |
| 中间编号 | 只认显式写法（`图3` / `第三张` / `图C`）；`后一张 / 下图 / 参考图` = 最后一张 |
| 每张图的分工 | 没说到的图完全不参与，结果里不会有它的任何字段 |
| 白给的图 | 三张以上时若有图完全没被用到，报 `unused-image`（info）提醒 |
| 中间结果 | 合并后的观察是标准 spec，可 `--format spec` 存盘，当下一轮的输入，或喂 `rtag.mjs --image-spec` 复核 |

## 底图（宿主）怎么定

底图 = **被修改的那一方**：底图保留它没被点名的所有维度，点名的那几块被别人替换。

判定顺序（前面的赢）：

| 优先级 | 依据 | 例 |
| --- | --- | --- |
| 1 | `--base` 显式指定 | `--base 3` |
| 2 | 「底图是图N / 以图N为基础 / 主体 / 底子」 | 底图是图1 |
| 3 | 落点动词：`放到 / 换到 / 换给 / 套到 / 移到 / 转到 / 用在 / 装到` + 图N | 把图1的姿势**换到图2** |
| 4 | 「图N的人 / 人物 / 主体 / 角色 / 身上 / 身体 / 图N上」 | **图2的人**身上 |
| 5 | 组级外观/角色一致指向同一张图 | 图1的形象… → 图1为底 |
| 6 | 兜底：口头上最后一张 | 写在 assumptions 里明示 |

**第 5 条的细节**：只认**组级**（`appearance` / `characters`）的一致指向；组级没出现时，要求**同一组两条以上子级**
指向同一张图才认。单条子级太弱 —— 「上身特写」这类组合宏会顺带展开出 `appearance.expression`，
拿它定宿主会把底图判错。

低/中置信的判定会写进 `intent.assumptions`，我在回答里要**明说**「我按图2为底理解」，让用户有机会纠正。

## 歧义处理（我执行，与原技能的「多选补全」同一套路）

`--format explain` / API 的 `intent.ambiguous` 会给结构化待确认项，每项带 `code`、`message`、`options`：

| code | 含义 | 我该做什么 |
| --- | --- | --- |
| `no-dim` | 没识别出要搬哪一块 | 列出维度与组合宏让用户选，或确认「整张以图X为底」 |
| `unspecified-dim` | 说了「某个方面」但没说哪儿 | 列出候选维度/组合宏让用户勾 |
| `missing-ref` | 提到维度但没说取自哪张 | 问「取自图1还是图2/图3」 |
| `dim-conflict` | 同一维度被指向两张图 | 按 `options` 让用户二选一（默认取后出现的） |

另外 `intent.unknown` 是**没听懂的片段**（如「更可爱一点」）。两种处理：
1. 追问用户具体想改什么；
2. 转成标签后用 `--extra "..."` 追加，例如 `--extra "detailed hair"`，它会作为额外分句参与匹配（写进 `spec.extra`）。

用户明确跳过的项记下来，别反复问。

## 跑法（CLI）

技能根目录：本文件（`SKILL.md`）所在目录。命令都在技能根目录里跑：

```bash
cd <技能根目录>

node bin/merge.mjs --img a.json --img b.json "把图1的姿势换到图2的人身上"       # 默认：单行纯标签（提示走 stderr）
node bin/merge.mjs --img a.json --img b.json --img c.json "图1的姿势，图2的服装，画风照图3"
node bin/merge.mjs --img a.json --img b.json "图1的场景替换成图2上" --format prompt
node bin/merge.mjs --img a.json --img b.json "把图1的上身特写换给图2" --format explain
node bin/merge.mjs --img a.json --img b.json "…" --preset 氛围感 --base 2
node bin/merge.mjs --img a.json --img b.json "…" --format md              # 人读报告：换源表 + 溯源表 + 冲突 + 缺项
node bin/merge.mjs --img a.json --img b.json "…" --format spec            # 合并后的观察 JSON（可当下一轮的图）
node bin/merge.mjs --img a.json --img b.json "…" --format json            # 给程序用的结构化结果
node bin/merge.mjs --img a.json --img b.json "…" --format check           # 标签 + 英文自然语言 + 缺项
node bin/merge.mjs --img a.json --img b.json --map "pose=1,scene=2" --base 2
node bin/merge.mjs --img a.json --img b.json "图1的姿势" --swap             # 「图1」其实指最后一张
node bin/merge.mjs --img a.json --img b.json "…" --extra "detailed hair"  # 追加描述（可重复）
node bin/merge.mjs --dims / --presets / --template

node tests/smoke.mjs        # 离线自测：解析与合并（110 项断言，毫秒级）
node tests/e2e.probe.mjs    # 端到端探针：CLI 契约 + 真词库（65 项断言）
```

`--img` / `--a` 等既能吃文件路径也能吃内联 JSON。

## 会话内调用（我直接用）

```js
import { parseFusionIntent, mergeSpecs, fuse, parseDimMap, applyPresets } from '<技能目录>/src/index.mjs';

// ① 只解析指令（不加载词库，可以反复试）
const it = parseFusionIntent('图1的姿势，图2的服装，画风照图3', { count: 3 });
it.base;        // 3 —— 宿主（没明确时默认最后一张）
it.count;       // 3
it.sources;     // [{ path:'pose', side:1, label:'姿势 / 动作', isGroup:true, confidence:'high', … }, …]
it.presets;     // [{ id:'bust', label:'上身特写', alias:'上身特写', slots:[…] }]
it.assumptions; // ['宿主判定：…']
it.ambiguous;   // [{ code, message, options:[{label,value}] }] —— 拿去问用户
it.unknown;     // [{ text:'更可爱一点' }] —— 没听懂的片段

// ② 只合并观察（纯函数，离线可测）
const m = mergeSpecs({ images: [specA, specB, specC], intent: it });
m.spec;         // 合并后的观察 JSON（可直接喂 reverseImageSpec / rtag.mjs --image-spec）
m.base;         // 3
m.applied;      // 实际生效的换源（含「与宿主同源，按宿主写回」）
m.emptySources; // 源里那一块是空的 —— 必须补观察
m.conflicts;    // [{ severity:'warn'|'info', code, message }]
m.provenance;   // [{ path:'appearance.hair', side:2 }] 每个字段来自哪张图

// ③ 一站式出标签
const r = await fuse({ images: [specA, specB, specC], instruction: '图1的姿势，画风照图3' });
r.tags;         // 单行纯标签串        ← 默认交付形态
r.prompt;       // 带官方前缀
r.rating;       // safe | explicit | …
r.negative;     // 负向串（所有图并集）
r.conflicts;    // 跨源提示（务必转述给用户）
r.specIssues;   // 合并后观察仍缺的必填维度
r.report();     // markdown 报告
// opts: { images:[…] 或 a/b/c/d, instruction, map:'pose=1', presets:['上身特写=1'], base:2,
//         swap:true, extra:['detailed hair'], broad:true, nl:true, engineDir }

// 单独用的小工具
parseDimMap('pose=1,上身特写=2');       // 显式换源表（组合宏会展开）
applyPresets(intent, ['氛围感'], 2);    // 把组合宏并进已解析的意图
normalizeSideArg('图3');               // → 3
```

## 可搬运维度（组级 → 子级）

组级换源 = 整个子树替换（不清空会出现多张图混在一起的鬼影场景）；子级更具体、永远赢。

| 组 | 子级 |
| --- | --- |
| `subject` 人数/性别 | —— |
| `characters` 角色身份 | —— |
| `series` 作品 | —— |
| `appearance` 人物外观 | `hair` `hair_style` `eyes` `expression` `body` `skin` `special` |
| `outfit` 服装 | `top` `bottom` `dress` `legwear` `footwear` `headwear` `accessories` `held` |
| `pose` 姿势 | `action` `hands` `legs` `facing` |
| `scene` 场景 | `location` `time` `weather` `props` |
| `style` 画风/画面 | `medium` `artist_style` `lighting` `light_direction` `camera` `framing` `composition` `palette` `quality` |
| `artists` 画师 | ——（**不在 style 组里**，画风换源不会自动带上，见 `style-vs-artists`） |
| `nsfw` 分级 | —— |
| `negative` 排除项 | 所有图并集，不参与换源 |

完整别名表跑 `node bin/merge.mjs --dims`，组合宏跑 `--presets`。`--map` 里写中文别名（`姿势=1`）、
路径（`pose.action=1`）或组合宏（`上身特写=1`）都行。

## 输出长什么样

```bash
$ node bin/merge.mjs --img a.json --img b.json "把图1的姿势换到图2的人身上"
1girl, solo, smile, short hair, black hair, brown eyes, profile, very short hair, light, sitting, pleated skirt, loafers, holding book, sailor shirt, kneehighs, shirt, holding, skirt, bag, shorts, white socks, white kneehighs, upper body, lights, clear sky, street, warm colors, day, petite, anime screenshot, hard light
# stderr:
# [融合] 图片 2 张｜底图=图2｜换源 1 项｜指令：把图1的姿势换到图2的人身上
#   - 姿势 / 动作(pose) ← 图1
#   [warn] 景别是「upper body」（来自图2），而要搬过来的姿势是「sitting」（来自图1）：…
# [缺项自审] 缺口 5 条：unmatched 1 · granularity 4
```

注意 `sitting` 进来了（图1的姿势）、`standing` 没了、`sailor shirt` 留着（图2的人）。

## 跨源冲突检测（只报能证明的矛盾）

| code | 严重度 | 触发条件 | 为什么要提醒 |
| --- | --- | --- | --- |
| `empty-source` | warn | 点名换源的维度在源图里是空的 | 用户以为换过来了，其实没有 —— 最常见的翻车点 |
| `framing-vs-pose` | warn | 景别是特写/半身，而搬来的姿势是坐/躺/跪 | 姿势会被裁掉，白跑 |
| `char-vs-appearance` | warn | 角色名来自一张、外观来自另一张 | 模型会把「角色名 + 另一套外观」当冲突概念 |
| `scene-vs-light` | info | 场景与光位不同源 | 夜晚场景配白天顺光会打架 |
| `style-vs-artists` | info | 画风整组换源了，但画师标签没跟着换 | Danbooru 上画风的主要载体恰恰是 `@画师`，不换等于白换一半；要连带用「画风全套」 |
| `unused-image` | info | 三张以上时有图完全没被用到 | 有图白给了，通常是指令漏了一条 |
| `multi-subject-pose` | info | 多人画面 + 单人姿势换源 | 标签会偏向「整体动作」 |
| `rating-raised` | info | 源图带 R18 标记 | 分级会自动升级 |
| `style-vs-scene` | info | 画风/光影换源但场景没换 | 色调与光比需要人工确认 |

## 关键设计（改代码前先读）

- **图编号内部是数字 1..N**（不是 a/b）：`a/b/c` 只是输入别名，显示统一成「图N」。两张图的历史行为
  在 N=2 时逐条保留（「后一张/下图/参考图」落到最后一张）。
- **`--swap` 是整体反转**：交换的是「口头顺序 ↔ 文件顺序」，所以口头的第 k 张 = 文件里的第 N+1-k 张，
  连默认底图一起翻。
- **维度别名只收两个字以上**：单字（`脸` `手` `腿` `人`）在中文里误命中率极高 ——「侧脸」是表情的**值**、
  「手里拿着伞」是动作描述。一旦把值当维度词，整组槽位会被错误换源，而且错得没有任何提示。
- **「人 / 身上 / 主体」不是维度词，是宿主证据**：否则「图1的姿势放到图2的人身上」会把 `subject`（人数）也判给图2。
  宿主证据命中的区间会在维度匹配前被占掉（`intent.mjs` 的 `overlaps` 过滤）。
- **`图N上` 里的图是落点不是来源**：`图1的场景替换成图2上` 必须是 `scene ← 图1` + 底图 = 图2。
  源动词（换成/改成/用/参考）的宾语后面若跟 `上/身上/里`，一律不当来源。
- **并列维度共享宾语**：`发型和瞳色都用图2的` —— 在维度右侧一小段窗口里找「源动词 + 图指代」，
  允许中间夹着别的维度词与连接词，但窗口里若已出现另一个图指代就放弃（那多半属于后一句）。
- **组合宏展开成普通槽位**，不引入第二套语义；命中区间会被维度匹配排除，避免同一位置算两次。
  别名避开具体维度的取值（`全身` 之类一律不收）。
- **宿主兜底只认组级外观、或≥2 条同组子级**：组合宏会顺带展开出 `appearance.expression`，
  单条子级定宿主会把底图判错（实测踩过）。
- **与宿主同源的维度也要写回**（`merge.mjs`）：组级换源会把宿主那一整棵子树覆盖掉，
  若子级（`appearance.hair_style` ← 宿主）被当成「无需搬运」跳过，宿主原本的发型就丢了。
  写回同一个值代价为零，能保证「子级永远赢」。
- **溯源表取最具体的匹配**：`appearance` 与 `appearance.eyes` 同时存在时，更长的路径赢；
  否则整组换源会盖掉子级换源的真相，报告就成了假的。
- **组级换源必须清空原组**：只逐字段覆盖会在 `scene` 里留下上一条的 `location`，出图时多张图的场景会混在一起。
- **`artists` 不属于 `style` 组**：这是刻意的 —— 只想换色调的人不该被动换掉画师。要连带就用「画风全套」，
  并且在 `style-vs-artists` 里明确提示。
- **默认输出与提示分离**：单行标签是交付物，其余全部 stderr —— 和 `rtag.mjs` 同一条纪律。

## 安装 / 启用

```bash
node tools/install-dsh-skill.mjs          # 同步到 ~/.dsh/skills/anima-tag-merge 并写 engine-path.json
node tools/install-dsh-skill.mjs --check  # 只检查是否已最新
```

装好后在「技能中心」面板点开关即可（读 SKILL.md frontmatter 的 `disable-model-invocation`，模型目录热刷新）。
源码改完要再跑一次安装脚本才会同步；脚本会先备份到 `~/.dsh/skill-backups/`（刻意放在技能根目录外，
避免加载器把副本当成第二个同名技能）。

## 依赖与边界

- **引擎依赖**：`anima-tag-reverse`（词库 + 匹配 + 排序 + 缺项自审）。定位顺序：
  `--engine` / 环境变量 `ANIMA_TAG_REVERSE_DIR` / 本技能目录的 `engine-path.json` /
  兄弟目录 `../anima-tag-reverse` / `~/.dsh/skills/anima-tag-reverse`。找不到会明确报错并列出已尝试的路径。
- **零依赖**：只用 Node 内置模块（Node ≥ 18），不联网、不下模型。
- **图像理解由多模态的我完成**：脚本只吃结构化观察结果，不看图。
- **最多 6 张图**：再多请分轮（链式见上文）。
- **不做权重建议**：输出标签与顺序，权重交给用户/模型卡。
- **不生成图片**：本技能只产出标签串，不负责出图。
