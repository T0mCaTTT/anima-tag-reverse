#!/usr/bin/env node
/**
 * retarget-template.mjs —— 把 tag 模板里的「人物」换成任意目标角色
 *
 * 两种锚定模式：
 *
 *   ① 角色标签模式（推荐，支持 5713 个词库角色）
 *      用「作品 + 角色」自动解析成 Danbooru 规范标签。
 *      模型认识该角色，会自动画出她的发色/瞳色/服装/特征 —— 不需手工写外观。
 *      --character "可莉" --series "原神"
 *      --character "klee (genshin impact)" --series "genshin impact"
 *
 *   ② 手工锚定模式（原创角色 / 词库没有的角色）
 *      --character-tags "blue hair, blue eyes, fins, cetacean tail, ..." --char-name deepseek
 *
 * 共同行为：
 *   - 丢弃模板里的人物层（发色/瞳色/体型/非人特征）
 *   - 丢弃模板里的服装层（--keep-outfit 可保留）
 *   - 保留模板里的场景层（姿势/表情/镜头/液体/场景）
 *   - 自动修人数矛盾（模板有男方时删掉 solo）
 *
 * 用法：
 *   node retarget-template.mjs --template "..." --character "可莉" --series "原神"
 *   node retarget-template.mjs --file t.txt --character "suzuran" --series "arknights"
 *   node retarget-template.mjs --file t.txt --character-tags "blue hair, fins, cetacean tail" --char-name deepseek
 *   node retarget-template.mjs --file t.txt --character "..." --keep-outfit
 *   node retarget-template.mjs --list-chars
 */

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

// ---- 角色库定位 ------------------------------------------------------------
// 依次尝试：环境变量 → 同仓库的姊妹技能 → 本机 DSH 技能目录。
// 从本文件向上回溯到仓库根（含 skills/ 的那一层），因此克隆下来即可直接跑。
import { fileURLToPath } from 'node:url';

const __self = path.dirname(fileURLToPath(import.meta.url));

function repoRoot() {
  let d = __self;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(d, 'skills'))) return d;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return null;
}

const _root = repoRoot();
const CHAR_SKILL_CANDIDATES = [
  process.env.ANIMA_TAG_CHARACTER_DIR,
  _root && path.join(_root, 'skills/anima-tag-character'),
  path.join(process.env.HOME || '', '.dsh/skills/anima-tag-character'),
].filter(Boolean);

function findCharSkill() {
  for (const c of CHAR_SKILL_CANDIDATES) {
    if (fs.existsSync(path.join(c, 'bin/char.mjs'))) return c;
  }
  return null;
}

/** 用角色库把「作品+角色」解析成规范标签 */
function resolveCharacter(name, series) {
  const dir = findCharSkill();
  if (!dir) return null;
  try {
    const args = [path.join(dir, 'bin/char.mjs'), name, '--format', 'json'];
    if (series) args.push('--series', series);
    const out = execFileSync('node', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    const d = JSON.parse(out);
    if (!d.best) return null;
    // 置信度门槛：低于 0.85 视为「猜的」，宁可不用也不要乱凑角色
    // （实测「某个不存在的角色」会被模糊匹配成 multiple others，纯属噪声）
    if (typeof d.best.score === 'number' && d.best.score < 0.85) {
      return { low: true, guess: d.best.tag, zh: d.best.zh, score: d.best.score };
    }
    return { tag: d.best.tag, zh: d.best.zh, series: d.best.series, freq: d.best.freq };
  } catch { return null; }
}

// ---- 原创角色锚定（词库没有的角色）-----------------------------------------
// 数据放在 ../references/characters.json，新增角色改那里即可，不用动代码。
function loadBuiltin() {
  const here = path.dirname(new URL(import.meta.url).pathname);
  const cands = [
    process.env.REF_TAG_CHARACTERS,
    path.join(here, '../references/characters.json'),
  ].filter(Boolean);
  for (const f of cands) {
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      const out = {};
      for (const [k, v] of Object.entries(j)) {
        if (k.startsWith('_')) continue;           // 跳过说明字段
        out[k.toLowerCase()] = {
          appearance: v.appearance || v.tags || [],
          outfit: v.outfit || [],
          desc: v._desc || '',
        };
      }
      return out;
    } catch { /* 继续找 */ }
  }
  return {};
}
const BUILTIN = loadBuiltin();

// ---- 人物层词表（会被目标角色替换掉）---------------------------------------
const APPEARANCE_EXACT = new Set([
  '2girls', '3girls', 'multiple girls', 'girl',
  // 发
  'hair', 'long hair', 'short hair', 'very long hair', 'medium hair', 'twintails',
  'ponytail', 'braid', 'twin braids', 'side braid', 'bun', 'hime cut',
  'bangs', 'blunt bangs', 'hair between eyes', 'sidelocks', 'ahoge', 'messy hair',
  'hair bow', 'hair ribbon', 'hairband', 'hair ornament', 'hair intakes',
  'wavy hair', 'curly hair', 'straight hair', 'short twintails', 'low twintails',
  'hair bun', 'double bun', 'single braid', 'drill hair', 'twin drills',
  // 发色
  'white hair', 'black hair', 'blonde hair', 'golden hair', 'brown hair', 'grey hair',
  'gray hair', 'silver hair', 'pink hair', 'purple hair', 'green hair', 'orange hair',
  'red hair', 'light brown hair', 'dark blue hair', 'light blue hair', 'two-tone hair',
  'multicolored hair', 'gradient hair', 'streaked hair', 'colored inner hair',
  'blue hair', 'aqua hair', 'yellow hair',
  // 冷门发色（词库确认存在，易漏）
  'teal hair', 'turquoise hair', 'mint hair', 'cyan hair', 'navy blue hair',
  'platinum blonde hair', 'lavender hair', 'violet hair', 'light green hair',
  'dark green hair', 'light purple hair', 'dark purple hair', 'light pink hair',
  'hot pink hair', 'dark brown hair', 'chestnut hair', 'auburn hair',
  'light blonde hair', 'dark hair', 'split-color hair', 'rainbow hair',
  'lime hair', 'magenta hair', 'crimson hair',
  // 眼
  'eyes', 'blue eyes', 'red eyes', 'green eyes', 'purple eyes', 'yellow eyes',
  'golden eyes', 'pink eyes', 'black eyes', 'brown eyes', 'heterochromia',
  // 注意：眼睑状态（half-closed/closed/empty/open eyes）属于【神态】，不在此表 —— 换人时保留
  'heart-shaped pupils',
  'symbol-shaped pupils', 'rolling eyes', 'glowing eyes', 'slit pupils',
  // 体型肤色
  'large breasts', 'medium breasts', 'small breasts', 'flat chest', 'breasts',
  'huge breasts', 'gigantic breasts', 'slim', 'petite', 'curvy', 'thick thighs',
  'wide hips', 'collarbone', 'thighs', 'pale skin', 'dark skin',
  'tan', 'tanlines', 'shiny skin', 'wet skin', 'abs', 'muscular',
  'cleavage', 'heart symbol',
  'forehead mark', 'red marking', 'marking', 'red nails', 'nails', 'painted nails',
  // 年龄
  'loli', 'child', 'little girl', 'aged down', 'teenage', 'baby', 'toddler', 'chibi',
  // 非人特征
  'animal ears', 'fox ears', 'cat ears', 'rabbit ears', 'dog ears', 'kemonomimi',
  'fox tail', 'cat tail', 'multiple tails', 'fox girl', 'cat girl', 'rabbit girl',
  'dragon girl', 'dragon horns', 'dragon tail', 'pointed ears', 'horns', 'halo',
  'wings', 'angel wings', 'demon wings', 'crystal wings', 'head wings',
  'animal ear fluff', 'white fur', 'scales', 'fins', 'cetacean tail', 'fish tail',
  'elf', 'demon girl', 'monster girl', 'vampire',
  // 补漏
  'black hair', 'dark hair', 'white hair', 'silver hair', 'grey hair',
  'brown eyes', 'black eyes', 'blue eyes', 'green eyes',
  'thick eyebrows', 'eyebrows', 'eyelashes', 'mole', 'mole under eye',
  // 角色身份标签（通用）
  'virtual youtuber', 'indie virtual youtuber',
]);

// 服装层
const OUTFIT_EXACT = new Set([
  'maid', 'maid headdress', 'maid apron', 'apron', 'white apron', 'waist apron',
  'frilled apron', 'dress', 'white dress', 'blue dress', 'red dress', 'black dress',
  'frilled dress', 'layered dress', 'pleated skirt', 'skirt', 'miniskirt',
  'shirt', 'white shirt', 'black shirt', 'crop top', 'sweater', 'jacket', 'black jacket',
  'open jacket', 'school uniform', 'sailor dress', 'nun', 'veil', 'white veil',
  'lace veil', 'headpiece', 'robe', 'white robe', 'kimono', 'hanfu', 'leotard',
  'bunny suit', 'playboy bunny', 'latex bodysuit', 'catsuit', 'lingerie',
  'bra', 'white bra', 'panties', 'white panties', 'underwear', 'thong',
  'bow', 'blue bow', 'red bow', 'white bow', 'black bow', 'bowtie', 'blue bowtie',
  'ribbon', 'hair ribbon', 'neck ribbon', 'sash', 'belt', 'collar', 'choker',
  'neck bell', 'cuffs', 'thigh strap', 'garter belt', 'stockings',
  'socks', 'white socks', 'frilled socks', 'ankle socks', 'thighhighs',
  'white thighhighs', 'black thighhighs', 'kneehighs', 'pantyhose', 'white pantyhose',
  'fishnet pantyhose', 'shoes', 'blue shoes', 'mary janes', 'boots', 'loafers',
  'sneakers', 'detached sleeves', 'puffy sleeves', 'frilled sleeves',
  'long sleeves', 'short sleeves', 'sleeves', 'frills', 'lace', 'lace trim',
  'gold trim', 'ornate clothes', 'black footwear', 'gloves',
  'wet clothes', 'see-through', 'sheer clothes', 'open clothes', 'torn clothes',
  'bikini', 'red bikini', 'white bikini', 'black bikini', 'swimsuit', 'school swimsuit',
  'red ribbon', 'white ribbon', 'black ribbon',
]);

const RATING = new Set(['safe', 'sensitive', 'questionable', 'nsfw', 'explicit']);
const MALE_RE = /^(1boy|2boys|3boys|multiple boys|hetero|male|males|futanari|otoko no ko|femboy|trap)$/i;

// ---- 解析 ------------------------------------------------------------------
function parseArgs() {
  const a = process.argv.slice(2);
  const o = {
    template: '', file: '', character: '', series: '', charTags: '', charName: '',
    // 默认保留例图服装（用户拍板：服饰按例图拼，不按角色原设）
    keepOutfit: true, json: false, listChars: false,
  };
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    if (k === '--template') o.template = a[++i];
    else if (k === '--file') o.file = fs.readFileSync(a[++i], 'utf8');
    else if (k === '--character') o.character = a[++i];
    else if (k === '--series') o.series = a[++i];
    else if (k === '--character-tags') o.charTags = a[++i];
    else if (k === '--char-name') o.charName = a[++i];
    else if (k === '--keep-outfit') o.keepOutfit = true;
    else if (k === '--drop-outfit') o.keepOutfit = false;   // 反过来：丢弃例图服装
    else if (k === '--json') o.json = true;
    else if (k === '--list-chars') o.listChars = true;
  }
  return o;
}

const opt = parseArgs();

if (opt.listChars) {
  const entries = Object.entries(BUILTIN);
  if (!entries.length) {
    console.log('（锚定表为空）');
    console.log('在 references/characters.json 里登记原创角色即可。');
  } else {
    console.log('原创角色锚定表（references/characters.json）：');
    for (const [k, v] of entries) {
      console.log(`\n  ${k}${v.desc ? '  —— ' + v.desc : ''}`);
      console.log(`    外观 (${v.appearance.length} 条): ${v.appearance.join(', ')}`);
      if (v.outfit.length) console.log(`    服装 (${v.outfit.length} 条): ${v.outfit.join(', ')}`);
    }
  }
  console.log('\n其他角色直接用「作品+角色」，走角色库自动解析（5713 个角色）：');
  console.log('  --character "可莉" --series "原神"');
  console.log('  --character "suzuran" --series "arknights"');
  process.exit(0);
}

const rawTemplate = (opt.template || opt.file || '').trim();
if (!rawTemplate) {
  console.error('用法：node retarget-template.mjs --template "tag串" --character "可莉" --series "原神"');
  console.error('     node retarget-template.mjs --file t.txt --character "suzuran" --series "arknights"');
  console.error('     node retarget-template.mjs --file t.txt --character-tags "blue hair, fins" --char-name deepseek');
  console.error('     node retarget-template.mjs --list-chars');
  process.exit(2);
}

// ---- 先分类模板（需要先知道原图有没有衣服，才能决定锚定服装带不带）---------
const templateTags = rawTemplate.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
const kept = [];
const dropped = { appearance: [], outfit: [], rating: [] };

for (const t of templateTags) {
  const low = t.toLowerCase().replace(/_/g, ' ');
  if (RATING.has(low)) { dropped.rating.push(t); continue; }
  if (MALE_RE.test(low)) { kept.push(t); continue; }
  if (APPEARANCE_EXACT.has(low)) { dropped.appearance.push(t); continue; }
  // --keep-outfit：保留原图服装（不丢），直接进 kept
  if (OUTFIT_EXACT.has(low)) {
    if (opt.keepOutfit) { kept.push(t); }
    else { dropped.outfit.push(t); }
    continue;
  }
  kept.push(t);
}

// 原图是否「有衣服」：看模板里除了被丢弃的服装层之外，还有没有穿着状态的线索
// 全裸关键词：出现任一 → 判定原图为裸体，锚定服装一律不带
// 判定「原图是否裸体」只认【明确的裸露状态】，不认体液/部位。
// 踩过的坑：原来把 cum on body / navel / 体液类也算进来，
// 结果「穿女仆装 + 身上有精液」的图被误判成裸体，锚定服装被错误跳过。
const NUDE_MARKERS = new Set([
  'nude', 'completely nude', 'naked', 'bottomless', 'topless',
  'no bra', 'no panties', 'completely naked', 'full nude',
  'nude female', 'clothed male nude female',
]);
const templateLows = templateTags.map(t => t.toLowerCase().replace(/_/g, ' '));
const nakedSource = templateLows.some(t => NUDE_MARKERS.has(t));

// ---- 决定锚定模式 ----------------------------------------------------------
let charTags = [];          // 外观锚定（永远带入）
let charOutfit = [];        // 服装锚定（仅当原图有衣服时带入）
let charLabel = '';

if (opt.charTags) {
  charTags = opt.charTags.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
  charLabel = opt.charName || '自定义角色';
} else if (opt.character) {
  const low = opt.character.toLowerCase();
  if (BUILTIN[low] && !opt.series) {
    const b = BUILTIN[low];
    charTags = b.appearance ? b.appearance.slice() : (b.tags || []).slice();
    charOutfit = b.outfit ? b.outfit.slice() : [];
    charLabel = low + '（内置锚定）';
  } else {
    const r = resolveCharacter(opt.character, opt.series);
    if (r && r.low) {
      charTags = [opt.character, opt.series].filter(Boolean);
      charLabel = `${opt.character}（⚠ 角色库低置信，猜测为「${r.guess}」已忽略，按原样输出）`;
    } else if (r) {
      charTags = [r.tag, r.series].filter(Boolean);
      charLabel = `${r.tag}${r.zh ? '（' + r.zh + '）' : ''}`;
    } else {
      charTags = [opt.character, opt.series].filter(Boolean);
      charLabel = `${opt.character}（⚠ 角色库未收录，按原样输出）`;
    }
  }
} else {
  console.error('必须指定 --character 或 --character-tags。');
  process.exit(2);
}

// ---- 服装来源规则（用户拍板：服饰按例图拼，不按角色原设）--------------------
// 默认 keepOutfit=true   → 例图服装进 kept（原样保留），角色锚定服装一律不带
//      --drop-outfit     → 例图服装丢弃，此时才用角色锚定服装（或都没有）
// 特例：例图是裸体 → 例图本来就没衣服，锚定服装也不带（避免「裸体穿女仆装」）
let outfitSkipped = [];
if (opt.keepOutfit) {
  // 保留例图服装：角色锚定服装不带
  outfitSkipped = charOutfit.slice();
  charOutfit = [];
}
if (nakedSource) {
  // 例图裸体：即便用户想保留例图的"服装"，也本来就没有 → 锚定服装同样不带
  if (charOutfit.length) { outfitSkipped = outfitSkipped.concat(charOutfit); charOutfit = []; }
}

// ---- 组装 ------------------------------------------------------------------
const seen = new Set();
const out = [];
const push = (t) => { const k = t.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(t); } };

for (const t of charTags) push(t);
for (const t of charOutfit) push(t);
for (const t of kept) push(t);

const rating = dropped.rating.find(r => r === 'explicit') || dropped.rating.find(r => r === 'nsfw') || '';
const hasMale = templateTags.some(t => MALE_RE.test(t.toLowerCase().replace(/_/g, ' ').trim()));

// 人数一致性：
//   有男方 → 不补 solo（否则「单人 + 男方」自相矛盾，模型会漏画男方）
//   无男方 → 补 1girl + solo
let soloBlocked = false;
if (hasMale) {
  const idx = out.findIndex(t => t.toLowerCase() === 'solo');
  if (idx >= 0) out.splice(idx, 1);
  soloBlocked = true;          // 无论原本有没有 solo，都标记「已确保无 solo」
} else {
  if (!out.some(t => /^\d*girls?$/i.test(t))) out.unshift('1girl');
  if (!out.some(t => t.toLowerCase() === 'solo')) {
    const i = out.findIndex(t => t.toLowerCase() === '1girl');
    out.splice(i + 1, 0, 'solo');
  }
}
const removedSolo = soloBlocked;

if (rating) out.unshift(rating);

if (opt.json) {
  console.log(JSON.stringify({
    character: charLabel, characterTags: charTags, characterOutfit: charOutfit,
    outfitSkipped, nakedSource, rating,
    droppedAppearance: dropped.appearance, droppedOutfit: dropped.outfit,
    keptFromTemplate: kept, removedSolo, result: out,
  }, null, 2));
} else {
  console.log(out.join(', '));
  console.error('\n[替换报告]');
  console.error(`  目标角色：${charLabel}`);
  console.error(`  角色锚定·外观：${charTags.length} 条 → ${charTags.join(', ')}`);
  if (charOutfit.length) {
    console.error(`  角色锚定·服装：${charOutfit.length} 条 → ${charOutfit.join(', ')}`);
  } else if (outfitSkipped.length) {
    console.error(`  ⚠ 原图判定为裸体 → 已跳过锚定服装 ${outfitSkipped.length} 条（避免「裸体却穿女仆装」的矛盾）`);
    console.error(`    ${outfitSkipped.join(', ')}`);
  }
  console.error(`  丢弃·人物层：${dropped.appearance.length} 条`);
  if (dropped.appearance.length) console.error(`    ${dropped.appearance.join(', ')}`);
  console.error(`  丢弃·服装层：${dropped.outfit.length} 条${opt.keepOutfit ? '（--keep-outfit 已关闭）' : ''}`);
  if (dropped.outfit.length && !opt.keepOutfit) console.error(`    ${dropped.outfit.join(', ')}`);
  console.error(`  保留·模板其余：${kept.length} 条`);
  if (removedSolo) console.error('  ⚠ 模板含男方，已删除 solo');
  console.error(`  分级：${rating || '无'}`);
  console.error(`  结果：${out.length} 条`);
}
