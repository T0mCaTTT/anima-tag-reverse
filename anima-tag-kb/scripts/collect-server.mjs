// 通用落盘接收器：浏览器端把抓到的行数据 POST 过来，这里追加写 data/sources/<name>.jsonl
// 用法: node scripts/collect-server.mjs [port]     默认 8199
//   POST /            {name, rows:[...]}  或 {name, text:"..."}
//   GET  /status      各文件行数
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.argv[2] || 8199);
const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'data', 'sources');
fs.mkdirSync(OUT, { recursive: true });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const stat = () => {
  const o = {};
  for (const f of fs.readdirSync(OUT)) {
    const p = path.join(OUT, f);
    if (!f.endsWith('.jsonl')) { o[f] = 'file ' + fs.statSync(p).size + 'B'; continue; }
    o[f] = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).length + ' 行';
  }
  return o;
};

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  if (req.method === 'GET') {
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true, files: stat() }, null, 1));
  }
  let body = '';
  req.setEncoding('utf8');
  req.on('data', c => { body += c; });
  req.on('end', () => {
    try {
      const { name, rows, text } = JSON.parse(body);
      const safe = path.basename(String(name || 'misc')).replace(/[^\w.-]/g, '_');
      const file = path.join(OUT, safe.endsWith('.jsonl') ? safe : safe + '.jsonl');
      const lines = Array.isArray(rows) ? rows.map(r => JSON.stringify(r)).join('\n') + '\n'
        : (typeof text === 'string' ? text.split('\n').filter(Boolean).map(l => l.trim()).join('\n') + '\n' : '');
      fs.appendFileSync(file, lines, 'utf8');
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, file: path.basename(file), added: Array.isArray(rows) ? rows.length : lines.split('\n').filter(Boolean).length }));
    } catch (e) {
      res.writeHead(500, { ...CORS, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  });
}).listen(PORT, '127.0.0.1', () => console.log('collect listening on http://127.0.0.1:' + PORT + '  → ' + OUT));
