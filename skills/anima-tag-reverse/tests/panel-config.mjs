#!/usr/bin/env node
/**
 * panel-config.mjs —— 第 5 期：面板配置读取层的自测
 *
 * 跑法： node tests/panel-config.mjs        （在技能根目录）
 *
 * 覆盖 9 组：
 *   1. 三个候选都不存在 → 内置默认
 *   2. $DSH_HOME 指向含合法文件的目录 → 用该文件（含加档后档名跟随）
 *   3. 候选优先级：$DSH_ANIMA_PANEL_CONFIG > $DSH_HOME > skillDir
 *   4. 非法文件各判据 → 回退默认 + issues[].path 指到具体字段
 *   5. CLI 旧值 questionable / explicit → exit 1 + 迁移对照表 + stdout 无标签串
 *   6. CLI 未知档名 → exit 1 + 列出当前档名
 *   7. 与面板包冻结契约的字段名集合一致（跨仓库不能 import TS，只能比对文本）
 *   8. 负面词的误杀项删除规则（negative.dropRules）：合法解析 / 各类非法判据 / 落盘读回
 *   9. 配置来源文案 configRef()：命中文件给路径，没找到给「未找到，候选链：…」（不把候选印成配置文件）
 *
 * 为什么要有第 5、6 组：旧档位名曾经被静默接受，于是 `questionable` / `explicit`
 * 会被原样写进交付的标签串（前端显示的分级 token 就错了）。改造后必须硬报错。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  loadPanelConfig, validatePanelConfig, tierNames, resolveTier, migrationTable,
  warnLine, configCandidates, builtinConfig, BUILTIN_PANEL_CONFIG, LEGACY_TIERS, configRef
} from '../src/panel-config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(SKILL_DIR, '..', '..');
const CLI = path.join(SKILL_DIR, 'bin', 'rtag.mjs');

let pass = 0, fail = 0;
const t0 = Date.now();

function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`[通过] ${name}`); }
  else { fail++; console.log(`[失败] ${name}${detail ? `\n   → ${detail}` : ''}`); }
}

/** 临时目录里放一份配置，返回目录路径 */
function tmpDirWith(name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anima-panel-cfg-'));
  if (name) fs.writeFileSync(path.join(dir, name), content, 'utf8');
  return dir;
}

/** 合法配置样本（三档 + 自定义第 4 档） */
const VALID = {
  version: 1,
  tiers: [
    { name: 'safe', label: '全年龄', order: 1, criteria: '无露点' },
    { name: 'sensitive', label: '擦边', order: 2, criteria: '内衣泳装' },
    { name: 'nsfw', label: '露骨', order: 3, criteria: '露点' },
    { name: 'nsfl', label: '猎奇', order: 4, criteria: '断肢血腥' }
  ],
  defaultTier: 'safe',
  faces: { prefixToken: true, negativeLines: true, dialogueSection: true, lexiconGate: true, gapsScope: false },
  negative: { core: 'worst quality', byTier: { safe: '', sensitive: '', nsfw: '', nsfl: '' } },
  dialogue: { commonAlways: true },
  lexicon: { poolEnabled: false, tierGateStrict: true, kbDir: null },
  output: { format: 'tags', withPrefix: false, broad: true },
  appearance: { preset: 'standard', alpha: 0.86, blur: 14, radius: 14, motion: 'subtle' }
};

// ---- 组 1：三个候选都不存在 → 内置默认 --------------------------------------
{
  const emptyHome = tmpDirWith(null, null);
  const emptySkill = tmpDirWith(null, null);
  const r = loadPanelConfig({ env: { DSH_HOME: emptyHome }, skillDir: emptySkill });
  ok('组1 无任何配置文件时用内置默认', r.source.used === 'builtin' && r.warnings.length === 0,
    `used=${r.source.used} warnings=${JSON.stringify(r.warnings)}`);
  ok('组1 内置默认档名为 safe / sensitive / nsfw', tierNames(r.config).join(',') === 'safe,sensitive,nsfw',
    tierNames(r.config).join(','));
  ok('组1 候选链两条（DSH_HOME 的 anima-panel 与技能目录自带；未设覆写变量时）',
    configCandidates({ env: { DSH_HOME: emptyHome }, skillDir: emptySkill }).length === 2,
    JSON.stringify(configCandidates({ env: { DSH_HOME: emptyHome }, skillDir: emptySkill })));
  fs.rmSync(emptyHome, { recursive: true, force: true });
  fs.rmSync(emptySkill, { recursive: true, force: true });
}

// ---- 组 2：$DSH_HOME 里有合法文件 → 用该文件，档名跟随 -----------------------
{
  const home = tmpDirWith(null, null);
  fs.mkdirSync(path.join(home, 'anima-panel'), { recursive: true });
  fs.writeFileSync(path.join(home, 'anima-panel', 'panel-config.json'), JSON.stringify(VALID), 'utf8');
  const r = loadPanelConfig({ env: { DSH_HOME: home }, skillDir: SKILL_DIR });
  ok('组2 采用 DSH_HOME 下的配置文件', r.source.used.endsWith(path.join('anima-panel', 'panel-config.json')),
    r.source.used);
  ok('组2 四档档名按 order 排序返回', tierNames(r.config).join(',') === 'safe,sensitive,nsfw,nsfl',
    tierNames(r.config).join(','));
  ok('组2 自定义档位字段保持（label / criteria）',
    r.config.tiers[3].label === '猎奇' && r.config.tiers[3].criteria === '断肢血腥');
  ok('组2 候选松紧是独立开关（output.broad=true 与档位无关）', r.config.output.broad === true);
  fs.rmSync(home, { recursive: true, force: true });
}

// ---- 组 3：候选优先级 -------------------------------------------------------
{
  const home = tmpDirWith(null, null);
  fs.mkdirSync(path.join(home, 'anima-panel'), { recursive: true });
  fs.writeFileSync(path.join(home, 'anima-panel', 'panel-config.json'),
    JSON.stringify({ ...VALID, defaultTier: 'sensitive' }), 'utf8');
  const skillDir = tmpDirWith('panel-config.json', JSON.stringify({ ...VALID, tiers: VALID.tiers.slice(0, 1), defaultTier: 'safe' }));
  const explicit = path.join(home, 'mine.json');
  fs.writeFileSync(explicit, JSON.stringify({ ...VALID, tiers: VALID.tiers.slice(0, 2), defaultTier: 'sensitive' }), 'utf8');

  const r1 = loadPanelConfig({ env: { DSH_HOME: home, DSH_ANIMA_PANEL_CONFIG: explicit }, skillDir });
  ok('组3 显式 DSH_ANIMA_PANEL_CONFIG 优先', r1.source.used === path.resolve(explicit) && r1.config.tiers.length === 2,
    `${r1.source.used} tiers=${r1.config.tiers.length}`);
  const r2 = loadPanelConfig({ env: { DSH_HOME: home }, skillDir });
  ok('组3 其次 DSH_HOME/anima-panel', r2.config.tiers.length === 4, `tiers=${r2.config.tiers.length}`);
  const r3 = loadPanelConfig({ env: { DSH_HOME: tmpDirWith(null, null) }, skillDir });
  ok('组3 最后技能目录自带副本', r3.source.used === path.join(skillDir, 'panel-config.json') && r3.config.tiers.length === 1,
    `${r3.source.used} tiers=${r3.config.tiers.length}`);
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(skillDir, { recursive: true, force: true });
}

// ---- 组 4：非法文件各判据 → 回退默认 + issues 指到字段 ----------------------
{
  const cases = [
    ['档名非法', { ...VALID, tiers: [{ name: 'Safe', label: 'x', order: 1, criteria: '' }] }, 'tiers[0].name'],
    ['档名重复', { ...VALID, tiers: [VALID.tiers[0], { ...VALID.tiers[1], name: 'safe' }] }, 'tiers[1].name'],
    ['defaultTier 不在表内', { ...VALID, defaultTier: 'ghost' }, 'defaultTier'],
    ['档数为空', { ...VALID, tiers: [] }, 'tiers'],
    ['alpha 越界', { ...VALID, appearance: { ...VALID.appearance, alpha: 1.5 } }, 'appearance.alpha'],
    ['motion 非法', { ...VALID, appearance: { ...VALID.appearance, motion: 'wild' } }, 'appearance.motion'],
    ['output.format 非法', { ...VALID, output: { ...VALID.output, format: 'yaml' } }, 'output.format']
  ];
  for (const [name, doc, expectPath] of cases) {
    const v = validatePanelConfig(doc);
    const hit = !v.ok && v.issues.some(i => i.path === expectPath);
    ok(`组4 判非法 · ${name}`, hit,
      `ok=${v.ok} issues=${v.issues.map(i => i.path).join(',') || '（空）'}`);
  }
  // 字段缺失不算非法：按内置默认补齐（注意：给了 tiers 却不给 defaultTier 时，
  // defaultTier 会退回内置的 'safe'，若档表里没有 safe 就是真非法——与面板契约同一判据）
  const partial = validatePanelConfig({ appearance: { alpha: 0.9 } });
  ok('组4 字段缺失按内置默认补齐（不算非法）',
    partial.ok && partial.config.faces.gapsScope === true && partial.config.output.broad === false
    && partial.config.appearance.blur === 14 && partial.config.appearance.alpha === 0.9,
    `ok=${partial.ok} broad=${partial.config.output.broad} blur=${partial.config.appearance.blur} alpha=${partial.config.appearance.alpha}`);
  const singleTier = validatePanelConfig({ tiers: [{ name: 'only', label: '唯一档', order: 1, criteria: '' }], defaultTier: 'only' });
  ok('组4 自定义单档配置合法，byTier 按档名补空串',
    singleTier.ok && singleTier.config.negative.byTier.only === '' && singleTier.config.defaultTier === 'only',
    `ok=${singleTier.ok} byTier=${JSON.stringify(singleTier.config.negative.byTier)}`);
  const noDefault = validatePanelConfig({ tiers: [{ name: 'only', label: '唯一档', order: 1, criteria: '' }] });
  ok('组4 给了 tiers 但 defaultTier 落空 → 非法并指到 defaultTier',
    !noDefault.ok && noDefault.issues.some(i => i.path === 'defaultTier'),
    `ok=${noDefault.ok} issues=${noDefault.issues.map(i => i.path).join(',')}`);
  // 坏 JSON 文件 / 读不了的文件：整份跳过 + warning，不抛异常
  const home = tmpDirWith(null, null);
  fs.mkdirSync(path.join(home, 'anima-panel'), { recursive: true });
  fs.writeFileSync(path.join(home, 'anima-panel', 'panel-config.json'), '{ 这不是 JSON', 'utf8');
  let r;
  try { r = loadPanelConfig({ env: { DSH_HOME: home }, skillDir: path.join(home, 'nope') }); }
  catch (e) { r = { crash: e.message }; }
  ok('组4 坏 JSON 不抛异常、回退默认且给 warning',
    !r.crash && r.source.used === 'builtin' && r.warnings.length === 1 && /不是合法 JSON/.test(r.warnings[0]),
    JSON.stringify(r).slice(0, 200));
  ok('组4 warnLine 是一行且带默认档名', !warnLine(r.warnings, r.config).includes('\n')
    && warnLine(r.warnings, r.config).includes('safe / sensitive / nsfw'), warnLine(r.warnings, r.config));
  fs.rmSync(home, { recursive: true, force: true });
}

// ---- 组 5 + 6：CLI 档名校验（硬报错退出） ----------------------------------
// 隔离环境：只留「技能目录自带副本」这一个候选（本仓库没有该文件），
// 否则会读到开发机上真实的 $DSH_HOME/anima-panel/panel-config.json，用例就不确定了。
const ISOLATED_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'anima-panel-iso-'));
function runCli(args, env = {}) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      cwd: SKILL_DIR, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
      env: {
        ...process.env,
        DSH_HOME: ISOLATED_HOME,
        DSH_ANIMA_PANEL_CONFIG: path.join(ISOLATED_HOME, 'none.json'),
        ...env
      }
    });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status == null ? -1 : e.status, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

const legacyA = runCli(['一个女孩站在阳台上', '--rating', 'questionable', '--format', 'prompt']);
ok('组5 旧值 questionable → exit 1', legacyA.code === 1, `code=${legacyA.code}`);
ok('组5 旧值 questionable → 打印迁移对照表',
  /旧档位名 → 新档位名/.test(legacyA.stderr) && /questionable\s+→\s+--rating sensitive/.test(legacyA.stderr),
  legacyA.stderr.split('\n').slice(0, 3).join(' | '));
ok('组5 旧值 questionable → stdout 不含标签串', !/masterpiece|1girl/.test(legacyA.stdout), legacyA.stdout.slice(0, 80));

const legacyB = runCli(['一个女孩站在阳台上', '--rating', 'explicit']);
ok('组5 旧值 explicit → exit 1 且提 explicit → nsfw',
  legacyB.code === 1 && /explicit\s+→\s+--rating nsfw/.test(legacyB.stderr), `code=${legacyB.code}`);

const ghost = runCli(['一个女孩站在阳台上', '--rating', 'ghost']);
ok('组6 未知档名 → exit 1 且列出当前档名',
  ghost.code === 1 && /当前档名/.test(ghost.stderr) && /safe \/ sensitive \/ nsfw/.test(ghost.stderr),
  ghost.stderr.split('\n').slice(0, 2).join(' | '));

const good = runCli(['一个女孩站在阳台上', '--rating', 'nsfw', '--format', 'prompt']);
ok('组6 合法档名照常出串（前缀第 4 位 = nsfw）',
  good.code === 0 && /^masterpiece, best quality, score_7, nsfw/.test(good.stdout), good.stdout.slice(0, 90));

// 配置来源跟随 DSH_HOME：把档名改成中文档位后，旧值报错文案里应出现新档名
{
  const home = tmpDirWith(null, null);
  fs.mkdirSync(path.join(home, 'anima-panel'), { recursive: true });
  fs.writeFileSync(path.join(home, 'anima-panel', 'panel-config.json'), JSON.stringify({
    ...VALID,
    tiers: [
      { name: 'g', label: '全年龄', order: 1, criteria: '' },
      { name: 'r18', label: '成人', order: 2, criteria: '' }
    ],
    defaultTier: 'g'
  }), 'utf8');
  const r = runCli(['一个女孩站在阳台上', '--rating', 'r18', '--format', 'json'], { DSH_HOME: home });
  let rating = null;
  try { rating = JSON.parse(r.stdout).rating; } catch { /* 保持 null */ }
  ok('组6 档名跟随面板配置（自定义档 r18 被接受）', r.code === 0 && rating === 'r18',
    `code=${r.code} rating=${rating}`);
  const bad = runCli(['一个女孩站在阳台上', '--rating', 'safe'], { DSH_HOME: home });
  ok('组6 配置改档后，不在表内的旧档名被拒（safe 已不是档名）',
    bad.code === 1 && /当前档名：g \/ r18/.test(bad.stderr), `code=${bad.code} ${bad.stderr.split('\n')[0]}`);
  fs.rmSync(home, { recursive: true, force: true });
}

// ---- 组 7：与面板包冻结契约的字段名集合一致 --------------------------------
{
  const contractPath = path.join(REPO_ROOT, 'packages', 'dsh-anima-tag-reverse', 'src', 'config-types.ts');
  let text = '';
  try { text = fs.readFileSync(contractPath, 'utf8'); } catch (e) { text = ''; }
  if (!text) {
    ok('组7 面板契约文件可读', false, contractPath + ' 读不到（面板包是否还在？）');
  } else {
    // 解析 TS 接口成员（`appearance: { … }` 这类字面量里可能嵌了别的花括号，所以按 interface 取）
    const grab = name => {
      const m = new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`, 'm').exec(text);
      return m ? [...m[1].matchAll(/^\s{2}([A-Za-z][A-Za-z0-9_]*)\??\s*:/gm)].map(x => x[1]).sort().join(',') : '(未匹配)';
    };
    const mine = o => Object.keys(o).sort().join(',');
    ok('组7 faces 字段名一致', mine(BUILTIN_PANEL_CONFIG.faces) === grab('FaceSwitches'),
      `契约=${grab('FaceSwitches')} / 本模块=${mine(BUILTIN_PANEL_CONFIG.faces)}`);
    ok('组7 output 字段名一致', mine(BUILTIN_PANEL_CONFIG.output) === grab('OutputConfig'),
      `契约=${grab('OutputConfig')} / 本模块=${mine(BUILTIN_PANEL_CONFIG.output)}`);
    ok('组7 lexicon 字段名一致', mine(BUILTIN_PANEL_CONFIG.lexicon) === grab('LexiconConfig'),
      `契约=${grab('LexiconConfig')} / 本模块=${mine(BUILTIN_PANEL_CONFIG.lexicon)}`);
    ok('组7 appearance 字段名一致', mine(BUILTIN_PANEL_CONFIG.appearance) === grab('AppearanceConfig'),
      `契约=${grab('AppearanceConfig')} / 本模块=${mine(BUILTIN_PANEL_CONFIG.appearance)}`);
    ok('组7 negative / dialogue 字段名一致',
      mine(BUILTIN_PANEL_CONFIG.negative) === grab('NegativeConfig') && mine(BUILTIN_PANEL_CONFIG.dialogue) === grab('DialogueConfig'),
      `negative=${grab('NegativeConfig')} / dialogue=${grab('DialogueConfig')}`);
    ok('组7 三档默认值与契约一致（name/label/order/criteria）',
      JSON.stringify(BUILTIN_PANEL_CONFIG.tiers.slice(0, 3)) === JSON.stringify([
        { name: 'safe', label: '全年龄', order: 1, criteria: '无露点、无性暗示' },
        { name: 'sensitive', label: '擦边', order: 2, criteria: '内衣/泳装/湿身/挑逗，无露点（含旧 questionable）' },
        { name: 'nsfw', label: '露骨', order: 3, criteria: '露乳房或露性器官（含旧 explicit）' }
      ]), JSON.stringify(BUILTIN_PANEL_CONFIG.tiers.slice(0, 3)));
    ok('组7 旧档位迁移表与面板 criteria 文案吻合', LEGACY_TIERS.questionable === 'sensitive' && LEGACY_TIERS.explicit === 'nsfw');
    ok('组7 resolveTier 对合法 / 旧值 / 未知三态判定正确',
      resolveTier(builtinConfig(), 'nsfw').ok === true
      && resolveTier(builtinConfig(), 'explicit').kind === 'legacy'
      && resolveTier(builtinConfig(), 'nope').kind === 'unknown');
    ok('组7 migrationTable 两行且带当前档位表', /questionable/.test(migrationTable(BUILTIN_PANEL_CONFIG))
      && /explicit/.test(migrationTable(BUILTIN_PANEL_CONFIG)) && /当前档位表/.test(migrationTable(BUILTIN_PANEL_CONFIG)));
  }
}

// ---- 组 8：负面词的「误杀项删除规则」字段（面板可编辑、可落盘、技能读取） ------
{
  /** 一份带 dropRules 的配置：第 4 期 ① 新增的字段 */
  const withRules = rules => ({
    ...VALID,
    negative: { core: 'worst quality', byTier: { ...VALID.negative.byTier }, dropRules: rules }
  });
  const RULE = { id: 'rule-1', when: ['rain', 'water'], drop: ['mirror', 'reflection'] };

  const good = validatePanelConfig(withRules([RULE]));
  ok('组8 合法 dropRules 原样并入 config（id/when/drop 三字段）',
    good.ok && JSON.stringify(good.config.negative.dropRules) === JSON.stringify([RULE]),
    `ok=${good.ok} dropRules=${JSON.stringify(good.config.negative.dropRules)}`);

  const missing = validatePanelConfig({ ...VALID });
  ok('组8 字段缺失 = 没有额外规则（合法，补空数组，不判非法）',
    missing.ok && Array.isArray(missing.config.negative.dropRules) && missing.config.negative.dropRules.length === 0,
    `ok=${missing.ok} dropRules=${JSON.stringify(missing.config.negative.dropRules)}`);

  const trimmed = validatePanelConfig(withRules([{ id: ' rule-2 ', when: [' rain '], drop: [' mirror '] }]));
  ok('组8 id 与词项自动去空白',
    trimmed.ok && trimmed.config.negative.dropRules[0].id === 'rule-2'
    && trimmed.config.negative.dropRules[0].when[0] === 'rain'
    && trimmed.config.negative.dropRules[0].drop[0] === 'mirror',
    JSON.stringify(trimmed.config.negative.dropRules));

  const notArray = validatePanelConfig(withRules('rain'));
  ok('组8 dropRules 不是数组 → 非法，path 指到 negative.dropRules',
    notArray.ok === false && notArray.issues.some(i => i.path === 'negative.dropRules' && i.message === '删除规则必须是数组'),
    JSON.stringify(notArray.issues));

  const notRecord = validatePanelConfig(withRules([['rain']]));
  ok('组8 规则项不是对象 → 非法并说明「必须是对象」',
    notRecord.ok === false && notRecord.issues.some(i => i.path === 'negative.dropRules[0]' && i.message === '删除规则必须是对象'),
    JSON.stringify(notRecord.issues));

  const tooMany = validatePanelConfig(withRules(
    Array.from({ length: 17 }, (_, i) => ({ id: `rule-${i + 1}`, when: ['rain'], drop: ['mirror'] }))
  ));
  ok('组8 超过 16 条 → 非法（文案与面板契约一致）',
    tooMany.ok === false && tooMany.issues.some(i => i.path === 'negative.dropRules' && i.message === '删除规则最多 16 条'),
    JSON.stringify(tooMany.issues.slice(0, 2)));

  const badId = validatePanelConfig(withRules([{ id: '1rule', when: ['rain'], drop: ['mirror'] }]));
  ok('组8 规则 id 非法（数字开头）→ 非法并指到 .id',
    badId.ok === false && badId.issues.some(i => i.path === 'negative.dropRules[0].id' && /小写字母/.test(i.message)),
    JSON.stringify(badId.issues));

  const dupId = validatePanelConfig(withRules([
    { id: 'rule-1', when: ['rain'], drop: ['mirror'] },
    { id: 'rule-1', when: ['water'], drop: ['reflection'] }
  ]));
  ok('组8 规则 id 重复 → 非法并点名重复的 id',
    dupId.ok === false && dupId.issues.some(i => i.path === 'negative.dropRules[1].id' && i.message === '规则 id「rule-1」重复'),
    JSON.stringify(dupId.issues));

  const emptyWhen = validatePanelConfig(withRules([{ id: 'rule-1', when: [], drop: ['mirror'] }]));
  const noWhen = validatePanelConfig(withRules([{ id: 'rule-1', drop: ['mirror'] }]));
  ok('组8 触发标签为空 / 缺字段 → 都要「不能为空，至少写一项」',
    emptyWhen.ok === false && emptyWhen.issues.some(i => i.path === 'negative.dropRules[0].when' && i.message === '触发标签不能为空，至少写一项')
    && noWhen.ok === false && noWhen.issues.some(i => i.path === 'negative.dropRules[0].when' && i.message === '触发标签不能为空，至少写一项'),
    JSON.stringify([...emptyWhen.issues, ...noWhen.issues]));

  const blankItem = validatePanelConfig(withRules([{ id: 'rule-1', when: ['rain', '  '], drop: ['mirror'] }]));
  ok('组8 触发标签里有空项 → 非法并指到具体下标',
    blankItem.ok === false && blankItem.issues.some(i => i.path === 'negative.dropRules[0].when[1]' && i.message === '触发标签不能是空项'),
    JSON.stringify(blankItem.issues));

  const longTerm = validatePanelConfig(withRules([{ id: 'rule-1', when: ['x'.repeat(65)], drop: ['mirror'] }]));
  const manyTerms = validatePanelConfig(withRules([
    { id: 'rule-1', when: Array.from({ length: 25 }, (_, i) => `t${i}`), drop: ['mirror'] }
  ]));
  ok('组8 单项超过 64 字符 / 超过 24 项 → 都判非法',
    longTerm.ok === false && longTerm.issues.some(i => i.path === 'negative.dropRules[0].when[0]' && i.message === '触发标签单项最长 64 个字符')
    && manyTerms.ok === false && manyTerms.issues.some(i => i.path === 'negative.dropRules[0].when' && i.message === '触发标签最多 24 项'),
    JSON.stringify([...longTerm.issues, ...manyTerms.issues]));

  const badDrop = validatePanelConfig(withRules([{ id: 'rule-1', when: ['rain'], drop: 'mirror' }]));
  ok('组8 要删的项不是数组 → 文案用「要删的项」这一路的标签',
    badDrop.ok === false && badDrop.issues.some(i => i.path === 'negative.dropRules[0].drop' && i.message === '要删的项必须是数组'),
    JSON.stringify(badDrop.issues));

  // 落盘 → 读回：真文件走一遭，证明技能能读到面板写下的规则
  const home = tmpDirWith(null, null);
  fs.mkdirSync(path.join(home, 'anima-panel'), { recursive: true });
  fs.writeFileSync(
    path.join(home, 'anima-panel', 'panel-config.json'),
    JSON.stringify(withRules([RULE])),
    'utf8'
  );
  const loaded = loadPanelConfig({ env: { DSH_HOME: home }, skillDir: home });
  ok('组8 真文件落盘后读回：source.used 是文件路径且规则在 config 里',
    loaded.source.used === path.join(home, 'anima-panel', 'panel-config.json')
    && JSON.stringify(loaded.config.negative.dropRules) === JSON.stringify([RULE])
    && loaded.warnings.length === 0,
    `used=${loaded.source.used} dropRules=${JSON.stringify(loaded.config.negative.dropRules)}`);
  fs.rmSync(home, { recursive: true, force: true });
}

// ---- 组 9：配置来源文案 configRef()（命中给路径；没找到给候选链，绝不把候选印成「配置文件」） ----
{
  // 9-1 命中文件：直接给该文件绝对路径
  const home = tmpDirWith(null, null);
  fs.mkdirSync(path.join(home, 'anima-panel'), { recursive: true });
  const file = path.join(home, 'anima-panel', 'panel-config.json');
  fs.writeFileSync(file, JSON.stringify(VALID), 'utf8');
  const hit = loadPanelConfig({ env: { DSH_HOME: home }, skillDir: home });
  ok('组9 命中文件时 configRef 返回该文件路径', configRef(hit.source) === file && !/未找到/.test(configRef(hit.source)),
    configRef(hit.source));
  fs.rmSync(home, { recursive: true, force: true });

  // 9-2 没找到：给「未找到，候选链：…」，且候选链与 configCandidates 完全一致
  const emptyHome = tmpDirWith(null, null);
  const emptySkill = tmpDirWith(null, null);
  const env = { DSH_HOME: emptyHome, DSH_ANIMA_PANEL_CONFIG: path.join(emptyHome, 'ov.json') };
  const miss = loadPanelConfig({ env, skillDir: emptySkill });
  const chain = configCandidates({ env, skillDir: emptySkill });
  const ref = configRef(miss.source);
  ok('组9 没找到时 configRef 以「未找到，候选链：」开头，并逐条列出候选',
    ref.startsWith('未找到，候选链：') && chain.every(p => ref.includes(p)) && chain.length === 3,
    `ref=${ref}`);
  ok('组9 source.candidates 与 configCandidates() 逐条一致（错误文案不必再自己算一遍）',
    JSON.stringify(miss.source.candidates) === JSON.stringify(chain) && miss.source.used === 'builtin',
    JSON.stringify(miss.source.candidates));
  fs.rmSync(emptyHome, { recursive: true, force: true });
  fs.rmSync(emptySkill, { recursive: true, force: true });

  // 9-3 真机口径：无配置时旧档名报错不再把候选路径印成「配置文件：<path>」
  const legacyNoCfg = runCli(['一个女孩站在阳台上', '--rating', 'questionable']);
  ok('组9 无配置 + 旧档名：stderr 写「配置文件：未找到，候选链：」，exit 1 不变',
    legacyNoCfg.code === 1 && /配置文件：未找到，候选链：/.test(legacyNoCfg.stderr),
    legacyNoCfg.stderr.split('\n').slice(-2).join(' | '));

  // 9-4 --info 同一口径
  const infoNoCfg = runCli(['--info']);
  ok('组9 无配置 + --info：配置来源写「内置默认（配置文件：未找到，候选链：…）」',
    infoNoCfg.code === 0 && /配置来源：内置默认（配置文件：未找到，候选链：/.test(infoNoCfg.stdout),
    infoNoCfg.stdout.split('\n').filter(l => /配置来源/.test(l)).join(' | '));

  // 9-5 --dialogue 缺档位：报错给当前档位表，不牵扯配置文件
  const dialogueNoRating = runCli(['--dialogue']);
  ok('组9 --dialogue 缺档位：报错只提当前档位表（三档），不提配置文件',
    dialogueNoRating.code === 1 && /当前档位表：safe \/ sensitive \/ nsfw/.test(dialogueNoRating.stderr)
    && !/配置文件：/.test(dialogueNoRating.stderr),
    dialogueNoRating.stderr.split('\n').slice(-2).join(' | '));
}

console.log(`\n${pass} 通过 / ${fail} 失败 · ${Date.now() - t0}ms`);
process.exitCode = fail ? 1 : 0;
