#!/usr/bin/env node
/**
 * install-dsh-skill.mjs —— 把本技能同步到 DSH 用户技能目录，让它出现在「技能中心」面板里并可开关
 *
 * 跑法（技能根目录）：
 *   node tools/install-dsh-skill.mjs            同步一份到 ~/.dsh/skills/anima-tag-reverse
 *   node tools/install-dsh-skill.mjs --check    只检查：目标是否已与仓库一致（不一致 exit 2）
 *   node tools/install-dsh-skill.mjs --force    目标有本地改动时也直接覆盖（先自动备份）
 *   node tools/install-dsh-skill.mjs --dest <目录> 装到别处（调试用）
 *
 * 为什么是「复制一份 + 同步脚本」而不是软链：
 *   技能中心面板对符号链接的技能只允许开关，不允许编辑/删除；复制一份则三样都能用。
 *   代价是源码改完要再跑一次本脚本（面板里编辑过的内容会被仓库版本覆盖，脚本会先备份）。
 *
 * 装好之后面板就能列出它：SKILL.md 的 frontmatter 有非空 name + description 即可，
 * 名字必须符合 /^[a-z0-9]+(?:-[a-z0-9]+)*$/（dsh-skill 的 isSkillName）。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolveKbDir } from '../src/config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..');
const SKILL_NAME = path.basename(SRC);

const argv = process.argv.slice(2);
const has = f => argv.includes(f);
const CHECK = has('--check');
const FORCE = has('--force');
const destIdx = argv.indexOf('--dest');
const DEST_PARENT = destIdx >= 0 && argv[destIdx + 1] ? path.resolve(argv[destIdx + 1]) : path.join(os.homedir(), '.dsh', 'skills');
const DEST = path.join(DEST_PARENT, SKILL_NAME);
const BACKUP_ROOT = path.join(path.dirname(DEST_PARENT), 'skill-backups');

const SKIP_DIRS = new Set(['node_modules', '.git', '.trash']);
const SKIP_FILES = new Set(['.DS_Store', 'kb-path.json']);   // kb-path.json 由本脚本按目标机器环境重新写

function walk(dir, rel = '') {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.backup-')) continue;
    const r = rel ? rel + '/' + ent.name : ent.name;
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue;
      out.push(...walk(path.join(dir, ent.name), r));
    } else if (ent.isFile() && !SKIP_FILES.has(ent.name)) {
      out.push(r);
    }
  }
  return out;
}

/** 开关行由技能中心面板 / toggle-dsh-skill.mjs 写，同步时不该算作「内容差异」 */
const TOGGLE_RE = /^disable-model-invocation:\s*(.*)$/m;

function signature(root, files) {
  return files.map(f => {
    const p = path.join(root, f);
    const st = fs.statSync(p);
    let size = st.size;
    if (f === 'SKILL.md') {
      const hit = fs.readFileSync(p, 'utf8').match(TOGGLE_RE);   // 两边都扣掉开关行，长度才可比
      if (hit) size -= hit[0].length + 1;
    }
    return `${f}:${size}`;
  }).join('|');
}

/** 读出已安装副本里的启用状态（面板开关写的就是这一行） */
function readInstalledToggle() {
  const p = path.join(DEST, 'SKILL.md');
  if (!fs.existsSync(p)) return null;
  const hit = fs.readFileSync(p, 'utf8').match(TOGGLE_RE);
  return hit ? hit[1].trim() : null;
}

/** 同步后把开关状态写回去，避免「面板里关掉 → 跑一次同步又被打开」 */
function restoreToggle(value) {
  if (value == null) return false;
  const p = path.join(DEST, 'SKILL.md');
  let raw = fs.readFileSync(p, 'utf8');
  if (TOGGLE_RE.test(raw)) raw = raw.replace(TOGGLE_RE, `disable-model-invocation: ${value}`);
  else raw = raw.replace(/^---\r?\n/, m => `${m}disable-model-invocation: ${value}\n`);
  fs.writeFileSync(p, raw, 'utf8');
  return true;
}

/** 校验 SKILL.md：面板只列「有非空 name 与 description 且名字合法」的技能 */
function readSkillMeta() {
  const p = path.join(SRC, 'SKILL.md');
  if (!fs.existsSync(p)) throw new Error('找不到 SKILL.md');
  const raw = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) throw new Error('SKILL.md 缺少 YAML frontmatter（--- 开头那段）');
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  if (!fm.name || !fm.description) throw new Error('SKILL.md 的 frontmatter 必须有非空 name 与 description');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fm.name)) throw new Error(`技能名不合法：${fm.name}（只允许小写字母/数字/连字符）`);
  return fm;
}

function main() {
  const fm = readSkillMeta();
  const kbDir = resolveKbDir();                 // 仓库里的词库位置（写进 kb-path.json 给安装后的副本用）
  const files = walk(SRC);
  const srcSig = signature(SRC, files);

  const installed = fs.existsSync(path.join(DEST, 'SKILL.md'));
  let dstSig = null;
  if (installed) {
    const dstFiles = walk(DEST).filter(f => files.includes(f));
    dstSig = signature(DEST, dstFiles);
    const missing = files.filter(f => !dstFiles.includes(f));
    if (missing.length) dstSig += '|missing:' + missing.join(',');
  }

  const same = installed && dstSig === srcSig;
  console.log(`技能：${fm.name}`);
  console.log(`来源：${SRC}`);
  console.log(`目标：${DEST}`);
  console.log(`词库：${kbDir}`);
  console.log(`文件：${files.length} 个 · ${same ? '已是最新 ✅' : installed ? '有差异（需要同步）' : '尚未安装'}`);

  if (CHECK) {
    if (same) { console.log('\n检查完成：目标与仓库一致。'); return 0; }
    console.log('\n检查完成：目标不是最新，跑 `node tools/install-dsh-skill.mjs` 同步。');
    return 2;
  }

  if (same && !FORCE) {
    console.log('\n无需同步。');
    writePointer();
    return 0;
  }

  // 目标有本地改动（面板里编辑过）→ 先备份，避免直接抹掉用户写的东西。
  // 备份必须放在技能根目录**之外**：技能加载器会扫 skills/*/SKILL.md，
  // 根目录里留一份同名 SKILL.md 会被当成重名技能。
  const toggleState = readInstalledToggle();
  if (installed && dstSig !== srcSig) {
    const backup = path.join(BACKUP_ROOT, `${SKILL_NAME}-${Date.now()}`);
    fs.mkdirSync(BACKUP_ROOT, { recursive: true });
    fs.cpSync(DEST, backup, { recursive: true });
    console.log(`\n目标已有本地内容，先备份到：${backup}`);
    console.log('（备份放在技能根目录外，避免加载器把副本当成第二个同名技能）');
  }

  fs.mkdirSync(DEST, { recursive: true });
  let copied = 0;
  for (const f of files) {
    const to = path.join(DEST, f);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(SRC, f), to);
    copied++;
  }
  console.log(`\n已同步 ${copied} 个文件。`);
  if (restoreToggle(toggleState)) {
    console.log(`保留了技能中心里的开关状态：disable-model-invocation: ${toggleState}`);
  }
  writePointer();
  return 0;

  function writePointer() {
    // 安装后的副本靠这个文件找到词库（resolveKbDir 的候选链里排第三）
    const ptr = path.join(DEST, 'kb-path.json');
    fs.mkdirSync(path.dirname(ptr), { recursive: true });
    fs.writeFileSync(ptr, JSON.stringify({ kbDir, updatedAt: new Date().toISOString(), from: SRC }, null, 2) + '\n', 'utf8');
    console.log(`已写 ${path.relative(DEST_PARENT, ptr)} → ${kbDir}`);
    console.log('\n下一步：打开 DSH 的「技能中心」面板，在「用户技能」里就能看到它，右侧开关即启用/禁用。');
    console.log(`自测：cd "${DEST}" && node tests/smoke.mjs`);
  }
}

try {
  process.exitCode = main();
} catch (e) {
  console.error('出错：' + e.message);
  process.exitCode = 1;
}
