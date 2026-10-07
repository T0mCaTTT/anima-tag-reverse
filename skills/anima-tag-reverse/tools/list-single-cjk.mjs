/**
 * 维护工具：列出词库里所有「单字汉字表面」及其频次，用来复核单字放行策略。
 * 跑法：node tools/list-single-cjk.mjs
 *
 * 判断依据（见 src/config.mjs）：
 *   SINGLE_CJK_OK          明确可单独成标签的单字（蹲/坐/躺/春/夏/秋/冬…）
 *   SINGLE_CJK_MIN_FREQ    非白名单单字的频次门槛（8000）
 *   SINGLE_CJK_BLOCK_2G    复合词护栏（角色 / 风格 / 心情 / 眼球 …）
 * 改白名单或护栏后跑一遍这个清单 + `node tests/smoke.mjs` 复测。
 */
import { getLexicon } from '../src/index.mjs';
import { SINGLE_CJK_OK, SINGLE_CJK_MIN_FREQ, SINGLE_CJK_BLOCK_2G } from '../src/config.mjs';

const lex = getLexicon();
const rows = [];
for (const [key, info] of lex.surfaces) {
  if ([...key].length !== 1 || !/[\u4e00-\u9fff]/.test(key)) continue;
  const e = lex.entries[info.i];
  if (!e) continue;
  if (!e.big || /^cb:(character|series)$/.test(e.big)) continue;   // 角色/作品本来就会被跳过
  rows.push({ ch: key, tag: e.tag, zh: e.zh || '', freqN: e.freqN || 0, big: e.big });
}

rows.sort((a, b) => b.freqN - a.freqN);
const pass = rows.filter(r => SINGLE_CJK_OK.has(r.ch) || r.freqN >= SINGLE_CJK_MIN_FREQ);
const block = rows.filter(r => !(SINGLE_CJK_OK.has(r.ch) || r.freqN >= SINGLE_CJK_MIN_FREQ));

const pad = (s, n) => String(s).padEnd(n);
console.log(`单字汉字表面（非角色/作品）：${rows.length} 个`);
console.log(`门槛 SINGLE_CJK_MIN_FREQ=${SINGLE_CJK_MIN_FREQ} · 白名单 ${SINGLE_CJK_OK.size} 个 · 复合词护栏 ${SINGLE_CJK_BLOCK_2G.length} 个：${SINGLE_CJK_BLOCK_2G.join(' ')}\n`);

console.log('=== 目前放行的（白名单 + 够高频）===');
for (const r of pass) console.log(`${r.ch}\t${pad(r.tag, 22)} ${pad(r.zh, 10)} ${r.freqN.toLocaleString().padStart(10)}  ${r.big}`);

console.log('\n=== 目前被门槛挡住的（想放行就把字加进白名单）===');
for (const r of block) console.log(`${r.ch}\t${pad(r.tag, 22)} ${pad(r.zh, 10)} ${r.freqN.toLocaleString().padStart(10)}  ${r.big}`);
