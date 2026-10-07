/** probe-sources.mjs —— 只探测各站点从本机 Node 直连可达性，不落库。 */
const targets = [
  ['yande.re tag.json', 'https://yande.re/tag.json?limit=3&order=count'],
  ['yande.re post.json', 'https://yande.re/post.json?limit=2&tags=rating%3Asafe'],
  ['konachan.com tag.json', 'https://konachan.com/tag.json?limit=3&order=count'],
  ['konachan.net tag.json', 'https://konachan.net/tag.json?limit=3&order=count'],
  ['e-shuushuu tags', 'https://e-shuushuu.net/tags?sort=count&page=1'],
  ['e-shuushuu api', 'https://e-shuushuu.net/api/v1/tags?limit=3'],
  ['gelbooru dapi tag', 'https://gelbooru.com/index.php?page=dapi&s=tag&q=index&json=1&limit=3&orderby=count'],
  ['gelbooru tags html', 'https://gelbooru.com/index.php?page=tags&s=list&sort=desc&order_by=count&pid=0'],
  ['gelbooru autocomplete', 'https://gelbooru.com/autocomplete.php?q=hair&limit=5'],
  ['civitai images', 'https://civitai.com/api/v1/images?limit=2&sort=Most%20Reactions&period=AllTime&nsfw=None'],
  ['civitai tags', 'https://civitai.com/api/v1/tags?limit=5'],
  ['danbooru posts', 'https://danbooru.donmai.us/tags.json?limit=3&search[order]=count'],
];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
for (const [name, url] of targets) {
  const t0 = Date.now();
  try {
    const ctl = AbortSignal.timeout(20000);
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json,text/html,*/*' }, signal: ctl });
    const txt = await r.text();
    const ct = r.headers.get('content-type') || '';
    const head = txt.slice(0, 110).replace(/\s+/g, ' ');
    console.log(`${String(r.status).padEnd(4)} ${String(txt.length).padStart(7)}B ${String(Date.now() - t0).padStart(5)}ms  ${ct.split(';')[0].padEnd(20)} ${name}\n      ${head}`);
  } catch (e) {
    console.log(`ERR  ${name}: ${e.name} ${e.message}`);
  }
}
