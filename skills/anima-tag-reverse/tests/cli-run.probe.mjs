/**
 * cli-run.probe.mjs —— 探针用的小工具：把 rtag 的 stdout / stderr 分开带回来
 *
 *   node tests/cli-run.probe.mjs --image-spec tests/img-spec.sample.json
 *   → 一行 JSON：{ code, stdout, stderr }
 *
 * 为什么单独起一个文件：主探针要断言「缺项提示只去 stderr」，
 * 而子进程的 stdout/stderr 必须分开拿到才行（管道捕获在受限环境里不可用，
 * 所以这里干脆由外面的检测脚本把整条命令包起来）。
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));   // 路径里有空格，不能用 URL.pathname
const ROOT = path.dirname(HERE);
const args = process.argv.slice(2);

const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'rtag.mjs'), ...args], {
  cwd: ROOT,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe']
});

console.log(JSON.stringify({ code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' }));
