# anima-tag-reverse

Anima 反推提示词技能 + 中文标签知识库。把「中文一句话描述」转成 **Anima 2B** 能吃的英文单行提示词，附一个可离线搜索 **38,306 条标签**的展览板。

```
node bin/rtag.mjs "银发红瞳的少女，黑色连衣裙，站在月光下的教堂前"
→ red pupils, girl, dress, church, moonlight, silver hair
```

开箱即用：运行时**零第三方依赖**，不用联网，不用 `npm install`（词库搜索用本地打包的 Fuse.js）。

## 三个技能

本仓库的 `skills/` 下有三个技能，共用同一套词库与分层排序。`anima-tag-reverse` 是引擎，另两个是它的姊妹技能，各管一件它不做的事：

| 技能 | 干什么 | 一句话例子 |
|---|---|---|
| **[`anima-tag-reverse`](skills/anima-tag-reverse/README.md)** | 单图 / 纯文本 → 标签串（引擎本体） | 「银发红瞳的少女站在教堂前」→ `red pupils, girl, church, silver hair` |
| **[`anima-tag-merge`](skills/anima-tag-merge/README.md)** | **多图**按自然语言指令融合成一条标签串 | 「图1的姿势换到图2的人身上」→ 图2 的人 + 图1 的姿势 |
| **[`anima-tag-character`](skills/anima-tag-character/README.md)** | 「**具体作品 + 具体角色**」→ 精确角色/作品标签 | 「原神 可莉」→ `klee (genshin impact), genshin impact` |

三者可串联：`anima-tag-character` 先把观察 JSON 里的中文角色名就地修正，再喂给 `anima-tag-reverse` 或 `anima-tag-merge`。各技能的详细说明见其目录下的 `README.md` 与 `SKILL.md`。

- 技能版本 v1.1.0 ｜ 词库构建日 2026-10-06（与 v1.0.0 相同，词库未变）｜ 38,306 条标签 / 69 个大分类 · 711 个小分类 / 官方组条目 9,645 条
- 仓库含三个技能：`anima-tag-reverse` v1.1.0、`anima-tag-merge`、`anima-tag-character`（后两者为姊妹技能，复用同一套词库）
- 发行版本 **v1.2.0**（发布包版本号，与技能版本号是两件事）
- 环境：**Node.js 18+**（Windows / macOS / Linux 通用），不需要 Python、不需要浏览器插件

> **生成声明**：本仓库的全部内容 —— 技能代码（`bin/`、`src/`、`tests/`、`tools/`）、词库的整理与构建流水线、展览板页面与样式、以及所有文档 —— 均由 AI 生成与完成，没有经过人工逐行审阅与实测，请自行评估后再用于生产。能核实的自动化检查只有 `node tests/smoke.mjs` 的 36 条自测与 `node tests/spec-audit.probe.mjs` 的行为探针，除此之外没有别的测试背书。这条只说明内容是怎么产出的，与第 7 节的授权状态是两件不同的事：本仓库未附开源许可证文件，默认保留所有权利，不因上面这句话而改变。

---

## 1. 三十秒上手

克隆或下载本仓库后：

```bash
cd skills/anima-tag-reverse      # 注意：所有命令都在技能目录里跑
node tests/smoke.mjs             # 预期：36 通过 / 0 失败
node bin/rtag.mjs "银发红瞳的少女，黑色连衣裙，站在月光下的教堂前"
```

看到 `red pupils, girl, dress, black dress, church, moonlight, silver hair` 这一行，就说明技能、词库、跨目录定位全都正常。

不想克隆仓库？到 [Releases](https://github.com/T0mCaTTT/anima-tag-reverse/releases) 下载 `anima-tag-reverse-v1.2.0.zip`（精简档，3.6 MB）解压即用，包根目录有一份面向终端用户的 `README.md`。需要词库构建原料（`categories/`、`data/`）时改下 `-full` 档（7.9 MB）。

---

## 2. 仓库内容

```
anima-tag-reverse/
├── README.md                     本文件
├── NOTICE-third-party.md         第三方数据来源与署名声明（务必读）
├── skills/anima-tag-reverse/     技能本体：SKILL.md、bin/、src/、tests/、tools/
│   ├── src/nl.mjs                英文自然语言分支（v1.1.0 新增）
│   ├── src/gaps.mjs              缺项检测与候选项（v1.1.0 新增）
│   ├── src/hints.mjs             规则补充层：人数 / 性别 / 中文拆解词表（v1.1.0 新增）
│   └── 功能说明-自然语言分支与补全.md   自然语言与补全功能的主文档（v1.1.0 新增）
├── skills/anima-tag-merge/       姊妹技能：多图融合（复用 reverse 的词库与排序）
│   ├── bin/merge.mjs             CLI：--img a.json --img b.json "把图1的姿势换到图2的人身上"
│   └── src/intent.mjs            跨图自然语言理解（图指代 / 维度词 / 组合宏 / 方向判定）
├── skills/anima-tag-character/   姊妹技能：作品 + 角色 → 精确标签（复用 reverse 的词库）
│   ├── bin/char.mjs              CLI：resolve / series / search / verify / patch
│   └── src/resolve.mjs           作品消歧、残条目降权、未命中如实报「库里没有」
└── anima-tag-kb/                 中文标签知识库
    ├── anima-tag-exhibition.html 展览板页面（数据全在本地）
    ├── viewer/ assets/ vendor/   页面脚本、样式、静态资源、Fuse.js
    ├── scripts/                  本地静态服务 + 词库重建流水线
    ├── 画师类/                   词库主体：manifest.json + search-index.json + bigs/*.json
    ├── 分类树概览.md             69 个大分类 → 711 个小分类的全貌
    ├── 官方组中英对照表.md        Danbooru 官方组中英对照
    └── 设计规范.md               页面与字段的设计约定
```

层级是刻意保留的：技能会从「自己所在仓库的根目录」往下找 `anima-tag-kb/画师类`，所以克隆下来就能用，**不需要配任何路径**。

**不在本仓库、但发布包里有的文件**（体积大或属于构建原料，见 `.gitignore`）：

| 文件 | 哪来的 |
|---|---|
| `anima-tag-kb/tags.json`（15.5 MB 扁平全量标签）、`tags-index.jsonl` | 构建产物，两个档都带（精简档也含），或跑 `scripts/build-*.mjs` 重建 |
| `anima-tag-kb/categories/`（旧 87 类目存档） | 已被 `画师类/` 取代，仅随 `-full` 档分发 |
| `anima-tag-kb/data/`（构建原料、原始 dump、QA 截图） | 构建原料，仅随 `-full` 档分发；原始 dump 不随任何一档分发 |
| `skills/anima-tag-reverse/kb-path.json`、姊妹技能的 `engine-path.json` | 本机路径指针，由安装脚本在你机器上生成 |

---

## 3. 四种用法

### 3.1 直接在仓库里跑（最快）

```bash
cd skills/anima-tag-reverse
node bin/rtag.mjs "场景描述"                    # 默认：单行纯标签串
node bin/rtag.mjs --format prompt "场景描述"     # 带官方前缀（masterpiece, best quality, score_7, 分级）
node bin/rtag.mjs --format md "场景描述"         # 分层报告，方便核对选词理由
node bin/rtag.mjs --format json "场景描述"       # 结构化输出，给程序吃
node bin/rtag.mjs --nl "场景描述"                # 英文自然语言句子（v1.1.0 新增）
node bin/rtag.mjs --gaps "场景描述"              # 缺项清单 + 可勾选候选项（v1.1.0 新增）
node bin/rtag.mjs --check "场景描述"             # 标签 + 负向 + 自然语言 + 缺项，一次给全（v1.1.0 新增）
node bin/rtag.mjs --broad --check "场景描述"     # 先宽召回再自审，候选池更大（v1.1.0 新增）
node bin/rtag.mjs --search "blue eyes"          # 单条检索：中文名 / 频次 / 所属分类
node bin/rtag.mjs --info                        # 词库概况
node bin/rtag.mjs --help                        # 全部参数
```

`--format bare` 与 `--format tags` 是同义词（都输出不带官方前缀的单行标签串）。`--nl`、`--gaps`、`--check` 会接管 `--format`；想强制回默认标签串就显式写 `--format tags`。

### 3.2 装成 DSH 用户技能（在技能中心可见、可开关）

```bash
cd skills/anima-tag-reverse
node tools/install-dsh-skill.mjs            # 复制到 ~/.dsh/skills/anima-tag-reverse
node tools/install-dsh-skill.mjs --check    # 只比对差异，不改动；有差异退出码 2
node tools/install-dsh-skill.mjs --force    # 覆盖；覆盖前自动备份到 ~/.dsh/skill-backups/
```

装完重启 DSH（或在技能中心刷新），`anima-tag-reverse` 就会出现在「用户技能」列表里。安装脚本会在目标机器上**重新生成** `kb-path.json`，写的是你当前这套词库的绝对路径；以后挪动词库目录，重跑一次安装脚本即可。

**姊妹技能同理**，各自带一份安装脚本：

```bash
cd skills/anima-tag-merge
node tools/install-dsh-skill.mjs            # 复制到 ~/.dsh/skills/anima-tag-merge

cd ../anima-tag-character
node tools/install-dsh-skill.mjs            # 复制到 ~/.dsh/skills/anima-tag-character
```

两个姊妹技能**不重复打包词库**，它们靠安装时生成的 `engine-path.json` 指向 `anima-tag-reverse` 的安装目录来复用引擎。所以**先装 `anima-tag-reverse`，再装它们**；之后挪动 `anima-tag-reverse` 的目录，姊妹技能的 `engine-path.json` 要重跑安装脚本更新。

### 3.3 手工丢进技能目录

不用脚本也行：把 `skills/anima-tag-reverse/` 整个拷到 `<用户主目录>/.dsh/skills/` 下，并在技能目录里写一个 `kb-path.json`：

```json
{ "kbDir": "<词库绝对路径>/anima-tag-kb/画师类" }
```

姊妹技能手工安装时，则在各自目录里写一个 `engine-path.json`，指向 `anima-tag-reverse` 的安装目录：

```json
{ "engineDir": "<用户主目录>/.dsh/skills/anima-tag-reverse" }
```

### 3.4 只用知识库（不装技能）

展览板是纯静态页面加一个本地小服务：

```bash
cd anima-tag-kb
node scripts/serve-kb.mjs                 # 默认 http://127.0.0.1:8100
node scripts/serve-kb.mjs 8200            # 换端口
node scripts/serve-kb.mjs 8100 --no-open  # 不自动开浏览器
```

Windows 上也可以双击 `anima-tag-kb/启动展览板.cmd`。端口被占用时服务会自动往后找可用端口，页面上显示实际地址。**不要直接双击 HTML**：数据是用 `fetch` 按需加载的，`file://` 下浏览器会拦掉。

---

## 4. 目录与模块说明

### `skills/anima-tag-reverse/`

```
SKILL.md              技能定义（frontmatter + 用法），DSH 只读这个文件
README.md             技能自己的详细说明：匹配逻辑、评级规则、改动记录
功能说明-自然语言分支与补全.md   自然语言分支与缺项补全的主文档（能力表、实现、示例、已知缺口）
bin/rtag.mjs          CLI 入口，所有命令都从它进
src/index.mjs         编排：解析 → 归一化 → 匹配 → 分层 → 合成
src/parse.mjs         拆句、识别「视角 / 环境 / 动作」等句法槽、人数口径
src/normalize.mjs     全半角、简繁、错别字与同义词归一
src/hints.mjs         规则补充层：人数 / 性别 / 中文拆解 / 短别名等词表
src/match.mjs         候选召回 + 打分 + 六道压制 + 备选池（含中文字集兜底相似度）
src/lexicon.mjs       词库加载与索引（读 manifest.json + search-index.json + bigs/*.json）
src/compose.mjs       按官方顺序合成单行提示词
src/nl.mjs            英文自然语言分支（确定性句子骨架 + 措辞表）
src/gaps.mjs          缺项检测：未匹配 / 关键层为空 / 粒度不足 / 观察缺项 / 多主体不全 / 同维度冲突
src/image-spec.mjs    图像观察入口与规格建议（默认带缺项自审）
src/jp-lexicon.mjs    日文标签辅助词典
src/config.mjs        路径定位与调参：词库在哪、阈值、宽召回档
tests/smoke.mjs       36 条端到端自测（中 / 英 / 日 / 图像 / R18 / 中文兜底 + 自然语言 6 + 缺项 4 + CLI 6）
tests/spec-audit.probe.mjs   行为探针：默认档、必填维度、别名归一、既有契约
tests/cli-run.probe.mjs      CLI 采集小工具（分离 stdout 与 stderr）
tests/img-spec.sample.json   图像观察样张
tests/fat-tags.diag.mjs      诊断脚本：胖标签分布（非断言套件）
tests/fat-tags-attrib.mjs    诊断脚本：胖标签归因（非断言套件）
tools/install-dsh-skill.mjs   装到 ~/.dsh/skills（--check / --force）
tools/toggle-dsh-skill.mjs    开关技能（改 frontmatter 的 disable-model-invocation）
tools/list-single-cjk.mjs     列出单字中文标签，便于体检词库
```

### `anima-tag-kb/`

```
anima-tag-exhibition.html  展览板页面
viewer/                    页面脚本与样式
assets/                    logo、图标等静态资源
vendor/fuse.min.js         本地打包的 Fuse.js（离线搜索用，Apache-2.0）
scripts/serve-kb.mjs       本地静态服务 + /api/collections 收藏接口
scripts/build-*.mjs        词库重建流水线（需要自备 data/sources/ 原始 dump）
画师类/manifest.json       词库总目录：69 个大分类 + 711 个小分类的元数据
画师类/search-index.json   检索索引（12 列，38,306 行）
画师类/bigs/*.json         分片数据，按 manifest 的 files[] 指向加载
画师类/README.md           词库字段约定
```

---

## 5. 验证方法

按顺序做，五条都过就是完好的。

```bash
# 1) 技能自测：36 条用例
cd skills/anima-tag-reverse
node tests/smoke.mjs                      # 预期：36 通过 / 0 失败

# 1b) 姊妹技能自测（各自目录下跑）
cd ../anima-tag-merge      && node tests/smoke.mjs   # 预期：全部通过：110 项断言
cd ../anima-tag-character  && node tests/smoke.mjs   # 预期：全部通过：64 项断言
cd ../anima-tag-reverse

# 2) 词库定位与元信息
node bin/rtag.mjs --info                  # 预期：打印「词库：…/anima-tag-kb/画师类」+ bigs 69 / subs 711

# 3) 中英日各来一条
node bin/rtag.mjs "银发红瞳的少女，黑色连衣裙，站在月光下的教堂前"
node bin/rtag.mjs "銀髪の少女が桜の木の下で微笑んでいる"
echo "1girl, silver hair, red eyes, black dress" | node bin/rtag.mjs -
# 预期：各输出一行英文标签，逗号分隔，不带 masterpiece 之类官方前缀

# 4) 自然语言与缺项自审（v1.1.0 新增）
node bin/rtag.mjs --nl "银发红瞳的少女，黑色连衣裙，站在月光下的教堂前"
# 预期：英文句子，例如 One girl. The character has red pupils, church, silver hair. She is wearing a dress, a black dress. …
node bin/rtag.mjs --gaps "银发红瞳的少女"
# 预期：### 缺项清单与候选项，含「缺口 N 条，候选项合计 M 个」与 B* / C* 分节
node bin/rtag.mjs --image-spec tests/img-spec.sample.json > tags.txt
# 预期：tags.txt 里只有一行纯标签串；缺项摘要与建议写法走 stderr，不污染 stdout

# 5) 展览板能起
cd ../../anima-tag-kb
node scripts/serve-kb.mjs 8123 --no-open
# 预期：日志打印「地址：http://127.0.0.1:8123/anima-tag-exhibition.html」
# 浏览器打开该地址应看到分类树；切到「收藏」再刷新，收藏仍在（落盘在 data/collections.json）
```

收藏接口的壳（想用脚本灌数据时才需要）：

```bash
curl http://127.0.0.1:8100/api/collections                       # GET  → {v, items, tombstones, updatedAt}
curl -X POST http://127.0.0.1:8100/api/collections \
     -H "Content-Type: application/json" \
     --data '{"v":1,"items":["silver hair","girl"],"tombstones":{}}'   # → {ok:true,count,file}
```

校验 Release 压缩包：

```bash
# Linux / macOS / Git-Bash
sha256sum -c SHA256SUMS-core.txt          # 预期：OK
# Windows PowerShell
Get-FileHash anima-tag-reverse-v1.2.0.zip -Algorithm SHA256   # 与 SHA256SUMS-core.txt 比对
```

`SHA256SUMS-core.txt` 里同时列了 `FILELIST-core.txt` 的哈希。想逐个文件核对包内容，解压后在该目录跑：

```bash
sha256sum -c FILELIST-core.txt --quiet    # 预期：无输出，180 个文件全部吻合
```

完整档把上文的 `core` 换成 `full` 即可（`SHA256SUMS-full.txt` / `FILELIST-full.txt`，287 个文件）。

---

## 6. 常见问题

**提示 `找不到 Anima 词库目录…`**
技能没找到 `anima-tag-kb/画师类`。三种解法：保持「顶层同时有 `skills/` 和 `anima-tag-kb/`」的层级别打散；或显式指定 `node bin/rtag.mjs --kb <词库路径> "..."`；或设环境变量 `ANIMA_KB_DIR=<词库路径>`。报错信息里会列出所有试过的目录，照着对一眼就知道差在哪。

**提示 `--kb 参数指向的目录里没有词库`**
`--kb` 或 `ANIMA_KB_DIR` 指定的目录里缺 `manifest.json` 或 `search-index.json`（多半是指到了 `anima-tag-kb/` 而不是 `anima-tag-kb/画师类/`）。显式指定写错会直接失败、不会悄悄换另一个词库，这是有意为之。

**中文文件名乱码 / 解压报错**
发布包内文件名是 UTF-8 标记的。Windows 10 1803 以前自带解压可能不认，请用 7-Zip、Bandizip 或 `tar -xf`（Win10+ 自带 tar 也行）。macOS 用「归档实用工具」或 `unzip` 都正常。

**`node: command not found`**
装 Node.js 18+（nodejs.org 的 LTS 即可）。`启动展览板.cmd` 也会先检查 Node 并给提示。

**端口被占用**
`serve-kb.mjs` 会自动改用下一个可用端口，并以实际地址打开浏览器。想固定端口就 `node scripts/serve-kb.mjs 8200`。

**展览板能开，但点分类提示载入失败**
缺 `画师类/manifest.json` 或 `画师类/bigs/`。确认词库目录完整。

**收藏点不动 / 刷新就没了**
收藏走 `/api/collections` 存到 `anima-tag-kb/data/collections.json`。`data/` 目录不存在时服务会自动创建；解压目录没有写权限时会失败。直接双击 HTML（`file://`）打开时接口不可用，请用 `serve-kb.mjs` 起服务再访问。

**一定要联网吗**
不用。搜索用本地打包的 Fuse.js，数据全在磁盘上。

**重跑 `scripts/build-*.mjs` 报缺文件**
那是重建词库的流水线，需要 `data/sources/` 原始 dump（**不随本仓库与发布包分发**，见 `anima-tag-kb/README.md` 与 `NOTICE-third-party.md`）。日常使用不需要重建。

**`--image-spec` 为什么在标签串之外还多打了一行字**
那是缺项自审的摘要，默认开启，写在 **stderr**，所以 `node bin/rtag.mjs --image-spec x.json > tags.txt` 得到的 `tags.txt` 仍然只有一行纯标签串。不想要摘要就加 `--no-gaps`；想直接看候选项用 `--format gaps`（它不受 `--no-gaps` 影响）。

**怎么让它输出英文自然语言句子**
加 `--nl`（等价于 `--format nl`）。句子是确定性骨架拼的：人数 → 角色外观 → 服装 → 动作 → 场景 → 画风，措辞过一层内置短语表，查不到专属措辞的标签按标签原文出现在句子里。想限制每句短语数量用 `--max-per-sentence N`（默认 12）；骨架本身可以用 `--nl-template` 打印出来。
注意纯 `--nl` 只打印句子：角色名 / 作品名 / 画师名这类没有句子槽位的标签留在配套的标签行里（API 的 `nl.tagLine`，md 版会作为「标签骨架」一并列出），要一次看全就用 `--format check` 或 `--format json`。

**`--broad` 会让标签变多吗**
会，它是显式打开的一次性宽召回档：最低分放宽、每分句候选与备选池扩大、词元预算提高，图像样张的标签行从 33 条变成 38 条。默认档不动是为了「同一句话每次跑出同样的标签串」；只在候选不够用（比如缺项候选项太少）时才开它，`--no-broad` 与默认同档。

**用 `--kb` 指错目录会不会静默跑偏**
不会。从 v1.0.0 起，`--kb` / `ANIMA_KB_DIR` 指向的目录不合格会直接报错退出（退出码 1），不会退回到别的词库。

---

## 7. 数据来源与署名

本仓库的标签数据整理自以下公开来源，**著作权归各自原作者**；详见 [NOTICE-third-party.md](NOTICE-third-party.md)。

| 来源 | 内容 | 授权/说明 |
|---|---|---|
| [WeiLin-Comfyui-Tools-Prompt](https://github.com/weilin9999/WeiLin-Comfyui-Tools-Prompt)（weilin9999） | 约 4.98 万条官方中文译名 + 131 个二级分类 | 本知识库的**中文译名与二级分类对齐依据**；原始 dump 未随仓库分发，仅保留整理后的译文与分类结果。请遵守原仓库的授权与署名要求 |
| [Danbooru](https://danbooru.donmai.us/wiki_pages/tag_groups) | 官方 `tag_group`（56 组 / 662 小节）、全站标签榜与投稿量 `freq` | 标签事实数据来源于站点公开页面；原始 dump 未随包分发 |
| [ai-tag-toolbox](https://github.com/star-abyss/ai-tag-toolbox)（star-abyss） | 约 18,093 行社区标签与同义词 | 社区标签补充与同义词归一 |
| 画廊站点对照（yande.re / safebooru / e-shuushuu） | 标签使用频次对照 | 仅用于校验，未分发 |
| 本地策展库（本项目自建） | 13 个策展分类、中文释义、置信度 | 本项目自有整理 |

- `anima-tag-kb/vendor/fuse.min.js` 是 [Fuse.js](https://www.fusejs.io/)，**Apache-2.0**，许可证随库文件保留，未作修改。
- **本仓库当前未附开源许可证文件**（默认保留所有权利）。如需在其它项目中使用技能或词库代码，请先联系作者；二次分发标签数据前请向上述原作者确认授权。

---

## 8. 相关

- 技能详细说明（匹配逻辑、评级规则、改动记录）：[`skills/anima-tag-reverse/README.md`](skills/anima-tag-reverse/README.md)
- 自然语言分支与缺项补全的功能说明：[`skills/anima-tag-reverse/功能说明-自然语言分支与补全.md`](skills/anima-tag-reverse/功能说明-自然语言分支与补全.md)
- 多图融合（姿势/场景/外观/画风按维度换源）：[`skills/anima-tag-merge/README.md`](skills/anima-tag-merge/README.md)
- 作品 + 角色 → 精确标签（作品消歧、未命中如实报空）：[`skills/anima-tag-character/README.md`](skills/anima-tag-character/README.md)
- 词库设计、构建流水线与字段约定：[`anima-tag-kb/README.md`](anima-tag-kb/README.md)
- 69 个大分类 / 711 个小分类全貌：[`anima-tag-kb/分类树概览.md`](anima-tag-kb/分类树概览.md)
