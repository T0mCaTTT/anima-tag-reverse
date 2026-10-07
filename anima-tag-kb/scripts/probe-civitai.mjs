/** probe-civitai.mjs —— 看 Civitai 上 Anima 生态可匿名取到什么（模型信息 / 示例提示词 / 标签）。 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const get = async u => { const r = await fetch(u, { headers: { 'User-Agent': UA, 'Accept': 'application/json' }, signal: AbortSignal.timeout(25000) }); return { status: r.status, txt: await r.text() }; };

for (const q of ['anima', 'anima 2b', 'animadex']) {
  const r = await get(`https://civitai.com/api/v1/models?limit=6&query=${encodeURIComponent(q)}`);
  let j = null; try { j = JSON.parse(r.txt); } catch {}
  console.log(`\n=== query=${q}  status=${r.status}  items=${j?.items?.length ?? '?'}`);
  for (const it of (j?.items || [])) {
    const v = it.modelVersions?.[0] || {};
    const desc = (it.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    console.log(`- ${it.name} | type=${it.type} | nsfw=${it.nsfw} | downloads=${it.stats?.downloadCount} | versions=${it.modelVersions?.length}`);
    console.log(`    trainedWords: ${JSON.stringify((v.trainedWords || []).slice(0, 6))}`);
    console.log(`    desc[0:260]: ${desc.slice(0, 260)}`);
    if (/prompt/i.test(desc)) {
      const m = desc.match(/.{0,80}prompt.{0,180}/i);
      if (m) console.log(`    ★ 含 prompt 片段: ${m[0]}`);
    }
  }
}

// 社区标签表
const t = await get('https://civitai.com/api/v1/tags?limit=100');
let tj = null; try { tj = JSON.parse(t.txt); } catch {}
console.log(`\n=== civitai tags status=${t.status} 数量=${tj?.items?.length ?? '?'}`);
console.log((tj?.items || []).map(x => x.name).join(', ').slice(0, 900));
