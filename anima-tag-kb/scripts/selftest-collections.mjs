#!/usr/bin/env node
/**
 * selftest-collections.mjs —— 「tag 串收藏」的零依赖自测
 *
 * 跑法：
 *   node scripts/selftest-collections.mjs          # 逻辑层 + 服务端接口（能起服务就跑）
 *   node scripts/selftest-collections.mjs -v       # 每例打印细节
 *   node scripts/selftest-collections.mjs --no-http   # 只测逻辑层
 *
 * 测什么：
 *   A 逻辑层（viewer/collections-core.js）：归一化 / 内容去重 / 自动命名 / 改名 /
 *     备注 / 置顶排序 / 上下移动 / 删除墓碑 / 导入导出 / 双端合并 / 坏数据修复 / 上限
 *   B 服务端接口（scripts/serve-kb.mjs 的 /api/collections）：GET 空状态 → POST →
 *     GET 回读 → 落盘文件 → 非法 JSON → 超长 body
 *
 * 关于用户数据：B 段会先备份 data/collections.json，测完原样还原（成功失败都还原）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const require = createRequire(import.meta.url);
const C = require(path.join(ROOT, 'viewer', 'collections-core.js'));

const argv = process.argv.slice(2);
const VERBOSE = argv.includes('-v') || argv.includes('--verbose');
const NO_HTTP = argv.includes('--no-http');
const FILE = path.join(ROOT, 'data', 'collections.json');

let pass = 0, fail = 0;
const t0 = Date.now();
function ok(name, cond, extra) {
  if (cond) { pass++; if (VERBOSE) console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra === undefined ? '' : '  → ' + JSON.stringify(extra))); }
}
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), { got, want });
const section = s => console.log('\n' + s);

/* ============ A 逻辑层 ============ */
section('A · 归一化与内容指纹');
eq('normTag 去下划线/统一小写', C.normTag('High_Heels '), 'high heels');
eq('normTags 去重保序', C.normTags(['Shirt', 'shirt', 'SKIRT']), ['shirt', 'skirt']);
eq('normTags 吃字符串', C.normTags('a, b；c\nD'), ['a', 'b', 'c', 'd']);
ok('keyOf 忽略顺序/大小写/下划线', C.keyOf(['boots', 'High_Heels']) === C.keyOf(['high heels', ' BOOTS ']));
ok('不同内容指纹不同', C.keyOf(['a', 'b']) !== C.keyOf(['a', 'c']));
ok('equalsTags 对称', C.equalsTags(['X_y'], ['x y']) && C.equalsTags(['x y'], ['X_y']));

section('A · 默认名与自动命名');
eq('单标签默认名', C.defaultName(['shoes']), 'shoes');
eq('多标签默认名', C.defaultName(['shoes', 'boots', 'high heels', 'socks']), 'shoes 等 4 个');
{
  let s = C.add(C.empty(), { tags: ['shoes', 'boots'], now: 1000 }).state;
  const r = C.add(s, { tags: ['shoes', 'socks'], now: 2000 });      // 首标签相同、内容不同
  s = r.state;
  eq('自动名撞车加 (2)', s.items.map(i => i.name), ['shoes 等 2 个', 'shoes 等 2 个 (2)']);
  const r2 = C.add(s, { tags: ['shoes', 'hat'], name: 'shoes 等 2 个', now: 3000 });   // 手填名允许重复
  eq('手填名允许重复', r2.state.items.map(i => i.name).filter(n => n === 'shoes 等 2 个').length, 2);
}

section('A · 收藏 / 内容去重 / 空输入');
{
  const a = C.add(C.empty(), { tags: ['shoes', 'boots'], name: '鞋子', ctx: { cat: 'og:attire', sub: '鞋类', q: 'shoes', mode: 'exact' }, now: 1712e9 });
  ok('首次收藏成功', a.reason === 'ok' && a.state.items.length === 1);
  eq('条目字段齐全', Object.keys(a.item).sort(), ['cats', 'createdAt', 'ctx', 'id', 'key', 'name', 'note', 'order', 'pinned', 'tags', 'updatedAt'].sort());
  const dup = C.add(a.state, { tags: ['Boots', 'shoes_'], now: 1713e9 });            // 顺序+大小写+下划线全变
  ok('内容重复被拦下', dup.reason === 'dup' && dup.dup.id === a.item.id && dup.state.items.length === 1);
  const dup2 = C.add(a.state, { tags: ['shoes', 'boots'], allowDup: true, now: 1714e9 });
  ok('allowDup 可强行新增', dup2.reason === 'ok' && dup2.state.items.length === 2);
  const e = C.add(a.state, { tags: [], now: 1715e9 });
  ok('空标签串不收藏', e.reason === 'empty' && e.state.items.length === 1);
}

section('A · 改写 / 备注 / 置顶 / 移动');
{
  let s = C.empty();
  s = C.add(s, { tags: ['a'], now: 1000 }).state;
  s = C.add(s, { tags: ['b'], now: 2000 }).state;
  s = C.add(s, { tags: ['c'], now: 3000 }).state;
  eq('初始顺序', C.sortedItems(s).map(i => i.tags[0]), ['a', 'b', 'c']);
  const idB = C.findByKey(s, ['b']).id;
  s = C.move(s, idB, -1, 4000).state;
  eq('上移一位', C.sortedItems(s).map(i => i.tags[0]), ['b', 'a', 'c']);
  s = C.togglePin(s, idB, 5000).state;
  eq('置顶后仍在最前', C.sortedItems(s).map(i => i.tags[0]), ['b', 'a', 'c']);
  s = C.move(s, C.findByKey(s, ['c']).id, -1, 6000).state;
  eq('未置顶项在置顶项之下', C.sortedItems(s).map(i => i.tags[0]), ['b', 'c', 'a']);
  s = C.rename(s, idB, '  我的主串  ', 7000).state;
  eq('改名去空白', C.getById(s, idB).name, '我的主串');
  s = C.setNote(s, idB, '用于夜景人像', 8000).state;
  eq('备注写入', C.getById(s, idB).note, '用于夜景人像');
  eq('updatedAt 随写入走', C.getById(s, idB).updatedAt, new Date(8000).toISOString());
  ok('searchQueryOf 拼串', C.searchQueryOf(C.getById(s, idB)) === 'b');
  eq('describe 摘要', C.describe(C.getById(s, idB)).tags, 1);
}

section('A · 删除与墓碑');
{
  let s = C.empty();
  s = C.add(s, { tags: ['x', 'y'], name: 'XY', now: 1000 }).state;
  const id = s.items[0].id;
  const del = C.remove(s, id, 2000);
  ok('删除生效', del.state.items.length === 0 && del.state.tombstones[id] === new Date(2000).toISOString());
  const back = C.mergeStates(del.state, s, { now: 3000 });      // 拿一份「删除前的旧数据」来合
  ok('旧数据不会把已删条目复活', back.state.items.length === 0, back.state.items);
  const reAdd = C.add(back.state, { tags: ['x', 'y'], name: 'XY', now: 4000 });
  ok('删掉后可以重新收藏', reAdd.reason === 'ok' && reAdd.state.items.length === 1);
}

section('A · 双端合并');
{
  let local = C.empty(), remote = C.empty();
  local = C.add(local, { tags: ['l1'], now: 1000 }).state;
  remote = C.add(remote, { tags: ['r1'], now: 2000 }).state;
  remote = C.add(remote, { tags: ['r2'], now: 3000 }).state;
  const m = C.mergeStates(local, remote, { now: 4000 });
  eq('并集条数', m.state.items.length, 3);
  eq('新增计数', m.added, 2);
  // 同 id 不同内容 → 取 updatedAt 新的
  const idShared = remote.items[0].id;
  const localNewer = { v: 1, items: [{ id: idShared, tags: ['r1', 'added'], name: '改过', updatedAt: new Date(9000).toISOString(), createdAt: new Date(2000).toISOString() }], tombstones: {} };
  const m2 = C.mergeStates(localNewer, remote, { now: 9500 });
  eq('同 id 取更新的那条', C.getById(m2.state, idShared).name, '改过');
  // 内容重复但 id 不同 → 合一条
  const dupState = { v: 1, items: [{ id: 'zzz', tags: ['r2'], name: '重复', updatedAt: new Date(9500).toISOString() }], tombstones: {} };
  const m3 = C.mergeStates(remote, dupState, { now: 9600 });
  eq('内容重复合并成一条', m3.state.items.filter(i => i.key === C.keyOf(['r2'])).length, 1);
}

section('A · 导入导出与坏数据修复');
{
  let s = C.add(C.empty(), { tags: ['a', 'b'], name: 'AB', note: 'n', ctx: { cat: 'c', sub: 's' }, now: 1000 }).state;
  const json = C.exportJSON(s);
  const parsed = JSON.parse(json);
  ok('导出带版本与种类', parsed.v === 1 && parsed.kind === 'anima-tag-collections' && parsed.items.length === 1);
  const round = C.importState(json, { now: 2000 });
  ok('导出再导入不重复', round.state.items.length === 1 && round.error === null);
  ok('坏 JSON 有报错不抛异常', C.importState('{oops', {}).error === 'parse-failed');
  ok('非法形状有报错', C.importState(42, {}).error === 'bad-shape');
  const messy = C.validate([
    { tags: ['ok'], name: 'a' },
    { tags: [], name: '没有标签' },                       // 丢弃
    'not-an-object',                                     // 丢弃
    { id: 'same', tags: ['x'] },
    { id: 'same', tags: ['y'] },                          // id 撞车 → 改写
    { tags: ['ok'], name: '内容重复' },                    // 内容重复 → 合并
    { tags: ['long'], name: 'x'.repeat(200), note: 'y'.repeat(500), pinned: 'yes', order: 'NaN' }
  ], { now: 5000 });
  eq('坏数据修复后条数', messy.state.items.length, 4);
  ok('坏条目被计数', messy.dropped >= 3, messy.dropped);
  eq('超长名截断', messy.state.items.find(i => i.tags[0] === 'long').name.length, C.LIMITS.name);
  eq('超长备注截断', messy.state.items.find(i => i.tags[0] === 'long').note.length, C.LIMITS.note);
  eq('pinned 强制布尔', messy.state.items.find(i => i.tags[0] === 'long').pinned, true);
  ok('order 非法时补数值', Number.isFinite(messy.state.items.find(i => i.tags[0] === 'long').order));
  ok('重复 id 已改写', messy.state.items.filter(i => i.id === 'same').length <= 1);
  const many = C.add(C.empty(), { tags: Array.from({ length: 260 }, (_, i) => 't' + i), now: 1000 });
  eq('标签数上限', many.item.tags.length, C.LIMITS.tags);
  const oldTomb = { v: 1, items: [], tombstones: { old: new Date(Date.now() - 40 * 86400000).toISOString(), fresh: new Date().toISOString() } };
  eq('过期墓碑被剪掉', Object.keys(C.validate(oldTomb).state.tombstones), ['fresh']);
  eq('stats 概览', C.stats(s).count, 1);
}

/* ============ B 服务端接口 ============ */
async function httpPart() {
  section('B · 服务端接口 /api/collections');
  if (NO_HTTP) { console.log('  · 已按 --no-http 跳过'); return; }

  const had = fs.existsSync(FILE);
  const backup = had ? fs.readFileSync(FILE) : null;
  let child = null, base = null;
  const cleanup = () => {
    try { if (backup) fs.writeFileSync(FILE, backup); else if (fs.existsSync(FILE)) fs.unlinkSync(FILE); } catch { /* 忽略 */ }
    if (child) { try { child.kill(); } catch { /* 忽略 */ } }
  };
  try {
    // ① 先找正在跑的服务；没有就自己起一个（stdio 忽略，避免管道）
    for (let p = 8100; p <= 8110 && !base; p++) {
      base = await probe(p);
    }
    if (!base) {
      const port = 8188 + Math.floor(Math.random() * 20);
      try {
        child = spawn(process.execPath, [path.join(HERE, 'serve-kb.mjs'), String(port), '--no-open'], { cwd: ROOT, stdio: 'ignore', detached: false });
      } catch (e) { child = null; }
      for (let i = 0; i < 20 && !base; i++) { await sleep(250); base = await probe(port); }
    }
    if (!base) { console.log('  · 起不了本地服务，HTTP 段跳过（逻辑层已全测）'); return; }
    console.log('  · 使用服务：' + base);

    const empty = await json(base + '/api/collections');
    ok('GET 返回合法状态', empty.res.status === 200 && empty.body && Array.isArray(empty.body.items), empty.body);

    const sample = C.add(C.empty(), { tags: ['shoes', 'boots', 'high heels'], name: '鞋类三件', note: '常用', ctx: { cat: 'og:attire', sub: '鞋类' }, now: 1712e9 }).state;
    const post = await json(base + '/api/collections', { method: 'POST', headers: { 'content-type': 'application/json' }, body: C.exportJSON(sample) });
    ok('POST 写入成功', post.res.status === 200 && post.body && post.body.ok === true, post.body);
    eq('POST 回报条数', post.body && post.body.count, 1);

    const read = await json(base + '/api/collections');
    eq('GET 回读到同一条', read.body.items.map(i => i.name), ['鞋类三件']);
    ok('文件里确实落盘', fs.existsSync(FILE) && fs.readFileSync(FILE, 'utf8').includes('high heels'));
    ok('返回头带 x-kb-server', (read.res.headers.get('x-kb-server') || '') === 'anima-tag-kb');

    const bad = await json(base + '/api/collections', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' });
    ok('非法 JSON → 400', bad.res.status === 400, bad.res.status);
    const big = await json(base + '/api/collections', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ v: 1, items: [], pad: 'x'.repeat(1200000) }) });
    ok('超大 body → 413', big.res.status === 413, big.res.status);
    const wrong = await json(base + '/api/collections', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nope: 1 }) });
    ok('形状不对 → 400', wrong.res.status === 400, wrong.res.status);
    const del = await fetch(base + '/api/collections', { method: 'DELETE' });
    ok('DELETE 不支持 → 405', del.status === 405, del.status);
  } catch (e) {
    ok('HTTP 段无异常', false, String(e && e.message));
  } finally {
    cleanup();
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function probe(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/collections`, { signal: AbortSignal.timeout(700) });
    if (!r.ok && r.status !== 404) return null;
    const h = r.headers.get('x-kb-server');
    if (h !== 'anima-tag-kb') return null;         // 405/404 也算本服务（旧版没有这个接口）
    return `http://127.0.0.1:${port}`;
  } catch { return null; }
}
async function json(url, init) {
  const res = await fetch(url, { ...(init || {}), signal: AbortSignal.timeout(5000) });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { res, body };
}

await httpPart();

console.log(`\n${pass} 通过 / ${fail} 失败 · ${Date.now() - t0}ms`);
if (fail) { console.log('有失败用例，看上面的 ✗。'); process.exit(1); }
