# 同步与验证记录：去掉条数封顶 + 两个入口默认自审（2026-10-09）

## 背景与目标

- 症状：文本入口 `gaps` 恒为 `undefined`（自审是调用方开关）；CLI 标签条数被写死的 `top: 40` 在分层**之前**截断，表现为「标签比预期少」。
- 目标：两个入口默认带缺项自审、标签条数默认不封顶，且既有输出逐字节不变。

## 执行的同步动作

- 源 `skills/anima-tag-reverse`（改后）覆盖已安装副本 `%USERPROFILE%\.dsh\skills\anima-tag-reverse`（旧版）：两边 35 个文件中仅 7 个不同，因此只覆盖这 7 个 —— `bin/rtag.mjs`、`src/index.mjs`、`src/match.mjs`、`tests/spec-audit.probe.mjs`、`SKILL.md`、`README.md`、`功能说明-自然语言分支与补全.md`。
- 覆盖前对副本做整份备份：`%USERPROFILE%\.dsh\skill-backups\anima-tag-reverse-<时间戳>\`（35 个文件）。
- 拷贝前打印两端绝对路径并断言方向；该技能目录未被父仓库跟踪，`git checkout` 回不来，回滚只靠快照。
- 本文档写入后，源目录比副本多 1 个文件（本文件），需要时按同一方向补一次拷贝。

## 验证结果与数据

- `node tests/spec-audit.probe.mjs`：**120 通过 / 0 失败**（源侧与副本侧各跑一次，exit=0）。
- 逐字节复核：35 个文件 SHA256 全部一致。
- 图像样张：窄召回 **33 条**、`--broad` **41 条**（旧文档的 38 条是 `top: 40` 砍出来的假口径，API 一直是 41）。
- 文本入口 `--format json`：新增 `gaps` / `gapsSummary` / `gapsMarkdown` 三个键（此前不存在）。
- 六套自测：36 / 120 / 58 / 45 / 30 / 27，**0 失败**。

## 后续注意事项

- 副本内没有 `kb-path.json`：不设 `ANIMA_KB_DIR`、不传 `--kb`、且 cwd 不在仓库内时，会报「找不到 Anima 词库目录（需要含 manifest.json + search-index.json 的文件夹）」；面板侧调用需保证词库路径可得。
- 回滚材料：`.scratch\rollback-before-cap-removal\`（7 个改动前原文件）与上面的备份目录。
- 文档口径以 **41 条 / 120 例**为准；旧文档里的 38 条、112 例已作废，勿再抄回。
