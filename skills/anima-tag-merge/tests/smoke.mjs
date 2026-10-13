#!/usr/bin/env node
/**
 * smoke.mjs —— 离线自测：自然语言解析 + 观察合并（不加载词库，毫秒级）
 *
 * 覆盖的是「会不会换错源」这类致命错误：
 *   姿势/场景/外观的常规搬运、并列维度共享宾语、组合宏展开、子级覆盖组级、宿主推断、
 *   整体换底、多图（3 张）换源、链式融合、显式 --map/--preset、歧义追问、空源告警、跨源冲突。
 *
 * 跑法：node tests/smoke.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFusionIntent, parseDimMap, mergeSpecs, normalizeSideArg, applyPresets, PRESETS, resolvePreset } from '../src/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = f => JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', f), 'utf8'));
const A = read('a.json');   // 图1：夜晚教室坐窗台（银发双马尾，@dairi）
const B = read('b.json');   // 图2：白天街道站立（黑发短发，@someone）
const C = read('c.json');   // 图3：霓虹雨夜（紫发长发，@third）

let pass = 0;
const failures = [];

function ok(cond, msg) {
  if (cond) { pass++; return; }
  failures.push(msg);
  console.error(`  ✗ ${msg}`);
}
const eq = (actual, expected, msg) => ok(actual === expected, `${msg}（期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}）`);

function run(instruction, opts = {}) {
  const images = opts.images || [A, B];
  const intent = parseFusionIntent(instruction, { count: images.length, ...opts });
  const merged = mergeSpecs({ images, intent });
  return { intent, merged };
}
const srcOf = (intent, p) => {
  const s = intent.sources.find(x => x.path === p);
  return s ? s.side : null;
};

console.log('== 1. 姿势搬运（用户原句） ==');
{
  const { intent, merged } = run('把图1的姿势换到图2的人身上');
  eq(intent.base, 2, '宿主 = 图2（「图2的人」是宿主证据）');
  eq(srcOf(intent, 'pose'), 1, 'pose ← 图1');
  eq(merged.spec.pose.action, 'sitting', '合并后动作来自图1');
  eq(merged.spec.pose.hands, 'holding book', '手的姿势也来自图1（整组换源）');
  eq(merged.spec.appearance.hair, 'black hair', '外观仍来自图2');
  eq(merged.spec.scene.location, 'street', '场景仍来自图2');
  eq(merged.spec.outfit.top, 'sailor shirt', '服装仍来自图2');
  ok(srcOf(intent, 'subject') === null, '没有把 subject 误判成换源（「人」不是维度词）');
  ok(merged.conflicts.some(c => c.code === 'framing-vs-pose' && c.severity === 'warn'),
    '报出「半身景别会裁掉坐姿」的跨源冲突');
}

console.log('== 2. 场景替换（用户原句） ==');
{
  const { intent, merged } = run('图1的场景替换成图2上');
  eq(intent.base, 2, '宿主 = 图2（「图2上」是落点证据，不是来源）');
  eq(srcOf(intent, 'scene'), 1, 'scene ← 图1');
  eq(merged.spec.scene.time, 'night', '夜晚来自图1');
  eq(merged.spec.scene.location, 'classroom', '教室来自图1（整组换源，图2的 street 被清掉）');
  eq(merged.spec.pose.action, 'standing', '姿势仍来自图2');
}

console.log('== 3. 外观来源 + 并列维度共享宾语 ==');
{
  const { intent, merged } = run('图1的形象，但发型和瞳色用图2的');
  eq(intent.base, 1, '外观一致指向图1 → 宿主 = 图1');
  eq(srcOf(intent, 'appearance'), 1, 'appearance ← 图1');
  eq(srcOf(intent, 'appearance.hair_style'), 2, '发型 ← 图2（并列宾语）');
  eq(srcOf(intent, 'appearance.eyes'), 2, '瞳色 ← 图2（并列宾语）');
  eq(merged.spec.appearance.hair, 'silver hair', '发色仍是图1的（子级没覆盖发色）');
  eq(merged.spec.appearance.hair_style, 'short hair', '发型换成图2的');
  eq(merged.spec.appearance.eyes, 'brown eyes', '瞳色换成图2的');
  eq(merged.spec.outfit.dress, 'white dress', '服装整组仍来自图1（宿主）');
  ok(intent.assumptions.some(a => a.includes('更具体的维度优先')), '给出「子级优先于组级」的说明');
}

console.log('== 4. 画风换源 + 默认宿主 ==');
{
  const { intent, merged } = run('画风照图1，其余按图2');
  eq(srcOf(intent, 'style'), 1, 'style ← 图1');
  eq(intent.base, 2, '没提外观来源 → 默认以最后一张（图2）为底');
  eq(merged.spec.style.palette, 'cool colors', '色调来自图1');
  eq(merged.spec.appearance.hair, 'black hair', '外观来自图2');
  ok(intent.assumptions.some(a => a.includes('默认')), '把「默认以最后一张为底」写成可见假设');
}

console.log('== 5. 整体换底 ==');
{
  const { intent } = run('整体照图1，不要图2的街道');
  eq(intent.base, 1, '「整体照图1」= 以图1为底');
  ok(intent.sources.length === 0, '整体换底不需要逐维度换源');
}

console.log('== 6. 同款句式 ==');
{
  const { intent } = run('图2的形象，姿势和图1一样');
  eq(srcOf(intent, 'appearance'), 2, 'appearance ← 图2');
  eq(srcOf(intent, 'pose'), 1, 'pose ← 图1（「和图1一样」）');
  eq(intent.base, 2, '宿主 = 图2');
}

console.log('== 7. 显式 --map / --preset / --base ==');
{
  const { sources, errors } = parseDimMap('pose=1, scene=2, appearance.hair=b');
  eq(errors.length, 0, '--map 无解析错误');
  eq(sources.length, 3, '--map 解析出 3 条');
  eq(sources[0].side, 1, 'pose=1 → 图1');
  eq(sources[2].path, 'appearance.hair', '支持子级路径');
  eq(parseDimMap('上身特写=2').sources.length, 4, '--map 里也能写组合宏（展开 4 个槽位）');
  ok(parseDimMap('啥玩意=1').errors.length === 1, '未知维度会报错');

  eq(normalizeSideArg('1'), 1, '--base 1 → 图1');
  eq(normalizeSideArg('b'), 2, '--base b → 图2');
  eq(normalizeSideArg('图3'), 3, '--base 图3 → 图3');
  eq(normalizeSideArg('2', true, 2), 1, '--swap 会对调 --base');
}

console.log('== 8. 组合宏（preset）==');
{
  const { intent, merged } = run('把图1的上身特写换给图2');
  eq(merged.base, 2, '宿主 = 图2');
  eq(intent.presets.length, 1, '命中 1 个组合宏');
  eq(intent.presets[0].id, 'bust', '命中「上身特写」');
  for (const p of ['pose', 'appearance.expression', 'style.framing', 'style.camera']) {
    eq(srcOf(intent, p), 1, `组合宏展开：${p} ← 图1`);
  }
  eq(merged.spec.pose.action, 'sitting', '姿势来自图1');
  eq(merged.spec.style.framing, 'full body', '景别来自图1（连同景别一起换，姿势不会被裁）');
  eq(merged.spec.appearance.hair, 'black hair', '外观（不在组合里）仍来自图2');
  ok(!merged.conflicts.some(c => c.code === 'framing-vs-pose'), '景别与姿势同源 → 不再报裁切警告');

  const it2 = parseFusionIntent('把图1的氛围感换到图2', { count: 2 });
  eq(it2.presets[0].id, 'mood', '「氛围感」命中色调氛围');

  // CLI/API 层的 --preset（不写编号时自动取「另一张」）
  const it3 = parseFusionIntent('图2当底', { count: 2 });
  const errs = applyPresets(it3, ['人物全套'], 2);
  eq(errs.length, 0, '--preset 不写编号时两张图可自动取另一张');
  eq(it3.sources.find(s => s.path === 'appearance').side, 1, '人物全套 → appearance ← 图1（底图之外）');
  eq(it3.sources.find(s => s.path === 'pose').side, 1, '人物全套 → pose ← 图1');
  const errs2 = applyPresets(it3, ['人物全套'], 3);
  ok(errs2.length === 1, '三张图下不写编号会报错（不猜）');
  ok(applyPresets(it3, ['不存在的组合'], 2).length === 1, '未知组合宏会报错');
  eq(resolvePreset('bust').id, 'bust', '组合宏支持用 id 指定');
  ok(PRESETS.length >= 8, '组合宏数量够用');
  const aliasClash = PRESETS.flatMap(p => p.aliases).filter(a => a.length < 2);
  eq(aliasClash.length, 0, '组合宏别名都不短于两个字（避免误命中）');
}

console.log('== 9. 多图（三张）==');
{
  const images = [A, B, C];
  const { intent, merged } = run('图1的姿势，图2的服装，画风照图3', { images });
  eq(intent.base, 3, '没提宿主 → 默认以最后一张（图3）为底');
  eq(srcOf(intent, 'pose'), 1, 'pose ← 图1');
  eq(srcOf(intent, 'outfit'), 2, 'outfit ← 图2');
  eq(srcOf(intent, 'style'), 3, 'style ← 图3');
  eq(merged.spec.pose.action, 'sitting', '姿势来自图1');
  eq(merged.spec.outfit.top, 'sailor shirt', '上衣来自图2');
  eq(merged.spec.style.palette, 'pastel colors', '色调来自图3');
  eq(merged.spec.appearance.hair, 'purple hair', '外观来自图3（宿主）');
  eq(merged.spec.scene.location, 'neon city', '场景来自图3（宿主）');

  const it2 = parseFusionIntent('图3的姿势换到图1的人身上', { count: 3 });
  eq(it2.base, 1, '三张图里「图1的人」也是宿主证据');
  eq(it2.sources.find(s => s.path === 'pose').side, 3, 'pose ← 图3');

  const it3 = parseFusionIntent('把图2的姿势和场景都用上，底图是图1', { count: 3 });
  eq(it3.base, 1, '显式「底图是图1」');
  eq(it3.sources.find(s => s.path === 'pose').side, 2, 'pose ← 图2');
  eq(it3.sources.find(s => s.path === 'scene').side, 2, 'scene ← 图2');

  const { merged: m4 } = run('图1的姿势，画风照图3', { images });
  ok(m4.conflicts.some(c => c.code === 'unused-image' && c.message.includes('图2')),
    '三张图里有的图完全没用到 → 提醒');
}

console.log('== 10. 链式融合（上一轮结果当成下一轮的一张图）==');
{
  const first = run('把图1的姿势换到图2的人身上');
  const mid = first.merged.spec;
  eq(mid.pose.action, 'sitting', '第一轮：姿势来自图1');
  const it2 = parseFusionIntent('图2的画风套到图1上', { count: 2 });
  const m2 = mergeSpecs({ images: [mid, C], intent: it2 });
  eq(m2.base, 1, '第二轮以中间结果为底');
  eq(m2.spec.style.palette, 'pastel colors', '第二轮：色调换成图3的');
  eq(m2.spec.pose.action, 'sitting', '中间结果里的姿势被完整继承');
  eq(m2.spec.appearance.hair, 'black hair', '中间结果里的外观也在');
  eq(m2.spec.artists[0], '@someone', 'artists 是独立槽位，不随 style 整组换源');
  ok(m2.conflicts.some(c => c.code === 'style-vs-artists'), '提示「画师标签没跟着换」（可用画风全套补齐）');
  const it3 = parseFusionIntent('图2的画风全套套到图1上', { count: 2 });
  const m3 = mergeSpecs({ images: [mid, C], intent: it3 });
  eq(m3.spec.artists[0], '@third', '「画风全套」会连带 artists 一起换');
  eq(m3.spec.style.palette, 'pastel colors', '画风全套也换 style 整组');
}

console.log('== 11. 歧义与追问 ==');
{
  const a1 = parseFusionIntent('把两张图融合一下');
  ok(a1.ambiguous.some(x => x.code === 'no-dim'), '没识别出维度 → 要求确认');
  const a2 = parseFusionIntent('图1的形象微调成图2的某方面');
  ok(a2.ambiguous.some(x => x.code === 'unspecified-dim'), '「某方面」→ 要求指定维度');
  eq(a2.base, 1, '「图1的形象」→ 宿主 = 图1');
  const a3 = parseFusionIntent('姿势和场景都要');
  ok(a3.ambiguous.some(x => x.code === 'missing-ref'), '全部维度都没指代 → 追问');
  const a4 = parseFusionIntent('图1的姿势，头发弄得好看点');
  ok(a4.assumptions.some(x => x.includes('没指定来源')), '部分维度没指代 → 回落到宿主并明写假设');
  const a5 = parseFusionIntent('把图1的姿势换到图2的人身上');
  ok(a5.unknown.length === 0, `常规句不该有没听懂的碎片（实际：${JSON.stringify(a5.unknown.map(u => u.text))}）`);
  const a6 = parseFusionIntent('图1的姿势放到图2，但是要更可爱一点');
  ok(a6.unknown.some(u => u.text === '可爱'), '额外修饰语剥掉虚词后进「没听懂」清单');
  const a7 = parseFusionIntent('图1的姿势换到图2的人身上，但保持图2的画风');
  ok(a7.unknown.length === 0, `纯虚词碎片不该进没听懂清单（实际：${JSON.stringify(a7.unknown.map(u => u.text))}）`);
  eq(srcOf(a7, 'style'), 2, '「保持图2的画风」也记为一次换源（与宿主同源）');
}

console.log('== 12. 空源与冲突 ==');
{
  const a2 = { appearance: { hair: 'blonde hair' }, style: { medium: 'anime screenshot' }, pose: {} };
  const b2 = { pose: { action: 'standing' }, appearance: { hair: 'black hair' }, style: { medium: 'anime screenshot' }, nsfw: '' };
  const intent = parseFusionIntent('把图1的姿势换到图2的人身上');
  const m = mergeSpecs({ images: [a2, b2], intent });
  ok(m.emptySources.some(e => e.path === 'pose'), '源里姿势是空的 → 报 emptySources');
  eq(m.spec.pose.action, 'standing', '空源不覆盖，保留宿主的值');
  ok(m.conflicts.some(c => c.code === 'empty-source'), '空源同时进冲突清单');

  const it3 = parseFusionIntent('图1的外貌换到图2的人身上');
  const m3 = mergeSpecs({ images: [A, { ...B, characters: ['hatsune miku'] }], intent: it3 });
  ok(m3.conflicts.some(c => c.code === 'char-vs-appearance'), '角色在图2、外貌来自图1 → 报撕裂');
}

console.log('== 13. 溯源与负向合并 ==');
{
  const { merged } = run('把图1的姿势换到图2的人身上');
  const pv = Object.fromEntries(merged.provenance.map(p => [p.path, p.side]));
  eq(pv['pose.action'], 1, '溯源：姿势来自图1');
  eq(pv['appearance.hair'], 2, '溯源：发色来自图2');
  eq(pv['style.palette'], 2, '溯源：色调来自图2');
  ok(merged.spec.negative.includes('glasses') && merged.spec.negative.includes('extra fingers'),
    '负向取并集（所有图的排除项都留着）');
  ok(merged.spec.notes.includes('双图融合'), 'notes 写入溯源日志（notes 不产标签，正好当日志）');

  const { merged: m2 } = run('图1的形象，但发型和瞳色用图2的');
  const pv2 = Object.fromEntries(m2.provenance.map(p => [p.path, p.side]));
  eq(pv2['appearance.hair_style'], 2, '溯源：发型取最具体的来源（子级赢过组级）');
  eq(pv2['appearance.eyes'], 2, '溯源：瞳色取最具体的来源');
  eq(pv2['appearance.hair'], 1, '溯源：发色仍归图1');
  const allPaths = m2.provenance.map(p => p.path);
  eq(new Set(allPaths).size, allPaths.length, '溯源表没有重复字段');

  const three = mergeSpecs({ images: [A, B, C], intent: parseFusionIntent('图1的姿势，图2的服装', { count: 3 }) });
  ok(three.spec.negative.includes('hat') && three.spec.negative.includes('glasses') && three.spec.negative.includes('extra fingers'),
    '三张图的负向也全部并集');
}

console.log('');
if (failures.length) {
  console.error(`失败 ${failures.length} 项，通过 ${pass} 项`);
  process.exit(1);
}
console.log(`全部通过：${pass} 项断言`);
