# Tag 陷阱清单

> 来源：实测本地 38,306 条词库（anima-tag-kb）踩到的坑。
> 「陷阱」的定义：**能查到，但会被解析成别的东西，或语义与预期不符**。
> 用 `bin/tag-doctor.mjs` 可自动检测当前清单。

---

## 一、存在但会降级的（最危险）

写上去不报错，但语义丢失 —— 你以为写了，其实没写。

| 想写 | 实际解析成 | 正确写法 | 说明 |
|---|---|---|---|
| `feet focus` | `feet` | **`foot focus`** | 丢了"焦点"，脚部结构不会清晰 |
| `legs focus` | `legs` | — | 同理，无焦点效果 |
| `detailed feet` | `feet` | `foot focus` + `soles` + `toes` | "detailed" 被吃掉 |
| `hands clasped` | *无输出* | **`palms together`** | 合掌动作丢失 |
| `hands together` | *无输出* | **`palms together`** | 同上 |
| `clasped hands` | *无输出* | **`palms together`** | 同上 |
| `folded hands` | `folded` | `palms together` | 只剩"折叠" |
| `creampie` | **`cream`（奶油）** | **`cum in pussy`** | ⚠️ 最危险，会画出奶油 |
| `tentacle rape` | `tentacle` | **`tentacle sex`** | 丢了"性交" |
| `many tentacles` | `tentacles` | 靠权重/自然语言 | 词库无数量标签 |
| `multiple tentacles` | `tentacles` | 同上 | 同上 |
| `numerous tentacles` | `tentacles` | 同上 | 同上 |
| `elementary school` | `school` | **`randoseru`** | 丢了"小学"，还会把场景带向学校 |
| `wet pussy` | `wet` + `pussy` | `wet` + `pussy` | 拆成两条，结果等价 |
| `shiny legs` | `shiny` | `shiny skin` | 丢了"腿" |
| `tentacle egg` | `tentacle` | `oviposition` | — |

---

## 二、不存在（写了完全不生效）

| 标签 | 说明 | 替代 |
|---|---|---|
| `climax` | 高潮 | **`orgasm`** |
| `squirting` | 潮吹 | **`female ejaculation`** |
| `urine` / `piss` / `urinating` | 排尿 | **`peeing`** / `pee` |
| `countryside` | 田园 | **`rural`** |
| `used` | 事后 | `after sex` |
| `white bedding` | 白色床品 | `white sheets` / `bed sheet` |
| `red marking` | 红色纹路 | `red markings` 或删掉 |
| `no bra` | 无胸罩 | 用相关负向排除 |
| `tiny` | 微小 | 删掉 |
| `young girl` | 小女孩 | **`little girl`** |
| `imouto` | 妹妹 | 删掉 |
| `voluptuous` | 丰满 | `curvy` |
| `elderly` | 老年 | **`old woman`** |
| `wrinkles` | 皱纹 | 删掉 |
| `buxom` | 丰满 | `large breasts` |
| `plush` | 玩偶 | `stuffed toy` |
| `blonde` | 金发 | **`blonde hair`**（必须带 hair） |
| `muscular female` | 肌肉女 | `muscular` |
| `water` | 水 | 存在，但**容易误召回** |
| `light` | 光 | 存在，但**是无意义泛词** |
| `dress` / `ribbon` / `bow` | — | 存在但太泛，建议用具体色款 |
| `lazyneg` / `lazyhand` / `three hands` | — | 疑似自定义/笔误，删掉 |

---

## 三、语义反直觉（释义不是你以为的）

| 标签 | 你以为 | 实际释义 |
|---|---|---|
| `short stature` | 矮小身材 | **短裤**（669.6k） |
| `short` | 矮 | **短裤** |
| `calves` | 小腿 | 小腿，但仅 **430** 投稿量，效果差 |
| `ankles` | 脚踝 | 脚踝，但仅 **732** 投稿量 |
| `flats` | 平底鞋 | **公寓**（会误召回） |
| `digit` | 数字 | 来自 `digital painting` 被切开的噪声 |
| `meat` | 肉 | 出现在"不要肌肉"的连带召回里 |
| `tea` | 茶 | 容易从其他词误召回 |
| `woman` | 女人 | 过泛，与 `hetero` 场景语义重叠 |
| `symbol-shaped pupils` | 符号瞳孔 | 存在，但易与 `heart-shaped pupils` 抢位 |
| `school` | 学校 | `elementary school`/`schoolgirl` 都会降级到这里 |

---

## 四、正负向自相矛盾（写法错误）

| 组合 | 问题 |
|---|---|
| 负向同时写 `extra legs` + `missing legs` | **互相矛盾**，模型找不到合法解 → 融合成连体人 |
| 负向堆 10+ 条肢体类且都带权重 | 模型过度关注肢体边界 → 越修越崩 |
| 正向 `artist name` + 负向 `watermark, signature` | 自相矛盾，`artist name` 会导致画面出现署名 |
| 正向 `explicit` + 负向 `loli` | 分级与内容定位矛盾（排掉 `loli` 不改变画面性质） |
| `jpeg Closed eyes`（漏逗号） | 解析成 `closed eyes` 进负向，**排掉了闭眼** |
| `pantyhose` + `barefoot` | 物理矛盾（穿丝袜不可能光脚） |
| `blindfold` + `glasses` | 物理冲突 |
| `completely nude` + 具体服装 | 全裸不穿衣 |

---

## 五、数量/程度类写法（词库不支持）

**词库没有"数量"标签**，以下写法全部无效：

```
many X / multiple X / numerous X / tons of X / lots of X / several X
```

只能用：
- **权重**：`(tentacles:1.5)`
- **自然语言**：`surrounded by countless tentacles filling the cave`
- **分布标签**：`tentacle pit`、`crowd`

⚠️ 但自然语言指定局部位置（如 `tentacles grasping her ankles`）容易让模型在局部生成实体（**实测长出额外的头**）。

---

## 六、多 LoRA 结构崩坏（ComfyUI 实测）

**现象**：连体人、脚部长头、肢体融合。

**根因**：多 LoRA 各自携带不同的构图/姿势先验，同时激活时争抢身体结构控制权。

**实测案例**：10 个 LoRA、总权重 **4.70** → 反复出现连体人，改标签四轮无效。

| 建议 | 值 |
|---|---|
| LoRA 数量 | **≤3 个** |
| 总权重 | **≤1.5** |
| 同一 LoRA 重复加载 | **禁止**（会收到两份不一致的先验） |

**排查顺序**：
1. 全关 LoRA 裸跑 → 若正常，确认是 LoRA 问题
2. 逐个单独开 → 定位到哪个出问题
3. 多个都对、一起崩 → 降权重或上 **ControlNet OpenPose**（强度 0.8-1.0）硬约束骨架

**画质类 LoRA 尤其危险**：`semi-realistic` + `Anima_in_real` + `highres-boost` + `3d_skin`
这类追求"连续的表面质感"，在极端构图下最容易把相邻部位"焊"在一起。

---

## 七、ComfyUI 语法注意

| 项 | 说明 |
|---|---|
| 角色名括号要转义 | `suzuran \(arknights\)`（不转义会被当权重语法） |
| 负向别加权重 | 负向权重越高，越容易结构崩坏 |
| CFG | **4.5-6**（过高 → 负向压制过强 → 崩坏） |
| Hires fix | 建议开（小结构放大后才修得动） |

---

## 八、快速自检

```bash
node bin/tag-doctor.mjs "你的 tag 串"
```

输出三档：**✓ 正常** / **⚠ 陷阱** / **✗ 未收录**。

退出码：0 = 无问题，1 = 有陷阱或未收录。
