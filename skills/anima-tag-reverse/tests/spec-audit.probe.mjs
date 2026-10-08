/**
 * spec-audit.probe.mjs —— B+C 改造的行为探针（自证用，不进 smoke 主链）
 *
 *   node tests/spec-audit.probe.mjs
 *
 * 锁六件事：
 *   1. notes 降级为纯日志：结构化输入里 notes 不产分句、不进标签串；只有「整份输入无结构化键」
 *      的兼容分支才把整段当文本读（旧行为）。
 *   2. 图像分支默认带自审：reverseImageSpec(spec) 这个空 opts 调用必须给出 gaps/gapsSummary/
 *      gapsMarkdown，缺项里必须有 C-spec-* 观察缺项；{gaps:false} 能关；且默认档**窄召回**
 *      （不传 broad 时逐字节等于 {broad:false}），宽召回只有显式 {broad:true} / --broad 才走。
 *   3. 必填观察维度缺失即报警：analyzeImageSpec 对每个维度给 {key,label,severity,advice}，
 *      buildGaps 必须把它变成缺口并计入 gapsSummary.specMissing，且带可照抄的建议写法。
 *   4. 键名别名归一：lights / lighting_direction / framing / shot / artstyle / artist / body_type
 *      要落到规范键路径上，且落对层。
 *   5. 不受影响的既有契约：reverseText 默认输出与改造前逐字节一致；imageSpec 入口空 opts 的
 *      标签串不受 gaps 影响（只多挂字段），且默认档（窄召回）与改造前同规模，不含宽召回独有标签。
 *   6. 归档真值严格等值：2026-10-07 16:35 归档的两份探针记录（23 条，去重后 22 条）逐条钉死，
 *      除 5 条已在文档里记名的既有偏差（M1 规则层补录，A2 不修）外一律逐字节相等 —— 这是给
 *      「变胖标签」这类「多出标签」型回归配的网（must/never 口径抓不住它）。
 *
 * 打印以 [通过]/[失败] 逐条给出，末尾一行汇总；失败时退出码 1。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  reverse, reverseText, reverseImageSpec, emptySpec, analyzeImageSpec, normalizeSpec,
  IMAGE_SPEC_TEMPLATE, REQUIRED_OBSERVATIONS, KEY_ALIASES
} from '../src/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));   // 路径里有空格，不能用 URL.pathname
const ROOT = path.dirname(HERE);
const SAMPLE = JSON.parse(fs.readFileSync(path.join(HERE, 'img-spec.sample.json'), 'utf8'));

/**
 * 改造前（B+C 之前）的固定基线：文本分支标签串，以及「老形状样张 + 窄召回」的标签串。
 * 注意 IMAGE_NARROW_BASELINE 里的 `sideways mouth`：那是旧版从 notes 的「侧脸」硬凑出来的标签，
 * 现在既因 notes 降级、也因 A2 恢复变体压制而不再出现 —— 它是**预期的代价**，已在下面显式断言。
 */
const TEXT_BASELINE = 'long hair, blue hair, girl, sitting, sailor suite, backlighting, night, reading, classroom';
const IMAGE_NARROW_BASELINE = '1girl, solo, red eyes, twintails, profile, sideways mouth, girl, low twintails, @dairi, dress, sitting, black thighhighs, white dress, hugging own legs, thighhighs, night, backlighting, classroom, painterly, silver hair, soft lighting, ponytail, two-handed, impasto, on windowsill';

/**
 * P5（默认档收回窄召回）之后新增的契约常量：
 *   - 只有宽召回才捞得到的标签：默认档一个都不许出现，显式 --broad / {broad:true} 必须全有；
 *   - 样张的两档实测条数（CLI 口径，含默认开启的 alternatives）：默认窄召回 33 条、--broad 38 条。
 *     A2 之前窄召回是 34 条，少掉的正是 `sideways mouth`（变体压制恢复后的预期代价）。
 */
const BROAD_ONLY = ['braided twintails', 'short twintails', 'twintails with braided base', 'full-length mirror'];
const SAMPLE_NARROW_COUNT = 33;
const SAMPLE_BROAD_COUNT = 38;

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`[通过] ${name}${extra ? ' · ' + extra : ''}`); }
  else { fail++; console.log(`[失败] ${name}${extra ? ' · ' + extra : ''}`); }
};
const section = t => console.log(`\n== ${t} ==`);

// ------------------------------------------------------------------ 1. notes
section('1 · notes 降级为纯日志');
{
  const spec = {
    subject: { count: 1, gender: 'girl' },
    appearance: { hair: 'silver hair' },
    style: { medium: 'anime screenshot' },
    notes: 'anime 晨光从左侧射入 不要漏掉画风'
  };
  const out = reverseImageSpec(spec, { gaps: false });
  const clauseTexts = out.plan.clauses.map(c => c.text).join(' | ');
  ok('notes 的值不出现在分句里', !/晨光|射入|不要漏掉画风/.test(clauseTexts), clauseTexts);
  ok('notes 的值进 plan.notesText', out.plan.notesText === spec.notes);
  ok('notes 的值不进标签串', !/ashita|morning|sunlight_from/.test(out.bare), out.bare);
  ok('结构化键仍然照常产出', /silver hair/.test(out.bare) && /anime screenshot/.test(out.bare));

  // 兼容分支：整份输入一个结构化键都没有（这里是纯 notes），才按旧行为整段当文本读
  const legacy = reverseImageSpec({ notes: '银发，侧脸' }, { gaps: false });
  const legacyText = legacy.plan.clauses.map(c => c.text).join(' | ');
  ok('兼容分支：整份输入只有 notes 时按旧行为整段当文本', /银发/.test(legacyText) && /侧脸/.test(legacyText), legacyText);
  ok('兼容分支里 notes 也回显在 notesText', /银发/.test(legacy.plan.notesText));

  // 有结构化键时，同一段 notes 是日志：不再产分句（这就是 C 要修的那个坑）
  const structured = reverseImageSpec({
    subject: { count: 1, gender: 'girl', notes: '银发，侧脸' },
    appearance: { hair: 'silver hair' }
  }, { gaps: false });
  const structuredText = structured.plan.clauses.map(c => c.text).join(' | ');
  ok('结构化输入里的 notes 不再产分句（旧版会从 notes 硬凑标签）', !/银发|侧脸/.test(structuredText), structuredText);
  ok('被降级的 notes 仍回显在 notesText', /侧脸/.test(structured.plan.notesText));

  const strPlan = reverseImageSpec('银发，侧脸，清晨', { gaps: false });
  ok('JSON.parse 失败的字符串走兼容分支（整段当文本）',
    strPlan.plan.clauses.length >= 2 && strPlan.plan.notesText.includes('银发'),
    strPlan.plan.clauses.map(c => c.text).join(' | '));

  const parsed = normalizeSpec({ subject: { count: 1 }, notes: '这句只是日志', appearance: { hair: 'x' } });
  ok('spec 里 notes 键保留在归一结果中但不产分句', parsed.notes === '这句只是日志' && reverseImageSpec(parsed, { gaps: false }).plan.clauses.every(c => !/日志/.test(c.text)));
}

// --------------------------------------------------------------- 2. 默认自审
section('2 · 图像分支默认带缺项自审');
{
  const out = reverseImageSpec(SAMPLE);
  ok('空 opts 就产出 out.gaps', Array.isArray(out.gaps) && out.gaps.length > 0, `${out.gaps.length} 条`);
  ok('空 opts 就产出 out.gapsSummary', !!out.gapsSummary && typeof out.gapsSummary.total === 'number', JSON.stringify(out.gapsSummary.byKind));
  ok('空 opts 就产出 out.gapsMarkdown', typeof out.gapsMarkdown === 'string' && out.gapsMarkdown.includes('缺项清单'));
  ok('plan 挂上 specIssues', Array.isArray(out.plan.specIssues));

  const off = reverseImageSpec(SAMPLE, { gaps: false });
  ok('{gaps:false} 能关掉自审', off.gaps === undefined && off.gapsSummary === undefined && off.gapsMarkdown === undefined);
  ok('默认档不传 broad 时等价于窄召回（裸串逐字节相同）', reverseImageSpec(SAMPLE).bare === off.bare, `${off.bare.split(', ').length} 条`);
  ok('关掉自审不影响标签串（同一召回档下裸串一致）', off.bare === reverseImageSpec(SAMPLE, { gaps: false, broad: false }).bare);
  ok('宽召回只有显式 {broad:true} 才走（与默认档不同档）', reverseImageSpec(SAMPLE, { broad: true }).bare !== off.bare,
    `默认 ${off.bare.split(', ').length} 条 / 宽 ${reverseImageSpec(SAMPLE, { broad: true }).bare.split(', ').length} 条`);

  const viaReverse = reverse({ imageSpec: SAMPLE });
  ok('reverse({imageSpec}) 不额外加默认（保持既有行为）', viaReverse.gaps === undefined);

  const text = reverseText('银发少女在教室里读书', {});
  ok('文本分支空 opts 不带 gaps', text.gaps === undefined && text.plan.specIssues === undefined);
  ok('文本分支 plan 键集合与改造前逐字一致', Object.keys(text.plan).join(',') === 'clauses,negated', Object.keys(text.plan).join(','));
  ok('图像分支 plan 才有 notesText / specIssues', Object.keys(out.plan).join(',') === 'clauses,negated,notesText,specIssues', Object.keys(out.plan).join(','));
  ok('文本分支空 opts 不带 broad 产物', text.alternatives === undefined);
  const textGaps = reverseText('银发少女在教室里读书', { gaps: true, alternatives: true, broad: true });
  ok('文本分支显式 gaps 仍然可用', Array.isArray(textGaps.gaps) && textGaps.gaps.length > 0, `${textGaps.gaps.length} 条`);
}

// ----------------------------------------------------- 3. 必填维度缺失即报警
section('3 · 必填观察维度缺失即报警');
{
  ok('REQUIRED_OBSERVATIONS 每条含 key/label/severity/advice',
    REQUIRED_OBSERVATIONS.every(d => d.key && d.label && ['high', 'medium', 'low'].includes(d.severity) && d.advice));
  ok('severity 取值只用 high/medium/low', new Set(REQUIRED_OBSERVATIONS.map(d => d.severity)).size <= 3);
  ok('模板里存在全部必填键路径', REQUIRED_OBSERVATIONS.every(d => {
    let cur = IMAGE_SPEC_TEMPLATE;
    for (const seg of d.key.split('.')) cur = cur && cur[seg];
    return cur !== undefined;
  }), REQUIRED_OBSERVATIONS.map(d => d.key).join(' '));

  const empty = analyzeImageSpec({ subject: { count: 1 } });
  ok('空壳 spec 报出全部必填维度', empty.length === REQUIRED_OBSERVATIONS.length, `${empty.length}/${REQUIRED_OBSERVATIONS.length}`);
  ok('每条缺项都带建议写法', empty.every(i => typeof i.advice === 'string' && i.advice.length > 8));
  ok('缺项按严重度可分辨', empty.some(i => i.severity === 'high'));

  const filled = analyzeImageSpec(SAMPLE);
  ok('样张写全必填维度后不再报缺项', filled.length === 0, JSON.stringify(filled));

  // 写了 style.lighting 但没写光位：应报 style.light_direction，并指出 srcKey
  const onlyLighting = analyzeImageSpec({ subject: { count: 1 }, style: { lighting: 'soft lighting' } });
  const ld = onlyLighting.find(i => i.key === 'style.light_direction');
  ok('只写柔光没写光位 → 报光位缺项', !!ld, ld ? `${ld.severity}` : '未报');
  ok('报光位时指出已有的 srcKey', !!ld && ld.srcKey === 'style.lighting', ld ? String(ld.srcKey) : '-');

  const g = reverseImageSpec({ subject: { count: 1, gender: 'girl' }, appearance: { hair: 'silver hair' } });
  const specGaps = g.gaps.filter(x => x.kind === 'missingObservation');
  ok('缺项变成 C-spec-* 缺口', specGaps.length > 0 && specGaps.every(x => x.id.startsWith('C-spec-')), specGaps.map(x => x.id).join(' '));
  ok('缺口计入 gapsSummary.specMissing', g.gapsSummary.specMissing === specGaps.length, String(g.gapsSummary.specMissing));
  ok('缺口带建议写法（可照抄）', specGaps.every(x => x.suggestions.some(s => s.advice && s.advice.length > 8)));
  ok('byKind 里有 missingObservation', g.gapsSummary.byKind.missingObservation === specGaps.length);
  ok('markdown 里点名观察缺项与建议写法', /观察缺项/.test(g.gapsMarkdown) && /style\.medium/.test(g.gapsMarkdown));
  ok('summary.specIssues 与 plan.specIssues 一致', JSON.stringify(g.gapsSummary.specIssues.map(i => i.key)) === JSON.stringify(g.plan.specIssues.map(i => i.key)));

  // 每一条必填维度都必须能被告出来：要么自成一条 C-spec-*，要么作为 dimKey 挂进同组的 C*/B* 缺口
  const reportedKeys = res => {
    const set = new Set();
    for (const x of res.gaps) {
      if (x.kind === 'missingObservation') set.add(x.key);
      for (const s of x.suggestions || []) if (s.dimKey) set.add(s.dimKey);
    }
    return set;
  };
  const minimal = reverseImageSpec({ subject: { count: 1 } });
  const keys = reportedKeys(minimal);
  ok('空壳 spec 的每条必填维度都能被找到（含去重挂靠）',
    REQUIRED_OBSERVATIONS.every(d => keys.has(d.key)),
    REQUIRED_OBSERVATIONS.filter(d => !keys.has(d.key)).map(d => d.key).join(' ') || '全部命中');

  // 去重：同维度已经在 C 粒度不足里报过时不再开新条，而是把建议写法挂上去
  const legOnly = reverseImageSpec({ subject: { count: 1, gender: 'girl' }, appearance: { hair: 'silver hair', hair_style: 'twintails' } });
  const ids = legOnly.gaps.map(x => x.id);
  ok('同名维度不重复开条（legwear/framing 等）', ids.filter(i => i === 'C-legwear').length + ids.filter(i => i === 'C-spec-outfit.legwear').length >= 1
    && !(ids.includes('C-legwear') && ids.includes('C-spec-outfit.legwear')));
  const legGap = legOnly.gaps.find(x => x.id === 'C-legwear') || legOnly.gaps.find(x => x.id === 'C-spec-outfit.legwear');
  ok('去重后建议写法仍然可见', !!legGap && legGap.suggestions.some(s => /thighhighs/.test(s.advice || '') || /thighhighs/.test(JSON.stringify(s))));
}

// -------------------------------------------------------- 4. 键名别名归一
section('4 · 键名别名归一');
{
  ok('KEY_ALIASES 覆盖任务点名的七个别名',
    ['lights', 'lighting_direction', 'framing', 'shot', 'artstyle', 'artist', 'body_type'].every(k => KEY_ALIASES[k]));

  const aliased = normalizeSpec({
    subject: { count: 1 },
    artstyle: 'anime screenshot',
    lights: 'backlighting',
    framing: '全身',
    shot: 'close-up',
    artist: '@dairi',
    body_type: 'slim',
    lighting_direction: 'light source on the left'
  });
  const at = (o, d) => d.split('.').reduce((c, s) => (c ? c[s] : undefined), o);
  ok('artstyle → style.artist_style', at(aliased, 'style.artist_style') === 'anime screenshot');
  ok('lights → style.lighting', String(at(aliased, 'style.lighting')).includes('backlighting'));
  ok('lighting_direction → style.light_direction（同级合并）',
    String(at(aliased, 'style.light_direction')).includes('light source on the left'));
  ok('body_type → appearance.body', at(aliased, 'appearance.body') === 'slim');
  ok('artist → artists', String(at(aliased, 'artists')).includes('@dairi'));
  ok('framing/shot → style.framing / style.camera（同层不串层）',
    String(at(aliased, 'style.framing')).includes('全身') && String(at(aliased, 'style.camera')).includes('close-up'));

  // 最强的落层断言：别名写法的输出与规范键写法逐字节一致（层提示一致才可能一致）
  const aliasSpec = {
    subject: { count: 1, gender: 'girl' },
    body_type: 'slim',
    artstyle: 'anime screenshot',
    lights: 'backlighting',
    framing: 'full body',
    shot: 'close-up'
  };
  const canonSpec = {
    subject: { count: 1, gender: 'girl' },
    appearance: { body: 'slim' },
    style: { artist_style: 'anime screenshot', lighting: 'backlighting', framing: 'full body', camera: 'close-up' }
  };
  const viaAlias = reverseImageSpec(aliasSpec, { gaps: false });
  const viaCanon = reverseImageSpec(canonSpec, { gaps: false });
  ok('别名写法与规范键写法标签串逐字节一致', viaAlias.bare === viaCanon.bare, viaAlias.bare);

  // 层提示（打分时偏向哪一层）也要求一致；分句文本可能被规范化（close-up → close up），用正则找
  const hintOf = (res, re) => {
    const c = res.plan.clauses.find(x => re.test(x.text));
    return c ? c.layerHint : null;
  };
  const H = [['slim', /^slim$/, 4], ['画风', /^anime screenshot$/, 5], ['打光', /^backlighting$/, 5],
    ['景别', /^full body$/, 7], ['视角', /^close[ -]?up$/, 7]];
  ok('别名 → 落层与规范键一致（slim 4 / 画风 5 / 打光 5 / 景别 7 / 视角 7）',
    H.every(([, re, want]) => hintOf(viaAlias, re) === want),
    H.map(([n, re]) => `${n}:${hintOf(viaAlias, re)}`).join(' '));
  ok('别名写法的层提示与规范键写法相同',
    H.every(([, re]) => hintOf(viaAlias, re) === hintOf(viaCanon, re)));

  // 同路径合并（lights 与 style.lighting 是同一个键）：值不能互相覆盖
  const raw = (o, d) => d.split('.').reduce((c, s) => (c ? c[s] : undefined), o);
  const js = v => { const s = JSON.stringify(v); return typeof s === 'string' ? s : 'undefined'; };
  const mergeSame = normalizeSpec({ lights: 'a', style: { lighting: 'b' } });
  ok('别名与规范键落到同一路径时合并值', js(raw(mergeSame, 'style.lighting')).includes('a') && js(raw(mergeSame, 'style.lighting')).includes('b'),
    js(raw(mergeSame, 'style.lighting')));
  const twoKeys = normalizeSpec({ lights: 'a', style: { light_direction: 'b' } });
  ok('打光与光位是两个键，不会互相串位',
    raw(twoKeys, 'style.lighting') === 'a' && raw(twoKeys, 'style.light_direction') === 'b',
    js(raw(twoKeys, 'style')));
}

// ----------------------------------------------------------- 5. 既有契约不变
section('5 · 既有契约不变');
{
  const t = reverseText('长发蓝发少女穿着水手服坐在教室里看书，夜晚，逆光', {});
  ok('文本分支默认输出与改造前一致（样例输入）', t.bare === TEXT_BASELINE, t.bare);

  const textIn = '长发蓝发少女穿着水手服坐在教室里看书，夜晚，逆光';
  const once = reverseText(textIn, {});
  ok('文本分支默认输出稳定（两次同结果）', once.bare === reverseText(textIn, {}).bare);

  const img = reverseImageSpec(SAMPLE, { broad: false, gaps: false });
  ok('图像分支窄召回标签串稳定（自审只加字段不改标签）', img.bare === reverseImageSpec(SAMPLE, { broad: false }).bare, img.bare);

  const imgGaps = reverseImageSpec(SAMPLE, { broad: false });
  ok('加自审不改变标签串', imgGaps.bare === img.bare);
  ok('默认档（自审开、窄召回）与显式窄召回逐字节一致', reverseImageSpec(SAMPLE).bare === img.bare);
  ok('默认档只多字段（分句数不变）', reverseImageSpec(SAMPLE).plan.clauses.length === img.plan.clauses.length);
  ok('默认档不再出现宽召回独有的标签', BROAD_ONLY.every(t => !img.bare.includes(t)), BROAD_ONLY.filter(t => img.bare.includes(t)).join(', ') || '无');

  const imgBroad = reverseImageSpec(SAMPLE, { broad: true, gaps: false });
  ok('显式 {broad:true} 仍能取到宽召回那版（条数更多）', imgBroad.bare.split(', ').length > img.bare.split(', ').length,
    `窄 ${img.bare.split(', ').length} 条 / 宽 ${imgBroad.bare.split(', ').length} 条`);
  ok('宽召回独有的标签只在 {broad:true} 档出现', BROAD_ONLY.every(t => imgBroad.bare.includes(t)),
    BROAD_ONLY.filter(t => !imgBroad.bare.includes(t)).join(', ') || '四条都在');

  // 改造前的老形状样张（appearance 等是数组、notes 里塞了本该结构化的观察）：
  // 现在跑出来只应少掉「从 notes 硬凑出来的标签」，不应多出任何标签。
  const LEGACY_FIXTURE = {
    subject: { count: 1, kind: '少女', notes: '银发，侧脸' },
    appearance: ['silver hair', 'side profile', '双马尾', 'red eyes'],
    outfit: ['白色连衣裙', 'black thighhighs'],
    pose: ['坐在窗台上', '双手抱膝'],
    scene: ['夜晚的教室', '逆光'],
    style: ['soft lighting', '厚涂感'],
    artists: ['@dairi'],
    negative: ['眼镜', 'extra fingers']
  };
  const LEGACY_BEFORE = IMAGE_NARROW_BASELINE;
  const LEGACY_DROPPED = ['sideways mouth'];   // 旧版从 notes 的「侧脸」硬凑出来的标签，C 之后不再出现
  const legacyNow = reverseImageSpec(LEGACY_FIXTURE, { broad: false, gaps: false }).bare.split(', ');
  const legacyBefore = LEGACY_BEFORE.split(', ');
  ok('老形状样张：没有多出任何标签', legacyNow.every(t => legacyBefore.includes(t)),
    legacyNow.filter(t => !legacyBefore.includes(t)).join(', ') || '无新增');
  ok('老形状样张：少掉的只有 notes 硬凑出的标签', JSON.stringify(legacyBefore.filter(t => !legacyNow.includes(t))) === JSON.stringify(LEGACY_DROPPED),
    legacyBefore.filter(t => !legacyNow.includes(t)).join(', '));

  // A2（恢复被误压的变体压制）的预期代价，显式断言而不是放宽：图像样张窄召回 34 → 33 条，少掉的正是
  // `sideways mouth`（实测 A2 前后逐条对比：added=[] / removed=['sideways mouth']）。这条断言对 A2 敏感 ——
  // 在 A2 未生效的副本上跑，它会红（34 条），所以不是空断言。禁止用「去掉等值比较」把它糊过去。
  ok('A2 的预期代价：样张窄召回 33 条（A2 前 34）且不含 sideways mouth',
    img.bare.split(', ').length === SAMPLE_NARROW_COUNT && !img.bare.includes('sideways mouth'),
    `${img.bare.split(', ').length} 条`);

  ok('默认输出仍是单行逗号分隔纯标签', !/[\r\n]/.test(img.bare) && !/masterpiece|best quality/.test(img.bare) && !/_[a-z]/.test(img.bare.replace(/score_\d/g, '')));

  const e1 = JSON.stringify(emptySpec());
  ok('emptySpec 与 IMAGE_SPEC_TEMPLATE 一致', e1 === JSON.stringify(IMAGE_SPEC_TEMPLATE));
  ok('模板保留全部原有键名', ['subject', 'characters', 'series', 'appearance', 'outfit', 'pose', 'scene', 'style', 'artists', 'nsfw', 'negative', 'notes']
    .every(k => k in IMAGE_SPEC_TEMPLATE));
  ok('style 拆出画风/光位/景别三组键', ['medium', 'artist_style', 'lighting', 'light_direction', 'camera', 'framing']
    .every(k => k in IMAGE_SPEC_TEMPLATE.style));

  const run = args => execFileSync(process.execPath, [path.join(ROOT, 'bin', 'rtag.mjs'), ...args], { cwd: ROOT, encoding: 'utf8' });
  // stdout / stderr 分开：CLI 的缺项提示必须只走 stderr
  const run2 = args => JSON.parse(execFileSync(process.execPath, [path.join(HERE, 'cli-run.probe.mjs'), ...args], { cwd: ROOT, encoding: 'utf8' }));
  const cliTpl = JSON.parse(run(['--template']));
  ok('--template 输出与 emptySpec 一致', JSON.stringify(cliTpl) === e1);
  // C.5：模板 / emptySpec / --template / 样张 四处必须同步
  const keyPaths = (o, prefix = '', out = []) => {
    if (Array.isArray(o) || typeof o !== 'object' || o === null) { out.push(prefix); return out; }
    for (const [k, v] of Object.entries(o)) keyPaths(v, prefix ? `${prefix}.${k}` : k, out);
    return out;
  };
  const tplPaths = keyPaths(IMAGE_SPEC_TEMPLATE).sort();
  const samplePaths = keyPaths(SAMPLE).sort();
  ok('img-spec.sample.json 与模板键路径完全一致',
    JSON.stringify(samplePaths) === JSON.stringify(tplPaths),
    samplePaths.filter(p => !tplPaths.includes(p)).join(', ') || '一致');
  ok('样张里必填维度都写了真值（不是占位符）',
    REQUIRED_OBSERVATIONS.every(d => {
      const v = d.key.split('.').reduce((c, s) => (c ? c[s] : undefined), SAMPLE);
      return typeof v === 'string' && v.trim() !== '' && !v.includes('…');
    }));
  ok('--template 带 style 的画风/光位/景别键（占位写法非空）',
    ['artist_style', 'lighting', 'light_direction', 'camera', 'framing'].every(k => typeof cliTpl.style[k] === 'string') &&
    /光位|背光/.test(cliTpl.style.light_direction) && /景别|全身/.test(cliTpl.style.framing),
    cliTpl.style.light_direction);

  const cliTags = run(['--image-spec', path.join(HERE, 'img-spec.sample.json')]);
  ok('CLI 图像入口 stdout 仍是单行纯标签串', cliTags.trim().split('\n').length === 1 && !/\[缺项自审\]/.test(cliTags), cliTags.trim().slice(0, 60) + ' …');
  // P5：默认档收回窄召回——默认 stdout 必须与显式 --no-broad 相同，且不含只有宽召回才有的标签
  const cliNoBroad = run(['--image-spec', path.join(HERE, 'img-spec.sample.json'), '--no-broad']);
  ok('CLI 默认档 == 显式 --no-broad（逐字节）', cliTags.trim() === cliNoBroad.trim(), cliTags.trim().slice(0, 60) + ' …');
  ok('CLI 默认档标签条数与窄召回实测一致', cliTags.trim().split(', ').length === SAMPLE_NARROW_COUNT, `${cliTags.trim().split(', ').length} 条`);
  ok('CLI 默认档不再出现宽召回独有的标签', BROAD_ONLY.every(t => !cliTags.includes(t)), BROAD_ONLY.filter(t => cliTags.includes(t)).join(', ') || '无');
  const cliBroad = run(['--image-spec', path.join(HERE, 'img-spec.sample.json'), '--broad']);
  ok('CLI --broad 仍能取到宽召回那版（实测 38 条且含 4 条独有）',
    cliBroad.trim().split(', ').length === SAMPLE_BROAD_COUNT && BROAD_ONLY.every(t => cliBroad.includes(t)),
    `${cliBroad.trim().split(', ').length} 条 · 独有 ${BROAD_ONLY.filter(t => cliBroad.includes(t)).length}/4`);
  const cliMd = run(['--image-spec', path.join(HERE, 'img-spec.sample.json'), '--format', 'md']);
  ok('CLI --format md 自带缺项信息', /缺项自审摘要/.test(cliMd) && /缺口 \d+ 条/.test(cliMd));
  const cliJson = JSON.parse(run(['--image-spec', path.join(HERE, 'img-spec.sample.json'), '--format', 'json']));
  ok('CLI --format json 自带 gaps / gapsSummary / gapsMarkdown', !!cliJson.gaps && !!cliJson.gapsSummary && !!cliJson.gapsMarkdown);

  const r2 = run2(['--image-spec', path.join(HERE, 'img-spec.sample.json')]);
  ok('CLI 图像入口缺项提示只走 stderr（stdout 干净）',
    /\[缺项自审\]/.test(r2.stderr) && /缺口 \d+ 条/.test(r2.stderr) && !/缺项自审/.test(r2.stdout),
    'stderr: ' + r2.stderr.split('\n')[0]);
  const r2off = run2(['--image-spec', path.join(HERE, 'img-spec.sample.json'), '--gaps', '--no-broad']);
  ok('显式 --gaps 时仍打提示', /\[缺项自审\]/.test(r2off.stderr));

  const r2no = run2(['--image-spec', path.join(HERE, 'img-spec.sample.json'), '--no-gaps']);
  ok('--no-gaps 关掉图像入口的缺项提示（stderr 干净）', r2no.stderr.trim() === '' && !/缺项自审/.test(r2no.stderr));
  ok('--no-gaps 后 stdout 仍是同样的单行标签串', r2no.stdout.trim() === cliTags.trim(), r2no.stdout.trim().slice(0, 50) + ' …');
  const jsonNo = JSON.parse(run(['--image-spec', path.join(HERE, 'img-spec.sample.json'), '--no-gaps', '--format', 'json']));
  ok('--no-gaps 的结果对象不带 gaps 字段', jsonNo.gaps === undefined && jsonNo.gapsSummary === undefined);
  const gapsStill = run(['--image-spec', path.join(HERE, 'img-spec.sample.json'), '--no-gaps', '--format', 'gaps']);
  ok('显式 --format gaps 时 --no-gaps 不生效（仍出缺口）', /缺项清单/.test(gapsStill));

  const textCli = run(['长发蓝发少女在教室里读书', '--format', 'tags']);
  ok('CLI 文本入口默认输出仍是单行标签串', textCli.trim().split('\n').length === 1, textCli.trim().slice(0, 60) + ' …');
  const r2text = run2(['长发蓝发少女在教室里读书', '--format', 'tags']);
  ok('CLI 文本入口不打缺项提示（默认档未变）', r2text.stderr.trim() === '' && !/缺项自审/.test(r2text.stderr));
}

// ------------------------------------- 6. 归档真值（2026-10-07 16:35）严格等值
section('6 · 归档真值（16:35）严格等值');
{
  // 归档来源：技能作者工作区里的 `.anima-study-rtag-probe1.txt`（15 条）
  // 与 `.anima-study-rtag-probe2.txt`（8 条），共 23 条；其中「不要眼镜，不要帽子，一个女孩站在阳台」
  // 两份记录里都有，去重后 22 条（20 条标签串 + 1 条 prompt 档 + 1 条 --search）。
  // 为什么放这里而不放 smoke：变胖标签是「多出标签」型回归，smoke 的 must/never 口径（只要命中就绿）
  // 结构上抓不住多出来的标签；spec-audit 是行为探针，已有等值基线（TEXT_BASELINE / IMAGE_NARROW_BASELINE）
  // 与 CLI 双流助手，且 smoke 的「36 例」被文档与审查探针交叉引用，不宜挪动。
  // 口径：没有 drift 的行必须与归档逐字节相等；有 drift 的行是**已记名**的既有偏差（M1：规则层 hints
  // 补录带来的固定偏差，A2 不修，属产品决定），此时把「多出/少掉」两个集合也钉死 —— 偏差一旦扩大，
  // 或哪天被修好，这两条断言都会红，不会被静默掩盖。
  const RUN = args => execFileSync(process.execPath, [path.join(ROOT, 'bin', 'rtag.mjs'), ...args], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const strip = s => s.replace(/\r\n/g, '\n').replace(/\n+$/, '');
  const tags = s => (s.trim() === '' ? [] : s.trim().split(', '));

  // 22 条各写一条字面的断言调用，不写成循环：文档里写的「N 例」与审查探针的口径都按本文件的断言调用
  // 位点数计（凡出现「ok 左括号」的地方都被数进去，注释里也算），循环会让「位点数」与「执行条数」对不上
  // —— 22 条真值表写成循环时位点数会少 20，文档数字就会与实际不符。
  const A = args => strip(RUN(args));
  let runs = 0, strictRuns = 0, driftRuns = 0;
  const pin = ({ name, args, expect, drift }) => {
    runs++;
    const now = A(args);
    if (!drift) {
      strictRuns++;
      return [`归档真值：${name}`, now === expect,
        now === expect ? (now || '(空串)') : `现 ${JSON.stringify(now)} / 真值 ${JSON.stringify(expect)}`];
    }
    driftRuns++;
    const added = tags(now).filter(t => !tags(expect).includes(t));
    const removed = tags(expect).filter(t => !tags(now).includes(t));
    const pinned = JSON.stringify(added) === JSON.stringify(drift.added) && JSON.stringify(removed) === JSON.stringify(drift.removed);
    return [`归档真值：${name}（已知偏差 M1，差异已钉住）`, pinned,
      pinned ? `${now} ｜ 真值 ${expect}` : `多出 ${JSON.stringify(added)} / 少掉 ${JSON.stringify(removed)} · 现 ${now}`];
  };

  ok(...pin({ name: 'sailor dress', args: ['sailor dress'], expect: 'sailor dress, dress' }));
  ok(...pin({ name: 'blu hair', args: ['blu hair'], expect: 'blue hair' }));
  ok(...pin({ name: 'red eyes', args: ['red eyes'], expect: 'red eyes' }));
  ok(...pin({ name: '和服', args: ['和服'], expect: 'kimono' }));
  ok(...pin({ name: '2girls', args: ['2girls'], expect: '2girls' }));
  ok(...pin({ name: 'women', args: ['women'], expect: '' }));
  ok(...pin({ name: 'schoolgirl', args: ['schoolgirl'], expect: 'school' }));
  ok(...pin({ name: '微笑', args: ['微笑'], expect: 'smile' }));
  ok(...pin({ name: '高潮', args: ['高潮'], expect: 'nsfw, orgasm' }));
  ok(...pin({ name: '低角度仰拍', args: ['低角度仰拍'], expect: 'low horns, from below' }));
  ok(...pin({ name: '裸体', args: ['裸体'], expect: 'naked' }));
  ok(...pin({ name: '不要眼镜，不要帽子，一个女孩站在阳台', args: ['不要眼镜，不要帽子，一个女孩站在阳台'], expect: '1girl, balcony' }));
  ok(...pin({ name: '画师风格，by dairi，银发少女坐在教室窗边', args: ['画师风格，by dairi，银发少女坐在教室窗边'], expect: 'girl, @dairi, sitting, classroom, silver hair' }));
  ok(...pin({ name: '2girls，两人在浴室，裸体，泳装', args: ['2girls，两人在浴室，裸体，泳装'], expect: '2girls, swimsuit, naked, bathroom' }));
  ok(...pin({ name: '@dairi | @haruyama kazunori', args: ['@dairi | @haruyama kazunori'], expect: '@dairi, @haruyama kazunori' }));
  ok(...pin({ name: 'by dairi', args: ['by dairi'], expect: '@dairi' }));
  ok(...pin({
    name: '蓝白条纹水手服', args: ['蓝白条纹水手服'], expect: 'sailor shirt',
    drift: { added: ['sailor dress', 'sailor suite', 'striped'], removed: ['sailor shirt'] }
  }));
  ok(...pin({ name: '黑色和服', args: ['黑色和服'], expect: 'black kimono', drift: { added: ['japanese clothes'], removed: [] } }));
  ok(...pin({ name: '两个人', args: ['两个人'], expect: 'heart hands duo', drift: { added: ['2girls'], removed: [] } }));
  ok(...pin({
    name: '低角度仰拍，霓虹街区，雨夜', args: ['低角度仰拍，霓虹街区，雨夜'], expect: 'low horns, from below, rain',
    drift: { added: ['neon lights'], removed: [] }
  }));
  ok(...pin({
    name: '--rating explicit --format prompt 一个女孩', args: ['--rating', 'explicit', '--format', 'prompt', '一个女孩'],
    expect: 'masterpiece, best quality, score_7, explicit, 1girl', drift: { added: ['solo', 'girl'], removed: [] }
  }));
  ok(...pin({
    name: '--search "blue eyes"', args: ['--search', 'blue eyes'],
    expect: '检索「blue eyes」：\nblue eyes  蓝眼                   score 1.00  sim 1.00  2.5M  中  人物外观'
  }));
  ok('归档 22 条（去重后）全部钉住：17 条逐字节相等 + 5 条记名偏差',
    strictRuns === 17 && driftRuns === 5 && runs === 22,
    `严格 ${strictRuns} · 记名偏差 ${driftRuns} · 合计 ${runs} 条（归档原文 23 条含 1 条重复）`);
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
if (fail) process.exitCode = 1;
