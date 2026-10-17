#!/usr/bin/env node
/**
 * anima3.mjs —— 第 6 期自测：并入「ANIMA3 提示词生成模板 v3.1」的那四条规则
 *              （互斥提醒 / 标签总数区间 / 单人默认视线 / 主题配方）。
 *
 * 跑法：node tests/anima3.mjs          （在技能根目录）
 *
 * 覆盖 2 组：
 *   A. 纯函数（src/rules.mjs）：规则表读入、人数判定、总数区间、互斥命中、默认视线判据、主题查找、annotate 汇总
 *   B. CLI 集成（bin/rtag.mjs）：--theme-list（含 JSON）、--theme 注入、--no-view-default / --view-default、
 *      --no-hints、互斥与总数提醒只在 hybrid / check / gaps / json 下打、旧形态（--format tags）逐字节不变
 *
 * 铁律（与其余六套一致，改代码前先读这段）：
 *   1. `--format tags|prompt|line|bare` 是**旧形态**，默认不注入默认视线、不打提醒，交付串逐字节不变；
 *   2. 提醒只提醒不拦截：交付串原样给出，多出来的只是末尾几行（hybrid / check）与 json 的 annotate / gaps；
 *   3. 规则表是技能自带的 `references/anima3-rules.json`（core 包不含 KB），读不到时的行为由调用方兜。
 *
 * 环境隔离：所有 CLI 用例都注入临时 $DSH_HOME，并把 $DSH_ANIMA_PANEL_CONFIG 指向不存在的文件，
 *          否则会读到开发机上真实的 ~/.dsh/anima-panel/panel-config.json。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  RULES_FILE, loadRules, personCount, countHint, mutexHits,
  needsViewDefault, viewDefaultTags, themeList, themeById, annotate
} from '../src/rules.mjs';
import { dispTag } from '../src/compose.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(HERE, '..');
const CLI = path.join(SKILL_DIR, 'bin', 'rtag.mjs');

let pass = 0, fail = 0;
const t0 = Date.now();

function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`[通过] ${name}`); }
  else { fail++; console.log(`[失败] ${name}${detail ? `\n   → ${detail}` : ''}`); }
}

const ISO_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'anima-anima3-'));
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
function runCliTry(args, env = {}) {
  try { return { status: 0, stdout: runCli(args, env), stderr: '' }; }
  catch (e) { return { status: e.status, stdout: String(e.stdout || ''), error: String(e.stderr || e.message || '') }; }
}

const READING = '少女在教室里读书';
const SINGLE_SCENE = '一位银发少女坐在窗边的旧木桌前，桌上放着半杯温掉的姜茶';
const MUTEX_SCENE = '少女躺在床上闭着眼睛睡觉，看着镜头';

const R = loadRules();

// ============================================================================
// A. 纯函数
// ============================================================================
{
  ok('A1 规则表读得进：五组互斥 / 八条观众句 / 十二主题 / 两条默认视线 / 总数区间',
    R.mutex.length === 5 && R.viewerClauses.length === 8 && R.themes.length === 12
    && viewDefaultTags(R).length === 2 && Array.isArray(R.counts.single) && R.counts.single[0] === 20
    && fs.existsSync(RULES_FILE),
    `mutex=${R.mutex.length} viewer=${R.viewerClauses.length} themes=${R.themes.length} view=${viewDefaultTags(R).length} counts.single=${JSON.stringify(R.counts.single)}`);

  const list = themeList(R);
  const ntr = list.find(s => s.id === 'ntr');
  ok('A2 主题清单：十二个主题、每个都有 id/中文名/条数/出处；ntr 43 条',
    list.length === 12 && list.every(s => s.id && s.zh && s.count > 0 && s.src)
    && !!ntr && ntr.count === 43,
    `ntr=${ntr ? ntr.count : 'none'} / ${list.map(s => `${s.id}:${s.count}`).join(' ')}`);

  ok('A3 themeById 认 id、找不到给 null',
    !!themeById(R, 'ntr') && themeById(R, 'NOPE') === null && themeById(R, 'ntr').tags.length === 43);
}

{
  const a = personCount(['1girl', 'solo']);
  const b = personCount(['girl']);
  const c = personCount(['blue eyes', 'smile']);
  ok('A4 人数判定·单人：1girl+solo / 光 girl / 没有人的输入',
    a.n === 1 && a.kind === 'single' && a.solo === true
    && b.n === 1 && b.kind === 'single'
    && c.kind === null,
    `${a.kind}/${a.n}/${a.solo} · ${b.kind}/${b.n} · ${c.kind}`);

  const d = personCount(['1girl', '1boy']);
  const e = personCount(['2girls']);
  const f = personCount(['multiple girls']);
  ok('A5 人数判定·双人与多人：1girl+1boy / 2girls / multiple girls',
    d.kind === 'duo' && e.kind === 'duo' && e.n === 2 && f.kind === 'group',
    `${d.kind} · ${e.kind}/${e.n} · ${f.kind}`);
}

{
  const low = countHint(9, 'single', R);
  const inRange = countHint(30, 'single', R);
  ok('A6 总数区间：9 条单人报「偏少」、30 条安静',
    low.ok === false && /20–36/.test(low.text) && /偏少/.test(low.text)
    && inRange.ok === true && inRange.text === '',
    `${low.text} ／ ok=${inRange.ok}`);
}

{
  const sleep = mutexHits(['sleeping', 'looking at viewer'], R);
  const view = mutexHits(['from front', 'from behind'], R);
  ok('A7 互斥命中：sleeping × looking at viewer（身份组）、from front × from behind（视角组）',
    sleep.length >= 1 && sleep.every(m => m.kind === 'pair' || m.kind === 'count')
    && sleep.some(m => m.group === 'identity') && view.some(m => m.group === 'viewpoint'),
    `${sleep.map(m => m.group).join(',')} ／ ${view.map(m => m.group).join(',')}`);

  const quiet = mutexHits(['girl', 'smile', 'blue eyes'], R);
  const feet2 = mutexHits(['foot focus', 'footjob'], R);
  ok('A8 互斥不误报：无关组合为空；足部组两条不算过度（≥3 条才算）',
    quiet.length === 0 && feet2.length === 0,
    `${quiet.length} / ${feet2.length}`);
}

{
  ok('A9 默认视线判据：正面场景要加；要背影 / 已有视角标签 / 睡姿都不要',
    needsViewDefault(READING, ['girl']) === true
    && needsViewDefault('少女的背影', ['girl']) === false
    && needsViewDefault(READING, ['girl', 'from behind']) === false
    && needsViewDefault(READING, ['girl', 'looking at viewer']) === false
    && needsViewDefault(READING, ['1girl', 'sleeping']) === false);
}

{
  const nine = annotate({ tags: Array.from({ length: 9 }, (_, i) => `t${i}`).concat('girl'), query: READING, rules: R });
  const thirty = annotate({ tags: Array.from({ length: 30 }, (_, i) => `t${i}`).concat('girl'), query: READING, rules: R });
  const bad = annotate({ tags: ['sleeping', 'looking at viewer'], query: MUTEX_SCENE, rules: R });
  ok('A10 annotate 汇总：偏少给出 · 行、够数安静、互斥给出 ⚠ 行',
    nine.lines.some(l => l.startsWith('· ') && /20–36/.test(l))
    && !thirty.lines.some(l => l.startsWith('· '))
    && bad.lines.some(l => l.startsWith('⚠ ')),
    `${nine.lines.length} / ${thirty.lines.length} / ${bad.lines.join(' | ')}`);
}

// ============================================================================
// B. CLI 集成
// ============================================================================
{
  const plain = runCli(['--theme-list']);
  const j = JSON.parse(runCli(['--theme-list', '--format', 'json']));
  ok('B1 --theme-list 列表 + JSON 形态（schema anima-tag-reverse/themes@1）',
    /共 12 个/.test(plain) && /ntr/.test(plain)
    && j.schema === 'anima-tag-reverse/themes@1' && j.themes.length === 12
    && j.themes.every(t => t.id && t.count > 0),
    `${plain.split('\n')[0]} ／ schema=${j.schema} n=${j.themes.length}`);

  const bad = runCliTry(['--theme', 'nope', READING]);
  ok('B2 --theme 写错 id → 非零退出，报错里列出可用主题',
    bad.status !== 0 && /ntr/.test(bad.error || ''),
    `status=${bad.status} err=${(bad.error || '').slice(0, 90)}`);
}

{
  const on = runCli([SINGLE_SCENE]);
  const off = runCli([SINGLE_SCENE, '--no-view-default']);
  ok('B3 新形态默认补单人视线，--no-view-default 关掉',
    /^direct eye contact, facing viewer,$/m.test(on) && !/direct eye contact/.test(off),
    `on=${/direct eye contact/.test(on)} off=${/direct eye contact/.test(off)}`);

  const legacy = runCli([SINGLE_SCENE, '--format', 'tags']);
  const forced = runCli([SINGLE_SCENE, '--format', 'tags', '--view-default']);
  ok('B4 旧形态不注入，显式 --view-default 才注入',
    !/direct eye contact/.test(legacy) && /direct eye contact/.test(forced),
    `legacy=${legacy.trim()} ／ forced=${forced.trim()}`);

  ok('B5 旧契约：--format tags 读「少女在教室里读书」仍逐字 girl, reading, classroom',
    runCli([READING, '--format', 'tags']).trim() === 'girl, reading, classroom',
    runCli([READING, '--format', 'tags']).trim());
}

{
  const hit = runCli([MUTEX_SCENE]);
  const muted = runCli([MUTEX_SCENE, '--no-hints']);
  ok('B6 互斥提醒默认打（⚠ 行），--no-hints 关掉；交付串本身不动',
    /^⚠ /m.test(hit) && !/⚠/.test(muted) && /^Negative prompt: /m.test(hit),
    `hit=${(hit.match(/^⚠ .*$/m) || [''])[0].slice(0, 60)}`);

  const junit = runCliJson([MUTEX_SCENE]);
  ok('B7 互斥也进 JSON：annotate.lines 与 gaps 的 mutex 记录',
    !!junit.annotate && junit.annotate.mutex.length >= 1 && junit.annotate.lines.some(l => l.startsWith('⚠ '))
    && Array.isArray(junit.gaps) && junit.gaps.some(g => g.kind === 'mutex'),
    `annotate=${junit.annotate ? junit.annotate.mutex.length : 'none'} gaps=${(junit.gaps || []).map(g => g.kind).join(',')}`);
}

{
  const short = runCli([SINGLE_SCENE]);
  const shortJson = runCliJson([SINGLE_SCENE]);
  const quiet = runCliJson([SINGLE_SCENE, '--no-hints']);
  ok('B8 总数提醒默认打（· 行）并进 json；--no-hints 时 JSON 没有 annotate 键',
    /^· 标签共 \d+ 条，单人建议 20–36 条/m.test(short)
    && shortJson.annotate && shortJson.annotate.count.ok === false
    && !quiet.annotate,
    `${(short.match(/^· .*$/m) || [''])[0]} ／ quiet=${!!quiet.annotate}`);

  const inj = runCliJson([SINGLE_SCENE, '--view-default']).positive.layers.flatMap(l => l.tags).filter(t => t.injected);
  const legacyJson = runCliJson([SINGLE_SCENE, '--format', 'tags']);
  const legacyInj = legacyJson.positive.layers.flatMap(l => l.tags).filter(t => t.injected);
  ok('B9 json 里注入标签带 injected/source（显式 --view-default 时两条）；旧形态 json 里一个都没有',
    inj.length === 2 && inj.every(t => t.source === 'view-default') && legacyInj.length === 0,
    `显式注入 ${inj.length} ／ 旧形态注入 ${legacyInj.length}`);
}

{
  const ntr = themeById(R, 'ntr');
  const j = runCliJson([READING, '--theme', 'ntr']);
  const shown = new Set(j.positive.layers.flatMap(l => l.tags).map(t => t.display));
  const want = ntr.tags.map(t => dispTag(t));
  const hits = want.filter(t => shown.has(t));
  ok('B10 --theme ntr：主题标签注入交付串、json 记 annotate.theme',
    hits.length >= 15 && j.annotate && j.annotate.theme && j.annotate.theme.id === 'ntr',
    `命中 ${hits.length}/${want.length}`);

  const lines = runCli([READING, '--theme', 'ntr']);
  ok('B11 --theme 的末尾提示：报注入条数与「还要满足」',
    /^· 主题「/m.test(lines) && /注入 \d+ 条标签/.test(lines) && /还要满足/.test(lines),
    (lines.match(/^· .*$/gm) || []).join(' | ').slice(0, 120));

  const tagged = runCli([READING, '--theme', 'ntr', '--format', 'tags']);
  const themeHitInLegacy = want.some(t => tagged.includes(t));
  ok('B12 主题是显式要求：旧形态 --format tags 也会被注入（与默认视线不同）',
    themeHitInLegacy, `legacy 串长 ${tagged.trim().length}`);
}

{
  const srcs = runCliJson([READING, '--theme', 'ntr']).positive.layers.flatMap(l => l.tags).map(t => t.source);
  const viewSrcs = runCliJson([SINGLE_SCENE, '--view-default']).positive.layers.flatMap(l => l.tags).map(t => t.source);
  ok('B13 主题在场时不叠加默认视线（主题自己管视角）',
    !srcs.includes('view-default') && viewSrcs.includes('view-default'),
    `theme=${srcs.join(',')} ／ 无主题=${viewSrcs.join(',')}`);
}

{
  const multi = runCli(['一位银发少女坐在窗边的旧木桌前，少女的男友站在身后，两人对视']);
  ok('B14 关键词命中时仍按词库来：多主体输入不会硬塞单人视线（有人物 token 才算）',
    /^Negative prompt: /m.test(multi) && /标签共 \d+ 条/m.test(multi),
    (multi.match(/^· .*$/m) || [''])[0]);
}

// ============================================================================
{
  const ms = Date.now() - t0;
  console.log('');
  console.log(`anima3：${pass} 通过 / ${fail} 失败 · ${ms} ms`);
  if (fail) process.exitCode = 1;
}
