# 神态识别检查清单

> 用途：我看图时**逐项核对**，避免漏检神态。
> 配套校验器：`node bin/tag-doctor.mjs "<tag串>" --expression-check`
> 标签完整表：`references/expression-mouth.md`

---

## 使用方法

看图时按下面四栏逐项过，**看到什么记什么**，最后汇总进观察 JSON 的
`appearance.expression`（或 `pose` / `appearance` 相关字段）。

---

## ① 嘴型（必查）

> ⚠️ **第一步先辨颜文字形状，再考虑文字标签。**
> 踩过的坑：图里是明确的 `:o`（小圆张嘴），却只写了 `parted lips`（微张唇线）——
> 把颜文字特征降级成了普通描述。**看到嘴先问：这是哪种颜文字形状？**

### 先查这张表（颜文字形状识别）

| 看图判断 | 标签 |
|---|---|
| 小圆张嘴（放松/惊讶） | **`:o`** |
| D 形大笑 | **`:d`** |
| ω 形（猫嘴） | **`:3`** |
| 倒 V（撇嘴） | **`:<`** |
| 吐舌 | **`:p`** / `:q` |
| v 形嘴 | **`:>`** |
| 一字线（无语） | **`:\|`** |
| 单眼咧嘴 | **`;d`** |
| 鼓腮 | **`:i`** |

> 只有**无法归类到任何颜文字形状**时，才退回下面的文字写法。

### 文字写法（兜底）

| 观察到的形状 | 标签 | 中文 | 投稿量 |
|---|---|---|---|
| 张嘴大笑、D 形 | `:d` | 杯型笑脸 | 862.0k |
| 惊讶 O 形 | `:o` | 惊讶 | 267.3k |
| ω 形（猫嘴） | `:3` | ω猫嘴 | 186.0k |
| 倒 V 形（撇嘴） | `:<` | 倒v嘴 | 55.3k |
| 向下吐舌 | `:p` | 向下吐舌头 | 64.4k |
| 向上吐舌 | `:q` | 向上吐舌头 | 50.2k |
| v 形嘴 | `:>` | v嘴 | 20.0k |
| 斜嘴 | `:/` | 斜嘴 | 18.2k |
| 一字线（无语） | `:\|` | 无语 | 14.7k |
| 鼓腮 | `:i` | 鼓腮表情 | 6.3k |
| 不耐烦 | `:t` | 不耐烦 | 39.3k |
| 单眼咧嘴 | `;d` | 单眼咧嘴笑 | 96.1k |
| 张大嘴 | `:<>` | 张大嘴 | — |
| 嘟嘴 | `(-3-)` | 嘟嘴 | — |
| 亲嘴 | `>3<` | 亲嘴 | 220 |

**文字写法**（不确定形状时用）：

| 观察 | 标签 | 投稿量 |
|---|---|---|
| 咧嘴笑 | `grin` | 362.7k |
| 坏笑 | `smirk` | 37.0k |
| 撅嘴 | `pout` | 38.8k |
| 皱眉 | `frown` | 155.8k |
| 吐舌 | `tongue out` | 426.7k |
| 张嘴 | `open mouth` | 3.6M |
| 闭嘴 | `closed mouth` | 2.0M |
| 微张 | `parted lips` | 754.8k |
| 露齿 | `teeth` | 785.4k |
| 咬牙 | `clenched teeth` | 107.7k |
| 薯片嘴（波浪线） | `wavy mouth` | 103.2k |
| 栗子嘴 | `chestnut mouth` | 18.7k |
| 小圆点嘴 | `dot mouth` | 11.1k |
| 猫嘴（三角） | `triangle mouth` | 22.9k |
| 无嘴（没画） | `no mouth` | 22.4k |
| 流涎 | `drooling` | 81.6k |
| 虎牙 | `fang` | 460.1k |
| 舔唇 | `licking lips` | 31.5k |
| 嘴含爱心 | `heart in mouth` | 5.3k |

---

## ② 眼睑/眼型（必查，属于神态 → 换人时保留）

完整体系见 [expression-eyes.md](expression-eyes.md)

### 眼型颜文字（四种）

| 眼型 | **词库标签** | 中文 | 投稿量 |
|---|---|---|---|
| 不等号眼 | **`>_<`** | 颜文字 | 95.8k |
| Wink 眼 | **`>_o`** | >_o (表情) | 7.0k |
| 圈圈眼 | **`@ @`** | **晕眼** | **57.4k** |
| 悠悠眼 | **`u_u`** | 闭眼/无奈 | 8.8k |

> ⚠️ **词库用下划线连接**：`> <` → `>_<`、`> o` → `>_o`、`u u` → `u_u`
> 但 `@ @` **保持空格**。

### 眼睑状态（文字写法）

| 观察 | 标签 | 投稿量 |
|---|---|---|
| 单眼闭（wink） | `one eye closed` | **628.6k** |
| 闭眼 | `closed eyes` | 1.1M |
| 半闭眼（慵懒/迷离） | `half-closed eyes` | 146.5k |
| 翻白眼 | `rolling eyes` | — |
| 空洞眼 | `empty eyes` | — |
| 眯眼 | `narrowed eyes` | 11.0k |
| 垂眼 | `tareme` | 58.9k |
| 吊梢眼 | `tsurime` | 66.2k |

> **优先用文字写法**（`one eye closed` 628.6k）比符号（`>_o` 7.0k）投稿量高 90 倍。

> ⚠️ **眼睑状态属于神态**，换人时**保留**。
> **瞳孔形状**（`heart-shaped pupils`）属于**外观**，换人时**替换**。

---

## ③ 情绪（必查）

| 观察 | 标签 | 投稿量 |
|---|---|---|
| 害羞 | `embarrassed`（别名 `embarassed`） | 144.3k |
| 羞怯 | `shy` | 14.8k |
| 紧张 | `nervous` | 18.6k |
| 严肃 | `serious` | 40.3k |
| 惊讶 | `surprised` | 75.1k |
| 恐惧 | `scared` | 22.2k |
| 慌乱 | `flustered` | 7.5k |
| 醉酒 | `drunk` | 20.4k |
| 困倦 | `sleepy` | 13.5k |
| 疲惫 | `tired` | — |
| 得意 | `smug` | 35.7k |
| 愤怒 | `furious` | 1.0k ⚠️ |
| 生气 | `angry` | 63.0k |
| 无聊 | `bored` | 2.1k ⚠️ |
| 疯狂 | `crazy` | 2.0k ⚠️ |
| 开心 | `happy` | 141.9k |
| 悲伤 | `sad` | 18.2k |
| 困惑 | `confused` | 6.0k |
| 厌恶 | `disgust` | 4.8k |
| 面无表情 | `expressionless` | — |
| 颤抖 | `trembling` | 110.0k |
| 满足 | `afterglow` | — |
| 喘息 | `heavy breathing` | — |

### ❌ 不存在（别写）

`calm`、`proud`、`panic`、`relaxed`、`surprise`（须用 `surprised`）

---

## ④ 辅助表现（按需）

| 观察 | 标签 | 投稿量 |
|---|---|---|
| 脸红 | `blush` | 4.1M |
| 汗滴 | `sweatdrop` | 332.8k |
| 流汗 | `sweat` | 782.5k |
| 眼泪 | `tears` | 297.9k |
| 泪痕 | `tear drop` | 10.6k |
| 口水 | `saliva` | 154.1k |
| 口水拉丝 | `saliva trail` | — |
| 心形瞳 | `heart-shaped pupils` | ⚠️ 外观层 |
| 符号瞳 | `symbol-shaped pupils` | ⚠️ 外观层 |

---

## 组合公式

```
[嘴型] + [眼睑] + [情绪] + [辅助]
```

### 示例

| 画面 | 标签串 |
|---|---|
| 慵懒迷离、微张嘴 | `half-closed eyes, parted lips, blush` |
| 害羞扭捏、猫猫嘴 | `:3, embarrassed, blush, nervous` |
| 生气撇嘴 | `:<, frown, angry` |
| 惊讶张嘴 | `:o, open mouth, surprised, sweatdrop` |
| 高潮失神 | `rolling eyes, empty eyes, open mouth, tongue out, ahegao, sweat` |
| 从容不迫 | `:p, serious, half-closed eyes` |

---

## 自检流程

1. 看图，按 ①②③④ 逐项记录
2. 拼进观察 JSON
3. 跑校验器确认没漏：

```bash
node bin/tag-doctor.mjs "<tag串>" --expression-check
```

校验器会检查：
- 有没有**嘴型标签**（一条都没有 = 很可能漏了）
- 有没有**情绪或眼睑标签**
- 拼写有无问题
