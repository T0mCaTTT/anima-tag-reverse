#!/usr/bin/env node
/**
 * rtag.mjs —— 命令行入口（技能在会话里调用它，也可以单独跑）
 *
 *   默认输出就是交付形态：混合形态（第 6 期起）——第一行是质量/分级行，接着按层各一行标签，
 *   每行行尾保留逗号；空一行后是一句英文自然语言；再空一行打负向词。没有解释、没有 markdown。
 *
 *   node bin/rtag.mjs "长发蓝发少女坐在教室里读书，夜晚，逆光"
 *   node bin/rtag.mjs "…" --format tags                 # 旧形态：一行逗号分隔的纯标签串
 *   node bin/rtag.mjs --file 描述.txt --format bare     # 不含官方前缀的纯标签
 *   node bin/rtag.mjs - < 描述.txt
 *   node bin/rtag.mjs --image-spec 观察.json
 *   node bin/rtag.mjs --search "blue eyes" --top 8
 *   node bin/rtag.mjs --info
 *   node bin/rtag.mjs --template > 观察模板.json
 *   node bin/rtag.mjs "…" --format md                   # 带分层与分数的人类报告
 *   node bin/rtag.mjs "…" --loose plain                 # 「没接住」的说法跟在句尾（默认只报条数）
 *   node bin/rtag.mjs --theme-list                      # 列出主题配方（外部模板 §14 的十二个）
 *   node bin/rtag.mjs "…" --theme ntr                   # 把该主题的标签注入交付串
 *   node bin/rtag.mjs "…" --no-view-default             # 单人场景不加 direct eye contact / facing viewer
 *
 * 第 6 期并入的外部模板规则（互斥提醒 / 标签总数区间 / 单人默认视线 / 主题配方）只**提醒**不拦截：
 * 交付串原样给出，末尾多一行 / JSON 的 annotate 与 gaps 里记一条，规则表在 references/anima3-rules.json。
 *
 * 内容不作任何审查 / 过滤：R18、NSFL 元素照常解析、照常匹配、照常出现在输出的标签串里；
 * 只有前缀里的分级 token 会按命中内容适配（内置三档 safe → sensitive → nsfw，档名由面板配置决定），
 * 以便标签串符合常见标签库的规定格式。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLexicon, reverse, searchTags, kbInfo, poolPath, emptySpec, LAYER_NAME, nlTemplate, hybridBlock, looseTail, loadRules, viewDefaultTags, themeList, themeById, themePlan } from '../src/index.mjs';
import { loadPanelConfig, resolveTier, tierNames, migrationTable, warnLine, configRef } from '../src/panel-config.mjs';
import { buildPolicy } from '../src/tier-policy.mjs';
import { dialoguePlan, formatDialoguePlan } from '../src/dialogue.mjs';

/**
 * 第 5 期：读取唯一真理源（面板配置文件）。
 * 顺序：$DSH_ANIMA_PANEL_CONFIG > $DSH_HOME/anima-panel/panel-config.json > <技能目录>/panel-config.json；
 * 都没有就用内置默认。文件存在但非法时**不半生效**，而是整份跳过并打一行 stderr 告警。
 */
const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const panelCfg = loadPanelConfig({ skillDir: SKILL_DIR });

const argv = process.argv.slice(2);
// top 不给默认值：只有显式 --top N 才截断（旧默认 40 会在分层之前先切一刀，
// 砍掉的正是全局分数最低的那几条，表现成「标签比预期少」）。
const opt = { format: 'hybrid' };            // 第 6 期：默认混合形态（分层标签块 + 一句自然语言）
let formatSet = false;                       // 用户是否显式写过 --format（下面几个开关靠它决定让不让位）
const positional = [];

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const next = () => argv[++i];
  switch (a) {
    case '--text': positional.push(next()); break;
    case '--file': opt.file = next(); break;
    case '--image-spec': opt.spec = next(); break;
    case '--search': opt.search = next(); break;
    case '--kb': opt.kbDir = next(); break;
    case '--top': opt.top = parseInt(next(), 10); break;
    case '--per-clause': opt.perClause = parseInt(next(), 10); break;
    case '--min': opt.minScore = parseFloat(next()); break;
    case '--min-sim': opt.minSim = parseFloat(next()); break;
    case '--max-per-layer': opt.maxPerLayer = parseInt(next(), 10); break;
    case '--format': opt.format = next(); formatSet = true; break;
    case '--rating': opt.rating = next(); break;
    case '--loose': opt.looseMode = next(); break;                 // 第 6 期：查不到对应标签的说法怎么交代（off / plain / marker / line）
    case '--no-tier-token': opt.tierToken = false; break;          // 面 1：标签串里不写档位名（面板默认带）
    case '--tier-token': opt.tierToken = true; break;
    case '--dialogue':                                             // 面 3：打印本档该读的 dialogue-style 章节
      opt.dialogue = true;
      if (!formatSet) opt.format = 'dialogue';
      break;
    case '--prefix': opt.prefix = next(); break;
    case '--no-prefix': opt.prefix = ''; break;
    case '--negative': opt.negative = next(); break;
    case '--no-weights': opt.weights = false; break;
    case '--info': opt.info = true; break;
    case '--template': opt.template = true; break;
    // ---- 本轮新增 ----
    case '--broad': opt.broad = true; break;                       // 宽召回档（多捞候选，默认档位不变）
    case '--no-broad': opt.broad = false; break;
    case '--pool': opt.phrasePool = true; break;                   // 第 4 期 ③：读补充短语池（面板 lexicon.poolEnabled 的 CLI 等价物）
    case '--no-pool': opt.phrasePool = false; break;
    // ---- 第 6 期：ANIMA3 模板规则（互斥提醒 / 总数区间 / 单人默认视线 / 主题配方）----
    case '--theme': opt.theme = next(); break;                     // §14 十二主题之一：把该主题的标签注入交付串
    case '--theme-list': opt.themeList = true; break;              // 只列主题，不用给输入
    case '--no-view-default': opt.noViewDefault = true; break;     // 不加单人默认视线（direct eye contact / facing viewer）
    case '--view-default': opt.viewDefaultForce = true; break;     // 旧形态（tags/prompt/json…）也加单人默认视线
    case '--no-hints': opt.noHints = true; break;                  // 末尾不打互斥 / 总数提醒
    // 这三个开关同时改变输出形态：只有用户没显式写 --format 时才接管它，
    // 否则 --gaps / --check / --nl 只是生成附加产物（默认输出仍是混合形态）。
    case '--gaps':
      opt.gaps = true; opt.alternatives = true;
      if (!formatSet) opt.format = 'gaps';
      break;
    case '--check':
      opt.gaps = true; opt.alternatives = true; opt.nl = true;
      if (!formatSet) opt.format = 'check';
      break;
    case '--nl':
      opt.nl = true;
      if (!formatSet) opt.format = 'nl';
      break;
    // 关掉缺项自审（图像入口默认开）；文本入口本来就不带默认，写这个等于显式关掉
    case '--no-gaps': opt.gaps = false; break;
    case '--with-tags': opt.nlWithTags = true; break;
    case '--no-tags': opt.nlWithTags = false; break;
    case '--max-per-sentence': opt.maxPerSentence = parseInt(next(), 10); break;
    case '--nl-template': opt.nlTemplate = true; break;
    case '-h': case '--help': opt.help = true; break;
    case '-': opt.stdin = true; break;
    default: positional.push(a);
  }
}

// --format 决定了需要哪些附加产物，这里补齐开关，避免用户还得再写一遍 --nl / --gaps
if (opt.format === 'nl') opt.nl = true;
if (opt.format === 'gaps') { opt.gaps = true; opt.alternatives = true; }
if (opt.format === 'check') { opt.nl = true; opt.gaps = true; opt.alternatives = true; }
// 第 6 期：混合形态自带末尾那句自然语言，所以也要跑 nl 分支；
// 但标签块已经在上面印过了，句末就不再重复贴一遍标签串（显式 --with-tags 仍然照办）。
if (opt.format === 'hybrid') opt.nl = true;
if (opt.nlWithTags === true) opt.nlOptions = { ...(opt.nlOptions || {}), withTags: true };
if (opt.nlWithTags === false) opt.nlOptions = { withTags: false };
if (opt.maxPerSentence) opt.nlOptions = { ...(opt.nlOptions || {}), maxPerSentence: opt.maxPerSentence };
if (opt.format === 'hybrid' && opt.nlWithTags === undefined) opt.nlOptions = { withTags: false, ...(opt.nlOptions || {}) };

// ---- 第 5 期：档位表来自面板配置（唯一真理源），配置读坏了就在这里报警 ----------
const TIERS = tierNames(panelCfg.config);
opt.tierNames = TIERS;
if (panelCfg.warnings.length) console.error(warnLine(panelCfg.warnings, panelCfg.config));

// 档名校验：旧档位名（questionable / explicit）与手滑写错的档名都**硬报错退出**，
// 不做静默改名——否则分级 token 会被原样写进交付串（旧值 explicit 会污染标签行）。
if (opt.rating !== undefined) {
  const t = resolveTier(panelCfg.config, opt.rating);
  if (!t.ok) {
    console.error('出错：' + t.message);
    console.error(t.kind === 'legacy' ? migrationTable(panelCfg.config) : `当前档位表：${TIERS.join(' / ')}`);
    console.error('（档位在面板「档位管理」里改；配置文件：' + configRef(panelCfg.source) + '）');
    process.exit(1);
  }
  opt.rating = t.name;
}

// ---- 第 1–2 期：把档位翻译成四个面的具体策略（面 1 前缀 / 面 2 负面 / 面 4 档位门 / 面 5 候选松紧）----
// 铁律：**没有显式 --rating 时一切行为与改造前逐字节一致**（只做档名校验与失败退出）。
// 面板调用时总是显式传档位（这样负面词、候选、档位门才跟面板选择一致），
// 并额外带 --no-tier-token，避免把档位名混进给用户复制的标签串。
opt.tierPolicy = buildPolicy({
  panel: panelCfg,
  rating: opt.rating,
  tierToken: opt.tierToken,
  broad: opt.broad
});

// ---- 第 4 期（面 3「压字」）：选篇只在显式档位下有意义，缺档位 / 面被关掉都硬报错，不静默给一份错的 ----
if (opt.format === 'dialogue') {
  if (!opt.tierPolicy.explicit) {
    console.error('出错：--dialogue 需要显式档位（写 --rating <档名>）。');
    console.error('没有档位时五个面整体关闭，压字不会替你挑篇（不传档位 = 与旧版逐字节一致）。');
    console.error(`当前档位表：${TIERS.join(' / ')}`);
    process.exit(1);
  }
  if (!opt.tierPolicy.dialogueEnabled) {
    console.error('出错：压字选篇（faces.dialogueSection）在这份配置里被关掉了。');
    console.error('（面板「压字」区块的开关；配置文件：' + configRef(panelCfg.source) + '）');
    process.exit(1);
  }
}

// ---- 第 4 期 ③：补充短语池开关（面板 lexicon.poolEnabled 是真理源；--pool / --no-pool 可覆盖）----
// 池默认关闭：不打开时词库就是主索引那一份（现 39,216 行），输出与旧版逐字节一致。
// 注意选项名是 phrasePool：match.mjs 的 opts.pool 是「备选候选数组」，不能被这个布尔顶掉。
if (opt.phrasePool === undefined) opt.phrasePool = panelCfg.config.lexicon?.poolEnabled === true;

// ---- 第 6 期：ANIMA3 模板规则（互斥提醒 / 标签总数区间 / 单人默认视线 / 主题配方）----
// 规则表在技能内部：references/anima3-rules.json（core 包不含 KB，规则必须活在技能里）。
// 这几项都是**增值提醒**，所以读表失败只打一行告警、不硬失败——与档位校验那种
// 「宁可退出也不给一份错的」语义不同：交付串本身不受它们影响。
const HINT_FORMATS = new Set(['hybrid', 'check', 'gaps', 'json']);
let RULES = null;
let rulesTried = false;
const rules15 = () => {           // 名字带 15 只是避免与面板配置变量重名
  if (rulesTried) return RULES;
  rulesTried = true;
  try { RULES = loadRules(); } catch (e) {
    console.error('提醒：ANIMA3 规则表读不了（' + e.message + '）——互斥提醒、主题配方、单人默认视线这次都不生效');
    RULES = null;
    opt.annotate = false;
  }
  return RULES;
};
if (!opt.noHints && HINT_FORMATS.has(opt.format)) opt.annotate = true;
// 单人默认视线（模板 §4.3，用户裁决「默认加」）：数据交给 compose，它按「是否单人 + 有没有要求背影/侧脸」自己判。
// **只在新形态（hybrid / check）里默认注入**：`--format tags|prompt|line|bare|json` 是旧形态，
// 逐字节不变的契约还在（多处自测与面板都钉着），要在这个基础上加视线请显式写 --view-default。
const VIEW_DEFAULT_FORMATS = new Set(['hybrid', 'check']);
if (!opt.noViewDefault && (opt.viewDefaultForce || VIEW_DEFAULT_FORMATS.has(opt.format)) && !opt.theme) {
  const r = rules15();
  const v = r ? viewDefaultTags(r) : [];
  if (v.length) opt.viewDefault = v;
}
// 主题配方：把该主题的标签查上词库信息（层 / 中文）再交给 compose 注入；查不到的标签在末尾提醒里点名
if (opt.theme) {
  const r = rules15();
  const t = r ? themeById(r, opt.theme) : null;
  if (!t) {
    console.error('出错：没有这个主题「' + opt.theme + '」。');
    console.error(r ? '可用主题：' + themeList(r).map(x => `${x.id}(${x.zh})`).join(' / ') : '（规则表没读进来）');
    process.exit(1);
  }
  const lexNow = getLexicon(opt.kbDir, { pool: opt.phrasePool });
  const tp = themePlan(t, lexNow);
  opt.extraTags = tp.rows.map(x => ({ tag: x.tag, zh: x.zh, layer: x.layer, big: x.big, bigName: x.bigName, sub: x.sub, source: 'theme:' + tp.id }));
  opt.themeInfo = { id: tp.id, zh: tp.zh, count: tp.rows.length, missing: tp.missing, requires: tp.requires, forbids: tp.forbids };
  opt.annotate = opt.noHints ? opt.annotate : true;
}

// ---- 图像规格入口：缺项自审默认开启，宽召回不默认 ----------------------------
// 踩过的坑：自审原本要另外写 --gaps / --format gaps 才出，不写也不报错，于是被静默跳过，
// 交付的标签串漏了画风与光位。这里把图像入口的默认档改掉，并且把缺项提示打到 stderr，
// 让「没自审」在界面上直接可见（stdout 仍是单行纯标签串，文本分支一字未动）。
// 宽召回是显式档：默认窄召回，标签行与旧版同规模（用户拍板：默认只多出「自审」这一样产物），
// 要更全的候选池写 --broad / --no-broad 与默认同档。
const isImageInput = !!opt.spec;
const gapsSet = 'gaps' in opt;
// 两个入口都默认开自审（文本入口以前只有显式 --gaps / --format gaps 才开，
// 不写就静默跳过：结果对象上连 gaps 键都没有，缺口自然永远不会被回答）。
if (!gapsSet) { opt.gaps = true; opt.alternatives = true; }
// 图像入口额外记一笔「是否走了默认档」，供文档/调试判断；窄召回两端一致（都要显式 --broad）
if (isImageInput) opt.imageSpecDefault = !gapsSet && opt.broad !== true;

/** 缺项提示打到 stderr：一行摘要 + 缺口条数 + 观察缺项的建议写法（stdout 保持干净） */
function printGapHints(out, where = '') {
  if (!out || !out.gapsSummary) return;
  const s = out.gapsSummary;
  const kinds = Object.entries(s.byKind || {}).map(([k, v]) => `${k} ${v}`).join(' · ');
  const why = s.specIssues && s.specIssues.length ? '（观察 JSON 有必填维度没落成结构化字段）' : '（可用 --format gaps 看候选项）';
  console.error(`[缺项自审] 缺口 ${s.total} 条：${kinds || '无'}${where ? ' ' + where : ''}${why}`);
  // 全量打印观察缺项（上限由 REQUIRED_OBSERVATIONS 定死，共 9 条）：
  // 截断会正好吞掉低严重度的 outfit.footwear / pose.action / style.camera，
  // 而它们是「没有专属载体、最容易被漏写」的维度，最需要看见建议写法。
  for (const i of (s.specIssues || [])) {
    console.error(`  - ${i.key}（${i.label} / ${i.severity}）：${i.advice}`);
  }
  if (s.notesText) {
    console.error('  - notes 只当日志，不产标签；要落标签请写进结构化字段（--template 可看模板）');
  }
}

/** 同一个摘要的 markdown 版（贴进报告里，省得再单独跑 --format gaps） */
function printGapSummaryMd(s) {
  const kinds = Object.entries(s.byKind || {}).map(([k, v]) => `${k} ${v}`).join(' · ');
  console.log(`## 缺项自审摘要（缺口 ${s.total} 条）`);
  console.log('');
  console.log(`- 分类：${kinds || '无'}`);
  if (s.specIssues && s.specIssues.length) {
    console.log(`- 观察缺项 ${s.specIssues.length} 条（必填维度没落成结构化字段）：`);
    // 同上：全量打印（9 条上限），保证 style.camera / pose.action / outfit.footwear 的建议写法可见
    for (const i of s.specIssues) console.log(`  - \`${i.key}\`（${i.label} / ${i.severity}）：${i.advice}`);
  }
  if (s.notesText) console.log(`- notes（纯日志，未参与匹配）：${s.notesText}`);
  console.log('');
}

const HELP = `Anima 标签反推 · rtag
用法
  node bin/rtag.mjs "自然语言描述"                文本 → 分层标签块 + 一句英文自然语言（默认混合形态）
  node bin/rtag.mjs "…" --format tags             文本 → 旧形态的单行标签串
  node bin/rtag.mjs --file 描述.txt               从文件读描述
  node bin/rtag.mjs -                             从 stdin 读描述
  node bin/rtag.mjs --image-spec 观察.json        图像观察结果 → 标签（默认带缺项自审）
  node bin/rtag.mjs --search "blue eyes"          单条检索
  node bin/rtag.mjs --info                        词库概况
  node bin/rtag.mjs --info --format json          词库概况（结构化 JSON，面板用）
  node bin/rtag.mjs --template                    打印图像观察模板
  node bin/rtag.mjs --nl-template                 打印英文自然语言句子骨架
  node bin/rtag.mjs "…" --nl                      文本 → 英文自然语言提示词
  node bin/rtag.mjs "…" --gaps                    文本 → 缺项清单与候选项（供勾选补全）
  node bin/rtag.mjs "…" --broad --gaps            宽召回后再列缺项（候选更多）
  node bin/rtag.mjs "…" --check                   自审：标签 + 缺项清单一并输出
  node bin/rtag.mjs "…" --rating nsfw --dialogue  打印本档该读的 dialogue-style 章节（压字用）
  node bin/rtag.mjs --theme-list                  列出主题配方（外部模板 §14 的十二个）
  node bin/rtag.mjs "…" --theme ntr               把该主题的标签注入交付串（末尾报注入条数）

选项
  --format hybrid    混合形态（默认）：第一行质量/分级行，接着按层各一行标签（**行尾保留逗号**），
                     空一行后是一句英文自然语言，再空一行打负向词。一句话里没接住的说法只说条数
                     （「另外：有 N 句没接住」），要原话见 --loose。
                     单人场景默认补 direct eye contact / facing viewer（--no-view-default 关掉）；
                     负向词之后可能多几行提醒（互斥 ⚠ / 标签总数 ·，--no-hints 关掉）。
  --format tags      单行逗号分隔的纯标签串（**旧形态，已不是默认**；别名 line / bare）
  --format bare      单行纯标签串，与 tags 同义（别名）
  --format prompt    单行正向串，带官方前缀（masterpiece, best quality, score_7, 分级 token）
  --format negative  只要负向串
  --format json      结构化结果（分层 / 分数 / 频次 / 置信度；图像入口附带 gaps / gapsSummary）
                     （与 --info 同用时改出词库概况 JSON：schema anima-tag-reverse/info@1）
  --format md        人类可读的分层报告（图像入口附带缺项摘要）
  --format nl        英文自然语言提示词（标签前缀行 + 逐角色句 + 场景句）
  --format gaps      缺项清单与候选项（markdown 勾选表）
  --format check     tags + nl + gaps 一次给全
  --format dialogue  压字选篇：本档该读的 dialogue-style 章节（需显式 --rating）
  --rating R         手动指定分级（档名来自面板配置，默认 safe / sensitive / nsfw；旧名 questionable / explicit 会报错并给迁移对照表）
                    （不指定时按命中内容自动升级）
  显式给出 --rating 时，档位会驱动五件事（不写 --rating 时行为与旧版逐字节一致）：
    ① 前缀里的分级 token 换成该档（--no-tier-token 则一律不写档位名）
    ② 负面行按档增补：safe 档压露点、sensitive 档压露点留内衣、nsfw 档改加不打码纪律，
       并按「误杀项删除规则」处理（出现雨景/水面/镜面时删掉 mirror / reflection / duplicate）
    ③ 压字选篇：长篇成片写对话框时只读本档那一节 dialogue-style，别的节不翻开
       （--dialogue 打印选篇；faces.dialogueSection 关掉则不选，通用篇由 dialogue.commonAlways 决定，默认必过）
    ④ 档位门：该档不该出现的露骨标签不出现在结果里，且**写进缺项清单的 tier-blocked**（不静默消失）
    ⑤ 补全候选按档收紧（与 --broad 是两个独立维度，可叠加）
  --no-tier-token    标签串里不写档位名（面板调用时默认带；前缀里的 masterpiece / best quality / score_7 不受影响）
  --tier-token       恢复把档位名写进标签串（默认行为）
  --dialogue         压字选篇（等价于 --format dialogue；需要显式 --rating，否则报错退出）
  --top N            最多输出多少条标签（默认不限：不写就全量输出，随输入规模走）
  --per-clause N     每个分句保留几个候选（默认 3）
  --min S            最低得分阈值（默认 0.46）
  --min-sim S        纯相似度路径的下限（默认 0.52）
  --max-per-layer N  每层上限（默认 24）
  --broad            宽召回档：阈值放宽、候选池扩大（默认关闭，图像入口也一样；--no-broad 与默认同档）
  --pool / --no-pool 补充短语池（anima-tag-kb/补充短语池/phrase-pool.json，≥3 词的长短语；
                     第 4 期 ③ 从 Luo-fe 分流而来）。默认跟随面板开关 lexicon.poolEnabled（默认关）；
                     --pool 临时打开，--no-pool 临时关掉。关着时词库就是主索引那一份，输出逐字节不变。
  --gaps / --check   输出缺项清单（未匹配 / 关键层为空 / 粒度不足 / 观察缺项缺失 / 多主体不全 / 同维度冲突）
  --no-gaps          关掉缺项自审（两个入口都默认开；显式 --format gaps / --check 时无效）
  --nl               输出英文自然语言提示词
  --loose MODE       「没接住」的说法怎么打（默认 note；词库里查不到的、分数不够落选的都算，
                     被档位挡下的不算）：
                       note   只写一行「另外：有 N 句没接住」（默认，不贴原话）
                       plain  原话直接接在英文句尾，中间空一格
                       marker 原话写成「（另外：…）」接在英文句尾
                       line   英文句一行，中文原话另起一行（前面带「另外（词库里没接住…）」）
                       off    一个字都不打
                     脚本自己不会翻译：note 之外的模式都是把中文原话照抄带回，
                     要英文得在对话里翻（技能的约定就是让会话侧翻完再补进那句自然语言）。
  --theme ID         套用外部模板 §14 的主题配方（--theme-list 看可用 id）：把该主题的标签按层
                     注入交付串，末尾报「注入 N 条 / 其中 M 条词库里查不到」。主题是显式要求，
                     旧形态（--format tags 等）也会被注入；规则表在 references/anima3-rules.json。
  --theme-list       只列主题（id / 中文名 / 标签数 / 自带禁配 / 出处行号），不用给输入；
                     --format json 时出 schema anima-tag-reverse/themes@1 的结构化清单。
  --no-view-default  单人场景不注入默认视线（direct eye contact / facing viewer）
  --view-default     旧形态（tags / prompt / line / bare / json）也注入单人默认视线
                     （新形态 hybrid 与 check 本来就注入；判据是「单人 + 没要求背影/侧脸/睡姿」）
  --no-weights       混合形态不给标签加权重（默认按 freq 档位加 '(tag:1.2)'，规则见 src/compose.mjs 的 weightPlan）
  --no-hints         末尾不打互斥 / 标签总数提醒（默认在 hybrid / check / gaps / json 四种形态下打：
                     互斥行「⚠ …」、总数行「· 标签共 N 条…」；只提醒不拦截，交付串原样不动）
  --no-tags          自然语言里不再句末附标签兜底串
  --max-per-sentence N  每句最多几个短语（默认 12；层内按分数取前 N）
  --no-prefix        不加官方正向前缀
  --prefix "…"       自定义正向前缀
  --negative "…"     自定义负向串
  --kb DIR           指定 画师类 目录（默认自动定位：--kb > ANIMA_KB_DIR > kb-path.json > 仓库 > 家目录 > cwd）

图像入口的默认档（文本入口同样默认自审；差别只剩「提示去 stderr」与「必填观察维度」）
  1. 缺项自审默认开启：结果对象上始终有 gaps / gapsSummary / gapsMarkdown，
     图像入口额外把一行缺项摘要与「观察缺项的建议写法」打到 stderr（stdout 只有交付形态，不发提示）；
     --no-gaps 可关掉（显式 --format gaps / --check 不受它影响，仍出缺口）。
  2. 宽召回默认关闭（图像入口也一样）：默认走窄召回，标签行与旧版同规模；
     要更全的候选池（例如让缺项候选更多）显式写 --broad。
  3. notes 是纯日志：写在 notes 里的观察不产出标签、不参与匹配，只回显在 plan.notesText；
     要落标签必须写进结构化字段，否则会被列成 C-spec-* 观察缺项。
  文本入口：同样默认自审（结果对象上有 gaps / gapsSummary / gapsMarkdown），只是不打 stderr 提示。
  4. 标签条数默认不封顶：不写 --top 就按输入规模全量输出（旧版默认 40，而且是在分层之前先切一刀，
     砍掉的是全局分数最低的那几条，看起来像「词库不够」）；--max-per-layer（默认 24）仍按层防单层刷屏。

补充短语池（第 4 期 ③；默认关闭）
  anima-tag-kb/画师类/search-index.json 是主表；从 Luo-fe 分流进来的长短语另放在
  anima-tag-kb/补充短语池/phrase-pool.json，只有 lexicon.poolEnabled / --pool 打开时才参与召回。
  --info 会分别打印主表行数、manifest 记的总数与池条数，三者对不上是正常的；
  池文件由 tools/merge-luo-clean.mjs 生成（--dry-run 先看差异，--apply 才写盘，写前自动备份）。
`;

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return stripBom(Buffer.concat(chunks).toString('utf8'));
}

/** Windows 上记事本 / PowerShell 存出的 UTF-8 常带 BOM，JSON.parse 会直接报错 */
function stripBom(s) {
  return s && s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/**
 * 第 6 期：末尾那几行提醒（主题注入情况 / 互斥组合 / 标签总数区间）。
 * 数据来自 out.annotate（rules.mjs 的 annotate()）；一项都没有就返回空数组，调用方不用判空。
 */
function hintLines(out) {
  const a = out && out.annotate;
  const L = [];
  if (!a) return L;
  if (a.theme) {
    const bits = [`主题「${a.theme.zh || a.theme.id}」：注入 ${a.theme.count} 条标签`];
    if (a.theme.missing && a.theme.missing.length) {
      const head = a.theme.missing.slice(0, 6).join('、');
      bits.push(`其中 ${a.theme.missing.length} 条词库里查不到（${head}${a.theme.missing.length > 6 ? ' …' : ''}）`);
    }
    L.push('· ' + bits.join('；'));
    if (a.theme.requires && a.theme.requires.length) L.push('· 这个主题还要满足：' + a.theme.requires.slice(0, 3).join('；'));
  }
  for (const m of a.mutex || []) L.push('⚠ ' + m.text);
  if (a.count && !a.count.ok) L.push('· ' + a.count.text);
  return L;
}

function printSearch(list) {
  if (!list.length) { console.log('（没有命中）'); return; }
  const w = Math.max(...list.map(t => t.tag.length), 4);
  for (const t of list) {
    console.log(
      `${t.tag.padEnd(w)}  ${String(t.zh || '').slice(0, 18).padEnd(20)} ` +
      `score ${t.score.toFixed(2)}  sim ${t.sim.toFixed(2)}  ${t.freqStr || '-'}  ${t.conf}  ${t.layerName}`
    );
  }
}

async function main() {
  if (opt.help) { console.log(HELP); return; }
  if (opt.template) { console.log(JSON.stringify(emptySpec(), null, 2)); return; }
  if (opt.nlTemplate) { console.log(nlTemplate()); return; }
  // 第 6 期：主题清单（不用给输入，跟 --nl-template 一样是「先看有什么」的只读入口）
  if (opt.themeList) {
    const r = rules15();
    if (!r) { console.error('出错：ANIMA3 规则表没读进来，拿不到主题清单。'); process.exitCode = 1; return; }
    const list = themeList(r);
    const fmt = s => `${s.id.padEnd(18)} ${s.zh}  ${String(s.count).padStart(3)} 条标签${s.forbids ? `｜自带禁配 ${s.forbids} 条` : ''}  ${s.src}`;
    if (opt.format === 'json') { console.log(JSON.stringify({ schema: 'anima-tag-reverse/themes@1', themes: list }, null, 2)); return; }
    console.log(`第 6 期主题配方共 ${list.length} 个（来自外部模板 §14；用法：--theme <id>）`);
    console.log('');
    for (const s of list) console.log(fmt(s));
    console.log('');
    console.log('主题标签会查上词库的层与中文后注入交付串（末尾标 source: theme:<id>）；');
    console.log('查不到词库信息的标签会在末尾提醒里点名，不会静默丢掉。');
    return;
  }

  if (opt.info) {
    const info = kbInfo(opt.kbDir, { phrasePool: opt.phrasePool });
    // 第 4 期 ③ 收尾：面板只通过子进程读技能，所以概况也要有机器可读的一份
    // （人类那份照旧打在下面；两份的数值同源，永远来自同一个 kbInfo 调用）。
    if (opt.format === 'json') {
      const pool = poolPath(info.kbDir);
      console.log(JSON.stringify({
        schema: 'anima-tag-reverse/info@1',
        kb: {
          dir: info.kbDir,
          size: info.size,
          rows: info.rows,
          total: info.total,
          delta: info.rows - info.total,
          bigs: info.bigs,
          subs: info.subs,
          builtAt: info.builtAt,
          model: info.model,
          officialTags: info.officialTags,
          verifiedFreq: info.verifiedFreq,
          zhMissing: info.zhMissing,
          surfaces: info.surfaces,
          tokens: info.tokens,
          maxFreq: info.maxFreq,
          pool: info.pool,
          poolEnabled: info.poolEnabled,
          poolPath: pool,
          poolExists: fs.existsSync(pool)
        },
        config: {
          path: configRef(panelCfg.source),
          builtin: panelCfg.source.used === 'builtin',
          poolEnabled: !!panelCfg.config.lexicon.poolEnabled,
          tiers: panelCfg.config.tiers.map(t => ({ name: t.name, label: t.label })),
          defaultTier: panelCfg.config.defaultTier,
          broad: !!panelCfg.config.output.broad,
          faces: Object.fromEntries(['prefixToken', 'negativeLines', 'dialogueSection', 'lexiconGate', 'gapsScope']
            .map(k => [k, panelCfg.config.faces[k] !== false]))
        },
        warnings: panelCfg.warnings
      }, null, 2));
      return;
    }
    console.log('词库：' + info.kbDir);
    for (const [k, v] of Object.entries(info)) {
      if (k !== 'kbDir') console.log(`  ${k}: ${v}`);
    }
    // 第 4 期 ③ / 第 6 期：增量行与池分开印，避免「manifest 记的总数、索引里却是另一个数」看着像 bug
    if (info.rows !== info.total) console.log(`  增量：索引 ${info.rows} 行 − manifest 记 ${info.total} 行 = ${info.rows - info.total} 条（第 4 期 ③ Luo-fe 分流）`);
    console.log('  短语池: ' + (info.pool
      ? `${info.pool} 条（${info.poolEnabled ? '本次已启用' : '未启用，lexicon.poolEnabled=false；加 --pool 可临时打开'}）`
      : '没有池文件（anima-tag-kb/补充短语池/phrase-pool.json 不存在）'));
    // 第 5 期：把「档位到底是谁定的」直接印出来，省得猜
    console.log('配置来源：' + (panelCfg.source.used === 'builtin'
      ? `内置默认（配置文件：${configRef(panelCfg.source)}）`
      : panelCfg.source.path));
    console.log('  档位表: ' + panelCfg.config.tiers.map(t => `${t.name}（${t.label}）`).join(' / '));
    console.log('  默认档: ' + panelCfg.config.defaultTier);
    console.log('  候选松紧: ' + (panelCfg.config.output.broad ? '宽召回（output.broad=true）' : '窄召回（默认）'));
    console.log('  五个行为面: ' + ['prefixToken', 'negativeLines', 'dialogueSection', 'lexiconGate', 'gapsScope']
      .map(k => `${k}=${panelCfg.config.faces[k] === false ? 'off' : 'on'}`).join(' · '));
    for (const w of panelCfg.warnings) console.log('  告警: ' + w);
    return;
  }

  if (opt.search) {
    console.log(`检索「${opt.search}」：`);
    printSearch(searchTags(opt.search, { limit: opt.top || 10, kbDir: opt.kbDir, phrasePool: opt.phrasePool }));
    return;
  }

  // 面 3（第 4 期）：压字选篇只跟档位有关、不看输入，所以放在读输入之前——
  // `node bin/rtag.mjs --rating nsfw --dialogue` 不用再凑一句描述。
  // 缺档位 / 面被关掉两种情况在上面（buildPolicy 之后）已经硬报错退出。
  if (opt.format === 'dialogue') {
    console.log(formatDialoguePlan(dialoguePlan(opt.tierPolicy), { skillDir: SKILL_DIR, policy: opt.tierPolicy }));
    return;
  }

  let input = null;
  if (opt.spec) {
    const raw = opt.spec === '-' ? await readStdin() : stripBom(fs.readFileSync(path.resolve(opt.spec), 'utf8'));
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      console.error('出错：图像规格不是合法 JSON（' + e.message + '）');
      process.exitCode = 1;
      return;
    }
    input = { imageSpec: parsed };
  } else {
    let text = positional.join(' ').trim();
    if (!text && opt.file) text = stripBom(fs.readFileSync(path.resolve(opt.file), 'utf8'));
    if (!text && opt.stdin) text = await readStdin();
    if (!text) { console.error(HELP); process.exitCode = 1; return; }
    input = { text };
  }

  const t0 = Date.now();
  const out = reverse(input, opt);
  const ms = Date.now() - t0;

  // 图像入口：缺项提示自动去 stderr（不污染 stdout 的标签串）
  if (isImageInput) printGapHints(out, opt.imageSpecDefault ? '｜默认档' : '');

  if (opt.format === 'json') {
    const j = { ...out.json, elapsedMs: ms };
    // 第 1–2 期：档位策略与被挡标签一并给出（面板与脚本要能看出「哪张脸开着、哪条标签被哪档挡了」）。
    // 不传档位时这两个键仍在，但 explicit=false、tierBlocked 为空数组，且**内容输出逐字节不变**
    //（用户裁决：默认路径逐字不变）。
    if (out.tierPolicy) { j.tierPolicy = out.tierPolicy; j.tierBlocked = out.tierBlocked || []; }
    // 面 3（第 4 期）：显式档位且选篇生效时才加这一个键；面关 / 无档位时一个键都不加
    if (out.dialogueSection) j.dialogueSection = out.dialogueSection;
    if (out.gaps) { j.gaps = out.gaps; j.gapsSummary = out.gapsSummary; j.gapsMarkdown = out.gapsMarkdown; }
    if (out.alternatives) j.alternatives = out.alternatives;
    if (out.nl) j.naturalLanguage = out.nl;
    // 第 6 期：互斥 / 总数提醒也进 JSON（gaps 里已有一条同源记录；这里给脚本一个更顺手的入口）
    if (out.annotate && hintLines(out).length) {
      j.annotate = {
        lines: hintLines(out),
        mutex: out.annotate.mutex.map(m => ({ group: m.group, groupZh: m.groupZh, a: m.a, b: m.b, text: m.text })),
        count: out.annotate.count,
        persons: out.annotate.persons,
        theme: out.annotate.theme
      };
    }
    console.log(JSON.stringify(j, null, 2));
    return;
  }
  // 第 6 期默认：混合形态 —— 按 0–8 层分行、行尾保留逗号、末行跟一句自然语言，最后附负向词
  if (opt.format === 'hybrid') {
    const block = hybridBlock(out, { weights: opt.weights !== false });
    if (block) console.log(block);
    // 词库里没接住的说法（含分数不够而落选的；被档位挡下的不算）：按 --loose 选定的方式交代，不静默丢
    const mode = opt.looseMode || 'note';
    const tail = looseTail(out, mode);
    // note / line 另起一行；marker / plain 跟在英文句尾（用户裁决默认 note：中文原话不进输出）
    const separate = mode === 'note' || mode === 'line';
    if (out.nl && out.nl.text) console.log(separate ? out.nl.text : out.nl.text + tail);
    if (tail && separate) console.log(tail);
    console.log('');
    console.log('Negative prompt: ' + out.negative);
    // 第 6 期：ANIMA3 模板规则的两类提醒（互斥组合 / 标签总数区间）——只提醒，不打断交付串
    for (const l of hintLines(out)) console.log(l);
    return;
  }
  // 默认交付形态：单行、逗号分隔、纯标签（不带官方质量前缀）；bare 是同义别名
  if (opt.format === 'tags' || opt.format === 'line' || opt.format === 'bare') { console.log(out.bare); return; }
  // 需要官方前缀时用 prompt（前缀 + 标签，分级 token 已按内容自动适配）
  if (opt.format === 'prompt') { console.log(out.prompt); return; }
  if (opt.format === 'negative') { console.log(out.negative); return; }
  // 英文自然语言分支
  if (opt.format === 'nl') { console.log(out.nl ? out.nl.text : '（未生成自然语言，请加 --nl）'); return; }
  // 缺项清单
  if (opt.format === 'gaps') { console.log(out.gapsMarkdown || '（没有缺项）'); return; }
  // 一次给全：标签 + 自然语言 + 缺项清单
  if (opt.format === 'check') {
    console.log('## 标签串');
    console.log('```');
    console.log(out.prompt);
    console.log('```');
    console.log('');
    console.log('## 负向串');
    console.log('```');
    console.log(out.negative);
    console.log('```');
    console.log('');
    console.log('## 英文自然语言');
    console.log('```');
    console.log(out.nl ? out.nl.text : '（未生成）');
    console.log('```');
    if (out.nl && out.nl.meta && out.nl.meta.fallback.length) {
      console.log('');
      console.log('（以下标签没有专属措辞，以原文出现在句子里：' + out.nl.meta.fallback.map(t => '`' + t + '`').join('、') + '）');
    }
    console.log('');
    console.log(out.gapsMarkdown || '（缺项检测未运行）');
    // 第 6 期：互斥与总数提醒（缺项清单里也有同样两条，这里再顶一行方便一眼看到）
    for (const l of hintLines(out)) console.log(l);
    return;
  }

  const used = out.layers.filter(l => l.tags.length);
  console.log(`# 反推结果（${out.stats.used} 条 / 候选池 ${out.stats.total} 条 / 分级 ${out.rating} / ${ms}ms）`);
  console.log('');
  console.log('## 正向串');
  console.log('```');
  console.log(out.prompt);
  console.log('```');
  for (const l of used) {
    console.log('');
    console.log(`## ${l.layer}·${l.name}（${l.tags.length}）`);
    for (const t of l.tags) {
      console.log(`- \`${t.tag}\`${t.zh ? '（' + t.zh + '）' : ''} · ${t.score.toFixed(2)} · ${t.freqStr} · ${t.conf}${t.reason.startsWith('forced') || t.reason.startsWith('jp') ? ' · ' + t.reason : ''}`);
    }
  }
  console.log('');
  console.log('## 负向串');
  console.log('```');
  console.log(out.negative);
  console.log('```');
  if (out.unmatched.length) {
    console.log('');
    console.log('## 未匹配片段（词库里没有，需人工确认）');
    console.log(out.unmatched.map(s => '`' + s + '`').join('、'));
  }
  if (out.gapsMarkdown) {
    console.log('');
    // 图像入口：md 报告里也要有缺口信息，不用再单独跑 --format gaps
    if (out.gapsSummary) printGapSummaryMd(out.gapsSummary);
    console.log(out.gapsMarkdown);
  }
}

main().catch(e => { console.error('出错：' + e.message); if (process.env.RTAG_DEBUG) console.error(e.stack); process.exitCode = 1; });
