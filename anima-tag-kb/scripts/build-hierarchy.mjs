/**
 * build-hierarchy.mjs —— 层级重构主构建器
 *
 * 输入：data/unified-tags.json（本地+toolbox 合并结果）
 *       data/tag-groups-detail.json（官方组小节）、data/tag-groups.json（官方组元信息）
 *       data/sources/danbooru-tags.jsonl（16 万条投稿量）、data/sources/weilin-danbooru.jsonl（4.98 万条中文+热度）
 *       data/sources/weilin-tags.json（WeiLin 10 大类 / 131 二级分类）
 *       scripts/taxonomy.mjs（大分类与小分类规则）
 * 输出：画师类/（manifest.json + bigs/*.json + search-index.json + README.md）、data/hierarchy-report.json
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import {
  OFFICIAL_NAME_ZH, CURATED_BIGS, CURATED_IDS, TOOLBOX_CAT, TOOLBOX_LABEL,
  WEILIN_GROUP, WEILIN_SUB_BIG, LOCAL_CAT, RULES,
} from './taxonomy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const SPLIT = path.join(ROOT, '画师类');
const BIGS_DIR = path.join(SPLIT, 'bigs');
// ai-tag-toolbox 快照目录：仓库里不留作者本机路径，用环境变量或同级目录指定
const STUDY = (() => {
  const cands = [
    process.env.ANIMA_STUDY_DIR,
    path.join(ROOT, '..', '.ai-tag-toolbox-study'),
    path.join(ROOT, '..', 'ai-tag-toolbox')
  ].filter(Boolean);
  const hit = cands.find(d => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
  if (!hit) throw new Error('找不到 ai-tag-toolbox 快照目录。请设 ANIMA_STUDY_DIR=<目录>（需含 data-tags.js / extra-tags.js / synonyms.js）。已试过：\n  ' + cands.join('\n  '));
  return hit;
})();

const norm = s => String(s == null ? '' : s).toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
const keyOf = t => { const s = norm(t); return s.startsWith('@') ? s.slice(1) : s; };
const isHan = s => /[\u4e00-\u9fff]/.test(s) && !/[\u3040-\u30ff]/.test(s);
const isPlaceholder = zh => !zh || !isHan(zh) || /^Danbooru 官方组/.test(zh) || /^AnimaTags-DB/.test(zh);
const show = t => String(t).replace(/_/g, ' ');
const PLUS = n => (n == null ? null : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n));

/* 长尾中文标注：只做可确定的模板化翻译，不臆造释义 */
const EVENT_ZH = {
  'fifa world cup': 'FIFA 世界杯', "fifa women's world cup": 'FIFA 女足世界杯', 'winter olympics': '冬季奥运会',
  'summer olympics': '夏季奥运会', "uefa champions' league": '欧洲冠军联赛', 'copa america': '美洲杯',
  'afc asian cup': '亚洲杯', "afc women's asian cup": '女足亚洲杯', 'world baseball classic': '世界棒球经典赛',
  'super bowl': '超级碗', 'world series': '世界大赛', 'winter paralympics': '冬季残奥会', 'summer paralympics': '夏季残奥会',
  'world cup': '世界杯', olympics: '奥运会', 'rugby world cup': '橄榄球世界杯', 'fifa club world cup': 'FIFA 世俱杯',
  universiade: '世界大学生运动会', 'taipei universiade': '台北世界大学生运动会', 'asian games': '亚运会',
  'commonwealth games': '英联邦运动会', 'grand prix': '大奖赛', 'world championship': '世界锦标赛',
  'world artistic gymnastics championships': '世界艺术体操锦标赛', 'little league world series': '世界少棒大赛',
};
const FASHION_ZH = {
  preppy: '学院风', twee: '甜美复古风', mod: '摩登风', runway: '秀场风', greaser: '机车复古风',
  'e-kid': '电子儿童风', gyaru: '辣妹风', grunge: '垃圾摇滚风', punk: '朋克风', lolita: '洛丽塔风',
  'old school': '老派风格', 'street': '街头风', 'sporty': '运动风', 'casual': '休闲风', retro: '复古风',
};
const DATASET_ZH = { 'ye-pop': 'ye-pop（数据集标签）', deviantart: 'DeviantArt（数据集标签）' };
function zhLongtail(tag) {
  const t = show(tag);
  if (DATASET_ZH[t.toLowerCase()]) return DATASET_ZH[t.toLowerCase()];
  if (!/[a-z]{2}/.test(t) && /[^A-Za-z0-9]/.test(t)) return '颜文字 / 符号：' + t;   // ;q :s 0w0 \(^o^)/ 之类
  if (!/[A-Za-z]/.test(t)) return '颜文字 / 符号：' + t;
  let m;
  if ((m = /^(.+) \(meme\)$/.exec(t))) return `${m[1]}（梗图）`;
  if ((m = /^(\d{4})s? fashion$/.exec(t))) return `${m[1]} 年代时装`;
  if ((m = /^(\d{4})s? \(style\)$/.exec(t))) return `${m[1]} 年代风格`;
  if ((m = /^(\d{4}) \(year\)$/.exec(t))) return `${m[1]} 年`;
  if ((m = /^(\d{4})\s+(.+)$/.exec(t)) && EVENT_ZH[m[2].toLowerCase()]) return `${m[1]} 年${EVENT_ZH[m[2].toLowerCase()]}`;
  if (EVENT_ZH[t.toLowerCase()]) return EVENT_ZH[t.toLowerCase()];
  if ((m = /^(?:\w+ )?(.+?) fashion$/.exec(t)) && FASHION_ZH[m[1].toLowerCase()]) return `${FASHION_ZH[m[1].toLowerCase()]}时装`;
  if ((m = /^top of moe (\d{4})$/.exec(t))) return `萌王 ${m[1]}`;
  if ((m = /^(.+?) logo$/.exec(t))) return `${m[1]} 标志（logo）`;
  if ((m = /^(\d{4})-(\d{4}) (.+)$/.exec(t))) return `${m[1]}–${m[2]} 年 ${m[3]}`;
  if (/^\d+$/.test(t)) return '数字标签：' + t;
  return '';
}

console.log('读取数据源…');
const unified = JSON.parse(fs.readFileSync(path.join(DATA, 'unified-tags.json'), 'utf8'));
const groupsRaw = JSON.parse(fs.readFileSync(path.join(DATA, 'tag-groups.json'), 'utf8')).groups;
const detail = JSON.parse(fs.readFileSync(path.join(DATA, 'tag-groups-detail.json'), 'utf8'));
const wt = JSON.parse(fs.readFileSync(path.join(DATA, 'sources', 'weilin-tags.json'), 'utf8'));

/* ---------- 频率表：Danbooru 160k ---------- */
const freq = new Map();          // key -> post_count
const danRow = new Map();        // key -> {name, post_count, category}
for (const line of fs.readFileSync(path.join(DATA, 'sources', 'danbooru-tags.jsonl'), 'utf8').split('\n')) {
  if (!line.trim()) continue;
  let o; try { o = JSON.parse(line); } catch { continue; }
  const k = keyOf(o.name);
  if (!k) continue;
  if (!freq.has(k) || freq.get(k) < o.post_count) freq.set(k, o.post_count);
  danRow.set(k, o);
}
console.log('  Danbooru 频率表:', freq.size);

/* ---------- 方案库预览图（AnimaTags-DB / Dressing-doll 的 jsDelivr CDN） ---------- */
const imgByName = new Map();   // 方案中文名 -> preview
const imgByTag = new Map();    // 方案首个标签 -> preview
{
  const loadDataJs = (file, varName) => {
    const src = fs.readFileSync(path.join(DATA, file), 'utf8').replace(/export\s*\{[^}]*\};?/g, '');
    const ctx = { console };
    vm.createContext(ctx);
    vm.runInContext(src + `\n;globalThis.__v = ${varName};`, ctx);
    return ctx.__v;
  };
  const sets = [];
  try { sets.push(...loadDataJs('background_data.js', 'backgroundData')); } catch (e) { console.log('  背景方案库读取失败:', e.message); }
  try { sets.push(...loadDataJs('pose_data.js', 'poseData')); } catch (e) { console.log('  姿势方案库读取失败:', e.message); }
  try { sets.push(...JSON.parse(fs.readFileSync(path.join(DATA, 'clothing_data.json'), 'utf8'))); } catch (e) { console.log('  服装方案库读取失败:', e.message); }
  for (const e of sets) {
    if (!e || !e.preview) continue;
    if (e.name_zh) imgByName.set(e.name_zh, e.preview);
    const first = String(e.tags || '').split(',')[0].trim();
    if (first && !imgByTag.has(first)) imgByTag.set(first, e.preview);
  }
  console.log('  方案库预览图:', imgByName.size, '个方案 /', imgByTag.size, '个首标签');
}
/* 条目 zh 形如「海滩上的吊床 · 自然与户外 (Nature & Outdoors)」，逐段回退匹配方案中文名 */
function schemeImg(t) {
  const z = String(t.zh || '');
  if (z) {
    const parts = z.split(' · ');
    for (let n = parts.length; n >= 1; n--) {
      const key = parts.slice(0, n).join(' · ');
      if (imgByName.has(key)) return imgByName.get(key);
    }
  }
  const first = String(t.tag || '').split(',')[0].trim();
  return imgByTag.get(first) || '';
}

/* ---------- WeiLin 官方译名 + 热度 ---------- */
const wlZh = new Map(), wlHot = new Map(), wlColor = new Map();
for (const line of fs.readFileSync(path.join(DATA, 'sources', 'weilin-danbooru.jsonl'), 'utf8').split('\n')) {
  if (!line.trim()) continue;
  let o; try { o = JSON.parse(line); } catch { continue; }
  const k = keyOf(o.tag);
  if (!k) continue;
  const zh = o.zh || o.translate;
  if (zh && isHan(zh) && !isPlaceholder(zh)) wlZh.set(k, zh);
  if (o.hot) wlHot.set(k, Math.max(wlHot.get(k) || 0, o.hot));
  if (o.cat != null || o.color_id != null) wlColor.set(k, o.cat ?? o.color_id);
}
console.log('  WeiLin 中文:', wlZh.size, ' 热度:', wlHot.size);

/* ---------- WeiLin 分类 ---------- */
const wlG = new Map(wt.groups.map(g => [g.id, g.name]));
const wlS = new Map(wt.subgroups.map(s => [s.id, s.name]));
const wlCat = new Map();
for (const r of wt.tag_rows) { const k = keyOf(r[2]); if (k && !wlCat.has(k)) wlCat.set(k, { group: wlG.get(+r[1]) || '', sub: wlS.get(+r[2]) || '' }); }

/* ---------- toolbox 分类 ---------- */
// 注：toolbox 的 other / negative 两个一级分类是社区自建的杂项桶（实测 other 里混有 headgear / couple / bug
// 这类普通标签，negative 里混有 yellow_trim / frilled_pillow 这类无关标签），不可信 → 交给 RULES 兜底。
const TB_JUNK = new Set(['other', 'negative']);
const rowsRe = /\[\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*,\s*(\d)\s*\]/g;
const tbCat = new Map();
const tbZh = new Map();
for (const f of ['data-tags.js', 'extra-tags.js']) {
  const src = fs.readFileSync(path.join(STUDY, f), 'utf8');
  let m; rowsRe.lastIndex = 0;
  while ((m = rowsRe.exec(src))) {
    const k = keyOf(m[1]); if (!k) continue;
    if (!tbCat.has(k)) tbCat.set(k, { cat: norm(m[4]), sub: norm(m[5]), nsfw: +m[6] === 1 });
    const z = m[2];
    if (z && isHan(z) && !isPlaceholder(z) && !tbZh.has(k)) tbZh.set(k, z);
  }
}
console.log('  toolbox 分类:', tbCat.size, ' 中文:', tbZh.size);

/* ---------- 单词词表（用于组合译名） ---------- */
const wordZh = new Map();
for (const [k, v] of wlZh) if (!k.includes(' ')) wordZh.set(k, v);
for (const [k, v] of tbZh) if (!k.includes(' ') && !wordZh.has(k)) wordZh.set(k, v);
for (const t of unified.tags) {
  const k = keyOf(t.tag);
  if (!k || k.includes(' ')) continue;
  if (t.zh && isHan(t.zh) && !isPlaceholder(t.zh) && !wordZh.has(k)) wordZh.set(k, t.zh);
}
console.log('  单词词表:', wordZh.size);
const SUF = [[/ies$/, 'y'], [/s$/, '']];
function composeZh(tag) {
  const parts = show(tag).split(' ');
  if (parts.length < 2 || parts.length > 4) return '';
  const out = [];
  for (const p of parts) {
    let z = wordZh.get(p);
    if (!z) for (const [re, rep] of SUF) { const v = p.replace(re, rep); if (wordZh.has(v)) { z = wordZh.get(v); break; } }
    if (!z) return '';
    out.push(z);
  }
  return out.join('');
}

/* ---------- 专有名词词表（官方组里的地名/球队/品牌/乐器/动植物等） ---------- */
const LEX = {
  // 行政区与地名
  prefecture: '县', city: '市', town: '町', village: '村', ward: '区', district: '区', county: '县',
  province: '省', state: '州', island: '岛', mountain: '山', lake: '湖', river: '河', sea: '海', bay: '湾',
  beach: '海滩', park: '公园', tower: '塔', bridge: '桥', castle: '城', temple: '寺', shrine: '神社',
  station: '车站', airport: '机场', hotel: '酒店', museum: '博物馆', garden: '庭园', street: '街',
  avenue: '大道', plaza: '广场', market: '市场', mall: '商场', school: '学校', university: '大学',
  academy: '学院', college: '学院', hospital: '医院', church: '教堂', cathedral: '大教堂',
  stadium: '体育场', arena: '竞技场', library: '图书馆', zoo: '动物园', aquarium: '水族馆',
  building: '建筑', port: '港口', harbour: '港', harbor: '港', hill: '山丘', valley: '山谷',
  forest: '森林', desert: '沙漠', cave: '洞窟', waterfall: '瀑布', dam: '水坝', tokyo: '东京',
  kyoto: '京都', osaka: '大阪', nagoya: '名古屋', hokkaido: '北海道', okinawa: '冲绳', york: '约克',
  united: '联合', japanese: '日本', english: '英国', great: '大', mount: '山', lakefront: '湖畔',
  // 体育
  fc: '足球俱乐部', sc: '体育俱乐部', club: '俱乐部', league: '联赛', cup: '杯', team: '队',
  hockey: '冰球', baseball: '棒球', basketball: '篮球', football: '足球', soccer: '足球',
  tennis: '网球', golf: '高尔夫', boxing: '拳击', wrestling: '摔跤', volleyball: '排球', rugby: '橄榄球',
  cricket: '板球', badminton: '羽毛球', swimming: '游泳', skiing: '滑雪', skating: '滑冰', marathon: '马拉松',
  // 公司与品牌
  company: '公司', corporation: '株式会社', inc: '公司', ltd: '有限公司', brand: '品牌',
  studio: '工作室', studios: '影业', entertainment: '娱乐', records: '唱片', airlines: '航空',
  motors: '汽车', motor: '摩托', electronics: '电子', electric: '电气', bank: '银行', insurance: '保险',
  foods: '食品', brewing: '酿造', games: '游戏', software: '软件', computer: '计算机', tech: '科技',
  cosmetics: '化妆品',
  // 音乐
  band: '乐队', album: '专辑', song: '歌曲', single: '单曲', music: '音乐', vocal: '人声',
  guitar: '吉他', bass: '贝斯', drum: '鼓', piano: '钢琴', violin: '小提琴', saxophone: '萨克斯',
  trumpet: '小号', flute: '长笛', orchestra: '管弦乐团', concert: '演唱会', festival: '音乐节',
  radio: '广播', label: '厂牌', soundtrack: '原声带', lyrics: '歌词', singer: '歌手', idol: '偶像',
  // 鸟类
  gull: '海鸥', seagull: '海鸥', duck: '鸭', goose: '鹅', swan: '天鹅', owl: '猫头鹰', crow: '乌鸦',
  raven: '渡鸦', sparrow: '麻雀', pigeon: '鸽子', dove: '鸽', crane: '鹤', heron: '鹭', stork: '鹳',
  eagle: '鹰', hawk: '鹰', falcon: '隼', penguin: '企鹅', parrot: '鹦鹉', chicken: '鸡', rooster: '公鸡',
  chick: '雏鸡', turkey: '火鸡', peacock: '孔雀', flamingo: '火烈鸟', pelican: '鹈鹕', albatross: '信天翁',
  kingfisher: '翠鸟', woodpecker: '啄木鸟', hummingbird: '蜂鸟', canary: '金丝雀', finch: '雀',
  robin: '知更鸟', swallow: '燕子', magpie: '喜鹊', ostrich: '鸵鸟', emu: '鸸鹋', kiwi: '几维鸟',
  dodo: '渡渡鸟', bird: '鸟',
  // 猫科 / 犬科
  cat: '猫', kitten: '小猫', tiger: '虎', lion: '狮', leopard: '豹', cheetah: '猎豹', jaguar: '美洲豹',
  panther: '黑豹', lynx: '猞猁', bobcat: '短尾猫', cougar: '美洲狮', puma: '美洲狮', ocelot: '豹猫',
  serval: '薮猫', caracal: '狞猫', manul: '兔狲', bobtail: '短尾猫',
  dog: '狗', puppy: '小狗', wolf: '狼', fox: '狐狸', coyote: '郊狼', jackal: '胡狼', dhole: '豺',
  dingo: '澳洲野犬', shiba: '柴犬', corgi: '柯基', husky: '哈士奇', poodle: '贵宾犬',
  chihuahua: '吉娃娃', dachshund: '腊肠犬', retriever: '寻回犬', terrier: '梗犬', pug: '巴哥犬',
  beagle: '比格犬', saluki: '萨路基猎犬', akita: '秋田犬', shikoku: '四国犬', kishu: '纪州犬',
  spitz: '狐狸犬', mastiff: '獒犬', bulldog: '斗牛犬', samoyed: '萨摩耶', malamute: '阿拉斯加雪橇犬',
  // 传说生物
  dragon: '龙', phoenix: '凤凰', griffin: '狮鹫', unicorn: '独角兽', mermaid: '人鱼', fairy: '妖精',
  angel: '天使', demon: '恶魔', devil: '恶魔', ghost: '幽灵', zombie: '僵尸', vampire: '吸血鬼',
  werewolf: '狼人', kitsune: '狐妖', tanuki: '狸猫', tengu: '天狗', oni: '鬼', yokai: '妖怪',
  youkai: '妖怪', slime: '史莱姆', golem: '魔像', centaur: '半人马', minotaur: '牛头人',
  hydra: '九头蛇', kraken: '海怪', leviathan: '利维坦', sphinx: '斯芬克斯', pegasus: '天马',
  lamia: '拉米亚', succubus: '魅魔', sprite: '精灵', elf: '精灵', dwarf: '矮人', gnome: '地精',
  orc: '兽人', goblin: '哥布林', troll: '巨魔', ogre: '食人魔', giant: '巨人', titan: '泰坦',
  valkyrie: '女武神', goddess: '女神', god: '神', buddha: '佛', bodhisattva: '菩萨', creature: '生物',
  mythology: '神话',
  // 舞蹈
  dance: '舞蹈', dancing: '跳舞', ballet: '芭蕾', waltz: '华尔兹', tango: '探戈', salsa: '萨尔萨',
  breakdance: '霹雳舞', flamenco: '弗拉门戈', kabuki: '歌舞伎', odori: '舞蹈', hula: '草裙舞',
  ballroom: '交际舞', swing: '摇摆舞', disco: '迪斯科', polka: '波尔卡', cheerleading: '啦啦队',
  // 食物
  food: '食物', cake: '蛋糕', bread: '面包', rice: '米饭', noodle: '面', soup: '汤', meat: '肉',
  fruit: '水果', vegetable: '蔬菜', drink: '饮料', tea: '茶', coffee: '咖啡', wine: '葡萄酒',
  beer: '啤酒', sake: '清酒', juice: '果汁', milk: '牛奶', cheese: '奶酪', egg: '蛋', dessert: '甜点',
  candy: '糖果', chocolate: '巧克力', pizza: '披萨', burger: '汉堡', sandwich: '三明治', sushi: '寿司',
  ramen: '拉面', curry: '咖喱', dumpling: '饺子', bun: '包子', pastry: '点心', tart: '塔', pie: '派',
  cookie: '饼干', biscuit: '饼干', pancake: '煎饼', waffle: '华夫饼', donut: '甜甜圈', pudding: '布丁',
  honey: '蜂蜜', butter: '黄油', salt: '盐', pepper: '胡椒', sauce: '酱',
  // 文字与符号
  text: '文字', font: '字体', letter: '字母', word: '词', phrase: '短语', quote: '引用', number: '数字',
  sign: '标识', mark: '记号', symbol: '符号', logo: '标志', emblem: '徽章', badge: '徽章',
  stamp: '印章', seal: '印章', signature: '签名', watermark: '水印', border: '边框', frame: '画框',
  arrow: '箭头', cross: '十字', star: '星', heart: '心', circle: '圆', square: '方', triangle: '三角',
  diamond: '菱形', check: '勾', 'question mark': '问号', punctuation: '标点', parenthesis: '括号',
  // 妆容 / 时尚 / 其它高频
  lipstick: '口红', eyeshadow: '眼影', eyeliner: '眼线', blush: '腮红', mascara: '睫毛膏',
  foundation: '粉底', 'nail polish': '指甲油', makeup: '妆容', piercing: '穿环', tattoo: '纹身',
  freckle: '雀斑', mole: '痣', clothes: '服装', fashion: '时装', style: '风格', outfit: '穿搭',
  holding: '手持', background: '背景', pose: '姿势', request: '请求', revision: '修订', sample: '示例',
  medium: '媒介', golden: '金色', blue: '蓝色', white: '白色', black: '黑色', red: '红色',
  green: '绿色', yellow: '黄色', double: '双重', list: '列表', pupils: '瞳孔', flower: '花',
  mark_of: '记号', sound: '声音', album_cover: '专辑封面',
};
// 外貌 / 服饰 / 动作高频词（WeiLin 单词表缺失，补上后可解锁大量组合译名）
const LEX2 = {
  hair: '头发', bangs: '刘海', braid: '辫子', braids: '辫子', ponytail: '马尾', twintails: '双马尾',
  sidelocks: '鬓发', ahoge: '呆毛', bun: '发髻', chignon: '发髻', curls: '卷发', curl: '卷',
  wavy: '波浪', straight: '直', messy: '凌乱', long: '长', short: '短', medium: '中', thick: '粗',
  thin: '细', fluffy: '蓬松', wet: '湿', dry: '干', shiny: '光亮', glowing: '发光', floating: '飘动',
  flowing: '流动', spread: '散开', tied: '扎起', loose: '松散', blunt: '齐', spiked: '刺猬',
  hairband: '发带', hairclip: '发夹', hairpin: '发针', hairbow: '发结', ribbon: '丝带', headband: '头带',
  eyes: '眼睛', eye: '眼', eyelashes: '睫毛', eyebrows: '眉毛', eyelid: '眼睑', pupils: '瞳孔',
  eyeliner: '眼线', eyeshadow: '眼影', iris: '虹膜', sclera: '巩膜', tears: '眼泪', tear: '泪',
  skin: '皮肤', nail: '指甲', nails: '指甲', teeth: '牙齿', tooth: '牙', tongue: '舌头', lips: '嘴唇',
  mouths: '嘴', mouth: '嘴', ears: '耳朵', ear: '耳', tail: '尾巴', tails: '尾巴', wing: '翅膀',
  wings: '翅膀', horn: '角', horns: '角', halo: '光环', antenna: '触角', antennas: '触角',
  fang: '獠牙', fangs: '獠牙', freckles: '雀斑', scar: '伤疤', blush: '脸红', sweat: '汗', drool: '口水',
  shirt: '衬衫', blouse: '上衣', skirt: '裙子', dress: '连衣裙', pants: '裤子', shorts: '短裤',
  jeans: '牛仔裤', sweater: '毛衣', hoodie: '连帽衫', jacket: '夹克', coat: '外套', cloak: '斗篷',
  cape: '披风', scarf: '围巾', gloves: '手套', glove: '手套', socks: '袜子', sock: '袜子',
  boots: '靴子', boot: '靴', shoes: '鞋', shoe: '鞋', sandals: '凉鞋', hat: '帽子', cap: '鸭舌帽',
  beret: '贝雷帽', hood: '兜帽', helmet: '头盔', crown: '王冠', tiara: '头冠', necklace: '项链',
  earrings: '耳环', bracelet: '手镯', ring: '戒指', glasses: '眼镜', sunglasses: '墨镜', mask: '面具',
  veil: '面纱', apron: '围裙', swimsuit: '泳装', bikini: '比基尼', lingerie: '内衣', bra: '文胸',
  panties: '内裤', 'school uniform': '校服', uniform: '制服', 'maid outfit': '女仆装',
  kimono: '和服', yukata: '浴衣', hakama: '袴', 'sailor collar': '水手领', collar: '衣领',
  sleeve: '袖子', sleeves: '袖子', 'neck ribbon': '颈饰缎带', choker: '颈环', belt: '腰带',
  'hair ornament': '发饰', ornament: '饰物', bow: '蝴蝶结', bows: '蝴蝶结', frills: '褶边',
  lace: '蕾丝', embroidery: '刺绣', print: '印花', pattern: '图案', stripe: '条纹', stripes: '条纹',
  plaid: '格纹', checkered: '棋盘格', polka: '圆点', dot: '点', dots: '点',
  standing: '站立', sitting: '坐', lying: '躺', walking: '行走', running: '奔跑', jumping: '跳跃',
  kneeling: '跪', crouching: '蹲', leaning: '倚靠', sleeping: '睡觉', eating: '吃', drinking: '饮用',
  reading: '阅读', looking: '看', smiling: '微笑', crying: '哭泣', screaming: '尖叫', shouting: '喊叫',
  hugging: '拥抱', kissing: '亲吻', stretching: '伸展', reaching: '伸手', pointing: '指',
  covering: '遮挡', adjusting: '整理', holding: '手持', carrying: '携带', wielding: '挥舞',
  on: '在', in: '在', to: '到', of: '的', with: '与', and: '与', at: '在', for: '为', from: '来自',
  under: '下', over: '上', around: '环绕', behind: '后', front: '前', side: '侧', up: '上', down: '下',
  number: '数字', single: '单', double: '双', triple: '三', multiple: '多', two: '两', three: '三',
  'one': '一', no: '无', not: '非', non: '非', own: '自己的', other: '其他', another: '另一个',
  small: '小', large: '大', big: '大', tiny: '极小', huge: '巨大', 'extra': '额外', 'very': '非常',
  light: '浅', dark: '深', pale: '苍白', bright: '明亮', color: '色', colored: '彩色', colour: '色',
};
for (const [k, v] of Object.entries(LEX2)) if (!wordZh.has(k)) wordZh.set(k, v);
for (const [k, v] of Object.entries(LEX)) if (!wordZh.has(k)) wordZh.set(k, v);

/** 专有名词模式：按中文语序拼接 */
function properZh(tag) {
  const t = show(tag);
  let m;
  if ((m = /^fc (.+)$/.exec(t))) return `${m[1]} 足球俱乐部`;
  if ((m = /^(.+) of (.+)$/.exec(t)) && wordZh.get(m[1]) && wordZh.get(m[2])) return `${wordZh.get(m[2])}的${wordZh.get(m[1])}`;
  if ((m = /^(.+) (prefecture|city|town|village|ward|district|county|province|state|island|mountain|lake|river|park|tower|bridge|castle|temple|shrine|station|airport|hotel|museum|garden|street|avenue|plaza|market|mall|school|university|academy|college|hospital|church|cathedral|stadium|arena|library|zoo|aquarium|building|port|harbour|harbor|hill|valley|forest|desert|cave|waterfall|dam)$/.exec(t)))
    return `${m[1]}${LEX[m[2]]}`;
  if ((m = /^(.+) (company|corporation|inc|ltd|brand|studios?|entertainment|records|airlines|motors|electronics|bank|foods)$/.exec(t)))
    return `${m[1]}（${LEX[m[2]]}）`;
  if ((m = /^(.+) (band|album|song|single|orchestra|label)$/.exec(t))) return `${m[1]}（${LEX[m[2]]}）`;
  return '';
}

/* ---------- 官方组：小节 + 成员 ---------- */
const secOf = new Map();     // key -> {slug, section, sectionZh}
for (const g of Object.values(detail)) {
  for (const s of g.sections) {
    for (const t of s.tags) {
      const k = keyOf(t.tag);
      if (!k || secOf.has(k)) continue;
      secOf.set(k, { slug: g.slug, section: s.heading, sectionZh: s.heading_zh || s.heading, note: t.note, hits: t.hits });
    }
  }
}
const groupOf = new Map();   // key -> [slug]
for (const [slug, g] of Object.entries(groupsRaw)) {
  for (const t of (g.tags || [])) {
    const k = keyOf(t.tag); if (!k) continue;
    if (!groupOf.has(k)) groupOf.set(k, []);
    if (!groupOf.get(k).includes(slug)) groupOf.get(k).push(slug);
  }
}
console.log('  官方小节归属:', secOf.size, ' 官方组成员:', groupOf.size);

/* ---------- 官方组展示顺序 ---------- */
const OG_ORDER = [
  'hair', 'hair-color', 'hair-styles', 'face', 'eyes', 'ears', 'makeup', 'skin-color', 'body-parts',
  'attire', 'headwear', 'legwear', 'handwear', 'sleeves', 'neck-and-neckwear', 'eyewear', 'accessories', 'fashion-style', 'patterns', 'prints',
  'posture', 'gestures', 'hands', 'holding-tags', 'verbs-and-gerunds', 'dances',
  'image-composition', 'focus-tags', 'lighting', 'colors',
  'backgrounds', 'locations', 'real-world-locations', 'water', 'fire', 'flowers',
  'animals-cats', 'animals-dogs', 'birds', 'creatures',
  'food-tags', 'technology', 'audio-tags', 'sports', 'jobs', 'holidays', 'companies',
  'text', 'symbols', 'phrases', 'metatags', 'year-tags', 'subjective', 'theme', 'censorship', 'visual-aesthetic',
];
const ORDER = [
  'cb:base', 'cb:character', 'cb:series', 'cb:artist',
  ...OG_ORDER.filter(s => groupsRaw[s]).map(s => 'og:' + s),
  'cb:body', 'cb:items', 'cb:animals', 'cb:effects', 'cb:nsfw', 'cb:negative', 'cb:scheme', 'cb:hanfu', 'cb:misc',
];

/* ---------- 标签宇宙 ---------- */
const T = new Map();   // key -> record
for (const t of unified.tags) {
  const k = keyOf(t.tag);
  T.set(k, {
    tag: t.tag, zh: isPlaceholder(t.zh) ? '' : t.zh, aliases: [...(t.aliases || [])],
    nsfw: !!t.nsfw, weight: t.weight || '', freq: t.freq ?? null, confidence: t.confidence || '',
    big: '', sub: '', official: false, group: '', groups: (t.groups || []).slice(),
    srcs: (t.sources || []).map(s => s.label), notes: (t.notes || []).slice(), cats: t.cats || [],
    tbCat: t.tbCat || '', tbSub: t.tbSub || '', slot: (t.slots || [])[0] || '', img: t.img || '', placeholder: t.placeholder || '',
  });
}
const before = T.size;
let added = 0;
for (const [k, o] of danRow) {
  if (T.has(k) || o.category !== 0 || o.post_count < 200) continue;
  added++;
  T.set(k, {
    tag: show(o.name), zh: '', aliases: [], nsfw: false, weight: '', freq: o.post_count, confidence: '',
    big: '', sub: '', official: false, group: '', groups: [], srcs: ['Danbooru 全站标签榜'], notes: [], cats: [],
    tbCat: '', tbSub: '', slot: '', img: '', placeholder: '', newIn: true,
  });
}
console.log(`标签宇宙: ${before} + 扩充 ${added} = ${T.size}`);

/* ---------- 归属判定 ---------- */
/* 人工钉死的家：少数标签的"正确归属"不容置疑（人数/画幅元标签），
   它们会盖掉官方组与规则的结果，见 chain 末尾的 TAG_HOME。 */
const TAG_HOME = new Map(Object.entries({
  // 人数 / 画面主体 —— Anima 官方顺序里紧跟质量词
  '1girl': 'cb:base', '1boy': 'cb:base', '2girls': 'cb:base', '2boys': 'cb:base', '3girls': 'cb:base', '3boys': 'cb:base',
  '4girls': 'cb:base', '4boys': 'cb:base', '5girls': 'cb:base', '5boys': 'cb:base', '6girls': 'cb:base', '6boys': 'cb:base',
  '6+girls': 'cb:base', '6+boys': 'cb:base', 'multiple girls': 'cb:base', 'multiple boys': 'cb:base',
  'no humans': 'cb:base', 'everyone': 'cb:base', 'solo': 'cb:base', 'solo focus': 'cb:base',
  // 分辨率类元标签
  'highres': 'cb:base', 'absurdres': 'cb:base', 'lowres': 'cb:base', 'high resolution': 'cb:base',
}));
const TAG_HOME_SUB = { 'cb:base': '人数与画面规模' };
const TAG_HOME_SUB2 = new Set(['highres', 'absurdres', 'lowres', 'high resolution']);   // 这几个进"元标签与数据集"
/* Danbooru 官方分类（1=画师 3=作品 4=角色）是权威身份，优先于官方 tag_group 的小节归属：
   否则像 pikachu / mario / touhou 这种会被"姿态""舞蹈""地点"组误收。 */
const CAT_BIG = { 1: 'cb:artist', 3: 'cb:series', 4: 'cb:character' };
const stat = { sec: 0, grp: 0, wl: 0, tb: 0, local: 0, rule: 0, misc: 0, cat: 0, home: 0 };
const subCount = new Map();   // `${big}||${sub}` -> n
const bigCount = new Map();
for (const [k, t] of T) {
  const sec = secOf.get(k);
  const wl = wlCat.get(k);
  const tb = tbCat.get(k);
  const og = groupOf.get(k);
  const dcat = danRow.get(k) ? danRow.get(k).category : null;
  if (CAT_BIG[dcat]) {                    // 画师 / 作品 / 角色：身份优先
    t.big = CAT_BIG[dcat];
    t.sub = dcat === 1 ? '画师库' : dcat === 3 ? '作品库' : '角色库';
    t.official = false;
    stat.cat++;
  }
  else if (sec) { t.big = 'og:' + sec.slug; t.sub = sec.sectionZh; t.official = true; t.group = sec.slug; t.note = sec.note || ''; stat.sec++; }
  else if (og && og.length) { t.big = 'og:' + og[0]; t.sub = '其他'; t.official = true; t.group = og[0]; stat.grp++; }
  else if (wl && (WEILIN_SUB_BIG[wl.sub] || WEILIN_GROUP[wl.group])) {
    t.big = WEILIN_SUB_BIG[wl.sub] || WEILIN_GROUP[wl.group]; t.sub = wl.sub; stat.wl++;
  }
  else if (tb && TOOLBOX_CAT[tb.cat] && !TB_JUNK.has(tb.cat)) {
    t.big = TOOLBOX_CAT[tb.cat]; t.sub = tb.sub && tb.sub !== '默认' ? tb.sub : TOOLBOX_LABEL[tb.cat]; stat.tb++;
    if (tb.nsfw) t.nsfw = true;
  }
  else if (t.cats && t.cats.length && LOCAL_CAT[t.cats[0]]) { const m = LOCAL_CAT[t.cats[0]]; t.big = m[0]; t.sub = m[1]; stat.local++; }
  else {
    let hit = null;
    for (const r of RULES) if (r.re.test(t.tag)) { hit = r; break; }
    if (hit) { t.big = hit.big; t.sub = hit.sub; stat.rule++; }
    else { t.big = 'cb:misc'; t.sub = '待归类'; stat.misc++; }
  }
  if (!t.groups.length && t.group) t.groups = [t.group];
  // 人工钉死（最高优先级）：人数 / 分辨率类元标签
  const home = TAG_HOME.get(t.tag);
  if (home) {
    t.big = home;
    t.sub = TAG_HOME_SUB2.has(t.tag) ? '元标签与数据集' : (TAG_HOME_SUB[home] || t.sub || '其他');
    if (t.official) { t.official = false; t.group = ''; t.groups = []; }
    stat.home++;
  }
  // 中文补全
  if (!t.zh) { const z = wlZh.get(k) || tbZh.get(k); if (z) t.zh = z; }
  if (!t.zh) {
    // 长尾标注（用户决策 m01496：颜文字 / 年份区间 / 符号组合保留并补中文标注，不删条目）
    const z1 = zhLongtail(t.tag);
    if (z1) t.zh = z1;
    else {
      const z2 = composeZh(t.tag);           // 组合译名（逐词查表拼接，标注待校对）
      if (z2) { t.zh = z2; t.composed = true; }
    }
  }
  // 频率补全
  const f = freq.get(k) ?? wlHot.get(k) ?? null;
  if (f) t.freq = f;
  // 方案库预览图（真实的成套方案配图，来自三个社区方案库的 CDN）
  if (!t.img) { const u = schemeImg(t); if (u) t.img = u; }
  if (!t.confidence) t.confidence = (t.official || danRow.has(k)) ? '高' : (wlZh.has(k) ? '中' : '待验证');
  const k2 = t.big + '||' + t.sub;
  subCount.set(k2, (subCount.get(k2) || 0) + 1);
  bigCount.set(t.big, (bigCount.get(t.big) || 0) + 1);
}

/* ---------- 大类目简介 ---------- */
const plain = s => String(s || '')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ').trim();
/* 官方组抓来的 intro 多半是以 “Table of Contents / class="prose"” 开头的目录残渣，
   这种情况直接丢掉，改用生成的中文简介（官方小节名见下方小分类条）。 */
function officialIntro(b, count, subs) {
  const base = `Danbooru 官方 tag_group「${b.slug}」：${count} 条标签`
    + (subs.length ? `，本库按官方小节并合三套词表后归为 ${subs.length} 个小分类` : '')
    + `。点第二行的「小分类」条可把范围收窄到某个主题。`;
  const p = plain(b.intro);
  const junk = !p || /^class=/.test(p) || /Table of Contents/i.test(p.slice(0, 60));
  if (junk) return base;
  return base + ' ' + (p.length > 220 ? p.slice(0, 220) + '…' : p);
}


/* ---------- 大类目定义 ---------- */
const BIG_DEFS = [];
for (const id of ORDER) {
  if (CURATED_IDS.has(id)) {
    const c = CURATED_BIGS.find(b => b.id === id);
    BIG_DEFS.push({ id, name: c.name, kind: 'curated', intro: c.intro });
  } else {
    const slug = id.slice(3);
    const g = groupsRaw[slug] || {};
    const d = detail[slug];
    BIG_DEFS.push({
      id, name: OFFICIAL_NAME_ZH[slug] || g.name_zh || slug, kind: 'official', slug,
      intro: (d && d.intro || '').slice(0, 400),
      url: g.url || `https://danbooru.donmai.us/wiki_pages/tag_group%3A${slug}`,
      sections: (d ? d.sections.length : 0),
    });
  }
}
// 丢掉空的大类目
const kept = BIG_DEFS.filter(b => (bigCount.get(b.id) || 0) > 0);
const dropped = BIG_DEFS.filter(b => !(bigCount.get(b.id) || 0)).map(b => b.name);

/* ---------- 分块输出 ---------- */
fs.mkdirSync(BIGS_DIR, { recursive: true });
for (const f of fs.readdirSync(BIGS_DIR)) fs.rmSync(path.join(BIGS_DIR, f), { force: true });
for (const f of ['manifest.json', 'search-index.json']) { const p = path.join(SPLIT, f); if (fs.existsSync(p)) fs.rmSync(p); }

const SHORT = { tag: 0, zh: 1, weight: 2, freq: 3, confidence: 4, aliases: 5, note: 6, slot: 7, img: 8, placeholder: 9, source: 10, srcKey: 11, sub: 12, official: 13, nsfw: 14, groups: 15, srcs: 16, big: 17 };
const packItem = t => {
  const a = [];
  a[0] = t.tag; a[1] = t.zh || '';
  if (t.weight) a[2] = t.weight;
  if (t.freq) a[3] = t.freq;
  a[4] = t.confidence || '';
  if (t.composed) a[4] = (a[4] ? a[4] + ' · ' : '') + '组合译名待校对';
  if (t.aliases && t.aliases.length) a[5] = t.aliases.slice(0, 6);
  if (t.note) a[6] = t.note;
  if (t.slot) a[7] = t.slot;
  if (t.img) a[8] = t.img;
  if (t.placeholder) a[9] = t.placeholder;
  a[10] = t.srcs.join(' / ').slice(0, 200);
  a[11] = t.official ? 'danbooru-taggroup' : (t.newIn ? 'danbooru-top' : 'local');
  a[12] = t.sub;
  a[13] = t.official ? 1 : 0;
  if (t.nsfw) a[14] = 1;
  if (t.groups && t.groups.length > 1) a[15] = t.groups;
  if (t.srcs.length > 1) a[16] = t.srcs.length;
  return a;
};

/* ---------- 小分类近义归并 ----------
 * 小分类来自三套独立词表（Danbooru 官方小节名 / WeiLin 131 二级 / ai-tag-toolbox 138 个 sub），
 * 同一主题会产出 3–4 个近义桶（例：甜点·零食·点心 / 甜点零食 / 甜点与零食 / 其他零食）。
 * 规则：词元集合互为子集且交集非空、或 Jaccard ≥ 0.5 → 并为一桶，取词元更多者的名字；
 *       纯兜底名（其他 / 参见 / 说明 / 杂项 …）统一并入「其他」。
 */
const SUB_JUNK = new Set(['其他', '其它', '参见', '说明', '杂项', '其他标签', '其他类', '未分类', '待归类', '']);
const SUB_JUNK_RE = /^(其他|其它|参见|说明|杂项|未分类|待归类)/;
const SUB_SPLIT = /[·、・/／\s]+|与|和|及/g;
const subTokens = name => name.split(SUB_SPLIT).map(s => s.trim()).filter(Boolean);
const subNorm = name => name.replace(SUB_SPLIT, '|');   // 分隔符替换成边界符：避免「制服|装扮」被误判为包含「服装」
/* 连续词元拼串集合：用于识别「甜点零食」=「甜点·零食·点心」的前两个词元这种无分隔连写 */
function subRuns(name) {
  const T = subTokens(name), out = new Set();
  for (let i = 0; i < T.length; i++) { let acc = ''; for (let j = i; j < T.length; j++) { acc += T[j]; out.add(acc); } }
  return out;
}
function mergeSubs(subs) {
  const keep = subs.filter(s => !SUB_JUNK.has(s.name) && !SUB_JUNK_RE.test(s.name));
  const parent = new Map(keep.map(s => [s.name, s.name]));
  const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  for (let i = 0; i < keep.length; i++) {
    for (let j = i + 1; j < keep.length; j++) {
      const a = new Set(subTokens(keep[i].name)), b = new Set(subTokens(keep[j].name));
      if (!a.size || !b.size) continue;
      const inter = [...a].filter(x => b.has(x)).length;
      const na = subNorm(keep[i].name), nb = subNorm(keep[j].name);
      const bare = s => s.replace(/\|/g, '');
      const ta = subTokens(keep[i].name), tb = subTokens(keep[j].name);
      // 否定/排除型名字（「非头饰」「不带 X」）不参与包含型归并，避免被反向并进肯定桶
      const neg = /^(非|不|无|仅)+/.test(keep[i].name) || /^(非|不|无|仅)+/.test(keep[j].name);
      const containment = !neg && (
        (bare(na).length >= 2 && bare(nb).length >= 2 && (na.includes(nb) || nb.includes(na)))
        || (ta.length === 1 && subRuns(keep[j].name).has(ta[0]) && tb.length > 1)
        || (tb.length === 1 && subRuns(keep[i].name).has(tb[0]) && ta.length > 1));
      if (containment || (inter && (inter === a.size || inter === b.size || inter / (a.size + b.size - inter) >= 0.5))) {
        const ra = find(keep[i].name), rb = find(keep[j].name);
        if (ra !== rb) parent.set(ra, rb);
      }
    }
  }
  const comp = new Map();
  for (const s of keep) {
    const r = find(s.name);
    if (!comp.has(r)) comp.set(r, []);
    comp.get(r).push(s);
  }
  const map = new Map();
  for (const [, list] of comp) {
    const best = list.slice().sort((x, y) => (subTokens(y.name).length - subTokens(x.name).length) || (y.count - x.count))[0];
    for (const s of list) map.set(s.name, best.name);
  }
  const junk = subs.filter(s => SUB_JUNK.has(s.name) || SUB_JUNK_RE.test(s.name));
  if (junk.length) for (const s of junk) if (s.name !== '其他') map.set(s.name, '其他');
  return map;
}

const manifestCats = [];
const subMergeLog = [];   // 小分类归并明细（写进 data/sub-merge-applied.json，便于回溯）
let idx = 0;
const searchRows = [];
for (const b of kept) {
  idx++;
  const items = [...T.values()].filter(t => t.big === b.id);
  items.sort((x, y) => (y.freq || 0) - (x.freq || 0) || x.tag.localeCompare(y.tag));
  // 小分类先归并近义桶，再统计与排序（其他/待归类在最后）
  const rawSubs = [...new Set(items.map(t => t.sub))].map(s => ({ name: s, count: items.filter(t => t.sub === s).length }));
  const subMap = mergeSubs(rawSubs);
  let renamed = 0;
  for (const t of items) {
    const to = subMap.get(t.sub);
    if (to && to !== t.sub) { t.sub = to; renamed++; }
  }
  if (renamed) stat.subMerged = (stat.subMerged || 0) + renamed;
  const applied = [...subMap.entries()].filter(([from, to]) => from !== to);
  if (applied.length) subMergeLog.push({ id: b.id, name: b.name, merged: applied.map(([from, to]) => `${from} → ${to}`) });
  const subs = [...new Set(items.map(t => t.sub))].map(s => ({ name: s, count: items.filter(t => t.sub === s).length }))
    .sort((a, c) => (/(其他|待归类)/.test(a.name) ? 1 : 0) - (/(其他|待归类)/.test(c.name) ? 1 : 0) || c.count - a.count);
  // 分片（每片 ≤ 3500 条）
  const parts = [];
  const CH = 3500;
  for (let i = 0; i < items.length; i += CH) parts.push(items.slice(i, i + CH));
  const files = [];
  parts.forEach((part, pi) => {
    const fp = `${String(b.id.replace(/[:]/g, '-'))}${parts.length > 1 ? '-' + (pi + 1) : ''}.json`;
    fs.writeFileSync(path.join(BIGS_DIR, fp), JSON.stringify({
      id: b.id, name: b.name, order: idx, kind: b.kind, slug: b.slug || '', part: pi + 1, parts: parts.length,
      subs: subs.map(s => s.name), items: part.map(packItem),
    }));
    files.push('bigs/' + fp);
  });
  manifestCats.push({
    id: b.id, name: b.name, order: idx, kind: b.kind, slug: b.slug || '',
    intro: b.kind === 'official' ? officialIntro(b, items.length, subs) : (b.intro || ''),
    count: items.length, subs, files,
    file: files[0],                                  // 兼容旧字段
    url: b.url || '', sections: b.sections || 0,
  });
  for (const t of items) searchRows.push([t.tag, b.id, idx, t.zh || '', (t.aliases || []).join(' '), t.weight || '', PLUS(t.freq) || '', t.confidence || '', t.sub, b.name, t.slot || '', b.kind === 'official' ? 1 : 0]);
}

/* ---------- search-index ---------- */
const SIDX = {
  fields: ['tag', 'big', 'order', 'zh', 'aliases', 'weight', 'freq', 'confidence', 'sub', 'bigName', 'slot', 'official'],
  cats: manifestCats.map(c => ({ id: c.id, name: c.name, order: c.order, count: c.count, subs: c.subs.map(s => s.name) })),
  rows: searchRows,
};
fs.writeFileSync(path.join(SPLIT, 'search-index.json'), JSON.stringify(SIDX));

const zhMissing = [...T.values()].filter(t => !t.zh).length;
const manifest = {
  meta: {
    model: 'Anima 2B (CircleStone Labs × Comfy Org)',
    built_at: new Date().toISOString().slice(0, 10),
    total: T.size, bigs: manifestCats.length, subs: manifestCats.reduce((s, c) => s + c.subs.length, 0),
    verified_freq: [...T.values()].filter(t => t.freq).length,
    official_tags: [...T.values()].filter(t => t.official).length,
    zh_missing: zhMissing,
    conventions: [
      '标签一律小写；空格代替下划线（仅 score_* 保留下划线）',
      '画师标签必须带 @ 前缀，否则权重极弱',
      '正向提示词顺序：质量/元信息/年份/安全档 → 人数 → 角色 → 作品 → 画师 → 外观动作 → 构图光影场景',
      '官方正向前缀：masterpiece, best quality, score_7, safe, ',
      '官方负向：worst quality, low quality, score_1, score_2, score_3, artist name, blurry, jpeg artifacts, chromatic aberration',
      '数据集标签 ye-pop / deviantart 必须放在提示词最行首并换行',
      '加权比 SDXL 更重（例 (chibi:2)）；训练含随机 tag dropout，不必堆满标签',
    ],
    sources: [
      { label: '本地策展库（前 13 轮构建）', url: 'anima-tag-kb/' },
      { label: 'Danbooru 全站标签榜（16 万条，含真实投稿量）', url: 'https://danbooru.donmai.us/tags?search%5Border%5D=count' },
      { label: 'Danbooru 官方 tag_group（56 组 / 662 小节）', url: 'https://danbooru.donmai.us/wiki_pages/tag_groups' },
      { label: 'stars-abyss/ai-tag-toolbox（18,093 行社区标签）', url: 'https://github.com/star-abyss/ai-tag-toolbox' },
      { label: 'weilin9999/WeiLin-Comfyui-Tools-Prompt（4.98 万条官方译名 + 131 二级分类）', url: 'https://github.com/weilin9999/WeiLin-Comfyui-Tools-Prompt' },
      { label: 'yande.re / safebooru / e-shuushuu（画廊站点对照）', url: 'data/sources/' },
    ],
    field_map: SHORT,
  },
  categories: manifestCats,
};
fs.writeFileSync(path.join(SPLIT, 'manifest.json'), JSON.stringify(manifest));

/* ---------- 报告 ---------- */
const report = {
  built_at: manifest.meta.built_at,
  total: T.size, added_from_danbooru: added,
  attribution: stat,
  bigs: manifestCats.map(c => ({ id: c.id, name: c.name, kind: c.kind, count: c.count, subs: c.subs.length, files: c.files.length, top_subs: c.subs.slice(0, 8) })),
  dropped_bigs: dropped,
  zh_missing: zhMissing,
  zh_missing_sample: [...T.values()].filter(t => !t.zh).slice(0, 80).map(t => t.tag),
  nsfw: [...T.values()].filter(t => t.nsfw).length,
};
fs.writeFileSync(path.join(DATA, 'hierarchy-report.json'), JSON.stringify(report, null, 1));
fs.writeFileSync(path.join(DATA, 'sub-merge-applied.json'), JSON.stringify({ note: '小分类近义归并明细（from → to），规则见 build-hierarchy.mjs 的 mergeSubs()', bigs: subMergeLog }, null, 1));

console.log('\n归属来源:', JSON.stringify(stat));
console.log('大类目:', manifestCats.length, ' 小分类:', manifest.meta.subs, ' 总标签:', T.size);
console.log('缺中文:', zhMissing);
console.log('空类目被丢弃:', dropped.join('、') || '（无）');
console.log('\n大分类（按标签数）:');
console.log([...manifestCats].sort((a, b) => b.count - a.count).map(c => `${c.name}(${c.count}/${c.subs.length}小类)`).join('  '));
console.log('\n缺中文样例:', report.zh_missing_sample.slice(0, 30).join(' | '));
