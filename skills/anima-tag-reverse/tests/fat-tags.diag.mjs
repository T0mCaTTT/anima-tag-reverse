// fat-tags.diag.mjs — 诊断工具（非断言套件）：文本入口「变胖标签」A/B 测量
//
// 用途：同一份语料分别过「旧快照 bin/rtag.mjs」与「当前仓库 bin/rtag.mjs」，
//       固定默认档（不加 --broad / --gaps / --rating），记录两边完整标签串，
//       对结果不同的条目再取一次 --format json 作为机制层证据（reason/sim/score/fromClauses）。
//
// 读侧：只读调用两个 CLI，不 import 双方源码，也不改任何文件（输出目录除外）。
//
// 用法：
//   node tests/fat-tags.diag.mjs --out <输出目录>
//   可选：--old <旧快照目录> --new <当前技能目录> --kb <画师类词库目录> --limit <N>
// 默认：
//   --old  <旧快照目录，例：用户主目录/.dsh/skill-backups/anima-tag-reverse-<时间戳>（必须显式传）
//   --new  本文件上一级目录（技能根）
//   --kb   <技能根>/../../anima-tag-kb/画师类（旧快照必须显式传 --kb，否则它的默认解析会失败）
//
// 输出：
//   <out>/fat-tags-audit.json   原始测量数据（含 JSON 明细）
//   <out>/fat-tags-table.md     中文表格（输入 / 旧标签 / 新标签 / 新增 / 减少 / 堆叠）
//   另在 stdout 打印一行摘要 + 归档校验结果。

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OLD = 'C:\\Users\\admin\\.dsh\\skill-backups\\anima-tag-reverse-1791357152044';
const DEFAULT_KB = resolve(SKILL_DIR, '..', '..', 'anima-tag-kb', '画师类');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const OLD_DIR = resolve(String(args.old || DEFAULT_OLD));
const NEW_DIR = resolve(String(args['new'] || SKILL_DIR));
const KB_DIR = resolve(String(args.kb || DEFAULT_KB));
const OUT_DIR = resolve(String(args.out || join(SKILL_DIR, 'tests', '.fat-tags-out')));
const LIMIT = args.limit ? Number(args.limit) : 0;

// ---------------------------------------------------------------------------
// 语料：smoke.mjs 全部文本用例 + 16:35 归档输入 + 高频中文/英文词
// expectOld 只在「16:35 归档真值」条目上给，用于校验旧快照 == 归档行为。
// ---------------------------------------------------------------------------
const CORPUS = [
  // --- smoke.mjs 的 18 条不重复文本输入 ---
  { id: 'smoke-01', group: 'smoke', text: '长发蓝发少女坐在教室里看书，夜晚，逆光，不要眼镜' },
  { id: 'smoke-02', group: 'smoke', text: '一个穿白色连衣裙的银发女孩站在樱花树下，微笑，侧脸' },
  { id: 'smoke-03', group: 'smoke', text: '双马尾' },
  { id: 'smoke-04', group: 'smoke', text: '两个女孩，一个男孩' },
  { id: 'smoke-05', group: 'smoke', text: '三男两女' },
  { id: 'smoke-06', group: 'smoke', text: '一个女孩站在阳台上' },
  { id: 'smoke-07', group: 'smoke', text: '1girl, long blue hair, sitting on a chair, reading a book in the classroom at night, backlighting, no glasses' },
  { id: 'smoke-08', group: 'smoke', text: 'twintails, blue eyes, school uniform, standing, holding a sword' },
  { id: 'smoke-09', group: 'smoke', text: 'twintail, blu hair, standing' },
  { id: 'smoke-10', group: 'smoke', text: '青い髪の長髪の少女が夜の教室で本を読んでいる、逆光' },
  { id: 'smoke-11', group: 'smoke', text: '两个裸体女高中生在床上做爱，露骨，高潮' },
  { id: 'smoke-12', group: 'smoke', text: '触手侵犯，血腥猎奇，断肢，内脏' },
  { id: 'smoke-13', group: 'smoke', text: '女高中生' },
  { id: 'smoke-14', group: 'smoke', text: '两个人，雨中，一个男孩一个女孩，撑伞' },
  { id: 'smoke-15', group: 'smoke', text: '银色长发的女孩坐在窗边，夕阳' },
  { id: 'smoke-16', group: 'smoke', text: '站在那里' },
  { id: 'smoke-17', group: 'smoke', text: '一个女孩，白天，夜晚，长发，短发' },
  { id: 'smoke-18', group: 'smoke', text: '一个银发蓝眼的女孩穿着白色连衣裙站在樱花树下，微笑，侧脸，上半身，白天' },

  // --- 16:35 归档真值（旧输出已记录，用于校验旧快照 == 归档行为） ---
  { id: 'arc-01', group: '归档', text: 'sailor dress', expectOld: 'sailor dress, dress' },
  { id: 'arc-02', group: '归档', text: '蓝白条纹水手服', expectOld: 'sailor shirt' },
  { id: 'arc-03', group: '归档', text: 'blu hair', expectOld: 'blue hair' },
  { id: 'arc-04', group: '归档', text: 'red eyes', expectOld: 'red eyes' },
  { id: 'arc-05', group: '归档', text: '黑色和服', expectOld: 'black kimono' },
  { id: 'arc-06', group: '归档', text: '和服', expectOld: 'kimono' },
  { id: 'arc-07', group: '归档', text: '2girls', expectOld: '2girls' },
  { id: 'arc-08', group: '归档', text: '两个人', expectOld: 'heart hands duo' },
  { id: 'arc-09', group: '归档', text: 'women', expectOld: '' },
  { id: 'arc-10', group: '归档', text: 'schoolgirl', expectOld: 'school' },
  { id: 'arc-11', group: '归档', text: '微笑', expectOld: 'smile' },
  { id: 'arc-12', group: '归档', text: '高潮', expectOld: 'nsfw, orgasm' },
  { id: 'arc-13', group: '归档', text: '低角度仰拍', expectOld: 'low horns, from below' },
  { id: 'arc-14', group: '归档', text: '裸体', expectOld: 'naked' },
  { id: 'arc-15', group: '归档', text: '不要眼镜，不要帽子，一个女孩站在阳台', expectOld: '1girl, balcony' },
  { id: 'arc-16', group: '归档', text: '画师风格，by dairi，银发少女坐在教室窗边', expectOld: 'girl, @dairi, sitting, classroom, silver hair' },
  { id: 'arc-17', group: '归档', text: '低角度仰拍，霓虹街区，雨夜', expectOld: 'low horns, from below, rain' },
  { id: 'arc-18', group: '归档', text: '2girls，两人在浴室，裸体，泳装', expectOld: '2girls, swimsuit, naked, bathroom' },
  { id: 'arc-19', group: '归档', text: '@dairi | @haruyama kazunori', expectOld: '@dairi, @haruyama kazunori' },
  { id: 'arc-20', group: '归档', text: 'by dairi', expectOld: '@dairi' },

  // --- 高频词：表情 ---
  { id: 'w-face-01', group: '表情', text: '微笑' },
  { id: 'w-face-02', group: '表情', text: '哭泣' },
  { id: 'w-face-03', group: '表情', text: '生气' },
  { id: 'w-face-04', group: '表情', text: '害羞' },
  { id: 'w-face-05', group: '表情', text: '惊讶' },
  { id: 'w-face-06', group: '表情', text: '大笑' },
  { id: 'w-face-07', group: '表情', text: '脸红' },
  { id: 'w-face-08', group: '表情', text: '皱眉' },
  { id: 'w-face-09', group: '表情', text: '闭眼' },

  // --- 高频词：服装 ---
  { id: 'w-wear-01', group: '服装', text: '和服' },
  { id: 'w-wear-02', group: '服装', text: '水手服' },
  { id: 'w-wear-03', group: '服装', text: '校服' },
  { id: 'w-wear-04', group: '服装', text: '黑丝' },
  { id: 'w-wear-05', group: '服装', text: '过膝袜' },
  { id: 'w-wear-06', group: '服装', text: '连衣裙' },
  { id: 'w-wear-07', group: '服装', text: '泳装' },
  { id: 'w-wear-08', group: '服装', text: '猫耳' },
  { id: 'w-wear-09', group: '服装', text: '眼镜' },
  { id: 'w-wear-10', group: '服装', text: '领带' },
  { id: 'w-wear-11', group: '服装', text: '高跟鞋' },
  { id: 'w-wear-12', group: '服装', text: '女仆装' },

  // --- 高频词：发型 ---
  { id: 'w-hair-01', group: '发型', text: '双马尾' },
  { id: 'w-hair-02', group: '发型', text: '长发' },
  { id: 'w-hair-03', group: '发型', text: '短发' },
  { id: 'w-hair-04', group: '发型', text: '银发' },
  { id: 'w-hair-05', group: '发型', text: '单马尾' },
  { id: 'w-hair-06', group: '发型', text: '卷发' },
  { id: 'w-hair-07', group: '发型', text: '齐刘海' },
  { id: 'w-hair-08', group: '发型', text: '呆毛' },
  { id: 'w-hair-09', group: '发型', text: '金发' },

  // --- 高频词：动作 ---
  { id: 'w-act-01', group: '动作', text: '坐' },
  { id: 'w-act-02', group: '动作', text: '站' },
  { id: 'w-act-03', group: '动作', text: '跑' },
  { id: 'w-act-04', group: '动作', text: '跳' },
  { id: 'w-act-05', group: '动作', text: '看书' },
  { id: 'w-act-06', group: '动作', text: '撑伞' },
  { id: 'w-act-07', group: '动作', text: '握剑' },
  { id: 'w-act-08', group: '动作', text: '睡觉' },
  { id: 'w-act-09', group: '动作', text: '拥抱' },
  { id: 'w-act-10', group: '动作', text: '举手' },

  // --- 高频词：场景 ---
  { id: 'w-scene-01', group: '场景', text: '教室' },
  { id: 'w-scene-02', group: '场景', text: '窗边' },
  { id: 'w-scene-03', group: '场景', text: '逆光' },
  { id: 'w-scene-04', group: '场景', text: '黄昏' },
  { id: 'w-scene-05', group: '场景', text: '樱花' },
  { id: 'w-scene-06', group: '场景', text: '阳台' },
  { id: 'w-scene-07', group: '场景', text: '雨中' },
  { id: 'w-scene-08', group: '场景', text: '夜晚' },
  { id: 'w-scene-09', group: '场景', text: '室内' },
  { id: 'w-scene-10', group: '场景', text: '天空' },

  // --- 高频词：物件 ---
  { id: 'w-obj-01', group: '物件', text: '猫' },
  { id: 'w-obj-02', group: '物件', text: '书' },
  { id: 'w-obj-03', group: '物件', text: '剑' },
  { id: 'w-obj-04', group: '物件', text: '花' },
  { id: 'w-obj-05', group: '物件', text: '伞' },
  { id: 'w-obj-06', group: '物件', text: '蝴蝶结' },

  // --- 高频词：画师 ---
  { id: 'w-art-01', group: '画师', text: '画师风格' },
  { id: 'w-art-02', group: '画师', text: 'by dairi' },
  { id: 'w-art-03', group: '画师', text: '@dairi' },

  // --- 组合句：堆叠现象的直接观察面 ---
  { id: 'c-01', group: '组合', text: '微笑着的女孩' },
  { id: 'c-02', group: '组合', text: '少女微笑' },
  { id: 'c-03', group: '组合', text: '害羞的微笑' },
  { id: 'c-04', group: '组合', text: '银发少女微笑' },
  { id: 'c-05', group: '组合', text: '女孩在笑' },
  { id: 'c-06', group: '组合', text: '微笑的女孩，侧脸，长发' },

  // --- 英文对照（同义词堆叠是否跨语言一致） ---
  { id: 'e-01', group: '英文', text: 'smile' },
  { id: 'e-02', group: '英文', text: 'smiling girl' },
  { id: 'e-03', group: '英文', text: 'light smile' },
  { id: 'e-04', group: '英文', text: 'girl is smiling' },
];

// ---------------------------------------------------------------------------
// 跑 CLI
// ---------------------------------------------------------------------------
function runCli(dir, format, text, extra = []) {
  const cli = join(dir, 'bin', 'rtag.mjs');
  const argv = [cli, '--kb', KB_DIR, '--format', format, ...extra, text];
  const r = spawnSync(process.execPath, argv, { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return {
    status: r.status,
    stdout: (r.stdout || '').replace(/\r\n/g, '\n'),
    stderr: (r.stderr || '').replace(/\r\n/g, '\n'),
  };
}

function tagsLine(res) {
  const line = String(res.stdout || '').split('\n').find((l) => l.trim() !== '');
  return line === undefined ? '' : line.trim();
}

function tagsOf(line) {
  return line === '' ? [] : line.split(',').map((t) => t.trim()).filter(Boolean);
}

function parseJson(res) {
  try {
    return JSON.parse(res.stdout);
  } catch {
    return null;
  }
}

function flattenTags(json) {
  const out = [];
  for (const layer of json?.positive?.layers || []) {
    for (const t of layer.tags || []) {
      out.push({
        tag: t.tag,
        score: t.score,
        sim: t.sim,
        reason: t.reason,
        freq: t.freq,
        layer: layer.layer,
        layerName: layer.name,
        big: t.big,
        category: t.category,
        sub: t.sub,
        official: t.official,
        fromClauses: t.fromClauses,
      });
    }
  }
  return out;
}

// 同义词堆叠：在一侧的标签集合里找「共享词根」的簇（>=2 条），返回簇列表。
function stackClusters(tags) {
  const groups = new Map();
  for (const tag of tags) {
    for (const word of tag.split(/\s+/)) {
      if (word.length < 4 && !/[a-z]{4,}/.test(word)) continue;
      if (!groups.has(word)) groups.set(word, new Set());
      groups.get(word).add(tag);
    }
  }
  const clusters = [];
  for (const [word, set] of groups) {
    if (set.size >= 2) clusters.push({ stem: word, tags: [...set].sort() });
  }
  // 去掉被更大簇完全包含的簇
  const uniq = [];
  for (const c of clusters) {
    const key = c.tags.join('|');
    if (!uniq.some((u) => u.key === key)) uniq.push({ key, stem: c.stem, tags: c.tags });
  }
  return uniq.map(({ stem, tags: ts }) => ({ stem, tags: ts }));
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
const runOne = (item) => {
  const oldTags = runCli(OLD_DIR, 'tags', item.text);
  const newRes = runCli(NEW_DIR, 'tags', item.text);
  const oldLine = tagsLine(oldTags);
  const newLine = tagsLine(newRes);
  const oldArr = tagsOf(oldLine);
  const newArr = tagsOf(newLine);
  const oldSet = new Set(oldArr);
  const newSet = new Set(newArr);
  const added = newArr.filter((t) => !oldSet.has(t));
  const removed = oldArr.filter((t) => !newSet.has(t));
  const rec = {
    id: item.id,
    group: item.group,
    text: item.text,
    oldStatus: oldTags.status,
    newStatus: newRes.status,
    oldLine,
    newLine,
    oldTags: oldArr,
    newTags: newArr,
    added,
    removed,
    oldCount: oldArr.length,
    newCount: newArr.length,
    same: oldLine === newLine,
    stackOld: stackClusters(oldArr),
    stackNew: stackClusters(newArr),
    expectOld: item.expectOld,
    archiveOk: item.expectOld === undefined ? null : oldLine === item.expectOld,
  };
  if (!rec.same) {
    const oj = parseJson(runCli(OLD_DIR, 'json', item.text));
    const nj = parseJson(runCli(NEW_DIR, 'json', item.text));
    rec.detail = {
      old: oj ? { stats: oj.stats, tags: flattenTags(oj) } : null,
      new: nj ? { stats: nj.stats, tags: flattenTags(nj) } : null,
    };
  }
  return rec;
};

const corpus = LIMIT > 0 ? CORPUS.slice(0, LIMIT) : CORPUS;
const results = [];
for (const item of corpus) {
  const rec = runOne(item);
  results.push(rec);
  const mark = rec.same ? '=' : '!';
  process.stdout.write(`[${mark}] ${rec.id}\t旧 ${rec.oldCount} / 新 ${rec.newCount}\t+${rec.added.length} -${rec.removed.length}\t${rec.text}\n`);
}

const changed = results.filter((r) => !r.same);
const archiveCases = results.filter((r) => r.expectOld !== undefined);
const archiveBad = archiveCases.filter((r) => !r.archiveOk);
const summary = {
  corpus: results.length,
  same: results.length - changed.length,
  changed: changed.length,
  changedWithAdd: changed.filter((r) => r.added.length > 0).length,
  changedWithRemove: changed.filter((r) => r.removed.length > 0).length,
  onlyAdded: changed.filter((r) => r.removed.length === 0 && r.added.length > 0).length,
  archiveCases: archiveCases.length,
  archiveOk: archiveCases.filter((r) => r.archiveOk).length,
  archiveMismatch: archiveBad.map((r) => ({ id: r.id, text: r.text, expectOld: r.expectOld, oldLine: r.oldLine })),
  totalAddedTags: changed.reduce((n, r) => n + r.added.length, 0),
  totalRemovedTags: changed.reduce((n, r) => n + r.removed.length, 0),
};

mkdirSync(OUT_DIR, { recursive: true });
const auditPath = join(OUT_DIR, 'fat-tags-audit.json');
writeFileSync(
  auditPath,
  JSON.stringify(
    {
      meta: {
        generatedAt: new Date().toISOString(),
        node: process.version,
        oldDir: OLD_DIR,
        newDir: NEW_DIR,
        kb: KB_DIR,
        args: 'default tier, --format tags (json detail only for differing cases), no --broad / --gaps / --rating',
      },
      summary,
      cases: results,
    },
    null,
    2,
  ),
  'utf8',
);

// 中文表格
const lines = [];
lines.push('# 文本入口「变胖标签」A/B 测量表');
lines.push('');
lines.push(`旧快照：\`${OLD_DIR}\``);
lines.push(`当前仓库：\`${NEW_DIR}\``);
lines.push(`词库：\`${KB_DIR}\``);
lines.push('参数：默认档、`--format tags`；差异条目的 JSON 明细见 `fat-tags-audit.json`。');
lines.push('');
lines.push(`汇总：语料 ${summary.corpus} 条，完全相同 ${summary.same} 条，有差异 ${summary.changed} 条（其中只增不减 ${summary.onlyAdded} 条 / 有减少 ${summary.changedWithRemove} 条）；累计新增标签 ${summary.totalAddedTags} 个、消失 ${summary.totalRemovedTags} 个。`);
lines.push(`归档校验：${summary.archiveCases} 条旧真值中 ${summary.archiveOk} 条与旧快照一致。`);
lines.push('');
lines.push('| id | 组 | 输入 | 旧标签串 | 新标签串 | 新增 | 减少 | 新侧同词根堆叠 |');
lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
for (const r of results) {
  const stack = r.stackNew
    .filter((c) => c.tags.some((t) => r.added.includes(t)))
    .map((c) => `${c.stem}: ${c.tags.join(' / ')}`)
    .join('；');
  const esc = (s) => String(s).replace(/\|/g, '\\|');
  lines.push(
    `| ${r.id} | ${r.group} | ${esc(r.text)} | ${esc(r.oldLine)} | ${esc(r.newLine)} | ${esc(r.added.join(', '))} | ${esc(r.removed.join(', '))} | ${esc(stack)} |`,
  );
}
const tablePath = join(OUT_DIR, 'fat-tags-table.md');
writeFileSync(tablePath, `${lines.join('\n')}\n`, 'utf8');

process.stdout.write(`\nSUMMARY corpus=${summary.corpus} same=${summary.same} changed=${summary.changed} onlyAdded=${summary.onlyAdded} withRemove=${summary.changedWithRemove} added=${summary.totalAddedTags} removed=${summary.totalRemovedTags}\n`);
process.stdout.write(`ARCHIVE ${summary.archiveOk}/${summary.archiveCases} ok\n`);
for (const m of summary.archiveMismatch) {
  process.stdout.write(`  MISMATCH ${m.id} ${m.text}: 期望「${m.expectOld}」实测「${m.oldLine}」\n`);
}
process.stdout.write(`OUT ${auditPath}\nOUT ${tablePath}\n`);
