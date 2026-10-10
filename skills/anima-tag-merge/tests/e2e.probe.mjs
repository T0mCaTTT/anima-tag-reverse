#!/usr/bin/env node
/**
 * e2e.probe.mjs —— 端到端探针：真的跑 CLI、真的查词库
 *
 * 与 smoke.mjs 的分工：smoke 锁「解析与合并对不对」，本探针锁「命令行契约」——
 *   stdout 只有交付物（单行标签 / JSON / markdown）、提示走 stderr、
 *   --format 各形态可用、--img / --map / --preset / --base / --swap 生效、
 *   多图与链式可用、参数缺失时退出码正确。
 *
 * 跑法：node tests/e2e.probe.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin', 'merge.mjs');
const A = path.join(ROOT, 'tests', 'fixtures', 'a.json');
const B = path.join(ROOT, 'tests', 'fixtures', 'b.json');
const C = path.join(ROOT, 'tests', 'fixtures', 'c.json');

let pass = 0;
const failures = [];
const ok = (cond, msg) => {
  if (cond) { pass++; return; }
  failures.push(msg);
  console.error(`  ✗ ${msg}`);
};
const eq = (a, b, msg) => ok(a === b, `${msg}（期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}）`);

function run(args) {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', cwd: ROOT, timeout: 60000 });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

console.log('== CLI 契约 ==');
{
  const r = run(['--a', A, '--b', B, '把图1的姿势换到图2的人身上']);
  eq(r.code, 0, '默认档退出码 0');
  const lines = r.out.split('\n').filter(x => x.trim());
  eq(lines.length, 1, 'stdout 只有一行（交付形态）');
  ok(!r.out.includes('```'), 'stdout 没有 markdown 代码块');
  ok(/^[^,]+, [^,]+/.test(lines[0]), '输出是逗号分隔的标签串');
  ok(lines[0].includes('sitting'), '姿势来自图1（含 sitting）');
  ok(!lines[0].includes('standing'), '图2 的原姿势 standing 已被替换掉');
  ok(lines[0].includes('sailor shirt'), '图2 的服装仍在（宿主骨架保留）');
  ok(!lines[0].includes('silver hair'), '图1 的外貌没被带过来');
  ok(r.err.includes('[融合]'), '换源摘要走 stderr');
  ok(r.err.includes('景别'), '跨源冲突提示走 stderr');
}
{
  const r = run(['--img', A, '--img', B, '把图1的姿势换到图2的人身上']);
  eq(r.code, 0, '--img 写法等价于 --a/--b');
  ok(r.out.includes('sitting'), '--img 写法结果一致');
}
{
  const r = run(['--a', A, '--b', B, '把图1的姿势换到图2的人身上', '--format', 'prompt']);
  ok(r.out.includes('masterpiece'), '--format prompt 带官方前缀');
  ok(r.out.trim().split('\n').length === 1, '--format prompt 仍是单行');
}
{
  const r = run(['--a', A, '--b', B, '图1的场景替换成图2上', '--format', 'spec']);
  eq(r.code, 0, '--format spec 退出码 0');
  const spec = JSON.parse(r.out);
  eq(spec.scene.location, 'classroom', 'spec：场景来自图1');
  eq(spec.appearance.hair, 'black hair', 'spec：外观来自图2');
  ok(spec.notes.includes('双图融合'), 'spec：notes 记了溯源');
}
{
  const r = run(['--a', A, '--b', B, '把图1的姿势换到图2的人身上', '--format', 'json']);
  const j = JSON.parse(r.out);
  eq(j.base, 2, 'json：底图 = 图2');
  eq(j.count, 2, 'json：图片数 = 2');
  ok(j.sources.some(s => s.path === 'pose' && s.side === 1), 'json：换源表含 pose←图1');
  ok(Array.isArray(j.provenance) && j.provenance.length > 5, 'json：带溯源表');
  ok(typeof j.tags === 'string' && j.tags.length > 0, 'json：带标签串');
}
{
  const r = run(['--a', A, '--b', B, '把图1的姿势换到图2的人身上', '--format', 'md']);
  ok(r.out.includes('溯源表'), 'md：有溯源表');
  ok(r.out.includes('换源表'), 'md：有换源表');
  ok(r.out.includes('```json'), 'md：附合并后的观察 JSON');
}

console.log('== 显式参数 ==');
{
  const r = run(['--a', A, '--b', B, '--map', 'pose=1,scene=1', '--base', '2', '--format', 'spec']);
  const spec = JSON.parse(r.out);
  eq(spec.pose.action, 'sitting', '--map pose=1 生效');
  eq(spec.scene.location, 'classroom', '--map scene=1 生效');
  eq(spec.appearance.hair, 'black hair', '--base 2 让未点名的维度取图2');
}
{
  const r = run(['--a', A, '--b', B, '把图1的姿势换到图2的人身上', '--swap', '--format', 'spec']);
  const spec = JSON.parse(r.out);
  eq(spec.pose.action, 'standing', '--swap 后「图1」指 --b，姿势取自 --b 的 standing');
}
{
  const r = run(['--dims']);
  ok(r.out.includes('pose.hands'), '--dims 列出叶子槽位');
  ok(r.out.includes('光位'), '--dims 列出中文别名');
}
{
  const r = run(['--presets']);
  eq(r.code, 0, '--presets 打印组合宏清单');
  ok(r.out.includes('上身特写') && r.out.includes('氛围感'), '--presets 列出组合宏');
  ok(r.out.includes('style.framing'), '--presets 展示展开后的槽位');
}

console.log('== 组合宏 ==');
{
  const r = run(['--img', A, '--img', B, '--preset', '上身特写=1', '--base', '2', '--format', 'spec']);
  eq(r.code, 0, '--preset 可用');
  const spec = JSON.parse(r.out);
  eq(spec.pose.action, 'sitting', '组合宏：姿势 ← 图1');
  eq(spec.style.framing, 'full body', '组合宏：景别 ← 图1');
  eq(spec.appearance.hair, 'black hair', '组合宏外的维度仍取底图（图2）');
  ok(r.err.includes('组合宏「上身特写」'), 'stderr 说明命中了哪个组合宏');
}
{
  const r = run(['--img', A, '--img', B, '--preset', '氛围感', '--format', 'spec']);
  const spec = JSON.parse(r.out);
  eq(spec.style.palette, 'cool colors', '两张图时 --preset 不写编号自动取「另一张」（图1）');
  eq(spec.pose.action, 'standing', '没被组合宏覆盖的维度仍取底图');
}
{
  const r = run(['--img', A, '--img', B, '--preset', '不存在的组合', '--format', 'spec']);
  eq(r.code, 0, '未知组合宏不崩');
  ok(r.err.includes('未知组合宏'), '未知组合宏给出参数提示');
}
{
  const r = run(['--img', A, '--img', B, '把图1的上身特写换给图2']);
  ok(r.out.includes('sitting'), '组合宏也能直接写在自然语言里');
  ok(!r.err.includes('裁掉'), '景别跟着一起换 → 不再报「姿势会被裁掉」');
}

console.log('== 多图与链式 ==');
{
  const r = run(['--img', A, '--img', B, '--img', C, '图1的姿势，图2的服装，画风照图3', '--format', 'spec']);
  eq(r.code, 0, '三张图可用');
  const spec = JSON.parse(r.out);
  eq(spec.pose.action, 'sitting', '三图：姿势来自图1');
  eq(spec.outfit.top, 'sailor shirt', '三图：服装来自图2');
  eq(spec.style.palette, 'pastel colors', '三图：色调来自图3');
  eq(spec.appearance.hair, 'purple hair', '三图：外观来自底图（图3）');
  ok(r.err.includes('底图=图3'), 'stderr 说明底图是图3');
}
{
  const r = run(['--img', A, '--img', B, '--img', C, '图1的姿势，画风照图3', '--format', 'json']);
  const j = JSON.parse(r.out);
  ok(j.conflicts.some(c => c.code === 'unused-image' && c.message.includes('图2')),
    '三张图里完全没被用到的图会被点名');
}
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-chain-'));
  const mid = path.join(tmp, 'mid.json');
  const r1 = run(['--img', A, '--img', B, '把图1的姿势换到图2的人身上', '--format', 'spec', '--out', mid]);
  eq(r1.code, 0, '链式第一步：导出中间观察');
  ok(fs.existsSync(mid), '中间观察已落盘');
  const r2 = run(['--img', mid, '--img', C, '图2的画风全套套到图1上', '--format', 'spec']);
  eq(r2.code, 0, '链式第二步：用中间结果当一张图');
  const spec = JSON.parse(r2.out);
  eq(spec.pose.action, 'sitting', '链式：中间结果里的姿势被继承');
  eq(spec.style.palette, 'pastel colors', '链式：第二轮换成图3的画风');
  eq(spec.artists[0], '@third', '链式：画风全套连带画师一起换');
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('== 歧义与错误 ==');
{
  const r = run(['--a', A, '--b', B, '图1的形象微调成图2的某方面', '--format', 'explain']);
  eq(r.code, 3, '有歧义时 explain 退出码 3（调用方可据此追问）');
  ok(r.out.includes('unspecified-dim'), 'explain 报出「没说改哪儿」');
}
{
  const r = run(['--a', A, '把图1的姿势换到图2的人身上']);
  eq(r.code, 2, '只给一张图时退出码 2');
  ok(r.err.includes('至少需要两份观察'), '缺参数时给出可读错误');
}
{
  const r = run(['--a', A, '--b', B, '图1的姿势图和图2的人', '--format', 'spec']);
  eq(r.code, 0, '带错别字的指令也不崩');
  const spec = JSON.parse(r.out);
  ok(spec.pose, '至少产出了完整的观察结构');
}

console.log('');
if (failures.length) {
  console.error(`失败 ${failures.length} 项，通过 ${pass} 项`);
  process.exit(1);
}
console.log(`全部通过：${pass} 项断言`);
