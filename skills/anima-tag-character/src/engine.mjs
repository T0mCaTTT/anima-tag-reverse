/**
 * engine.mjs —— 复用 anima-tag-reverse 的匹配/排序/缺项引擎
 *
 * 本技能**不复制**标签引擎：词库索引、六道压制、分层排序、分级适配、缺项自审
 * 全在原技能里，这里只负责找到它并 import。理由：
 *   - 引擎是回归用例锁着的（25 条文本回归 + 图像分支探针），复制一份必然漂移；
 *   - 融合后的观察结果本来就是标准 spec，直接喂 `reverseImageSpec()` 即可。
 *
 * 定位顺序（先命中先用）：
 *   1. 显式参数 / --engine
 *   2. 环境变量 ANIMA_TAG_REVERSE_DIR
 *   3. 本技能目录里的 engine-path.json（安装脚本写入）
 *   4. 兄弟目录 ../anima-tag-reverse（两个技能都装在 ~/.dsh/skills 下的常态）
 *   5. 仓库相对路径
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const isEngine = dir => !!dir && fs.existsSync(path.join(dir, 'src', 'index.mjs'));

/** 找一个可用的 anima-tag-reverse 目录 */
export function resolveEngineDir({ skillDir, explicit } = {}) {
  const cands = [];
  if (explicit) cands.push(explicit);
  if (process.env.ANIMA_TAG_REVERSE_DIR) cands.push(process.env.ANIMA_TAG_REVERSE_DIR);
  const here = skillDir || path.dirname(path.dirname(new URL(import.meta.url).pathname));
  try {
    const j = JSON.parse(fs.readFileSync(path.join(here, 'engine-path.json'), 'utf8'));
    if (j.engineDir) cands.push(j.engineDir);
  } catch { /* 没写就跳过 */ }
  cands.push(path.resolve(here, '..', 'anima-tag-reverse'));
  cands.push(path.join(os.homedir(), '.dsh', 'skills', 'anima-tag-reverse'));
  cands.push(path.resolve(here, '..', '..', 'skills', 'anima-tag-reverse'));

  for (const c of cands) {
    if (!c) continue;
    try { if (isEngine(c)) return fs.realpathSync(c); } catch { /* 继续找 */ }
  }
  throw new Error(
    '找不到 anima-tag-reverse 引擎。请任选一种方式指定：\n' +
    '  1) 环境变量 ANIMA_TAG_REVERSE_DIR=/path/to/anima-tag-reverse\n' +
    '  2) 本技能目录下 engine-path.json 写 {"engineDir":"/path/to/anima-tag-reverse"}\n' +
    '  3) 把两个技能装在同一个 skills 目录里（默认布局）\n' +
    '已尝试：\n  ' + cands.filter(Boolean).join('\n  ')
  );
}

let _cache = null;

/** 加载引擎模块（进程内缓存） */
export async function loadEngine(opts = {}) {
  const dir = resolveEngineDir(opts);
  if (_cache && _cache.dir === dir) return _cache.mod;
  const mod = await import(pathToFileURL(path.join(dir, 'src', 'index.mjs')).href);
  _cache = { dir, mod };
  return mod;
}
