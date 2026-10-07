#!/usr/bin/env node
/**
 * serve-kb.mjs —— Anima 标签知识库的零依赖本地静态服务器
 *
 * 为什么需要它：展览版是纯静态页，但数据（画师类/manifest.json、tags/*.json、
 * search-index.json）是用 fetch 按需加载的。直接用 file:// 打开 HTML 时浏览器会
 * 以 CORS 为由拒绝这些请求，页面只会显示"载入失败"。跑这个脚本即可。
 *
 * 用法：
 *   node scripts/serve-kb.mjs            # 默认 http://127.0.0.1:8100
 *   node scripts/serve-kb.mjs 8200       # 换端口
 *   node scripts/serve-kb.mjs 8100 --no-open   # 不自动打开浏览器
 *
 * 重复启动没关系：
 *   - 端口上已经是本知识库的服务 → 不重复起服务，直接开浏览器并退出（退出码 3）；
 *   - 端口被别的程序占用 → 自动往后试 8101、8102 … 最多 20 个端口。
 *
 * 也可直接双击项目根目录的「启动展览板.cmd」。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');           // anima-tag-kb/
const PAGE = 'anima-tag-exhibition.html';
const COLLECTIONS = path.join(ROOT, 'data', 'collections.json');   // 「tag 串收藏」的落盘位置
const API_COLLECTIONS = '/api/collections';
const BODY_LIMIT = 1024 * 1024;                 // 单次提交上限 1 MB（够 500 条收藏用很久）

const argv = process.argv.slice(2);
const port = Number(argv.find(a => /^\d+$/.test(a)) || process.env.PORT || 8100);
const noOpen = argv.includes('--no-open') || process.env.NO_OPEN === '1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jsonl': 'text/plain; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2'
};

/* ---------- 「tag 串收藏」的持久化接口 ----------
 * 为什么要有它：收藏只存 localStorage 的话，换端口（8100→8101 就是另一个 origin）
 * 或清缓存就没了。这个接口把同一份数据写进 data/collections.json，
 * 页面每次打开都会「本地 ∪ 文件」合并，所以换浏览器、换端口都还在，
 * 反推技能（skills/anima-tag-reverse）将来也能直接读这个文件。
 *   GET  /api/collections   → { v, items, tombstones, updatedAt }
 *   POST /api/collections   → 同样的结构（或 items 数组），原子替换写入
 */
function readCollections() {
  try {
    const data = JSON.parse(fs.readFileSync(COLLECTIONS, 'utf8'));
    if (Array.isArray(data)) return { v: 1, items: data, tombstones: {} };
    if (data && typeof data === 'object' && Array.isArray(data.items)) {
      return { v: 1, items: data.items, tombstones: data.tombstones && typeof data.tombstones === 'object' ? data.tombstones : {}, updatedAt: data.updatedAt };
    }
  } catch { /* 文件还没有 / 坏了 → 当成空的，不让页面报错 */ }
  return { v: 1, items: [], tombstones: {} };
}

function writeCollections(obj) {
  fs.mkdirSync(path.dirname(COLLECTIONS), { recursive: true });
  const tmp = COLLECTIONS + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, COLLECTIONS);       // 原子替换：中途断电也不会留半个文件
}

function collectionsApi(req, res) {
  const send = (code, obj) => {
    const body = JSON.stringify(obj);
    try {
      res.writeHead(code, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(body),
        'cache-control': 'no-store',
        'x-kb-server': 'anima-tag-kb'
      });
      res.end(body);
    } catch { /* 连接已经断了，忽略 */ }
  };
  if (req.method === 'GET' || req.method === 'HEAD') { send(200, readCollections()); return; }
  if (req.method !== 'POST' && req.method !== 'PUT') {
    send(405, { error: 'method-not-allowed', allow: 'GET, POST' });
    return;
  }
  let size = 0, chunks = [], done = false;
  req.on('data', c => {
    if (done) return;
    size += c.length;
    if (size > BODY_LIMIT) {
      done = true; chunks = [];
      send(413, { error: 'too-large', limit: BODY_LIMIT });
      req.destroy();
      return;
    }
    chunks.push(c);
  });
  req.on('end', () => {
    if (done) return;
    done = true;
    let data;
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { send(400, { error: 'bad-json' }); return; }
    const shape = Array.isArray(data) ? { items: data } : data;
    if (!shape || typeof shape !== 'object' || !Array.isArray(shape.items)) {
      send(400, { error: 'bad-shape', hint: '需要 {v, items, tombstones} 或 items 数组' });
      return;
    }
    const prev = readCollections();
    const next = {
      v: 1,
      updatedAt: new Date().toISOString(),
      items: shape.items,
      tombstones: shape.tombstones && typeof shape.tombstones === 'object' ? shape.tombstones : (prev.tombstones || {})
    };
    try { writeCollections(next); }
    catch (e) { send(500, { error: 'write-failed', message: String(e && e.message) }); return; }
    console.log(`[collections] 已保存 ${next.items.length} 条 · ${(size / 1024).toFixed(1)} KB → ${path.relative(ROOT, COLLECTIONS)}`);
    send(200, {
      ok: true,
      count: next.items.length,
      updatedAt: next.updatedAt,
      file: path.relative(ROOT, COLLECTIONS).replace(/\\/g, '/')
    });
  });
  req.on('error', () => { if (!done) { done = true; send(400, { error: 'stream-error' }); } });
}

function handle(req, res) {
  let rel;
  try {
    rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('bad request');
    return;
  }
  if (rel === API_COLLECTIONS) { collectionsApi(req, res); return; }
  if (rel.endsWith('/')) rel += PAGE;
  const abs = path.resolve(ROOT, '.' + rel);
  // 目录穿越保护：只允许读取 anima-tag-kb/ 以内的文件
  if (!abs.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.stat(abs, (err, st) => {
    if ((err || !st.isFile()) && !path.extname(abs)) {
      // 兼容旧书签：/anima-tag-exhibition 也能打开（自动补 .html）
      const alt = abs + '.html';
      fs.stat(alt, (e2, s2) => {
        if (e2 || !s2.isFile()) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 ' + rel); return; }
        sendFile(res, alt, s2);
      });
      return;
    }
    if (err || !st.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 ' + rel);
      return;
    }
    sendFile(res, abs, st);
  });
}

function sendFile(res, abs, st) {
  res.writeHead(200, {
    'content-type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream',
    'content-length': st.size,
    'x-kb-server': 'anima-tag-kb',
    'cache-control': 'no-cache'
  });
  fs.createReadStream(abs).pipe(res);
}

/* ---------- 启动 ---------- */
const ALIVE_MARK = 'Anima 标签工作台';   // 页面里必然出现的字样，用来辨认「端口上是不是本知识库」

/** 探测某个端口上是不是已经在跑本知识库的服务 */
function probeKb(p, timeout = 1000) {
  return new Promise(resolve => {
    const req = http.request(
      { host: '127.0.0.1', port: p, path: '/' + encodeURIComponent(PAGE), method: 'GET', timeout },
      res => {
        if (res.statusCode !== 200) { res.resume(); resolve(false); return; }
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', d => { if (buf.length < 4096) buf += d; });
        res.on('end', () => resolve(buf.includes(ALIVE_MARK)));
        res.on('error', () => resolve(false));
      }
    );
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
    req.end();
  });
}

/** 试着在某个端口起服务；失败不抛异常，只回报原因 */
function tryListen(p) {
  return new Promise(resolve => {
    const s = http.createServer(handle);
    s.once('error', err => { s.close(); resolve({ ok: false, code: err.code, err }); });
    s.once('listening', () => resolve({ ok: true, server: s }));
    s.listen(p, '127.0.0.1');
  });
}

function openBrowser(url) {
  if (noOpen) return;
  try {
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch { /* 打不开浏览器不影响服务 */ }
}

(async () => {
  let lastCode = '';
  for (let i = 0; i < 20; i++) {
    const p = port + i;
    // ① 这个端口上已经是本知识库 → 不再重复起服务，直接开浏览器
    if (await probeKb(p)) {
      const url = `http://127.0.0.1:${p}/${PAGE}`;
      console.log('Anima 标签知识库已经在运行，这次直接把展览板打开：');
      console.log('  地址：' + url);
      console.log('  提示：不用再启动第二个（重复启动不会出错，会复用这一个）。');
      console.log('  本窗口可以直接关闭，那个服务会继续跑。');
      openBrowser(url);
      process.exit(3);           // 3 = 复用了已有服务（cmd 里据此换一句提示）
    }
    // ② 端口空着 → 起服务
    const r = await tryListen(p);
    if (r.ok) {
      const url = `http://127.0.0.1:${p}/${PAGE}`;
      console.log('Anima 标签知识库已启动');
      console.log('  地址：' + url);
      if (p !== port) console.log(`  说明：${port} 被别的程序占用了，已自动改用 ${p}。`);
      console.log('  根目录：' + ROOT);
      console.log(`  收藏数据：${path.relative(ROOT, COLLECTIONS).replace(/\\/g, '/')}（当前 ${readCollections().items.length} 条）`);
      console.log('  停止：Ctrl+C');
      if (!fs.existsSync(path.join(ROOT, PAGE))) {
        console.warn(`  [!] 没找到 ${PAGE}，页面会 404。先跑一次构建：node scripts/finish-build.mjs`);
      } else if (!fs.existsSync(path.join(ROOT, '画师类', 'manifest.json'))) {
        console.warn('  [!] 没找到 画师类/manifest.json，页面会显示「载入失败」。先跑一次构建：node scripts/build-hierarchy.mjs && node scripts/finish-build.mjs');
      }
      openBrowser(url);
      return;
    }
    // ③ 端口被别的程序占着 → 记一下原因，继续往后找
    lastCode = r.code || 'ERROR';
    if (r.code !== 'EADDRINUSE') break;
  }
  console.error(`端口 ${port} 起的 20 个端口都起不来（最后错误：${lastCode}）。`);
  console.error(`手动换端口再试：node scripts/serve-kb.mjs 8200`);
  process.exit(1);
})();
