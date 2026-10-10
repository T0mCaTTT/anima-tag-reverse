# anima-tag-merge —— 多图融合 → 可直接使用的标签

把两张或多张图的观察结果按自然语言指令拼成一条能直接贴进 Anima / Danbooru 提示词框的标签串。

```
把图1的姿势换到图2的人身上       →  图2 的人 + 图1 的姿势
图1的场景替换成图2上             →  图2 为底 + 图1 的场景
图1的形象，但发型和瞳色用图2的    →  图1 为底 + 图2 的发型瞳色
把图1的上身特写换给图2           →  组合宏：姿势+表情+景别+视角 一起换
图1的姿势，图2的服装，画风照图3   →  三张图各取一块
```

它不重复实现标签引擎：词库（38,306 条）、六道压制、分层排序、分级适配、缺项自审全部复用
[anima-tag-reverse](../anima-tag-reverse)，本技能只做三件它不做的事：

1. **听懂跨图的自然语言**（图指代 1..N + 维度词 + 组合宏 + 方向判定）；
2. **按维度换源**（组级 / 子级，子级永远赢；最多 6 张图）；
3. **报跨源冲突**（景别裁掉姿势、角色与外观撕开、场景与光位打架、画师没跟着画风换、有图没用上、源里那块是空的……）。

## 30 秒上手

```bash
cd <技能根目录>

# 各图一份观察 JSON（由多模态的你看图后按 rtag.mjs --template 写出来）
node bin/merge.mjs --img a.json --img b.json "把图1的姿势换到图2的人身上"
# → 1girl, solo, smile, short hair, black hair, …, sitting, …, sailor shirt, …, upper body, …

# 三张图
node bin/merge.mjs --img a.json --img b.json --img c.json "图1的姿势，图2的服装，画风照图3"

# 组合宏：一次点名一组维度
node bin/merge.mjs --img a.json --img b.json --preset 上身特写=1 --base 2
node bin/merge.mjs --dims      # 单维度清单
node bin/merge.mjs --presets   # 组合宏清单

# 提示全部走 stderr：换源摘要 / 跨源冲突 / 缺项自审
# [融合] 图片 2 张｜底图=图2｜换源 1 项｜指令：把图1的姿势换到图2的人身上
#   - 姿势 / 动作(pose) ← 图1
#   [warn] 景别是「upper body」（来自图2），而要搬过来的姿势是「sitting」（来自图1）…
```

先看指令解析对不对（秒出，不碰词库；有歧义时退出码 3）：

```bash
node bin/merge.mjs --img a.json --img b.json "图1的形象微调成图2的某方面" --format explain
```

链式（先定人再定景之类的分步确认）：

```bash
node bin/merge.mjs --img a.json --img b.json "把图1的姿势换到图2的人身上" --format spec --out mid.json
node bin/merge.mjs --img mid.json --img c.json "图2的画风全套套到图1上"
```

## 目录结构

```
anima-tag-merge/
├── SKILL.md                 技能说明（会话里怎么用、怎么追问、踩过的坑）
├── bin/merge.mjs            CLI：默认单行标签，--format explain/md/spec/json/check
├── src/
│   ├── index.mjs            门面：fuse() 一站式；parseFusionIntent / mergeSpecs / applyPresets 可单独用
│   ├── dims.mjs             维度槽位表（组级 + 子级）与中文别名匹配 + 组合宏 PRESETS
│   ├── refs.mjs             图指代解析（图1..图6 / 前一张 / 左图 / 原图）与宿主证据
│   ├── intent.mjs           自然语言 → 融合意图（宿主、换源表、组合宏、假设、歧义、未识别片段）
│   ├── merge.mjs            按意图合并 N 份观察 + 跨源冲突检测 + 溯源表
│   ├── render.mjs           人读报告（explain / md / dims / presets）
│   └── engine.mjs           定位并加载 anima-tag-reverse 引擎
├── tests/
│   ├── smoke.mjs            离线自测：解析与合并（110 项断言）
│   ├── e2e.probe.mjs        端到端探针：CLI 契约 + 真词库（65 项断言）
│   └── fixtures/a.json b.json c.json  示例观察（夜晚教室坐窗台 / 白天街道站立 / 霓虹雨夜）
└── tools/install-dsh-skill.mjs  同步到 ~/.dsh/skills 并写 engine-path.json
```

## 核心语义（决定了行为可预期）

| 规则 | 说明 |
| --- | --- |
| 底图保骨架 | 底图（宿主）保留**所有没被点名**的维度；底图默认是口头上最后一张 |
| 点名维度整体换源 | 说「场景用图1的」就把 `scene` 整棵子树换掉，不留鬼影字段 |
| 子级 > 组级 | `pose` ← 图1 且 `pose.hands` ← 图2 时，先整组后子级，子级永远赢 |
| 与宿主同源也写回 | 组级换源会覆盖整棵子树，同源子级必须写回，否则宿主原本的值丢了 |
| 组合宏展开成普通槽位 | `上身特写` = `pose` + `appearance.expression` + `style.framing` + `style.camera`，不引入第二套语义 |
| 空源如实上报 | 源图那一块没写就报 `empty-source`，不编也不删 |
| 负向取并集 | 所有图的排除项都留着，去重 |
| notes 只当日志 | 引擎侧 notes 不产标签，正好用来记录「哪一块来自哪张图」 |

宿主（底图）判定顺序：`--base` → 「底图是图N / 以图N为基础」→ 落点动词（放到/换到/换给/套到/移到）
→ 「图N的人/身上/图N上」→ 组级外观一致指向 → 兜底「口头上最后一张」。低置信判定会写进
`assumptions`，会话里必须明说给用户听。

## 组合宏（PRESETS）

| 组合 | 别名 | 覆盖 |
| --- | --- | --- |
| 上身特写 | 上半身 / 半身像 / 胸像 | pose + expression + framing + camera |
| 换头 | 头部特写 / 脸和头发 / 五官 | appearance |
| 全身像 | 全身照 / 整体身体 | pose.action + legs + legwear + footwear + framing |
| 整套服装 | 全套装扮 / 整套穿搭 | outfit |
| 人物全套 | 整个角色 / 整个人设 | appearance + outfit + pose |
| 姿势表情 | 动作表情 | pose + expression |
| 场景光影 | 环境光影 / 场景打光 | scene + lighting + light_direction |
| 构图取景 | 取景构图 / 机位构图 | framing + composition + camera |
| 色调氛围 | 氛围感 / 画面氛围 | palette + lighting + light_direction + quality |
| 画风全套 | 整体画风 / 全套画风 | style + **artists** |

`--preset 名字=图N`；两张图时可省略编号（默认取底图之外的那张），三张以上必须写编号。
别名刻意避开具体维度的取值（不收 `全身`，只收 `全身像`），避免和「景别改成全身」打架。

## 为什么这么设计

- **不复制词库引擎**：引擎被 25 条文本回归 + 图像分支探针锁着，复制一份必然漂移。
  合并后的结果是标准观察 JSON，直接喂 `reverseImageSpec()` 即可，排序与分级与原技能逐字节一致。
- **内部用数字编号 1..N**：`a/b/c` 只是输入别名。两张图的历史行为在 N=2 时逐条保留，
  多图不需要第二套代码路径。
- **别名只收两个字以上**：单字（脸/手/腿/人）误命中率极高 ——「侧脸」是表情的值、
  「手里拿着伞」是动作描述。一旦把值当维度词，整组槽位会被错误换源且没有任何提示。
- **宁可报歧义也不猜**：解析不确定时输出结构化 `ambiguous`（带候选项）交给会话追问。
  多图下 `--preset` 不写编号也会直接报错而不是猜一张。
- **`artists` 独立于 `style`**：只想换色调的人不该被动换掉画师；要连带就用「画风全套」，
  同时在 `style-vs-artists` 里提示，避免「画风换了但画师没换」这种静默的半成品。
- **提示与交付物分离**：stdout 只有标签串 / JSON / markdown，其余全部 stderr，方便管道与脚本。

## 测试

```bash
node tests/smoke.mjs        # 110 项：解析、换源、组合宏、宿主推断、多图、链式、歧义、空源、冲突、溯源
node tests/e2e.probe.mjs    # 65 项：CLI 契约、--img/--map/--preset/--base/--swap、退出码、真词库出标签
```

两套测试都**不需要网络**，只需要本地词库（由 anima-tag-reverse 的 `kb-path.json` 定位）。

## 与 anima-tag-reverse 的关系

| 场景 | 用哪个 |
| --- | --- |
| 一段描述 / 一张图 → 标签 | `anima-tag-reverse` |
| 两张以上按维度拼 → 标签 | 本技能（引擎仍来自 anima-tag-reverse） |
| 只想把观察 JSON 出成标签 | `anima-tag-reverse`（`--image-spec`） |

本技能产出的合并观察可以用 `--format spec` 导出，再喂给 `rtag.mjs --image-spec` 复核，
或当成下一轮融合的一张图（链式）。

## 已知限制

- 最多 6 张图；更多请分轮（`--format spec` 导出中间结果再融）。
- 自然语言解析是规则式的：口语里的比喻（「要那种杂志封面的感觉」）会进 `unknown` 清单，
  由会话追问或转成 `--extra` 追加描述，不会瞎猜维度。
- 「融合」不做出图，只产出标签串。
