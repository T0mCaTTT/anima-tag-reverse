/**
 * nl.mjs —— 第四步（分支）：把标签结果重组成英文自然语言提示词
 *
 * Anima 官方模型卡里写明：标签串与自然语言可以混排，自然语言更适合描述关系、
 * 方位与动作，而标签更适合点名角色、作品、画师与构图。所以这里不做「标签翻译成句子」
 * 的逐词搬运，而是按下面的分工重排：
 *
 *   第 1 句  人数与画面规模（one girl, alone / two boys）
 *   第 2-3 句 单个人物的外观，再补一句她/他穿什么
 *   第 4 句  姿势与动作
 *   第 5 句  场景、时间、光线
 *   第 6 句  画风、媒介、画质
 *
 * 关键约束（都是刻意的）：
 *   1. 确定性——只做标签 → 英文短语的查表与拼接，不引入随机、不做二次创作；
 *      模型想润色就在这份骨架上改，不需要重新反推。
 *   2. 不丢信息——每个进了自然语言的标签都会在 meta.used 里留痕；
 *      查不到专属措辞的标签走带标记的兜底措辞（meta.fallback），句子后面还会把
 *      原标签串附上，保证「标签是人能核对的地面真值」。
 *   3. 分级照写——评分/分级类标签只影响措辞强度，不做任何过滤。
 */
import { LAYER_NAME, POSITIVE_PREFIX } from './config.mjs';
import { keyOf } from './normalize.mjs';
import { dispTag } from './compose.mjs';

/** 单标签 → 英文措辞。查不到的标签走 inferPhrase() 兜底，句子照样成立。 */
const PHRASE = {
  // —— 人数与画面规模（layer 1）——
  'solo': 'alone',
  '1girl': 'one girl',
  '2girls': 'two girls',
  '3girls': 'three girls',
  '4girls': 'four girls',
  '5girls': 'five girls',
  '6+girls': 'a group of girls',
  'multiple girls': 'several girls',
  '1boy': 'one boy',
  '2boys': 'two boys',
  '3boys': 'three boys',
  'multiple boys': 'several boys',
  '1other': 'one non-human subject',

  // —— 头发（layer 4）——
  'long hair': 'long hair',
  'very long hair': 'very long hair',
  'short hair': 'short hair',
  'medium hair': 'shoulder-length hair',
  'absurdly long hair': 'floor-length hair',
  'silver hair': 'silver hair',
  'blonde hair': 'blonde hair',
  'black hair': 'black hair',
  'brown hair': 'brown hair',
  'white hair': 'white hair',
  'red hair': 'red hair',
  'pink hair': 'pink hair',
  'purple hair': 'purple hair',
  'green hair': 'green hair',
  'grey hair': 'grey hair',
  'orange hair': 'orange hair',
  'aqua hair': 'aqua hair',
  'blue hair': 'blue hair',
  'multicolored hair': 'multicolored hair',
  'gradient hair': 'gradient-colored hair',
  'two-tone hair': 'two-tone hair',
  'twintails': 'hair tied in twintails',
  'ponytail': 'hair in a ponytail',
  'braid': 'braided hair',
  'hime cut': 'a hime cut',
  'bob cut': 'a bob cut',
  'bangs': 'bangs',
  'blunt bangs': 'straight-cut bangs',
  'sidelocks': 'sidelocks',
  'ahoge': 'a stray ahoge',
  'hair between eyes': 'a strand of hair between the eyes',
  'messy hair': 'messy hair',
  'wavy hair': 'wavy hair',
  'curly hair': 'curly hair',
  'hair intakes': 'hair intakes',
  'hair ornament': 'a hair ornament',
  'hair ribbon': 'a ribbon in the hair',

  // —— 眼睛、瞳孔与表情（layer 4）——
  'blue eyes': 'blue eyes',
  'red eyes': 'red eyes',
  'green eyes': 'green eyes',
  'brown eyes': 'brown eyes',
  'black eyes': 'black eyes',
  'grey eyes': 'grey eyes',
  'purple eyes': 'purple eyes',
  'gold eyes': 'golden eyes',
  'aqua eyes': 'aqua eyes',
  'pink eyes': 'pink eyes',
  'yellow eyes': 'yellow eyes',
  'silver eyes': 'silver eyes',
  'heterochromia': 'heterochromia',
  'slit pupils': 'slit pupils',
  'heart-shaped pupils': 'heart-shaped pupils',
  'star-shaped pupils': 'star-shaped pupils',
  'constricted pupils': 'constricted pupils',
  'looking at viewer': 'looking at the viewer',
  'looking back': 'looking back over the shoulder',
  'looking away': 'looking away',
  'looking down': 'looking down',
  'looking up': 'looking up',
  'closed eyes': 'eyes closed',
  'half-closed eyes': 'half-lidded eyes',
  'one eye closed': 'one eye closed in a wink',
  'smile': 'smiling',
  'light smile': 'a faint smile',
  'grin': 'grinning',
  'open mouth': 'mouth slightly open',
  'closed mouth': 'mouth closed',
  'parted lips': 'lips parted',
  'blush': 'blushing',
  'embarrassed': 'looking embarrassed',
  'serious': 'a serious expression',
  'expressionless': 'a blank expression',
  'surprised': 'a surprised expression',
  'crying': 'crying',
  'tears': 'tears in the eyes',
  'angry': 'an angry expression',
  'sad': 'a sad expression',
  'profile': 'seen in profile',
  'silver hair': 'silver hair',
  'blue hair': 'blue hair',
  'pink hair': 'pink hair',
  'silver eyes': 'silver eyes',
  'blue eyes': 'blue eyes',
  'red eyes': 'red eyes',
  'green eyes': 'green eyes',
  'purple eyes': 'purple eyes',
  'brown eyes': 'brown eyes',
  'sideways mouth': 'a slight smirk',
  'nervous smile': 'a nervous smile',
  'evil smile': 'a wicked grin',

  // —— 身体与皮肤（layer 4）——
  'large breasts': 'a full figure',
  'small breasts': 'a slender figure',
  'flat chest': 'a flat chest',
  'wide hips': 'wide hips',
  'thick thighs': 'thick thighs',
  'dark skin': 'dark skin',
  'pale skin': 'pale skin',
  'tan': 'tanned skin',
  'freckles': 'freckles',
  'mole under eye': 'a beauty mark under the eye',
  'animal ears': 'animal ears',
  'cat ears': 'cat ears',
  'tail': 'a tail',
  'wings': 'wings',
  'horns': 'horns',
  'halo': 'a halo',

  // —— 服饰（layer 6）——
  'school uniform': 'a school uniform',
  'serafuku': 'a serafuku',
  'sailor dress': 'a sailor dress',
  'dress': 'a dress',
  'white dress': 'a white dress',
  'black dress': 'a black dress',
  'shirt': 'a shirt',
  'blouse': 'a blouse',
  'skirt': 'a skirt',
  'pleated skirt': 'a pleated skirt',
  'shorts': 'shorts',
  'pants': 'pants',
  'jacket': 'a jacket',
  'hoodie': 'a hoodie',
  'sweater': 'a sweater',
  'cardigan': 'a cardigan',
  'kimono': 'a kimono',
  'yukata': 'a yukata',
  'japanese clothes': 'traditional Japanese clothing',
  'swimsuit': 'a swimsuit',
  'school swimsuit': 'a school swimsuit',
  'bikini': 'a bikini',
  'thighhighs': 'thigh-high socks',
  'black thighhighs': 'black thigh-highs',
  'white thighhighs': 'white thigh-highs',
  'pantyhose': 'pantyhose',
  'socks': 'socks',
  'shoes': 'shoes',
  'boots': 'boots',
  'gloves': 'gloves',
  'black gloves': 'black gloves',
  'hat': 'a hat',
  'beret': 'a beret',
  'glasses': 'glasses',
  'ribbon': 'a ribbon',
  'hairband': 'a hairband',
  'necktie': 'a necktie',
  'scarf': 'a scarf',
  'cape': 'a cape',
  'cloak': 'a cloak',
  'armor': 'armor',
  'uniform': 'a uniform',

  // —— 姿势与动作（layer 6）——
  'standing': 'standing',
  'sitting': 'sitting',
  'sitting on chair': 'sitting on a chair',
  'kneeling': 'kneeling',
  'lying': 'lying down',
  'on back': 'on her back',
  'on stomach': 'on her stomach',
  'walking': 'walking',
  'running': 'running',
  'jumping': 'mid-jump',
  'arms up': 'arms raised',
  'arms behind back': 'arms held behind the back',
  'hand on hip': 'one hand on the hip',
  'hands on hips': 'hands on the hips',
  'holding': 'holding something',
  'holding sword': 'holding a sword',
  'holding book': 'holding a book',
  'holding umbrella': 'holding an umbrella',
  'holding phone': 'holding a phone',
  'holding cup': 'holding a cup',
  'holding bag': 'holding a bag',
  'heart hands duo': 'making a heart shape with both hands',
  'reading': 'reading',
  'eating': 'eating',
  'sleeping': 'asleep',
  'hugging': 'hugging',
  'stretching': 'stretching',
  'leaning forward': 'leaning forward',
  'crossed arms': 'arms crossed',
  'crossed legs': 'legs crossed',
  'outstretched arm': 'one arm reaching out',

  // —— 场景、时间、光线（layer 7）——
  'indoors': 'indoors',
  'outdoors': 'outdoors',
  'classroom': 'in a classroom',
  'school': 'at school',
  'bedroom': 'in a bedroom',
  'living room': 'in a living room',
  'kitchen': 'in a kitchen',
  'library': 'in a library',
  'rooftop': 'on a rooftop',
  'balcony': 'on a balcony',
  'street': 'on a street',
  'city': 'in a city',
  'beach': 'on a beach',
  'forest': 'in a forest',
  'park': 'in a park',
  'garden': 'in a garden',
  'mountain': 'in the mountains',
  'underwater': 'underwater',
  'night': 'at night',
  'day': 'during the day',
  'evening': 'in the evening',
  'sunset': 'at sunset',
  'sunrise': 'at sunrise',
  'rain': 'in the rain',
  'snow': 'in the snow',
  'starry sky': 'under a starry sky',
  'cloudy sky': 'under a cloudy sky',
  'blue sky': 'under a blue sky',
  'cherry blossoms': 'among cherry blossoms',
  'flowers': 'among flowers',
  'backlighting': 'backlit',
  'in the rain': 'in the rain',
  'in the snow': 'in the snow',
  'in the water': 'in the water',
  'on the beach': 'on a beach',
  'rim light': 'with rim lighting',
  'soft lighting': 'in soft light',
  'sunlight': 'in sunlight',
  'moonlight': 'in moonlight',
  'neon lights': 'in neon light',
  'shadow': 'with deep shadows',
  'depth of field': 'with a shallow depth of field',
  'blurry background': 'with a blurred background',
  'from above': 'seen from above',
  'from below': 'seen from below',
  'from behind': 'seen from behind',
  'from side': 'seen from the side',
  'dutch angle': 'on a tilted angle',
  'close-up': 'in close-up',
  'upper body': 'framed on the upper body',
  'full body': 'framed full-body',
  'cowboy shot': 'framed in a cowboy shot',
  'wide shot': 'in a wide shot',
  'pov': 'from a first-person point of view',

  // —— 画风、媒介、画质（layer 8 / 0）——
  'anime screenshot': 'with the look of an anime screenshot',
  'official art': 'in official-art quality',
  'monochrome': 'in monochrome',
  'greyscale': 'in greyscale',
  'sketch': 'drawn as a sketch',
  'lineart': 'with clean lineart',
  'watercolor': 'in watercolor',
  'oil painting': 'as an oil painting',
  'cel shading': 'with cel shading',
  'flat color': 'with flat colors',
  'highres': 'at high resolution',
  'absurdres': 'at very high resolution',
  'masterpiece': 'rendered as a masterpiece',
  'best quality': 'with the best quality',
  'chromatic aberration': 'with slight chromatic aberration',
  'film grain': 'with film grain'
};

/** 完整匹配的措辞键（keyOf 后的形式），便于带下划线的标签也能命中 */
const PHRASE_KEY = new Map();
for (const [k, v] of Object.entries(PHRASE)) PHRASE_KEY.set(keyOf(k), v);

/** 层 → 句子角色。一句话里按这里的顺序罗列短语。 */
const ROLE = {
  1: 'count',
  4: 'appearance',
  6: 'outfit',
  7: 'scene',
  8: 'style',
  0: 'style'
};

/** 句子骨架的顺序与连接方式 */
const SENTENCE = {
  count: { lead: '', join: ', ' },
  appearance: { lead: 'The character has ', join: ', ' },
  outfit: { lead: 'She is wearing ', join: ', ' },
  pose: { lead: 'She is ', join: ', ' },
  scene: { lead: 'The scene is set ', join: ', ' },
  style: { lead: 'The image is rendered ', join: ', ' }
};

/**
 * 动作类措辞的开头：层 6 里这些标签属于「她在做什么」，而不是「她穿着什么」。
 * 单看标签名不够用——`heart hands duo` 这种多词动作标签既不在 POSE_TAGS 里，
 * 也不以 holding/sitting 开头，但它给出的措辞是 "making a heart shape with both hands"，
 * 明显不该出现在 "She is wearing …" 后面。所以这里同时看措辞。
 */
const POSE_PHRASE_RE = /^(holding|making|wearing nothing|sitting|standing|lying|kneeling|walking|running|jumping|leaning|crossed|arms|hands|one arm|reading|writing|eating|drinking|sleeping|hugging|stretching|looking|waving|dancing|singing|reaching|mid-jump|on her)/i;

/** 姿势与动作类标签（层 6 里归到 pose 的那一批），其余层 6 标签算服装 */
const POSE_TAGS = new Set([
  'standing', 'sitting', 'kneeling', 'lying', 'on back', 'on stomach', 'walking', 'running',
  'jumping', 'arms up', 'arms behind back', 'hand on hip', 'hands on hips', 'holding',
  'reading', 'eating', 'sleeping', 'hugging', 'stretching', 'leaning forward', 'crossed arms',
  'crossed legs', 'outstretched arm', 'sitting on chair', 'sitting on bed', 'on bed',
  'squatting', 'crouching', 'bent over', 'looking at viewer', 'looking back', 'looking away',
  'looking down', 'looking up', 'waving', 'salute', 'skipping', 'dancing',
  'heart hands duo', 'holding umbrella', 'holding sword', 'holding book', 'holding phone'
]);

/**
 * 场景句只收「地点/时间/光线/机位」这类真场景词。
 * 词库把少数外观标签挂在 og:image-composition 下（`silver hair` 就在层 7），
 * 光靠层号会让它落进 "The scene is set …"。这里按措辞是否带场景介词做一次闸门：
 * 过不了闸门的退回外观句，宁可在正确的句子里略啰嗦，也不写出错位的英文。
 */
const SCENE_KEEP_RE = /^(among|at|in|on|under|with|during|from|by|backlit|seen|framed|lit|behind|inside|outside|near|against|through|over|around|toward)\b/;

/**
 * 单个标签 → 英文措辞。三级：专属表 → 形态/释义推断 → 原样兜底。
 * 兜底不静默：走 fallback 的标签会进 meta.fallback，报告里单独列出。
 */
function phraseOf(tag, m = {}) {
  const k = keyOf(tag);
  const hit = PHRASE_KEY.get(k);
  if (hit) return { text: hit, source: 'phrase' };
  const d = dispTag(tag);
  if (!d) return { text: '', source: 'skip' };
  return inferPhrase(tag, m);
}

/**
 * 查不到专属措辞时的推断：按标签自身形态与中文释义拼一句能读的英文。
 * 比「原样贴标签」强的地方在于语法位置对得上，句子不至于出现
 * 「The scene is set silver hair」这种明显错位的拼接。命中时标记 source='infer'。
 */
const CN_TO_EN = {
  头发: { kind: 'noun', en: 'hair' },
  长发: { kind: 'noun', en: 'long hair' },
  短发: { kind: 'noun', en: 'short hair' },
  眼睛: { kind: 'noun', en: 'eyes' },
  瞳: { kind: 'noun', en: 'eyes' },
  校服: { kind: 'noun', en: 'a school uniform' },
  水手服: { kind: 'noun', en: 'a sailor uniform' },
  连衣裙: { kind: 'noun', en: 'a dress' },
  裙子: { kind: 'noun', en: 'a skirt' },
  衬衫: { kind: 'noun', en: 'a shirt' },
  外套: { kind: 'noun', en: 'a jacket' },
  帽子: { kind: 'noun', en: 'a hat' },
  眼镜: { kind: 'noun', en: 'glasses' },
  手套: { kind: 'noun', en: 'gloves' },
  袜子: { kind: 'noun', en: 'socks' },
  过膝袜: { kind: 'noun', en: 'thigh-high socks' },
  鞋: { kind: 'noun', en: 'shoes' },
  教室: { kind: 'place', en: 'in a classroom' },
  背景: { kind: 'noun', en: 'background' },
  星空: { kind: 'noun', en: 'a starry sky' },
  天空: { kind: 'noun', en: 'the sky' },
  云: { kind: 'noun', en: 'clouds' },
  花: { kind: 'noun', en: 'flowers' },
  樱花: { kind: 'noun', en: 'cherry blossoms' },
  树: { kind: 'noun', en: 'a tree' },
  森林: { kind: 'place', en: 'in a forest' },
  海边: { kind: 'place', en: 'at the beach' },
  城市: { kind: 'place', en: 'in a city' },
  街: { kind: 'place', en: 'on a street' },
  室内: { kind: 'place', en: 'indoors' },
  室外: { kind: 'place', en: 'outdoors' },
  火: { kind: 'noun', en: 'fire' },
  水: { kind: 'noun', en: 'water' },
  雨: { kind: 'noun', en: 'rain' },
  雪: { kind: 'noun', en: 'snow' },
  风: { kind: 'noun', en: 'wind' },
  光: { kind: 'noun', en: 'light' },
  影: { kind: 'noun', en: 'shadow' },
  尾: { kind: 'noun', en: 'a tail' },
  翅膀: { kind: 'noun', en: 'wings' },
  犬: { kind: 'noun', en: 'a dog' },
  猫: { kind: 'noun', en: 'a cat' },
  耳朵: { kind: 'noun', en: 'ears' },
  嘴: { kind: 'noun', en: 'the mouth' },
  手: { kind: 'noun', en: 'the hand' },
  腿: { kind: 'noun', en: 'legs' },
  皮肤: { kind: 'noun', en: 'skin' },
  锁骨: { kind: 'noun', en: 'collarbones' },
  肚脐: { kind: 'noun', en: 'the navel' },
  血: { kind: 'noun', en: 'blood' }
};

function inferPhrase(tag, m) {
  const key = keyOf(tag);
  const d = dispTag(tag);
  const zh = String(m.zh || m.zhCore || '').trim();

  // 1) 中文释义里能切出名词 + 修饰（颜色/图案/材质），拼成「a blue sailor uniform」这类完整名词短语
  if (zh) {
    const sorted = Object.keys(CN_TO_EN).sort((a, b) => b.length - a.length);
    for (const head of sorted) {
      const pos = zh.indexOf(head);
      if (pos < 0) continue;
      // 只认词首或前一个字是非汉字的命中：「把嘴画在侧脸」里的「脸」不该被当成「侧脸」这类名词核
      if (pos > 0 && /[\u4e00-\u9fff]/.test(zh[pos - 1])) continue;
      const info = CN_TO_EN[head];
      const before = zh.slice(0, pos).replace(/[的地得之·、\s]/g, '');
      if (info.kind === 'place') return { text: info.en, source: 'infer' };
      if (before && !/^(一|个|种|件|条|只|把)$/.test(before)) return { text: `${before} ${info.en}`, source: 'infer' };
      return { text: info.en, source: 'infer' };
    }
  }

  // 2) 标签自身的形态：known suffix / 服饰词 / 主题词
  const w = key.split('_');
  const last = w[w.length - 1];
  if (knownSuffix(last)) return { text: (d.match(/^[aeiou]/) ? 'an ' : 'a ') + d, source: 'infer' };
  if (GARMENT_RE.test(key) || /attire|clothes|clothing|nudity/.test(m.big || '')) return { text: 'a ' + d, source: 'infer' };
  if (KEYWORD_RE.test(key)) return { text: 'with ' + d, source: 'infer' };
  if (/^(from|on|at|in|under|over|with|against|between|through)/.test(key)) return { text: d, source: 'infer' };
  if (knownSuffix(w[0])) return { text: (d.match(/^[aeiou]/) ? 'an ' : 'a ') + d, source: 'infer' };
  if (ACTION_RE.test(key)) return { text: d, source: 'infer' };
  return { text: d, source: 'fallback' };
}

const isPose = (m) => m.layer === 6 && (POSE_TAGS.has(keyOf(m.tag)) || /^(holding|sitting|standing|lying|looking)/.test(keyOf(m.tag)));

/** 常见名词后缀：能以「a/an <标签>」直接当名词短语用的 */
const SUFFIX_RE = /(?:^|_)(hair|eyes?|pupils?|skirt|dress|shirt|blouse|jacket|coat|sweater|hoodie|cardigan|hat|cap|beret|ribbon|bow|necktie|scarf|gloves?|socks?|shoes?|boots?|thighhighs?|pantyhose|uniform|kimono|yukata|swimsuit|bikini|apron|veil|crown|halo|horns?|wings?|tails?|ears?|earrings?|necklace|choker|bracelet|ring|bag|backpack|sword|katana|umbrella|bowtie|hairband|hairpin|clip|tie)$/;
const knownSuffix = (s) => SUFFIX_RE.test(String(s).toLowerCase());

/** 服装类关键词：兜底时给「a <标签>」的名词形态 */
const GARMENT_RE = /(shirt|dress|skirt|uniform|serafuku|kimono|yukata|swimsuit|bikini|jacket|coat|sweater|hoodie|cardigan|apron|socks|shoes|boots|gloves|hat|cap|beret|ribbon|necktie|scarf|cloak|cape|armor|thighhigh|pantyhose|neckerchief|leotard|bodysuit|lingerie|underwear|bra|panties|corset|stockings)/;
/** 修饰类关键词：兜底时给「with <标签>」 */
const KEYWORD_RE = /(lighting|light|shadow|glow|blur|focus|effect|texture|pattern|print|embroidery|frill|lace|ribbon|ornament|jewel|accessory|makeup|paint|tattoo|scar|bandage|chains?)/;
/** 动作类关键词：兜底时原样用（句子主语已经是 She is） */
const ACTION_RE = /(holding|sitting|standing|lying|walking|running|jumping|leaning|crossed|raised|outstretched|looking|turning|reaching|hugging|carrying|wearing|riding|eating|drinking|reading|writing|sleeping|kissing|dancing|singing|waving)/i;

/** 人数与规模句：把 solo / 1girl 这类合成一句人话 */
function buildCountSentence(ms, subjects = []) {
  const keys = ms.map(m => keyOf(m.tag));
  const tagOf = m => keyOf(m && m.tag);
  const hasGirlInMs = keys.some(k => k === '1girl' || k === '2girls' || k === '3girls' || k === '4girls' || k === '5girls' || k === '6+girls' || k === 'multiple girls' || k === 'girl');
  const hasBoyInMs = keys.some(k => k === '1boy' || k === '2boys' || k === '3boys' || k === 'multiple boys' || k === 'boy');
  // 人数标签（1girl / 2girls / multiple girls）优先；只有性别词（girl / boy）时退回到它们。
  // 词库对「两个人，一个男孩一个女孩」会同时给出 1girl / 1boy / 2girls 三条，
  // 而 1girl 常被官方前缀里的 safe/score_7 同层挤掉、只剩 1boy 与 2girls，
  // 所以这里按「人数层已覆盖的性别」判断：另一种性别若在主体标签里出现，就补进来，
  // 否则男孩会在「Two girls」里凭空消失。
  const picked = ms.slice();
  if (ms.length && subjects.length) {
    const has = k => keys.includes(k);
    if (!hasGirlInMs && subjects.some(m => /girl/.test(tagOf(m)))) picked.push({ tag: '1girl' });
    if (!hasBoyInMs && subjects.some(m => /boy/.test(tagOf(m)))) picked.push({ tag: '1boy' });
  }
  const all = picked.length ? picked : subjects;
  const parsed = [];
  for (const m of all) {
    const k = tagOf(m);
    if (!k || k === 'solo') continue;
    const p = phraseOf(k, m);
    if (!p.text || p.source === 'skip') continue;
    // '1boy' → 数 1、性别 'boy'；'2girls' → 数 2、性别 'girl'
    // 注意 keyOf 结果为 '1boy'/'1boy'（单数无 s），所以 boys? 必须写成可选 s，否则 1boy 会被正则漏掉
    const cnt = /^([1-6])(boys?|girls?|other)$/.exec(k);
    const single = /^(boy|girl)$/.exec(k);
    const gender = cnt ? (cnt[2] === 'boys' || cnt[2] === 'boy' ? 'boy' : cnt[2] === 'girls' || cnt[2] === 'girl' ? 'girl' : '') : single ? single[1] : '';
    const n = cnt ? Number(cnt[1]) : single ? 1 : null;
    // 只有性别没有人数时（girl / boy，来源是被前缀挤掉 1girl 后的裸身份标签）补一个数词，
    // 否则人数句会退化成单词「Girl.」——官方推荐写法里人数句要能独立成句。
    const text = gender && n && !/^(a|an|one|two|three|four|five|six|several|many)\b/i.test(p.text)
      ? (n === 1 ? `one ${p.text}` : `${['', 'one', 'two', 'three', 'four', 'five', 'six'][n] || n} ${p.text}`) + (n > 1 && !/s$/.test(p.text) ? 's' : '')
      : p.text;
    parsed.push({ text, n, gender, tag: k });
  }
  let phrase = '';
  if (parsed.length) {
    // 同一性别只留人数最大的那条（1girl 与 2girls 并存时留 2girls），不同性别各自保留
    const byGender = new Map();
    const others = [];
    for (const p of parsed) {
      if (!p.gender) { others.push(p); continue; }
      const prev = byGender.get(p.gender);
      if (!prev || (p.n || 0) > (prev.n || 0)) byGender.set(p.gender, p);
    }
    let picked2 = [...byGender.values()];
    if (!picked2.length) picked2 = others;
    phrase = picked2.map(p => p.text).join(' and ');
  }
  if (!phrase) return '';
  if (keys.includes('solo') && !/ alone$/.test(phrase)) phrase += ' alone';
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

/** 主体身份标签：在自然语言里由人数句承担，不再当外观词重复一遍 */
const SUBJECT_TAGS = new Set(['girl', 'boy', '1girl', '1boy', 'solo', 'multiple girls', 'multiple boys']);

/** 落在场景层但其实是动作的标签（词库把 reading 归到构图/场景），拨回姿势句 */
const SCENE_ACTION_RE = /^(reading|writing|eating|drinking|sleeping|cooking|drawing|playing|singing|dancing|smoking|driving|swimming|running|walking|jumping|flying|fighting|kissing|hugging)/;

/**
 * 外观类标签的形态特征：词库把一部分外观词挂在 og:image-composition（层 7），
 * 典型是 `silver hair`（zh=银发）。只看层号会让它写成 "The scene is set … silver hair"，
 * 所以场景句要先过这道闸：命中外观形态的一律回外观句。
 */
const APPEARANCE_FORM_RE = /(hair|eyes?|pupils?|skin|ears?|tail|wings?|horn|halo|blush|freckles|mole|teeth|fangs?|tongue)/;

/**
 * 生成英文自然语言提示词
 * @param {object} res compose() 的返回值（含 layers / matches / rating / negative）
 * @param {object} opts { withTags: 句末是否附标签兜底串, maxPerSentence }
 * @returns {{ text, sentences, negative, rating, meta, markdown }}
 */
export function buildNaturalLanguage(res, opts = {}) {
  const withTags = opts.withTags !== false;
  const maxPerSentence = opts.maxPerSentence || 12;
  const prefixKeys = new Set(POSITIVE_PREFIX.split(',').map(s => keyOf(s)).filter(Boolean));

  // 1) 从分层结果里归拢标签（前缀里已有的不再重述）
  const buckets = new Map();
  const subjects = [];
  if (process.env.RTAG_NL_DEBUG) console.error('[nl] layers=' + JSON.stringify((res.layers || []).map(l => `${l.layer}:${l.tags.length}`)));
  for (const layer of res.layers || []) {
    for (const t of layer.tags) {
      const k = keyOf(t.tag);
      if (!k || prefixKeys.has(k) || /^score_\d/.test(k)) continue;
      if (SUBJECT_TAGS.has(k)) { subjects.push(t); continue; }   // 主体身份由人数句承担
      let role = t.layer === 6 && (isPose(t) || POSE_PHRASE_RE.test(phraseOf(t.tag, t).text)) ? 'pose' : (ROLE[t.layer] || 'other');
      // 动作类标签落进场景层时拨回姿势句（「reading」不该出现在 "The scene is set …" 里）
      if (role === 'scene' && SCENE_ACTION_RE.test(k)) role = 'pose';
      const arr = buckets.get(role) || [];
      if (arr.length >= maxPerSentence) continue;
      arr.push(t);
      buckets.set(role, arr);
    }
  }

  // 2) 逐句渲染
  if (process.env.RTAG_NL_DEBUG) console.error('[nl] buckets=' + JSON.stringify([...buckets].map(([k, v]) => `${k}:${v.length}`)));
  const sentences = [];
  const used = [];
  const fallback = [];
  const push = (text, role) => {
    if (!text) return;
    sentences.push({ role, text });
  };

  const countMs = buckets.get('count') || [];
  if (countMs.length || subjects.length) {
    const phrase = buildCountSentence(countMs, subjects);
    if (process.env.RTAG_NL_DEBUG) console.error('[nl] count ms=' + JSON.stringify(countMs.map(m => m.tag)) + ' subjects=' + JSON.stringify(subjects.map(m => m.tag)) + ' -> ' + JSON.stringify(phrase));
    if (phrase) push(phrase + '.', 'count');
    for (const m of countMs) used.push(m.tag);
    for (const m of subjects) used.push(m.tag);
  }
  // 先给每个标签定好最终句子与措辞，一个标签只算一次：
  // ① 层 6 的动作词即使被归到场景层也拨回姿势句；② 场景/画风句只收真场景词，
  // 其余（`silver hair` 这类被词库塞进 og:image-composition 的外观词）退回外观句；
  // ③ 句子内措辞相同的只留一条（「樱花」与「樱花树」推断出同一句时不该并排重复）。
  const renderable = [];
  const planned = new Map();
  for (const role of ['appearance', 'outfit', 'pose', 'scene', 'style']) {
    for (const m of buckets.get(role) || []) {
      let target = role;
      if (role === 'scene' || role === 'style') {
        if (m.layer === 6) target = 'pose';
        else if (APPEARANCE_FORM_RE.test(keyOf(m.tag))) target = 'appearance';   // 层号骗人：silver hair 被挂在 og:image-composition
        else {
          const p0 = phraseOf(m.tag, m);
          target = (p0.source === 'phrase' || SCENE_KEEP_RE.test(p0.text)) ? role : 'appearance';
        }
      }
      const p = phraseOf(m.tag, m);
      if (!p.text) continue;
      const rec = { m, role: target, text: p.text, source: p.source };
      renderable.push(rec);
      planned.set(m.tag, rec);
    }
  }
  const render = (role) => {
    const seenText = new Set();
    const parts = [];
    for (const r of renderable) {
      if (r.role !== role) continue;
      const tk = r.text.toLowerCase();
      if (seenText.has(tk)) continue;
      seenText.add(tk);
      if (r.source === 'fallback') fallback.push(r.m.tag);
      used.push(r.m.tag);
      parts.push(r.text);
    }
    return parts;
  };

  for (const role of ['appearance', 'outfit', 'pose']) {
    const strays = renderable.some(r => r.role === role);
    if (!(buckets.get(role) || []).length && !strays) continue;
    const sk = SENTENCE[role];
    const lead = role === 'outfit' && countMs.some(m => keyOf(m.tag).includes('boy')) ? 'He is wearing ' : sk.lead;
    const parts = render(role);
    if (parts.length) push(lead + parts.join(sk.join) + '.', role);
  }
  for (const role of ['scene', 'style']) {
    const sk = SENTENCE[role];
    const parts = render(role);
    if (parts.length) push(sk.lead + parts.join(sk.join) + '.', role);
  }

  const text = sentences.map(s => s.text).join(' ');
  const tagLine = withTags ? (res.bare || '') : '';

  const meta = {
    roles: sentences.map(s => s.role),
    used: used.map(dispTag),
    fallback: [...new Set(fallback.map(dispTag))],
    unusedLayers: (res.layers || []).filter(l => l.tags.length && !used.some(u => l.tags.some(t => keyOf(t.tag) === keyOf(u)))).map(l => `${l.layer}·${l.name}`),
    layerNames: LAYER_NAME
  };

  // 3) Markdown 视图（人看）
  const md = [];
  md.push('### 英文自然语言提示词');
  if (res.json && res.json.query) md.push('> 输入：' + res.json.query);
  md.push('');
  md.push('```');
  md.push(text);
  md.push('```');
  if (tagLine) {
    md.push('');
    md.push('**标签骨架**（自然语言里逐条对应，可用来核对是否漏项）');
    md.push('```');
    md.push(tagLine);
    md.push('```');
  }
  if (meta.fallback.length) {
    md.push('');
    md.push('**走兜底措辞的标签**（没有专属英文短语，按标签原文展开）：' + meta.fallback.map(t => '`' + t + '`').join('、'));
  }
  if (res.negative) {
    md.push('');
    md.push('**负向串**');
    md.push('```');
    md.push(res.negative);
    md.push('```');
  }

  return {
    text,
    sentences,
    tagLine,
    negative: res.negative || '',
    rating: res.rating || 'safe',
    meta,
    markdown: md.join('\n')
  };
}

/** 句子骨架的静态说明（CLI --template 用，方便调用方自己拼） */
export function nlTemplate() {
  return [
    '# 英文自然语言骨架（每句一行，[] 里是可选）',
    '[count]                 one girl, alone / two girls',
    'The character has       <发色发型>, <瞳色>, <表情>, <身体特征>',
    'She is wearing          <服装>, <配饰>, <鞋袜>',
    'She is                  <姿势>, <动作>',
    'The scene is set        <地点>, <时间>, <光线>',
    'The image is rendered   <画风>, <媒介>, <画质>',
    '',
    '说明：标签与自然语言可混排；角色名/作品名/画师名建议始终用标签放在最前，',
    '关系与方位交给自然语言描述。查不到专属措辞的标签会以标签原文出现在句子里。'
  ].join('\n');
}

/**
 * 措辞表与查表函数对外导出：
 * 缺项检测（gaps.mjs）需要判断「某个标签是否已有专属措辞」，避免重复推荐同一维度。
 */
export { PHRASE };
export { POSE_TAGS, phraseOf, isPose };
export const _internal = { PHRASE, POSE_TAGS, phraseOf, isPose, buildCountSentence };
