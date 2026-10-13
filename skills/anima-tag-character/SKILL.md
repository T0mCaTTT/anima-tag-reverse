---
name: anima-tag-character
description: 把「具体作品 + 具体角色名」翻成精确的 Danbooru 角色标签与作品标签——「原神 可莉」「《葬送的芙莉莲》的芙莉莲」「星野（少女与战车）」「klee (genshin impact)」都认，中文名直接可用；带作品消歧（同一个「星野」在蔚蓝档案和少女与战车里是两个角色，会照着作品选对并排除另一个）、给未命中如实说「库里没有」而不是凑一个相近的、自带 5713 角色 / 1098 作品的本地词库，零网络。Use when 用户问「XX 作品里的 YY 用什么 tag」「这个角色怎么打标签」「帮我加角色 tag」「给我作品名和角色名」；也用于把观察 JSON 里的中文角色名/作品名就地修正成规范标签（与 anima-tag-reverse / anima-tag-merge 串联）；还用于列出某作品下有哪些角色让你挑。不过滤内容：R18 / NSFL 角色照常解析，不说教、不打码。
whenToUse: 用户给出作品名 + 角色名要标签；同一个角色名跨多个作品需要消歧；需要某作品下的角色清单来挑；观察 JSON 里的 characters / series 字段写的是中文或不确定写法，要先修正再出标签；校验一个英文/罗马音角色标签是否存在、属于哪个作品。
user-invocable: true
---

# 角色 / 作品标签解析（anima-tag-character）

「原神 可莉」→ `klee (genshin impact), genshin impact`。一行交付，可直接贴进提示词框。

## 什么时候用它

- 「原神里可莉用什么 tag」→ 直接给角色 + 作品标签
- 「星野」但你知道他要的是《少女与战车》那个 → 用作品约束选对，并列出被排除的另一个
- 「这个角色库里有吗」→ `verify`，顺带告诉你它的作品归属
- 「原神都有哪些角色」→ `series`，列出 121 个让你挑
- 观察 JSON 里 `characters: ["可莉"]`、`series: ["原神"]` → `patch` 就地换成规范标签，再喂给
  `anima-tag-reverse` / `anima-tag-merge`（**这是与那两个技能串联的推荐姿势**）

**不适用**：用户只给一张图让你认角色（本技能不看图，也不做图像识别）；纯文字画面描述出标签（走 `anima-tag-reverse`）。

## 输出契约（与另两个技能一致）

| 要求 | 做法 |
| --- | --- |
| 单行纯标签 | 默认 stdout 一行，`角色 tag, 作品 tag`，无换行无前后缀 |
| 提示走 stderr | 候选、被排除的同名角色、覆盖警告全部 stderr |
| 空格代替下划线 | 交付形态统一 `hakurei reimu`（词库原始写法在 `rawTag` 里） |
| 括号不转义 | `klee (genshin impact)` 原样输出 |
| 要两个还是一个 | 默认角色 + 作品都给（官方槽位里这是两层）；`--no-series` 只留角色 |
| 不做内容审查 | R18 / NSFL 角色照常解析 |

**退出码是有语义的**（我据此决定要不要追问用户）：

| 码 | 含义 | 我该做什么 |
| --- | --- | --- |
| 0 | 高置信（≥ `--min-score`，默认 0.85），或唯一主候选的部分匹配 | 直接用 |
| 3 | 需要确认（多候选、低置信、或**你指定的作品没解析出来**） | 把候选项列给用户挑 |
| 4 | 词库里没有这个角色 / 作品 | 如实说「库里没有」，见下面「冷门角色」 |
| 2 | 参数错 | 修命令 |

## 标准流程（我执行）

1. **先按用户原话跑一次**，别急着翻译：
   ```bash
   node bin/char.mjs "可莉" -s "原神"
   ```
   - 中文作品名优先试（本技能内置 149 条常见作品中文别名：少女与战车 / 赛马娘 / 蓝色档案 / 咒术回战…）。
   - 看退出码：0 就用；3 就按 stderr 的候选追问；4 走下一步。
2. **作品名解析不出来时，翻译再试**：词库的 1098 个作品里只有 55 个自带中文名，
   别名表覆盖了常见的那批，剩下的要英文/罗马音：
   ```bash
   node bin/char.mjs "星野" -s "girls und panzer"     # 中文「少女与战车」其实也行（别名表里有）
   node bin/char.mjs "鹿目圆" -s "mahou shoujo madoka magica"
   ```
   拿不准作品英文名 → `node bin/char.mjs search <关键词>` 先找作品标签。
3. **冷门角色（退出码 4）**：库里没有不代表标签不存在（词库只收 5713 条精选，Danbooru 有十万级）。
   这时**由我给候选**（我凭世界知识写罗马音或英文标签），再用 `verify` 让工具确认：
   ```bash
   node bin/char.mjs verify "chise (princess connect!)"   # → 校验是否存在、属于哪个作品
   ```
   校验通过就直接用；不通过就如实告诉用户「这个词库覆盖不到，我给你拼写但没法验证」。
   **绝不用一个相近标签凑数** —— `--format md` 的候选里那些是「像」，不是「是」。
4. **要观察 JSON 时走 patch**（与另两个技能串联）：
   ```bash
   node bin/char.mjs patch 观察.json --out 修正.json     # characters/series 就地换规范标签
   node <anima-tag-reverse>/bin/rtag.mjs --image-spec 修正.json
   ```

## 消歧是怎么做的（核心机制）

同名角色靠**作品归属**分开，归属来自三条路径（词库整理时就算好了）：

| 路径 | 例 | 覆盖 |
| --- | --- | --- |
| 词库 `slot` 字段 | `hu tao (genshin impact)` → `genshin impact` | 1402 条，最准 |
| 标签尾部括号（**且括号能在作品表里查到**） | `hoshino (girls und panzer)` ✓ / `hakurei reimu (pc-98)` ✗（那是形态） | 3140 条 |
| 中文名尾部括号 | `老师（蔚蓝档案）` | 少量 |

消歧规则：用户给了作品 → 归属对上的 **+0.4**；归属明确对不上的 **直接排除**（并进报告，让你看见）；
无归属的条目放行但降权。实测：

```
星野 -s 少女与战车  →  hoshino (girls und panzer), girls und panzer
星野 -s 蔚蓝档案    →  hoshino (blue archive), blue archive
空   -s 原神        →  aether (genshin impact), genshin impact
空   -s 蔚蓝档案    →  sora (blue archive), blue archive
```

另外有两类「看着像但不是」的条目会被压下去，否则它们会抢走正确答案：

- **残条目**：`hutao`、`marin kitagawa`、`anya` 这类 freq=0 且无作品归属的别名式条目，
  中文名和正规条目一模一样（都叫「胡桃」）。判据是**无归属降权 + 频次对数加成**，实测
  「胡桃」→ `hu tao (genshin impact)`、「喜多川海梦」→ `kitagawa marin`、「阿尼亚」→ `anya (spy x family)`。
- **异体/形态标签**：`hakurei reimu (cosplay)`、`hatsune miku (append)` 这类，降权 0.16，
  并在报告里标 ⚠。

## 命令速查

```bash
cd <技能根目录>

node bin/char.mjs 可莉 -s 原神                      # → klee (genshin impact), genshin impact
node bin/char.mjs "《原神》的可莉"                   # 书名号 + 「的」也认
node bin/char.mjs "原神的可莉"                       # 无书名号也认
node bin/char.mjs "klee (genshin impact)"           # 英文写法
node bin/char.mjs 可莉 -s 原神 --no-series           # 只要角色标签
node bin/char.mjs 胡桃 -s 原神 --format md           # 消歧报告（含被排除的同名角色）
node bin/char.mjs 可莉 -s 原神 --format json         # 给程序用
node bin/char.mjs series 原神 --limit 30            # 该作品下的角色清单（让你挑）
node bin/char.mjs search 灵梦                        # 通用检索（角色 + 作品）
node bin/char.mjs verify "hakurei reimu"            # 校验候选标签
node bin/char.mjs patch 观察.json --out 修正.json    # 修正观察 JSON 的角色/作品字段
node bin/char.mjs patch 观察.json --dry-run          # 只看会改什么
node bin/char.mjs --info                            # 词库覆盖概况

node tests/smoke.mjs        # 离线自测（64 项断言）
node tests/e2e.probe.mjs    # 端到端 CLI 契约（44 项断言）
```

## 会话内调用（我直接用）

```js
import { loadKb, resolveCharacter, resolveSeries, charactersOf, verifyTag, searchNames, patchSpec, buildPair, toTag } from '<技能目录>/src/index.mjs';

const kb = loadKb();                       // 进程内缓存，加载一次即可

const r = resolveCharacter('星野', { kb, series: '少女与战车' });
r.best;      // { tag:'hoshino (girls und panzer)', rawTag:'hoshino_(girls_und_panzer)', series:'girls und panzer',
             //   seriesVia:'tag 括号', score:0.97, why:['中文主名精确命中','作品归属匹配',…] }
r.rejected;  // [{ tag:'hoshino (blue archive)', series:'blue archive' }] —— 被作品约束排除掉的
r.notes;     // 人读说明（未命中、作品查不到、别名近似…）
r.seriesFailed;  // true = 用户指定的作品没解析出来，这次结果没做消歧

buildPair('可莉', { kb, series: '原神' });
// { ok:true, tags:'klee (genshin impact), genshin impact', series:'genshin impact', score:0.98 }

verifyTag('hakurei reimu', { kb });        // { found, kind, tag, zh, series, variant, hasSeriesInTag, near }
charactersOf('原神', { kb, limit: 40 });    // { series, total, characters:[…] }
searchNames('灵梦', { kb, kind: 'any' });   // [{ tag, zh, kind, series, score }]
resolveSeries('少女与战车', { kb });        // { best, candidates }

patchSpec(spec, { kb, confidence: 0.85 }); // { spec, changes, unresolved, notes }
// 置信度不足的条目**原样保留**并进 unresolved，不做「大概是这个」的替换

toTag('hoshino_(girls_und_panzer)');       // 'hoshino (girls und panzer)' —— 交付形态
```

## 数据与覆盖（诚实说明）

| 项 | 数量 | 说明 |
| --- | --- | --- |
| 角色条目 | 5713 | 词库「角色 · 精选」；Danbooru 实际有十万级 |
| 角色带中文名 | 5559 | 中文名直接可用是这套东西最大的便利 |
| **能归到具体作品的角色** | 2564 | 消歧能力的天花板在这里 |
| 作品条目 | 1098 | 其中只有 55 条自带中文名 |
| 作品中文别名（人工策划） | 149 条生效 / 44 条因词库没该作品而丢弃 | 见 `src/series-zh.mjs`，逐条用词库校验，不编造 |
| 可检索名称（含别名） | 见 `--info` | 倒排索引，含主名/中文/别名/baseKey 四种写法 |

**冷门角色就是查不到**，这是数据边界不是 bug：如实说「库里没有」，由我给候选 + `verify` 校验。
作品名同理：中文名不在别名表里时让用户给英文，或 `search` 找到后再用。

## 关键设计（改代码前先读）

- **`series-zh.mjs` 的表逐条校验**：表里写的英文作品必须在词库里存在，加载时对不上就丢弃
  （44 条被丢是因为词库确实没有那个作品，如「绝区零」）。好处是词库升级后自动生效、永不带脏映射。
- **打分只用可解释信号**：命中方式（精确/主名/中文/别名/前缀/包含）、是否异体、名称长度、
  作品归属、频次。每条候选都带 `why`，报告里能一眼看出为什么推荐它。
- **长度惩罚按主名算**：用整个标签长度会误伤 `hu tao (genshin impact)`（主名很短、带作品括号），
  实测它会被 `hutao` 这种残条目压过去。
- **频次加成必须有区分度**：早期版本封顶 0.1 且低端截断，14.6k 与 0 频次拿到同样加成，
  于是 `hutao`（freq=0）和 `hu tao (genshin impact)`（14.6k）打平。现在用
  `clamp((log10(freq+10)-2.5)/3.5,0,1) * 0.14`。
- **单字名要能召回**：`空`/`樱` 这类单字中文名，包含匹配要求长度≥2 会跳过，
  所以倒排索引必须登记 `baseKey`（`空 (原神)` → `空`），否则「空 -s 原神」查不到（实测踩过）。
- **显式指定作品却查不到 → 不静默降级**：这时的结果没有作品约束，很可能选错，
  所以 `seriesFailed` 置位、退出码 3、stderr 明确警告。
- **未命中不硬凑**：`best=null`、stdout 为空、退出码 4。宁可让会话里的我补候选，
  也不给一个「长得像」的标签 —— 用错角色标签比缺一个严重得多。
- **API 返回交付形态**：`tag` 是 `toTag()` 之后的形式（空格代替下划线），`rawTag` 才是词库原文。
  这样 patch 写进观察 JSON 的天然符合 Anima 规范。

## 安装 / 启用

```bash
node tools/install-dsh-skill.mjs          # 同步到 ~/.dsh/skills/anima-tag-character 并写 engine-path.json
node tools/install-dsh-skill.mjs --check  # 只检查是否已最新
```

装好后在「技能中心」面板点开关即可。源码改完要再跑一次同步脚本（会先备份到 `~/.dsh/skill-backups/`）。

## 依赖与边界

- **词库依赖**：`anima-tag-kb`（由 `anima-tag-reverse` 的 `kb-path.json` 定位）。
  定位顺序：`--kb` → 环境变量 `ANIMA_KB_DIR` → 本技能 `kb-path.json` → 兄弟技能 `anima-tag-reverse`
  的 `kb-path.json` → 常见路径。找不到会列出所有尝试过的路径。
- **零依赖、零网络**：只用 Node 内置模块（Node ≥ 18），不调用 Danbooru API，不需要登录。
- **不做图像识别**：看图认角色由多模态的我完成，本技能负责「名字 → 精确标签」。
- **不保证 Danbooru 全量**：只保证词库里有的 5713 个角色；库外的靠我给候选 + `verify`。
