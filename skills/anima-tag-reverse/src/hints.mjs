/**
 * hints.mjs —— 规则补充层（第五步：给词库打补丁，不动词库本身）
 *
 * 词库是 Danbooru 的英文标签表，中文/口语侧天生有洞。实测已知三个洞：
 *   ① 「两个人」→ 只出 heart hands duo（人数层空着）
 *   ② 「蓝白条纹水手服」→ 只出 sailor shirt（水手服本身丢了）
 *   ③ 「低角度仰拍」→ 低 → low horns（单字虚命中）
 *
 * 这里用三张表补：
 *   COUNT_GROUPS  人数/性别的口语写法 → 词库里真实存在的标签（1girl / 2girls / 1girl 1boy …）
 *   CJK_DECOMPOSE 中文复合词的拆分规则（颜色 / 图案材质 / 款式尾词）
 *   SHORT_ALIASES 短别名：词库查不到、但中文里天天用的说法
 *
 * 设计约定：只补「词库里确认存在」的标签。表里每一条都经过 `rtag --search` 核实，
 * 不存在的不写进来——宁可少给，也不要凭规则造 tag。
 */

/**
 * 人数分组词：整条短语（或其中一段）→ 一组标签。
 * key 是紧凑串（keyOf 之后的形式：小写、无空格标点），匹配时按长度从长到短试，
 * 避免「两个人」先被更短的「两人」抢走。
 */
export const COUNT_GROUPS = {
  // 纯人数（性别未知时优先 girls，与社区默认一致）
  '一个人': ['1girl', 'solo'], '一个人单独': ['1girl', 'solo'], '单人': ['1girl', 'solo'], '独自': ['1girl', 'solo'],
  '两个人': ['2girls'], '两人': ['2girls'], '二人': ['2girls'], '俩人': ['2girls'],
  '三个人': ['3girls'], '三人': ['3girls'], '仨人': ['3girls'],
  '四个人': ['4girls'], '四人': ['4girls'],
  '五个人': ['5girls'], '五人': ['5girls'],
  '一群人': ['multiple girls'], '多人': ['multiple girls'], '众人': ['multiple girls'], '若干人': ['multiple girls'],
  'several people': ['multiple girls'], 'a couple': ['2girls'],

  // 性别明确的人数
  '两个女孩': ['2girls'], '两个女生': ['2girls'], '两个少女': ['2girls'], '两个妹子': ['2girls'], '两位少女': ['2girls'],
  '三个女孩': ['3girls'], '三个少女': ['3girls'], '三个男生': ['3boys'], '三个少年': ['3boys'],
  '两个男孩': ['2boys'], '两个男生': ['2boys'], '两个少年': ['2boys'], '两位少年': ['2boys'],
  '一个女孩': ['1girl', 'solo'], '一个少女': ['1girl', 'solo'], '一名少女': ['1girl', 'solo'], '一位少女': ['1girl', 'solo'],
  '一个男孩': ['1boy', 'solo'], '一个少年': ['1boy', 'solo'], '一名少年': ['1boy', 'solo'], '一位少年': ['1boy', 'solo'],
  '一个男生': ['1boy', 'solo'], '一个女生': ['1girl', 'solo'], '一个男人': ['1boy', 'solo'], '一个女人': ['1girl', 'solo'],

  // 组合人数
  '一男一女': ['1girl', '1boy'], '男女各一': ['1girl', '1boy'], '男女两人': ['1girl', '1boy'],
  '一男两女': ['1boy', '2girls'], '两男一女': ['2boys', '1girl'],
  '两个女孩一个男孩': ['2girls', '1boy'], '一个女孩两个男孩': ['1girl', '2boys'],
  '两个男孩一个女孩': ['2boys', '1girl'], '两个男生一个女生': ['2boys', '1girl'],
  '一个男生两个女生': ['1boy', '2girls'], '一个男孩两个女孩': ['1boy', '2girls'],
  '一男': ['1boy'], '一女': ['1girl'],

  // 裸量词：后面跟的不是「人」而是具体身份时（「一个穿白裙的女孩」）也要出人数标签。
  // 不写死性别——parseCounts 见到 1girl+1boy 这类冲突会自行收口；搭配 GENDER_WORDS 的句子由更长条目先命中。
  '一个': ['1girl', 'solo'], '一位': ['1girl', 'solo'], '一名': ['1girl', 'solo'],
  '两个': ['2girls'], '两位': ['2girls'], '三名': ['3girls'],

  // 英文口语
  'only one': ['1girl', 'solo'], 'just one': ['1girl', 'solo'], 'two of them': ['2girls']
};

/** 性别关键词 → 人数标签的性别部分（供「N 个 X」组合式解析用） */
export const GENDER_WORDS = {
  girl: ['女孩', '女生', '少女', '妹子', '女人', '女性', '美少女'],
  boy: ['男孩', '男生', '少年', '男人', '男性', '汉子', '帅哥']
};

/** 中文数字（含阿拉伯数字）→ 数值 */
export const CN_NUMERALS = {
  '一': 1, '两': 2, '二': 2, '俩': 2, '三': 3, '仨': 3, '四': 4, '五': 5, '六': 6,
  '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6
};

/**
 * 中文复合词拆分。
 *
 * 中文没有词边界，用户写「蓝白条纹水手服」时整串在词库里查不到，
 * 现有的最长匹配只能吃掉后半截（实测只出了 sailor shirt，水手服本身丢了）。
 * 这里的做法是把复合词切成「修饰成分 + 款式尾词」，修饰成分再降级成英文短语去查：
 *
 *   蓝白条纹水手服
 *     ├ 尾词「水手服」   → sailor dress（整串查不到，退到同族标签）
 *     ├ 颜色「蓝白」     → blue 相关
 *     └ 图案「条纹」     → striped
 *
 * 三段命中**并列保留**，谁都不删——覆盖率优先，噪声交给 --min 与压制规则处理。
 */
export const CJK_DECOMPOSE = {
  /** 颜色词：先匹配长词（「蓝白」比「蓝」优先），再匹配单字 */
  colors: {
    '蓝白': 'blue', '黑白': 'black and white', '红白': 'red and white', '粉白': 'pink and white',
    '紫黑': 'purple and black', '金银': 'gold and silver', '彩色': 'multicolored', '渐层': 'gradient',
    '深蓝': 'dark blue', '浅蓝': 'light blue', '深红': 'dark red', '浅粉': 'light pink', '淡粉': 'light pink',
    '深绿': 'dark green', '浅绿': 'light green', '深紫': 'dark purple', '浅紫': 'light purple',
    '银白': 'silver', '银灰': 'silver', '金发': 'blonde', '银发': 'silver',
    '红': 'red', '橙': 'orange', '黄': 'yellow', '绿': 'green', '青': 'cyan', '蓝': 'blue', '紫': 'purple',
    '粉': 'pink', '黑': 'black', '白': 'white', '灰': 'grey', '棕': 'brown', '褐': 'brown', '银': 'silver', '金': 'gold'
  },
  /** 图案/材质修饰：整段中文 → 英文形容词（与词库标签表面写法一致） */
  patterns: {
    '条纹': 'striped', '格子': 'plaid', '格纹': 'plaid', '方格': 'checkered', '圆点': 'polka dot',
    '波点': 'polka dot', '蕾丝': 'lace', '花边': 'frilled', '荷叶边': 'frilled',
    '百褶': 'pleated', '褶皱': 'pleated', '印花': 'print', '刺绣': 'embroidery', '缎面': 'satin',
    '皮革': 'leather', '牛仔': 'denim', '毛绒': 'fur trim', '绒毛': 'fur trim', '丝质': 'silk',
    '透明': 'transparent', '透视': 'see-through', '露背': 'backless', '露肩': 'off shoulder',
    '无袖': 'sleeveless', '长袖': 'long sleeves', '短袖': 'short sleeves', '高领': 'turtleneck'
  },
  /**
   * 服装款式尾词：中文 → 词库里的标签写法（表里都是 --search 确认存在的标签）。
   * 注意：「学生服 / 校服」这类词本身在词库里已有中文释义，走正常路径就能命中，
   * 放在这里是为了让它在复合词里也能被切出来（「蓝白校服」也要出 school uniform）。
   */
  garments: {
    '水手服': 'sailor dress', '学生服': 'school uniform', '校服': 'school uniform',
    '连衣裙': 'dress', '长裙': 'long skirt', '短裙': 'short skirt', '百褶裙': 'pleated skirt',
    '超短裙': 'microskirt', '吊带裙': 'sundress', '旗袍': 'qipao', '和服': 'japanese clothes',
    '浴衣': 'yukata', '汉服': 'hanfu', '女仆装': 'maid', '护士服': 'nurse', '西装': 'business suit',
    '制服': 'uniform', '泳装': 'swimsuit', '比基尼': 'bikini', '死库水': 'school swimsuit',
    '过膝袜': 'thighhighs', '长筒袜': 'thighhighs', '大腿袜': 'thighhighs', '连裤袜': 'pantyhose',
    '丝袜': 'pantyhose', '短袜': 'socks', '长靴': 'boots', '靴子': 'boots', '高跟鞋': 'high heels',
    '运动鞋': 'sneakers', '凉鞋': 'sandals', '皮鞋': 'shoes', '围巾': 'scarf', '领带': 'necktie',
    '项圈': 'choker', '手套': 'gloves', '披风': 'cape', '斗篷': 'cloak', '外套': 'jacket',
    '大衣': 'coat', '毛衣': 'sweater', '衬衫': 'shirt', 'T恤': 't-shirt', '背心': 'tank top',
    '牛仔裤': 'jeans', '短裤': 'shorts', '裤子': 'pants', '帽子': 'hat', '贝雷帽': 'beret',
    '眼镜': 'glasses', '耳环': 'earrings', '项链': 'necklace', '发饰': 'hair ornament',
    '蝴蝶结': 'hair bow', '双马尾': 'twintails', '马尾': 'ponytail', '丸子头': 'hair bun',
    '麻花辫': 'braid', '呆毛': 'ahoge', '兽耳': 'animal ears', '猫耳': 'cat ears', '狐耳': 'fox ears',
    '兔耳': 'rabbit ears', '尾巴': 'tail', '翅膀': 'wings', '光环': 'halo',
    '王冠': 'crown', '头纱': 'veil', '面具': 'mask', '绷带': 'bandage'
  },
  /** 尾词最短长度：太短（「服」「裙」）会把无关词切碎 */
  minTailLen: 2,
  /** 修饰成分最短长度 */
  minModifierLen: 1,
  /**
   * 单字颜色后面若接这些字，说明这个字已在构成别的名词，不能当颜色用：
   * 「银发」「红眼」「白天」都不是「银 / 红 / 白」的服装修饰。
   * 注意不要放「色」：「白色连衣裙」「蓝色水手服」里的「色」正是颜色的后缀，
   * 颜色的解析已经在 colors 表里按最长匹配做了，「白色」会命中「白」+ 尾词「色」。
   */
  sortNounChars: ['发', '髪', '眼', '瞳', '光', '天', '云', '花', '人', '毛', '皮', '肤']
};

/**
 * 短别名：中文口语/网络写法 → 词库标签。
 * 与词库自带别名（aliases）互补：这里只放词库里确实没有的说法。
 * 值一律是**标签写法**（空格而非下划线），命中后按 forced 处理（精确命中）。
 */
export const SHORT_ALIASES = {
  // 画质与出图形态
  '高清': 'highres', '超清': 'absurdres', '超高清': 'absurdres', '低清': 'lowres',
  '横图': 'landscape', '竖图': 'portrait', '方图': 'square', '大头照': 'portrait',
  '全身像': 'full body', '半身像': 'upper body', '七分身': 'cowboy shot', '特写': 'close-up',
  // 风格
  '动画截图': 'anime screenshot', '动画风': 'anime', '二次元': 'anime', '写实': 'realistic',
  '厚涂': 'painterly', '赛璐璐': 'cel shading', '平涂': 'flat color', '线稿': 'lineart',
  '黑白': 'monochrome', '灰度': 'greyscale', '水彩': 'watercolor', '像素风': 'pixel art',
  // 画面状态
  '打码': 'censored', '无码': 'uncensored', '全裸': 'completely nude', '半裸': 'topless',
  // 镜头与视角
  '自拍': 'selfie', '合影': 'multiple views', '背影': 'from behind', '侧脸': 'profile',
  '侧身': 'from side', '俯视': 'from above', '仰视': 'from below', '斜构图': 'dutch angle',
  '第一人称': 'pov', '大头': 'close-up',
  // 天气与时间
  '下雨': 'rain', '下雪': 'snow', '起雾': 'fog', '夕阳': 'sunset', '黄昏': 'dusk',
  '清晨': 'sunrise', '深夜': 'night', '白天': 'day',
  // 场景
  '室内': 'indoors', '室外': 'outdoors', '教室': 'classroom', '学校': 'school',
  '上学': 'going to school', '放学': 'going to school', '天台': 'rooftop', '楼梯': 'stairs',
  '图书馆': 'library', '咖啡厅': 'cafe', '车站': 'train station', '海边': 'beach', '沙滩': 'beach',
  '森林': 'forest', '花田': 'flower field', '樱花': 'cherry blossoms',
  '星空': 'starry sky', '月亮': 'moon', '太阳': 'sun', '云': 'cloud', '彩虹': 'rainbow',
  // 光照
  '逆光': 'backlighting', '顺光': 'front lighting', '侧光': 'sidelighting', '顶光': 'top-down lighting',
  '柔光': 'soft lighting', '强光': 'bright lighting', '霓虹': 'neon lights', '烛光': 'candle',
  // 表情
  '微笑': 'smile', '大笑': 'grin', '哭泣': 'crying', '生气': 'angry', '害羞': 'embarrassed',
  '脸红': 'blush', '闭眼': 'closed eyes', '眯眼': 'half-closed eyes', '眨眼': 'wink',
  '张嘴': 'open mouth', '闭嘴': 'closed mouth', '吐舌': 'tongue out',
  '盯着看': 'looking at viewer', '看向镜头': 'looking at viewer', '回头': 'looking back',
  '望天': 'looking up', '低头': 'looking down',
  // 头发
  '长发': 'long hair', '短发': 'short hair', '中长发': 'medium hair', '卷发': 'wavy hair',
  '直发': 'straight hair', '刘海': 'bangs', '齐刘海': 'blunt bangs', '中分': 'parted bangs',
  '鬓发': 'sidelocks', '乱发': 'messy hair', '湿发': 'wet hair', '马尾辫': 'ponytail',
  '双马尾辫': 'twintails',
  // 身材
  '飞机场': 'flat chest', '巨乳': 'large breasts', '贫乳': 'small breasts', '腹肌': 'abs',
  '美腿': 'thighs', '锁骨': 'collarbone', '肚脐': 'navel', '肌肉': 'muscular',
  '丰满': 'curvy', '骨感': 'skinny', '幼态': 'child', '成熟': 'mature female',
  // 第 7 期补入：本地词库查不到、或中文分词会把整词切碎的说法，只能在这一层做「整串命中」
  '鸭子坐': 'wariza', '鸭坐': 'wariza', 'W坐': 'wariza', '割坐': 'wariza',
  '背对镜头': 'from behind', '背影机位': 'from behind',
  '屁股特写': 'ass focus', '屁股怼脸': 'ass focus',
  '贴地视角': 'low angle', '镜头贴近地面': 'low angle',
  '鱼眼': 'fisheye', '鱼眼镜头': 'fisheye', '鱼眼透视': 'fisheye', '桶形畸变': 'fisheye',
  '星芒': 'star (symbol)', '光爆': 'light rays',
  '精液': 'cum', '白浊': 'cum', '全身精液': 'cum on body',
  '双手合十': 'palms together', '合十': 'palms together',
  '彩绘玻璃': 'stained glass', '彩窗': 'stained glass',
  '紧身连体衣': 'bodysuit', '举牌': 'holding sign', '白牌': 'blank sign',
  // 第 9 期补入：触手／肉穴场景的口语与被动结构（实测整句中文在文本入口召不回，只能在这一层做整串命中）
  '幼女': 'loli', '幼态少女': 'loli',
  '触手肉穴': 'tentacle pit', '肉穴': 'tentacle pit', '肉壁': 'tentacle pit', '肉空间': 'tentacle pit',
  '触手侵犯': 'tentacle sex', '被触手侵犯': 'tentacle sex', '触手凌辱': 'tentacle sex', '触手性交': 'tentacle sex',
  '嘴里塞着触手': 'tentacle in mouth', '嘴里含着触手': 'tentacle in mouth', '口中有触手': 'tentacle in mouth',
  '嘴里塞着': 'mouth hold', '哭喊': 'crying', '尖叫': 'screaming',
  '发抖': 'trembling', '颤抖': 'trembling', '失神': 'empty eyes', '发情脸': 'ahegao', '翻白眼': 'rolling eyes',
  '阴道插着触手': 'vaginal', '下面插着触手': 'penetration', '双穴同插': 'double penetration',
  '身上全是精液': 'cum on body', '精液溢出': 'cum overflow', '精液喷涌': 'cum overflow',
  '体液飞溅': 'splashing', '眼睛发光': 'glowing eyes', '油光皮肤': 'glossy skin', '虹彩': 'iridescent'
};

/** 规则表里所有参与「整串直接命中」的短语（按长度降序 → 最长优先） */
export function ruleSurfaces() {
  const keys = new Set([
    ...Object.keys(COUNT_GROUPS),
    ...Object.keys(SHORT_ALIASES),
    ...Object.keys(CJK_DECOMPOSE.garments),
    ...Object.keys(CJK_DECOMPOSE.patterns),
    ...Object.keys(CJK_DECOMPOSE.colors)
  ]);
  return [...keys].sort((a, b) => b.length - a.length);
}

/** 中文数字/阿拉伯数字解析（「两」「仨」「12」都吃） */
export function numeralToNumber(tok) {
  if (tok == null) return 0;
  const s = String(tok).trim();
  if (!s) return 0;
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (CN_NUMERALS[s] != null) return CN_NUMERALS[s];
  // 十二 / 二十 这类复合数字（只处理到 99，人数场景够用）
  if (/^十[一二三四五六七八九]?$/.test(s)) return 10 + (CN_NUMERALS[s[1]] || 0);
  if (/^[一二三四五六七八九]十[一二三四五六七八九]?$/.test(s)) return CN_NUMERALS[s[0]] * 10 + (CN_NUMERALS[s[2]] || 0);
  return 0;
}
