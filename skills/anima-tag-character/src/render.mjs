/**
 * render.mjs —— 人读输出（角色解析报告 / 作品角色表 / 校验报告 / 词库概况 / 补丁报告）
 *
 * 与其它两个技能同一条纪律：**stdout 只放交付物**，报告用 `--format md` 显式要。
 */
import { toTag } from './normalize.mjs';

const esc = v => String(v == null ? '' : v).replace(/\|/g, '\\|');
const fmtFreq = n => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n || 0));
const pct = s => `${Math.round((s || 0) * 100)}%`;

/** 角色解析报告 */
export function renderResolve(r) {
  const L = [];
  L.push(`# 角色解析：${r.query}`);
  L.push('');
  if (r.series) {
    L.push(`- 作品：**${r.series.tag}**${r.series.zh ? `（${r.series.zh}）` : ''} — 来源：${r.series.via}，置信度 ${pct(r.series.score)}`);
  } else {
    L.push('- 作品：未指定（候选里会显示每个角色自己的作品归属）');
  }
  if (r.best) {
    L.push(`- **推荐标签**：\`${toTag(r.best.tag)}\`${r.best.series ? ` + 作品 \`${toTag(r.best.series)}\`` : ''}`);
    L.push(`- 置信度：${pct(r.best.score)}（${r.best.why.join('；')}）`);
  } else {
    L.push('- **没有找到可用标签**');
  }
  L.push('');
  if (r.candidates.length) {
    L.push('## 候选');
    L.push('');
    L.push('| 标签 | 中文 | 作品 | 归属来源 | 频次 | 分数 | 命中依据 |');
    L.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const c of r.candidates) {
      L.push(`| \`${toTag(c.tag)}\`${c.variant ? ' ⚠异体' : ''} | ${esc(c.zh)} | ${esc(c.series || '—')} | ${esc(c.seriesVia || '')} | ${fmtFreq(c.freq)} | ${pct(c.score)} | ${esc(c.why.join('；'))} |`);
    }
    L.push('');
  }
  if (r.rejected && r.rejected.length) {
    L.push('## 按你的作品要求排除掉的同名角色');
    L.push('');
    for (const x of r.rejected) L.push(`- \`${toTag(x.tag)}\`（${esc(x.zh)}，属于 ${x.series}）`);
    L.push('');
  }
  if (r.notes && r.notes.length) {
    L.push('## 说明');
    L.push('');
    for (const n of r.notes) L.push(`- ${n}`);
    L.push('');
  }
  return L.join('\n');
}

/** 标签校验报告 */
export function renderVerify(v) {
  const L = [];
  L.push(`# 校验：${v.query}`);
  L.push('');
  if (v.found && v.kind === 'character') {
    L.push(`- ✅ 是词库里的**角色**标签：\`${toTag(v.tag)}\``);
    L.push(`- 中文名：${v.zh || '（无）'}`);
    L.push(`- 作品归属：${v.series ? `\`${toTag(v.series)}\`（来源：${v.seriesVia}）` : '（词库未标注）'}`);
    L.push(`- 标签自带作品括号：${v.hasSeriesInTag ? '是（不必再单独写作品标签）' : '否'}`);
    L.push(`- 异体/形态标签：${v.variant ? '⚠ 是（不是主标签，慎用）' : '否'}`);
    L.push(`- 频次：${fmtFreq(v.freq)}`);
  } else if (v.found && v.kind === 'series') {
    L.push(`- ✅ 是词库里的**作品**标签：\`${toTag(v.tag)}\`（${v.zh || '无中文'}）`);
  } else {
    L.push('- ❌ 词库里**没有**这个标签（精确匹配不到）。');
    if (v.near && v.near.length) {
      L.push('');
      L.push('## 相近候选');
      L.push('');
      for (const n of v.near) L.push(`- \`${toTag(n.tag)}\`${n.zh ? `（${n.zh}）` : ''}${n.series ? ` — 属于 ${n.series}` : ''}`);
    }
    L.push('');
    L.push('> 词库是 5713 条精选角色，Danbooru 实际有十万级角色标签。库里没有 ≠ 标签不存在，');
    L.push('> 但**本技能不猜**：请确认拼写，或由会话里的我给出更准确的英文标签后再校验。');
  }
  return L.join('\n');
}

/** 作品下的角色表 */
export function renderSeries(s) {
  const L = [];
  if (!s.series) {
    L.push(`# 作品解析：${s.seriesQuery || ''}`);
    L.push('');
    L.push(`- ❌ ${s.note || '没找到该作品'}`);
    return L.join('\n');
  }
  L.push(`# ${s.series.tag}${s.series.zh ? `（${s.series.zh}）` : ''} 下的角色`);
  L.push('');
  L.push(`- 词库收录：**${s.total}** 个（显示前 ${s.characters.length} 个）`);
  if (s.note) L.push(`- ${s.note}`);
  L.push('');
  L.push('| 标签 | 中文 | 频次 | 备注 |');
  L.push('| --- | --- | --- | --- |');
  for (const c of s.characters) {
    L.push(`| \`${toTag(c.tag)}\` | ${esc(c.zh)} | ${fmtFreq(c.freq)} | ${c.variant ? '异体/形态' : ''} |`);
  }
  return L.join('\n');
}

/** 通用检索表 */
export function renderSearch(list, query) {
  const L = [];
  L.push(`# 检索：${query}`);
  L.push('');
  if (!list.length) { L.push('- 没有命中。'); return L.join('\n'); }
  L.push('| 标签 | 类型 | 中文 | 作品 | 分数 | 频次 |');
  L.push('| --- | --- | --- | --- | --- | --- |');
  for (const x of list) {
    L.push(`| \`${toTag(x.tag)}\` | ${x.kind === 'character' ? '角色' : '作品'} | ${esc(x.zh)} | ${esc(x.series || '')} | ${pct(x.score)} | ${fmtFreq(x.freq)} |`);
  }
  return L.join('\n');
}

/** 词库概况 */
export function renderInfo(info) {
  const L = [];
  L.push('# 角色词库概况');
  L.push('');
  L.push(`- 词库目录：\`${info.dir}\``);
  L.push(`- 总条目：${info.stats.total}（角色 ${info.stats.characters} / 作品 ${info.stats.series}）`);
  L.push(`- 角色中带中文名：${info.stats.withZh}；**能归到具体作品的：${info.stats.withSeries}**`);
  L.push(`- 可检索名称（含别名/中文）：${info.stats.names}`);
  if (info.stats.builtAt) L.push(`- 词库构建于：${info.stats.builtAt}`);
  L.push('');
  L.push('## 角色数最多的作品');
  L.push('');
  L.push('| 作品标签 | 收录角色 |');
  L.push('| --- | --- |');
  for (const s of info.topSeries) L.push(`| \`${s.tag}\` | ${s.characters} |`);
  return L.join('\n');
}

/** 观察 JSON 补丁报告 */
export function renderPatch(p) {
  const L = [];
  L.push('# 观察 JSON 角色/作品修正');
  L.push('');
  if (!p.changes.length && !p.unresolved.length) {
    L.push('_没有需要改的：characters / series 字段本来就是规范标签，或为空。_');
    return L.join('\n');
  }
  if (p.changes.length) {
    L.push('## 已替换');
    L.push('');
    L.push('| 字段 | 原值 | 改为 | 置信度 | 依据 |');
    L.push('| --- | --- | --- | --- | --- |');
    for (const c of p.changes) {
      L.push(`| ${c.field} | ${esc(c.from)} | \`${toTag(c.to)}\` | ${pct(c.score)} | ${esc((c.why || []).join('；'))} |`);
    }
    L.push('');
  }
  if (p.unresolved.length) {
    L.push('## 需要你确认（置信度不足，未改动）');
    L.push('');
    for (const u of p.unresolved) {
      L.push(`- **${u.input}**（${u.field}）${u.best ? ` — 最接近的是 \`${toTag(u.best)}\`（${pct(u.score)}）` : ' — 词库里没有'}`);
      for (const c of (u.candidates || [])) L.push(`  - 候选：\`${toTag(c.tag)}\`${c.zh ? `（${c.zh}）` : ''}${c.series ? ` — ${c.series}` : ''} ${pct(c.score)}`);
      for (const r of (u.rejected || [])) L.push(`  - 已排除：\`${toTag(r.tag)}\`（属于 ${r.series}）`);
    }
    L.push('');
  }
  if (p.notes && p.notes.length) {
    L.push('## 说明');
    L.push('');
    for (const n of p.notes) L.push(`- ${n}`);
  }
  return L.join('\n');
}
