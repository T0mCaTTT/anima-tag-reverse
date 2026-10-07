/** probe-sources2.mjs —— 细化参数：分页上限、字段结构、civitai meta 是否可取。 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const get = async (url, opt = {}) => {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json,text/html,*/*', ...(opt.headers || {}) }, signal: AbortSignal.timeout(25000) });
  const txt = await r.text();
  return { status: r.status, txt };
};

// 1. e-shuushuu API 分页与排序
for (const u of [
  'https://e-shuushuu.net/api/v1/tags?limit=5&page=2&sort=count',
  'https://e-shuushuu.net/api/v1/tags?limit=5&sort=count&order=desc',
  'https://e-shuushuu.net/api/v1/tags?limit=5&page=1',
]) {
  const r = await get(u);
  console.log(`\n[e-shuushuu] ${r.status} ${u}\n  ${r.txt.slice(0, 420).replace(/\s+/g, ' ')}`);
}

// 2. yande.re 分页上限
for (const u of [
  'https://yande.re/tag.json?limit=1000&order=count&page=1',
  'https://yande.re/tag.json?limit=100&order=count&page=1',
]) {
  const r = await get(u);
  let n = -1;
  try { n = JSON.parse(r.txt).length; } catch {}
  console.log(`\n[yande.re] ${r.status} 条数=${n}  ${u}`);
}

// 3. civitai：meta/prompt 可得性
for (const u of [
  'https://civitai.com/api/v1/images?limit=10&sort=Most%20Reactions&period=Month&nsfw=None',
  'https://civitai.com/api/v1/images?limit=10&sort=Newest&nsfw=None',
  'https://civitai.com/api/v1/images?limit=10&sort=Most%20Reactions&period=Month&nsfw=X',
]) {
  const r = await get(u);
  let withMeta = 0, withPrompt = 0, sample = '';
  try {
    const j = JSON.parse(r.txt);
    for (const it of j.items || []) {
      if (it.meta) withMeta++;
      if (it.meta && it.meta.prompt) { withPrompt++; if (!sample) sample = it.meta.prompt.slice(0, 150); }
    }
  } catch (e) { sample = 'parse-fail'; }
  console.log(`\n[civitai] ${r.status} items 有meta=${withMeta} 有prompt=${withPrompt}\n  ${u}\n  样例: ${sample.replace(/\s+/g, ' ')}`);
}

// 4. gelbooru 换 UA / 换路径重试
for (const u of [
  'https://gelbooru.com/index.php?page=tags&s=list&sort=desc&order_by=count&pid=0',
  'https://gelbooru.com/index.php?page=post&s=list&tags=rating%3Ageneral',
  'https://safebooru.org/index.php?page=tags&s=list&sort=desc&order_by=count',
]) {
  const r = await get(u, { headers: { 'Accept-Language': 'en-US,en;q=0.9', 'Referer': 'https://gelbooru.com/' } });
  console.log(`\n[gelbooru/safe] ${r.status} ${r.txt.length}B  ${u}\n  ${r.txt.slice(0, 160).replace(/\s+/g, ' ')}`);
}
