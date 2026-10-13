/**
 * render.mjs —— 人读输出：指令解析报告、融合报告、维度清单、组合宏清单
 *
 * 所有渲染都是「把已经算好的结构化结果画成表格」，不做任何再判断，
 * 保证 md 报告与 API 返回、CLI 默认输出三者口径一致。
 */
import { SLOTS, dimsTable, presetsTable } from './dims.mjs';

const sideLabel = n => `图${n}`;
const esc = v => String(v == null ? '' : v).replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** 指令解析报告（--format explain 用；不跑标签引擎，秒出） */
export function renderExplain(intent) {
  const L = [];
  L.push('# 双图融合 · 指令解析');
  L.push('');
  L.push(`- 原句：\`${intent.text}\``);
  L.push(`- 图片数：${intent.count}${intent.swap ? '（--swap：口头顺序已整体反转）' : ''}`);
  L.push(`- 底图（宿主）：**${sideLabel(intent.base)}**（置信度 ${intent.baseConfidence}；依据：${intent.baseReason}）`);
  if (intent.refs.length) {
    L.push(`- 识别到的指代：${intent.refs.map(r => `\`${r.raw}\` → ${sideLabel(r.side)}`).join('、')}`);
  }
  if (intent.presets && intent.presets.length) {
    L.push(`- 命中的组合宏：${intent.presets.map(p => `**${p.label}**（${p.alias}）→ ${p.slots.join(' + ')}`).join('；')}`);
  }
  L.push('');
  L.push('## 换源表');
  L.push('');
  if (!intent.sources.length) {
    L.push('_没有识别到任何换源指令。_');
  } else {
    L.push('| 维度 | 路径 | 取自 | 置信度 | 依据 | 组合宏 |');
    L.push('| --- | --- | --- | --- | --- | --- |');
    for (const s of intent.sources) {
      L.push(`| ${esc(s.label)}${s.isGroup ? '（整组）' : ''} | \`${s.path}\` | ${sideLabel(s.side)} | ${esc(s.confidence)} | ${esc(s.rule || s.from || '')} | ${esc(s.preset || '')} |`);
    }
  }
  L.push('');
  if (intent.assumptions.length) {
    L.push('## 我替你做的假设');
    L.push('');
    for (const a of intent.assumptions) L.push(`- ${a}`);
    L.push('');
  }
  if (intent.ambiguous.length) {
    L.push('## 需要你确认');
    L.push('');
    for (const a of intent.ambiguous) {
      L.push(`- **${a.code}**：${a.message}`);
      if (a.options && a.options.length) {
        for (const o of a.options) L.push(`  - ${o.label} → \`${o.value}\``);
      }
    }
    L.push('');
  }
  if (intent.unknown.length) {
    L.push('## 没听懂的片段（需要你确认怎么处理）');
    L.push('');
    for (const u of intent.unknown) {
      const ctx = u.raw && u.raw !== u.text ? `（原句片段：\`${esc(u.raw)}\`）` : '';
      L.push(`- \`${esc(u.text)}\`${ctx}`);
    }
    L.push('');
  }
  return L.join('\n');
}

/** 维度清单（--dims 用） */
export function renderDims() {
  const L = [];
  L.push('# 可搬运维度（融合坐标系统）');
  L.push('');
  L.push('| 维度 | 路径 | 中文别名 | 粒度 |');
  L.push('| --- | --- | --- | --- |');
  for (const row of dimsTable()) {
    L.push(`| ${esc(row.label)} | \`${row.path}\` | ${esc(row.aliases)} | ${esc(row.kind)} |`);
  }
  L.push('');
  L.push('用法：`--map "pose=1,scene=2,appearance.hair=3"`，或用自然语言让解析器自己认。');
  L.push('成组换源见 `--presets`。');
  return L.join('\n');
}

/** 组合宏清单（--presets 用） */
export function renderPresets() {
  const L = [];
  L.push('# 组合宏（一次点名一组维度）');
  L.push('');
  L.push('| 组合 | 写法（别名） | 覆盖的槽位 |');
  L.push('| --- | --- | --- |');
  for (const row of presetsTable()) {
    L.push(`| ${esc(row.label)} | ${esc(row.aliases)} | ${row.slots.split(' + ').map(s => `\`${s}\``).join(' + ')} |`);
  }
  L.push('');
  L.push('用法：`--preset 上身特写=1`；两张图时可省略编号（默认取底图之外的那张）：`--preset 氛围感`。');
  L.push('也能直接写在自然语言里：`把图1的上身特写换给图2`。');
  return L.join('\n');
}

/**
 * 融合报告（--format md 用）。
 * @param {object} r fuse() 的返回值
 */
export function renderMerge(r) {
  const { intent, merged } = r;
  const L = [];
  L.push('# 双图融合结果');
  L.push('');
  if (r.instruction) L.push(`> 指令：${r.instruction}`);
  L.push('');
  L.push(`- 图片数：${r.count}`);
  L.push(`- 底图：**${sideLabel(merged.base)}**（依据：${intent.baseReason}）`);
  L.push(`- 分级：\`${r.rating}\``);
  if (intent.presets && intent.presets.length) {
    L.push(`- 组合宏：${intent.presets.map(p => `${p.label}（${p.alias}${p.side ? ' → ' + sideLabel(p.side) : ''}）`).join('、')}`);
  }
  L.push('');

  if (r.mapErrors && r.mapErrors.length) {
    L.push('## 参数错误');
    L.push('');
    for (const e of r.mapErrors) L.push(`- ${e}`);
    L.push('');
  }

  L.push('## 结果标签');
  L.push('');
  L.push('```');
  L.push(r.tags || '(空)');
  L.push('```');
  L.push('');
  if (r.negative) {
    L.push('## 负向');
    L.push('');
    L.push('```');
    L.push(r.negative);
    L.push('```');
    L.push('');
  }

  L.push('## 换源表');
  L.push('');
  if (!merged.applied.length) {
    L.push('_没有显式换源（整张以底图为准）。_');
  } else {
    L.push('| 维度 | 路径 | 取自 | 结果 |');
    L.push('| --- | --- | --- | --- |');
    for (const s of merged.applied) {
      L.push(`| ${esc(s.label)}${s.isGroup ? '（整组）' : ''} | \`${s.path}\` | ${sideLabel(s.side)} | ${esc(s.note)} |`);
    }
  }
  L.push('');

  L.push('## 溯源表（合并后每个字段来自哪张图）');
  L.push('');
  L.push('| 字段 | 维度 | 来自 |');
  L.push('| --- | --- | --- |');
  for (const p of merged.provenance) {
    L.push(`| \`${p.path}\` | ${esc(p.label)} | ${sideLabel(p.side)} |`);
  }
  L.push('');

  if (merged.conflicts.length) {
    L.push('## 跨源提示');
    L.push('');
    for (const c of merged.conflicts) {
      L.push(`- **[${c.severity}] ${c.code}** ${c.message}`);
    }
    L.push('');
  }

  if (r.specIssues && r.specIssues.length) {
    L.push('## 合并后的观察缺项（会被静默丢标签）');
    L.push('');
    for (const i of r.specIssues) {
      L.push(`- \`${i.key}\`（${i.label}，${i.severity}）：${i.advice}${i.srcKey ? `（相关键：\`${i.srcKey}\`）` : ''}`);
    }
    L.push('');
  }

  if (r.nl && r.nl.text) {
    L.push('## 英文自然语言（供润色）');
    L.push('');
    L.push(r.nl.text);
    L.push('');
  }

  if (r.gapsMarkdown) {
    L.push('## 缺项自审');
    L.push('');
    L.push(r.gapsMarkdown);
    L.push('');
  }

  L.push('## 合并后的观察 JSON（可存盘再喂 rtag.mjs --image-spec，或当成下一轮的一张图）');
  L.push('');
  L.push('```json');
  L.push(JSON.stringify(merged.spec, null, 2));
  L.push('```');
  return L.join('\n');
}

/** 结构化槽位是否存在（给 CLI 做参数校验） */
export function slotInfo(path) {
  return SLOTS.get(path) || null;
}
