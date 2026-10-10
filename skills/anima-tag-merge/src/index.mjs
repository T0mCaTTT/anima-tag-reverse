/**
 * index.mjs —— 门面 API
 *
 *   parseFusionIntent(instruction, opts)     自然语言 → 融合意图（不跑词库，纯解析）
 *   parseDimMap('pose=1,上身特写=2')          显式换源表（确定性，绕过自然语言）
 *   mergeSpecs({ images, intent })           按意图合并 N 份观察（纯函数）
 *   fuse({ images, instruction, ... })       一站式：解析 → 合并 → 反推标签（要词库）
 *
 * 设计原则：解析、合并、出标签是三段可分别调用的纯逻辑，
 * 只有 fuse() 需要 anima-tag-reverse 的词库；前两段能离线单测。
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseFusionIntent, parseDimMap, normalizeSideArg } from './intent.mjs';
import { mergeSpecs } from './merge.mjs';
import { resolveEngineDir, loadEngine } from './engine.mjs';
import { renderExplain, renderMerge, renderDims, renderPresets } from './render.mjs';
import { SLOTS, PRESETS, resolvePreset, expandPreset } from './dims.mjs';
import { MAX_IMAGES } from './refs.mjs';

export const SKILL_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** 有内容的结构化键（与 anima-tag-reverse 的约定一致） */
const STRUCTURED_KEYS = ['subject', 'appearance', 'outfit', 'pose', 'scene', 'style', 'characters', 'series', 'artists'];

const isEmptyValue = v => v === undefined || v === null ||
  (typeof v === 'string' && v.trim() === '') ||
  (Array.isArray(v) && v.length === 0) ||
  (!!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);

/** 观察可以是对象，也可以是 JSON 字符串（CLI 传文件内容时更方便） */
function asSpec(v, name) {
  if (v === undefined || v === null) throw new Error(`缺少 ${name} 的观察结果`);
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch (e) { throw new Error(`${name} 不是合法 JSON：${e.message}`); }
  }
  if (typeof v !== 'object' || Array.isArray(v)) throw new Error(`${name} 必须是观察对象`);
  return v;
}

/**
 * 收集图片观察。
 * 支持三种写法（等价，按优先级）：
 *   images: [spec1, spec2, spec3]        通用（推荐，N 张）
 *   a / b / c / d                        两张时的简写，或与 images 混用做局部覆盖
 *   images + a                           用 a 覆盖第 1 张
 */
function resolveImages(opts) {
  let raw;
  if (Array.isArray(opts.images) && opts.images.length) {
    raw = [...opts.images];
  } else {
    raw = [opts.a, opts.b, opts.c, opts.d, opts.e, opts.f].filter(v => v !== undefined);
  }
  // 简写键可以覆盖对应位置（先补齐长度）
  for (const [k, v] of [['a', opts.a], ['b', opts.b], ['c', opts.c], ['d', opts.d], ['e', opts.e], ['f', opts.f]]) {
    if (v === undefined) continue;
    const idx = 'abcdef'.indexOf(k);
    while (raw.length <= idx) raw.push(undefined);
    raw[idx] = v;
  }
  return raw.filter(v => v !== undefined && v !== null).map((v, i) => asSpec(v, `第 ${i + 1} 张图`));
}

/**
 * `--preset 上身特写` / `--preset 上身特写=2` / `--preset bust@3`
 * 不写编号时：两张图 = 取「另一张」（底图之外的那张）；三张以上必须写编号（歧义就报错，不猜）。
 */
export function applyPresets(intent, presetArgs, count) {
  const errors = [];
  const byPath = new Map(intent.sources.map(s => [s.path, s]));
  for (const raw of presetArgs || []) {
    const str = String(raw || '').trim();
    if (!str) continue;
    const parts = str.split(/[=:@]/);
    const namePart = (parts[0] || '').trim();
    const sidePart = (parts[1] || '').trim();
    const preset = resolvePreset(namePart);
    if (!preset) { errors.push(`未知组合宏：${namePart}（用 --presets 看全部可用组合）`); continue; }
    let side = null;
    if (sidePart) {
      side = normalizeSideArg(sidePart, false, count);
      if (!side) { errors.push(`「${str}」的图编号无法识别（写 ${namePart}=1 / =2 / =图3）`); continue; }
    } else if (count === 2) {
      side = intent.base === 1 ? 2 : 1;
    } else {
      errors.push(`「${namePart}」在 ${count} 张图下必须指定取自哪张（写 ${namePart}=2）`);
      continue;
    }
    if (side < 1 || side > count) { errors.push(`「${str}」的图编号超出范围（共 ${count} 张）`); continue; }
    for (const s of expandPreset(preset, side)) {
      byPath.set(s.path, { ...s, evidence: `--preset ${str}` });
    }
    intent.presets = [...(intent.presets || []), { id: preset.id, label: preset.label, alias: namePart, slots: preset.slots, side, from: 'cli' }];
  }
  intent.sources = [...byPath.values()].sort((x, y) => String(x.path).localeCompare(String(y.path)));
  return errors;
}

/**
 * 一站式融合。
 * @param {object} opts
 * @param {object[]|string[]} [opts.images] 观察数组，索引 0 = 图1（≥2 份）
 * @param {object|string} [opts.a] 图1 的观察（两张时的简写）
 * @param {object|string} [opts.b] 图2 的观察
 * @param {string} [opts.instruction] 自然语言指令
 * @param {string} [opts.map]     显式换源表 `pose=1,上身特写=2`
 * @param {string[]} [opts.presets] 组合宏 `['上身特写=1','氛围感']`
 * @param {'1'|'2'|'3'|'a'|'b'|number} [opts.base] 显式指定底图
 * @param {boolean} [opts.swap]   把口头的图顺序整体反转（口头的第 k 张 = 文件里的第 N+1-k 张）
 * @param {string[]} [opts.extra] 追加描述（落进 spec.extra，会被当额外分句匹配）
 * @param {boolean} [opts.broad]  宽召回
 * @param {boolean} [opts.nl]     额外产出英文自然语言
 * @param {string} [opts.engineDir] anima-tag-reverse 目录
 */
export async function fuse(opts = {}) {
  const images = resolveImages(opts);
  if (images.length < 2) throw new Error('至少需要两张图的观察（--img 可重复，或用 --a / --b）');
  if (images.length > MAX_IMAGES) throw new Error(`最多支持 ${MAX_IMAGES} 张图（当前 ${images.length}）`);
  const count = images.length;
  const skillDir = opts.skillDir || SKILL_DIR;

  const engineDir = resolveEngineDir({ skillDir, explicit: opts.engineDir });
  const engine = await loadEngine({ skillDir, explicit: engineDir });
  const specUtils = await import(pathToFileURL(path.join(engineDir, 'src', 'image-spec.mjs')).href);

  // ---- ① 意图 ----
  const baseArg = normalizeSideArg(opts.base, !!opts.swap, count);
  const intent = parseFusionIntent(opts.instruction || '', { swap: !!opts.swap, base: baseArg, count });
  const mapParsed = parseDimMap(opts.map || '');
  if (mapParsed.sources.length) {
    const byPath = new Map(intent.sources.map(s => [s.path, s]));
    for (const s of mapParsed.sources) {
      const slot = SLOTS.get(s.path);
      byPath.set(s.path, { ...s, label: slot ? slot.label : s.path, group: slot ? slot.group : null, isGroup: !!(slot && slot.isGroup) });
    }
    intent.sources = [...byPath.values()].sort((x, y) => x.path.localeCompare(y.path));
  }
  const presetErrors = applyPresets(intent, opts.presets || [], count);
  const mapErrors = [...mapParsed.errors, ...presetErrors];

  // ---- ② 归一 + 合并 ----
  const normalized = images.map((im, i) => {
    const n = specUtils.normalizeSpec(im);
    if (!STRUCTURED_KEYS.some(k => !isEmptyValue(n[k]))) {
      throw new Error(`第 ${i + 1} 张图没有结构化字段（只有 notes 或纯文本）。请先用 \`rtag.mjs --template\` 按模板写观察 JSON。`);
    }
    return n;
  });
  const merged = mergeSpecs({ images: normalized, intent, extra: opts.extra || [] });

  // ---- ③ 反推标签（复用原技能引擎，行为与原技能逐字节一致） ----
  const res = engine.reverseImageSpec(merged.spec, {
    broad: !!opts.broad,
    gaps: true,
    alternatives: !!opts.broad,
    nl: !!opts.nl,
    kbDir: opts.kbDir
  });

  const specIssues = specUtils.analyzeImageSpec(merged.spec);

  const out = {
    ok: true,
    instruction: opts.instruction || '',
    intent,
    mapErrors,
    merged,
    spec: merged.spec,
    base: merged.base,
    count,
    applied: merged.applied,
    emptySources: merged.emptySources,
    conflicts: merged.conflicts,
    provenance: merged.provenance,
    tags: res.bare,
    prompt: res.prompt,
    rating: res.rating,
    negative: res.negativeTags ? res.negativeTags.string : '',
    positive: res.positive,
    gaps: res.gaps,
    gapsSummary: res.gapsSummary,
    gapsMarkdown: res.gapsMarkdown,
    nl: res.nl,
    specIssues
  };
  out.report = () => renderMerge(out);
  return out;
}

export { parseFusionIntent, parseDimMap, normalizeSideArg, mergeSpecs, resolveEngineDir, loadEngine, renderExplain, renderMerge, renderDims, renderPresets, resolvePreset, expandPreset, PRESETS, MAX_IMAGES };
export { SLOTS, SLOT_TREE, matchDims, matchPresets, dimsTable, presetsTable, resolveSlotPath, leafPathsOf } from './dims.mjs';
export { findRefs, findBaseEvidence, pickBase } from './refs.mjs';
