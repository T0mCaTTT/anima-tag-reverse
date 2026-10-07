#!/usr/bin/env node
/**
 * toggle-dsh-skill.mjs —— 命令行版的「技能中心开关」
 *
 * 技能中心面板里的启用/禁用开关，写的就是 SKILL.md frontmatter 里的
 * `disable-model-invocation`（关闭 = true，模型目录随即热刷新；`user-invocable: true`
 * 保留，所以关掉后仍然可以用 /anima-tag-reverse 手动调用）。
 * 这个脚本在没有面板、或者想脚本化控制的时候用，效果与面板开关一致。
 *
 * 跑法：
 *   node tools/toggle-dsh-skill.mjs              看当前状态
 *   node tools/toggle-dsh-skill.mjs --disable    关（等价于面板关掉开关）
 *   node tools/toggle-dsh-skill.mjs --enable     开
 *   node tools/toggle-dsh-skill.mjs --dest <目录> 指定技能安装父目录（默认 ~/.dsh/skills）
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_NAME = path.basename(path.resolve(HERE, '..'));

const argv = process.argv.slice(2);
const destIdx = argv.indexOf('--dest');
const DEST_PARENT = destIdx >= 0 && argv[destIdx + 1] ? path.resolve(argv[destIdx + 1]) : path.join(os.homedir(), '.dsh', 'skills');
const TARGET = path.join(DEST_PARENT, SKILL_NAME, 'SKILL.md');

const wantDisable = argv.includes('--disable');
const wantEnable = argv.includes('--enable');

if (!fs.existsSync(TARGET)) {
  console.error(`找不到已安装的技能：${TARGET}\n先跑：node tools/install-dsh-skill.mjs`);
  process.exit(1);
}

const raw = fs.readFileSync(TARGET, 'utf8').replace(/^\uFEFF/, '');
const m = raw.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
if (!m) {
  console.error('SKILL.md 缺少 frontmatter，面板不会列出它。');
  process.exit(1);
}
const [head, fmRaw, tail] = [m[1], m[2], m[3]];
const rest = raw.slice(m[0].length);
const eol = head.includes('\r\n') ? '\r\n' : '\n';
const lines = fmRaw.split(/\r?\n/);
const idx = lines.findIndex(l => /^disable-model-invocation\s*:/.test(l));
const current = idx >= 0 ? /true/i.test(lines[idx]) : false;

if (!wantDisable && !wantEnable) {
  console.log(`技能：${SKILL_NAME}`);
  console.log(`文件：${TARGET}`);
  console.log(`状态：${current ? '已禁用（模型不会自动调用；仍可 /' + SKILL_NAME + ' 手动调用）' : '已启用'}`);
  process.exit(0);
}

const next = wantDisable;
if (idx >= 0) lines[idx] = `disable-model-invocation: ${next}`;
else lines.push(`disable-model-invocation: ${next}`);
fs.writeFileSync(TARGET, head + lines.join(eol) + tail + rest, 'utf8');
console.log(`${next ? '已禁用' : '已启用'}：${TARGET}`);
console.log('（模型目录会热刷新；面板里的开关显示同步变化）');
