/**
 * config.mjs —— 反推引擎的全部可调参数与静态表（零依赖，只用 Node 标准库）
 *
 * 改这里就能调整行为，不用动算法：
 *   - 词库位置           resolveKbDir()
 *   - 分层顺序与归属      LAYER_NAME / BIG_LAYER / COUNT_SUB
 *   - 正向前缀与负向串     POSITIVE_PREFIX / NEGATIVE_DEFAULT
 *   - 打分权重与阈值       SCORE
 *   - 语义提示词表         HINT_RULES
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SKILL_ROOT = path.resolve(HERE, '..');                 // skills/anima-tag-reverse/
export const REPO_ROOT = path.resolve(SKILL_ROOT, '..', '..');      // 仓库根：DSH- 插件修改创作/

/**
 * 词库目录 = 展览板用的那套分包（manifest.json + search-index.json + bigs/*.json）。
 *
 * 本技能既可留在仓库里跑，也可安装到 `~/.dsh/skills/anima-tag-reverse`（技能中心可见可开关），
 * 安装后 SKILL_ROOT 就不在仓库里了，所以按候选链逐个探测，并用「目录里真的有 manifest.json
 * 和 search-index.json」作为命中判据——避免路径算错时静默返回空词库。
 */
const KB_FILES = ['manifest.json', 'search-index.json'];

export function isKbDir(dir) {
  if (!dir) return false;
  try { return KB_FILES.every(f => fs.statSync(path.join(dir, f)).isFile()); } catch { return false; }
}

/** 安装脚本会往技能目录写 kb-path.json：{ "kbDir": "…\\anima-tag-kb\\画师类" } */
function kbFromPointer() {
  try {
    const raw = fs.readFileSync(path.join(SKILL_ROOT, 'kb-path.json'), 'utf8').replace(/^\uFEFF/, '');
    const j = JSON.parse(raw);
    return typeof j === 'string' ? j : (j && (j.kbDir || j.path));
  } catch { return null; }
}

export function kbCandidates(override) {
  return [
    { dir: override, from: '--kb 参数', explicit: true },
    { dir: process.env.ANIMA_KB_DIR, from: '环境变量 ANIMA_KB_DIR', explicit: true },
    { dir: kbFromPointer(), from: '技能目录 kb-path.json' },
    { dir: path.join(REPO_ROOT, 'anima-tag-kb', '画师类'), from: '技能所在仓库' },
    { dir: path.join(os.homedir(), 'anima-tag-kb', '画师类'), from: '用户主目录' },
    { dir: path.join(process.cwd(), 'anima-tag-kb', '画师类'), from: '当前工作目录' }
  ].filter(c => !!c.dir);
}

export function resolveKbDir(override) {
  const cands = kbCandidates(override);
  for (const c of cands) {
    if (isKbDir(c.dir)) return path.resolve(c.dir);
    // 显式指了却没命中：立刻失败，否则会悄悄用上另一个词库，出图词不对也难查
    if (c.explicit) {
      throw new Error(
        `${c.from} 指向的目录里没有词库（需要同时含 manifest.json 与 search-index.json）：\n` +
        `  ${path.resolve(c.dir)}\n` +
        '确认路径后重试；想让它自动找词库就把这个参数去掉。'
      );
    }
  }
  throw new Error(
    '找不到 Anima 词库目录（需要含 manifest.json + search-index.json 的文件夹）。已试过：\n' +
    cands.map(c => `  · ${c.from}：${path.resolve(c.dir)}`).join('\n') +
    '\n请用 --kb <目录> 或环境变量 ANIMA_KB_DIR 指定。'
  );
}

/** 官方顺序：质量/元信息 → 人数 → 角色 → 作品 → 人物外观 → 画师画风 → 服装与动作 → 构图光影场景 → 其他 */
export const LAYER_NAME = [
  '质量/元信息',
  '人数',
  '角色',
  '作品',
  '人物外观',
  '画师/画风',
  '服装与动作',
  '构图光影场景',
  '其他'
];

/** 大分类 → 层号。与展览板 viewer/template.html 里的 LAYER 表保持一致。 */
export const BIG_LAYER = (() => {
  const m = {};
  const put = (l, ids) => ids.forEach(i => (m[i] = l));
  put(0, ['cb:base', 'og:year-tags', 'og:metatags', 'og:subjective']);
  put(2, ['cb:character']);
  put(3, ['cb:series']);
  put(4, ['cb:body', 'og:face', 'og:eyes', 'og:ears', 'og:makeup', 'og:skin-color', 'og:hair', 'og:hair-color', 'og:hair-styles', 'og:body-parts']);
  put(5, ['cb:artist', 'og:fashion-style', 'og:visual-aesthetic']);
  put(6, ['og:attire', 'og:headwear', 'og:legwear', 'og:handwear', 'og:sleeves', 'og:neck-and-neckwear', 'og:eyewear', 'og:accessories', 'og:patterns', 'og:prints', 'og:posture', 'og:gestures', 'og:hands', 'og:holding-tags', 'og:verbs-and-gerunds', 'og:dances', 'cb:items', 'cb:hanfu']);
  put(7, ['og:image-composition', 'og:focus-tags', 'og:lighting', 'og:colors', 'og:backgrounds', 'og:locations', 'og:real-world-locations', 'og:water', 'og:fire', 'og:flowers', 'og:animals-cats', 'og:animals-dogs', 'og:birds', 'og:creatures', 'og:food-tags', 'og:technology', 'og:audio-tags', 'og:sports', 'og:jobs', 'og:holidays', 'og:companies', 'og:text', 'og:symbols', 'og:phrases', 'og:theme', 'cb:animals', 'cb:effects']);
  put(8, ['cb:nsfw', 'cb:negative', 'og:censorship', 'cb:scheme', 'cb:misc']);
  return m;
})();

/** 人数标签的小分类名——不管它挂在大分类哪一项，一律排到第 1 层 */
export const COUNT_SUB = '人数与画面规模';

/** 不属于「画面描述」的大分类：方案库是成套提示词包、负向要单独出，都不能混进正向串 */
export const EXCLUDE_BIGS = new Set(['cb:scheme', 'cb:negative']);

/** 官方正向前缀 / 负向串（来自 manifest.meta.conventions） */
export const POSITIVE_PREFIX = 'masterpiece, best quality, score_7, safe';
export const NEGATIVE_DEFAULT = 'worst quality, low quality, score_1, score_2, score_3, artist name, blurry, jpeg artifacts, chromatic aberration';

/**
 * 官方分级标签，由弱到强。前缀第 4 位默认是 safe；
 * 命中内容里出现更高级别的分级标签时（R18 / NSFL 描述照常匹配，本技能不做任何内容审查与过滤），
 * 只把前缀里的分级 token 换成对应级别，保证「标签格式符合标签库规范」而不是压制内容。
 */
export const RATING_TAGS = ['safe', 'sensitive', 'questionable', 'nsfw', 'explicit'];

/**
 * 单字汉字表面的准入条件。
 * 中文里单个汉字太容易在更长的词里被误命中（「女高中生」里的「高」会命中 gao），
 * 所以只有「够常见的单字标签」或下面这份明确的独立动作/季节词表才认单字命中；
 * 其余照样能通过多字表面（高中生 / 坐着 / 站着 …）命中，不会丢。
 */
export const SINGLE_CJK_MIN_FREQ = 8000;

/**
 * 单字命中的「复合词护栏」：这些二字词出现时，里面的那个字不能单独当标签。
 * 中文没有词边界，高频单字标签很容易在常用词里虚命中：
 *   角色 → 角 → horns ／ 风格 → 风 → wind ／ 心情 → 心 → heart ／ 眼球 → 球 → ball
 * 只挡这些明确的词，不动「鹿角 / 风吹」这类真实用法。
 */
export const SINGLE_CJK_BLOCK_2G = [
  '角色', '风格', '风景', '风情', '风俗',
  '心情', '开心', '中心', '关心', '小心',
  '眼球', '气球', '地球', '环球',
  '鬼灭'
];
export const SINGLE_CJK_OK = new Set('蹲跪趴爬跳跑走站坐躺哭笑亲抱拿举看听吃喝睡春夏秋冬'.split(''));

/**
 * 打分权重。最终分 = 相似度 × (B + (1-B) × 频次分) × 置信度系数 × 提示加成
 *   sim        子串/编辑距离/字符集相似度（0–1）
 *   freq       投稿量归一化（log 刻度，避免 8.5M 压死一切）
 *   confidence 高 / 中 / 待验证
 *   hint       用户的语义提示（"画师"、“构图”…）指向的层被加权，其它层轻微降权
 */
export const SCORE = {
  base: 0.68,              // 相似度之外的保底分（保证冷门但精准的标签不被高频标签压掉）
  freq: 0.32,              // 频次分占比
  medianFs: 0.42,          // 无投稿量数据的条目（约 12%）按「中位标签的频次分」给中性先验（实测中位数 0.4206）
  conf: { 高: 1.05, 中: 1.0, 待验证: 0.94 },
  hintBoost: 1.22,         // 命中提示层
  hintPenalty: 0.9,        // 提示层之外
  minScore: 0.46,          // 低于此分直接丢
  minSim: 0.52,            // 相似度下限（纯相似度路径）
  topPerClause: 3,         // 每个分句最多留几个候选
  // 逐字命中（surface/forced/jp/rule）在全局截断时的名额倍数：matchClause 已让它们豁免
  // perClause 名额，但全局 all.slice(0, top) 原先纯按分数切，会把 R18 图里逐字写出的
  // sex / penis / censored 这类关键词切掉（实测位次 98–118，top:100 全丢且分级漏判）。
  // 逐字命中最多保留 top×该倍数条，再回填非逐字命中到 top，既补回关键标签又不炸量。
  literalTopMult: 2,
  exact: { tag: 1.0, zh: 0.97, alias: 0.93, jp: 0.95, phrase: 0.88 }
};

/**
 * 宽召回档（CLI `--broad` / `broad:true`）。
 * 默认档的阈值是为了「宁可少给」——默认输出形状被一批回归用例锁着，不能动；
 * 补全场景（缺项检测、候选清单、自然语言分支）需要另一套更宽松的阈值去多捞候选，
 * 所以单独开一档，只在显式要求时生效，默认行为一个字节都不变。
 */
export const BROAD = {
  minScore: 0.38,
  minSim: 0.44,
  topPerClause: 6,
  candidateBudget: 6000,   // recallTokens 的预算上限
  surfaceTexts: 24,        // 每条标签参与比对的表面数
  altPerLayer: 12,         // 每层保留多少条备选（供给补全清单）
  altTotal: 80             // 备选总量上限
};

/** 语义提示：描述里出现这些词，说明用户要的是哪一层/哪一类标签 */
export const HINT_RULES = [
  { layer: 5, re: /画师|画风|风格|笔触|上色|artist|style|by\s|painter/i },
  { layer: 7, re: /构图|视角|镜头|机位|景别|打光|光线|背景|场景|composition|angle|shot|camera|lighting|background|scene/i },
  { layer: 6, re: /服装|穿着|穿|衣服|外套|裙子|裤子|鞋|袜|配饰|动作|姿势|outfit|clothes|wearing|dress|pose|action/i },
  { layer: 4, re: /头发|发型|发色|眼睛|瞳|脸|表情|身材|皮肤|hair|eye|face|expression|body|skin/i },
  { layer: 3, re: /作品|系列|出自|from\s|series/i },
  { layer: 2, re: /角色|人物|character/i },
  { layer: 1, re: /人数|单人|双人|多人|solo|multiple girls|multiple boys/i },
  { layer: 0, re: /质量|画质|分辨率|安全|分级|quality|resolution|rating/i }
];

/** 否定词：分句里出现即判为负向 */
export const NEG_RE = /^(不要|不需要|没有|无|别|非|去掉|除去|避免|no\s|not\s|without\s|except\s|avoid\s)/i;

/** 强度词：只影响排序权重分（本版本不做 tag:(x) 加权，遵守官方"不必堆满"的约定） */
export const INTENSITY = {
  up: /非常|极其|特别|超|很|十分|极其强烈|very|extremely|really|strong|heavy/i,
  down: /稍微|略微|有点|一点|轻轻地|淡淡|slightly|a bit|abit|mild|light(ly)?/i
};

/** 分句切分符（中文标点 + 常见连接符） */
export const SPLIT_RE = /[，,。；;！!？?、\n\r|｜/／+＋&]|(?:\s(?:and|with|plus)\s)/i;

/**
 * 补充分层释义：词库里少数条目的中文释义缺失或带了官方分组前缀
 * （例如 glasses 的释义是「服装：glasses」），这里手工补上用户最可能写的说法。
 * 规则：只补**确认存在于库里的标签**，不放猜测；键是标签，值是常见中文/日文说法。
 */
export const EXTRA_ZH = {
  'glasses': ['眼镜'],
  'reading': ['看书', '读书'],
  'holding book': ['拿着书', '拿书'],
  'sitting': ['坐着', '坐下'],
  'standing': ['站着', '站立'],
  'lying': ['躺着', '躺下'],
  'on back': ['仰卧', '仰躺'],
  'on stomach': ['趴着', '俯卧'],
  'book': ['书籍'],
  'looking at viewer': ['看着镜头', '看镜头'],
  'open mouth': ['张开嘴', '张着嘴'],
  'school uniform': ['学生服'],
  'long hair': ['长长的头发'],
  'blue hair': ['蓝色的头发'],
  'blonde hair': ['金色的头发'],
  'black hair': ['黑色的头发'],
  'white hair': ['白色的头发'],
  'backlighting': ['背光'],
  'classroom': ['教室里'],
  'night': ['夜里', '夜间'],
  'smile': ['微笑着'],
  'blush': ['脸红着'],
  // 人物类别：本库里没有 schoolgirl / high_school_girl 这类词（已用 --search 核实），
  // 所以「女高中生」「男生」这类说法兜到通用的 girl / boy 上，不硬凑具体校服标签
  'girl': ['女高中生', '高中生', '女生', '女学生'],
  'boy': ['男高中生', '男生', '男学生']
};

/** 这些词是语法连接词，扫描词典时要跳过 */
export const STOP_WORDS = new Set([
  'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'is', 'are', 'was', 'were', 'be', 'being', 'been',
  'and', 'or', 'but', 'with', 'without', 'for', 'from', 'by', 'as', 'that', 'this', 'these', 'those',
  'her', 'his', 'she', 'he', 'it', 'its', 'their', 'very', 'really', 'quite', 'slightly', 'and', 'then',
  '一个', '一位', '有着', '带着', '正在', '的是', '还有', '以及', '并且', '然后', '画面', '图片', '照片'
]);

/** 纯虚词（介词/冠词/系动词）：英文别名切窗口时，不能让窗口以这些词收尾，
 *  否则 "sitting on" 这种碎片会同时命中 on_floor / on_desk / seiza 等一堆标签 */
export const FUNCTION_WORDS = new Set([
  'a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'into', 'onto', 'over', 'under', 'with', 'without',
  'for', 'from', 'by', 'as', 'and', 'or', 'is', 'are', 'am', 'was', 'were', 'be', 'being', 'been', 'her', 'his', 'its', 'their'
]);
