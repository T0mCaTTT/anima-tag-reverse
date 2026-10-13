/**
 * dims.mjs —— 可搬运维度槽位表（双图融合的「坐标系」）
 *
 * 双图融合的本质是「按维度选源」：把一张画的观察结果拆成互不重叠的槽位，
 * 每个槽位单独指定从图 A 还是图 B 取。本文件就是这个坐标系，同时提供
 * 中/英文自然语言的维度别名匹配（供 intent.mjs 使用）。
 *
 * 设计取舍（踩过就知道疼）：
 *   - **只收两个字以上的别名**。单字别名（脸 / 手 / 腿 / 人 / 图）在中文里误命中率极高：
 *     「侧脸」是表情的**值**、「手里拿着伞」是动作描述，一旦把值当成维度词，
 *     整组槽位会被错误换源，而且错得很安静。
 *   - **组级 + 子级两层**。`pose` 是组级（整组换源），`pose.hands` 是子级（只换手）。
 *     子级更具体、优先级更高：同一句里「图1的姿势，手用图2的」最终是 hands←2、其余 pose←1。
 *   - 「人 / 身上 / 主体 / 角色」**不算维度词**，只算宿主证据（见 refs.mjs），
 *     否则「图1的姿势放到图2的人身上」会把 subject（人数）也判给图2 —— 典型误伤。
 *   - 别名匹配「长的优先、区间独占」：`人物外观` 命中后，里面的 `人物` 不再单独命中。
 */

/** 槽位树：组节点带 children，叶子节点没有 */
export const SLOT_TREE = [
  {
    id: 'subject',
    label: '人数 / 性别',
    aliases: ['人数', '性别', '几个人', '人物数量', '单双人', '性别年龄', '年龄']
  },
  {
    id: 'characters',
    label: '角色身份',
    aliases: ['角色', '角色身份', '人物身份', '角色名', '人物是谁', '是谁', '哪个角色', '本命角色']
  },
  {
    id: 'series',
    label: '作品 / 出处',
    aliases: ['作品', '出处', '系列', '版权', '来自哪个作品', '哪个作品']
  },
  {
    id: 'appearance',
    label: '人物外观',
    aliases: ['外貌', '长相', '样貌', '形象', '外观', '人物外观', '人物形象', '人设', '颜值', '面孔', '面容', '脸型', '脸部特征'],
    children: [
      { id: 'hair', label: '发色 / 头发', aliases: ['发色', '头发颜色', '头发色', '毛色', '头发'] },
      { id: 'hair_style', label: '发型', aliases: ['发型', '头发样式', '发式', '刘海', '头发长度', '长短发'] },
      { id: 'eyes', label: '眼睛 / 瞳色', aliases: ['瞳色', '眼睛颜色', '眼色', '眼型', '眼睛'] },
      { id: 'expression', label: '表情 / 神态', aliases: ['表情', '神态', '神情', '面部表情'] },
      { id: 'body', label: '体型 / 身材', aliases: ['体型', '身材', '体格', '身体比例'] },
      { id: 'skin', label: '肤色', aliases: ['肤色', '皮肤', '肌肤'] },
      { id: 'special', label: '特殊特征', aliases: ['特殊特征', '兽耳', '异色瞳', '特殊标记', '身体特征'] }
    ]
  },
  {
    id: 'outfit',
    label: '服装',
    aliases: ['服装', '衣服', '穿搭', '穿着', '衣着', '服饰', '衣裳', '服装造型', '行头', '装束'],
    children: [
      { id: 'top', label: '上衣', aliases: ['上衣', '上装', '上身穿着'] },
      { id: 'bottom', label: '下装', aliases: ['下装', '下身穿着', '裤子', '裤装'] },
      { id: 'dress', label: '连衣裙 / 长裙', aliases: ['连衣裙', '长裙', '连身裙'] },
      { id: 'legwear', label: '腿袜', aliases: ['腿袜', '袜子', '丝袜', '过膝袜', '腿部穿着', '腿部服饰'] },
      { id: 'footwear', label: '鞋', aliases: ['鞋子', '靴子', '鞋履'] },
      { id: 'headwear', label: '头部装饰', aliases: ['帽子', '头饰', '头戴', '头部装饰'] },
      { id: 'accessories', label: '配饰', aliases: ['配饰', '饰品', '首饰', '挂件', '装饰品'] },
      { id: 'held', label: '手持物', aliases: ['手持', '手持物', '手里的东西', '手上拿的'] }
    ]
  },
  {
    id: 'pose',
    label: '姿势 / 动作',
    aliases: ['姿势', '动作', '姿态', '肢体动作', '造型', '体位', 'pose'],
    children: [
      { id: 'action', label: '主要动作', aliases: ['主要动作', '身体动作', '整体动作'] },
      { id: 'hands', label: '手势', aliases: ['手势', '手部', '手的姿势', '手部动作', '双手'] },
      { id: 'legs', label: '腿部动作', aliases: ['腿部动作', '腿的姿势', '腿部', '双腿'] },
      { id: 'facing', label: '朝向 / 面向', aliases: ['朝向', '面向', '面向方向', '身体朝向'] }
    ]
  },
  {
    id: 'scene',
    label: '场景 / 背景',
    aliases: ['场景', '背景', '环境', '场地', '地点', '所处环境', '背景环境'],
    children: [
      { id: 'location', label: '地点', aliases: ['地点', '场所', '位置', '在哪', '所在地'] },
      { id: 'time', label: '时间 / 时段', aliases: ['时间', '时段', '白天黑夜', '时辰'] },
      { id: 'weather', label: '天气', aliases: ['天气', '气候'] },
      { id: 'props', label: '道具 / 物件', aliases: ['道具', '物品', '物件', '摆设', '陈设'] }
    ]
  },
  {
    id: 'style',
    label: '画风 / 画面',
    aliases: ['画风', '风格', '画法', '作画', '画面风格', '美术风格', '渲染风格'],
    children: [
      { id: 'medium', label: '媒介 / 画法', aliases: ['媒介', '画法类型', '渲染方式', '作画媒介'] },
      { id: 'artist_style', label: '画师风格', aliases: ['画师风格', '笔触', '风格倾向'] },
      { id: 'lighting', label: '打光 / 光影', aliases: ['打光', '光照', '光线', '光感', '光影', '光照方式'] },
      { id: 'light_direction', label: '光位', aliases: ['光位', '光源方向', '光的方向', '光照方向'] },
      { id: 'camera', label: '镜头 / 视角', aliases: ['镜头', '视角', '机位', '观察角度', '拍摄角度'] },
      { id: 'framing', label: '景别 / 取景', aliases: ['景别', '取景', '取景范围', '构图范围', '裁切范围'] },
      { id: 'composition', label: '构图', aliases: ['构图', '画面排布'] },
      { id: 'palette', label: '色调 / 配色', aliases: ['色调', '配色', '色彩', '色系'] },
      { id: 'quality', label: '画面质感', aliases: ['质感', '画面质感', '精细度', '完成度'] }
    ]
  },
  {
    id: 'artists',
    label: '画师',
    aliases: ['画师', '作者', '绘师', '画师标签', '作画者']
  },
  {
    id: 'nsfw',
    label: '分级 / 尺度',
    aliases: ['分级', '尺度', '露骨程度', 'r18', 'nsfw', 'r-18']
  },
  {
    id: 'negative',
    label: '负向 / 排除项',
    aliases: ['负面', '负向', '负面提示', '排除项', '不要的']
  }
];

/** 展平成索引：path → 槽位描述（path 用点号，如 `pose.hands`） */
function flattenTree() {
  const byPath = new Map();
  const walk = (nodes, parentPath, group) => {
    for (const n of nodes) {
      const path = parentPath ? `${parentPath}.${n.id}` : n.id;
      const slot = {
        path,
        id: n.id,
        label: n.label,
        group: group || (n.children ? n.id : null),   // 组级槽位自己也属于自己这组
        aliases: n.aliases || [],
        isGroup: !!n.children,
        children: (n.children || []).map(c => (parentPath ? `${parentPath}.` : '') + `${n.id}.${c.id}`)
      };
      byPath.set(path, slot);
      if (n.children) walk(n.children, path, n.id);
    }
  };
  walk(SLOT_TREE, '', null);
  return byPath;
}

export const SLOTS = flattenTree();

/** 别名 → 槽位（长的优先，保证「人物外观」赢过「人物」） */
const ALIAS_PAIRS = (() => {
  const pairs = [];
  for (const slot of SLOTS.values()) {
    for (const a of slot.aliases) pairs.push({ alias: a, slot });
  }
  return pairs.sort((x, y) => y.alias.length - x.alias.length || (x.alias < y.alias ? -1 : 1));
})();

const isAscii = s => /^[\x20-\x7e]+$/.test(s);

/** 英文别名要词边界：避免 `shot` 命中 `screenshot`、`pose` 命中 `compose` */
function boundaryOk(text, at, len) {
  const before = at > 0 ? text[at - 1] : '';
  const after = at + len < text.length ? text[at + len] : '';
  const wordish = c => /[a-z0-9_]/i.test(c);
  return !wordish(before) && !wordish(after);
}

/**
 * 在文本里找维度词。
 * @returns {Array<{path,label,group,isGroup,alias,start,end}>} 按出现位置排序
 */
export function matchDims(text) {
  const src = String(text || '');
  const lowered = src.toLowerCase();
  const taken = [];
  const hits = [];
  const seen = new Set();
  for (const { alias, slot } of ALIAS_PAIRS) {
    const needle = isAscii(alias) ? alias.toLowerCase() : alias;
    let from = 0;
    for (;;) {
      const i = lowered.indexOf(needle, from);
      if (i < 0) break;
      from = i + 1;
      const end = i + needle.length;
      if (taken.some(([s, e]) => i < e && s < end)) continue;
      if (isAscii(alias) && !boundaryOk(lowered, i, needle.length)) continue;
      const key = `${slot.path}@${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      taken.push([i, end]);
      hits.push({ path: slot.path, label: slot.label, group: slot.group, isGroup: slot.isGroup, alias, start: i, end });
    }
  }
  return hits.sort((x, y) => x.start - y.start || y.alias.length - x.alias.length);
}

/** 槽位是否存在（容错：允许写 `pose`、`pose.hands`、叶子名 `hands`，也允许直接写中文别名 `姿势`） */
export function resolveSlotPath(name) {
  const raw = String(name || '').trim();
  if (!raw) return null;
  if (SLOTS.has(raw)) return raw;
  const lower = raw.toLowerCase();
  for (const p of SLOTS.keys()) if (p.toLowerCase() === lower) return p;
  const byId = [...SLOTS.entries()].filter(([, s]) => s.id.toLowerCase() === lower);
  if (byId.length) return byId[0][0];                 // 只写叶子名（唯一时可用）
  const byAlias = [...SLOTS.entries()].filter(([, s]) => s.aliases.some(a => a.toLowerCase() === lower));
  if (byAlias.length) return byAlias[0][0];           // 中文/英文别名精确匹配
  return null;
}

/** 该槽位覆盖的所有叶子路径（组级 → 该组全部子级；叶子 → 自己） */
export function leafPathsOf(path) {
  const slot = SLOTS.get(path);
  if (!slot) return [];
  if (!slot.isGroup) return [path];
  return [...SLOTS.values()].filter(s => s.group === slot.id && !s.isGroup).map(s => s.path);
}

/** 人读清单（CLI `--dims` 用） */
export function dimsTable() {
  const rows = [];
  for (const slot of SLOTS.values()) {
    if (slot.isGroup) {
      rows.push({ path: slot.path, label: slot.label, aliases: slot.aliases.join(' / '), kind: '组（整组换源）' });
    }
  }
  for (const slot of SLOTS.values()) {
    if (!slot.isGroup) {
      rows.push({ path: slot.path, label: slot.label, aliases: slot.aliases.join(' / '), kind: slot.children.length ? '' : '字段' });
    }
  }
  return rows;
}

/* ------------------------------------------------------------------ *
 * 维度组合宏（preset）：一次点名一组常用维度
 *
 * 为什么要有：用户嘴里说的是「上身特写」「氛围感」「人物全套」这种**成组**的词，
 * 逐个维度追问既慢又烦。preset 把一组槽位打包成一个说法，命中后展开成
 * 若干条普通换源指令，后续流程与手写维度完全一致（不引入第二套语义）。
 *
 * 命名纪律：**别名不能是某个具体维度的取值或短别名**。
 * 反例：`全身`（会和「景别改成全身」的取值打架）、`上衣`（outfit.top 的别名）。
 * 所以只收「全身像 / 全身照」这类明显是**成组**的说法。
 * ------------------------------------------------------------------ */
export const PRESETS = Object.freeze([
  {
    id: 'bust',
    label: '上身特写',
    aliases: ['上身特写', '上半身', '上身部分', '半身像', '胸像', '上半部分'],
    slots: ['pose', 'appearance.expression', 'style.framing', 'style.camera']
  },
  {
    id: 'head',
    label: '头部 / 换头',
    aliases: ['换头', '头部特写', '头脸部分', '脸和头发', '头发和眼睛', '五官'],
    slots: ['appearance']
  },
  {
    id: 'fullbody',
    label: '全身像',
    aliases: ['全身像', '全身照', '整个身体', '全身部分', '全身造型'],
    slots: ['pose.action', 'pose.legs', 'outfit.legwear', 'outfit.footwear', 'style.framing']
  },
  {
    id: 'wardrobe',
    label: '整套服装',
    aliases: ['整套服装', '全套装扮', '服装全套', '整套穿搭'],
    slots: ['outfit']
  },
  {
    id: 'character',
    label: '人物全套',
    aliases: ['人物全套', '整个角色', '角色整体', '人物整体', '整个人设'],
    slots: ['appearance', 'outfit', 'pose']
  },
  {
    id: 'poseexpr',
    label: '姿势表情',
    aliases: ['姿势表情', '动作表情', '姿势和表情', '表情动作'],
    slots: ['pose', 'appearance.expression']
  },
  {
    id: 'scenelight',
    label: '场景光影',
    aliases: ['场景光影', '环境光影', '场景和光影', '场景打光', '环境光线'],
    slots: ['scene', 'style.lighting', 'style.light_direction']
  },
  {
    id: 'compo',
    label: '构图取景',
    aliases: ['构图取景', '取景构图', '镜头构图', '构图和镜头', '机位构图'],
    slots: ['style.framing', 'style.composition', 'style.camera']
  },
  {
    id: 'mood',
    label: '色调氛围',
    aliases: ['色调氛围', '氛围感', '整体氛围', '色调和光影', '画面氛围'],
    slots: ['style.palette', 'style.lighting', 'style.light_direction', 'style.quality']
  },
  {
    id: 'stylefull',
    label: '画风全套',
    aliases: ['画风全套', '整体画风', '全套画风', '画风整体'],
    slots: ['style', 'artists']   // 画师标签是独立槽位，不在 style 组里，所以「全套」要显式带上
  }
]);

const PRESET_PAIRS = (() => {
  const pairs = [];
  for (const p of PRESETS) for (const a of p.aliases) pairs.push({ alias: a, preset: p });
  return pairs.sort((x, y) => y.alias.length - x.alias.length || (x.alias < y.alias ? -1 : 1));
})();

/** 名字（别名 / id / 中文 label）→ preset */
export function resolvePreset(name) {
  const raw = String(name || '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  return PRESETS.find(p => p.id.toLowerCase() === lower || p.label === raw || p.aliases.includes(raw)) || null;
}

/**
 * 在文本里找组合宏。与 matchDims 同样「长的优先、区间独占」。
 * @returns {Array<{preset:object, alias:string, slots:string[], start:number, end:number}>}
 */
export function matchPresets(text) {
  const src = String(text || '');
  const taken = [];
  const hits = [];
  for (const { alias, preset } of PRESET_PAIRS) {
    let from = 0;
    for (;;) {
      const i = src.indexOf(alias, from);
      if (i < 0) break;
      from = i + 1;
      const end = i + alias.length;
      if (taken.some(([s, e]) => i < e && s < end)) continue;
      taken.push([i, end]);
      hits.push({ preset, alias, slots: preset.slots, start: i, end });
    }
  }
  return hits.sort((x, y) => x.start - y.start);
}

/** 组合宏 → 换源指令（展开成普通槽位；source 为图编号） */
export function expandPreset(preset, side) {
  return preset.slots.map(path => {
    const slot = SLOTS.get(path);
    return {
      path,
      side,
      label: slot ? slot.label : path,
      group: slot ? slot.group : null,
      isGroup: !!(slot && slot.isGroup),
      from: 'preset',
      preset: preset.id,
      confidence: 'explicit'
    };
  });
}

/** 人读清单（CLI `--dims` / `--presets` 用） */
export function presetsTable() {
  return PRESETS.map(p => ({
    id: p.id,
    label: p.label,
    aliases: p.aliases.join(' / '),
    slots: p.slots.join(' + ')
  }));
}
