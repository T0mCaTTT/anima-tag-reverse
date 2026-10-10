#!/usr/bin/env node
/**
 * e2e.probe.mjs —— 端到端探针：真的跑 CLI
 *
 * 锁「命令行契约」：stdout 只有交付物、提示走 stderr、各子命令可用、
 * **退出码语义**（0 高置信 / 3 需确认 / 4 没找到 / 2 参数错）——
 * 这个约定是会话里的我「先跑一次看码，再决定要不要追问用户」的依据。
 *
 * 跑法：node tests/e2e.probe.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin', 'char.mjs');
const SPEC = path.join(ROOT, 'tests', 'fixtures', 'spec-zh.json');

let pass = 0;
const failures = [];
const ok = (cond, msg) => {
  if (cond) { pass++; return; }
  failures.push(msg);
  console.error(`  ✗ ${msg}`);
};
const eq = (a, b, msg) => ok(a === b, `${msg}（期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}）`);
const run = args => {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', cwd: ROOT, timeout: 60000 });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
};

console.log('== resolve 契约 ==');
{
  const r = run(['可莉', '-s', '原神']);
  eq(r.code, 0, '高置信 → 退出码 0');
  eq(r.out.trim().split('\n').length, 1, 'stdout 只有一行');
  eq(r.out.trim(), 'klee (genshin impact), genshin impact', '交付：角色 tag + 作品 tag');
  ok(r.err.includes('[角色]'), '说明走 stderr');
  ok(r.err.includes('已排除'), 'stderr 列出被排除的同名角色');
}
{
  const r = run(['可莉', '-s', '原神', '--no-series']);
  eq(r.out.trim(), 'klee (genshin impact)', '--no-series 只给角色标签');
}
{
  const r = run(['浅仓南']);
  eq(r.code, 4, '库里没有 → 退出码 4');
  eq(r.out.trim(), '', 'stdout 为空（不硬凑标签）');
  ok(r.err.includes('词库里没有'), 'stderr 说明原因');
}
{
  const r = run(['星野', '-s', '不存在的作品xyz']);
  eq(r.code, 3, '显式作品查不到 → 退出码 3（需确认）');
  ok(r.err.includes('没解析出来'), 'stderr 明确警告');
}
{
  const r = run(['星野', '-s', '少女与战车']);
  eq(r.out.trim(), 'hoshino (girls und panzer), girls und panzer', '中文作品名 + 消歧正常');
}
{
  const r = run(['玛修']);
  eq(r.code, 0, '唯一候选的部分匹配 → 也可交付（退出码 0）');
  eq(r.out.trim(), 'mash kyrielight, fate (series)', '并给出正确标签');
}
{
  const r = run(['可莉', '-s', '原神', '--format', 'json']);
  const j = JSON.parse(r.out);
  eq(j.best.tag, 'klee (genshin impact)', 'json：最佳候选');
  eq(j.best.series, 'genshin impact', 'json：作品归属');
  ok(Array.isArray(j.candidates) && j.candidates.length > 0, 'json：候选列表');
  ok(j.series.tag === 'genshin impact', 'json：作品解析结果');
}
{
  const r = run(['可莉', '-s', '原神', '--format', 'md']);
  ok(r.out.includes('# 角色解析'), 'md：有标题');
  ok(r.out.includes('| 标签 |'), 'md：候选表');
}

console.log('== 子命令 ==');
{
  const r = run(['series', '原神', '--limit', '5']);
  eq(r.code, 0, 'series 退出码 0');
  const tags = r.out.trim().split(', ');
  eq(tags.length, 5, 'series --limit 生效');
  ok(r.err.includes('收录'), 'stderr 说明该作品收录多少角色');
}
{
  const r = run(['series', '不存在的作品xyz']);
  eq(r.code, 4, 'series 未知作品 → 退出码 4');
}
{
  const r = run(['search', '灵梦']);
  eq(r.code, 0, 'search 命中');
  ok(r.out.includes('hakurei reimu'), 'search 返回相关标签');
  eq(run(['search', 'zzzz不存在zzzz']).code, 4, 'search 无结果 → 退出码 4');
}
{
  const r = run(['verify', 'hakurei reimu']);
  eq(r.code, 0, 'verify 命中 → 0');
  eq(r.out.trim(), 'hakurei reimu', 'verify 回显规范标签');
  ok(r.err.includes('touhou'), 'stderr 给出作品归属');
  eq(run(['verify', 'definitely not a tag']).code, 4, 'verify 未命中 → 退出码 4');
}
{
  const r = run(['patch', SPEC, '--dry-run']);
  ok(r.out.includes('已替换'), 'patch --dry-run 输出变更表');
  ok(r.out.includes('klee (genshin impact)'), 'patch 记录了角色替换');
  ok(r.out.includes('genshin impact'), 'patch 记录了作品替换');
}
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'char-patch-'));
  const fixed = path.join(tmp, 'fixed.json');
  const r1 = run(['patch', SPEC, '--out', fixed]);
  eq(r1.code, 0, 'patch --out 退出码 0');
  const spec1 = JSON.parse(fs.readFileSync(fixed, 'utf8'));
  eq(spec1.characters[0], 'klee (genshin impact)', '写出的角色字段是规范标签');
  eq(spec1.series[0], 'genshin impact', '写出的作品字段是规范标签');
  eq(spec1.characters.length, 1, '重复角色已去重');
  // 幂等：再跑一次不应再有变更
  const fixed2 = path.join(tmp, 'fixed2.json');
  const r2 = run(['patch', fixed, '--out', fixed2]);
  eq(JSON.parse(fs.readFileSync(fixed2, 'utf8')).characters[0], 'klee (genshin impact)', '二次 patch 结果稳定');
  eq(r2.code, 0, '二次 patch 无需确认');
  fs.rmSync(tmp, { recursive: true, force: true });
}
{
  const r = run(['--info']);
  ok(r.out.includes('角色词库概况'), '--info 给出词库概况');
  ok(r.out.includes('能归到具体作品的'), '--info 说明归属覆盖');
}
{
  eq(run(['--help']).code, 0, '--help 正常');
  eq(run([]).code, 2, '缺参数 → 退出码 2');
}

console.log('');
if (failures.length) {
  console.error(`失败 ${failures.length} 项，通过 ${pass} 项`);
  process.exit(1);
}
console.log(`全部通过：${pass} 项断言`);
