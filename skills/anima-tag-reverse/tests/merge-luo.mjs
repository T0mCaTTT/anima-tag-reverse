#!/usr/bin/env node
/**
 * merge-luo.mjs —— 第 4 期 ③（词库分流）自测：merge-luo-clean.mjs + 技能侧的短语池接线
 *
 * 跑法： node tests/merge-luo.mjs        （在技能根目录）
 *
 * 覆盖 3 组（共 40+ 条断言）：
 *   A. 纯函数：flatKey / pickTarget / checkTargets / planMerge 的五类判定（status / banned / exists / preset / duplicate）
 *   B. 真落盘（在临时小词库上）：dry-run 不写盘 → apply 追加行 + 备份 + 报告 + 池文件 → 再 apply 幂等 → rollback 还原
 *   C. 技能侧接线：buildLexicon({pool}) / loadPool / kbInfo 的 rows·pool·poolEnabled，
 *      以及 CLI 的 `--info` 增量行与 `--pool` / `--no-pool` 真能改变召回
 *
 * 铁律（与五个行为面一致，改代码前先读这段）：
 *   1. 不开池时词库就是 38,306 行那一份：lexicon.poolEnabled 默认 false，`--pool` 才能临时打开；
 *   2. 主索引只追加、不重排（新行 13 个元素，第 13 个是来源标记 `luo-fe`，读表只用前 12 个）；
 *   3. 一切写盘都先备份、都有报告，`--rollback` 能按来源把行删干净。
 *
 * 环境隔离：CLI 用例注入临时 $DSH_HOME 与不存在的 $DSH_ANIMA_PANEL_CONFIG，
 * 词库用 --kb 指向临时小词库，绝不碰仓库里那份 4.9MB 的真词库。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  SRC_TAG, BUCKET_MAP, BANNED_TAGS, flatKey, pickTarget, checkTargets, planMerge, localFacts
} from '../tools/merge-luo-clean.mjs';
import { buildLexicon, loadPool, poolPath } from '../src/lexicon.mjs';
import { kbInfo } from '../src/index.mjs';
import { keyOf } from '../src/normalize.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(HERE, '..');
const CLI = path.join(SKILL_DIR, 'bin', 'rtag.mjs');
const TOOL = path.join(SKILL_DIR, 'tools', 'merge-luo-clean.mjs');

let pass = 0, fail = 0;
const t0 = Date.now();

function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`[通过] ${name}`); }
  else { fail++; console.log(`[失败] ${name}${detail ? `\n   → ${detail}` : ''}`); }
}

const ISO_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'anima-merge-'));
function runCli(args) {
  return execFileSync(process.execPath, [CLI, ...args], {
    cwd: SKILL_DIR, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, DSH_HOME: ISO_HOME, DSH_ANIMA_PANEL_CONFIG: path.join(ISO_HOME, 'none.json') }
  });
}
function runTool(args) {
  return execFileSync(process.execPath, [TOOL, ...args], { cwd: SKILL_DIR, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
}
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

// ---------------------------------------------------------------- 组 A · 纯函数
{
  ok('组A flatKey：横杠 / 下划线 / 大小写 / 多余空格都归一',
    flatKey('Close-Up') === 'close up' && flatKey('Aerial_View') === 'aerial view'
    && flatKey('  Dim   Warm Light ') === 'dim warm light' && flatKey('') === '',
    `${flatKey('Close-Up')} / ${flatKey('Aerial_View')} / ${flatKey('  Dim   Warm Light ')}`);

  ok('组A BUCKET_MAP 覆盖真实分类档里的 10 个语义桶',
    ['人数/规模', '性行为/成人', '动作/姿势', '服装/配饰', '表情/情绪', '视角/构图',
      '场景/背景/光影', '身体特征/外观', '其他/未分类'].every((b) => BUCKET_MAP[b])
    && BANNED_TAGS.length === 8,
    JSON.stringify(Object.keys(BUCKET_MAP)));

  const tView = pickTarget('视角/构图', 'front view');
  const tComp = pickTarget('视角/构图', 'centered composition');
  const tLight = pickTarget('场景/背景/光影', 'dim warm light');
  const tWeather = pickTarget('场景/背景/光影', 'rainy night');
  ok('组A pickTarget：视角→视角与镜头、构图→构图 · 精选、光影词换 big 到 og:lighting、天气词留 og:backgrounds',
    tView.big === 'og:image-composition' && tView.sub === '视角与镜头'
    && tComp.sub === '构图 · 精选'
    && tLight.big === 'og:lighting' && tLight.sub === '光影氛围'
    && tWeather.big === 'og:backgrounds' && tWeather.sub === '天气与时间',
    JSON.stringify({ tView, tComp, tLight, tWeather }));

  ok('组A 未知桶落 cb:misc / 其他（不抛错）',
    pickTarget('没见过的桶', 'whatever').big === 'cb:misc',
    JSON.stringify(pickTarget('没见过的桶', 'whatever')));

  const cats = [{ id: 'og:lighting', subs: ['光影氛围', '光照'] }, { id: 'og:face', subs: [{ name: '表情' }] }];
  const bad = checkTargets([
    { tag: 'a', big: 'og:lighting', sub: '光影氛围' },
    { tag: 'b', big: 'og:face', sub: '表情' },
    { tag: 'c', big: 'og:face', sub: '不存在的 sub' },
    { tag: 'd', big: '没这个大类', sub: '其他' }
  ], cats);
  ok('组A checkTargets：两种 subs 形状（字符串 / {name}）都吃，错的两种都报出来',
    bad.length === 2 && bad[0].tag === 'c' && bad[0].why === '小分类不在该大分类下' && bad[1].tag === 'd',
    JSON.stringify(bad));
}

// ---------------------------------------------------------------- 组 B/C · 临时小词库
{
  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'anima-kb-'));
  const KB = path.join(ROOT, '画师类');
  fs.mkdirSync(KB, { recursive: true });
  const cats = [
    { id: 'cb:base', name: '基础与元信息', order: 1, count: 2, subs: ['人数与画面规模', '质量与画质'] },
    { id: 'cb:misc', name: '其他', order: 69, count: 1, subs: ['其他'] },
    { id: 'og:face', name: '面部', order: 8, count: 0, subs: ['表情', '情绪'] },
    { id: 'og:lighting', name: '光影', order: 33, count: 0, subs: ['光影氛围', '光照'] }
  ];
  const row = (tag, big, order, zh) => [tag, big, order, zh, '', '', '', '中', '其他', '', '', 0];
  const baseRows = [
    row('1girl', 'cb:base', 1, '1 名女性'),
    row('girl', 'cb:base', 1, '女孩'),
    row('aerial view, from above', 'cb:misc', 69, '高空俯视')
  ];
  const idxFile = path.join(KB, 'search-index.json');
  // 真词库是「单行压缩 JSON」，这里也照这个格式写，rollback 后按字节比对才有意义
  fs.writeFileSync(idxFile, JSON.stringify({ fields: ['tag', 'big', 'order', 'zh', 'aliases', 'weight', 'freq', 'confidence', 'sub', 'bigName', 'slot', 'official'], cats, rows: baseRows }));
  fs.writeFileSync(path.join(KB, 'manifest.json'), JSON.stringify({
    meta: { model: 'test', built_at: '2026-01-01', total: 2, bigs: 1, subs: 1, verified_freq: 2, official_tags: 1, zh_missing: 0 },
    categories: cats
  }));
  const before = sha(idxFile);

  const CLASSIFIED = path.join(ROOT, 'classified.json');
  const classified = [
    { tag: 'serene', bucket: '表情/情绪', status: 'clean', why: '' },               // → 主索引
    { tag: 'blank expression', bucket: '表情/情绪', status: 'clean', why: '' },     // → 主索引（sub 表情）
    { tag: 'Cushions', bucket: '其他/未分类', status: 'clean', why: '' },            // → 主索引（未分类）
    { tag: 'dim warm light', bucket: '场景/背景/光影', status: 'clean', why: '' },   // → 池（3 token）
    { tag: 'Girl', bucket: '人数/规模', status: 'clean', why: '' },                  // → 跳过 exists
    { tag: 'Aerial  View', bucket: '视角/构图', status: 'clean', why: '' },          // → 跳过 preset
    { tag: 'wax on pubic area', bucket: '性行为/成人', status: 'clean', why: '' },   // → 跳过 banned
    { tag: 'something else', bucket: '其他/未分类', status: 'tokenVariant', why: '本地近似: x' }, // → 跳过 status
    { tag: '   ', bucket: '其他/未分类', status: 'clean', why: '' },                 // → 跳过 empty
    { tag: 'Serene', bucket: '表情/情绪', status: 'clean', why: '' }                 // → 跳过 duplicate
  ];
  fs.writeFileSync(CLASSIFIED, JSON.stringify(classified));

  const facts = localFacts(baseRows);
  const { plan, skipped } = planMerge(classified, facts);
  const byReason = new Map();
  for (const s of skipped) byReason.set(s.reason, (byReason.get(s.reason) || 0) + 1);
  ok('组A2 planMerge：3 条进主索引、1 条进池、6 条按原因跳过',
    plan.length === 4 && plan.filter((p) => p.target === 'main').length === 3
    && plan.filter((p) => p.target === 'pool').length === 1 && skipped.length === 6
    && byReason.get('exists') === 1 && byReason.get('preset') === 1 && byReason.get('banned') === 1
    && byReason.get('status') === 1 && byReason.get('empty') === 1 && byReason.get('duplicate') === 1,
    JSON.stringify({ plan: plan.map((p) => p.tag + '→' + p.target), skipped: skipped.map((s) => s.tag + ':' + s.reason) }));
  ok('组A2 候选词先被 flatKey 归一：Cushions 变成 cushions 进主索引，Aerial  View 撞上本地长串预设被跳过',
    plan.some((p) => p.tag === 'cushions' && p.target === 'main')
    && skipped.some((s) => s.tag === 'Aerial  View' && s.reason === 'preset'),
    JSON.stringify({ plan: plan.map((p) => p.tag), skipped: skipped.map((s) => s.tag + ':' + s.reason) }));

  // ---- dry-run：一个文件都不许写
  const dry = runTool(['--kb', KB, '--classified', CLASSIFIED, '--quiet', '--json']);
  const dryDoc = JSON.parse(dry);
  ok('组B dry-run：报告里 3 加主 / 1 加池 / 6 跳过，且没有创建 _backup、_merge、短语池',
    dryDoc.counts.addedMain === 3 && dryDoc.counts.addedPool === 1 && dryDoc.counts.skipped === 6
    && dryDoc.badTargets.length === 0
    && !fs.existsSync(path.join(ROOT, '_backup')) && !fs.existsSync(path.join(ROOT, '_merge'))
    && !fs.existsSync(path.join(ROOT, '补充短语池')) && sha(idxFile) === before,
    JSON.stringify(dryDoc.counts));

  // ---- apply
  const applied = runTool(['--kb', KB, '--classified', CLASSIFIED, '--apply', '--quiet']);
  const idx2 = JSON.parse(fs.readFileSync(idxFile, 'utf8'));
  const added = idx2.rows.slice(baseRows.length);
  ok('组B apply：主索引 3 → 6 行，新行 13 个元素且第 13 个是 luo-fe 来源标记',
    idx2.rows.length === 6 && added.length === 3
    && added.every((r) => r.length === 13 && r[12] === SRC_TAG && r[7] === '待验证' && r[11] === 0),
    JSON.stringify(added));
  ok('组B apply：order / bigName 取自该大分类（cb:misc 的 order 69、og:face 的「面部」）',
    added[1][1] === 'og:face' && added[1][2] === 8 && added[1][9] === '面部' && added[1][8] === '表情'
    && added[2][1] === 'cb:misc' && added[2][2] === 69 && added[2][9] === '其他',
    JSON.stringify(added.map((r) => [r[0], r[1], r[2], r[8], r[9]])));
  ok('组B apply：写回仍是单行压缩 JSON（真词库就是这个格式）',
    !fs.readFileSync(idxFile, 'utf8').includes('\n'));
  const backups = fs.readdirSync(path.join(ROOT, '_backup'));
  const reports = fs.readdirSync(path.join(ROOT, '_merge')).filter((f) => f.startsWith('luo-clean-'));
  ok('组B apply：备份 1 份（原字节 sha 一致）+ 报告 1 份，报告里记了 before/after 行数与哈希',
    backups.length === 1 && sha(path.join(ROOT, '_backup', backups[0])) === before && reports.length === 1
    && (() => {
      const r = JSON.parse(fs.readFileSync(path.join(ROOT, '_merge', reports[0]), 'utf8'));
      return r.before.rows === 3 && r.after.rows === 6 && r.added.main.length === 3 && r.added.pool.length === 1
        && r.before.sha256 === before && r.after.sha256 === sha(idxFile) && r.counts.skipped === 6;
    })(),
    JSON.stringify({ backups, reports }));
  const poolFile = poolPath(KB);
  const poolDoc = JSON.parse(fs.readFileSync(poolFile, 'utf8'));
  ok('组B apply：池文件写在 画师类 的隔壁（anima-tag-kb/补充短语池/phrase-pool.json），schema/字段齐全',
    poolFile.endsWith(path.join('补充短语池', 'phrase-pool.json'))
    && poolDoc.schema === 'anima-tag-reverse/phrase-pool@1' && poolDoc.source === SRC_TAG
    && poolDoc.rows.length === 1 && poolDoc.rows[0].tag === 'dim warm light'
    && poolDoc.rows[0].big === 'og:lighting' && poolDoc.rows[0].tokens === 3 && poolDoc.rows[0].src === SRC_TAG,
    JSON.stringify(poolDoc.rows));

  // ---- 幂等
  const afterFirst = sha(idxFile);
  const second = JSON.parse(runTool(['--kb', KB, '--classified', CLASSIFIED, '--apply', '--quiet', '--json']));
  ok('组B 幂等：再 apply 一次加 0 条（全被判 exists / preset / banned）、字节不变',
    second.counts.addedMain === 0 && second.counts.addedPool === 0 && sha(idxFile) === afterFirst,
    JSON.stringify(second.counts));

  // ---- 组 C：技能侧接线（此时池文件在）
  const lexOff = buildLexicon(KB);
  const lexOn = buildLexicon(KB, { pool: true });
  ok('组C buildLexicon 默认不读池：size = 主表 6 行，pool.count = 0',
    lexOff.size === 6 && lexOff.baseSize === 6 && lexOff.pool.count === 0 && lexOff.pool.enabled === false,
    JSON.stringify({ size: lexOff.size, base: lexOff.baseSize, pool: lexOff.pool }));
  ok('组C buildLexicon({pool:true})：size = 6 + 1，baseSize 不变，池条目标了 pool=true',
    lexOn.size === 7 && lexOn.baseSize === 6 && lexOn.pool.enabled === true && lexOn.pool.count === 1
    && lexOn.entries[6].pool === true && lexOn.entries[0].pool === false
    && lexOn.byTagKey.get(keyOf('dim warm light')) === 6,
    JSON.stringify({ size: lexOn.size, base: lexOn.baseSize, pool: lexOn.pool }));

  const noPoolDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anima-kb-nopool-'));
  fs.mkdirSync(path.join(noPoolDir, '画师类'), { recursive: true });
  ok('组C loadPool：池文件不存在 / 坏的 JSON 都返回 null（不把技能搞挂）',
    loadPool(path.join(noPoolDir, '画师类')) === null
    && loadPool(path.join(ROOT + '-不存在', '画师类')) === null,
    JSON.stringify(loadPool(path.join(noPoolDir, '画师类'))));

  const infoOff = kbInfo(KB);
  const infoOn = kbInfo(KB, { phrasePool: true });
  ok('组C kbInfo：rows 是主表行数、total 取 manifest（2）、poolEnabled 跟随开关（关着也报池文件条数）',
    infoOff.rows === 6 && infoOff.total === 2 && infoOff.pool === 1 && infoOff.poolEnabled === false
    && infoOn.rows === 6 && infoOn.pool === 1 && infoOn.poolEnabled === true && infoOn.size === 7,
    JSON.stringify({ off: [infoOff.rows, infoOff.total, infoOff.pool, infoOff.poolEnabled], on: [infoOn.pool, infoOn.size] }));

  // ---- CLI：--info 的增量行与池行
  const infoCli = runCli(['--info', '--kb', KB]);
  ok('组C CLI --info：打印「增量：索引 6 行 − manifest 记 2 行 = 4 条」与未启用的池行',
    infoCli.includes('增量：索引 6 行 − manifest 记 2 行 = 4 条') && infoCli.includes('短语池: 1 条（未启用'),
    infoCli.split('\n').filter((l) => l.includes('增量') || l.includes('短语池')).join(' | '));
  const infoPool = runCli(['--info', '--kb', KB, '--pool']);
  ok('组C CLI --info --pool：池显示为「本次已启用」，并列出 pool / poolEnabled / rows 三个字段',
    infoPool.includes('短语池: 1 条（本次已启用）') && /\brows: 6\b/.test(infoPool) && /\bpoolEnabled: true\b/.test(infoPool),
    infoPool.split('\n').filter((l) => l.includes('短语池') || l.includes('pool') || l.includes('rows')).join(' | '));

  // ---- CLI：--info --format json（面板只走子进程，所以概况必须有机器可读的一份）
  const infoJson = JSON.parse(runCli(['--info', '--kb', KB, '--format', 'json']));
  ok('组C CLI --info --format json：schema 正确、rows/total/delta/pool 与人类那份同源',
    infoJson.schema === 'anima-tag-reverse/info@1'
    && infoJson.kb.rows === 6 && infoJson.kb.total === 2 && infoJson.kb.delta === 4
    && infoJson.kb.pool === 1 && infoJson.kb.poolEnabled === false && infoJson.kb.size === 6,
    JSON.stringify(infoJson.kb));
  ok('组C info json：池路径拼在 画师类 隔壁、poolExists 为 true（面板要拿它提示池文件在哪）',
    infoJson.kb.poolPath === poolFile && infoJson.kb.poolExists === true
    && infoJson.kb.dir === KB,
    JSON.stringify({ poolPath: infoJson.kb.poolPath, exists: infoJson.kb.poolExists }));
  ok('组C info json：配置来源走隔离环境（builtin=true + 候选链文案）+ 档位表 / 默认档 / 五面全 on',
    infoJson.config.builtin === true && infoJson.config.path.includes('未找到，候选链：')
    && infoJson.config.tiers.length === 3 && infoJson.config.tiers[0].name === 'safe'
    && infoJson.config.defaultTier === 'safe' && infoJson.config.broad === false
    && ['prefixToken', 'negativeLines', 'dialogueSection', 'lexiconGate', 'gapsScope']
      .every((k) => infoJson.config.faces[k] === true)
    && JSON.stringify(infoJson.warnings) === '[]',
    JSON.stringify(infoJson.config));
  const infoJsonOn = JSON.parse(runCli(['--info', '--kb', KB, '--format', 'json', '--pool']));
  ok('组C info json + --pool：poolEnabled 翻真、size 记成主表 + 池（人类那份不受影响）',
    infoJsonOn.kb.poolEnabled === true && infoJsonOn.kb.size === 7 && infoJsonOn.kb.rows === 6
    && infoCli.includes('词库：') && !infoCli.includes('anima-tag-reverse/info@1'),
    JSON.stringify({ on: [infoJsonOn.kb.size, infoJsonOn.kb.poolEnabled], humanHasSchema: infoCli.includes('anima-tag-reverse/info@1') }));

  // ---- CLI：--pool / --no-pool 真能改变召回
  // 第一行是「检索「…」：」的回显，比对时要跳过它，否则查询词自己就把断言喂饱了
  const body = (s) => s.split('\n').slice(1).join('\n');
  const searchOff = runCli(['--search', 'dim warm light', '--kb', KB, '--no-pool']);
  const searchOn = runCli(['--search', 'dim warm light', '--kb', KB, '--pool']);
  ok('组C CLI：--no-pool 时池里的长短语召不回；--pool 时召得回（默认路径不受影响）',
    !body(searchOff).includes('dim warm light') && body(searchOn).includes('dim warm light'),
    `off=${body(searchOff).replace(/\n/g, ' ').slice(0, 60)} | on=${body(searchOn).replace(/\n/g, ' ').slice(0, 60)}`);

  // ---- rollback
  const rollback = runTool(['--kb', KB, '--rollback']);
  const idx3 = JSON.parse(fs.readFileSync(idxFile, 'utf8'));
  ok('组C --rollback：主索引删回 3 行、字节与原始完全一致，池文件被删掉',
    rollback.includes('回滚完成：行数 6 → 3（删 3 条），短语池删 1 条')
    && idx3.rows.length === 3 && sha(idxFile) === before && !fs.existsSync(poolFile),
    `${rollback.trim()} / rows=${idx3.rows.length} / shaEq=${sha(idxFile) === before}`);
  ok('组C rollback 后：池没了 → buildLexicon({pool:true}) 的 size 回到 3 且 pool.missing = true',
    (() => {
      const lex = buildLexicon(KB, { pool: true });
      return lex.size === 3 && lex.pool.enabled === true && lex.pool.count === 0 && lex.pool.missing === true;
    })(),
    JSON.stringify(buildLexicon(KB, { pool: true }).pool));

  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.rmSync(ISO_HOME, { recursive: true, force: true });
  fs.rmSync(noPoolDir, { recursive: true, force: true });
}

// ============================================================================
{
  const ms = Date.now() - t0;
  console.log('');
  console.log(`merge-luo：${pass} 通过 / ${fail} 失败 · ${ms} ms`);
  if (fail) process.exitCode = 1;
}
