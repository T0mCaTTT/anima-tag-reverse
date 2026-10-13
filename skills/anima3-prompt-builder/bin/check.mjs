#!/usr/bin/env node
/**
 * check.mjs —— Anima3 提示词校验器
 *
 * 把 SKILL.md 里那套「人工自检」变成可执行的机器检查，避免漏项：
 *   §2  OUTPUT PROTOCOL   —— 单行 / 小写 / 无 markdown / 无权重语法 / 禁光效词
 *   §3  FINAL SELF-CHECK  —— 质量词、画师标签、人数一致、互斥、重复、标签数区间
 *   §3.1 CONFLICT TABLE   —— 视角/身份/服装/动作/细节过度
 *   §4.2 TAG COUNT        —— 单人 20-36 / 双人 26-44 / 复杂 34-54
 *
 * 用法：
 *   node check.mjs "prompt 一行"            # 直接校验
 *   node check.mjs --file prompt.txt        # 从文件读
 *   echo "..." | node check.mjs -           # 从 stdin 读
 *   node check.mjs "..." --json             # 机器可读输出
 *
 * 退出码：0 = 全部通过；1 = 有 error；2 = 用法错误。
 * 零依赖，只用 Node 内置模块。
 */

import fs from 'node:fs';

// ---- §2 禁止输出的光效/色调词（lora 已内置） --------------------------------
// 允许的是「环境天气」（rain/snow/fog/steam），禁止的是「打光与色调」。
const FORBIDDEN_LIGHT = [
  'sunlight', 'moonlight', 'rim light', 'rim lighting', 'backlighting', 'backlight',
  'warm lighting', 'cool lighting', 'soft lighting', 'hard lighting', 'studio lighting',
  'cinematic lighting', 'dramatic lighting', 'volumetric lighting', 'god rays',
  'light rays', 'sunbeams', 'lens flare', 'bloom', 'glowing', 'glow', 'backlit',
  'sidelighting', 'side lighting', 'neon lights', 'neon lighting', 'warm colors', 'cool colors',
  'colorful', 'monochrome', 'sepia', 'golden hour', 'blue hour', 'chiaroscuro',
  'ambient occlusion', 'dappled sunlight', 'light particles', 'sunbeam',
];

// ---- 用户放行的光影标签（白名单，优先级高于禁令）----------------------------
// 用户拍板：这四条要在提示词里用，解除模板对它们的拦截。
// 注意：白名单是「精确整词」匹配 —— 不会连带放行 soft lighting 之类的其他光效词。
const LIGHT_WHITELIST = new Set([
  'soft lighting',
  'bloom',
  'bokeh',
  'gradient sky',
]);

// ---- §3.1 互斥表 -----------------------------------------------------------
const CONFLICTS = [
  // 视角互斥
  [['from front'], ['from behind'], '视角：正面 vs 背面'],
  [['from above'], ['from below'], '视角：俯视 vs 仰视'],
  [['looking at viewer', 'direct eye contact'], ['facing away'], '视线：看观众 vs 背对'],
  [['pov'], ['full body'], 'POV 看不到自己全身'],
  [['close-up'], ['full body'], '景别：特写 vs 全身'],
  // 身份互斥
  [['solo'], ['hetero', '1boy', 'yuri', '2girls', '2boys'], '单人不存在互动'],
  [['femdom'], ['male-on-female rape'], '主导方冲突'],
  [['sleeping', 'unconscious'], ['looking at viewer', 'direct eye contact'], '无意识不可能直视'],
  [['blindfold'], ['heart-shaped pupils', 'rolling eyes'], '蒙眼看不到眼睛'],
  // 服装互斥
  [['completely nude'], ['maid outfit', 'school uniform', 'sailor uniform', 'bunny suit', 'kimono', 'hanfu', 'latex bodysuit'], '全裸不穿衣'],
  [['pantyhose'], ['barefoot'], '穿丝袜不可能光脚（除非 torn pantyhose）'],
  [['blindfold'], ['glasses'], '蒙眼与眼镜物理冲突'],
  // 动作互斥
  [['standing sex'], ['lying', 'on back'], '体位矛盾'],
  [['missionary'], ['doggystyle'], '不可能同时两个体位'],
  [['cowgirl position'], ['prone bone'], '体位矛盾'],
  // 细节标签过度（同部位状态矛盾）
  [['spread toes'], ['toe scrunch', 'toes curling'], '脚趾舒展 vs 蜷缩'],
  [['spread toes'], ['feet together'], '分趾 vs 合拢'],
  [['spread fingers'], ['clenched fist', 'gripping'], '手指张开 vs 握拳'],
  [['bouncing breasts'], ['breasts squeeze together'], '弹跳 vs 挤压'],
  [['open mouth'], ['clenched teeth', 'closed mouth'], '张嘴 vs 闭嘴'],
  [['rolling eyes'], ['looking at viewer', 'direct eye contact'], '翻白眼 vs 直视'],
  [['spread legs'], ['legs together'], '腿分开 vs 并拢'],
];

// ---- §4.2 标签数区间（含质量词+画师） --------------------------------------
const COUNT_RANGES = {
  simple: [20, 36],     // 单人展示/诱惑/暴露/自慰
  standard: [26, 44],   // 双人性交/前戏
  complex: [34, 54],    // 多人/特殊主题/剧情
};

const QUALITY_BASE = ['masterpiece', 'best quality', 'highres'];
const QUALITY_EXTRA = ['newest', 'absurdres', 'high detail', 'detailed background', 'delicate illustration', 'very aesthetic'];
const SCORE_RE = /^score_\d+$/;
const ARTIST_RE = /^@.+/;

const TEMPLATE_HEADER_Q = /^质量词|^masterpiece/;

// ---- 解析 ------------------------------------------------------------------
function parsePrompt(raw) {
  const text = String(raw ?? '').trim();
  const tags = text.split(',').map(s => s.trim()).filter(Boolean);
  return { text, tags };
}

function findConflicts(tags) {
  const set = new Set(tags.map(t => t.toLowerCase()));
  const hits = [];
  for (const [a, b, why] of CONFLICTS) {
    const hasA = a.find(x => set.has(x));
    // 'solo' 与 '2girls' 这类：b 组里只要有一个存在就冲突
    const hasB = b.find(x => set.has(x));
    if (hasA && hasB) hits.push({ a: hasA, b: hasB, why });
  }
  return hits;
}

export function check(raw) {
  const { text, tags } = parsePrompt(raw);
  const lower = tags.map(t => t.toLowerCase());
  const errors = [];
  const warnings = [];
  const info = {};

  // §2 单行
  if (/[\r\n]/.test(String(raw ?? ''))) errors.push({ rule: '§2 行数', msg: '必须只有 1 行，不能包含换行' });

  // §2 无 markdown / 代码块
  if (/```|^\s*[-*#>]|\*\*/.test(text)) errors.push({ rule: '§2 输出形式', msg: '不能含 markdown / 代码块 / 列表符号' });

  // §2 无权重语法
  const weightHits = tags.filter(t => /\(.+:\s*[\d.]+\)|\{\}|\[|\]/.test(t));
  if (weightHits.length) errors.push({ rule: '§2 权重', msg: `禁止权重语法：${weightHits.slice(0, 3).join(' / ')}` });

  // §2 全小写（@画师名与 score_ 例外）
  const badCase = tags.filter(t => {
    if (ARTIST_RE.test(t) || SCORE_RE.test(t.toLowerCase())) return false;
    return t !== t.toLowerCase();
  });
  if (badCase.length) warnings.push({ rule: '§2 大小写', msg: `应为小写：${badCase.slice(0, 5).join(' / ')}` });

  // §3 检查项 0：质量词（最前，3-6 个）
  const firstSix = lower.slice(0, 6);
  const qCount = firstSix.filter(t => QUALITY_BASE.includes(t) || QUALITY_EXTRA.includes(t) || SCORE_RE.test(t)).length;
  info.qualityCount = qCount;
  if (qCount === 0) errors.push({ rule: '§3-0 质量词', msg: '开头缺少质量词（masterpiece/best quality/score_X 等）' });
  else if (qCount < 3) warnings.push({ rule: '§3-0 质量词', msg: `质量词仅 ${qCount} 个，模板要求 3-6 个` });
  const firstNonQuality = lower.findIndex(t => !QUALITY_BASE.includes(t) && !QUALITY_EXTRA.includes(t) && !SCORE_RE.test(t));
  if (qCount > 0 && firstNonQuality > 0 && firstNonQuality < qCount) {
    errors.push({ rule: '§3-0 质量词位置', msg: '质量词必须在最前，不能被打断' });
  }

  // §3 检查项 0b：画师标签（紧跟质量词）
  const artistIdx = lower.findIndex(t => ARTIST_RE.test(t));
  info.hasArtist = artistIdx >= 0;
  if (artistIdx < 0) errors.push({ rule: '§3-0b 画师', msg: '缺少 @画师名 标签（模板要求必填）' });
  else {
    const before = lower.slice(0, artistIdx).filter(t => !QUALITY_BASE.includes(t) && !QUALITY_EXTRA.includes(t) && !SCORE_RE.test(t));
    if (before.length) warnings.push({ rule: '§3-0b 画师位置', msg: `画师标签前出现非质量词：${before.join(' / ')}` });
  }

  // §2 禁止输出光线/光影/色调（白名单内的标签放行）
  const lightHits = lower.filter(t =>
    !LIGHT_WHITELIST.has(t) && FORBIDDEN_LIGHT.some(f => t === f || t.includes(f))
  );
  info.lightHits = lightHits;
  info.lightWhitelisted = lower.filter(t => LIGHT_WHITELIST.has(t));
  if (lightHits.length) errors.push({ rule: '§2 灯光禁令', msg: `禁止输出光效/色调标签：${lightHits.join(' / ')}` });

  // §3 检查项 3：重复标签
  // 先把权重语法剥掉再比对，否则 (blonde hair:1.2) 与 blonde hair 会被当成两个不同标签而漏检。
  const norm = lower.map(t => t.replace(/^\(+/, '').replace(/\)+$/, '').replace(/:\s*[\d.]+$/, '').trim());
  const seen = new Map();
  for (const t of norm) seen.set(t, (seen.get(t) || 0) + 1);
  const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([t]) => t);
  if (dupes.length) errors.push({ rule: '§3-3 重复标签', msg: `重复出现：${dupes.join(' / ')}` });

  // §3 检查项 1：人数一致性
  const girlN = lower.find(m => /^\d+girls?$/.test(m));
  const boyN = lower.find(m => /^\d+boys?$/.test(m));
  const numbered = [girlN, boyN].filter(Boolean);
  if (numbered.length) {
    const total = numbered.reduce((s, m) => s + parseInt(m, 10), 0);
    info.characterCount = total;
    // solo 只允许单女
    if (lower.includes('solo') && total > 1) {
      errors.push({ rule: '§3-1 人数一致', msg: `solo 与 ${total} 个角色矛盾` });
    }
    // group sex 要求 ≥3
    if (lower.includes('group sex') && total < 3) {
      errors.push({ rule: '§3-1 人数一致', msg: `group sex 需要 ≥3 人，当前 ${total}` });
    }
  } else if (!lower.includes('solo')) {
    warnings.push({ rule: '§3-1 人数一致', msg: '未找到人数标签（1girl / 2girls …）' });
  }

  // §3.1 互斥
  const conflicts = findConflicts(lower);
  info.conflicts = conflicts;
  for (const c of conflicts) errors.push({ rule: '§3.1 互斥', msg: `${c.a} × ${c.b} → ${c.why}` });

  // §3 检查项 6：标签总数区间
  const n = tags.length;
  info.tagCount = n;
  const cnt = info.characterCount || (lower.includes('solo') ? 1 : 0);
  const bucket = cnt <= 1 ? 'simple' : (cnt === 2 ? 'standard' : 'complex');
  const [lo, hi] = COUNT_RANGES[bucket];
  info.bucket = bucket;
  if (n < lo || n > hi) {
    warnings.push({ rule: '§4.2 标签数', msg: `${bucket} 档建议 ${lo}-${hi} 条，当前 ${n} 条` });
  }

  return {
    ok: errors.length === 0,
    tagCount: n,
    errors,
    warnings,
    info,
    tags,
  };
}

// ---- CLI -------------------------------------------------------------------
function main() {
  const argv = process.argv.slice(2);
  let input = '';
  let asJson = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') { asJson = true; continue; }
    if (a === '--file') { input = fs.readFileSync(argv[++i], 'utf8'); continue; }
    if (a === '-') { input = fs.readFileSync(0, 'utf8'); continue; }
    input += (input ? ' ' : '') + a;
  }

  if (!input.trim()) {
    console.error('用法：node check.mjs "prompt" [--json] | --file <path> | - < file');
    process.exit(2);
  }

  const r = check(input);

  if (asJson) { console.log(JSON.stringify(r, null, 2)); process.exit(r.ok ? 0 : 1); }

  console.log(`标签数：${r.tagCount}（${r.info.bucket} 档）｜ 质量词：${r.info.qualityCount} ｜ 画师：${r.info.hasArtist ? '有' : '无'}`);
  if (r.errors.length) {
    console.log(`\n❌ 错误 ${r.errors.length} 条：`);
    for (const e of r.errors) console.log(`  [${e.rule}] ${e.msg}`);
  }
  if (r.warnings.length) {
    console.log(`\n⚠️  警告 ${r.warnings.length} 条：`);
    for (const w of r.warnings) console.log(`  [${w.rule}] ${w.msg}`);
  }
  if (r.ok && !r.warnings.length) console.log('\n✅ 全部通过');
  else if (r.ok) console.log('\n✅ 无错误（有警告）');

  process.exit(r.ok ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
