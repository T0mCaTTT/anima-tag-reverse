/**
 * taxonomy.mjs —— 层级重构规则表（大分类 / 小分类）
 *
 * 归属优先级（build-hierarchy.mjs 按此顺序判定，先命中先用）：
 *   1. Danbooru 官方 tag_group 页面小节  → 大分类=官方组，小分类=官方小节（已中文化）
 *   2. Danbooru 官方 tag_group 标签清单  → 大分类=官方组，小分类=「其他」
 *   3. WeiLin 二级分类（中文原生）        → 大分类=对应主题组，小分类=WeiLin 二级名
 *   4. ai-tag-toolbox (category, subcategory) → 大分类由 TOOLBOX_CAT 映射，小分类=toolbox 中文子类
 *   5. 本地策展类目                       → LOCAL_CAT 显式映射
 *   6. RULES 关键词规则                   → 兜底
 *   7. 都未命中                           → cb:misc「其他」
 *
 * 命名约定：小分类名尽量沿用 WeiLin（人物/服饰/…）与 Danbooru 官方小节译名，
 * 缺的部分由本表补充，风格统一为 2–6 字中文短语。
 */

/* ---------- 大分类显示名（官方组） ---------- */
export const OFFICIAL_NAME_ZH = {
  accessories: '配饰', 'animals-cats': '猫科', 'animals-dogs': '犬科', attire: '服装',
  'audio-tags': '音频', backgrounds: '背景', birds: '鸟类', 'body-parts': '身体部位',
  censorship: '审查', colors: '色彩', companies: '公司与品牌', creatures: '传说生物',
  dances: '舞蹈', ears: '耳朵', eyes: '眼睛', eyewear: '眼镜', face: '面部',
  'fashion-style': '时尚风格', fire: '火', flowers: '花', 'focus-tags': '焦点与镜头',
  'food-tags': '食物', gestures: '手势与动作', hair: '头发', 'hair-color': '发色',
  'hair-styles': '发型', hands: '手部', handwear: '手部穿着', headwear: '头饰',
  'holding-tags': '手持物', holidays: '节日', 'image-composition': '构图·视角·技法',
  jobs: '职业', legwear: '腿足穿着', lighting: '光影', locations: '场景地点',
  makeup: '妆容', metatags: '元标签', 'neck-and-neckwear': '颈部与颈饰', patterns: '图案',
  phrases: '短语', posture: '姿态', prints: '印花', 'real-world-locations': '现实地点',
  'skin-color': '肤色', sleeves: '袖子', sports: '运动', subjective: '主观评价',
  symbols: '符号', technology: '科技与器械', text: '文字', theme: '主题',
  'verbs-and-gerunds': '动词', 'visual-aesthetic': '视觉美学', water: '水', 'year-tags': '年份标签',
};

/* ---------- 策展大分类（非官方组） ---------- */
export const CURATED_BIGS = [
  { id: 'cb:base', name: '基础与元信息', intro: '质量词、元标签、年份、安全档、人数——官方规定必须放在提示词最前面的部分。' },
  { id: 'cb:character', name: '角色', intro: '角色名标签（含 Danbooru 角色库与 toolbox 角色名），作品名在主串里紧随角色。' },
  { id: 'cb:series', name: '作品与 IP', intro: '作品／版权标签，用于锁定画风与角色来源。' },
  { id: 'cb:artist', name: '画师', intro: '画师标签，必须带 @ 前缀，越靠前影响越强。' },
  { id: 'cb:body', name: '身体与面部', intro: '官方组未覆盖的身形、体态、皮肤细节类标签。' },
  { id: 'cb:items', name: '物品与器物', intro: '生活器物、文具、数码、乐器等实物标签。' },
  { id: 'cb:animals', name: '动物（其他）', intro: '官方猫科／犬科／鸟类组之外的动物标签。' },
  { id: 'cb:effects', name: '特效与滤镜', intro: '元素魔法、粒子光效、文字特效、画面滤镜。' },
  { id: 'cb:nsfw', name: '成人内容', intro: '成人向身体部位、行为与情趣服饰；出图时按需取用。' },
  { id: 'cb:negative', name: '负向与安全', intro: '负向提示词串、审查与遮挡相关标签。' },
  { id: 'cb:scheme', name: '成品方案库', intro: '成套可复制的背景／姿势／服装组合方案。' },
  { id: 'cb:hanfu', name: '汉服（WeiLin 策展）', intro: 'WeiLin 词库的汉服专题：唐风／宋风／明风形制与部件。' },
  { id: 'cb:misc', name: '其他', intro: '尚无明确主题归属的标签，等待后续归类。' },
];
export const CURATED_IDS = new Set(CURATED_BIGS.map(b => b.id));

/* ---------- toolbox 一级分类 → 大分类 ---------- */
export const TOOLBOX_CAT = {
  character: 'cb:character', series: 'cb:series', other: 'cb:misc',
  outfit: 'og:attire', accessory: 'og:accessories', footwear: 'og:legwear',
  hair: 'og:hair', eyes: 'og:eyes', expression: 'og:face', features: 'og:body-parts',
  body: 'og:body-parts', pose: 'og:posture', camera: 'og:image-composition',
  scene: 'og:backgrounds', atmosphere: 'og:lighting', effects: 'cb:effects',
  style: 'og:visual-aesthetic', food: 'og:food-tags', animal: 'cb:animals',
  negative: 'cb:negative', quality: 'cb:base', rating: 'cb:base', nsfw: 'cb:nsfw',
  'time weather': 'og:backgrounds',
};
export const TOOLBOX_LABEL = {
  character: '角色', series: '作品', other: '其他', outfit: '服装', accessory: '配饰',
  footwear: '鞋袜', hair: '头发', eyes: '眼睛', expression: '表情', features: '特征',
  body: '身体', pose: '姿势', camera: '镜头', scene: '场景', atmosphere: '氛围',
  effects: '特效', style: '风格', food: '食物', animal: '动物', negative: '负向',
  quality: '质量', rating: '分级', nsfw: '成人', 'time weather': '时间天气',
};

/* ---------- WeiLin 一级 → 大分类 ---------- */
export const WEILIN_GROUP = {
  人物: 'cb:body', 服饰: 'og:attire', 表情动作: 'og:posture', 画面: 'og:visual-aesthetic',
  环境: 'og:backgrounds', 场景: 'og:backgrounds', 物品: 'cb:items', 镜头: 'og:image-composition',
  汉服: 'cb:hanfu', 魔法系: 'cb:effects',
};
// WeiLin 细分：表情类落在面部组
export const WEILIN_SUB_BIG = {
  笑: 'og:face', 哭: 'og:face', 不开心: 'og:face', 蔑视: 'og:face', 生气: 'og:face', 其他表情: 'og:face',
  基础动作: 'og:posture', 手部动作: 'og:hands', '手部动作(拿着某物)': 'og:holding-tags',
  '手部动作(放在某地)': 'og:posture', '手部动作(抓着某物)': 'og:holding-tags', 腿部动作: 'og:posture', 其他动作: 'og:posture',
  画质: 'cb:base', 光照: 'og:lighting', 背景: 'og:backgrounds', 颜色: 'og:colors',
  艺术风格: 'og:visual-aesthetic', 艺术类型: 'og:visual-aesthetic', 艺术派系: 'og:visual-aesthetic', 艺术家风格: 'og:artist',
  写实: 'og:visual-aesthetic', 素描: 'og:visual-aesthetic', 画笔: 'og:technology',
  季节: 'og:backgrounds', 天气: 'og:backgrounds', 大自然: 'og:backgrounds', 水: 'og:water', 天空: 'og:backgrounds', 云: 'og:backgrounds', 氛围: 'og:lighting',
  室外: 'og:locations', 城市: 'og:locations', 室内: 'og:locations', 地板: 'og:locations', 家具: 'cb:items', 床上用品: 'cb:items', 浴室: 'og:locations',
  学习用品: 'cb:items', 数码设备: 'og:technology', 餐具: 'cb:items', 乐器: 'og:audio-tags', 其它物品: 'cb:items',
  武器: 'og:technology', 食物: 'og:food-tags', 动物: 'cb:animals', 植物: 'og:flowers',
  镜头: 'og:image-composition', 特写镜头: 'og:image-composition', 其他构图: 'og:image-composition', 镜头角度: 'og:image-composition',
  效果: 'cb:effects', 主角动作: 'og:posture',
};

/* ---------- 本地 87 个策展类目 → 大分类 / 小分类 ---------- */
export const LOCAL_CAT = {
  quality: ['cb:base', '质量与画质'], 'meta-dataset': ['cb:base', '元标签与数据集'],
  era: ['cb:base', '时期与年代'], safety: ['cb:base', '安全分级'], count: ['cb:base', '人数与画面规模'],
  character: ['cb:character', '角色 · 精选'], 'character-all': ['cb:character', '角色 · 全量'],
  series: ['cb:series', '作品 · 精选'], 'series-all': ['cb:series', '作品 · 全量'],
  artist: ['cb:artist', '画师 · 精选'], 'artist-ranked': ['cb:artist', '画师 · 投稿量榜'],
  'hair-color': ['og:hair', '发色'], 'hair-style': ['og:hair', '发型'], 'tg-hair': ['og:hair', '头发 · 总览'],
  'tg-hair-color': ['og:hair-color', '发色 · 官方全量'], 'tg-hair-styles': ['og:hair-styles', '发型 · 官方全量'],
  eyes: ['og:eyes', '眼睛 · 精选'], 'tg-eyes': ['og:eyes', '眼睛 · 官方全量'],
  face: ['og:face', '五官 · 精选'], expression: ['og:face', '表情与情绪'], 'tg-face': ['og:face', '面部 · 官方全量'],
  'tg-ears': ['og:ears', '耳朵 · 官方'], 'tg-body-parts': ['og:body-parts', '身体部位 · 官方'],
  'tg-skin': ['og:skin-color', '肤色 · 官方'], 'tg-makeup': ['og:makeup', '妆容 · 官方'],
  attire: ['og:attire', '服装 · 精选'], uniform: ['og:attire', '制服与职业装'], traditional: ['og:attire', '传统与和风服饰'],
  'attire-detail': ['og:attire', '服装 · 细则'], 'clothing-sets': ['cb:scheme', '服装方案库'], 'tg-attire': ['og:attire', '服装 · 官方全量'],
  'tg-legwear': ['og:legwear', '腿足穿着 · 官方'], 'tg-headwear': ['og:headwear', '头饰 · 官方'],
  'tg-handwear': ['og:handwear', '手部穿着 · 官方'], 'tg-sleeves': ['og:sleeves', '袖子 · 官方'],
  'tg-neck': ['og:neck-and-neckwear', '颈部与颈饰 · 官方'], 'tg-eyewear': ['og:eyewear', '眼镜 · 官方'],
  'tg-fashion': ['og:fashion-style', '时尚风格 · 官方'],
  accessory: ['og:accessories', '配饰 · 精选'], 'tg-accessories': ['og:accessories', '配饰 · 官方全量'],
  pose: ['og:posture', '姿势 · 精选'], 'tg-posture': ['og:posture', '姿态 · 官方全量'],
  'tg-gestures': ['og:gestures', '手势与动作 · 官方'], 'tg-hands': ['og:hands', '手部 · 官方'],
  'tg-holding': ['og:holding-tags', '手持物 · 官方'], 'tg-verbs': ['og:verbs-and-gerunds', '动词 · 官方'],
  'tg-dances': ['og:dances', '舞蹈 · 官方'],
  composition: ['og:image-composition', '构图 · 精选'], 'tg-composition': ['og:image-composition', '构图 · 官方全量'],
  'tg-focus': ['og:focus-tags', '焦点与镜头 · 官方'],
  lighting: ['og:lighting', '光影 · 精选'], 'tg-lighting-full': ['og:lighting', '光影 · 官方全量'],
  background: ['og:backgrounds', '背景 · 精选'], 'tg-backgrounds': ['og:backgrounds', '背景 · 官方全量'],
  'tg-locations': ['og:locations', '场景地点 · 官方'], 'tg-locations-real': ['og:real-world-locations', '现实地点 · 官方'],
  'background-sets': ['cb:scheme', '背景方案库'], 'pose-sets': ['cb:scheme', '姿势方案库'],
  'tg-theme': ['og:theme', '主题题材 · 官方'], 'tg-flowers': ['og:flowers', '花 · 官方'],
  color: ['og:colors', '色彩 · 精选'], 'tg-colors-full': ['og:colors', '色彩 · 官方全量'],
  'tg-subjective': ['og:subjective', '主观评价 · 官方'], 'tg-phrases': ['og:phrases', '短语 · 官方'],
  'tg-aesthetic': ['og:visual-aesthetic', '视觉美学 · 官方'], style: ['og:visual-aesthetic', '画风 · 媒介 · 题材'],
  'tg-food': ['og:food-tags', '食物 · 官方全量'], 'tg-technology': ['og:technology', '科技与器械 · 官方'],
  'tg-water': ['og:water', '水 · 官方'], 'tg-fire': ['og:fire', '火 · 官方'],
  'tg-creatures': ['og:creatures', '传说生物 · 官方'], 'tg-cats': ['og:animals-cats', '猫科 · 官方'],
  'tg-dogs': ['og:animals-dogs', '犬科 · 官方'], 'tg-birds': ['og:birds', '鸟类 · 官方'],
  'tg-sports': ['og:sports', '运动 · 官方'], 'tg-jobs': ['og:jobs', '职业 · 官方'],
  'tg-holidays': ['og:holidays', '节日 · 官方'], 'tg-companies': ['og:companies', '公司与品牌 · 官方'],
  'tg-patterns': ['og:patterns', '图案 · 官方'], 'tg-prints': ['og:prints', '印花 · 官方'],
  'tg-symbols': ['og:symbols', '符号 · 官方'], 'tg-text': ['og:text', '文字 · 官方'],
  'tg-metatags': ['og:metatags', '元标签 · 官方'], 'tg-year': ['og:year-tags', '年份标签 · 官方'],
  'tg-audio': ['og:audio-tags', '音频 · 官方'], negative: ['cb:negative', '负向提示词串'],
  'tg-censorship': ['og:censorship', '审查与遮挡 · 官方'],
};

/* ---------- 关键词规则（兜底；顺序即优先级） ---------- */
const R = (big, sub, ...patterns) => patterns.map(p => ({ big, sub, re: new RegExp(p, 'i') }));
export const RULES = [
  /* —— 成人内容（先判，避免污染常规组） —— */
  ...R('cb:nsfw', '性行为体位', '\\b(doggystyle|missionary|girl on top|mating press|upright straddle|suspended congress|spitroast|full nelson|cowgirl position|reverse cowgirl|standing sex|prone bone|butterfly position)\\b'),
  ...R('cb:nsfw', '性行为', '\\b(sex|intercourse|penetration|fellatio|cunnilingus|anal|vaginal|paizuri|handjob|fingering|masturbation|orgasm|ejaculation|creampie|bukakke|bukkake|nude|naked|topless|bottomless|nipples?|areola|clitoris|penis|testicles|pussy|vagina|anus|rectum|onahole|dildo|vibrator|condom|semen|precum|prostate|scrotum|prepuce|foreskin|erection|pubic hair|pubic|groin|crotch|lingerie|panties|bra|underwear|bikini|thong|g-string|leotard|bodysuit|swimsuit|micro bikini|pasties|see-through|wet clothes)\\b'),
  ...R('cb:nsfw', '情趣与成人服饰', '\\b(bondage|shibari|restrained|handcuffs|collar and leash|leash|cuffs|ball gag|gag|blindfold|nipple clamp|chastity|latex|leather (?:suit|dress|pants)|fishnet|stockings?|garter|suspender belt|corset|bustier|teddy lingerie|babydoll)\\b'),
  ...R('cb:nsfw', '身体隐私部位', '\\b(navel|midriff|cleavage|underboob|sideboob|downblouse|upskirt|pantyhose|cameltoe|wedge|plunge|areolae|nipple (?:slip|piercing)|belly|thigh gap)\\b'),
  ...R('cb:nsfw', '成人行为细节', '\\b(drooling|saliva|sweat|steam from body|heavy breathing|ahegao|torogao|fucked silly|after (?:sex|orgasm)|used condom|nsfw|explicit)\\b'),

  /* —— 负向 —— */
  ...R('cb:negative', '质量负向', '\\b(worst quality|low quality|lowres|blurry|jpeg artifacts|bad anatomy|bad hands|extra (?:fingers|limbs)|missing (?:fingers|limbs)|mutated|deformed|disfigured|poorly drawn|watermark|signature|artist name|chromatic aberration|ugly|duplicate|long neck|extra ears)\\b'),
  ...R('cb:negative', '负向串', '\\b(negative prompt|easynegative|badhandv4|verybadimagenegative|negative embedding)\\b'),

  /* —— 基础与元信息 —— */
  ...R('cb:base', '质量与画质', '^(masterpiece|best quality|high quality|amazing quality|very aesthetic|aesthetic|good quality|normal quality|worst quality|low quality|highres|absurdres|ultra-detailed|detailed|8k|4k|uhd|wallpaper|cg|official art|anime screenshot|game cg|scan|magazine scan|digital painting|render|photo|realistic|photorealistic|semi-realistic|hyperrealistic|cel shading|flat color|sketch|lineart|monochrome|greyscale|greyscale with colored background|limited palette|watercolor \\(medium\\)|oil painting \\(medium\\)|pastel \\(medium\\)|colored pencil \\(medium\\)|marker \\(medium\\)|acrylic paint \\(medium\\)|ink \\(medium\\)|charcoal \\(medium\\))\\b'),
  ...R('cb:base', '元标签与数据集', '\\b(ye-pop|deviantart|danbooru|gelbooru|pixiv|e-shuushuu|yande\\.re|konachan|anime screenshot|official art|twitter|booru|source request|artist request|bad id|bad source|commentary|commentary request|translation request|web address|logo|watermark|signature|dated|censored|uncensored|absurdres|incredibly absurdres|highres|lowres|novelty|third-party edit|ai-generated|ai-assisted)\\b'),
  ...R('cb:base', '时期与年代', '\\b(year \\d{4}|\\d{4}s|\\d{4}s fashion|newest|recent|mid \\(year\\)|early \\(year\\)|old \\(year\\)|19\\d{2}|20\\d{2}|1900s|1910s|1920s|1930s|1940s|1950s|1960s|1970s|1980s|1990s|2000s|2010s|2020s|retro|vintage|showa|heisei|taisho|meiji|edo|sengoku)\\b'),
  ...R('cb:base', '安全分级', '^(safe|sensitive|questionable|nsfw|explicit|general|mature|rating:\\w+|rating:general|rating:sensitive|rating:questionable|rating:explicit)\\b'),
  ...R('cb:base', '人数与画面规模', '^(solo|1girl|2girls|3girls|4girls|5girls|6\\+girls|multiple girls|1boy|2boys|3boys|multiple boys|male focus|no humans|solo focus|\\d\\+?(g|b|o)?(irls|oys|others)|everyone|crowd|group|team|solo leveling)\\b'),

  /* —— 头发 —— */
  ...R('og:hair', '长度与发量', '\\b(very long hair|absurdly long hair|long hair|medium hair|short hair|very short hair|big hair|huge hair|hair intakes|hair spread out|floating hair|wavy hair|straight hair|curly hair|messy hair|fluffy hair|slicked-back hair|braided hair)\\b'),
  ...R('og:hair', '辫发', '\\b(braid|braids|twin braids|single braid|french braid|dutch braid|side braid|front braid|hair bun|double bun|single hair bun|cone hair bun|braided bun|odango|bun cover)\\b'),
  ...R('og:hair', '马尾', '\\b(ponytail|twintails?|twin tails|side ponytail|short ponytail|folded ponytail|low-tied long hair|hair ribbon|scrunchie)\\b'),
  ...R('og:hair', '刘海', '\\b(bangs|blunt bangs|swept bangs|hair over one eye|hair between eyes|parted bangs|asymmetrical bangs|crossed bangs|diagonal bangs|antenna hair|ahoge|hair flaps|sidelocks|hair intakes|widow\'s peak)\\b'),
  ...R('og:hair', '发色', '\\b([a-z]+ hair|hair color|gradient hair|two-tone hair|multicolored hair|streaked hair|colored inner hair|rainbow hair|split-color hair|hair highlights|grey streaks)\\b'),
  ...R('og:hair', '发型', '\\b(hair|bob cut|hime cut|bowl cut|pixie cut|undercut|mohawk|afro|mullet|hair down|hair up|updo|hair bun|hair loops|hair rings|drill hair|hair tubes|hair over shoulder|hair behind ear|hair pulled back|hairjob)\\b'),

  /* —— 面部 / 表情 —— */
  ...R('og:face', '表情', '\\b(smile|grin|smirk|frown|scowl|pout|open mouth|closed mouth|teeth|fang|fangs|tongue|tongue out|licking|lips|blush|blush stickers|tears|tearing up|crying|sweatdrop|sweat|angry|annoyed|surprised|shocked|embarrassed|shy|scared|fear|sad|depressed|happy|joy|excited|bored|sleepy|serious|expressionless|neutral face|half-closed eyes|closed eyes|wink|one eye closed|rolling eyes|sparkling eyes|empty eyes|heart-shaped pupils|symbol-shaped pupils|tareme|tsurime|shaded face|glowing eyes)\\b'),
  ...R('og:face', '面部特征', '\\b(freckles|mole under (?:eye|mouth)|beauty mark|facial|nose|nostrils|cheek|cheeks|forehead|jawline|eyelashes|thick eyebrows|eyebrows|makeup|lipstick|eyeshadow|eyeliner|blush|ao dai)\\b'),
  ...R('og:eyes', '瞳孔', '\\b(pupils?|iris|irises|heterochromia|heart-shaped pupils|star-shaped pupils|slit pupils|constricted pupils|dilated pupils|glowing eyes|empty eyes|ringed eyes|spiral eyes|solid eyes|cross-eyed|wall-eyed)\\b'),
  ...R('og:eyes', '眼部状态', '\\b(half-closed eyes|closed eyes|one eye closed|winking|rolling eyes|blank eyes|shadowed eyes|teary eyes|wide-eyed|narrowed eyes|eye contact|looking (?:at|away|back|down|up|to the side)|staring|glaring)\\b'),
  ...R('og:eyes', '瞳色', '\\b((?:red|blue|green|yellow|purple|pink|orange|brown|black|white|grey|gray|aqua|amber|gold|silver|heterochromia) eyes?|colored eyelashes)\\b'),

  /* —— 身体 —— */
  ...R('og:body-parts', '身体部位', '\\b(breasts?|cleavage|collarbone|shoulders?|armpits?|arm|arms|hands?|fingers?|nails|thumbs?|palms?|elbow|elbows|wrist|wrists|legs?|thighs?|knees?|calves?|feet|foot|toes|ankle|ankles|waist|hips?|stomach|belly|torso|back|spine|necks?|chest|pecs|abdomen|abs|muscular|muscles|veins|skeleton|bones|skin|pores|tan lines|sunburn|scars?|bandaid|bandage|bruise|birthmark|stretch marks|body hair|chest hair|armpit hair|freckles on body|navel|belly button|tail|tails|wings|halo|horns?|antennae|non-human (?:legs|arms)|extra (?:arms|legs|ears|eyes)|(?:pointy|long) ears|elf|orc|demon horns|cat ears|dog ears|rabbit ears|animal ears|fox ears|wolf ears|kemonomimi)\\b'),
  ...R('og:body-parts', '身形与体型', '\\b(petite|tall|short stature|chubby|plump|thick (?:thighs|legs)|wide hips|narrow waist|muscular female|muscular male|bara|slim|slender|curvy|voluptuous|flat chest|small breasts|medium breasts|large breasts|huge breasts|gigantic breasts|absurdly large breasts|oppai|chibi|super deformed|tall female|short female|height difference|size difference|giant|mini person|minigirl|macro)\\b'),
  ...R('cb:body', '皮肤细节', '\\b(skin|pale skin|dark skin|tan|tanned|dark-skinned female|dark-skinned male|albino|skin fang|skin tight|glowing skin|shiny skin|oiled skin|wet skin|body writing|body markings|tattoo|tattoos|piercing|piercings|scarification)\\b'),

  /* —— 手部 —— */
  ...R('og:hands', '手部动作', '\\b(hands? (?:up|on|in|behind|under|together|clasped|clenched|in pockets|on hips|on head|on own (?:chest|thigh|face|head|hair)|behind (?:back|head)|in own hair|on another|between|out)|interlocked fingers|clenched (?:fist|hand)|fingers? (?:spread|curled|crossed)|holding hands|hand on own hip|hand up|raised hand|v sign|thumbs up|ok sign|peace sign|finger (?:gun|heart|pointing)|index finger|middle finger|pinky out|counting)\\b'),
  ...R('og:handwear', '手套', '\\b(gloves?|fingerless gloves|elbow gloves|under-elbow gloves|opera gloves|latex gloves|leather gloves|mittens|hand wraps|gauntlets?|arm warmers|wristband|wrist cuffs)\\b'),

  /* —— 服装 —— */
  ...R('og:attire', '上衣', '\\b(shirt|blouse|t-shirt|sweater|hoodie|jacket|coat|cardigan|vest|tank top|tube top|crop top|camisole|sweatshirt|turtleneck|polo shirt|jersey|kimono top|haori|happi|yukata|blazer|suit jacket|overalls|apron|poncho|cloak|cape|shawl|poncho|tunic|leotard|tracksuit|windbreaker|uniform (?:top|jacket)|sailor (?:shirt|blouse)|serafuku|gakuran|sailor dress|sundress|pinafore|suspender skirt)\\b'),
  ...R('og:attire', '下装', '\\b(skirt|pleated skirt|miniskirt|microskirt|long skirt|pencil skirt|tiered skirt|denim skirt|shorts|short shorts|jeans|pants|trousers|capri pants|hakama|bloomers|buruma|petticoat|slacks|cargo pants|sweatpants|leggings|jodhpurs|breeches|culottes|sarong|sarong skirt|side slit|slit skirt)\\b'),
  ...R('og:attire', '连衣裙', '\\b(dress|sundress|evening gown|gown|wedding dress|ball gown|qipao|cheongsam|sari|dirndl|sailor dress|pinafore dress|jumper skirt|chinese dress|hanfu|kimono|furisode|houmongi|miko outfit|jinbei|hanbok|ao dai|qizhuang)\\b'),
  ...R('og:attire', '内衣泳装', '\\b(swimsuit|bikini|one-piece swimsuit|school swimsuit|competition swimsuit|rash guard|lingerie|bra|panties|underwear|boxer briefs|briefs|pantyhose|fishnet|garter belt|garters|stockings|thighhighs|kneehighs|socks|tabi|loose socks|leg warmers|sports bra|bustier|corset|babydoll|teddy|chemise|negligee|nightgown|pajamas|sleepwear)\\b'),
  ...R('og:attire', '制服与职业装', '\\b(uniform|serafuku|school uniform|sailor uniform|nurse uniform|police uniform|military uniform|maid outfit|maid uniform|waitress|cheerleading uniform|gym uniform|track uniform|baseball uniform|basketball uniform|soccer uniform|judge uniform|flight attendant|chef uniform|barista|labcoat|lab coat|hazmat suit|business suit|tuxedo|office lady|teacher|firefighter|soldier|knight armor|plate armor|battle armor|power armor|armor)\\b'),
  ...R('og:attire', '传统服饰', '\\b(kimono|yukata|furisode|hakama|jinbei|happi|haori|hakama skirt|miko|ofuda|obi|kimono sleeve|chinese dress|qipao|cheongsam|hanfu|ruqun|hanbok|ao dai|sari|dirndl|lederhosen|tracht|kilt|poncho|sombrero|hijab|abaya|thawb|sherwani|dashiki|kanga|huipil|barong)\\b'),
  ...R('og:attire', '服装细节', '\\b(off-shoulder|one-shoulder|bare shoulders|shoulder cutout|backless|plunging neckline|sleeveless|detached sleeves|wide sleeves|long sleeves|short sleeves|puffy sleeves|bell sleeves|flared sleeves|frilled sleeves|rolled up sleeves|buttoned cuffs|frills|frilled|ruffles|lace|ribbon|bow|bowtie|necktie|ascot|sash|belt|waist belt|buckle|zipper|buttons|pockets|pleats|pleated|hem|trim|embroidery|applique|sequins|studs|spikes|chains|straps|suspenders|garter straps|torn clothes|clothes lift|clothes pull|undressed|partially undressed|dress shirt|collared shirt|open clothes|unbuttoned|wet clothes|see-through|transparent|translucent)\\b'),

  /* —— 头饰 / 配饰 —— */
  ...R('og:headwear', '头饰', '\\b(hat|hats|cap|baseball cap|beret|beanie|bowler hat|top hat|fedora|sun hat|straw hat|witch hat|santa hat|cone hat|party hat|nurse cap|maid headdress|headdress|headband|hairband|hair bow|hair ribbon|hair ornament|hairclip|hair clip|hairpin|hair bobbles|scrunchie|kanzashi|tiara|crown|laurel crown|circlet|halo|veil|hood|helmet|cowboy hat|sombrero|ushanka|hijab|turban|headphones?|ears through headwear|animal hood)\\b'),
  ...R('og:accessories', '首饰', '\\b(earrings?|necklace|pendant|choker|bracelet|bangle|anklet|ring|rings|brooch|amulet|talisman|cross necklace|rosary|cufflinks|tiara|hairpin|jewelry|crown|circlet|diadem|medallion|locket|signet)\\b'),
  ...R('og:accessories', '随身配饰', '\\b(bag|backpack|handbag|purse|satchel|duffel bag|school bag|shoulder bag|messenger bag|pouch|wallet|scarf|shawl|gloves|belt bag|lanyard|badge|pin badge|armband|wristband|hair tie|ribbon|bandana|watch|wristwatch|pocket watch|sunglasses|goggles|monocle|eyepatch|mask|face mask|medical mask|masquerade mask|umbrella|parasol|fan|hand fan|wand|staff|scepter|scepter)\\b'),
  ...R('og:eyewear', '眼镜', '\\b(glasses|eyewear|spectacles|round eyewear|semi-rimless eyewear|under-rim eyewear|over-rim eyewear|rimless eyewear|heart-shaped eyewear|goggles|sunglasses|monocle|pince-nez|scouter|visored helmet|flip-up glasses|glasses on head|removing glasses|adjusting glasses|pushing up glasses|glasses reflection)\\b'),
  ...R('og:legwear', '鞋袜', '\\b(shoes|boots|sneakers|sandals|high heels|heels|pumps|loafers|mary janes|ballet shoes|geta|zori|okobo|waraji|tabi|shoes removed|shoe soles|platform shoes|thigh boots|ankle boots|knee boots|combat boots|hiking boots|rain boots|rubber boots|cleats|slippers|uwabaki|socks|thighhighs|kneehighs|pantyhose|fishnet pantyhose|toeless legwear|white legwear|striped legwear|barefoot|footwear)\\b'),

  /* —— 手持 / 动词 —— */
  ...R('og:holding-tags', '手持物', '\\b(holding [a-z]|holding [a-z]+ ?(?:by|with)|holding (?:sword|gun|book|flower|umbrella|bag|cup|phone|food|weapon|staff|plush|doll|balloon|sign|signage|letter|teddy|teddy bear|microphone|bottle|glass|knife|katana|bow|spear|shield|wand|racket|bat|instrument|cat|animal|bird|fish|pencil|pen|brush|paper|card|fan|ribbon|rope|chain|handcuffs|gun|rifle|pistol|grenade|camera|telescope|binoculars|flashlight|lamp|candle|torch|hatchet|pickaxe|hoe|shovel|broom|rake|watering can|teacup|teapot|pan|pot|plate|bowl|chopsticks|spoon|fork|hamburger|pizza|ice cream|donut|apple|banana|orange|watermelon|pocky|dango|onigiri|bento|rice|noodle|ramen|cake|cupcake|candy|lollipop|chocolate|cookie|bread|cheese|egg|milk|tea|coffee|juice|soda|wine|beer|bubble tea))\\b'),
  ...R('og:verbs-and-gerunds', '动作动词', '\\b(sitting|standing|kneeling|lying|crouching|squatting|leaning|leaning forward|leaning back|bending|stretching|reaching|walking|running|jumping|dancing|flying|floating|falling|sleeping|sleeping on|waking up|yawning|eating|drinking|smoking|cooking|reading|writing|drawing|painting|playing|singing|shouting|whispering|laughing|crying|hugging|kissing|carrying|holding|grabbing|touching|pointing|poking|pinching|pulling|pushing|lifting|throwing|catching|hitting|kicking|punching|fighting|riding|driving|swimming|diving|bathing|showering|washing|cleaning|dressing|undressing|typing|using (?:phone|computer|laptop)|listening to music|taking (?:photo|picture)|watching tv|staring|looking|gazing|closing eyes|opening mouth|clenched teeth|biting (?:lip|finger)|licking (?:lips|finger|hand)|smelling|sniffing|breathing|cross-legged|indian style|legs crossed|arms crossed|arm up|arms up|hand on hip|hands on hips|hand on own (?:cheek|chin|thigh|knee|chest|face|head|hair|hip)|hand in own (?:hair|pocket)|adjusting hair|tucking hair|playing with hair|hair flip|hair behind ear)\\b'),

  /* —— 姿态 —— */
  ...R('og:posture', '站坐卧', '\\b(standing|sitting|seiza|wariza|kneeling|on (?:one )?knee|crouching|squatting|lying|on back|on stomach|on side|on front|fetal position|all fours|on all fours|sitting on (?:chair|floor|bed|ground|lap)|legs (?:up|apart|crossed|spread|tucked|folded)|cross-legged|butterfly sitting|princess carry|piggyback|sitting backwards|straddling|m-leg|w-leg|knees up|knees together|arms behind (?:back|head)|arms up|arm up|handstand|crab walk|upside-down|headstand|split|splits|ballet (?:pose|position)|contrapposto)\\b'),
  ...R('og:posture', '姿势关系', '\\b(hug|hugging|embrace|lap sitting|carrying|piggyback|princess carry|bridal carry|holding hands|arm around (?:waist|shoulder|neck)|head (?:on|resting on) (?:shoulder|lap|chest|breast)|leaning on (?:person|another)|on shoulder|on lap|on back \\(human\\)|facing (?:viewer|another)|back-to-back|looking at (?:another|each other|viewer)|kiss|kissing|touching face|lifting person|carried)\\b'),
  ...R('og:gestures', '手势', '\\b(v sign|peace sign|thumbs up|ok sign|finger (?:gun|heart|snap)|pointing at (?:viewer|self|another)|waving|salute|clenched (?:hand|fist)|open hand|palm (?:out|up)|hand up|raised hand|index finger|middle finger|pinky (?:promise|out)|counting|shaka|namaste|praying|arms up|stretching arms|cracking (?:knuckles|fingers))\\b'),

  /* —— 构图 / 镜头 —— */
  ...R('og:image-composition', '构图', '\\b(composition|centered|symmetry|symmetrical|asymmetry|dutch angle|rule of thirds|golden ratio|negative space|framing|framed|border|ocean sunfish|facing away|from (?:above|below|behind|side|front)|wide shot|close-up|cowboy shot|full body|upper body|lower body|portrait|landscape \\(orientation\\)|bust shot|headshot|zoomed in|zoomed out|panorama|panoramic|split screen|collage|multiple views|character sheet|reference sheet|expression sheet|turnaround)\\b'),
  ...R('og:image-composition', '视角与镜头', '\\b(view from (?:above|below|behind|side|front)|from above|from below|from behind|from side|from front|bird\'s-eye view|worm\'s-eye view|third-person view|first-person view|pov|point of view|looking down|looking up|looking back|eye contact|facing viewer|facing camera|looking at viewer|looking to the side|staring at viewer|dynamic angle|foreshortening|perspective|depth of field|blurry background|shallow depth|wide-angle|fisheye|telephoto|macro lens|bokeh|motion blur|panning)\\b'),
  ...R('og:focus-tags', '对焦', '\\b(blurry|blurred|depth of field|out of focus|motion blur|bokeh|soft focus|shallow focus|defocus|focus|blurry background|blurry foreground|blurry foregroun)\\b'),

  /* —— 光影 / 色彩 —— */
  ...R('og:lighting', '光照', '\\b(lighting|backlighting|backlit|frontlighting|sidelighting|rim light|rim lighting|edge lighting|volumetric lighting|god rays|crepuscular rays|sunbeam|moonbeam|spotlight|dappled sunlight|sunlight|moonlight|starlight|firelight|candlelight|lantern light|neon lights|glowing|glow|glowing light|light rays|light beams|light particles|light shafts|reflected light|bioluminescence|phosphorescence|hard shadow|soft shadow|drop shadow|cast shadow|shadow|long shadow|chiaroscuro|silhouette|high contrast|low contrast|overlighting|underlighting|ambient occlusion|subsurface scattering|bloom \\(effect\\)|lens flare|light through (?:leaves|gaps|curtains|window)|shoji screen|candle|torchlight)\\b'),
  ...R('og:lighting', '灯光器材', '\\b(lantern|streetlight|street lamp|neon sign|chandelier|lamp|lamp post|paper lantern|jack-o\'-lantern|candleholder|candelabra|spotlight \\(object\\)|floodlight|lighthouse|glowstick)\\b'),
  ...R('og:colors', '色调', '\\b(palette|color scheme|monochromatic|warm colors|cool colors|pastel colors|vibrant colors|muted colors|desaturated|sepia|greyscale|monochrome|limited palette|color \\(medium\\)|colorful|rainbow|iridescent|holographic|chromatic|complementary colors|silhouette|themed (?:palette|color)|color contrast|high saturation|low saturation|duotone|tritone)\\b'),

  /* —— 背景 / 场景 —— */
  ...R('og:backgrounds', '背景类型', '\\b(background|simple background|white background|black background|grey background|gradient background|transparent background|two-tone background|checkered background|striped background|patterned background|floral background|star background|night sky|day sky|blue sky|cloudy sky|sky|clouds|starry sky|milky way|colorful sky|orange sky|red sky|sunset|sunrise|dawn|dusk|twilight|night|day|midday|noon|evening|morning|afternoon|moon|full moon|crescent moon|sun|stars|galaxy|nebula|aurora|rainbow|horizon|silhouette background|cityscape|landscape|scenery|vista|panorama)\\b'),
  ...R('og:locations', '场景地点', '\\b(bedroom|kitchen|bathroom|living room|classroom|school|hallway|library|office|hospital|church|shrine|temple|castle|palace|ruins|forest|jungle|desert|beach|ocean|sea|underwater|river|lake|pond|waterfall|mountain|hill|valley|cave|cliff|island|field|meadow|grass|garden|park|street|road|city|town|village|rooftop|balcony|window|door|stairs|staircase|bridge|train station|airport|market|shop|store|cafe|restaurant|bar|onsen|hot spring|bath|pool|swimming pool|stadium|arena|gym|dojo|space|spaceship|space station|sky|skyline|interior|exterior|indoors|outdoors|on bed|in bed|on couch|on chair|at desk|on floor|on grass|in water|in forest|in city|railroad|train|subway|bus|car interior|inside car|on rooftop|on balcony)\\b'),
  ...R('og:backgrounds', '天气与时间', '\\b(rain|raining|rainy|drizzle|storm|thunder|lightning|snow|snowing|snowy|snowflakes|blizzard|fog|mist|haze|wind|windy|cloudy|overcast|sunny|clear sky|heat haze|sandstorm|typhoon|hurricane|tornado|wicked weather|weather|season|spring|summer|autumn|fall \\(season\\)|winter|cherry blossoms|sakura|autumn leaves|falling leaves|petals|snow on ground|rainbow after rain)\\b'),
  ...R('og:water', '水体与水态', '\\b(water|wet|drenched|soaked|underwater|ripples|water drop|water droplets|waterfall|splashing|waves|reflection in water|puddle|rain puddle|steam|vapor|mist on water)\\b'),
  ...R('og:fire', '火焰与烟雾', '\\b(fire|flame|flames|burning|smoke|embers|sparks|bonfire|campfire|fireplace|torch|explosion|blaze|inferno|ash|coal|ember|cigarette smoke)\\b'),
  ...R('og:flowers', '花卉与植物', '\\b(flower|flowers|floral|bloom(?:ing)?|blossom|petal|petals|rose|roses|sunflower|tulip|lily|lilies|orchid|daisy|dandelion|carnation|hydrangea|lavender|hibiscus|magnolia|peony|plum blossom|cherry blossom|sakura|chrysanthemum|violet|iris \\(flower\\)|poppy|camellia|gardenia|wisteria|baby\'s breath|bouquet|flower bouquet|potted plant|plant|plants|leaf|leaves|vine|ivy|moss|tree|trees|branch|branches|bamboo|grass|bush|fern|cactus|succulent|seedling|sprout|herb)\\b'),

  /* —— 动物 —— */
  ...R('og:animals-cats', '猫咪', '\\b(cat|cats|kitten|kittens|cat ears|cat tail|neko|tabby|calico|siamese cat|persian cat|black cat|white cat|orange cat|cat girl|catboy|cat hat|cat plush|cat on (?:head|lap|shoulder|bed)|neko \\(cat\\)|meow|nya)\\b'),
  ...R('og:animals-dogs', '狗狗', '\\b(dog|dogs|puppy|puppies|shiba|akita|husky|poodle|dachshund|corgi|retriever|husky|samoyed|dog girl|dog boy|dog ears|dog tail|dog on (?:head|lap)|woof)|\\b(?:wolf|fox|jackal|coyote)\\b'),
  ...R('og:birds', '鸟类', '\\b(bird|birds|duck|goose|swan|chicken|rooster|hen|turkey|owl|eagle|hawk|falcon|sparrow|robin|crow|raven|pigeon|dove|parrot|cockatoo|macaw|budgie|canary|finch|seagull|gull|pelican|flamingo|peacock|penguin|ostrich|hummingbird|woodpecker|kingfisher|crane \\(bird\\)|heron|stork|swallow|nightingale|magpie|jay \\(bird\\)|quail|pheasant|kiwi \\(bird\\)|puffin|albatross|bird on (?:head|shoulder|hand)|feather|feathers|wings|feathered wings)\\b'),
  ...R('cb:animals', '动物（其他）', '\\b(rabbit|bunny|hare|mouse|mice|rat|hamster|guinea pig|squirrel|chipmunk|beaver|otter|badger|weasel|ferret|marten|hedgehog|shrew|mole \\(animal\\)|horse|pony|unicorn|pegasus|donkey|mule|zebra|cow|cattle|bull|ox|buffalo|bison|goat|sheep|lamb|ram|deer|moose|elk|antelope|gazelle|giraffe|camel|llama|alpaca|elephant|rhinoceros|hippopotamus|pig|boar|hog|monkey|ape|gorilla|chimpanzee|orangutan|lemur|sloth|koala|kangaroo|wallaby|wombat|panda|bear|polar bear|grizzly|tiger|lion|leopard|cheetah|panther|lynx|bobcat|hyena|raccoon|skunk|possum|opossum|lizard|gecko|iguana|chameleon|snake|cobra|python|viper|turtle|tortoise|crocodile|alligator|frog|toad|salamander|newt|axolotl|fish|goldfish|koi|shark|whale|dolphin|orca|seal|sea lion|walrus|octopus|squid|jellyfish|crab|lobster|shrimp|prawn|starfish|sea urchin|shell|seashell|coral|anemone|insect|bug|beetle|butterfly|moth|bee|wasp|hornet|ant|termite|fly|mosquito|dragonfly|damselfly|mantis|grasshopper|cricket|locust|cockroach|spider|tarantula|scorpion|centipede|millipede|snail|slug|worm|leech|dragon|dinosaur|t-rex|raptor|pterosaur|griffon|phoenix|kitsune|tanuki|kirin|qilin|yeti|bigfoot|slime \\(creature\\)|goblin|orc|elf|dwarf|mermaid|merman|centaur|harpy|lamia|arachne|minotaur|chimera|hydra|cerberus|fairy|pixie|sprite|angel|demon|devil|succubus|incubus|valkyrie|naga|undead|zombie|ghost|spirit|skeleton \\(undead\\)|vampire|werewolf|lich|golem|construct|homunculus|familiar|pet|stuffed animal|plushie|plush toy|animal on (?:head|shoulder|lap|hand))\\b'),
  ...R('og:creatures', '传说生物', '\\b(dragon|wyvern|drake|griffon|gryphon|phoenix|unicorn|pegasus|kitsune|nine-tailed fox|tanuki|kirin|qilin|yeti|bigfoot|sasquatch|kraken|leviathan|behemoth|ziz|roc|chimera|hydra|cerberus|fenrir|jormungandr|sleipnir|mermaid|merman|siren|centaur|harpy|lamia|naga|arachne|minotaur|cyclops|titan|giant \\(mythology\\)|ogre|troll|goblin|orc|imp|demon|devil|succubus|incubus|angel|valkyrie|fairy|pixie|sprite|dryad|nymph|undine|sylph|gnome|dwarf|elf|undead|zombie|ghost|wraith|spirit|phantom|vampire|werewolf|lycanthrope|lich|necromancer|golem|homunculus|familiar|summon|slime|elemental|djinn|genie|yokai|oni|tengu|kappa|kitsune|shikigami|shisa|manticore|basilisk|cockatrice|wyrm|serpent|amphiptere|tatzelwurm|bunyip|chupacabra|mothman|wendigo|skinwalker)\\b'),

  /* —— 食物 —— */
  ...R('og:food-tags', '主食与餐点', '\\b(rice|noodle|noodles|ramen|udon|soba|pasta|spaghetti|lasagna|macaroni|bread|toast|baguette|croissant|bagel|pretzel|bun|buns|burger|hamburger|cheeseburger|sandwich|hot dog|pizza|taco|burrito|dumpling|dumplings|gyoza|wonton|baozi|bento|onigiri|sushi|sashimi|nigiri|maki|temaki|tamagoyaki|okonomiyaki|takoyaki|yakisoba|curry|stew|soup|miso soup|porridge|congee|omelette|fried egg|scrambled eggs|pancake|waffle|crepe|pie|quiche|casserole|steak|roast|barbecue|fried chicken|kebab|skewer|yakitori|meal|dish|platter|breakfast|lunch|dinner|feast|picnic|bento box)\\b'),
  ...R('og:food-tags', '甜点与零食', '\\b(cake|cupcake|shortcake|cheesecake|pancake|muffin|donut|doughnut|cookie|cookies|biscuit|brownie|macaron|macaroon|eclair|tart|pudding|custard|jelly|jello|ice cream|gelato|sundae|sorbet|popsicle|chocolate|white chocolate|dark chocolate|truffle|candy|candies|lollipop|candy apple|marshmallow|nougat|fudge|caramel|toffee|honey|jam|jelly \\(preserve\\)|syrup|whipped cream|sprinkles|confetti|pocky|dango|daifuku|mochi|manju|taiyaki|dorayaki|castella|senbei|rice cracker|chip|crisps|popcorn|pretzel|trail mix|granola|energy bar|snack|snacks|dessert|sweets|pastry|croissant|danish pastry|strudel|pie \\(food\\)|pancake stack)\\b'),
  ...R('og:food-tags', '水果与蔬菜', '\\b(apple|apples|banana|bananas|orange|oranges|tangerine|mandarin|lemon|lime|grapefruit|grape|grapes|strawberry|strawberries|blueberry|blueberries|raspberry|raspberries|blackberry|cherry|cherries|peach|peaches|pear|pears|plum|plums|apricot|nectarine|mango|papaya|pineapple|kiwi|watermelon|melon|cantaloupe|coconut|pomegranate|fig|dates|dragon fruit|passion fruit|lychee|longan|rambutan|durian|avocado|tomato|tomatoes|cucumber|lettuce|cabbage|spinach|kale|broccoli|cauliflower|carrot|carrots|potato|potatoes|sweet potato|onion|garlic|ginger|radish|daikon|turnip|beet|beetroot|pumpkin|squash|zucchini|corn|maize|peas|beans|soybean|edamame|lentil|chickpea|mushroom|mushrooms|eggplant|bell pepper|chili pepper|capsicum|okra|asparagus|celery|artichoke|leek|scallion|shallot|seaweed|nori|kelp|vegetable|vegetables|fruit|fruits|produce|herb|herbs|spice|spices|seasoning|salt|pepper|sugar|flour|dough|batter)\\b'),
  ...R('og:food-tags', '饮品', '\\b(tea|green tea|black tea|milk tea|bubble tea|boba|matcha|coffee|espresso|latte|cappuccino|mocha|americano|hot chocolate|cocoa|juice|orange juice|apple juice|smoothie|milkshake|soda|cola|coke|soft drink|energy drink|beer|sake|wine|champagne|whiskey|whisky|vodka|rum|tequila|gin|brandy|cocktail|martini|mojito|margarita|sangria|bubble tea|boba tea|drink|drinks|beverage|bottle|can \\(container\\)|glass \\(container\\)|mug|cup|teacup|teapot|kettle|thermos|straw|drinking straw)\\b'),
  ...R('og:food-tags', '餐具与厨房', '\\b(chopsticks|spoon|fork|knife|plate|dish|bowl|cup|mug|glass|teapot|kettle|pan|frying pan|pot|cooking pot|wok|ladle|whisk|spatula|rolling pin|cutting board|strainer|colander|grater|peeler|opener|bottle opener|can opener|thermometer|oven|microwave|toaster|rice cooker|blender|mixer|refrigerator|fridge|freezer|stove|burner|grill|barbecue grill|apron|oven mitt|potholder|tableware|cutlery|silverware|utensil|utensils|napkin|tablecloth|tray|bento box|lunchbox|thermos|food container|lunch box)\\b'),

  /* —— 科技 / 器材 —— */
  ...R('og:technology', '数码设备', '\\b(computer|pc|laptop|desktop|monitor|screen|keyboard|mouse \\(computer\\)|mousepad|tablet|smartphone|cellphone|phone|mobile phone|flip phone|feature phone|pager|pda|camera|dslr|mirrorless|tripod|gopro|webcam|microphone|headset|earphones|earbuds|headphones|speaker|amplifier|turntable|record player|radio|walkie-talkie|television|tv|remote control|game console|handheld game console|controller|game controller|joystick|arcade cabinet|pachinko|slot machine|vending machine|atm|cash register|printer|scanner|projector|drone|robot|android|cyborg|mecha|power armor|exoskeleton|jetpack|hoverboard|segway|electric scooter|charging cable|usb cable|power bank|battery|charger|adapter|router|modem|server|hard drive|floppy disk|cd|dvd|blu-ray|vhs|tape|usb flash drive|memory card|sim card|credit card|smart card|qr code|barcode|hologram|holographic display|vr headset|ar glasses|smartwatch|fitness tracker|calculator|typewriter|fax machine|photocopier|sewing machine|3d printer|laser cutter|cnc machine|oscilloscope|multimeter|microscope|telescope|binoculars|magnifying glass|compass|gps|radar|sonar|antenna|satellite dish|wind turbine|solar panel|generator|turbine|engine|motor|piston|gear|cogwheel|lever|pulley|spring \\(device\\)|screw|bolt|nut \\(hardware\\)|nail \\(hardware\\)|hammer|wrench|screwdriver|pliers|saw|drill|chainsaw|welding torch|blowtorch|toolbox|tool belt|workbench|anvil|forge)\\b'),
  ...R('og:technology', '武器与装备', '\\b(sword|katana|wakizashi|tanto|nodachi|claymore|broadsword|longsword|shortsword|rapier|saber|sabre|scimitar|falchion|dagger|knife|combat knife|kunai|shuriken|naginata|yari|spear|lance|halberd|glaive|polearm|axe|battle axe|war axe|hatchet|mace|warhammer|club|cudgel|staff|quarterstaff|bo staff|nunchaku|tonfa|sai|kama|kusarigama|whip|chain whip|flail|bow|longbow|shortbow|crossbow|arrow|arrows|quiver|gun|rifle|assault rifle|sniper rifle|shotgun|pistol|handgun|revolver|submachine gun|machine gun|minigun|grenade|grenade launcher|rocket launcher|bazooka|missile|torpedo|cannon|artillery|tank|mortar|flamethrower|railgun|laser gun|plasma gun|energy sword|lightsaber|beam saber|shield|buckler|tower shield|armor|helmet|gauntlet|greave|pauldron|breastplate|chainmail|plate armor|scale mail|leather armor|bomb|dynamite|tnt|mine \\(explosive\\)|landmine|detonator|ammunition|bullet|bullets|cartridge|magazine \\(weapon\\)|holster|scabbard|sheath|weapon case|armory|arsenal)\\b'),

  /* —— 音频 —— */
  ...R('og:audio-tags', '乐器', '\\b(guitar|acoustic guitar|electric guitar|bass guitar|bass \\(instrument\\)|ukulele|banjo|mandolin|violin|viola|cello|double bass|harp|piano|grand piano|keyboard \\(instrument\\)|organ|accordion|harmonica|flute|piccolo|clarinet|oboe|bassoon|saxophone|trumpet|trombone|tuba|french horn|bugle|drum|drums|drum kit|snare drum|bass drum|timpani|cymbal|hi-hat|tambourine|xylophone|marimba|glockenspiel|vibraphone|triangle \\(instrument\\)|gong|bell|handbell|chime|wind chime|sitar|tabla|erhu|guzheng|pipa|shamisen|koto|shakuhachi|taiko|biwa|flute \\(instrument\\)|ocarina|pan flute|bagpipes|lute|lyre|theremin|synthesizer|synth|drum machine|sampler|turntable \\(instrument\\)|amplifier|speaker|microphone stand|music stand|sheet music|music score|tablature)\\b'),
  ...R('og:audio-tags', '音乐相关', '\\b(music|song|singing|singer|vocalist|idol|band|orchestra|choir|chorus|concert|live performance|stage|stage lighting|microphone|headphones|earphones|karaoke|dancing to music|playing (?:an )?instrument|playing (?:guitar|piano|violin|drums|flute|harp|trumpet|saxophone|cello|bass)|record|vinyl|vinyl record|cassette|cd|mp3 player|walkman|discman|radio|speaker|subwoofer|equalizer|mixing console|dj|disc jockey|music note|musical note|musical notes|sheet music|score|lyrics|song lyrics|bpm|tempo)\\b'),

  /* —— 符号 / 文字 —— */
  ...R('og:symbols', '符号', '\\b(symbol|symbols|icon|pictogram|glyph|emoji|emoticon|kaomoji|arrow|arrows|heart|hearts|heart symbol|star|stars|star symbol|cross|crucifix|pentagram|pentacle|hexagram|swastika|yin-yang|om|ankh|eye of horus|infinity symbol|question mark|exclamation mark|exclamation point|at sign|hash|hashtag|ampersand|percent sign|dollar sign|yen sign|euro sign|pound sign|currency|currency symbol|chess piece|playing card|card suit|spade|club suit|diamond suit|heart suit|dice|die|d20|rune|runes|sigil|crest|emblem|coat of arms|flag|flags|banner|pennant|insignia|badge|medal|ribbon \\(award\\)|trophy|laurel wreath|skull|skull and crossbones|hourglass|caduceus|scales of justice|gavel|compass rose|astrolabe|zodiac|zodiac sign|constellation|constellations|planet|planets|moon phase|star chart|astrology|horoscope)\\b'),
  ...R('og:text', '文字与语言', '\\b(text|letter|letters|word|words|alphabet|kanji|hiragana|katakana|hanzi|hanja|hangul|cyrillic|arabic script|devanagari|thai script|hebrew|greek alphabet|latin alphabet|rune \\(script\\)|english text|japanese text|chinese text|korean text|russian text|korean commentary|sign|signage|signboard|billboard|poster|flyer|banner|speech bubble|thought bubble|caption|subtitle|subtitles|onomatopoeia|sound effect|sound effects|sfx|comic|manga|4koma|panel|panels|speech balloon|dialogue|narration|narration box|artist commentary|translated|translation note|watermark|signature|autograph|logo|brand|brand name|product name|title|title card|cover|album cover|book cover|dvd cover|game cover|magazine cover|newspaper|headline|typed|handwritten|calligraphy|graffiti|spray paint|chalk|chalkboard|whiteboard|blackboard|notebook|diary|journal|letter \\(written\\)|envelope|postcard|stamp|seal \\(stamp\\)|sticker|stickers|label|tag \\(metadata\\)|price tag|name tag|question mark|punctuation|quote|quotation marks)\\b'),

  /* —— 元标签 / 主观 —— */
  ...R('og:metatags', '元标签', '\\b(comic|4koma|manga|doujinshi|illustration|sketch|lineart|line art|colored|partially colored|monochrome|greyscale|traditional media|digital media|vector|pixel art|dot art|ascii art|3d|3d model|cgi|low poly|voxel|chibi|super deformed|meme|parody|fanart|original|original character|oc|collab|commission|request|gift art|celebration|anniversary|birthday|christmas present|valentine|white day|april fools|halloween costume|new year|valentine\'s day|illustration \\(medium\\)|concept art|character design|reference sheet|storyboard|thumbnail|preview|wip|work in progress|unfinished|revision|redraw|remake|after|before and after|comparison|side by side|animated|animation|gif|webm|video|sound|audio|voice|music video|lyric video|loop|seamless loop|wallpaper \\(object\\)|phone wallpaper|desktop wallpaper|calendar|poster \\(object\\)|sticker sheet|sticker set|print \\(medium\\)|art print|merchandise|goods|figure \\(toy\\)|figurine|nendoroid|garage kit|scale figure|plush|plushie|dakimakura|body pillow|tapestry|towels|mug \\(object\\)|keychain|can badge|acrylic stand|standee|card \\(object\\)|trading card|gacha|gacha game|lottery)\\b'),
  ...R('og:subjective', '主观评价', '\\b(beautiful|gorgeous|stunning|elegant|graceful|charming|cute|kawaii|adorable|lovely|pretty|hot|sexy|seductive|alluring|allure|glamorous|majestic|epic|dramatic|intense|peaceful|serene|calm|cozy|warm|healing|wholesome|funny|hilarious|amusing|comical|absurd|weird|strange|bizarre|creepy|eerie|ominous|menacing|mysterious|ethereal|dreamy|surreal|nostalgic|melancholic|lonely|sad mood|melancholy|hopeful|triumphant|heroic|badass|cool|stylish|trendy|fashionable|elegant dress|beautiful eyes|beautiful face|beautiful hair|beautiful scenery|beautiful sky)\\b'),
  ...R('og:phrases', '短语', '\\b(hello|hi|hey|good morning|good evening|good night|thank you|thanks|sorry|excuse me|please|yes|no|maybe|ok|okay|sure|welcome|goodbye|bye|see you|nice to meet you|how are you|i love you|love you|miss you|hug me|kiss me|hold me|help me|stop it|dont stop|let\'s go|lets go|come here|over here|look here|watch out|be careful|congratulations|happy birthday|merry christmas|happy new year|happy valentine\'s day|trick or treat|cheers|kanpai|itadakimasu|gochisousama|ohayou|konnichiwa|konbanwa|arigatou|sumimasen|gomen|hai|iie|sugoi|kawaii|yamete|nani|baka|oh my god|omg|wtf|lol|haha|hehe|hihi|uwu|owo|xD)\\b'),

  /* —— 角色 / 作品 / 画师 —— */
  ...R('cb:character', '角色名', '\\([a-z0-9 .\\-\'!]+\\).*$'),
  ...R('cb:artist', '画师', '^@'),
  ...R('cb:items', '生活器物', '\\b(chair|stool|sofa|couch|bench|table|desk|nightstand|cabinet|shelf|bookshelf|wardrobe|closet|drawer|chest \\(furniture\\)|bed|cot|hammock|mattress|pillow|cushion|blanket|duvet|quilt|sheet \\(bedding\\)|futon|kotatsu|curtain|blinds|rug|carpet|mat|mirror|picture frame|frame|clock|wall clock|alarm clock|hourglass|vase|pot \\(container\\)|plant pot|flowerpot|basket|bucket|box|cardboard box|crate|barrel|jar|bottle|lid|cap \\(container\\)|can|tin|bag \\(container\\)|envelope|folder|binder|clipboard|notebook|book|books|textbook|novel|magazine \\(object\\)|newspaper \\(object\\)|diary|planner|paper|paper sheet|notepaper|sticky note|post-it|index card|card|greeting card|letter \\(written\\)|pen|ballpoint pen|fountain pen|pencil|mechanical pencil|colored pencil|marker|highlighter|crayon|chalk|eraser|sharpener|ruler|protractor|compass \\(tool\\)|scissors|stapler|tape|duct tape|masking tape|glue|glue stick|paper clip|binder clip|pushpin|thumbtack|pin|needle|thread|sewing kit|button \\(fastener\\)|zipper|velcro|rope|string|twine|chain|cable|wire|net|fishing net|hook|ladder|stepladder|scaffold|wheelbarrow|crate|pallet|toolbox|flashlight|lamp|desk lamp|floor lamp|chandelier|candle|candlestick|lantern|torch \\(lighting\\)|light bulb|fluorescent lamp|neon sign|streetlight|street light|traffic light|mailbox|postbox|newspaper box|trash can|dumpster|recycling bin|bucket|mop|broom|dustpan|vacuum cleaner|laundry basket|clothesline|clothespin|iron \\(appliance\\)|ironing board|fan|electric fan|air conditioner|heater|radiator|thermostat|humidifier|dehumidifier|aromatherapy|incense|incense burner|candle holder|matches|matchbox|lighter|ashtray|pipe \\(smoking\\)|cigar|cigarette|smoking pipe|hookah|bong|vape|e-cigarette)\\b'),
];
