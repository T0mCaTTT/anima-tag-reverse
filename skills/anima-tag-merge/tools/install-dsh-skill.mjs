#!/usr/bin/env node
/**
 * install-dsh-skill.mjs —— 把本技能同步到 DSH 用户技能目录，并写 engine-path.json
 *
 * 跑法（技能根目录）：
 *   node tools/install-dsh-skill.mjs            同步到 ~/.dsh/skills/anima-tag-merge
 *   node tools/install-dsh-skill.mjs --check    只检查目标是否已最新（不一致 exit 2）
 *   node tools/install-dsh-skill.mjs --force    目标有本地改动时也覆盖（先备份）
 *   node tools/install-dsh-skill.mjs --dest <目录>  装到别处（调试用）
 *
 * 为什么用「复制 + 同步脚本」而不是软链：技能中心面板对软链技能只允许开关，
 * 不允许编辑/删除；复制一份三样都能用。代价是源码改完要再跑一次本脚本。
 *
 * engine-path.json 记录 anima-tag-reverse 引擎目录，优先指向**目标 skills 目录里的兄弟副本**
 * （运行时实际加载的那份），目标里没有才回落到仓库解析结果。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolveEngineDir } from '../src/engine.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..');
const SKILL_NAME = path.basename(SRC);

const argv = process.argv.slice(2);
const has = f => argv.includes(f);
const CHECK = has('--check');
const FORCE = has('--force');
const destIdx = argv.indexOf('--dest');
const DEST_PARENT = destIdx >= 0 && argv[destIdx + 1]
  ? path.resolve(argv[destIdx + 1])
  : path.join(os.homedir(), '.dsh', 'skills');
const DEST = path.join(DEST_PARENT, SKILL_NAME);
const BACKUP_ROOT = path.join(path.dirname(DEST_PARENT), 'skill-backups');

const SKIP_DIRS = new Set(['node_modules', '.git', '.trash']);
const SKIP_FILES = new Set(['.DS_Store', 'engine-path.json']);   // engine-path.json 按目标机器重写

function walk(dir, rel = '') {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.backup-')) continue;
    const r = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue;
      out.push(...walk(path.join(dir, ent.name), r));
    } else if (ent.isFile() && !SKIP_FILES.has(ent.name)) {
      out.push(r);
    }
  }
  return out.sort();
}

/** 技能开关由技能中心写进 SKILL.md 的 frontmatter，同步时不算内容差异 */
const TOGGLE_RE = /^disable-model-invocation:\s*(.*)$/m;

function signature(root, files) {
  const h = crypto.createHash('sha1');
  for (const f of files) {
    h.update(f);
    h.update('\0');
    h.update(String(fs.readFileSync(path.join(root, f), 'utf8')).replace(TOGGLE_RE, ''));
    h.update('\0');
  }
  return h.digest('hex');
}

function copyInto(files) {
  for (const f of files) {
    const dst = path.join(DEST, f);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(SRC, f), dst);
  }
}

/** 目标 skills 目录里的兄弟副本优先（运行时真正加载的那份） */
function pickEngineDir() {
  const sibling = path.join(DEST_PARENT, 'anima-tag-reverse');
  if (fs.existsSync(path.join(sibling, 'src', 'index.mjs'))) return fs.realpathSync(sibling);
  return resolveEngineDir({ skillDir: SRC });
}

function writeEnginePath() {
  const engineDir = pickEngineDir();
  const p = path.join(DEST, 'engine-path.json');
  fs.writeFileSync(p, JSON.stringify({ engineDir, updatedAt: new Date().toISOString() }, null, 2) + '\n', 'utf8');
  return engineDir;
}

const files = walk(SRC);
const srcSig = signature(SRC, files);
const destExists = fs.existsSync(DEST);

if (CHECK) {
  if (!destExists) { console.error(`[未安装] ${DEST}`); process.exit(2); }
  const destFiles = walk(DEST).filter(f => files.includes(f));
  const missing = files.filter(f => !fs.existsSync(path.join(DEST, f)));
  const stale = signature(DEST, destFiles) !== srcSig || missing.length > 0;
  if (stale) {
    console.error(`[需同步] ${DEST}${missing.length ? ` 缺少 ${missing.length} 个文件` : ' 内容有差异'}`);
    process.exit(2);
  }
  console.log(`[已最新] ${DEST}`);
  process.exit(0);
}

if (destExists && !FORCE) {
  const destFiles = walk(DEST).filter(f => files.includes(f));
  const missing = files.filter(f => !fs.existsSync(path.join(DEST, f)));
  if (signature(DEST, destFiles) === srcSig && !missing.length) {
    const engineDir = writeEnginePath();
    console.log(`[已最新] ${DEST}（engine: ${engineDir}）`);
    process.exit(0);
  }
}

if (destExists) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = path.join(BACKUP_ROOT, `${SKILL_NAME}-${stamp}`);
  fs.mkdirSync(path.dirname(backup), { recursive: true });
  fs.cpSync(DEST, backup, { recursive: true });
  console.log(`[备份] ${backup}`);
}

fs.mkdirSync(DEST, { recursive: true });
copyInto(files);
const engineDir = writeEnginePath();
console.log(`[安装] ${DEST}（${files.length} 个文件）`);
console.log(`[引擎] ${engineDir}`);
console.log('在「技能中心」里点开关即可启用/禁用。');
