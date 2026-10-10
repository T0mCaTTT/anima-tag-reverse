#!/usr/bin/env node
/**
 * smoke.mjs —— 离线自测（读本地词库，不联网）
 *
 * 锁的是「会不会给错标签」这类致命错误：同名角色消歧、残条目抢位、跨作品误召回、
 * 中文别名、未命中时不硬凑、观察 JSON 补丁的正确性与幂等性。
 *
 * 跑法：node tests/smoke.mjs
 */
import { loadKb, kbInfo, resolveCharacter, resolveSeries, charactersOf, verifyTag, searchNames, patchSpec, buildPair, toTag, normalizeName, splitParen } from '../src/index.mjs';

const kb = loadKb();
let pass = 0;
const failures = [];
const ok = (cond, msg) => {
  if (cond) { pass++; return; }
  failures.push(msg);
  console.error(`  ✗ ${msg}`);
};
const eq = (a, b, msg) => ok(a === b, `${msg}（期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}）`);
const bestOf = (q, series) => resolveCharacter(q, { kb, series }).best;

console.log('== 1. 名称归一化 ==');
{
  eq(normalizeName('Hakurei_Reimu'), 'hakurei reimu', '下划线→空格 + 小写');
  eq(normalizeName('《原神》'), '原神', '书名号剥掉');
  eq(normalizeName('可莉（原神）'), '可莉 (原神)', '全角括号→半角');
  eq(toTag('hakurei_reimu'), 'hakurei reimu', '交付形态：下划线转空格');
  eq(toTag('klee_(genshin_impact)'), 'klee (genshin impact)', '交付形态：括号原样保留');
  const sp = splitParen('klee (genshin impact)');
  eq(sp.base, 'klee', '拆出主名');
  eq(sp.paren, 'genshin impact', '拆出括号');
}

console.log('== 2. 词库索引 ==');
{
  const info = kbInfo();
  ok(info.stats.characters > 5000, `角色条目够用（${info.stats.characters}）`);
  ok(info.stats.series > 1000, `作品条目够用（${info.stats.series}）`);
  ok(info.stats.withSeries > 2000, `能归到具体作品的角色够用（${info.stats.withSeries}）`);
  ok(info.stats.seriesZhAlias > 100, `作品中文别名生效（${info.stats.seriesZhAlias}）`);
  ok(info.topSeries.length > 0, '能列出角色最多的作品');
}

console.log('== 3. 中文角色名 → 标签 ==');
{
  const r = bestOf('博丽灵梦');
  eq(r.tag, 'hakurei reimu', '中文名精确命中');
  eq(r.series, 'touhou', '并给出作品归属');
  eq(bestOf('初音未来').tag, 'hatsune miku', '初音未来 → hatsune miku');
  eq(bestOf('雷电将军').tag, 'raiden shogun', '雷电将军 → raiden shogun');
  ok(!resolveCharacter('雷电将军', { kb }).candidates.some(c => c.tag === 'lightning farron'),
    '不混入其他作品的误召回（lightning farron 是最终幻想的）');
  eq(bestOf('可莉').tag, 'klee (genshin impact)', '可莉 → klee (genshin impact)');
  eq(bestOf('klee').tag, 'klee (genshin impact)', '英文写法同样命中');
}

console.log('== 4. 单字名与残条目 ==');
{
  eq(bestOf('空', '原神').tag, 'aether (genshin impact)', '单字「空」+ 原神 → aether');
  eq(bestOf('空', '蔚蓝档案').tag, 'sora (blue archive)', '同一个「空」+ 蔚蓝档案 → sora');
  eq(bestOf('胡桃').tag, 'hu tao (genshin impact)', '不带作品时也不被 freq=0 的残条目 hutao 抢走');
  eq(bestOf('喜多川海梦').tag, 'kitagawa marin', '同样避开 marin kitagawa 残条目');
  eq(bestOf('玛修').tag, 'mash kyrielight', '部分匹配（前缀）也能给出正确主条目');
}

console.log('== 5. 作品消歧（同名角色）==');
{
  eq(bestOf('星野', '少女与战车').tag, 'hoshino (girls und panzer)', '星野 + 少女与战车 → 战车版');
  eq(bestOf('星野', '蔚蓝档案').tag, 'hoshino (blue archive)', '星野 + 蔚蓝档案 → 档案版');
  const r = resolveCharacter('星野', { kb, series: '少女与战车' });
  ok(r.rejected.some(x => x.tag === 'hoshino (blue archive)'), '另一作品下的同名角色被明确排除并列出');
}

console.log('== 6. 作品名解析（含中文别名）==');
{
  eq(resolveSeries('原神', { kb }).best.tag, 'genshin impact', '原神 → genshin impact');
  eq(resolveSeries('少女与战车', { kb }).best.tag, 'girls und panzer', '人工别名：少女与战车');
  eq(resolveSeries('赛马娘', { kb }).best.tag, 'umamusume', '人工别名：赛马娘');
  eq(resolveSeries('蓝色档案', { kb }).best.tag, 'blue archive', '人工别名：蓝色档案（词库正式中文名是蔚蓝档案）');
  eq(resolveSeries('葬送的芙莉莲', { kb }).best.tag, 'sousou no frieren', '词库自带中文名');
  eq(resolveSeries('girls und panzer', { kb }).best.tag, 'girls und panzer', '英文写法');
  eq(resolveSeries('完全不存在的作品xyz', { kb }).best, null, '不存在的作品如实返回 null');
}

console.log('== 7. 名称里带作品（三种写法）==');
{
  eq(bestOf('《原神》的可莉').tag, 'klee (genshin impact)', '《原神》的可莉');
  eq(bestOf('原神的可莉').tag, 'klee (genshin impact)', '原神的可莉（无书名号）');
  eq(bestOf('可莉（原神）').tag, 'klee (genshin impact)', '可莉（原神）');
  eq(bestOf('klee (genshin impact)').tag, 'klee (genshin impact)', 'klee (genshin impact)');
}

console.log('== 8. 未命中不硬凑 ==');
{
  const r = resolveCharacter('浅仓南', { kb });
  eq(r.best, null, '库里没有的角色 → best 为 null');
  ok(r.notes.some(n => n.includes('词库里没有')), '明确说明库里没有，而不是给个相近的凑数');
  const built = buildPair('浅仓南', { kb });
  eq(built.ok, false, 'buildPair 也返回失败');
  eq(built.tags, '', '未命中时不给标签');
}

console.log('== 9. 显式作品查不到时报警 ==');
{
  const r = resolveCharacter('星野', { kb, series: '不存在的作品xyz' });
  eq(r.seriesFailed, true, '显式指定作品却查不到 → seriesFailed');
  ok(r.notes.some(n => n.includes('无法用它消歧')), '给出可读的警告');
  const r2 = resolveCharacter('星野', { kb, series: '蔚蓝档案' });
  eq(r2.seriesFailed, false, '正常作品不报警');
}

console.log('== 10. verify / search / series ==');
{
  const v = verifyTag('hakurei reimu', { kb });
  ok(v.found && v.kind === 'character', 'verify 认出角色标签');
  eq(v.series, 'touhou', '并给出作品归属');
  ok(verifyTag('klee (genshin impact)', { kb }).hasSeriesInTag, '识别「标签自带作品括号」');
  ok(verifyTag('definitely not a real tag', { kb }).found === false, '不存在的标签如实判否');
  ok(verifyTag('genshin_impact', { kb }).kind === 'series', '认得出作品标签（下划线写法也认）');

  const list = searchNames('灵梦', { kb });
  ok(list.some(x => x.tag === 'hakurei reimu'), 'search 命中博丽灵梦');
  const s = charactersOf('原神', { kb, limit: 5 });
  ok(s.total > 100, `series 列出该作品的角色（原神 ${s.total} 个）`);
  eq(s.characters.length, 5, 'limit 生效');
}

console.log('== 11. 观察 JSON 补丁 ==');
{
  const spec = {
    subject: { count: 1, gender: 'girl' },
    characters: ['可莉', 'klee'],
    series: ['原神'],
    appearance: { hair: 'blonde hair' }
  };
  const p = patchSpec(spec, { kb });
  eq(p.spec.characters.length, 1, '中文名与英文名解析成同一个角色 → 去重为 1 个');
  eq(p.spec.characters[0], 'klee (genshin impact)', '角色字段换成规范标签');
  eq(p.spec.series[0], 'genshin impact', '作品字段换成规范标签');
  eq(p.spec.appearance.hair, 'blonde hair', '其它字段原样保留');
  eq(p.changes.length, 3, '变更记录：角色 + 去重 + 作品');

  // 幂等：再跑一次不应该再改
  const p2 = patchSpec(p.spec, { kb });
  eq(p2.changes.length, 0, '幂等：已经是规范标签就不再改动');
  eq(p2.unresolved.length, 0, '没有待确认项');

  // series 为空时由角色归属补全
  const p3 = patchSpec({ characters: ['雷电将军'] }, { kb });
  eq(p3.spec.series[0], 'genshin impact', 'series 为空 → 由角色归属补全');
  eq(p3.changes.find(c => c.field === 'series').from, '(空)', '并记录为「由角色归属补全」');

  // 低置信不硬改
  const p4 = patchSpec({ characters: ['浅仓南'] }, { kb });
  eq(p4.spec.characters[0], '浅仓南', '未命中的角色原样保留');
  ok(p4.unresolved.length === 1, '并进 unresolved 让人确认');
}

console.log('');
if (failures.length) {
  console.error(`失败 ${failures.length} 项，通过 ${pass} 项`);
  process.exit(1);
}
console.log(`全部通过：${pass} 项断言`);
