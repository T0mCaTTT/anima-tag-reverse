/* collections-core.js —— 「tag 串收藏」的纯逻辑层
 *
 * 为什么单独一个文件：收藏逻辑（归一化 / 内容去重 / 改名 / 备注 / 置顶排序 /
 * 导入导出 / 双端合并）要能脱离浏览器单独被测。这一层不碰 DOM、不碰 fetch、
 * 不碰 localStorage，浏览器与 Node 共用同一份代码：
 *
 *   - 浏览器：<script src="collections-core.js"></script> → window.KBCollections
 *   - Node  ：const C = require('./viewer/collections-core.js')   （零依赖）
 *
 * 构建时（scripts/finish-build.mjs）会把本文件内联进 anima-tag-exhibition.html，
 * 所以展览版仍然是单文件、可直接双击打开。
 *
 * 数据模型（v1）：
 *   {
 *     v: 1,
 *     items: [{
 *       id, name, tags: [...], cats: {tag: catId}, note, pinned, order,
 *       createdAt, updatedAt, ctx: { cat, sub, q, mode }
 *     }],
 *     tombstones: { <id>: <删除时间 ISO> }     // 让「删除」也能跨浏览器同步（不会被远端复活）
 *   }
 * 说明：`key` 是 tags 归一后（小写、下划线=空格、忽略顺序）拼出的指纹，用于内容去重；
 * 它是派生字段，每次校验都会重算，不参与持久化语义。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;   // Node (CJS)
  else root.KBCollections = api;                                            // 浏览器
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = 1;
  const KEY_SEP = '\u0001';
  const DAY = 86400000;
  const LIMITS = { name: 80, note: 300, tags: 200, items: 500, tombstones: 400, tombDays: 30 };

  /* ---------- 小工具 ---------- */
  const iso = now => new Date(now == null ? Date.now() : now).toISOString();
  const ms = v => { const t = Date.parse(v); return Number.isFinite(t) ? t : 0; };
  const isPlainObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  function newId(now) {
    return 'c' + (now == null ? Date.now() : now).toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function str(v, max) {
    const s = String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
    return max ? s.slice(0, max) : s;
  }

  /* ---------- 归一化与指纹 ---------- */
  /** 标签归一：小写、下划线与空格等价、去掉多余空白（官方写法是空格，库里两种混用） */
  function normTag(t) {
    return String(t == null ? '' : t).replace(/[\s\u3000]+/g, ' ').trim().replace(/[_\s]+/g, ' ').toLowerCase();
  }
  /** 归一 + 去重（保留原顺序），输入可以是数组或 "a, b, c" 字符串 */
  function normTags(tags) {
    const arr = Array.isArray(tags) ? tags : (typeof tags === 'string' ? tags.split(/[,，;；\n]+/) : []);
    const seen = new Set(), out = [];
    for (const t of arr) {
      const n = normTag(t);
      if (!n || seen.has(n)) continue;
      seen.add(n);
      out.push(n);
    }
    return out;
  }
  /** 内容指纹：忽略顺序的归一标签串 */
  function keyOf(tags) { return normTags(tags).slice().sort().join(KEY_SEP); }
  /** 两组标签是否「内容相同」（忽略顺序、大小写、下划线/空格） */
  function equalsTags(a, b) { return keyOf(a) === keyOf(b); }

  /* ---------- 命名 ---------- */
  function defaultName(tags, maxLen) {
    const t = normTags(tags);
    if (!t.length) return '空标签串';
    const base = t.length === 1 ? t[0] : `${t[0]} 等 ${t.length} 个`;
    return str(base, maxLen || 48);
  }
  /** 自动名去重：同名就加 (2) (3)…（用户手填的名字不做限制，允许重复） */
  function uniqueName(items, name, excludeId) {
    const base = str(name, LIMITS.name) || '未命名';
    const taken = new Set((items || []).filter(it => it.id !== excludeId).map(it => String(it.name).toLowerCase()));
    if (!taken.has(base.toLowerCase())) return base;
    for (let n = 2; n < 999; n++) {
      const cand = `${base} (${n})`;
      if (!taken.has(cand.toLowerCase())) return cand;
    }
    return `${base} (${Date.now()})`;
  }

  /* ---------- 校验 / 规范化 ---------- */
  function cleanCtx(ctx) {
    const c = isPlainObj(ctx) ? ctx : {};
    return { cat: str(c.cat, 64), sub: str(c.sub, 64), q: str(c.q, 200), mode: str(c.mode, 16) };
  }
  function cleanCats(cats, tags) {
    const src = isPlainObj(cats) ? cats : {};
    const out = {};
    for (const t of tags) {
      const v = str(src[t], 64);
      if (v) out[t] = v;
    }
    return out;
  }
  /** 单个条目的规范化：坏数据就地修好，返回 null 表示这条没法救（没有标签） */
  function normItem(raw, now) {
    if (!isPlainObj(raw)) return null;
    const tags = normTags(raw.tags);
    if (!tags.length) return null;
    const t = now == null ? Date.now() : now;
    return {
      id: str(raw.id, 64) || newId(t + Math.floor(Math.random() * 1000)),
      name: str(raw.name, LIMITS.name) || defaultName(tags),
      tags,
      cats: cleanCats(raw.cats, tags),
      note: str(raw.note, LIMITS.note),
      pinned: !!raw.pinned,
      order: Number.isFinite(raw.order) ? raw.order : (ms(raw.createdAt) || t),
      createdAt: ms(raw.createdAt) ? new Date(ms(raw.createdAt)).toISOString() : iso(t),
      updatedAt: ms(raw.updatedAt) ? new Date(ms(raw.updatedAt)).toISOString() : iso(t),
      ctx: cleanCtx(raw.ctx),
      key: keyOf(tags)
    };
  }
  /** 把任意输入（null / 数组 / {items} / {v,items}）整理成合法 state */
  function validate(raw, opts) {
    const now = (opts && opts.now) == null ? Date.now() : opts.now;
    const src = Array.isArray(raw) ? { items: raw } : (isPlainObj(raw) ? raw : {});
    const arr = Array.isArray(src.items) ? src.items : [];
    const errors = [];
    const items = [], byId = new Map(), byKey = new Map();
    let dropped = 0;
    for (const r of arr) {
      const it = normItem(r, now);
      if (!it) { dropped++; continue; }
      const sameId = byId.get(it.id);
      if (sameId) {                       // id 撞了：重发一个 id，不丢数据
        it.id = newId(now + items.length);
        errors.push('重复 id 已改写：' + (r && r.id));
      }
      const sameKey = byKey.get(it.key);   // 内容重复：留更新的那条（自动去重）
      if (sameKey) {
        dropped++;
        if (ms(it.updatedAt) > ms(sameKey.updatedAt)) Object.assign(sameKey, it);
        continue;
      }
      items.push(it); byId.set(it.id, it); byKey.set(it.key, it);
      if (items.length >= LIMITS.items) { dropped += arr.length - items.length - dropped; break; }
    }
    const tombs = {};
    const srcTombs = isPlainObj(src.tombstones) ? src.tombstones : {};
    for (const [id, when] of Object.entries(srcTombs)) {
      const t = ms(when);
      if (!t || now - t > LIMITS.tombDays * DAY) continue;
      tombs[str(id, 64)] = new Date(t).toISOString();
    }
    // 墓碑比条目新 → 这条确实被删过，丢弃
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (tombs[it.id] && ms(tombs[it.id]) >= ms(it.updatedAt)) { items.splice(i, 1); byId.delete(it.id); byKey.delete(it.key); dropped++; }
    }
    // 墓碑数量上限（留最新的）
    const tkeys = Object.keys(tombs);
    if (tkeys.length > LIMITS.tombstones) {
      tkeys.sort((a, b) => ms(tombs[b]) - ms(tombs[a]))
        .slice(LIMITS.tombstones)
        .forEach(k => delete tombs[k]);
    }
    return { ok: errors.length === 0, errors, dropped, state: { v: VERSION, items, tombstones: tombs } };
  }
  const empty = () => ({ v: VERSION, items: [], tombstones: {} });

  /* ---------- 查询 ---------- */
  const itemsOf = state => validate(state).state.items;
  const getById = (state, id) => itemsOf(state).find(it => it.id === id) || null;
  const findByKey = (state, tags) => { const k = keyOf(tags); return itemsOf(state).find(it => it.key === k) || null; };
  /** 显示顺序：置顶优先 → order 升序 → 创建时间、id 兜底（保证稳定） */
  function sortList(items) {
    return items.slice().sort((a, b) =>
      (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) ||
      a.order - b.order ||
      ms(a.createdAt) - ms(b.createdAt) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  const sortedItems = state => sortList(itemsOf(state));
  const nextOrder = state => { const l = itemsOf(state); return l.length ? Math.max(...l.map(i => i.order)) + 1 : 0; };
  const tagList = item => normTags(item && item.tags);
  /** 「用这串搜索」填进搜索框的内容 */
  const searchQueryOf = item => tagList(item).join(', ');
  function stats(state) {
    const st = validate(state).state;
    return {
      count: st.items.length,
      pinned: st.items.filter(i => i.pinned).length,
      tags: st.items.reduce((s, i) => s + i.tags.length, 0),
      tombstones: Object.keys(st.tombstones).length,
      updatedAt: st.items.reduce((m, i) => Math.max(m, ms(i.updatedAt)), 0) || null
    };
  }
  function describe(item) {
    const ctx = cleanCtx(item && item.ctx);
    const where = [];
    if (ctx.cat) where.push(ctx.cat);
    if (ctx.sub) where.push(ctx.sub);
    if (ctx.q) where.push(`搜索「${ctx.q}」`);
    return { tags: tagList(item).length, note: str(item && item.note, LIMITS.note), from: where.join(' / ') };
  }

  /* ---------- 增删改 ---------- */
  /** 收藏一串标签；内容重复直接返回已有那条（dup），不新增。
   *  命名规则（用户定的）：不填名字时自动生成并避开重名（加 (2)）；手填的名字允许重复。 */
  function add(state, opts) {
    const o = opts || {};
    const now = o.now == null ? Date.now() : o.now;
    const st = validate(state, { now }).state;
    const tags = normTags(o.tags).slice(0, LIMITS.tags);
    if (!tags.length) return { state: st, item: null, dup: null, reason: 'empty' };
    const dup = findByKey(st, tags);
    if (dup && !o.allowDup) return { state: st, item: null, dup, reason: 'dup' };
    const item = {
      id: str(o.id, 64) || newId(now),
      name: o.name ? str(o.name, LIMITS.name) : uniqueName(st.items, defaultName(tags)),
      tags,
      cats: cleanCats(o.cats, tags),
      note: str(o.note, LIMITS.note),
      pinned: !!o.pinned,
      order: Number.isFinite(o.order) ? o.order : nextOrder(st),
      createdAt: iso(now),
      updatedAt: iso(now),
      ctx: cleanCtx(o.ctx),
      key: keyOf(tags)
    };
    st.items.push(item);
    return { state: st, item, dup: null, reason: 'ok' };
  }
  function patch(state, id, fields, now) {
    const t = now == null ? Date.now() : now;
    const st = validate(state, { now: t }).state;
    const it = st.items.find(x => x.id === id);
    if (!it) return { state: st, item: null, error: 'not-found' };
    Object.assign(it, fields);
    if (fields.tags) { it.tags = normTags(fields.tags); it.cats = cleanCats(fields.cats || it.cats, it.tags); it.key = keyOf(it.tags); }
    it.updatedAt = iso(t);
    return { state: st, item: it, error: null };
  }
  const rename = (state, id, name, now) => patch(state, id, { name: str(name, LIMITS.name) || '未命名' }, now);
  const setNote = (state, id, note, now) => patch(state, id, { note: str(note, LIMITS.note) }, now);
  const togglePin = (state, id, now) => {
    const it = getById(state, id);
    return it ? patch(state, id, { pinned: !it.pinned }, now) : { state: validate(state).state, item: null, error: 'not-found' };
  };
  /** 上移/下移一位（在当前显示顺序里换位，然后把顺序重排成 0..n-1）
   *  注意：这里必须直接排 st.items —— validate() 每次都会产出新的条目对象，
   *  拿 sortedItems(st) 的结果去改 order 会改到副本上（顺序纹丝不动）。 */
  function move(state, id, delta, now) {
    const t = now == null ? Date.now() : now;
    const st = validate(state, { now: t }).state;
    const list = sortList(st.items);
    const i = list.findIndex(it => it.id === id);
    if (i < 0) return { state: st, moved: false, index: -1 };
    const j = Math.max(0, Math.min(list.length - 1, i + Number(delta || 0)));
    if (j === i) return { state: st, moved: false, index: i };
    const [it] = list.splice(i, 1);
    list.splice(j, 0, it);
    list.forEach((x, k) => { x.order = k; if (x.id === id) x.updatedAt = iso(t); });
    return { state: st, moved: true, index: j };
  }
  /** 删除：条目移除 + 落一个墓碑（保证跨浏览器/跨端口不会被远端重新合并回来） */
  function remove(state, id, now) {
    const t = now == null ? Date.now() : now;
    const st = validate(state, { now: t }).state;
    const i = st.items.findIndex(x => x.id === id);
    if (i < 0) return { state: st, removed: null };
    const [removed] = st.items.splice(i, 1);
    st.tombstones[removed.id] = iso(t);
    return { state: st, removed };
  }
  const clear = (state, now) => {
    const t = now == null ? Date.now() : now;
    const st = validate(state, { now: t }).state;
    const n = st.items.length;
    st.items.forEach(it => { st.tombstones[it.id] = iso(t); });
    st.items = [];
    return { state: st, removed: n };
  };

  /* ---------- 导入 / 导出 / 合并 ---------- */
  function exportJSON(state, opts) {
    const st = validate(state).state;
    const payload = { v: VERSION, kind: 'anima-tag-collections', exportedAt: iso(opts && opts.now), items: st.items, tombstones: st.tombstones };
    return JSON.stringify(payload, null, 2);
  }
  /** 导入：吃掉数组 / {items} / 导出文件 / 字符串；去重、修坏字段，返回落地结果 */
  function importState(raw, opts) {
    const now = (opts && opts.now) == null ? Date.now() : opts.now;
    let data = raw;
    if (typeof raw === 'string') { try { data = JSON.parse(raw); } catch (e) { return { state: empty(), added: 0, skipped: 0, error: 'parse-failed' }; } }
    if (!Array.isArray(data) && !isPlainObj(data) && data != null) return { state: empty(), added: 0, skipped: 0, error: 'bad-shape' };
    const incoming = validate(data, { now });
    const base = (opts && opts.base) ? validate(opts.base, { now }).state : empty();
    const merged = mergeStates(base, incoming.state, { now }).state;
    return { state: merged, added: merged.items.length - base.items.length, skipped: incoming.dropped, error: null };
  }
  /** 双端合并：按 id 取更新的那条；墓碑压过更旧的条目；内容重复合并成一条 */
  function mergeStates(a, b, opts) {
    const now = (opts && opts.now) == null ? Date.now() : opts.now;
    const A = validate(a, { now }).state, B = validate(b, { now }).state;
    const tombs = {};
    for (const src of [A.tombstones, B.tombstones]) {
      for (const [id, when] of Object.entries(src || {})) {
        if (!tombs[id] || ms(when) > ms(tombs[id])) tombs[id] = when;
      }
    }
    const byId = new Map();
    let added = 0, updated = 0;
    for (const src of [A, B]) {
      for (const it of src.items) {
        const cur = byId.get(it.id);
        if (!cur) { byId.set(it.id, it); if (src === B) added++; continue; }
        if (ms(it.updatedAt) > ms(cur.updatedAt)) { Object.assign(cur, it); updated++; }
      }
    }
    const out = [], byKey = new Map();
    for (const it of byId.values()) {
      if (tombs[it.id] && ms(tombs[it.id]) >= ms(it.updatedAt)) continue;
      const dup = byKey.get(it.key);
      if (dup) { if (ms(it.updatedAt) > ms(dup.updatedAt)) Object.assign(dup, it); continue; }
      out.push(it); byKey.set(it.key, it);
    }
    const merged = validate({ v: VERSION, items: out, tombstones: tombs }, { now }).state;
    return { state: merged, added, updated, total: merged.items.length };
  }

  return {
    VERSION, LIMITS,
    normTag, normTags, keyOf, equalsTags,
    defaultName, uniqueName,
    empty, validate, normItem, cleanCtx,
    itemsOf, getById, findByKey, sortedItems, nextOrder, tagList, searchQueryOf, stats, describe,
    add, patch, rename, setNote, togglePin, move, remove, clear,
    exportJSON, importState, mergeStates,
    _internal: { KEY_SEP, newId, str, ms, iso }
  };
});
