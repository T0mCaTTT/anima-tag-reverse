#!/usr/bin/env node
/**
 * tier-faces.mjs —— 第 1–2 期：档位驱动的「四张脸」自测
 *
 * 跑法： node tests/tier-faces.mjs        （在技能根目录）
 *
 * 覆盖 3 组（共 40+ 条断言）：
 *   A. 纯函数单元：semanticOf / visibleAt / gateNeed / buildPolicy /
 *      negativeFor / narrowCandidates / ruleFires / dropRulesOf
 *   B. CLI 集成 · 默认路径逐字不变 + 四张脸在**显式档位**下各自生效
 *   C. CLI 集成 · 面板配置文件真的能改行为（隔离 $DSH_HOME 里放 4 档配置，
 *      含负面的误杀项删除规则 negative.dropRules）
 *
 * 两条铁律（用户裁决，改代码前先读这段）：
 *   1. 不传 `--rating` 时输出必须与改造前逐字节一致（面 2 的压制词只在显式档位时生效）；
 *   2. 面板调用总是「显式档位 + --no-tier-token」：档位名不进交付的标签串。
 *
 * 环境隔离：所有 CLI 用例都注入临时 $DSH_HOME，并把 $DSH_ANIMA_PANEL_CONFIG 指向
 * 不存在的文件，否则会读到开发机上真实的 ~/.dsh/anima-panel/panel-config.json，
 * 用例就不再确定（第 5 期测试踩过这个坑）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  semanticOf, visibleAt, gateNeed, buildPolicy, gateMatches,
  negativeFor, narrowCandidates, ruleFires, dropRulesOf
} from '../src/tier-policy.mjs';
import { keyOf } from '../src/normalize.mjs';
import { NEGATIVE_DEFAULT, BUILTIN_TIER_NAMES, RATING_TAGS, NEG_BY_TIER, NEG_TOP_EXTRA } from '../src/config.mjs';
import { BUILTIN_PANEL_CONFIG } from '../src/panel-config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(HERE, '..');
const CLI = path.join(SKILL_DIR, 'bin', 'rtag.mjs');

let pass = 0, fail = 0;
const t0 = Date.now();

function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`[通过] ${name}`); }
  else { fail++; console.log(`[失败] ${name}${detail ? `\n   → ${detail}` : ''}`); }
}

const ISO_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'anima-faces-'));
function runCli(args, env = {}) {
  return execFileSync(process.execPath, [CLI, ...args], {
    cwd: SKILL_DIR, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
    env: {
      ...process.env,
      DSH_HOME: ISO_HOME,
      DSH_ANIMA_PANEL_CONFIG: path.join(ISO_HOME, 'none.json'),
      ...env
    }
  });
}
function runCliJson(args, env) { return JSON.parse(runCli([...args, '--format', 'json'], env)); }

/** 写一份隔离的 panel-config.json，返回 env 覆盖（用完删掉） */
function withConfig(doc, label) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `anima-${label}-`));
  fs.mkdirSync(path.join(home, 'anima-panel'), { recursive: true });
  fs.writeFileSync(path.join(home, 'anima-panel', 'panel-config.json'), JSON.stringify(doc), 'utf8');
  return { DSH_HOME: home, DSH_ANIMA_PANEL_CONFIG: path.join(home, 'none.json'), __home: home };
}

// ============================================================================
// 组 A · 纯函数
// ============================================================================
{
  // A0 内置回退档名表（v2.0.0 收口：只有三档，旧档名不是档位）
  ok('组A BUILTIN_TIER_NAMES：恰为三档且不含旧档名 questionable / explicit',
    BUILTIN_TIER_NAMES.join(',') === 'safe,sensitive,nsfw'
    && !BUILTIN_TIER_NAMES.includes('questionable') && !BUILTIN_TIER_NAMES.includes('explicit'),
    BUILTIN_TIER_NAMES.join(','));
  ok('组A 旧名别名 RATING_TAGS 指向同一张三档表（v2 之前是五档，已弃用）',
    RATING_TAGS === BUILTIN_TIER_NAMES && Object.isFrozen(BUILTIN_TIER_NAMES),
    `same=${RATING_TAGS === BUILTIN_TIER_NAMES} frozen=${Object.isFrozen(BUILTIN_TIER_NAMES)}`);
  ok('组A buildPolicy 无面板可读时回退三档（不再回退到旧名 questionable）',
    buildPolicy({}).tierNames.join(',') === 'safe,sensitive,nsfw'
    && buildPolicy({ rating: 'questionable' }).explicit === true,
    buildPolicy({}).tierNames.join(','));

  // A1 语义档位映射
  ok('组A semanticOf：三档 = safe/mid/top',
    semanticOf(0, 3) === 'safe' && semanticOf(1, 3) === 'mid' && semanticOf(2, 3) === 'top',
    `${semanticOf(0, 3)},${semanticOf(1, 3)},${semanticOf(2, 3)}`);
  ok('组A semanticOf：单档恒 safe；四档中间两档都是 mid',
    semanticOf(0, 1) === 'safe' && semanticOf(1, 4) === 'mid' && semanticOf(2, 4) === 'mid' && semanticOf(3, 4) === 'top',
    `${semanticOf(0, 1)},${semanticOf(1, 4)},${semanticOf(3, 4)}`);

  // A2 可见度
  ok('组A visibleAt：safe 档看不到 top 需求，末档全看得到，need=null 永可见',
    visibleAt(0, 3, 'top') === false && visibleAt(2, 3, 'top') === true
    && visibleAt(0, 3, 'mid') === false && visibleAt(1, 3, 'mid') === true
    && visibleAt(0, 3, null) === true,
    `${visibleAt(0, 3, 'top')},${visibleAt(1, 3, 'mid')},${visibleAt(2, 3, 'top')}`);

  // A3 词条判级：白名单优先 > 露骨表 > 擦边表 > big 表
  ok('组A gateNeed：露骨词判 top、擦边词判 mid、环境词被白名单放过',
    gateNeed('nude', null) === 'top' && gateNeed('lingerie', null) === 'mid'
    && gateNeed('water', 'cb:nsfw') === null && gateNeed('reflection', null) === null,
    `${gateNeed('nude', null)},${gateNeed('lingerie', null)},${gateNeed('water', 'cb:nsfw')}`);
  ok('组A gateNeed：big 表（cb:nsfw）单独把词抬到 top',
    gateNeed('some unknown kink', 'cb:nsfw') === 'top' && gateNeed('girl', null) === null,
    `${gateNeed('some unknown kink', 'cb:nsfw')}`);

  // A4 buildPolicy 开关矩阵
  const builtin = { config: BUILTIN_PANEL_CONFIG, source: { path: '(builtin)', exists: false, used: 'builtin' } };
  const off = buildPolicy({ panel: builtin, rating: undefined });
  ok('组A buildPolicy：不传档位 → 四张脸全关（默认路径靠这个保证逐字不变）',
    off.explicit === false && off.gateEnabled === false && off.negativeEnabled === false
    && off.gapScopeEnabled === false && off.tierToken === true,
    JSON.stringify({ explicit: off.explicit, gate: off.gateEnabled, neg: off.negativeEnabled, gap: off.gapScopeEnabled }));
  const on = buildPolicy({ panel: builtin, rating: 'sensitive' });
  ok('组A buildPolicy：显式档位 → 四张脸全开、语义 mid、索引 1',
    on.explicit === true && on.gateEnabled && on.negativeEnabled && on.gapScopeEnabled
    && on.semantic === 'mid' && on.tierIndex === 1,
    JSON.stringify({ sem: on.semantic, idx: on.tierIndex, gate: on.gateEnabled }));
  const noToken = buildPolicy({ panel: builtin, rating: 'safe', tierToken: false });
  ok('组A buildPolicy：--no-tier-token 关掉面 1，其余面不受影响',
    noToken.tierToken === false && noToken.gateEnabled === true, `tierToken=${noToken.tierToken}`);

  // A5 面 2：负面串分档 + 误杀项删除
  ok('组A negativeFor：不显式时逐字返回 NEGATIVE_DEFAULT',
    negativeFor(null, [], undefined) === NEGATIVE_DEFAULT
    && negativeFor(off, ['girl'], undefined) === NEGATIVE_DEFAULT,
    negativeFor(off, ['girl'], undefined));
  const negSafe = negativeFor(buildPolicy({ panel: builtin, rating: 'safe' }), [], undefined);
  const negMid = negativeFor(buildPolicy({ panel: builtin, rating: 'sensitive' }), [], undefined);
  const negTop = negativeFor(buildPolicy({ panel: builtin, rating: 'nsfw' }), [], undefined);
  ok('组A negativeFor：safe 档追加克制词、mid 档只追加中档词、top 档换成不打码纪律',
    negSafe.includes(NEG_BY_TIER.safe) && !negSafe.includes('mosaic censoring')
    && negMid.includes(NEG_BY_TIER.mid) && !negMid.includes('nsfw,')
    && negTop.includes('mosaic censoring') && !negTop.includes(NEG_BY_TIER.safe),
    `safe=«${negSafe}»\n      top=«${negTop}»`);
  ok('组A negativeFor：显式 --negative 顶掉面板 core，但档位压制词仍会追加',
    negativeFor(buildPolicy({ panel: builtin, rating: 'safe' }), [], 'my own negative')
      === `my own negative, ${NEG_BY_TIER.safe}`,
    negativeFor(buildPolicy({ panel: builtin, rating: 'safe' }), [], 'my own negative'));
  const dropped = negativeFor(buildPolicy({ panel: builtin, rating: 'safe' }), ['rain', 'puddle'], 'mirror, reflection, duplicate, worst quality');
  const kept = negativeFor(buildPolicy({ panel: builtin, rating: 'safe' }), ['girl', 'classroom'], 'mirror, reflection, duplicate, worst quality');
  ok('组A 误杀项删除规则：画面有雨/水面才删 mirror/reflection/duplicate',
    !/mirror|reflection|duplicate/.test(dropped) && /mirror, reflection, duplicate/.test(kept),
    `雨景=«${dropped}»\n      室内=«${kept}»`);

  // A6 删除规则的两个纯函数（内置 = 正则 when，面板 = 标签数组 when）
  const rainKeys = new Set(['rain', 'puddle'].map(keyOf));
  ok('组A ruleFires：内置正则规则按正向标签 keyOf 匹配（画面有雨才触发）',
    ruleFires({ when: /^(?:rain|water)$/i, drop: [] }, rainKeys) === true
    && ruleFires({ when: /^(?:rain|water)$/i, drop: [] }, new Set(['girl'].map(keyOf))) === false);
  ok('组A ruleFires：面板数组规则命中任意一项即触发，形状非法时永不触发',
    ruleFires({ when: ['rain', 'water'], drop: [] }, rainKeys) === true
    && ruleFires({ when: ['classroom'], drop: [] }, rainKeys) === false
    && ruleFires({ when: 'rain', drop: [] }, rainKeys) === false
    && ruleFires(null, rainKeys) === false);
  const panelRules = {
    config: {
      ...BUILTIN_PANEL_CONFIG,
      negative: {
        core: 'worst quality, mirror, reflection',
        byTier: { ...BUILTIN_PANEL_CONFIG.negative.byTier },
        dropRules: [{ id: 'rain-scene', when: ['rain', 'water'], drop: ['mirror', 'reflection'] }]
      }
    },
    source: { path: '/tmp/fake-panel.json', exists: true, used: '/tmp/fake-panel.json' }
  };
  ok('组A dropRulesOf：内置规则恒在前；面板规则只在配置文件真的生效时叠加',
    dropRulesOf(buildPolicy({ panel: builtin, rating: 'safe' })).length === 1
    && dropRulesOf(buildPolicy({ panel: panelRules, rating: 'safe' })).length === 2
    && dropRulesOf(buildPolicy({ panel: panelRules, rating: 'safe' }))[0].id === 'scene-mirror',
    JSON.stringify(dropRulesOf(buildPolicy({ panel: panelRules, rating: 'safe' })).map(r => r.id)));
  ok('组A dropRulesOf：面板缺 dropRules 字段（老配置）时只有内置规则',
    dropRulesOf(buildPolicy({
      panel: { config: BUILTIN_PANEL_CONFIG, source: { path: '/tmp/old.json', exists: true, used: '/tmp/old.json' } },
      rating: 'safe'
    })).length === 1);
  const pPol = buildPolicy({ panel: panelRules, rating: 'safe' });
  ok('组A 面板删除规则经 negativeFor 生效：命中即删、未命中留、不显式档位一律不删',
    !/mirror|reflection/.test(negativeFor(pPol, ['rain'], undefined))
    && /mirror, reflection/.test(negativeFor(pPol, ['classroom'], undefined))
    && negativeFor(buildPolicy({ panel: panelRules, rating: undefined }), ['rain'], undefined)
      === 'worst quality, mirror, reflection',
    `雨=«${negativeFor(pPol, ['rain'], undefined)}» 室内=«${negativeFor(pPol, ['classroom'], undefined)}»`);

  // A7 面 4 / 面 5 的数据面
  const gatePolicy = buildPolicy({ panel: builtin, rating: 'safe' });
  const fakeMatches = [
    { tag: 'girl', big: null }, { tag: 'naked', big: null },
    { tag: 'lingerie', big: null }, { tag: 'water', big: 'cb:nsfw' }
  ];
  const r = gateMatches(fakeMatches, gatePolicy);
  ok('组A gateMatches：safe 档挡下 naked/lingerie，放过白名单里的 water',
    r.kept.map(m => m.tag).join(',') === 'girl,water' && r.blocked.map(m => m.tag).sort().join(',') === 'lingerie,naked',
    `kept=${r.kept.map(m => m.tag)} blocked=${r.blocked.map(m => m.tag)}`);
  ok('组A gateMatches：不传档位时一条都不挡',
    gateMatches(fakeMatches, buildPolicy({ panel: builtin, rating: undefined })).blocked.length === 0);
  const cands = [{ tag: 'naked' }, { tag: 'lingerie' }, { tag: 'water' }, { tag: 'girl' }];
  ok('组A narrowCandidates：safe 档只剩可见候选；不开面 5 时原样返回',
    narrowCandidates(cands, buildPolicy({ panel: builtin, rating: 'safe' })).map(c => c.tag).join(',') === 'water,girl'
    && narrowCandidates(cands, buildPolicy({ panel: builtin, rating: undefined })).length === 4,
    narrowCandidates(cands, buildPolicy({ panel: builtin, rating: 'safe' })).map(c => c.tag).join(','));
}

// ============================================================================
// 组 B · CLI 集成（默认路径不变 + 四张脸）
// ============================================================================
{
  // B1 默认路径：三条输入逐字不变（smoke.mjs 锁住了形态，这里锁住具体串）
  // 第 6 期起 CLI 默认是混合形态，这里要的是「旧形态那条单行串」，所以显式写 --format tags。
  const cases = [
    { text: '少女在教室里读书', expect: 'girl, reading, classroom' },
    { text: '一个女孩站在阳台上', expect: '1girl, solo, balcony' }
  ];
  for (const c of cases) {
    const line = runCli([c.text, '--format', 'tags']).trim();
    ok(`组B 默认路径逐字不变 · ${c.text}`, line === c.expect, `得到 «${line}»，期望 «${c.expect}»`);
  }

  // B2 面 1：档位 token
  ok('组B 面1 显式档位 → 档位名进前缀（手敲 CLI 的老行为）',
    runCli(['少女在教室里读书', '--rating', 'safe', '--format', 'tags']).trim() === 'safe, girl, reading, classroom',
    runCli(['少女在教室里读书', '--rating', 'safe', '--format', 'tags']).trim());
  ok('组B 面1 --no-tier-token（面板固定带）→ 档位名不进串，内容前缀完好',
    runCli(['少女在教室里读书', '--rating', 'safe', '--no-tier-token', '--format', 'tags']).trim() === 'girl, reading, classroom'
    && runCli(['少女在教室里读书', '--rating', 'safe', '--no-tier-token', '--format', 'prompt']).trim()
      === 'masterpiece, best quality, score_7, girl, reading, classroom',
    runCli(['少女在教室里读书', '--rating', 'safe', '--no-tier-token', '--format', 'prompt']).trim());
  ok('组B 面1 单独 --no-tier-token（不传档位）不改变任何输出',
    runCli(['少女在教室里读书', '--no-tier-token', '--format', 'tags']).trim() === 'girl, reading, classroom');

  // B3 面 2：负面串分档
  const jsonSafeNeg = runCliJson(['少女在教室里读书', '--rating', 'safe']);
  const jsonTopNeg = runCliJson(['少女在教室里读书', '--rating', 'nsfw']);
  const jsonPlain = runCliJson(['少女在教室里读书']);
  ok('组B 面2 safe 档负面串追加克制词、top 档追加不打码纪律',
    jsonSafeNeg.negative.string.includes('nsfw, nude, nipples, explicit, censored')
    && jsonSafeNeg.negative.string.includes('worst quality')
    && jsonTopNeg.negative.string.includes('mosaic censoring, bar censor, censored')
    && !jsonTopNeg.negative.string.includes('mosaic censoring, bar censor, censored, mosaic'),
    `safe=«${jsonSafeNeg.negative.string}»\n      top=«${jsonTopNeg.negative.string}»`);
  ok('组B 面2 不传档位时负面串逐字等于改造前默认',
    jsonPlain.negative.string === NEGATIVE_DEFAULT, `«${jsonPlain.negative.string}»`);

  // B4 面 4：档位门 + E1 缺口
  const nude = '裸体少女在浴室里';
  const nudeSafe = runCliJson([nude, '--rating', 'safe', '--no-tier-token']);
  const nudeTop = runCliJson([nude, '--rating', 'nsfw', '--no-tier-token']);
  const nudePlain = runCliJson([nude]);
  ok('组B 面4 safe 档挡下 naked 并记进 tierBlocked，换 nsfw 档拿回来',
    !/naked/.test(nudeSafe.positive.lineBare)
    && Array.isArray(nudeSafe.tierBlocked) && nudeSafe.tierBlocked.some(b => b.tag === 'naked')
    && /naked/.test(nudeTop.positive.lineBare),
    `safe=«${nudeSafe.positive.lineBare}» top=«${nudeTop.positive.lineBare}» blocked=${JSON.stringify(nudeSafe.tierBlocked)}`);
  ok('组B 面4 不传档位时 naked 照旧在串里（默认路径不变）',
    /naked/.test(nudePlain.positive.lineBare) && !nudePlain.tierBlocked?.length,
    `«${nudePlain.positive.lineBare}»`);
  const gapsSafe = runCli([nude, '--rating', 'safe', '--gaps']);
  const gapsPlain = runCli([nude, '--gaps']);
  ok('组B 面4 E1 缺口：只有显式档位才出现，且写明「被 safe 档挡下了」',
    /#### E1/.test(gapsSafe) && /被「safe」档挡下了/.test(gapsSafe)
    && /`naked`（需 <末档> 档）|`naked`（需/.test(gapsSafe)
    && !/tier-blocked/.test(gapsPlain),
    `safe有E1=${/#### E1/.test(gapsSafe)} 默认有E1=${/#### E1/.test(gapsPlain)}`);

  // B5 交付形态：--info 暴露来源与五个面
  const info = runCli(['--info']);
  ok('组B --info 打印配置来源、档位表与五个行为面',
    /配置来源：/.test(info) && /档位表: safe/.test(info)
    && /五个行为面: prefixToken=on · negativeLines=on · dialogueSection=on · lexiconGate=on · gapsScope=on/.test(info),
    info.split('\n').slice(-6).join(' | '));

  // B6 旧档位名照样硬报错（第 5 期裁决，不能被本期改动绕过）
  let legacy = null;
  try { runCli(['少女在教室里读书', '--rating', 'explicit']); } catch (e) { legacy = e; }
  ok('组B 旧档位名 explicit 仍 exit 1 且给迁移对照表',
    !!legacy && legacy.status === 1 && /旧档位名/.test(String(legacy.stderr)) && /迁移对照表/.test(String(legacy.stderr)),
    legacy ? `status=${legacy.status}` : '（没有报错，静默通过了）');
}

// ============================================================================
// 组 C · 面板配置文件驱动（隔离 $DSH_HOME 里放真文件）
// ============================================================================
{
  // C1 四档配置：新档名可用 + 第 4 档参与语义映射
  const four = {
    version: 1,
    tiers: [
      { name: 'sfw', label: '全年龄', order: 1, criteria: '无露点' },
      { name: 'mild', label: '轻微', order: 2, criteria: '内衣' },
      { name: 'hot', label: '热辣', order: 3, criteria: '泳装' },
      { name: 'nsfl', label: '露骨', order: 4, criteria: '露点' }
    ],
    defaultTier: 'sfw',
    faces: { prefixToken: true, negativeLines: true, dialogueSection: true, lexiconGate: true, gapsScope: true },
    negative: { core: 'worst quality, my own core', byTier: { sfw: 'extra-sfw', mild: '', hot: '', nsfl: '' } },
    output: { format: 'tags', withPrefix: false, broad: false }
  };
  const env4 = withConfig(four, 'four');
  const json4 = runCliJson(['少女在教室里读书', '--rating', 'nsfl', '--no-tier-token'], env4);
  ok('组C 面板四档配置：自定义档名 nsfl 被接受（exit 0、无档位 token）',
    json4.rating === 'nsfl' && json4.positive.lineBare === 'girl, reading, classroom',
    `rating=${json4.rating} line=«${json4.positive.lineBare}»`);
  ok('组C 面板 core 覆盖默认负面串，byTier 按档名追加',
    json4.negative.string.includes('worst quality, my own core')
    && json4.negative.string.includes('mosaic censoring'),
    `«${json4.negative.string}»`);
  const json4sfw = runCliJson(['少女在教室里读书', '--rating', 'sfw'], env4);
  ok('组C 第 1 档 = safe 语义（追加 builtin 克制词 + 面板 byTier）',
    json4sfw.negative.string.includes('extra-sfw')
    && json4sfw.negative.string.includes('nsfw, nude, nipples, explicit, censored')
    && json4sfw.tierPolicy.semantic === 'safe',
    `«${json4sfw.negative.string}» semantic=${json4sfw.tierPolicy.semantic}`);

  // C2 关掉某个面 → 该面行为退回内置默认
  const facesOff = { ...four, faces: { prefixToken: false, negativeLines: false, dialogueSection: true, lexiconGate: false, gapsScope: false } };
  const envOff = withConfig(facesOff, 'facesoff');
  const off1 = runCliJson(['少女在教室里读书', '--rating', 'nsfl'], envOff);
  ok('组C 面1 off：档位名自动不进串（连 --no-tier-token 都不用）',
    off1.positive.lineBare === 'girl, reading, classroom', `«${off1.positive.lineBare}»`);
  const off2 = runCliJson(['少女在教室里读书', '--rating', 'nsfl'], envOff);
  ok('组C 面2 off：负面串退回默认（不吃面板 core、不追加分档词）',
    off2.negative.string === NEGATIVE_DEFAULT, `«${off2.negative.string}»`);
  const off4 = runCliJson(['裸体少女在浴室里', '--rating', 'nsfl'], envOff);
  ok('组C 面4 off：档位门不挡词（naked 保留）',
    /naked/.test(off4.positive.lineBare) && off4.tierPolicy.faces.lexiconGate === false,
    `«${off4.positive.lineBare}» faces=${JSON.stringify(off4.tierPolicy.faces)}`);

  // C3 面 5 与 --broad 各自独立（用户裁决 C）
  const onlyGaps = { ...four, faces: { ...four.faces, lexiconGate: false }, output: { ...four.output, broad: true } };
  const envG = withConfig(onlyGaps, 'gapsonly');
  const jG = runCliJson(['裸体少女在浴室里', '--rating', 'nsfl', '--gaps'], envG);
  ok('组C 面5 与 output.broad 互不绑架（faces.gapsScope 与 broad 各自读自己的值）',
    jG.tierPolicy.faces.gapsScope === true && onlyGaps.output.broad === true
    && /naked/.test(runCliJson(['裸体少女在浴室里', '--rating', 'nsfl'], envG).positive.lineBare),
    `faces=${JSON.stringify(jG.tierPolicy.faces)}`);

  // C4 面板的误杀项删除规则（negative.dropRules）真跑 CLI
  const withRules = {
    ...four,
    negative: {
      core: 'worst quality, mirror, reflection',
      byTier: { sfw: '', mild: '', hot: '', nsfl: '' },
      dropRules: [
        { id: 'indoor-scene', when: ['classroom'], drop: ['mirror', 'reflection'] },
        { id: 'rain-scene', when: ['rain', 'water', 'puddle'], drop: ['worst quality'] }
      ]
    }
  };
  const envR = withConfig(withRules, 'droprules');
  const hitR = runCliJson(['少女在教室里读书', '--rating', 'nsfl', '--no-tier-token'], envR);
  ok('组C 面板删除规则：触发标签命中 → 指定项真的从负面串里消失，未命中的规则一动不动',
    !/mirror/.test(hitR.negative.string) && !/reflection/.test(hitR.negative.string)
    && hitR.negative.string.includes('worst quality'),
    `«${hitR.negative.string}»`);
  ok('组C 面板删除规则：不传档位时整条链不生效，负面串逐字等于默认',
    runCliJson(['少女在教室里读书'], envR).negative.string === NEGATIVE_DEFAULT,
    `«${runCliJson(['少女在教室里读书'], envR).negative.string}»`);

  // C5 删除发生在「档位增补之后」：连内置顶档纪律词也能被面板规则删掉
  const withOrder = {
    ...four,
    negative: {
      core: 'worst quality',
      byTier: { sfw: '', mild: '', hot: '', nsfl: '' },
      dropRules: [{ id: 'kill-top-extra', when: ['classroom'], drop: ['mosaic censoring'] }]
    }
  };
  const envO = withConfig(withOrder, 'droporder');
  const orderRun = runCliJson(['少女在教室里读书', '--rating', 'nsfl', '--no-tier-token'], envO);
  ok('组C 删除规则在档位增补之后执行（顺序：基线 → 分档增补 → 删误杀项）',
    !/mosaic censoring/.test(orderRun.negative.string) && /mosaic/.test(runCliJson(['少女在教室里读书', '--rating', 'nsfl', '--no-tier-token'], env4).negative.string),
    `面板删后=«${orderRun.negative.string}»`);

  for (const env of [env4, envOff, envG, envR, envO]) { try { fs.rmSync(env.__home, { recursive: true, force: true }); } catch {} }
}

try { fs.rmSync(ISO_HOME, { recursive: true, force: true }); } catch {}

console.log(`\n${pass} 通过 / ${fail} 失败 · ${Date.now() - t0}ms`);
if (fail > 0) process.exit(1);
