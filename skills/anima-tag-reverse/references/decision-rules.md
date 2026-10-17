# 出串通用判据与决策流程（遇到新题材照这个走，不背模板）

本页是「**怎么想**」——按**判据**写，不按题材写；`landing-rate.md` 是「**凭什么这么想**」（十一个题材的实测台账）。
任何新题材，先用第一、二节走一遍流程，再拿第三节的判据表逐条检查，最后用第四节的 12 问自检。

## 一、三条底层机制（所有现象的根，先记这三条）

1. **管道优先级**：同一个效果，写进**英文自然语** ＞ 写成**正向标签** ＞ 靠**负向兜底**。
   - 「有什么」（物件、部位、服装、场景）→ 交给**标签**；
   - 「长什么样、放在哪、和谁接触、多大、多厚」这类**关系与程度** → 交给**自然语**；
   - 「不要什么、只能选哪一个」→ 交给**负向**。
   - 实测依据：发色瞳色、体液厚度、接触承重、机位描述，凡是在自然语里写死过的几乎都落地；只写在标签里的常被稀释。
2. **先验强度**：题材自带的先验可以压过标签。判据＝**画面主体是谁**：
   - 主体是**人体本身**（横陈、占满画框、贴脸）→ 构图/机位类标签会被题材先验压过；
   - 主体是**物件或环境**（容器、场景、道具）→ 构图/机位类标签有戏。
3. **名额有限**：每加一条标签，其他标签分到的注意力就少一分。单人 20–36 条为稳，超过 ~50 条显著稀释（实测 100 条级只落地约三分之一）。加细节前先问：**这条能不能并进自然语？**

## 二、五步决策流程（任何题材都走这五步）

1. **定主体**：这张画的视觉主体是人还是物？→ 决定机位词/景别词敢不敢写（见机制 2）。
2. **定写死项**：凡是模型会自己乱选的，一律写死——外观（发色瞳色）、物种部位（角/尾/耳/翅）、材质与状态（湿/透/浊）、**尺度**。
3. **分名额**：按层给上限，超了就往自然语挪。
   参考上限：外观 ≤6 ／ 表情 ≤6 ／ 姿态与动作 ≤6 ／ 服装与配饰 ≤8 ／ 场景 ≤8 ／ 成人向细节 ≤8 ／ 构图与镜头 ≤4。
4. **处理「二选一」与「多出物件」**：同类里只要一个 → 其余**进负向**（负向压对立项）；同义标签不要叠写。
5. **写自然语**：把标签表达不了的**四件事**钉死——
   **尺度**（多大／多高）、**接触与承重**（搭在哪、压着什么、谁托着谁）、**空间关系**（谁在容器里、谁在外面、朝哪个方向）、**机位**（镜头在哪、朝哪看）。

## 三、判据表（情况 → 判据 → 动作）

| 你想干的事 | 判据 | 动作 |
| --- | --- | --- |
| 控制镜头／视角 | 画面主体是不是人体本身 | 人体占满画框 → 机位词全删，只写进自然语；物件／环境主导 → 写 ≤2 条**同向**机位词 |
| 只露一部分身体 | `out of frame` 是真裁切还是"部分露出" | 它是**真把肢体切出画框**；"人在容器里只露四肢"要用自然语写，别用它顶替 |
| 手要画对 | ① 同时出现几只手 ② 手占画面高度百分比 ③ 所抓物体的形状 | 单手＋≲7% 画面高＋抓**扁而宽、有厚度**的东西；**两手同框＝两手全崩**（第二只必然退质）；**例外**：双手必需且对称的语义（双掌贴玻璃／合掌）可保留双手，但接受"一只可读、一只退质"，并把双手放在画面中部而非前景。别握细长物、别抓圆柱正上方 |
| 手 | 默认**要给**还是可以省 | **默认给手**（用户 2026-10-12 明确要求：不再默认省略手，除非当轮单独说明）。写法：用**具体手部动作**落位（`outstretched arm`／`open hand`／`spread fingers`／`hand on own hip`／`reaching towards viewer`），**不要写泛词 `hands`**（库里误命中 `handshake`）；负向**去掉 `hand focus`**（它压手的显著性），畸形压制照旧保留。**两只手都在画内时必崩一只**（实测：近侧那只可读但无关节、远侧那只手指融合成蹼）→ 降风险三招：① **远侧那只半遮挡**（藏在翅膀／头发／丝带后，部分露出仍算"没省手"）；② 远侧改成**简单形状**（并指／握拳／贴物）；③ 两只手都靠近镜头，大小相近时质量更均匀。只有在用户当轮点名"不要手/藏手"时才用老方案 |
| 同族多值（发色／瞳色／部位） | 是否同层竞争 | 只留**一个主值**，其余进自然语或负向 |
| 物种部位指向（龙尾 vs 鱼尾、兽耳 vs 人耳） | 是否互抢 | 正向留一个，**另一个写负向** |
| 物件尺寸不对 | 标签有没有刻度 | 没有 → 自然语写**相对尺度**（"齐腰高""高过人头""门只到她肩"） |
| 画面多出同义物件 | 是否叠写了同义标签 | 同义标签**只留一个**，其余进负向 |
| 材质：厚浊／透明 | 正反两面是否都写 | 正向给"厚重/乳白/不透明"一组 ＋ 负向封反向（透明／稀薄／清水） ＋ 自然语写程度。**但注意互斥**：**`opaque`（完全不透明）与"身体浸在液体里仍然可见"互相矛盾**——写了不透明，模型只能把被摄部位**提出液面**来满足 `nipples`／`puffy nipples` 这类强可见标签（实测三轮都是这个病）。要"透过液体看见身体"就必须把液体改成**半透**（`milky`＋`translucent`，并把负向里的 `transparent`／`translucent` 撤掉、改压 `opaque`），自然语写"her body glowing pink under the milky surface" |
| 材质：湿／透衣 | 同上 | 全湿写"soaked through"，半透写 `see-through` ＋ 负向压"全透/无衣" |
| 情绪脸 | 同向词是否堆叠 | **只押一头**（恐惧向 or 玩坏向）；混押得到中间值＝"张嘴发呆脸" |
| 某标签总是超额 | 该词的语义是不是"大号" | 降级或删掉（角／恶魔翼一类），改用小号词或只在自然语说"小巧的" |
| 某词会自长装饰 | 该词是否带发光/光效语义 | 从正向删掉，改押更可控的同类词 |
| 物种部位（角／鳍／兽耳／翼） | 想要**大**还是**小** | 该标签的语义就是**放大版**（`fins` 出巨型鳍耳、`horns` 出巨型角）；只要小特征就**别写该标签**，改在自然语里描述尺寸（"a small fin behind her ear"） |
| 新增物体与核心部位重叠 | 物体**放在哪**写了吗 | **遮挡型构图自检**：只写"有什么物体"不够——物体压在被摄核心部位上时会自己挡住它；必须在自然语里指定**来向与位置**（"从她两腿之间探出""骑在她大腿两侧，腹部露出"），并让核心部位保持可见（`spread pussy`／`labia`／`clothing aside`）。**同一条还管「竞争者」**：衣摆、液体、虫体都会抢核心部位——要它露出来就先清场（衣摆提上去、液体只积在下方、物体挪到侧后方） |
| 画面里有**同形**的东西 | 两者会不会合流 | **同形竞争者**（**已实战验证**）：软管状／绳状实体遇到绳索、绷带、触手时会互相同化（白肉虫被画成盘在腿上的绳）。要么**减掉另一方**（只留手腕绳、别在腿上再缠绳），要么给它**活物特征**（钝头＋眼＋口器）与**明确的进入点**，让人一眼分得出谁是生物——实测两刀同用后，肉虫立刻被读成"有眼睛和嘴的活物" |
| 容器／大物件**占画幅比例**不对 | 你把谁当成了画面主体 | **让物件占满画面**＝把物件当主体写＋**把镜头贴近**。实测流程：在**同一高度切一条横带**对比原图与成图（原图那条横带上**液体/物件横贯 100% 宽、看不到背景**；我的只有 30–70%、其余是躯干与背景）。动作：① 加 `close-up`（或 `upper body`）把机位推近，容器壁自然溢出画幅两侧；② **不要写"比画幅还宽/占满屏幕"这类以画幅为参照的描述——实测反效果（容器反而更小）**；③ 自然语写"液面横贯整幅、画面里看不到背景" |
| 表情不对 | 先看**眼睛的开合**是怎么写的 | 眼睛的开合是表情的总开关：原图是**闭眼大哭**（`closed eyes`＋`crying`＋泪），写成 `half-closed eyes` 就出"平静半睁眼"。先对齐开合，再谈情绪词 |
| 同一件衣服想吃两种效果 | 两个标签语义互斥吗 | `torn pantyhose`（撕开露肉）与 `cameltoe`（布料绷紧勒出形状）**语义打架，只能选一个**；想要骆驼趾就别撕裆，想露阴唇就撕开＋`labia`。同类：`see-through` 与 `opaque`、`covered` 与 `topless` |
| 负向压对立项 | 会不会把要出现的**主体**一起压掉 | **别压「存在性类别词」**：留一个库内／有权重的类别标签；旧项只压它的**专属子标签**（压 `beetle`／`insect wings`，别压 `insect`）——实测把类别词压掉＝把主体从画面里删了 |
| 实体是**超低频词**（<2k） | 权重够不够撑起主体 | 显式加权（`(worm:1.35)`）＋自然语给它**画面空间**（"its body fills the space between her legs"）；**质感词簇不能替代实体**——`slime`／`goo`／`slimy` 无实体承载时会退化成环境黏液 |
| 要求某部位**被遮挡** | 是否同时给了它**强可见标签** | **互斥**：`nipples`／`puffy nipples`／`breasts` 这类"必须清楚看见"的标签，模型会靠**把部位提出遮挡物**来满足（实测四轮：液面永远被抬到乳房以下）。要"浸在液体里透出来"，就得**把这些正向标签撤掉**，改由自然语承担（"her breasts hang just below the surface, the nipples showing as soft pink shapes through the milky fluid"）——与「别点名不想出现的东西」是同一族的反向用法：**也别点名"必须清楚看见"的东西** |
| 走**图生图**（img2img） | 提示词该管什么 | **空间骨架（构图／占比／液面高度／容器宽度）来自输入图**，字面上改不动就调**重绘强度**；提示词集中管**材质、细节、表情、局部位置**，并把构图长句**精简成加权标签＋短句**（实测：成图构图对了是因为输入图对，不是提示词的功劳；而表情这种"输入图已定型"的项，要加权＋提重绘强度才改得动） |
| 场所／建筑**规模不对**（太短、太小、没有纵深） | 有没有写"多大／几层／几个" | **场所标签只回答"这是什么地方"，不回答"多大"**：写 `spiral staircase` 只会得到"一圈短环"。规模要用**数量＋出画**的自然语写死（"二十几级、绕整整两圈、上下两端都跑出画面之外""井底在她脚下两层楼那么深"）。**"绕圈" ≠ "下降"**：只写"绕几圈"得到的是**同高的环形平台**（典型的失败症状＝**环贴着水面**）；要纵深必须写**逐级下降**（"一级比一级低、螺旋降到看不见、水在最底下"）＋机位**斜着往下看**（不是正俯视） |
| 角色名／性转在库里查不到 | 是硬找标签还是拆成外观 | 库外角色名（如某作品配角）→ **作品名只要库里有就写**（例：`harry potter (series)`），**角色名交给自然语**，并把该角色的**招牌外观特征逐条写进外观层**（发色发型／瞳色／院系配色／制服款式）——不写角色名也能命中"像谁"。**性转／性别转换**这类概念库里也可能没有，同样走自然语（"the female version of X"），不要硬凑 |
| 不想要的**体液／白浊** | 正向删了没有？负向压了没有？ | **正反两面必须成对**：只把 `cum`／`cum on breasts` 从正向删掉，模型仍会自己补；要在负向写**整个家族**（`cum, cum on breasts, cum on clothes, bodily fluids, white liquid`），并**顺手收掉"湿亮"搭档**（`wet`／`shiny skin` 常被模型用来画白浊，改用 `sweat`） |
| 要**剪影／逆光**效果 | 细节标签是不是抢了名额 | **剪影题要"减标签"**：`armor`／`sheath`／`thigh strap`／`boots`／`high heels`／`braid`／`hair ribbon` 这类**细节制造机**会把画面拉回"全亮＋高细节"，实测 39 条里塞两个光影词也压不住。做法：只留**轮廓级大件**（`dress`／`sword`／长发整体）＋把名额全给光影块（`greyscale, monochrome, backlighting, silhouette, rim light, high contrast, dark, dim lighting, bloom, simple background`），脸用**结果类**标签 **`faceless`**（70.8k，官方组）压住，负向加 `colorful, detailed background, bright colors` |
| 用户说「**上一版更好**」 | 是继续微调还是回滚 | **回滚优先**：逐字给回那一版的串，**不要在新方向上继续微调**——实测连续两轮"往白上加"（加 `white dress` → 再加 `pale skin`）只会越改越远，第三轮才发现第二版才是目标。先把那一版原样交付，再问要不要动某**一处** |
| 细节总量 | 是不是超 ~50 条 | **整行砍**，不逐条抠（砍最先不承担叙事的那一行） |
| 概念是**抽象词**（光尘／雾气／氛围颗粒） | 它在**词库**里吗 | **不在库的抽象词会被实体化成错误小物件**（`dust motes` → 黄色蝴蝶贴片）；出串前 `kb-audit --check` 换成库里词（`light particles`）。**已实战验证** |
| 接触／承重／悬空 | 标签能不能表达"压在什么上" | 不能 → 全部交给自然语（"大腿搭在箱沿上、小腿垂在外侧"） |
| 有**不想出现**的元素 | 自然语里有没有"点名"它 | **别点名**（负面提及会激活它）→ 正向写替代姿态标签（`face down`／`head down`／`in container`）＋ 负向压可见性线索（`looking at viewer`／`eye contact`） |
| 想松绑一条限制 | 有没有**同向**限制接住 | 删限制必须补等价限制（正向同义姿态或负向压制），否则模型按"展示角色"的先验接管 |
| 接触关系有多处 | 力学方案自洽吗 | 只给**一套**自洽方案；互相矛盾的描述会得到折中姿势（横躺／悬空） |
| 要隐藏某个部位 | 用的是**结果类**还是**原因类**标签 | **结果类**（`head out of frame`＝画面里没有它）＞ 原因类（`face down`／`head down` 压不住"露脸"先验）；再配负向 `looking at viewer`／`eye contact`／`face`。**已实战验证** |
| 接触／姿态不对 | 容器与被摄体的**相对尺寸**写了吗 | 要"被塞进去、四肢弯在壁上"→ 容器写成**比身体小**（`cramped`）；写成"比身体大"只会得到平铺姿势、头滑到沿上。**只写"高"没用，要写"窄到贴着她"**（"just wide enough for her, the glass almost touching her arms"）；**液面高度同理**：写**相对位置**（"fluid level at her collarbone, only her head above it"），单写 `submerged` 不落地 |
| 「手贴在 X 上」这类语义标签 | 只写了语义还是也写了**接触几何** | `hand on glass`／`hand on railing` 只表达"手和某物有关系"，**不表达贴在哪一面、朝哪**，实测会把手悬在容器外侧。**要"隔着玻璃看见手"就必须写死"贴在离镜头最近的那面玻璃上、玻璃夹在手与镜头之间"**（"palms flattened on the front pane, the glass between her hands and the camera"），或干脆一图一手、另一只藏进液体里 |
| 要「**求抱抱**／接住我」的姿势 | 写了 `hug` 吗 | **别写 `hug`／`hugging`／`embrace`**——库里它们属 `og:posture / 双人及以上拥抱`，单人图会**招来第二个人**。姿势交给 `reaching_towards_viewer`（伸手向观众，38.4k，精选）＋ `outstretched arms`（伸出双臂，94.3k）＋ `foreshortening`；`arms up`（266.8k）是"向上举手"，方向不同别混 |
| 要**手臂前伸**但**不要手指** | 手套是分指还是连指 | 用 **`mittens`**（连指手套，21.0k）替掉 `open hands`／`spread fingers`——连指手套天然没有分指可崩；正向删 `spread fingers`，负向压 `spread fingers, claws, fingernails, nail polish`，自然语写死"两只手套合着朝镜头，看不到指头"。**负向不要写 `fingers`**（库里它误命中有马娘角色）；想要手部存在感就别把 `hand focus` 放进负向 |

## 四、通用自检 12 问（任何题材都问一遍）

1. 画面主体是**人**还是**物**？
2. 机位词**敢写吗**（主体是物才写，且 ≤2 条同向）？
3. 外观（发色瞳色）**写死了吗**？
4. **尺度**写了吗（多大、多高）？
5. **接触与承重**写了吗（搭在哪、压着什么）？
6. **手**：几只？放哪？占画面多大？抓的是什么形状？
7. **脸**押了几头？
8. **同族多值**有没有打架？
9. **同义标签**有没有叠写？
10. **材质**的正反两面都写了吗（要浊的封透明、要透的压全裸）？
11. 有没有**"会自长"的词**（发光类、角类）？
12. 总条数 ≤40 吗？负向里压掉的是**多余的那一个**、不是想要的那一个吗？

## 五、复现与取证

```bash
node bin\rtag.mjs "描述" --rating <档>              # 出串（默认混合形态）
node bin\rtag.mjs --image-spec 观察.json --format md   # 图像分支（观察档要写满 9 个必填维度）
node tools\kb-audit.mjs --check "词1, 词2, 词3"        # 先用词库核查存在性，再动手写串
```

复核成图：**脸／手（逐只）／下身／关键道具**各 1.2–2.4× 放大后**二次读图**再下结论；一次读图会把光斑当瞳孔、把环绕物当手持物。

## 六、词库陷阱与冷词承重（实战补充）

写串之前先用 `kb-audit --check` 核一次。踩过的同族陷阱：

- **`earring`** 在库内没有本义条目，会误命中有马娘角色（`agnes tachyon (umamusume)`）→ 耳饰一律写 `jewelry` ＋ 具体宝石（`blue gemstone` / `gem`）。
- **`fingers`** 单独写会误命中有马娘角色 → 手指的藏与露只用具体动作词（`fingers to mouth` / `spread fingers`），负向里也不写裸 `fingers`。
- **`palm`** 库内本义是「以手掩面」，与「摊开的手掌」相反 → 掌心朝镜头改用 `open hand` / `outstretched arm`。
- 库外词不用硬找：换近义库内词（`shadow face` → `shaded face`）或整句交给自然语。

冷词（freq ≲ 2k）不单独承重：

- 冷词的语义往往最准（`fingers to mouth` 721、`peacock feathers` 1.2k、`peacock` 556、`glitter` 1.6k、`crazy` 2.0k、`furious` 1.0k），但权重撑不起画面 → 写法是「冷词照写（可给 1.1-1.3 权重）＋ 同一件事用自然语再说一遍」，不要用高频近义词替换（高频词语义更粗，会盖掉你要的细节）。
- 排层按**库内归属**，不按直觉：`feathers` 归 `og:lighting`（光影氛围）、`sparkle` 归 `og:backgrounds`、`fingers to mouth` 归身体部位。

- **自然语里的强度形容词会被放大**：自己写 "heavy red eyeshadow" 就把全脸刷成红，而参考图只是眼尾一点薄粉 → 自然语只写**位置与量级**（"a thin wash at the outer corner"），不写"浓厚/沉重/大面积"这类主观强度词，除非真要那个强度。
- **对称部位要显式打破对称**："只露一只眼"必须写 `hair over one eye`（377.0k）或遮挡类结果标签，否则模型默认两只都露；`one eye covered` 75.3k 是同一族的备选。
- **散装 vs 整枝**：要"一枝金叶垂下来"不能只写 `leaf` + `gold`（会散成很多小叶片），必须在自然语里给数量与走向（"a single gold branch of leaves curving down from the upper right"）。
- **新一轮只动没达标的那几项，达标的原样保留**：v2 已达标的三件（黑左白右的发分区、整枝金叶、手位）在 v3 里逐字不动，改的只是眼神、遮眼程度、眼影量、羽毛数量位置、肤色五项；整串重写会把已经对了的东西一起摇散。
- **眼神换挡必须把旧视线移进负向**：要"半闭眼＋视线向下"就写 `half-closed eyes` ＋ `looking down`，同时把 `looking at viewer` 从正向删掉并**写进负向**，否则上一版残留的"睁眼看镜头"会被图生图拉回来。
- **遮挡程度有递进档**：`hair over one eye`（发遮眼，377.0k）只是"发丝盖在眼上"，仍会露出虹膜；要那只眼**完全看不见**就叠一条 `one eye covered`（75.3k，结果类），两条一起用才压得住。
- **遮挡的载体要指定，别让强标签替你决定**：`hair over one eye`（377.0k）等于"用头发挡"，写了它就别指望羽毛去挡；要**羽毛挡眼**就删掉它，只留结果类 `one eye covered`，再把载体写进自然语（"peacock feathers hang over that eye"）。
- **前景遮挡用 `blurry foreground`**（42.3k）：要一个物件位于镜头与主体之间（羽毛、枝条挡在脸前），只写物件本体它会被放到主体旁边；加 `blurry foreground` 才把它推到镜头前。
- **同一处遮挡不要两个载体抢**：头发与羽毛都写会互相顶掉，最后哪样都没挡住。

- **连指手套／兽掌不要配 `open hands` / `spread fingers`**：这两条是「真手张开五指」的语义，会把 `paw gloves` 退化成戴手套的人手；兽掌只写 `paw gloves` ＋ `animal hands` ＋ `paw pads` 三件套，张开的感觉交给自然语与 `reaching towards viewer`。
- **手写拟声词只写 `japanese text`**，别把拟声词本身写进正向去指望它画对字形；具体那几个假名放自然语里（字形本来也不受控）。
- **「梦幻／对比强／色彩艳」库里有现成四条件**：`vivid colors`（精选）＋ `high contrast` ＋ `gradient background` ＋ `bloom`，再配 `sparkle` / `light particles` / `backlighting`；`colorful` 与 `vivid colors` 二选一，别叠。

- **换手（兽掌 ↔ 人手）要整组替换，并把旧的一整套压进负向**：正向 `paw gloves` ＋ `animal hands` ＋ `paw pads` 三件套与 `open hands` ＋ `spread fingers` 是互斥的两套；只加不减、或只减不加，都会让图生图把旧手拉回来。换手的同时把旧套件写进负向是必要动作（与"旧脸残留必须进负向"同一条机制）。
- **人手靠近镜头而且是两只同框时**：`reaching towards viewer` ＋ `foreshortening` 保留，负向固定带 `extra fingers, fused fingers, bad hands`；裸 `fingers` 不要写进负向（库里会误命中有马娘角色）。

- **星芒没有独立词**：`starburst` 库里不存在，靠别名命中到 `light rays`（33.5k）；想要"星芒爆开"就写 `light rays` ＋ `lens flare`（51.0k），再在自然语里说"从光源向外炸开的星形光束"。复数 `sunbeams` 不在库，单数 `sunbeam`（13.4k）在。
- **泡泡**：`bubbles`（光影氛围组）与 `bubble`（物件组，46.9k）是两条，氛围用途优先 `bubbles`，只加一颗具体气泡用 `bubble`。
- **"对比度更强"要写成光位而不是形容词**：正向 `backlighting`（46.1k）＋ `high contrast`（**只有 4.9k，是冷词**）＋ `rim light`（精选）三件一组，并在自然语里指定**光从哪个方向来**；只写"高对比"这类形容词，模型会退回正面平光。
- **加强光影时同时要点名"哪里还要亮"**：逆光会让没被点名的正面全黑，自然语里补一句正面靠反射光仍可读，避免脸糊成一团。

- **"张力视角"三件套**：`from below`（121.3k，仰拍）＋ `dutch angle`（164.6k，画面倾斜）＋ `foreshortening`（71.0k，近处放大远处收窄）。三件一起用才是"扑向镜头"的压迫感；只写 `wide angle` 不够，而且 `wide angle` 是策展词（无 freq，标注 [luo-fe]）。
- **`dynamic angle` / `dynamic composition` / `tilted head` / `intense` 都不在库**（近似命中里出现的 `dynamic composition, diagonal composition, low angle shot, dramatic perspective` 属于默认关闭的长短语池，不要当正向标签用）。要"动感"就落到 `dynamic_pose`（注意库内规范写法是**下划线** `dynamic_pose`，4.1k，冷）、`motion blur`（35.4k）、`speed lines`（14.5k）、`floating hair`（196.9k）、`wind`（68.5k）这五条上。
- **动感与静帧不兼容**：要动感就往负向加 `static pose` / `straight-on`，否则模型会把 `from below` 演成"站着不动、只是机位低"。

- **自然语里不要给背景安一个模板里没有的具体物件**：为了说明"画面斜",我写了"背景的楼梯沿对角线走"——模板本来就是纯渐变底，结果等于凭空给模型加了楼梯。说倾斜要用中性词（背景、地平线、画面下缘），具体物件只在确认过它存在时才写；已经写进串的，负向要把它压掉。

- **`bow` 在本库里是「弓」（1,800k，og:accessories/装饰），不是衣服上的蝴蝶结** —— 服装上的结（胸口的黑蝴蝶结）写进正向只会招来一把弓；要么整个交给自然语（"a large black bow at the chest"），要么用 `ribbon`（缎带）。
- **耳饰写复数 `earrings`（867.9k，og:attire/头面部）**；单数 `earring` 在库里没有本义条目、会误命中有马娘角色 —— 同一族的两条，只差一个 s，**永远写复数**（与第 101 行那条是同一件事的两面）。
- **这批库外写法**：`dangling earrings`（→ `earrings` ＋ 自然语"long dangling crystal"）、`patent leather`（→ `latex` 19.6k ＋ `shiny clothes` 32.8k，湿亮黑料靠这两条）、`long gloves`（→ `black gloves` 687.3k ＋ 自然语"past the elbow"）、`cast shadow`（→ `shadow` ＋ 自然语指定投在墙上）、`glossy floor`（→ `floor` ＋ 自然语"地面一条亮光带"）、`color block`（→ `two-tone background` 65.8k ＋ 自然语把色带逐条列清楚）。
- **"一大圈边缘柔和的光斑压在背景上"没有现成标签**：`spotlight`（9.6k，冷）只给"聚光"的意思，光斑的形状/柔边/大小、以及"她的影子硬边投在墙上"全部靠自然语写；只写 `spotlight` 会退化成普通的亮一块。
- **色带数越多越要逐条列**：背景是红／灰／黄三条竖带时写 `two-tone background` ＋ 自然语"vertical bands of red, yellow and grey"，模型才会按条分而不是自己调色。
- **库外角色名走「三件套锚定」**：角色名本身不在库时（实测 `chinatsu` / `chinatsu (zenless zone zero)` 都不在，近似只给到别的作品），用 ① **作品层**（`zenless zone zero` 120.4k，库里收录 27 个角色）＋ ② **阵营／分组层**（`angels of delusion` ＝妄想天使，1.3k 冷，可给权重）＋ ③ **设计层**（`white hair` / `short hair` / `yellow eyes` / `horns`）三件一起写，角色名只放自然语（"Chinatsu from Zenless Zone Zero"）——模型认名字，词库不认，两条路都要走。
- **`censored bar` 库外**：要封马赛克/打码就走负向 `censored, mosaic censoring, bar censor`（这三条库内都有），别写 `censored bar`。
- **`on back` 的库内释义写作「夏日躺卧」，但条目与本义都是仰躺** —— 躺姿一律 `lying` ＋ `on back`，两条都要写（只写 `lying` 模型可能给侧躺或趴）。
- **`spread_pussy` 是"用手掰开"**（41.8k），腿张开但手没碰就只写 `spread legs` ＋ `pussy`；两件事别混。
- **`blurry background` 在本库里的释义是「无面恶魔」**（词条释义错位，见检索近似列表）—— 别拿它当"背景虚化"用；要虚化写 `depth of field`（126.2k）＋ 自然语"只有她清晰"。
- **这批库外写法**：`bare thighs`（→ `thighs` ＋ `bare legs` 181.7k，裸腿靠 `bare legs` 承担）、`high angle`（→ `from above` 148.1k，轻微俯视的程度写自然语）、`centered`（→ `character focus` ＋ 自然语"居中在门口"）、`diffused lighting`（→ `soft lighting` ＋ `dim lighting` 1.4k 冷）、`soft shadows`（→ 自然语"阴影柔和"）。
- **单数 `indoor` 库外，库内是复数 `indoors`**；同类差异（单复数）在写串前用 `kb-audit --check` 一次问清楚，别凭手感。
- **冷词撑不住就配权重或下沉自然语**：`pregnancy test` 只有 1.3k、`pov doorway` 3.7k、`covering crotch`→`covering_crotch` 16.1k，出串时可以给 1.1–1.3 权重。
- **用户只给动作不给外观时**：外观层（发色／瞳色／发型）会整层空着 → 按缺项自审报出来问一句，别自己编；先把已有情绪与服装层写满，交付时点明"发色瞳色没给，模型会自己抽"。


- **胸围阶梯（本库口径）**：`medium breasts` 1.2M ＜ `large breasts` 2.3M ＜ `huge breasts` 333.0k ＜ `gigantic breasts` 16.7k（库里释义「魔乳 (F)」）—— **没有 `hyper breasts`**（库外），要「超乳」就写 `gigantic breasts` 并给权重；身材词用 `voluptuous`（策展，anima3:any）／`plump` 44.6k／`curvy` 77.7k／`wide hips` 59.4k。
- **胸围同族别叠写**：`gigantic breasts` 与 `huge breasts` 同时写会互相稀释（同族多值只留一个主值）—— 要更大就提权重，或把程度交给自然语。
- 这批库外写法：`hyper breasts`／`absurdly large breasts`／`busty`／`curvy figure`（`figure` 单独有，但语义不对）。
- **抗漂移**：写了大胸就把 `flat chest, small breasts` 放进负向，否则模型会把「极其丰满」削回普通巨乳。


## 手指与脚趾：常驻契约（第 7 期起，用户当场要求）

**负面块固定带这一组（不是可选）**：

`bad hands, extra fingers, missing fingers, fused fingers, extra digits, fewer digits, five fingers, malformed hands, bad feet`

- 库内佐证：`extra fingers`／`missing fingers`／`five fingers` 在库里就是 **`cb:negative / 质量负向`** 分类（本来就是给负向用的），`bad hands` 3.4k；`six fingers` 库外，别写。
- **不要写裸 `fingers`**（库里误命中角色）也不要写泛词 `hands`；负向要具体到形变种类。

**正向要成对给结构**：手可见就落 `open hand` 25.9k／`spread fingers` 5.7k／`outstretched hand` 32.9k／`hand up` 569.6k 之一（按画面里的实际动作，不叠写同义条）；脚可见就落 `barefoot` 507.9k（`bare feet` 是它的别名）／`toes` 242.7k／`soles` 151.3k，脚是画面主体时才加 `foot focus` 38.3k。

**数量只能写自然语**：标签没有"五根"这层语义 —— 自然语写「her open hand with the fingers spread, knuckles clean」／「five toes on each foot」把数目钉住；把 `five fingers` 留在负向（库里它属于质量负向组）。

**脚趾崩坏的对策（比手更脆）**：脚不做特写（`foot focus` 只在用户点名时写）／穿袜穿鞋（`socks`／`shoes`／`boots`）／只给侧面轮廓；真要赤脚特写就把 `barefoot` 与 `spread toes` 一起给，并在自然语写清脚趾逐根分开。

**与手部三招的关系**：两只手都在画内仍按「远侧半遮挡／远侧改简单形状／两只都靠近镜头」降风险；负向常驻组是兜底，不能替代这三招。


- **作品名＋角色名都在库外时**（实测 `niju rasen`／`double spiral`／`bai` 全缺）：走「设计层锚定 ＋ 自然语写名」—— 把辨识度压在稳定特征上（发色发型、`x hair ornament`、`pointy ears`、`fang`、随身标识件如 `badge` ＋ `panda`），作品与角色名写进自然语。**库内近似列表会返回别的作品的角色**（`shiro` → 白子/白洲梓…），拿来硬凑等于给画面串味。
- **器官归属判不出来就别写归属标签**：一根勃起物在画面里但放大两次仍判不出是角色自己的还是别人的 → 不写 `futanari`（52.8k），改 `1boy` ＋ `penis` ＋ `large penis`，把「谁拿着／朝向谁」交给自然语。判错归属要整张重来，判不清就退回保守口径。
- **灰阶素描的稳落组合**：`monochrome` 863.9k ＋ `greyscale` 700.0k ＋ `sketch` 198.1k ＋ `traditional media` 129.1k ＋ `pencil` 16.2k ＋ `lineart` 16.8k；要护住灰阶就把 `color, colorful, flat color, cel shading, photo, realistic` 放进负向。
- **拟声与情绪符号**：手写拟声、怒号角、`?`／`!` 这类符号只写 `japanese text`（符号本身画不出来）；本图的下垂口水用 `dripping` 13.0k ＋ `precum` 24.6k 承担，别写 `cum`（那是射精量词，会放大成喷发）。

## 七、权重契约（第 7 期起）

混合形态的标签默认带 Anima 权重，写法 `(tag:1.2)`（括号 + 冒号 + 数值，逗号分隔不变）。

**档位表（按词库 freq 自动判定；冷词才有收益，热词给不给都在）**

| freq（Danbooru 投稿量级） | 权重 | 理由 |
|---|---|---|
| ≥ 100k | 裸标签 | 主流写法，模型本来就认识，加权重只是抢名额 |
| 10k–100k | 1.1 | 需要一点推力 |
| 1k–10k | 1.2 | 偏冷，不给权重容易被大词吃掉 |
| < 1k | 1.3 | 冷词，不给基本不出 |
| 库外词 / 无 freq | 裸标签 | 权重救不了词库里没有的词，只能改写成同义标签或下沉自然语 |

**硬顶与禁区**

- 全串最多 6 个加权、每层最多 2 个（库方对构图类的原话是「不超过 2 个，互相冲突」，这里推广到每层）。
- 人数与画面规模标签（`1girl`／`solo`／`2girls`／`no humans`…）**永远裸标签** —— 词库注「人数标签务必保留，权重过高会溢出角色」。
- 质量/分级前缀行（`masterpiece, best quality, score_7, safe`）永不加权 —— 词库注「质量层一般不加权，需要时轻加权」。
- 负向串**整串统一**，不逐条加权（词库注「负向整串统一，不要逐条加权」）。
- 权重**不设上限**（用户 2026-10-13 当场改的规则）：1.5 以上、乃至 `(tag:10)` 都是合法写法，用户给的数值一律照搬。高值的代价是**效果**层面的（抢同层名额、压过其余标签、构图被单一元素带走），不是语法层面的禁用。

**权重区间的口径分歧（如实记，别当铁律）**：官方模型卡说「可用但要高于 SDXL 惯用值」并给 `(chibi:2)`；dskjal 读 ComfyUI 源码指出 `AnimaTokenizer.tokenize_with_weight()` 会把 Qwen3-0.6b 侧权重重置为 1.0、t5xxl 侧仍生效，建议 3–5；社区实践区间 1.2–1.4；本地词库 `weight` 字段的分布集中在 0.8–1.5。本工具取 **1.1–1.3** 作常态档：会话实测这个区间内冷词的产出变化已经肉眼可辨，更高值开始抢名额。

**词库自带的 `weight` 字段**（22,863 条，来源 HF 模型卡）是给人看的区间，不参与打分。分布：`1.0–1.4` 8,394 条／`0.8–1.4` 6,704／`1.0–1.3` 3,758／`1.0–1.5` 1,682；带括号注的 1,058 条里写着「质量层一般不加权」「构图类建议不超过 2 个，互相冲突」「模型文字渲染弱，慎用」「负向整串统一，不要逐条加权」等口径。`confidence` 字段：中 13,898／高 7,916／待验证 1,049 —— 当参考不当铁律（`loli` 被错分在 face 组挂着表情类区间就是一例）。

**7.4 外部权重语法迁移（NAI / SD 系列 → Anima）**

别的平台把权重写成 `2::artist:nixeu::`（NAI）或 `(tag:1.4)`（SD 惯用），迁过来要做三件事：换写法、压区间、把负权重赶进负向串。

| 外部写法 | Anima 写法 | 说明 |
|---|---|---|
| `2.5::artist:nixeu::` | `(@nixeu:1.35)` | 高位压到画师带宽上限 |
| `::artist:meion::`（裸，等于 1） | `@meion` | 不动就是裸标签 |
| `0.5::artist:shexyo::` | `(@shexyo:0.8)` | 低位压到 0.8 下限 |
| `-2::cel shading::` | 删掉；负向串加 `cel shading` | Anima 没有负权重 |
| `(tag:1.4)`（SD 惯用） | 同上换算，落到 1.2–1.3 | SDXL 的高值在 Anima 会抢名额 |

**换算档（外部正权重 → Anima）：照搬，不压缩。** `2::tag::`→`(tag:2)`｜`2.5::tag::`→`(tag:2.5)`｜`3::`→`(tag:3)`｜`10::`→`(tag:10)`；`1.3::` 就是 `1.3`，不再降到 1.1。低端同理照搬（`0.5::`→`(tag:0.5)`，`0.45::`→`(tag:0.45)`）；只有 ≤0.2 才提醒一句「这个值接近把标签抹掉」。**改这条规则的由来**：旧档把高值一律压到 1.4 以下，依据是词库把画师档标成 0.8–1.4（`artist-ranked` 6,416 条）——那是词库的**建议**带宽，不是引擎限制；Anima 侧没有上限。

**三条陷阱**

- **画师名带 `@` 前缀**：词库里的条目是 `@nixeu`／`@sakimichan`／`@takeda hiromitsu`（下划线写法 `@takeda_hiromitsu` 也命中同一条），裸名 `nixeu` 查不到。少了 `@` 会被当成普通名词。
- **负权重在 Anima 没意义**：`-2::…::` 一律移进负向串（负向整串统一、不逐条加权）；NAI 的 `artist:collaboration` 对应库内 `artist collaboration`（10.8k，og:metatags），用它压「多人合作画风」；裸 `collaboration` 库外。
- **画师别堆**：一次串里画师超过 5–6 个风格会糊成一锅。库外画师名不等于模型一定不认识（本地画师库是策展表），但带 Danbooru 投稿量背书的优先用。

**7.5 「标签写了却没效果」的四层排查（第 8 期起）**

按顺序问四句，别急着换词：

1. **语法被解析了吗**：NAI/SD 的 `N::tag::` 在 Anima 侧不是语法，整段会被当普通文本切碎；Anima 只认 `(tag:1.2)`。跨平台搬串时这一层最容易漏。
2. **正负是不是在互相抵消**：正向要的效果，负向里往往有它的**上位大词**。实测 `blurry`（freq 313.8k，属 og 的「瑕疵」组）会把 `motion blur`（35.4k，技法组）按死——一边要拖影一边禁模糊。同族冲突先看 freq 差一个量级没有。
3. **权重够不够压过同行的清晰栈**：`masterpiece`／`best quality`／`absurdres`／`highres`／`ultra detailed` 这一串是「清晰先验」，技法类冷词给 1.1 抢不动，要点名效果就单独提到 1.3–1.35 并**别和十几条挤一行**。
4. **有没有运动源**：技法/构图类是「成像属性」，不是物体。静态姿势（`lying` / `on back` / `looking at viewer`）下模型没有理由拖影；要动效就配动作标签或向自然语写方向（「沿一条对角线被拖开」）。

**同类替代的硬度差**（同一题材里从小改大）：`motion blur` 35.4k ＜ `afterimage` 18.8k（残像，精选）＜ `speed lines` 14.5k ＜ **`motion lines` 125.0k**（动线，同族里最硬）；背景虚化只能写 `depth of field`（126.2k），**不要用 `blurry background`**（本库该条释义是「无面恶魔」，词条错位）。库外：`action lines` / `long exposure` / `radial blur` / `zoom blur` / `panning` / `smearing` / `smudge`。

- **花括号与方括号也是权重语法**（NAI 系）：`{{{tag}}}` = 三层强调 ≈ ×1.16，`[[tag]]` = 两层削弱 ≈ ×0.9。迁移时把它们折成数值——`{{{mesugaki regent}}}` → `(mesugaki regent:1.2)`、`[[short two side up with braided base]]` → 先同义替换再按 0.9 处理。**括号里的词组如果库外，先替换成库内同义词再折权重**，否则只是给一个不存在的词加系数。
- **一次多风格并存的写法要提醒冲突**：同一串里 `photo (medium)`（照片媒介）＋ `cel rendering`（赛璐珞）＋ `painterly`（厚涂）＋ `realistic`（写实）是四种画风抢同一批名额；`shiny skin`／`glowing skin` 与 `dull skin` 是同一维度的正反值。这类不自洽的串不用删，但要把最冷的那条提到权重上限（本库 `cel rendering` 只有 561 帖），否则四条一起被主流画风吃掉。
**7.6 年龄外观怎么调（第 8 期）**

年龄不是一条标签能扛的：它由**头身比、体块、脸部软硬**三个结构面共同决定，权重只调存在感。要更幼/更成熟，顺序是「先加结构词 → 再调权重 → 最后自然语钉死头身比」。

| 面 | 更幼（库内） | 更成熟（库内） |
|---|---|---|
| 体型 | `petite` 31.4k、`flat chest` 239.4k、`small breasts` 727.5k、`chubby`（婴儿肥） | `curvy` 77.7k、`large breasts` 2.3M、`voluptuous` |
| 年龄/身份 | `loli` 212.9k、`child` 81.4k | `mature female` 50.5k、`milf` |
| 脸 | `round face`、`wide-eyed` 54.4k、`puffy cheeks` 2.6k | ——（靠负向压 `round face`／`puffy cheeks`） |
| 画风 | `chibi` 385.4k、`super deformed` | `realistic` 32.9k、`photo (medium)` 27.4k、`painterly` 10.5k |
| 身高锚 | `height difference` 47.7k（与物件/他人同框时给刻度） | `tall` 1.7k |

**三条硬判据**

- **权重给多少都合法，但改不了比例**：`(loli:2)`、`(loli:5)` 语法上都吃（上限见 §7.4），可是 `loli` freq 212.9k 属热词，本就落在「裸标签」档；加权的收益来自**冷词**，不是来自数值大小。词库还把 `loli` 错分在 `cat=face`（挂表情类的 0.8–1.2 区间），所以它的权重主要作用在脸部簇，改不了全身比例。
- **成熟向画风词会把脸往回拉**：`realistic`／`photo (medium)`／`painterly` 的样本里「写实」＝成年比例，要幼就先把这几条降档或删掉。
- **负向先看有没有压住目标**：`chibi only`（84.5k）在负向里就是明着跟「更幼」对着干——`chibi` 是 385.4k 的强先验词，要退年龄先把它从负向拿掉（与本文件 §7.5 同一类病）。反向压制项：`mature female`、`milf`、`tall`、`curvy`、`large breasts`。
- 头身比只能靠自然语写死：「head large against a short body, limbs short and blunt, no waist curve, cheeks still round」——标签既没有刻度也没有比例语义。库外：`baby face`／`short stature`／`preteen`／`teenager`／`kid`／`tiny`／`small hands`／`child-like proportions`／`adult`（`short` 单写会别名污染到 `flandre scarlet`，别用）。

## 7.7 负向块里的 `-N::` 组 与 画师块迁移

- **负向块里的 `-N::tag::` 组＝反向削掉**：NAI 里给负向词赋负权重，语义是「不要压这些」。Anima 没有负权重 → 等价做法只有一个：**把这些词从负向拿出来**；需要它们起作用就写进正向（用户许可「可以正负提示词之间互换」）。
  实测样例（摄政王串）：`-5::five fingers, clear finger separation, correct finger positioning, natural hand pose::` → 正向 `five fingers, spread fingers, open hand`（后两条是库外词的同义替换）；`-2::chibi::` → 负向删 `chibi`、正向按需给 `chibi`，同时负向保留 `chibi only`（压「只有 Q 版」而不是压 Q 版本身）。
- **画师块（NAI `N::Artists:name::`）**：`Artists:` 前缀是 NAI 私有语法，一律去掉；名字按 Anima 写法加 `@`；权重照搬（1.7 就是 1.7，0.8 就是 0.8）；**名字里带括号的（`ame (uten cancel)` / `misumi (macaroni)` / `toma (toma50)`）裸写不加权**，避免括号嵌套。
- 画师命中率（一次 15 位实测 7 位在库）：库内 `@wlop` 401（独特性 5.06）／`@modare` 1.1k／`@freng` 680／`@greem bang` 1.1k／`@blue gk` 364／`@oekakizuki` 1.3k／`@toosaka asagi` 2.1k（模型内建）；库外 `@ushikani kassen`／`@ame (uten cancel)`／`@zhili xingzou`／`@misumi (macaroni)`／`@toma (toma50)`／`@done k,a`／`@gamarenji`／`@M2xj` —— 库外名照原话留着当文本即可，别再堆权重。
- **负向词库外不等于无效**：负向串同样过文本编码器，库外串（`out of focus`／`mutated`／`screencap`／`realism`／`low resolution`／`very displeasing`／`screentone`／`disfigured`／`acnes`／`bad body`／`too many fingers`／`floating limbs`／`disconnected limbs`／`long body`／`sketches`／`missing legs`／`natural hand pose`）照样编码，只是先验弱；要强压就换库内近义（`blurry`／`bad anatomy`／`deformed`／`malformed hands`…）。
- 负向里的拼写与别名归一到库内本名：`worstquality`→`worst quality`、`grayscale`→`greyscale`、`@_@`→`@ @`、`too many watermarks`→库内本名 `too many watermarks`。

### §7.9 权重上限取消 · 正负对冲的裁决 · 两个新坏别名（2026-10-13）

**① 上限取消（用户当场改规则）**：「anima 是允许超过 1.5 权重的，即使权重 10 也是可以的」。→ 外部权重一律照搬，不压缩；本工具自动补权仍只在冷词上给 1.1–1.3（保守档，不替用户加码）。高值的实际代价：抢同层名额、把构图带向那一个元素、颜色渗；要控制的是「哪些标签配拿高值」，不是「高值能不能写」。

**② 正负对冲的裁决**：同一个概念同时出现在正负两块时（用户在一边显式加权就是他的意图），保留**显式加权的一边**，另一边删。实例：正向 `blush` vs 负向 `2.5::sweat, blush, shy::` → 删正向的 `blush`，负向保留 `(blush:2.5)`。

**③ 负向里混进正向要的标签＝误写**，按「可以正负互换」处理：负向出现 `pointy_ears` 而正向也要尖耳 → 删负向那一条，正向保留。（这次实测：负向串里同时有 `pointy_ears` 与 `long_neck`，前者是误写，后者是真要压。）

**④ 两个新坏别名**（`--near` 实测）：

| 你写的 | 实际命中 | 正确写法 |
| --- | --- | --- |
| `asymmetrical` | `asuna (blue archive)`（经中文「不」类别名串进来） | 写完整的 `asymmetrical design` / `asymmetrical face`（库外，但不会被角色顶掉） |
| `horn` | `ibuki suika`（经中文「角」别名） | 犄角写自然语，或写更长的组合词；单写 `horn` 会被角色名吃掉 |

**⑤ 本轮新证的库内本名**（供替换用）：`hairclip` 518.3k（`black hair clip` 库外）／`forehead` 63.8k（＝露额头，`forehead visible` 库外）／`bad_leg` 769（`bad legs` 库外）／`crowd` 8.9k（`crowds` 库外）／`screentones` 5.9k（`screentone` 库外）／`ambient light`（精选，`ambient lighting` 库外）／`purple theme` 13.8k＋`black theme` 2.4k／`corset` 68.1k＋`latex` 19.6k／`translucent` 1.1k／`leather strap` 444／`gold chain` 8.3k／`spikes` 68.0k／`headpiece` 27.9k／`collar` 282.4k／`gothic`／`ornament` 677／`oil painting`／`messy` 2.1k／`ugly`。
