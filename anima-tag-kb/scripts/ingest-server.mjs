// 本地落盘接收器：浏览器端脚本把抓到的 HTML POST 过来，这里写盘。
// 用法: node scripts/ingest-server.mjs [port]   默认 8101
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.argv[2] || 8101);
const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'data', 'taggroups-html');
fs.mkdirSync(OUT, { recursive: true });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

http
  .createServer((req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
    if (req.method !== 'POST') {
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
      return res.end('{"ok":true,"hint":"POST {file,html}"}');
    }
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const { file, html } = JSON.parse(body);
        const safe = path.basename(String(file));
        fs.writeFileSync(path.join(OUT, safe), String(html), 'utf8');
        res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, file: safe, bytes: String(html).length }));
      } catch (e) {
        res.writeHead(500, { ...CORS, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
  })
  .listen(PORT, '127.0.0.1', () => console.log('ingest listening on http://127.0.0.1:' + PORT));
