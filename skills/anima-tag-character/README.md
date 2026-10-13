# anima-tag-character —— 「具体作品 + 具体角色」→ 精确 Danbooru 标签

```bash
node bin/char.mjs 可莉 -s 原神                 # → klee (genshin impact), genshin impact
node bin/char.mjs 星野 -s 少女与战车            # → hoshino (girls und panzer), girls und panzer
node bin/char.mjs 星野 -s 蔚蓝档案              # → hoshino (blue archive), blue archive
node bin/char.mjs "《葬送的芙莉莲》的芙莉莲"      # → frieren, sousou no frieren
```

零依赖、零网络：直接读 `anima-tag-reverse` 的本地词库（5713 角色 / 1098 作品 / 5559 条角色中文名）。

## 为什么需要它

词库本身**能**用中文名搜到角色（`博丽灵梦` → `hakurei reimu`），但通用标签匹配有三个做不到的事：

| 问题 | 通用匹配 | 本技能 |
| --- | --- | --- |
| 同名角色跨作品 | 只能按频次猜（「星野」会给蔚蓝档案的） | **用作品归属消歧**，另一个明确排除并列出来 |
| 残条目抢位 | `hutao`（freq=0 的别名残条目）会压过 `hu tao (genshin impact)` | 归属 + 频次双重降权 |
| 误召回 | 「雷电将军」会多给一个 `lightning farron`（最终幻想的角色） | 只给该作品下的角色 |
| 作品标签 | 要 spec 里同时写 `series` 才出 | 默认直接给「角色 + 作品」一对 |
| 查不到时 | 给个相近的凑数 | 如实说「库里没有」+ 退出码 4 |

## 目录结构

```
anima-tag-character/
├── SKILL.md                技能说明（什么时候用、消歧机制、冷门角色怎么办）
├── bin/char.mjs            CLI：resolve / series / search / verify / patch / --info
├── src/
│   ├── index.mjs           门面 API
│   ├── normalize.mjs       名称归一（下划线↔空格、全角括号、书名号、主名/括号拆分）
│   ├── kb.mjs              词库索引：角色 / 作品 / 归属 / 倒排名称表
│   ├── series-zh.mjs       人工策划的作品中文别名（逐条用词库校验，不编造）
│   ├── resolve.mjs         召回 + 消歧打分 + verify + 作品角色表 + 通用检索
│   ├── patch.mjs           观察 JSON 的 characters / series 就地修正
│   ├── render.mjs          人读报告
│   └── engine.mjs          定位 anima-tag-reverse（用于找词库）
├── tests/
│   ├── smoke.mjs           离线自测（64 项断言）
│   ├── e2e.probe.mjs       CLI 契约与退出码（44 项断言）
│   └── fixtures/spec-zh.json  含中文角色名的观察 JSON 样例
└── tools/install-dsh-skill.mjs
```

## 退出码语义

`0` 高置信 / `3` 需确认（多候选、低置信、**你指定的作品没解析出来**）/ `4` 库里没有 / `2` 参数错。

会话里的我据此决定：直接用、列候选追问、还是补一个候选去 `verify`。

## 冷门角色怎么办

词库只收 5713 条精选（Danbooru 实际十万级）。库里没有时：

```bash
node bin/char.mjs verify "chise (princess connect!)"   # 我给的候选，交给工具校验
```

**校验通过就用，不通过就如实说「覆盖不到」** —— 绝不用一个「长得像」的标签凑数。

## 与另两个技能串联

```bash
# 观察 JSON 里的中文角色名 → 规范标签 → 再出标签
node bin/char.mjs patch 观察.json --out 修正.json
node <anima-tag-reverse>/bin/rtag.mjs --image-spec 修正.json
```

`patch` 是幂等的（已经是规范标签就不再改），置信度不足的条目原样保留并进 `unresolved` 让人来定。

| 场景 | 用哪个 |
| --- | --- |
| 一段描述 / 一张图 → 标签 | `anima-tag-reverse` |
| 两张以上按维度拼 → 标签 | `anima-tag-merge` |
| **具体作品 + 具体角色 → 角色/作品标签** | 本技能 |
| 观察 JSON 里的角色/作品字段写的是中文 | 本技能 `patch` |

## 测试

```bash
node tests/smoke.mjs        # 64 项：归一化、消歧、残条目、中文别名、未命中、补丁幂等
node tests/e2e.probe.mjs    # 44 项：CLI 契约、退出码、各子命令
```

## 已知限制

- 只保证词库里那 5713 个角色；作品 1098 个（其中 55 个自带中文名，另有 149 条人工别名生效）。
- 作品中文别名表是人工策划的，覆盖常见作品；罕见作品请给英文/罗马音。
- 不做图像识别：看图认角色由多模态的我完成。
