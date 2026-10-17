#!/usr/bin/env node
/**
 * dialogue.mjs —— 第 4 期（面 3「压字」）自测：按档位挑 dialogue-style 该读的章节
 *
 * 跑法： node tests/dialogue.mjs        （在技能根目录）
 *
 * 覆盖 3 组（共 30+ 条断言）：
 *   A. 纯函数：dialoguePlan / sectionIdFor / formatDialoguePlan / dialogueRefIssues
 *   B. CLI 集成：`--dialogue` / `--format dialogue` / `--format json` 的 dialogueSection，
 *      以及铁律「不传 `--rating` 时一个键都不加、输出逐字节不变」
 *   C. 隔离配置：`faces.dialogueSection = false` 与 `dialogue.commonAlways = false`
 *      真能改行为；档位改名后按语义档位选篇
 *
 * 铁律（与其余四个面一致，改代码前先读这段）：
 *   1. 不传 `--rating` → 面 3 整体关闭：JSON 里没有 `dialogueSection` 键，`--dialogue` 直接报错退出；
 *   2. 面板调用总是「显式档位 + --no-tier-token」，选篇不影响交付串（`--dialogue` 只打印选篇）。
 *
 * 环境隔离：所有 CLI 用例都注入临时 $DSH_HOME，并把 $DSH_ANIMA_PANEL_CONFIG 指向
 * 不存在的文件，否则会读到开发机上真实的 ~/.dsh/anima-panel/panel-config.json。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { buildPolicy } from '../src/tier-policy.mjs';
import { BUILTIN_PANEL_CONFIG } from '../src/panel-config.mjs';
import {
  DIALOGUE_REF_FILE, DIALOGUE_SECTIONS, SECTION_BY_SEMANTIC,
  dialoguePlan, sectionIdFor, formatDialoguePlan, dialogueRefIssues
} from '../src/dialogue.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(HERE, '..');
const CLI = path.join(SKILL_DIR, 'bin', 'rtag.mjs');
const REF_PATH = path.join(SKILL_DIR, DIALOGUE_REF_FILE);

let pass = 0, fail = 0;
const t0 = Date.now();

function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`[通过] ${name}`); }
  else { fail++; console.log(`[失败] ${name}${detail ? `\n   → ${detail}` : ''}`); }
}

const ISO_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'anima-dialogue-'));
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
  catch (e) { return { status: e.status, stdout: String(e.stdout || ''), stderr: String(e.stderr || '') }; }
}

/** 写一份隔离的 panel-config.json，返回 env 覆盖（用完删掉） */
function withConfig(doc, label) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `anima-dlg-${label}-`));
  fs.mkdirSync(path.join(home, 'anima-panel'), { recursive: true });
  fs.writeFileSync(path.join(home, 'anima-panel', 'panel-config.json'), JSON.stringify(doc), 'utf8');
  return { DSH_HOME: home, DSH_ANIMA_PANEL_CONFIG: path.join(home, 'none.json'), __home: home };
}

const BUILTIN = { config: BUILTIN_PANEL_CONFIG, source: { path: '(builtin)', exists: false, used: 'builtin' } };
const policy = (rating, panel = BUILTIN, extra = {}) => buildPolicy({ panel, rating, ...extra });

// ============================================================================
// 组 A · 纯函数
// ============================================================================
{
  const off = policy(undefined);
  ok('组A 铁律：不传档位 → dialoguePlan 返回 null（面 3 整体关闭）',
    off.dialogueEnabled === false && dialoguePlan(off) === null && dialoguePlan(null) === null,
    `dialogueEnabled=${off.dialogueEnabled} plan=${JSON.stringify(dialoguePlan(off))}`);

  ok('组A 显式档位 → dialogueEnabled=true，其余面的开关不受影响',
    policy('safe').dialogueEnabled === true && policy('safe').gateEnabled === true
    && policy('safe').negativeEnabled === true,
    JSON.stringify({ dlg: policy('safe').dialogueEnabled, gate: policy('safe').gateEnabled }));

  const pSafe = dialoguePlan(policy('safe'));
  ok('组A safe 档 → §2 Safe 篇 + §1 通用篇（本档在前、通用在后且标 always）',
    pSafe && pSafe.section === 'safe' && pSafe.sections.length === 2
    && pSafe.sections[0].id === 'safe' && pSafe.sections[0].always === false
    && pSafe.sections[1].id === 'common' && pSafe.sections[1].always === true
    && pSafe.commonAlways === true && pSafe.file === DIALOGUE_REF_FILE,
    JSON.stringify(pSafe));
  ok('组A sensitive / nsfw 档各自选到对应篇（语义 mid / top）',
    dialoguePlan(policy('sensitive')).section === 'sensitive'
    && dialoguePlan(policy('nsfw')).section === 'nsfw'
    && dialoguePlan(policy('nsfw')).semantic === 'top',
    `${dialoguePlan(policy('sensitive')).section} / ${dialoguePlan(policy('nsfw')).section}`);

  ok('组A 单档表：唯一一档 = safe 语义 → Safe 篇',
    dialoguePlan(policy('only')).section === 'safe'
    && SECTION_BY_SEMANTIC[policy('only').semantic] === 'safe',
    `semantic=${policy('only').semantic}`);

  // 双档表：末档 = top → NSFW 篇；改名不影响选篇（走语义）
  const twoTier = {
    config: { tiers: [{ name: 'r15', label: '15+', order: 1 }, { name: 'r18', label: '18+', order: 2 }], faces: {} },
    source: { path: '(test)', exists: true, used: '(test)' }
  };
  ok('组A 双档改名表：末档 r18（语义 top）→ NSFW 篇，首档 r15 → Safe 篇',
    dialoguePlan(policy('r18', twoTier)).section === 'nsfw'
    && dialoguePlan(policy('r15', twoTier)).section === 'safe',
    `${dialoguePlan(policy('r18', twoTier)).section} / ${dialoguePlan(policy('r15', twoTier)).section}`);

  ok('组A 档名优先于语义：档名恰好是 safe / nsfw 时按档名选（面板把某档直接叫 nsfw）',
    sectionIdFor('nsfw', 'safe') === 'nsfw' && sectionIdFor('safe', 'top') === 'safe'
    && sectionIdFor('unknown-tier', 'top') === 'nsfw' && sectionIdFor(undefined, undefined) === 'safe',
    `${sectionIdFor('nsfw', 'safe')},${sectionIdFor('safe', 'top')},${sectionIdFor(undefined, undefined)}`);

  ok('组A 关掉面 3（faces.dialogueSection=false）→ 即使有显式档位也不选篇',
    dialoguePlan(policy('nsfw', { ...BUILTIN, config: { ...BUILTIN_PANEL_CONFIG, faces: { ...BUILTIN_PANEL_CONFIG.faces, dialogueSection: false } } })) === null);

  ok('组A dialogue.commonAlways=false → 只留本档那一节',
    (() => {
      const p = dialoguePlan(policy('safe', {
        ...BUILTIN,
        config: { ...BUILTIN_PANEL_CONFIG, dialogue: { commonAlways: false } }
      }));
      return p.sections.length === 1 && p.sections[0].id === 'safe' && p.commonAlways === false;
    })());

  const text = formatDialoguePlan(pSafe, { skillDir: SKILL_DIR, policy: policy('safe') });
  ok('组A formatDialoguePlan：写出档位、本档节标题、文档绝对路径与纪律',
    /## 压字选篇（面 3 · dialogueSection）/.test(text)
    && text.includes(`§${DIALOGUE_SECTIONS.safe.no} ${DIALOGUE_SECTIONS.safe.heading}`)
    && text.includes(`§${DIALOGUE_SECTIONS.common.no} ${DIALOGUE_SECTIONS.common.heading}`)
    && text.includes(SKILL_DIR + (process.platform === 'win32' ? '\\' : '/') + DIALOGUE_REF_FILE.split('/').join(process.platform === 'win32' ? '\\' : '/'))
    && /只读这几节/.test(text),
    text.split('\n').slice(0, 5).join(' | '));
  ok('组A formatDialoguePlan：plan=null 时给一句人话，不抛异常',
    /未生效/.test(formatDialoguePlan(null, {})), formatDialoguePlan(null, {}));

  const doc = fs.readFileSync(REF_PATH, 'utf8');
  ok('组A dialogueRefIssues：references/dialogue-style.md 四节 + 交付节齐全',
    dialogueRefIssues(doc).length === 0, JSON.stringify(dialogueRefIssues(doc)));
  ok('组A dialogueRefIssues：文档被改歪（删掉某节标题）能被抓住',
    dialogueRefIssues(doc.replace(`## ${DIALOGUE_SECTIONS.nsfw.no}. ${DIALOGUE_SECTIONS.nsfw.heading}`, '## 4. NSFW')).length === 1
    && dialogueRefIssues('').length === 5,
    JSON.stringify(dialogueRefIssues('')));
}

// ============================================================================
// 组 B · CLI 集成（默认路径一个键都不加 + --dialogue 选篇）
// ============================================================================
{
  const j = runCliJson(['少女在教室里读书']);
  ok('组B 铁律：不传档位 + --format json → 没有 dialogueSection 键（tierPolicy 仍在但 explicit=false）',
    !('dialogueSection' in j) && j.tierPolicy && j.tierPolicy.explicit === false && j.tierBlocked.length === 0,
    Object.keys(j).join(','));
  ok('组B 铁律：不传档位时标签串逐字等于改造前',
    runCli(['少女在教室里读书', '--format', 'tags']).trim() === 'girl, reading, classroom',
    runCli(['少女在教室里读书', '--format', 'tags']).trim());

  const noTier = runCliTry(['少女在教室里读书', '--dialogue']);
  ok('组B 不传档位 + --dialogue → exit 1，并说明「没有档位就不挑篇」',
    noTier.status === 1 && /需要显式档位/.test(noTier.stderr) && /当前档位表：safe/.test(noTier.stderr),
    `status=${noTier.status} stderr=${noTier.stderr.split('\n')[0]}`);

  const safeOut = runCli(['少女在教室里读书', '--rating', 'safe', '--dialogue']);
  ok('组B --rating safe --dialogue → §2 Safe 篇 + §1 通用篇 + 文档路径',
    safeOut.includes(`§${DIALOGUE_SECTIONS.safe.no} ${DIALOGUE_SECTIONS.safe.heading}`)
    && safeOut.includes(`§${DIALOGUE_SECTIONS.common.no} ${DIALOGUE_SECTIONS.common.heading}`)
    && runCli(['--rating', 'safe', '--dialogue']).split('\n').some((l) => /参考文档：.*[\\/]references[\\/]dialogue-style\.md\s*$/.test(l))
    && !/girl, reading, classroom/.test(safeOut),
    safeOut.split('\n').slice(0, 4).join(' | '));
  ok('组B --dialogue 与 --format dialogue 等价',
    runCli(['少女在教室里读书', '--rating', 'safe', '--format', 'dialogue']) === safeOut);
  // 选篇只跟档位有关、不看输入：不带描述也必须能出（HELP 与 README 里写的用法就是这条）
  const noInput = runCli(['--rating', 'safe', '--dialogue']);
  ok('组B 不带描述也能出选篇（--rating safe --dialogue），且与带描述逐字相同',
    noInput === safeOut
    && runCli(['--rating', 'nsfw', '--dialogue']).includes(`§${DIALOGUE_SECTIONS.nsfw.no} ${DIALOGUE_SECTIONS.nsfw.heading}`),
    noInput.split('\n')[1]);

  const nsfwOut = runCli(['少女在教室里读书', '--rating', 'nsfw', '--dialogue']);
  const midOut = runCli(['少女在教室里读书', '--rating', 'sensitive', '--dialogue']);
  ok('组B 换档换篇：nsfw → §4 NSFW 篇；sensitive → §3 Sensitive 篇，且不串篇',
    nsfwOut.includes(`§${DIALOGUE_SECTIONS.nsfw.no} ${DIALOGUE_SECTIONS.nsfw.heading}`)
    && !nsfwOut.includes(`§${DIALOGUE_SECTIONS.safe.no} ${DIALOGUE_SECTIONS.safe.heading}`)
    && midOut.includes(`§${DIALOGUE_SECTIONS.sensitive.no} ${DIALOGUE_SECTIONS.sensitive.heading}`),
    nsfwOut.split('\n')[1] + ' / ' + midOut.split('\n')[1]);

  // CLI 打印的节标题必须能在文档里逐字找到（代码 ↔ 文档一致，防漂移）
  const m = /本档要读：§(\d+) (.+)$/m.exec(safeOut);
  ok('组B CLI 选篇的节标题在 references/dialogue-style.md 里逐字存在（代码↔文档一致）',
    !!m && fs.readFileSync(REF_PATH, 'utf8').includes(`## ${m[1]}. ${m[2]}`),
    m ? `## ${m[1]}. ${m[2]}` : '（没解析到「本档要读」行）');

  const jSafe = runCliJson(['少女在教室里读书', '--rating', 'safe']);
  ok('组B 显式档位 + --format json → 多出 dialogueSection（结构完整、含 tier / semantic / sections）',
    jSafe.dialogueSection && jSafe.dialogueSection.section === 'safe'
    && jSafe.dialogueSection.tier === 'safe' && jSafe.dialogueSection.semantic === 'safe'
    && Array.isArray(jSafe.dialogueSection.sections) && jSafe.dialogueSection.sections.length === 2,
    JSON.stringify(jSafe.dialogueSection));

  const both = runCliTry(['少女在教室里读书', '--rating', 'nsfw', '--dialogue', '--format', 'json']);
  let bothJson = null;
  try { bothJson = JSON.parse(both.stdout); } catch { /* 留给断言报错 */ }
  ok('组B --dialogue 不抢用户显式写的 --format json（仍是 JSON，且选篇在键里）',
    both.status === 0 && !!bothJson && bothJson.dialogueSection.section === 'nsfw',
    `status=${both.status} head=${String(both.stdout).slice(0, 40)}`);

  const legacy = runCliTry(['少女在教室里读书', '--rating', 'questionable', '--dialogue']);
  ok('组B 面 3 不绕过旧档名硬报错：questionable 仍 exit 1 + 迁移对照表',
    legacy.status === 1 && /旧档位名/.test(legacy.stderr) && /迁移对照表/.test(legacy.stderr),
    `status=${legacy.status}`);

  const info = runCli(['--info']);
  ok('组B --info 的五个行为面仍然照旧（面 3 已实装，开关名不变）',
    /五个行为面: prefixToken=on · negativeLines=on · dialogueSection=on · lexiconGate=on · gapsScope=on/.test(info),
    info.split('\n').filter(l => /五个行为面/.test(l)).join(''));
}

// ============================================================================
// 组 C · 隔离配置驱动（面关掉 / 通用篇关掉 / 档位改名）
// ============================================================================
{
  const offDoc = {
    version: 1,
    faces: { prefixToken: true, negativeLines: true, dialogueSection: false, lexiconGate: true, gapsScope: true }
  };
  const envOff = withConfig(offDoc, 'dlgoff');
  const jOff = runCliJson(['少女在教室里读书', '--rating', 'safe'], envOff);
  ok('组C faces.dialogueSection=false：JSON 不加 dialogueSection 键（与面关掉前一致）',
    !('dialogueSection' in jOff) && jOff.tierPolicy.faces.dialogueSection === false,
    Object.keys(jOff).join(','));
  const offTry = runCliTry(['少女在教室里读书', '--rating', 'safe', '--dialogue'], envOff);
  ok('组C faces.dialogueSection=false：--dialogue 硬报错退出并指出开关位置',
    offTry.status === 1 && /faces\.dialogueSection/.test(offTry.stderr) && /面板「压字」区块/.test(offTry.stderr),
    `status=${offTry.status} stderr=${offTry.stderr.split('\n')[0]}`);

  const noCommon = withConfig({ version: 1, dialogue: { commonAlways: false } }, 'nocommon');
  const noCommonOut = runCli(['少女在教室里读书', '--rating', 'safe', '--dialogue'], noCommon);
  const jNoCommon = runCliJson(['少女在教室里读书', '--rating', 'safe'], noCommon);
  ok('组C dialogue.commonAlways=false：只给本档那一节，通用篇明确写「已关掉」',
    noCommonOut.includes(`§${DIALOGUE_SECTIONS.safe.no} ${DIALOGUE_SECTIONS.safe.heading}`)
    && /通用篇：已关掉/.test(noCommonOut)
    && jNoCommon.dialogueSection.sections.length === 1
    && jNoCommon.dialogueSection.commonAlways === false,
    noCommonOut.split('\n').slice(0, 4).join(' | '));
  ok('组C dialogue.commonAlways=false 不影响其余面（面 2/4/5 照旧跑）',
    jNoCommon.tierPolicy.negativeLines === undefined || jNoCommon.tierPolicy.faces.dialogueSection === true,
    JSON.stringify(jNoCommon.tierPolicy.faces));

  // 档位改名：三档 ascii 新名，按语义选篇（末档 → NSFW 篇、中档 → Sensitive 篇）
  const renamed = {
    version: 1,
    tiers: [
      { name: 'sfw', label: '全年龄', order: 1, criteria: '无露点' },
      { name: 'mild', label: '轻微', order: 2, criteria: '内衣' },
      { name: 'nsfl', label: '露骨', order: 3, criteria: '露点' }
    ],
    defaultTier: 'sfw'
  };
  const envRenamed = withConfig(renamed, 'renamed');
  const jTop = runCliJson(['少女在教室里读书', '--rating', 'nsfl', '--no-tier-token'], envRenamed);
  const jMid = runCliJson(['少女在教室里读书', '--rating', 'mild', '--no-tier-token'], envRenamed);
  ok('组C 档位改名后按语义选篇：nsfl → NSFW 篇、mild → Sensitive 篇，交付串不受影响',
    jTop.dialogueSection.section === 'nsfw' && jMid.dialogueSection.section === 'sensitive'
    && jTop.positive.lineBare === 'girl, reading, classroom',
    `${jTop.dialogueSection.section} / ${jMid.dialogueSection.section} / «${jTop.positive.lineBare}»`);
}

// ============================================================================
{
  const ms = Date.now() - t0;
  console.log('');
  console.log(`dialogue：${pass} 通过 / ${fail} 失败 · ${ms} ms`);
  if (fail) process.exitCode = 1;
}
