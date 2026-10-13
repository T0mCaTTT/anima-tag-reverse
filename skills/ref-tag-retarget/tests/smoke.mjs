#!/usr/bin/env node
/**
 * smoke.mjs —— ref-tag-retarget 回归测试
 * 跑法：node tests/smoke.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.join(HERE, '..');
const BIN = (n) => path.join(ROOT, 'bin', n);

function run(script, args) {
  try {
    return { out: execFileSync('node', [BIN(script), ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 8 << 20 }), code: 0 };
  } catch (e) {
    return { out: (e.stdout || '') + (e.stderr || ''), code: e.status ?? 1 };
  }
}

let pass = 0, fail = 0;
const t = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`[通过] ${name}`); }
  else { fail++; console.log(`[失败] ${name}${detail ? '：' + detail : ''}`); }
};

// ---- 1. retarget-template：角色库模式 --------------------------------------
{
  const r = run('retarget-template.mjs', [
    '--template', 'explicit, 1girl, white hair, red eyes, ahegao, cum in pussy, on bed',
    '--character', '可莉', '--series', '原神', '--json',
  ]);
  let d = null;
  try { d = JSON.parse(r.out); } catch {}
  t('角色库模式 · 输出合法 JSON', !!d);
  t('角色库模式 · 解析出 klee', d?.characterTags?.includes('klee (genshin impact)'), JSON.stringify(d?.characterTags));
  t('角色库模式 · 带上作品', d?.characterTags?.includes('genshin impact'));
  t('角色库模式 · 丢弃白发', d?.droppedAppearance?.includes('white hair'));
  t('角色库模式 · 保留 ahegao', d?.result?.includes('ahegao'));
  t('角色库模式 · 保留 cum in pussy', d?.result?.includes('cum in pussy'));
}

// ---- 2. 中文角色名 --------------------------------------------------------
{
  const cases = [
    ['铃兰', '明日方舟', 'suzuran (arknights)'],
    ['芙兰朵露', '东方', 'flandre scarlet'],
    ['雷电将军', '原神', 'raiden shogun'],
  ];
  for (const [n, s, expect] of cases) {
    const r = run('retarget-template.mjs', ['--template', '1girl, ahegao', '--character', n, '--series', s, '--json']);
    let d = null; try { d = JSON.parse(r.out); } catch {}
    t(`中文角色 · ${n} → ${expect}`, d?.characterTags?.includes(expect), JSON.stringify(d?.characterTags));
  }
}

// ---- 3. 裸体图不带锚定服装 -------------------------------------------------
{
  const r = run('retarget-template.mjs', [
    '--template', 'explicit, 1girl, 1boy, hetero, completely nude, nipples, cum in pussy, pov',
    '--character', 'deepseek', '--json',
  ]);
  let d = null; try { d = JSON.parse(r.out); } catch {}
  t('裸体图 · 判定为 nakedSource', d?.nakedSource === true);
  t('裸体图 · 跳过锚定服装', (d?.outfitSkipped?.length || 0) > 0);
  t('裸体图 · 结果不含 maid', !d?.result?.includes('maid'));
  t('裸体图 · 保留蓝发（外观仍带入）', d?.result?.includes('blue hair'));
}

// ---- 4. 有衣服的图带锚定服装 -----------------------------------------------
{
  const r = run('retarget-template.mjs', [
    '--template', 'explicit, 1girl, white hair, ahegao, on bed',
    '--character', 'deepseek', '--json',
  ]);
  let d = null; try { d = JSON.parse(r.out); } catch {}
  t('穿衣图 · 未判为裸体', d?.nakedSource === false);
  // 新规则（用户拍板）：默认保留例图服装，角色锚定服装不带
  t('穿衣图 · 默认不带锚定女仆装（服饰按例图）', !d?.result?.includes('maid'));
  t('穿衣图 · 锚定服装被记录为跳过', (d?.outfitSkipped?.length || 0) > 0);
}

// ---- 4b. --drop-outfit 时才用锚定服装 --------------------------------------
{
  const r = run('retarget-template.mjs', [
    '--template', 'explicit, 1girl, white hair, ahegao, on bed',
    '--character', 'deepseek', '--drop-outfit', '--json',
  ]);
  let d = null; try { d = JSON.parse(r.out); } catch {}
  t('--drop-outfit · 带上锚定女仆装', d?.result?.includes('maid'));
  t('--drop-outfit · 带上白围裙', d?.result?.includes('white apron'));
}

// ---- 4c. 例图服装默认保留 --------------------------------------------------
{
  const r = run('retarget-template.mjs', [
    '--template', '1girl, blonde hair, white dress, white thighhighs, sitting',
    '--character', '铃兰', '--series', '明日方舟', '--json',
  ]);
  let d = null; try { d = JSON.parse(r.out); } catch {}
  t('例图服装 · 默认保留 white dress', d?.result?.includes('white dress'));
  t('例图服装 · 默认保留 white thighhighs', d?.result?.includes('white thighhighs'));
  t('例图服装 · 人物层仍被替换', !d?.result?.includes('blonde hair'));
}

// ---- 5. 人数一致性 --------------------------------------------------------
{
  const r = run('retarget-template.mjs', [
    '--template', '1girl, 1boy, hetero, ahegao',
    '--character', '可莉', '--series', '原神', '--json',
  ]);
  let d = null; try { d = JSON.parse(r.out); } catch {}
  t('人数 · 有男方时删除 solo', d?.removedSolo === true);
  t('人数 · 保留 1boy', d?.result?.includes('1boy'));
  t('人数 · 保留 hetero', d?.result?.includes('hetero'));
}

// ---- 6. 低置信角色不瞎凑 ---------------------------------------------------
{
  const r = run('retarget-template.mjs', [
    '--template', '1girl, ahegao',
    '--character', 'zzz不存在的角色xyz', '--series', 'none', '--json',
  ]);
  let d = null; try { d = JSON.parse(r.out); } catch {}
  t('低置信 · 原样输出角色名', d?.characterTags?.some(x => x.includes('zzz不存在')), JSON.stringify(d?.characterTags));
  t('低置信 · 不采用瞎凑结果', d?.characterLabel !== 'multiple others' && !d?.characterTags?.includes('multiple others'));
}

// ---- 7. tag-doctor 陷阱检测 -----------------------------------------------
{
  const r = run('tag-doctor.mjs', ['creampie, hands clasped, climax', '--json']);
  let d = null; try { d = JSON.parse(r.out); } catch {}
  t('tag-doctor · 输出 JSON', !!d);
  t('tag-doctor · 检出 creampie', d?.results?.some(x => x.tag === 'creampie' && x.status === 'trap'));
  t('tag-doctor · 检出 hands clasped', d?.results?.some(x => x.tag === 'hands clasped' && x.status === 'trap'));
  t('tag-doctor · 检出 climax', d?.results?.some(x => x.tag === 'climax' && x.status === 'trap'));
}

// ---- 8. tag-doctor 正常标签不误报 ------------------------------------------
{
  const r = run('tag-doctor.mjs', ['palms together, orgasm, cum in pussy, foot focus', '--json']);
  let d = null; try { d = JSON.parse(r.out); } catch {}
  t('tag-doctor · 正常标签全通过', d?.ok === 4, JSON.stringify(d));
  t('tag-doctor · 无陷阱', d?.traps === 0);
}

// ---- 8b. tag-doctor 颜文字标签（直读词库，不走检索器）-----------------------
{
  const r = run('tag-doctor.mjs', [':d, :3, :p, :<, ;d, ^^^, >_<', '--json']);
  let d = null; try { d = JSON.parse(r.out); } catch {}
  t('颜文字 · 输出 JSON', !!d);
  t('颜文字 · :d 命中', d?.results?.some(x => x.tag === ':d' && x.status === 'ok'), JSON.stringify(d?.results));
  t('颜文字 · :3 命中', d?.results?.some(x => x.tag === ':3' && x.status === 'ok'));
  t('颜文字 · :p 命中', d?.results?.some(x => x.tag === ':p' && x.status === 'ok'));
  t('颜文字 · 无未收录', d?.missing === 0, 'missing=' + d?.missing);
  t('颜文字 · 带频次信息', d?.results?.find(x => x.tag === ':d')?.freq === '862.0k');
}

// ---- 8c. 神态自检 ---------------------------------------------------------
{
  const r1 = run('tag-doctor.mjs', [':3, half-closed eyes, embarrassed, blush', '--expression-check', '--quiet']);
  t('神态 · 完整时不报警', !r1.out.includes('很可能漏了神态'), r1.out.slice(-200));

  const r2 = run('tag-doctor.mjs', ['1girl, lying, on bed', '--expression-check', '--quiet']);
  t('神态 · 嘴眼全缺时报警', r2.out.includes('既无嘴型也无眼型'));

  const r2b = run('tag-doctor.mjs', ['>_<, @ @, u_u', '--expression-check', '--quiet']);
  t('神态 · 纯眼型可通过（不报错误）', !r2b.out.includes('既无嘴型也无眼型'));

  const r2c = run('tag-doctor.mjs', ['> <, u u', '--quiet']);
  t('神态 · 空格写法给出下划线提示', r2c.out.includes('下划线连接') && !r2c.out.includes('>_<\n    → 词库写法'));
  const r2d = run('tag-doctor.mjs', ['>_<', '--quiet']);
  t('神态 · 正确写法不误伤', /陷阱 0/.test(r2d.out) && r2d.code === 0, r2d.out.slice(0, 120));

  const r3 = run('tag-doctor.mjs', ['grin, calm', '--expression-check', '--quiet']);
  t('神态 · calm 被识别为陷阱', r3.out.includes('不存在'));

  // 退出码
  const r4 = run('tag-doctor.mjs', ['1girl, lying', '--expression-check', '--quiet']);
  t('神态 · 缺嘴型退出码为 1', r4.code === 1, 'code=' + r4.code);
  const r5 = run('tag-doctor.mjs', [':d, blush', '--expression-check', '--quiet']);
  t('神态 · 完整退出码为 0', r5.code === 0, 'code=' + r5.code);
}

// ---- 8d. 冷门发色识别 -----------------------------------------------------
{
  const cold = ['teal hair','aqua hair','turquoise hair','mint hair','lavender hair',
                'platinum blonde hair','chestnut hair','auburn hair','split-color hair','rainbow hair'];
  for (const c of cold) {
    const r = run('retarget-template.mjs', [
      '--template', `1girl, ${c}, :3, smile, white dress`,
      '--character-tags', 'suzuran (arknights)', '--char-name', '测试', '--json',
    ]);
    let d = null; try { d = JSON.parse(r.out); } catch {}
    t(`冷门发色 · ${c} 被丢弃`, d?.droppedAppearance?.includes(c), JSON.stringify(d?.droppedAppearance));
  }
}

// ---- 9. 锚定表可读 --------------------------------------------------------
{
  const r = run('retarget-template.mjs', ['--list-chars']);
  t('锚定表 · 列出 deepseek', r.out.includes('deepseek'));
  t('锚定表 · 分外观/服装两层', r.out.includes('外观') && r.out.includes('服装'));
}

// ---- 10. 清理工具 ---------------------------------------------------------
{
  const dir = '/tmp/ref-tag-cleanup-test';
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.jpg'), 'x'.repeat(2048));
  fs.writeFileSync(path.join(dir, 'b.png'), 'x'.repeat(2048));
  fs.writeFileSync(path.join(dir, 'manifest.json'), '[]');
  run('pixiv-cleanup.mjs', ['--dir', dir]);
  const left = fs.readdirSync(dir);
  t('清理 · 图片已删', !left.includes('a.jpg') && !left.includes('b.png'), JSON.stringify(left));
  t('清理 · 清单保留', left.includes('manifest.json'));
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
