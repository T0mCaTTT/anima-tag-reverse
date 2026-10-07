#!/usr/bin/env node
/**
 * 【第一代构建器 · 已停用】
 * 本脚本产出的是「87 个平铺类目」的旧结构（画师类/tags/*.json + tags.json + categories/*.md）。
 * 自第 13 轮起，知识库改由 scripts/build-hierarchy.mjs（两级分类：大分类 → 小分类）+ scripts/finish-build.mjs 生成，
 * 运行本脚本会覆盖新数据，因此这里加了硬拦截：检测到新结构（manifest.meta.bigs）就直接退出。
 * 需要用它做历史对照时：再加参数 --force（并自行备份 画师类/）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTagGroupCategories, buildDatasetCategories, readAttireData } from './datasets.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TODAY = '2026-09-04';

/* ---------- 硬拦截：新结构已接管 ---------- */
{
  const mf = path.join(ROOT, '画师类', 'manifest.json');
  if (fs.existsSync(mf)) {
    let isNew = false;
    try { isNew = !!JSON.parse(fs.readFileSync(mf, 'utf8')).meta?.bigs; } catch {}
    if (isNew && !process.argv.includes('--force')) {
      console.error('\n[已停用] 画师类/ 目前是「两级分类」新结构（由 scripts/build-hierarchy.mjs 生成）。');
      console.error('          运行本脚本（第一代 87 类目构建器）会覆盖新数据，已中止。');
      console.error('          要重建新结构：node scripts/build-hierarchy.mjs && node scripts/finish-build.mjs');
      console.error('          确实要用旧构建器做历史对照：先备份 画师类/，再加 --force 运行。\n');
      process.exit(1);
    }
  }
}

/* ---------- 通用工具（缩略图/展览版共用，需在使用前声明） ---------- */
function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return Math.abs(h); }
const escXml = (t) => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

const SRC = {
  hf: ['Anima 官方模型卡（标签规范/顺序/权重/负向词）', 'https://huggingface.co/circlestone-labs/Anima'],
  comfy: ['ComfyUI 官方 Anima 工作流文档', 'https://docs.comfy.org/tutorials/image/anima/anima'],
  civitaiEco: ['Civitai Anima 生态页（Prompt 指南 + FAQ）', 'https://civitai.com/ecosystems/anima'],
  civitaiArt: ['Civitai 社区实测文章（Boredafk 艺术家人工混合 `@[a:4|b:3]`）', 'https://civitai.com/articles/31037'],
  danbooruTG: ['Danbooru 官方 wiki 标签组总目录', 'https://danbooru.donmai.us/wiki_pages/tag_groups'],
  dgAttire: ['Danbooru wiki: tag group:attire', 'https://danbooru.donmai.us/wiki_pages/tag_group:attire'],
  dgHair: ['Danbooru wiki: tag group:hair', 'https://danbooru.donmai.us/wiki_pages/tag_group:hair'],
  dgEyes: ['Danbooru wiki: tag group:eyes_tags', 'https://danbooru.donmai.us/wiki_pages/tag_group:eyes_tags'],
  dgFace: ['Danbooru wiki: tag group:face_tags', 'https://danbooru.donmai.us/wiki_pages/tag_group:face_tags'],
  dgPose: ['Danbooru wiki: tag group:posture / gestures', 'https://danbooru.donmai.us/wiki_pages/tag_group:posture'],
  dgComp: ['Danbooru wiki: tag group:image_composition', 'https://danbooru.donmai.us/wiki_pages/tag_group:image_composition'],
  dgLight: ['Danbooru wiki: tag group:lighting', 'https://danbooru.donmai.us/wiki_pages/tag_group:lighting'],
  dgBg: ['Danbooru wiki: tag group:backgrounds / locations', 'https://danbooru.donmai.us/wiki_pages/tag_group:backgrounds'],
  dgAcc: ['Danbooru wiki: tag group:accessories', 'https://danbooru.donmai.us/wiki_pages/tag_group:accessories'],
  dgColor: ['Danbooru wiki: tag group:colors', 'https://danbooru.donmai.us/wiki_pages/tag_group:colors'],
  dgTheme: ['Danbooru wiki: tag group:theme / visual_aesthetic', 'https://danbooru.donmai.us/wiki_pages/tag_group:visual_aesthetic'],
  gallery: ['Booru Tag Gallery（Mexes，Danbooru 128K 标签 + 真实投稿数）', 'https://booru-tag-gallery.vercel.app/'],
  explorer: ['Anima 2B Style Explorer 画师索引（59,676 条，按训练样本量降序）', 'https://github.com/ThetaCursed/Anima-Style-Explorer/blob/main/Anima2B_Artist_Index_59k.txt'],
  tools: ['ComfyUI-Anima-Tools（社区可视化提示词插件，画师/角色/服装库）', 'https://github.com/nregret/Comfyui-Anima-Tools'],
  toolsAttire: ['ComfyUI-Anima-Tools: danbooru_attire_data.json（由 tag group:attire 生成的服装槽位表，964 条）', 'https://github.com/nregret/Comfyui-Anima-Tools/blob/main/js/danbooru_attire_data.json'],
  note: ['note.com 108 画风同种子实测', 'https://note.com/ai_0049/n/n74ccab5370e0'],
  moescape: ['moescape Anima Prompt 完整指南（艺术家人工混合权重建议 0.8–1.4）', 'https://moescape.ai/posts/7bc3e4a3-a0ed-46ea-b157-060786f15146'],
  erocraft: ['ComfyCarry 中文 Anima 参数与标签顺序指南', 'https://www.erocraft.com/docs/comfycarry/generation/anima'],
  animadex: ['AnimaDex 角色/画师图鉴', 'https://animadex.net/'],
  liblib: ['LiblibAI Anima-Base 中文官方说明转载', 'https://www.liblib.art/modelinfo/e6bd98ef3afe49ae9bdea419028bf88b'],
  tgWiki: ['Danbooru 官方 tag_group 分组页（56 组，逐页抓取正文）', 'https://danbooru.donmai.us/wiki_pages/tag_groups'],
  gallery40k: ['Anima-Tools 画师数据集（40,600 位画师的 Danbooru 投稿量 + 独特性评分）', 'https://github.com/nregret/Comfyui-Anima-Tools/blob/main/js/data.js'],
  charOfficial: ['Anima-Tools character_official_data.json（7,999 个角色/作品的官方触发词与配套标签）', 'https://github.com/nregret/Comfyui-Anima-Tools/blob/main/js/character_official_data.json'],
  bgDataset: ['AnimaTags-DB 背景方案库（1,057 组带预览的完整背景标签串）', 'https://github.com/nregret/AnimaTags-DB/blob/main/background_data.json'],
  poseDataset: ['AnimaTags-DB 姿势方案库（297 组带预览的完整姿势标签串）', 'https://github.com/nregret/AnimaTags-DB/blob/main/pose_data.json'],
  clothDataset: ['Dressing-doll 服装方案库（430 组带预览的成套服装标签串）', 'https://github.com/nregret/Dressing-doll/blob/main/clothing_data.json'],
};
const s = (k) => ({ label: SRC[k][0], url: SRC[k][1] });

const W = {
  q: '1.0–1.4（质量层一般不加权，需要时轻加权）',
  meta: '1.0（建议保持裸标签）',
  era: '1.0–1.3',
  safe: '1.0（安全档靠裸标签声明）',
  cnt: '1.0–1.2（人数标签务必保留，权重过高会溢出角色）',
  hair: '0.9–1.3',
  eye: '0.9–1.2',
  face: '0.8–1.2（表情叠加不要超过 2–3 个）',
  attire: '1.0–1.5（服装越具体越要加权）',
  uniform: '1.0–1.4',
  trad: '1.1–1.5',
  acc: '1.0–1.4',
  pose: '1.0–1.3',
  comp: '1.0–1.3（构图类建议不超过 2 个，互相冲突）',
  light: '1.0–1.5',
  bg: '1.0–1.4',
  color: '1.0–1.4',
  style: '1.0–1.3（弱效标签可提到 1.5 仍可能无效）',
  char: '1.0–1.3',
  series: '1.0–1.3',
  artist: '0.8–1.4（人工混合：`(@a:1.2), (@b:0.9)`，单画师建议 1.0–1.2）',
  prop: '1.0–1.4',
  neg: '1.0–1.2（负向整串统一，不要逐条加权）',
};
const ARTIST_W = W.artist;
const A = (tag, gloss, alias, freq, note, src) => ({ tag, gloss, alias, freq, weight: ARTIST_W, note, src });
const T = (tag, gloss, alias, weight, freq, note, src) => ({ tag, gloss, alias, weight, freq, note, src });

const CATEGORIES = [
  {
    id: 'quality', name: '质量与画质', order: 10, group: 'A 基础层',
    intro: 'Anima 有两套互相独立的质量系：masterpiece 系与 score_1..9 系。可单用、并用或完全不用；官方负向词默认压 score_1/2/3。注意 `score_*` 是本模型唯一保留下划线的标签。',
    sources: ['hf', 'civitaiEco', 'liblib'],
    items: [
      T('masterpiece', '杰作', ['-'], W.q, '—', '官方正向前缀第一位', 'hf'),
      T('best quality', '最佳质量', ['best_quality'], W.q, '—', '与 masterpiece 常成对出现', 'hf'),
      T('high quality', '高质量', [], W.q, '—', 'masterpiece 系的第三档，可替换', 'erocraft'),
      T('amazing quality', '极佳质量', [], W.q, '—', 'Animagine/Illustrious 系惯用，Anima 兼容', 'note'),
      T('very aesthetic', '极高审美', [], W.q, '—', 'Aesthetic 版原生命中词，同族还有 `aesthetic` / `displeasing`', 'civitaiEco'),
      T('aesthetic', '高审美', [], W.q, '—', '同上，弱档', 'civitaiEco'),
      T('displeasing', '观感不佳', [], W.neg, '—', '常用作负向，压掉廉价观感', 'note'),
      T('score_7', '质量分 7', ['score_8', 'score_9'], W.q, '—', '官方正向示例用 score_7；7–9 为高质量档，可换 8/9', 'hf'),
      T('score_1', '质量分 1', ['score_2', 'score_3'], W.neg, '—', '官方负向串固定含 score_1/2/3', 'hf'),
      T('absurdres', '超高分辨率', ['highres'], W.meta, '3.0M', 'Danbooru 投稿量 3.0M；highres 更高（8.3M）但更泛', 'gallery'),
      T('highres', '高分辨率', [], W.meta, '8.3M', 'Danbooru 最高频元标签之一', 'gallery'),
      T('anime screenshot', '动画截图', ['anime_screenshot'], W.meta, '—', '切换成赛璐璐截图质感', 'hf'),
      T('official art', '官方美术', [], W.meta, '—', '干净、版权绘级完成度', 'hf'),
      T('jpeg artifacts', 'JPEG 压缩伪影', [], W.neg, '—', '官方负向词之一', 'hf'),
      T('chromatic aberration', '色差', [], W.neg, '—', '官方负向词之一', 'hf'),
      T('blurry', '模糊', [], W.neg, '—', '官方负向词之一', 'hf'),
      T('worst quality', '最差质量', [], W.neg, '—', '官方负向串首位', 'hf'),
      T('low quality', '低质量', ['lowres'], W.neg, '—', '官方负向串第二位', 'hf'),
      T('artist name', '画师署名', [], W.neg, '—', '官方负向词：防止模型凭空写出画师签名', 'hf'),
    ],
  },
  {
    id: 'meta-dataset', name: '元标签与数据集前缀', order: 11, group: 'A 基础层',
    intro: '数据集来源标签必须放在整个提示词的**最行首并单独换行**，用于切换模型内部的数据分布（画风与完成度差异明显）。',
    sources: ['hf', 'liblib'],
    items: [
      T('ye-pop', 'ye-pop 插画数据集', ['yepop'], W.meta, '—', '需置行首并换行，禁与 deviantart 同用', 'hf'),
      T('deviantart', 'DeviantArt 数据集', ['deviant art'], W.meta, '—', '需置行首并换行，风格更偏欧美厚涂', 'hf'),
    ],
  },
  {
    id: 'era', name: '时期与年代', order: 12, group: 'A 基础层',
    intro: '时期标签控制「哪一年的动画审美」。官方支持绝对年份与相对档位两种写法，建议整串只出现一个时期标签。',
    sources: ['hf', 'note'],
    items: [
      T('year 2025', '2025 年风格', ['year 2020', 'year 2010', 'year 2000'], W.era, '—', '年份可任意替换；越早越复古', 'hf'),
      T('newest', '最新', [], W.era, '—', '相对档，等价于最近年份', 'hf'),
      T('recent', '近期', [], W.era, '—', '相对档', 'hf'),
      T('mid', '中期', [], W.era, '—', '相对档', 'hf'),
      T('early', '早期', [], W.era, '—', '相对档', 'hf'),
      T('old', '年代久远', [], W.era, '—', '相对档，复古赛璐璐', 'hf'),
      T('retro artstyle', '复古画风', [], W.style, '—', '与时期标签并用效果最好', 'note'),
      T('1990s style', '1990 年代风格', ['1980s style', '2000s style'], W.style, '—', '十年段写法，社区实测稳定', 'note'),
    ],
  },
  {
    id: 'safety', name: '安全分级', order: 13, group: 'A 基础层',
    intro: 'Anima 训练数据带 Danbooru 分级，提示词里给一个明确分级可以显著稳定出图方向。默认推荐 `safe`。',
    sources: ['hf', 'danbooruTG'],
    items: [
      T('safe', '全年龄', [], W.safe, '—', '正面默认档', 'hf'),
      T('sensitive', '敏感', [], W.safe, '—', '介于全年龄与 R18 之间', 'hf'),
      T('nsfw', 'R18', [], W.safe, '—', '成人向', 'hf'),
      T('explicit', '露骨', [], W.safe, '—', '最高档，仅在合规场景使用', 'hf'),
    ],
  },
  {
    id: 'count', name: '人数与画面规模', order: 14, group: 'A 基础层',
    intro: '人数标签放在质量层之后、角色之前。人数与构图强相关：写错人数会直接导致构图崩坏。',
    sources: ['danbooruTG', 'gallery', 'erocraft'],
    items: [
      T('1girl', '1 名女性', ['1girls'], W.cnt, '8.5M', 'Danbooru 最高频内容标签（全站第一）', 'gallery'),
      T('solo', '独自一人', [], W.cnt, '7.1M', '与 1girl 搭配可压掉背景人物', 'gallery'),
      T('2girls', '2 名女性', [], W.cnt, '—', '多人画面必写，否则会退化成单人', 'erocraft'),
      T('multiple girls', '多名女性', [], W.cnt, '—', '3 人及以上时使用', 'danbooruTG'),
      T('1boy', '1 名男性', [], W.cnt, '—', '男性主体', 'danbooruTG'),
      T('2boys', '2 名男性', [], W.cnt, '—', '—', 'danbooruTG'),
      T('multiple boys', '多名男性', [], W.cnt, '—', '—', 'danbooruTG'),
      T('1other', '1 个非人主体', [], W.cnt, '—', '兽/机/拟人等', 'danbooruTG'),
      T('no humans', '无人', [], W.cnt, '—', '纯场景图必须写，否则会塞人进去', 'danbooruTG'),
      T('everyone', '全员', [], W.cnt, '—', '群像', 'danbooruTG'),
    ],
  },
  {
    id: 'hair-color', name: '发色', order: 20, group: 'B 人物层',
    intro: 'Danbooru 发色标签为「颜色 + hair」。Anima 对发色极敏感，写错会直接换人。',
    sources: ['dgHair', 'gallery'],
    items: [
      T('black hair', '黑发', [], W.hair, '—', '基础色', 'dgHair'),
      T('brown hair', '棕发', [], W.hair, '—', '基础色', 'dgHair'),
      T('blonde hair', '金发', ['blond hair'], W.hair, '—', '基础色', 'dgHair'),
      T('white hair', '白发', [], W.hair, '—', '常被误用为 silver hair，二者可区分', 'dgHair'),
      T('silver hair', '银发', [], W.hair, '—', '比 white hair 冷调', 'dgHair'),
      T('grey hair', '灰发', ['gray hair'], W.hair, '—', '—', 'dgHair'),
      T('red hair', '红发', [], W.hair, '—', '—', 'dgHair'),
      T('pink hair', '粉发', [], W.hair, '—', '高饱和，注意与服装配色冲突', 'dgHair'),
      T('blue hair', '蓝发', [], W.hair, '—', '—', 'dgHair'),
      T('aqua hair', '水蓝发', [], W.hair, '—', '介于蓝与青', 'dgHair'),
      T('green hair', '绿发', [], W.hair, '—', '—', 'dgHair'),
      T('purple hair', '紫发', [], W.hair, '—', '—', 'dgHair'),
      T('orange hair', '橙发', [], W.hair, '—', '—', 'dgHair'),
      T('multicolored hair', '多色发', [], W.hair, '—', '需再补具体分区标签', 'dgHair'),
      T('two-tone hair', '双色发', [], W.hair, '—', '—', 'dgHair'),
      T('gradient hair', '渐变发', [], W.hair, '—', '—', 'dgHair'),
      T('streaked hair', '挑染发', [], W.hair, '—', '—', 'dgHair'),
      T('colored inner hair', '内层挑染', [], W.hair, '—', '—', 'dgHair'),
    ],
  },
  {
    id: 'hair-style', name: '发型', order: 21, group: 'B 人物层',
    intro: '发型标签粒度很细，建议「长度 + 造型」各取一个，最多再补一个装饰性描述。',
    sources: ['dgHair', 'gallery', 'danbooruTG'],
    items: [
      T('long hair', '长发', [], W.hair, '6.3M', 'Danbooru 第三高频标签', 'gallery'),
      T('short hair', '短发', [], W.hair, '3.2M', '与 long hair 互斥', 'gallery'),
      T('medium hair', '中长发', [], W.hair, '—', '肩到胸之间', 'dgHair'),
      T('very long hair', '超长发', [], W.hair, '—', '过腰', 'dgHair'),
      T('absurdly long hair', '极长发', [], W.hair, '—', '拖地级', 'dgHair'),
      T('twintails', '双马尾', ['twin tails'], W.hair, '—', '高频造型', 'dgHair'),
      T('ponytail', '马尾', [], W.hair, '—', '—', 'dgHair'),
      T('side ponytail', '侧马尾', [], W.hair, '—', '—', 'dgHair'),
      T('twin braids', '双辫', [], W.hair, '—', '—', 'dgHair'),
      T('braid', '辫子', [], W.hair, '—', '—', 'dgHair'),
      T('bun', '丸子头', [], W.hair, '—', '—', 'dgHair'),
      T('double bun', '双丸子头', [], W.hair, '—', '—', 'dgHair'),
      T('hair bun', '发髻', [], W.hair, '—', '—', 'dgHair'),
      T('hime cut', '公主切', [], W.hair, '—', '和风直发＋平刘海＋侧发', 'dgHair'),
      T('bob cut', '波波头', [], W.hair, '—', '—', 'dgHair'),
      T('wavy hair', '波浪发', [], W.hair, '—', '—', 'dgHair'),
      T('curly hair', '卷发', [], W.hair, '—', '—', 'dgHair'),
      T('straight hair', '直发', [], W.hair, '—', '—', 'dgHair'),
      T('messy hair', '凌乱发', [], W.hair, '—', '增加手绘感', 'dgHair'),
      T('floating hair', '飘动的头发', [], W.hair, '—', '静态图做动势的关键', 'dgHair'),
      T('hair between eyes', '眼前碎发', [], W.hair, '—', '常见的遮眼碎发', 'dgHair'),
      T('bangs', '刘海', [], W.hair, '—', '具体型：blunt bangs / swept bangs', 'dgHair'),
      T('blunt bangs', '齐刘海', [], W.hair, '—', '—', 'dgHair'),
      T('ahoge', '呆毛', [], W.hair, '—', '萌系标志', 'dgHair'),
      T('side braid', '侧辫', [], W.hair, '—', '—', 'dgHair'),
    ],
  },
  {
    id: 'eyes', name: '眼睛与瞳色', order: 22, group: 'B 人物层',
    intro: '瞳色为「颜色 + eyes」。画幅越近（close-up / portrait）瞳色权重越该提高。',
    sources: ['dgEyes', 'gallery'],
    items: [
      T('blue eyes', '蓝眼', [], W.eye, '2.5M', 'Danbooru 高频瞳色', 'gallery'),
      T('brown eyes', '棕眼', [], W.eye, '—', '—', 'dgEyes'),
      T('black eyes', '黑眼', [], W.eye, '—', '—', 'dgEyes'),
      T('green eyes', '绿眼', [], W.eye, '—', '—', 'dgEyes'),
      T('grey eyes', '灰眼', ['gray eyes'], W.eye, '—', '—', 'dgEyes'),
      T('red eyes', '红眼', [], W.eye, '—', '—', 'dgEyes'),
      T('purple eyes', '紫眼', [], W.eye, '—', '—', 'dgEyes'),
      T('yellow eyes', '黄眼', [], W.eye, '—', '—', 'dgEyes'),
      T('pink eyes', '粉眼', [], W.eye, '—', '—', 'dgEyes'),
      T('aqua eyes', '水蓝眼', [], W.eye, '—', '—', 'dgEyes'),
      T('heterochromia', '异色瞳', [], W.eye, '—', '需补左右具体色', 'dgEyes'),
      T('sparkle', '眼中闪光', [], W.eye, '—', '提升完成度', 'dgEyes'),
      T('sparkling eyes', '闪闪发光的眼睛', [], W.eye, '—', '—', 'dgEyes'),
      T('half-closed eyes', '半闭眼', [], W.eye, '—', '—', 'dgEyes'),
      T('closed eyes', '闭眼', [], W.eye, '—', '—', 'dgEyes'),
      T('empty eyes', '空洞眼', [], W.eye, '—', '病娇/黑化向', 'dgEyes'),
      T('heart-shaped pupils', '心形瞳孔', [], W.eye, '—', '—', 'dgEyes'),
      T('slit pupils', '竖瞳', [], W.eye, '—', '—', 'dgEyes'),
      T('eyelashes', '睫毛', ['long eyelashes'], W.eye, '—', '—', 'dgEyes'),
      T('makeup', '妆容', ['eyeshadow', 'eyeliner'], W.eye, '—', '可与 eyeshadow/eyeliner 叠加', 'danbooruTG'),
    ],
  },
  {
    id: 'face', name: '五官与体态特征', order: 23, group: 'B 人物层',
    intro: '体态与年龄标签会显著改变人体比例，混用（如 loli + mature female）会导致比例崩坏。',
    sources: ['dgFace', 'danbooruTG'],
    items: [
      T('smile', '微笑', [], W.face, '4.2M', '最高频表情', 'gallery'),
      T('open mouth', '张嘴', [], W.face, '3.6M', '常与 smile 连用', 'gallery'),
      T('blush', '脸红', [], W.face, '4.1M', 'Danbooru 高频表情标签', 'gallery'),
      T('lips', '嘴唇', ['parted lips'], W.face, '—', '—', 'dgFace'),
      T('fangs', '虎牙', [], W.face, '—', '—', 'dgFace'),
      T('mole under eye', '眼下泪痣', [], W.face, '—', '角色识别度道具', 'dgFace'),
      T('freckles', '雀斑', [], W.face, '—', '—', 'dgFace'),
      T('pointy ears', '尖耳', ['elf ears'], W.face, '—', '精灵/魔族', 'danbooruTG'),
      T('animal ears', '兽耳', ['cat ears', 'fox ears'], W.face, '—', '细分：cat ears / fox ears / rabbit ears', 'danbooruTG'),
      T('horns', '角', [], W.face, '—', '细分：demon horns / dragon horns', 'danbooruTG'),
      T('halo', '光环', [], W.face, '—', '天使向', 'danbooruTG'),
      T('wings', '翅膀', ['black wings', 'white wings'], W.face, '—', '细分颜色与形态', 'danbooruTG'),
      T('tail', '尾巴', ['cat tail', 'fox tail'], W.face, '—', '—', 'danbooruTG'),
      T('loli', '幼女体型', [], W.face, '—', '与 mature female 互斥', 'danbooruTG'),
      T('child', '儿童', [], W.face, '—', '非性化描述，注意安全档', 'danbooruTG'),
      T('mature female', '成熟女性', [], W.face, '—', '改变脸型与身材比例', 'danbooruTG'),
      T('muscular', '肌肉发达', ['abs'], W.face, '—', '—', 'danbooruTG'),
      T('thick eyebrows', '浓眉', [], W.face, '—', '—', 'dgFace'),
      T('hair over one eye', '单眼被发遮', [], W.face, '—', '—', 'dgFace'),
      T('sunglasses', '太阳镜', [], W.face, '—', '遮挡眼睛，慎与瞳色并用', 'dgAcc'),
    ],
  },
  {
    id: 'expression', name: '表情与情绪', order: 24, group: 'B 人物层',
    intro: 'Anima 对表情标签响应明显，但叠加超过 2–3 个会互相压制。强烈情绪建议配 `crying`+`tears` 这类成对标签。',
    sources: ['dgFace', 'danbooruTG', 'gallery'],
    items: [
      T('happy', '开心', [], W.face, '—', '基础情绪', 'dgFace'),
      T('laughing', '大笑', [], W.face, '—', '—', 'dgFace'),
      T('grin', '咧嘴笑', [], W.face, '—', '—', 'dgFace'),
      T('crying', '哭泣', ['tears'], W.face, '—', '常与 tears / streaming tears 连用', 'dgFace'),
      T('sad', '悲伤', [], W.face, '—', '—', 'dgFace'),
      T('angry', '生气', [], W.face, '—', '—', 'dgFace'),
      T('pout', '撅嘴', [], W.face, '—', '—', 'dgFace'),
      T('surprised', '惊讶', [], W.face, '—', '—', 'dgFace'),
      T('embarrassed', '害羞', [], W.face, '—', '与 blush 不同：更偏情绪', 'dgFace'),
      T('serious', '严肃', [], W.face, '—', '—', 'dgFace'),
      T('expressionless', '面无表情', [], W.face, '—', '—', 'dgFace'),
      T('smug', '得意', ['naughty face'], W.face, '—', '—', 'dgFace'),
      T('shy', '羞怯', [], W.face, '—', '—', 'dgFace'),
      T('sleepy', '困倦', [], W.face, '—', '—', 'dgFace'),
      T('tongue out', '吐舌', [], W.face, '—', '—', 'dgFace'),
      T('licking lips', '舔唇', [], W.face, '—', '—', 'dgFace'),
      T('scared', '恐惧', ['fear'], W.face, '—', '—', 'dgFace'),
      T('pain', '痛苦', [], W.face, '—', '—', 'dgFace'),
      T('disgust', '厌恶', [], W.face, '—', '—', 'dgFace'),
      T('sweatdrop', '汗滴', [], W.face, '—', '漫画式演出', 'dgFace'),
      T('anger vein', '怒筋', [], W.face, '—', '漫画式演出', 'dgFace'),
    ],
  },
  {
    id: 'attire', name: '服装（上装／下装／鞋袜）', order: 30, group: 'C 服装层',
    intro: '服装是本知识库体量最大的一类。Danbooru 把服装拆到「一件一标签」，Anima 里写得越具体越准；一次性写 3 件以上不相关服装会互相收敛。服装槽位规则（上装/下装/鞋/袜/装饰/传统/制服）来自社区维护的 964 条服装表。',
    sources: ['toolsAttire', 'dgAttire', 'gallery'],
    items: [
      T('shirt', '衬衫', ['tshirt'], W.attire, '3.0M', '最泛用上装标签', 'gallery'),
      T('dress shirt', '正装衬衫', [], W.attire, '—', '袖口/领型更硬', 'toolsAttire'),
      T('blouse', '女式衬衫', ['ruffled blouse'], W.attire, '—', '—', 'toolsAttire'),
      T('sweater', '毛衣', ['knit sweater'], W.attire, '—', '—', 'toolsAttire'),
      T('hoodie', '连帽衫', [], W.attire, '—', '—', 'toolsAttire'),
      T('jacket', '夹克', [], W.attire, '—', '—', 'toolsAttire'),
      T('coat', '外套', ['overcoat', 'wool coat'], W.attire, '—', '细分材质：wool coat / trench coat', 'toolsAttire'),
      T('cardigan', '开衫', [], W.attire, '—', '—', 'toolsAttire'),
      T('vest', '马甲', [], W.attire, '—', '—', 'toolsAttire'),
      T('tank top', '背心', ['camisole'], W.attire, '—', '—', 'toolsAttire'),
      T('tube top', '抹胸', ['halter top'], W.attire, '—', '—', 'toolsAttire'),
      T('crop top', '露脐上衣', [], W.attire, '—', '—', 'toolsAttire'),
      T('off shoulder', '露肩', ['off-shoulder shirt'], W.attire, '—', '—', 'toolsAttire'),
      T('sleeveless', '无袖', ['long sleeves', 'short sleeves', 'sleeves rolled up'], W.attire, '2.4M(long sleeves)', '白模最容易漏的袖子信息，建议显式声明', 'gallery'),
      T('pleated skirt', '百褶裙', [], W.attire, '—', '—', 'toolsAttire'),
      T('miniskirt', '迷你裙', [], W.attire, '—', '—', 'toolsAttire'),
      T('long skirt', '长裙', [], W.attire, '—', '—', 'toolsAttire'),
      T('plaid skirt', '格纹裙', [], W.attire, '—', '—', 'toolsAttire'),
      T('skirt', '裙子', [], W.attire, '—', '最泛用下装标签', 'toolsAttire'),
      T('jeans', '牛仔裤', [], W.attire, '—', '—', 'toolsAttire'),
      T('shorts', '短裤', ['denim shorts', 'short shorts'], W.attire, '—', '—', 'toolsAttire'),
      T('pants', '长裤', ['slacks'], W.attire, '—', '—', 'toolsAttire'),
      T('dress', '连衣裙', ['sundress'], W.attire, '—', '—', 'toolsAttire'),
      T('gown', '礼服长裙', ['evening gown'], W.attire, '—', '—', 'toolsAttire'),
      T('sailor dress', '水手连衣裙', [], W.uniform, '—', '—', 'toolsAttire'),
      T('sports bra', '运动内衣', [], W.attire, '—', '—', 'toolsAttire'),
      T('leotard', '连体紧身衣', ['bodysuit'], W.attire, '—', '—', 'toolsAttire'),
      T('thighhighs', '过膝袜', ['thigh highs'], W.attire, '—', '常见搭配：black thighhighs', 'toolsAttire'),
      T('pantyhose', '连裤袜', [], W.attire, '—', '—', 'toolsAttire'),
      T('socks', '短袜', ['kneehighs'], W.attire, '—', '—', 'toolsAttire'),
      T('boots', '靴子', ['ankle boots', 'thigh boots'], W.attire, '—', '—', 'toolsAttire'),
      T('high heels', '高跟鞋', ['pumps'], W.attire, '—', '—', 'toolsAttire'),
      T('loafers', '乐福鞋', [], W.attire, '—', '—', 'toolsAttire'),
      T('sneakers', '运动鞋', [], W.attire, '—', '—', 'toolsAttire'),
      T('sandals', '凉鞋', [], W.attire, '—', '—', 'toolsAttire'),
      T('barefoot', '赤脚', [], W.attire, '—', '—', 'toolsAttire'),
      T('swimsuit', '泳装', ['one-piece swimsuit', 'bikini'], W.attire, '—', '细分：school swimsuit / bikini', 'toolsAttire'),
      T('school swimsuit', '学校泳装', [], W.attire, '—', '—', 'toolsAttire'),
      T('apron', '围裙', [], W.attire, '—', '—', 'toolsAttire'),
      T('scarf', '围巾', ['muffler'], W.attire, '—', '—', 'toolsAttire'),
      T('cape', '披风', ['cloak'], W.attire, '—', '—', 'toolsAttire'),
      T('armor', '铠甲', ['breastplate', 'pauldron'], W.attire, '—', '幻想题材', 'toolsAttire'),
      T('hood', '兜帽', [], W.attire, '—', '—', 'toolsAttire'),
    ],
  },
  {
    id: 'uniform', name: '制服与职业装', order: 31, group: 'C 服装层',
    intro: '制服是「成套语义」标签，一个标签就能同时改变领型、裙型与配色，性价比极高。',
    sources: ['toolsAttire', 'dgAttire', 'danbooruTG'],
    items: [
      T('school uniform', '校服', ['serafuku'], W.uniform, '—', '日式西式校服统称', 'toolsAttire'),
      T('sailor collar', '水手领', [], W.uniform, '—', '—', 'toolsAttire'),
      T('blazer', '西装外套校服', [], W.uniform, '—', '—', 'toolsAttire'),
      T('gym uniform', '运动服', ['buruma'], W.uniform, '—', '—', 'toolsAttire'),
      T('suit', '西装', ['business suit'], W.uniform, '—', '—', 'toolsAttire'),
      T('necktie', '领带', ['bowtie'], W.uniform, '—', '—', 'toolsAttire'),
      T('maid', '女仆装', ['maid uniform'], W.uniform, '—', '—', 'toolsAttire'),
      T('nurse uniform', '护士服', [], W.uniform, '—', '—', 'toolsAttire'),
      T('police uniform', '警服', [], W.uniform, '—', '—', 'toolsAttire'),
      T('military uniform', '军装', [], W.uniform, '—', '—', 'toolsAttire'),
      T('nun', '修女服', ['habit'], W.uniform, '—', '—', 'toolsAttire'),
      T('waitress', '女服务生装', [], W.uniform, '—', '—', 'toolsAttire'),
      T('labcoat', '白大褂', [], W.uniform, '—', '—', 'toolsAttire'),
      T('santa costume', '圣诞装', ['santa dress'], W.uniform, '—', '官方示例串使用过', 'hf'),
      T('wedding dress', '婚纱', [], W.uniform, '—', '—', 'toolsAttire'),
      T('idol costume', '偶像舞台服', ['stage costume'], W.uniform, '—', '—', 'toolsAttire'),
      T('witch hat', '女巫帽', [], W.acc, '—', '与 witch 套装联动', 'dgAcc'),
      T('witch', '女巫装', [], W.uniform, '—', '—', 'toolsAttire'),
    ],
  },
  {
    id: 'traditional', name: '传统与和风服饰', order: 32, group: 'C 服装层',
    intro: '和风/中式传统服饰在 Anima 里识别度极高，建议整套写（如 kimono + obi + geta）。',
    sources: ['toolsAttire', 'dgAttire'],
    items: [
      T('kimono', '和服', ['yukata'], W.trad, '—', '—', 'toolsAttire'),
      T('yukata', '浴衣', [], W.trad, '—', '夏季节日和服', 'toolsAttire'),
      T('furisode', '振袖和服', [], W.trad, '—', '—', 'toolsAttire'),
      T('hakama', '袴', ['hakama skirt'], W.trad, '—', '—', 'toolsAttire'),
      T('obi', '和服腰带', [], W.trad, '—', '—', 'toolsAttire'),
      T('miko', '巫女服', [], W.trad, '—', '红白配色', 'toolsAttire'),
      T('japanese clothes', '日式服装', [], W.trad, '—', '泛用兜底', 'dgAttire'),
      T('hanfu', '汉服', ['chinese clothes'], W.trad, '—', '—', 'toolsAttire'),
      T('qipao', '旗袍', ['cheongsam'], W.trad, '—', '—', 'toolsAttire'),
      T('changshan', '长衫', [], W.trad, '—', '—', 'toolsAttire'),
      T('sari', '纱丽', [], W.trad, '—', '—', 'toolsAttire'),
      T('kebaya', '娘惹装', [], W.trad, '—', '—', 'toolsAttire'),
      T('dirndl', '巴伐利亚传统裙', [], W.trad, '—', '—', 'toolsAttire'),
      T('gothic lolita', '哥特洛丽塔', ['lolita fashion'], W.trad, '—', '—', 'toolsAttire'),
      T('maid dress', '女仆连衣裙', [], W.trad, '—', '—', 'toolsAttire'),
      T('victorian', '维多利亚风格', [], W.trad, '—', '—', 'dgTheme'),
    ],
  },
  {
    id: 'accessory', name: '配饰与道具', order: 33, group: 'C 服装层',
    intro: '配饰是「角色还原度」的关键：同色衣服的两个角色，往往靠配饰标签区分。',
    sources: ['dgAcc', 'gallery', 'danbooruTG'],
    items: [
      T('hair ornament', '发饰', ['hairclip', 'hair bow'], W.acc, '—', '—', 'gallery'),
      T('hairband', '发箍', [], W.acc, '—', '—', 'dgAcc'),
      T('ribbon', '缎带', [], W.acc, '—', '—', 'dgAcc'),
      T('headphones', '耳机', [], W.acc, '—', '—', 'dgAcc'),
      T('hat', '帽子', ['cap', 'beret'], W.acc, '—', '—', 'dgAcc'),
      T('glasses', '眼镜', ['spectacles'], W.acc, '—', '—', 'dgAcc'),
      T('choker', '颈环', [], W.acc, '—', '—', 'dgAcc'),
      T('necklace', '项链', ['pendant'], W.acc, '—', '—', 'dgAcc'),
      T('earrings', '耳饰', [], W.acc, '—', '—', 'dgAcc'),
      T('gloves', '手套', ['fingerless gloves'], W.acc, '—', '—', 'dgAcc'),
      T('bracelet', '手镯', ['bangle'], W.acc, '—', '—', 'dgAcc'),
      T('belt', '腰带', [], W.acc, '—', '—', 'dgAcc'),
      T('bag', '包', ['handbag', 'backpack'], W.acc, '—', '持物类建议配合 holding 标签', 'dgAcc'),
      T('umbrella', '伞', [], W.acc, '—', '—', 'dgAcc'),
      T('sword', '剑', ['katana', 'dagger'], W.prop, '—', '—', 'dgAcc'),
      T('staff', '法杖', ['wand'], W.prop, '—', '—', 'dgAcc'),
      T('bow', '弓', ['bow (weapon)'], W.prop, '—', '—', 'dgAcc'),
      T('gun', '枪', ['handgun', 'rifle'], W.prop, '—', '—', 'dgAcc'),
      T('shield', '盾', [], W.prop, '—', '—', 'dgAcc'),
      T('microphone', '麦克风', [], W.prop, '—', '—', 'dgAcc'),
      T('book', '书', [], W.prop, '—', '—', 'dgAcc'),
      T('flower', '花', ['bouquet'], W.prop, '—', '—', 'dgAcc'),
      T('food', '食物', ['ice cream', 'cake'], W.prop, '—', '—', 'dgAcc'),
      T('cup', '杯子', ['teacup', 'mug'], W.prop, '—', '—', 'dgAcc'),
      T('balloon', '气球', [], W.prop, '—', '—', 'dgAcc'),
      T('parasol', '阳伞', [], W.prop, '—', '—', 'dgAcc'),
      T('holding', '手持物品', [], W.prop, '2.2M', '必须与具体道具标签连用才有指向', 'gallery'),
    ],
  },
  {
    id: 'pose', name: '姿势、动作与视线', order: 40, group: 'D 构图与镜头',
    intro: '姿势标签控制骨骼，视线标签控制眼神落点。二者混用时优先保证视线标签只有一个。',
    sources: ['dgPose', 'gallery', 'danbooruTG'],
    items: [
      T('looking at viewer', '看向镜头', [], W.pose, '5.0M', 'Danbooru 高频视线标签', 'gallery'),
      T('looking away', '视线移开', [], W.pose, '—', '—', 'dgPose'),
      T('looking back', '回头看', [], W.pose, '—', '—', 'dgPose'),
      T('looking up', '向上看', [], W.pose, '—', '—', 'dgPose'),
      T('looking down', '向下看', [], W.pose, '—', '—', 'dgPose'),
      T('eye contact', '对视', [], W.pose, '—', '—', 'dgPose'),
      T('standing', '站立', [], W.pose, '—', '—', 'dgPose'),
      T('sitting', '坐', ['seiza'], W.pose, '—', '细分：seiza / sitting on chair', 'dgPose'),
      T('lying', '躺', ['on back', 'on stomach'], W.pose, '—', '—', 'dgPose'),
      T('crouching', '蹲', [], W.pose, '—', '—', 'dgPose'),
      T('kneeling', '跪坐', [], W.pose, '—', '—', 'dgPose'),
      T('walking', '行走', [], W.pose, '—', '—', 'dgPose'),
      T('running', '奔跑', [], W.pose, '—', '—', 'dgPose'),
      T('jumping', '跳跃', [], W.pose, '—', '—', 'dgPose'),
      T('dancing', '跳舞', [], W.pose, '—', '—', 'dgPose'),
      T('stretching', '伸展', [], W.pose, '—', '—', 'dgPose'),
      T('arms up', '举手', ['hand up'], W.pose, '—', '—', 'dgPose'),
      T('arms behind back', '手背后', [], W.pose, '—', '—', 'dgPose'),
      T('crossed arms', '抱臂', [], W.pose, '—', '—', 'dgPose'),
      T('hands on hips', '叉腰', [], W.pose, '—', '—', 'dgPose'),
      T('hand on own cheek', '手贴脸', [], W.pose, '—', '—', 'dgPose'),
      T('peace sign', '比耶', ['v sign'], W.pose, '—', '—', 'dgPose'),
      T('outstretched arm', '伸手', [], W.pose, '—', '—', 'dgPose'),
      T('hugging own legs', '抱膝', [], W.pose, '—', '—', 'dgPose'),
      T('leaning forward', '前倾', [], W.pose, '—', '—', 'dgPose'),
      T('contrapposto', '对立式站姿', [], W.pose, '—', '重心偏移的高级站姿', 'dgPose'),
      T('head tilt', '歪头', [], W.pose, '—', '—', 'dgPose'),
      T('facing away', '背对', ['from behind'], W.pose, '—', '与构图标签联动', 'dgPose'),
    ],
  },
  {
    id: 'composition', name: '构图、镜头与画幅', order: 41, group: 'D 构图与镜头',
    intro: '构图标签来自 Danbooru `tag group:image_composition`。互相冲突（如 from above + from below）会造成模型摇摆，建议只留一个。',
    sources: ['dgComp', 'danbooruTG', 'gallery'],
    items: [
      T('portrait', '胸像以上', [], W.comp, '—', '画幅偏紧', 'dgComp'),
      T('upper body', '上半身', [], W.comp, '—', '最常用画幅', 'dgComp'),
      T('cowboy shot', '七分身', [], W.comp, '—', '到大腿中段', 'dgComp'),
      T('full body', '全身', [], W.comp, '—', '—', 'dgComp'),
      T('close-up', '特写', ['close up'], W.comp, '—', '面部为主', 'dgComp'),
      T('from above', '俯视', ['high angle'], W.comp, '—', '—', 'dgComp'),
      T('from below', '仰视', ['low angle'], W.comp, '—', '—', 'dgComp'),
      T('from side', '侧面', ['profile'], W.comp, '—', '—', 'dgComp'),
      T('from behind', '从背后', [], W.comp, '—', '—', 'dgComp'),
      T('dutch angle', '斜构图', [], W.comp, '—', '倾斜镜头，增强张力', 'dgComp'),
      T('wide shot', '远景', ['scenery'], W.comp, '—', '—', 'dgComp'),
      T('panoramic', '全景', ['wide shot'], W.comp, '—', '—', 'dgComp'),
      T('symmetry', '对称构图', ['symmetric composition'], W.comp, '—', '—', 'dgComp'),
      T('rule of thirds', '三分法', [], W.comp, '—', '—', 'dgComp'),
      T('depth of field', '景深', ['blurry background'], W.comp, '—', '虚化背景', 'dgComp'),
      T('bokeh', '散景', [], W.comp, '—', '—', 'dgComp'),
      T('blurry foreground', '前景虚化', [], W.comp, '—', '—', 'dgComp'),
      T('motion blur', '动态模糊', [], W.comp, '—', '—', 'dgComp'),
      T('perspective', '透视', ['vanishing point'], W.comp, '—', '—', 'dgComp'),
      T('fisheye', '鱼眼', [], W.comp, '—', '—', 'dgComp'),
      T('framing', '框景', ['frame within a frame'], W.comp, '—', '—', 'dgComp'),
      T('cinematic', '电影感', [], W.comp, '—', '社区常用泛化构图词', 'note'),
      T('letterboxed', '上下黑边', [], W.comp, '—', '—', 'dgComp'),
      T('aspect ratio', '画幅比例', [], W.comp, '—', '非标签，仅供理解：由生成尺寸控制', 'dgComp'),
    ],
  },
  {
    id: 'lighting', name: '光照与氛围', order: 42, group: 'D 构图与镜头',
    intro: '光照标签来自 Danbooru `tag group:lighting`。Anima 对光影响应很好，但光源方向标签同时用两个会互相抵消。',
    sources: ['dgLight', 'danbooruTG', 'gallery'],
    items: [
      T('sunlight', '阳光', [], W.light, '—', '—', 'dgLight'),
      T('backlighting', '逆光', ['backlit'], W.light, '—', '—', 'dgLight'),
      T('rim light', '轮廓光', ['rim lighting'], W.light, '—', '提升立体感', 'dgLight'),
      T('cinematic lighting', '电影光', [], W.light, '—', '—', 'dgLight'),
      T('dramatic lighting', '戏剧光', [], W.light, '—', '—', 'dgLight'),
      T('soft lighting', '柔光', [], W.light, '—', '—', 'dgLight'),
      T('hard light', '硬光', ['harsh lighting'], W.light, '—', '—', 'dgLight'),
      T('volumetric lighting', '体积光', ['god ray'], W.light, '—', '—', 'dgLight'),
      T('light rays', '光线束', [], W.light, '—', '—', 'dgLight'),
      T('lens flare', '镜头光晕', [], W.light, '—', '—', 'dgLight'),
      T('bloom', '泛光', [], W.light, '—', '—', 'dgLight'),
      T('glowing', '发光', ['glow'], W.light, '—', '—', 'dgLight'),
      T('neon lights', '霓虹灯', [], W.light, '—', '赛博/夜景常用', 'dgLight'),
      T('night', '夜晚', [], W.light, '—', '—', 'dgLight'),
      T('sunset', '日落', ['dusk'], W.light, '—', '—', 'dgLight'),
      T('golden hour', '黄金时刻', [], W.light, '—', '—', 'dgLight'),
      T('blue hour', '蓝调时刻', [], W.light, '—', '—', 'dgLight'),
      T('day', '白天', [], W.light, '—', '—', 'dgLight'),
      T('morning', '清晨', [], W.light, '—', '—', 'dgLight'),
      T('cloudy sky', '多云天空', ['cloudy'], W.light, '—', '—', 'dgLight'),
      T('overcast', '阴天', [], W.light, '—', '—', 'dgLight'),
      T('dappled sunlight', '斑驳阳光', [], W.light, '—', '树影/花瓣投影', 'dgLight'),
      T('light particles', '光粒子', ['dust motes'], W.light, '—', '—', 'dgLight'),
      T('caustics', '焦散光纹', [], W.light, '—', '水面反射光纹', 'dgLight'),
      T('spotlight', '聚光灯', [], W.light, '—', '—', 'dgLight'),
      T('shadow', '阴影', ['cast shadow'], W.light, '—', '—', 'dgLight'),
      T('chiaroscuro', '明暗对照', [], W.light, '—', '—', 'dgLight'),
      T('silhouette', '剪影', [], W.light, '—', '—', 'dgLight'),
    ],
  },
  {
    id: 'background', name: '背景、场景与天气', order: 43, group: 'D 构图与镜头',
    intro: '背景标签决定「照片在哪拍」。写 `simple background` 与写 `scenery` 是两种完全不同的产品：前者出角色立绘，后者出场景插画。',
    sources: ['dgBg', 'gallery', 'danbooruTG'],
    items: [
      T('simple background', '简单背景', [], W.bg, '2.9M', '立绘/贴纸向', 'gallery'),
      T('white background', '白背景', [], W.bg, '2.4M', '抠图友好', 'gallery'),
      T('black background', '黑背景', [], W.bg, '—', '—', 'dgBg'),
      T('transparent background', '透明背景', [], W.bg, '—', '—', 'dgBg'),
      T('gradient background', '渐变背景', [], W.bg, '—', '—', 'dgBg'),
      T('scenery', '风景', ['landscape'], W.bg, '—', '—', 'dgBg'),
      T('outdoors', '户外', [], W.bg, '—', '—', 'dgBg'),
      T('indoors', '室内', [], W.bg, '—', '与 outdoors 互斥', 'dgBg'),
      T('sky', '天空', [], W.bg, '—', '—', 'dgBg'),
      T('cloud', '云', ['clouds'], W.bg, '—', '—', 'dgBg'),
      T('starry sky', '星空', ['starry night'], W.bg, '—', '—', 'dgBg'),
      T('moon', '月亮', ['full moon'], W.bg, '—', '—', 'dgBg'),
      T('sun', '太阳', ['sunlight'], W.bg, '—', '—', 'dgBg'),
      T('rain', '雨', ['raining'], W.bg, '—', '—', 'dgBg'),
      T('snow', '雪', ['snowing'], W.bg, '—', '—', 'dgBg'),
      T('fog', '雾', ['mist'], W.bg, '—', '—', 'dgBg'),
      T('wind', '风', [], W.bg, '—', '配合 floating hair 使用', 'dgBg'),
      T('underwater', '水下', [], W.bg, '—', '—', 'dgBg'),
      T('city', '城市', ['cityscape'], W.bg, '—', '—', 'dgBg'),
      T('street', '街道', ['city street'], W.bg, '—', '—', 'dgBg'),
      T('indoors', '室内', ['classroom', 'bedroom'], W.bg, '—', '—', 'dgBg'),
      T('classroom', '教室', [], W.bg, '—', '—', 'dgBg'),
      T('bedroom', '卧室', [], W.bg, '—', '—', 'dgBg'),
      T('cafe', '咖啡馆', [], W.bg, '—', '—', 'dgBg'),
      T('library', '图书馆', [], W.bg, '—', '—', 'dgBg'),
      T('forest', '森林', [], W.bg, '—', '—', 'dgBg'),
      T('flower field', '花田', ['wildflower hill'], W.bg, '—', '—', 'dgBg'),
      T('beach', '海滩', ['ocean'], W.bg, '—', '—', 'dgBg'),
      T('mountains', '山脉', ['mountain'], W.bg, '—', '—', 'dgBg'),
      T('cherry blossoms', '樱花', ['sakura'], W.bg, '—', '—', 'dgBg'),
      T('autumn leaves', '秋叶', [], W.bg, '—', '—', 'dgBg'),
      T('ruins', '废墟', [], W.bg, '—', '—', 'dgBg'),
      T('space', '宇宙', ['starry sky'], W.bg, '—', '—', 'dgBg'),
      T('aquarium', '水族馆', [], W.bg, '—', '—', 'dgBg'),
      T('shrine', '神社', [], W.bg, '—', '—', 'dgBg'),
      T('rainbow', '彩虹', [], W.bg, '—', '—', 'dgBg'),
    ],
  },
  {
    id: 'color', name: '色彩与色调', order: 44, group: 'D 构图与镜头',
    intro: '色彩策略标签用于整体调色。经验：**降低色彩信息量**的标签（单色、网点、低饱和）效果最稳定；复合抽象词（steampunk 等）容易互相收敛。',
    sources: ['dgColor', 'note'],
    items: [
      T('monochrome', '单色', [], W.color, '—', '实测稳定有效', 'note'),
      T('greyscale', '灰度', [], W.color, '—', '与 monochrome 并用即黑白稿', 'dgColor'),
      T('sepia', '棕褐色调', [], W.color, '—', '—', 'dgColor'),
      T('limited palette', '限定色板', [], W.color, '—', '—', 'dgColor'),
      T('pastel colors', '粉彩色', [], W.color, '—', '—', 'dgColor'),
      T('muted colors', '低饱和', ['desaturated'], W.color, '—', '—', 'dgColor'),
      T('vivid colors', '鲜艳配色', ['high contrast'], W.color, '—', '—', 'dgColor'),
      T('colorful', '多彩', [], W.color, '—', '—', 'dgColor'),
      T('warm colors', '暖色调', [], W.color, '—', '—', 'dgColor'),
      T('cool colors', '冷色调', [], W.color, '—', '—', 'dgColor'),
      T('duotone', '双色调', [], W.color, '—', '—', 'dgColor'),
      T('high contrast', '高对比', [], W.color, '—', '—', 'dgColor'),
      T('black theme', '黑色主题', ['white theme'], W.color, '—', '主题色系', 'dgColor'),
      T('screentones', '网点纸', [], W.color, '—', '漫画质感，实测稳定', 'note'),
      T('flat color', '平涂上色', ['flat colour illustration'], W.style, '—', '单用效果有限（默认已偏平涂）', 'note'),
    ],
  },
  {
    id: 'style', name: '画风、媒介与题材', order: 50, group: 'E 风格与题材',
    intro: '画风三层结构：①`@artist`（最强，见画师类）②`xxx style`（有效但依标签而异）③收敛陷阱（复合抽象概念）。以下标签的「有效/弱效」结论来自 note.com 108 画风同种子实测与 Civitai 生态页；未实测者标「待验证」。',
    sources: ['note', 'civitaiEco', 'hf', 'dgTheme'],
    items: [
      T('studio ghibli style', '吉卜力风格', [], W.style, '—', '实测有效', 'note'),
      T('pixar style', '皮克斯风格', [], W.style, '—', '实测有效', 'note'),
      T('spider-verse style', '蜘蛛宇宙风格', [], W.style, '—', '实测有效', 'note'),
      T('akira toriyama style', '鸟山明风格', [], W.style, '—', '实测有效（也可写成 @artist 形式）', 'note'),
      T('arknights style', '明日方舟风格', [], W.style, '—', '实测有效', 'note'),
      T('art nouveau style', '新艺术风格', [], W.style, '—', '实测有效', 'note'),
      T('vaporwave style', '蒸汽波风格', [], W.style, '—', '实测有效', 'note'),
      T('gothic style', '哥特风格', [], W.style, '—', '实测有效', 'note'),
      T('golden age comic style', '黄金时代美漫风格', [], W.style, '—', '实测有效', 'note'),
      T('pencil style', '铅笔风格', [], W.style, '—', '实测有效', 'note'),
      T('makoto shinkai style', '新海诚风格', [], W.style, '—', '实测弱效', 'note'),
      T('kyoto animation style', '京都动画风格', [], W.style, '—', '实测弱效', 'note'),
      T('trigger style', '扳机社风格', [], W.style, '—', '实测弱效', 'note'),
      T('arcane style', '双城之战风格', [], W.style, '—', '实测弱效', 'note'),
      T('cartoon network style', '卡通频道风格', [], W.style, '—', '实测弱效', 'note'),
      T('sunrise mecha anime style', '日升机甲动画风格', [], W.style, '—', '实测弱效', 'note'),
      T('cel shading style', '赛璐璐着色', [], W.style, '—', '实测无效（默认已具备）', 'note'),
      T('steampunk', '蒸汽朋克', [], W.style, '—', '复合抽象标签，易收敛', 'note'),
      T('cyberpunk', '赛博朋克', [], W.style, '—', '同上，建议拆成霓虹＋改造部件', 'note'),
      T('anime style', '动画风格', [], W.style, '—', '基本冗余，Anima 默认即动画', 'hf'),
      T('realistic', '写实', [], W.style, '—', 'Anima 不擅长写实，慎用', 'hf'),
      T('watercolor (medium)', '水彩媒介', ['watercolour'], W.style, '—', '媒介类', 'danbooruTG'),
      T('traditional media', '传统媒介', [], W.style, '—', '—', 'danbooruTG'),
      T('oil painting', '油画', [], W.style, '—', '—', 'danbooruTG'),
      T('ink wash painting', '水墨', ['sumi-e'], W.style, '—', '—', 'danbooruTG'),
      T('sketch', '草图', ['rough sketch'], W.style, '—', '—', 'danbooruTG'),
      T('lineart', '线稿', [], W.style, '—', '—', 'danbooruTG'),
      T('pixel art', '像素画', [], W.style, '—', '—', 'danbooruTG'),
      T('3d', '3D 渲染', ['3d (medium)'], W.style, '—', '—', 'danbooruTG'),
      T('photo (medium)', '照片媒介', [], W.style, '—', '与模型定位冲突，慎用', 'danbooruTG'),
      T('chibi', 'Q 版', [], W.style, '—', '权重需比 SDXL 更重，如 `(chibi:2)`', 'hf'),
      T('super deformed', '夸张变形', [], W.style, '—', '—', 'danbooruTG'),
      T('fantasy', '奇幻题材', [], W.style, '—', '—', 'dgTheme'),
      T('sci-fi', '科幻题材', [], W.style, '—', '—', 'dgTheme'),
      T('horror (theme)', '恐怖题材', [], W.style, '—', '—', 'dgTheme'),
      T('post-apocalyptic', '末世题材', [], W.style, '—', '—', 'dgTheme'),
      T('magical girl', '魔法少女', [], W.style, '—', '—', 'dgTheme'),
      T('mecha', '机甲', [], W.style, '—', '—', 'dgTheme'),
      T('slice of life', '日常题材', [], W.style, '—', '—', 'dgTheme'),
      T('historical', '历史题材', [], W.style, '—', '—', 'dgTheme'),
      T('sports (theme)', '运动题材', [], W.style, '—', '—', 'dgTheme'),
      T('music (theme)', '音乐题材', [], W.style, '—', '—', 'dgTheme'),
      T('christmas', '圣诞', [], W.style, '—', '—', 'dgTheme'),
      T('halloween', '万圣节', [], W.style, '—', '—', 'dgTheme'),
      T('valentine', '情人节', [], W.style, '—', '—', 'dgTheme'),
    ],
  },
  {
    id: 'character', name: '角色', order: 60, group: 'F 角色与作品',
    intro: '角色标签通常写成「角色名 + 作品名」两段（官方示例：`oomuro sakurako, yuru yuri`）。角色名一律小写、空格代下划线；带括号的同名角色用转义括号（如 `reimu \(touhou\)`）。本节为高频入门集，完整角色目录见 AnimaDex（36 角色）与 Civitai tag 搜索。',
    sources: ['hf', 'animadex', 'tools'],
    items: [
      T('hatsune miku', '初音未来', [], W.char, '—', '作品：vocaloid', 'animadex'),
      T('kagamine rin', '镜音铃', [], W.char, '—', '作品：vocaloid', 'animadex'),
      T('kagamine len', '镜音连', [], W.char, '—', '作品：vocaloid', 'animadex'),
      T('megurine luka', '巡音流歌', [], W.char, '—', '作品：vocaloid', 'animadex'),
      T('hakurei reimu', '博丽灵梦', [], W.char, '—', '作品：touhou', 'animadex'),
      T('kirisame marisa', '雾雨魔理沙', [], W.char, '—', '作品：touhou', 'animadex'),
      T('remilia scarlet', '蕾米莉亚·斯卡雷特', [], W.char, '—', '作品：touhou', 'animadex'),
      T('flandre scarlet', '芙兰朵露·斯卡雷特', [], W.char, '—', '作品：touhou', 'animadex'),
      T('sakuya izayoi', '十六夜咲夜', [], W.char, '—', '作品：touhou', 'animadex'),
      T('frieren', '芙莉莲', [], W.char, '—', '作品：sousou no frieren', 'animadex'),
      T('fern', '菲伦', [], W.char, '—', '作品：sousou no frieren', 'animadex'),
      T('himmel', '辛美尔', [], W.char, '—', '作品：sousou no frieren', 'animadex'),
      T('gojo satoru', '五条悟', [], W.char, '—', '作品：jujutsu kaisen', 'animadex'),
      T('itadori yuuji', '虎杖悠仁', [], W.char, '—', '作品：jujutsu kaisen', 'animadex'),
      T('makima', '玛奇玛', [], W.char, '—', '作品：chainsaw man', 'animadex'),
      T('denji', '电次', [], W.char, '—', '作品：chainsaw man', 'animadex'),
      T('power', '帕瓦', [], W.char, '—', '作品：chainsaw man', 'animadex'),
      T('yor forger', '约尔·福杰', [], W.char, '—', '作品：spy x family', 'animadex'),
      T('anya forger', '阿尼亚·福杰', [], W.char, '—', '作品：spy x family', 'animadex'),
      T('loid forger', '劳埃德·福杰', [], W.char, '—', '作品：spy x family', 'animadex'),
      T('nezuko kamado', '灶门祢豆子', [], W.char, '—', '作品：kimetsu no yaiba', 'animadex'),
      T('tanjiro kamado', '灶门炭治郎', [], W.char, '—', '作品：kimetsu no yaiba', 'animadex'),
      T('zenitsu agatsuma', '我妻善逸', [], W.char, '—', '作品：kimetsu no yaiba', 'animadex'),
      T('yae miko', '八重神子', [], W.char, '—', '作品：genshin impact', 'animadex'),
      T('raiden shogun', '雷电将军', [], W.char, '—', '作品：genshin impact', 'animadex'),
      T('ganyu', '甘雨', [], W.char, '—', '作品：genshin impact', 'animadex'),
      T('hutao', '胡桃', [], W.char, '—', '作品：genshin impact', 'animadex'),
      T('furina', '芙宁娜', [], W.char, '—', '作品：genshin impact', 'animadex'),
      T('nahim', '纳西妲 (nahida)', [], W.char, '—', '作品：genshin impact；规范写法 `nahida (genshin impact)`', 'animadex'),
      T('asuka langley soryu', '惣流·明日香·兰格雷', [], W.char, '—', '作品：evangelion', 'animadex'),
      T('rei ayanami', '绫波丽', [], W.char, '—', '作品：evangelion', 'animadex'),
      T('sailor moon', '水手月亮', [], W.char, '—', '作品：bishoujo senshi sailor moon', 'animadex'),
      T('saber', 'Saber', [], W.char, '—', '作品：fate/stay night', 'animadex'),
      T('rin tohsaka', '远坂凛', [], W.char, '—', '作品：fate/stay night', 'animadex'),
      T('zero two', '零二', [], W.char, '—', '作品：darling in the franxx', 'animadex'),
      T('marin kitagawa', '喜多川海梦', [], W.char, '—', '作品：sono bisque doll wa koi wo suru', 'animadex'),
      T('anya', '阿尼亚', [], W.char, '—', '与 anya forger 同义，别名合并保留', 'animadex'),
    ],
  },
  {
    id: 'series', name: '作品与 IP', order: 61, group: 'F 角色与作品',
    intro: '作品标签放在角色标签之后。它同时锁定角色的服装配色与整体画风底味。',
    sources: ['hf', 'animadex', 'liblib'],
    items: [
      T('vocaloid', 'Vocaloid', [], W.series, '—', '—', 'animadex'),
      T('touhou', '东方 Project', [], W.series, '—', '—', 'animadex'),
      T('genshin impact', '原神', [], W.series, '—', '—', 'animadex'),
      T('honkai: star rail', '崩坏：星穹铁道', ['honkai star rail'], W.series, '—', '冒号在标签里保留', 'animadex'),
      T('blue archive', '蔚蓝档案', [], W.series, '—', '—', 'animadex'),
      T('arknights', '明日方舟', [], W.series, '—', '—', 'animadex'),
      T('fate/stay night', 'Fate/stay night', ['fate (series)'], W.series, '—', '斜杠保留', 'animadex'),
      T('jujutsu kaisen', '咒术回战', [], W.series, '—', '—', 'animadex'),
      T('chainsaw man', '链锯人', [], W.series, '—', '—', 'animadex'),
      T('spy x family', '间谍过家家', [], W.series, '—', '—', 'animadex'),
      T('kimetsu no yaiba', '鬼灭之刃', [], W.series, '—', '—', 'animadex'),
      T('sousou no frieren', '葬送的芙莉莲', [], W.series, '—', '—', 'animadex'),
      T('sono bisque doll wa koi wo suru', '更衣人偶坠入爱河', [], W.series, '—', '—', 'animadex'),
      T('evangelion', '新世纪福音战士', ['neon genesis evangelion'], W.series, '—', '—', 'animadex'),
      T('bishoujo senshi sailor moon', '美少女战士', ['sailor moon'], W.series, '—', '—', 'animadex'),
      T('yuru yuri', '摇曳百合', [], W.series, '—', '官方示例串中出现过', 'hf'),
      T('original', '原创角色', ['original character'], W.series, '—', '不指定 IP 时显式声明，可降低角色乱入', 'hf'),
    ],
  },
  {
    id: 'negative', name: '负向提示词（成品串）', order: 70, group: 'G 负向词',
    intro: '官方负向串固定为 `worst quality, low quality, score_1, score_2, score_3, artist name, blurry, jpeg artifacts, chromatic aberration`。下方给出三档可直接复制的成品串。',
    sources: ['hf', 'civitaiEco', 'note'],
    items: [
      T('official negative', '官方负向串', [], W.neg, '—', 'worst quality, low quality, score_1, score_2, score_3, artist name, blurry, jpeg artifacts, chromatic aberration', 'hf'),
      T('anatomy negative', '解剖负向串', [], W.neg, '—', 'bad anatomy, bad hands, extra digits, fewer digits, missing fingers, extra limbs, fused fingers, mutated hands', 'note'),
      T('aesthetic negative', '观感负向串', [], W.neg, '—', 'displeasing, ugly, jpeg artifacts, sketch, watermark, signature, username, text', 'note'),
      T('composition negative', '构图负向串', [], W.neg, '—', 'cropped, out of frame, cut off, bad perspective, deformed', 'civitaiEco'),
      T('watermark', '水印', [], W.neg, '—', '—', 'note'),
      T('signature', '签名', [], W.neg, '—', '—', 'note'),
      T('text', '文字', [], W.neg, '—', 'Anima 文字渲染弱，建议直接压掉', 'hf'),
      T('bad anatomy', '解剖错误', [], W.neg, '—', '—', 'note'),
      T('extra digits', '多余手指', [], W.neg, '—', '—', 'note'),
      T('cropped', '被裁切', [], W.neg, '—', '—', 'note'),
    ],
  },
];

/* ---------- 数据驱动的二级类目：来自已取证的数据文件 ---------- */
const ZERO = new Set(['@', '-', '—', '', null, undefined]);
const built = [];

function readAttire() {
  const p = path.join(ROOT, 'data', 'danbooru_attire_data.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
const ATTIRE = readAttire();

const SLOT_ZH = {
  top: '上装', bottom: '下装', shoes: '鞋', socks: '袜类',
  decoration: '装饰与配饰', traditional: '传统服饰', uniform: '制服与职业装', vocabulary: '材质/样式/状态词汇',
};
const SLOT_NAME = {
  top: '上装 · 细则', bottom: '下装 · 细则', shoes: '鞋履 · 细则', socks: '袜类 · 细则',
  decoration: '服饰装饰 · 细则', traditional: '传统服饰 · 细则', uniform: '制服职业装 · 细则',
  vocabulary: '服装材质与样式词汇', background: '背景与场景槽位', theme: '题材与元素槽位', aesthetic: '审美与色调槽位',
};

const GROUPS = [
  { id: 'attire-detail', name: '服装 · 细则（Danbooru tag group:attire 全量）', order: 34, group: 'C 服装层',
    intro: '由社区从 Danbooru `tag group:attire` 抽出的槽位表（共 964 条）。这些是**一件一标签**的细粒度服装词，写具体服装时优先从这里取，避免使用上位泛词。',
    sources: ['toolsAttire', 'dgAttire'],
    slots: ATTIRE ? Object.entries(ATTIRE).filter(([k]) => SLOT_ZH[k]).sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, v]) => ({ name: SLOT_NAME[k] || SLOT_ZH[k], tags: v })) : [],
    glosser: (t) => `${SLOT_ZH[t.slot] || '服装'}：${t.raw}` },
  { id: 'background-taggroup', name: '背景与题材 · 标签组', order: 45, group: 'D 构图与镜头',
    intro: 'Danbooru `tag group:backgrounds` / `locations` / `theme` / `visual_aesthetic` 中的高频条目，用于快速替换场景与题材。',
    sources: ['dgBg', 'dgTheme'],
    slots: [
      { name: '背景与场景', tags: ATTIRE ? ATTIRE.background || [] : [] },
      { name: '题材与元素', tags: ATTIRE ? ATTIRE.theme || [] : [] },
      { name: '审美与色调', tags: ATTIRE ? ATTIRE.aesthetic || [] : [] },
    ] },
];

for (const g of GROUPS) {
  const items = [];
  const seen = new Set();
  const all = [];
  for (const slot of g.slots) for (const raw of slot.tags) all.push({ slot: slot.name, raw });
  for (const t of all) {
    const key = String(t.raw).toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    items.push({
      tag: key,
      zh: g.glosser(t),
      aliases: [],
      weight: g.id === 'attire-detail' ? '1.0–1.5' : '1.0–1.4',
      freq: null,
      freq_note: '未取证：投稿量待验证',
      confidence: '待验证',
      note: '由数据集生成，语义与画幅效果待实测',
      slot: t.slot,
      source: s(g.sources[0]),
    });
  }
  if (!items.length) continue;
  built.push({
    id: g.id, name: g.name, order: g.order, group: g.group, intro: g.intro,
    count: items.length, sources: g.sources.map(s), items,
    subgroups: g.slots.map(sl => ({ name: sl.name, count: items.filter(i => i.slot === sl.name).length })),
  });
}

/* ---------- 数据驱动类目：Danbooru 官方 tag_group + 角色/作品/方案库 ---------- */
built.push(...buildTagGroupCategories(ROOT, s));
built.push(...buildDatasetCategories(ROOT, s, { today: TODAY }));

/* ---------- 画师：从已取证的 59,676 条索引中提取 ---------- */
const artistFile = path.join(ROOT, 'data', 'Anima2B_Artist_Index_59k.txt');
const artistLines = fs.readFileSync(artistFile, 'utf8').split(/\r?\n/)
  .map(l => l.trim())
  .filter(l => l.startsWith('@') && l.length > 2);
const allArtists = artistLines.map(l => l.replace(/^@/, ''));
const CURATED_ARTISTS = [
  ['dairi', '大理由（清晰线条＋通透上色，通用安全牌）', '1.0–1.2'],
  ['ebifurya', '海老振屋（柔和光影与少女体态）', '1.0–1.2'],
  ['hammer (sunset beach)', 'Hammer（明亮高饱和，招牌夏日配色）', '1.0–1.2'],
  ['haruyama kazunori', '春山和德（原画线条，动感强）', '1.0–1.2'],
  ['ruu (tksymkw)', 'RUU（柔光厚涂少女）', '1.0–1.2'],
  ['itomugi-kun', '板麦（低饱和薄涂，氛围感强）', '0.9–1.1'],
  ['yaegashi nan', '八重樫南（闪耀少女向）', '0.9–1.1'],
  ['mizuki hitoshi', '水希等（冷色调赛璐璐）', '0.9–1.1'],
  ['kouji (campus life)', 'Kouji（校园日常感）', '0.9–1.1'],
  ['rebecca (keinelove)', 'Rebecca（韩系厚涂）', '0.9–1.1'],
  ['bkub', 'BKUB（模板漫画式演出）', '0.8–1.0'],
  ['kou hiyoyo', 'Kou Hiyoyo（强光感插画）', '0.9–1.1'],
];
const topArtists = allArtists.slice(0, 300);

/* ---------- 组装 ---------- */
const catById = new Map(CATEGORIES.map(c => [c.id, c]));

function buildCategory(cat) {
  const seen = new Map();
  const items = [];
  for (const it of cat.items) {
    const key = it.tag.toLowerCase();
    if (seen.has(key)) {
      const prev = seen.get(key);
      const extra = prev.aliases.includes(it.tag) ? null : it.tag;
      if (extra) prev.aliases.push(extra);
      continue;
    }
    const unverified = /—$/.test(String(it.freq)) || it.freq === '—' || it.freq === '' || it.freq == null;
    const rec = {
      tag: it.tag,
      zh: it.gloss,
      aliases: it.alias.filter(a => a && a !== '-' && a.toLowerCase() !== key),
      weight: it.weight,
      freq: unverified ? null : it.freq,
      freq_note: unverified ? '未取证：投稿量待验证' : `Danbooru 投稿量 ${it.freq}`,
      confidence: it.confidence || (unverified ? '待验证' : '中'),
      note: it.note === '—' ? '' : it.note,
      source: s(it.src),
    };
    seen.set(key, rec);
    items.push(rec);
  }
  return items;
}

for (const cat of CATEGORIES) {
  built.push({
    id: cat.id,
    name: cat.name,
    order: cat.order,
    group: cat.group,
    intro: cat.intro,
    count: 0,
    sources: cat.sources.map(s),
    items: buildCategory(cat),
  });
}

// 画师类（数据驱动）
const artistCat = {
  id: 'artist', name: '画师（@artist 前缀）', order: 51, group: 'E 风格与题材',
  intro: `Anima 对画师标签响应最强，但**必须加 `+'`@`'+` 前缀**，否则几乎无效（官方规范）。`+
    `本类收录两类数据：①精选 12 位高频画师（含风格说明与权重建议）②完整 59,676 条模型内建画师索引（离线文件 data/Anima2B_Artist_Index_59k.txt，按训练样本量降序）。`+
    `人工混合写法：`+'`(@artist_a:1.2), (@artist_b:0.9)`'+`，单画师建议 1.0–1.2；社区实测混合权重区间 0.8–1.4。`,
  count: 0,
  sources: [s('hf'), s('explorer'), s('moescape'), s('civitaiArt')],
  items: [
    ...CURATED_ARTISTS.map(([name, gloss, weight]) => ({
      tag: `@${name}`,
      zh: gloss,
      aliases: [],
      weight,
      freq: null,
      freq_note: '位于 Artist Index 高位（按训练样本量降序，属最高频段）',
      confidence: '高',
      note: '含空格/括号的画师名照原样写；括号需转义为 `\\(` `\\)` 的场合以 Danbooru 原始写法为准。',
      source: s('explorer'),
    })),
    ...topArtists.slice(12).map(name => ({
      tag: `@${name}`,
      zh: '模型内建画师标签',
      aliases: [],
      weight: '0.8–1.4',
      freq: null,
      freq_note: '来自 59,676 条索引（前 300 高频段）',
      confidence: '高',
      note: '高频段画师，风格需实际出图验证',
      source: s('explorer'),
    })),
  ],
};
built.push(artistCat);

/* ---------- 类目层序：官方推荐顺序 ---------- */
const PLAN = [
  'quality', 'meta-dataset', 'era', 'safety', 'count', 'character', 'series',
  'character-all', 'series-all',
  'hair-color', 'hair-style', 'tg-hair', 'tg-hair-color', 'tg-hair-styles',
  'eyes', 'tg-eyes', 'tg-eyebrow-eyes', 'face', 'expression', 'tg-face', 'tg-ears',
  'tg-body-parts', 'tg-skin', 'tg-makeup',
  'attire', 'uniform', 'traditional', 'attire-detail', 'clothing-sets',
  'tg-attire', 'tg-legwear', 'tg-headwear', 'tg-handwear', 'tg-sleeves',
  'tg-neck', 'tg-eyewear', 'tg-fashion', 'accessory', 'tg-accessories',
  'pose', 'tg-posture', 'tg-gestures', 'tg-hands', 'tg-holding', 'tg-verbs', 'tg-dances',
  'composition', 'tg-composition', 'tg-focus', 'lighting', 'tg-lighting-full',
  'background', 'tg-backgrounds', 'tg-locations', 'tg-locations-real',
  'background-sets', 'pose-sets', 'tg-theme', 'tg-flowers',
  'color', 'tg-colors-full', 'tg-subjective', 'tg-phrases', 'tg-aesthetic', 'style',
  'artist', 'artist-ranked',
  'tg-food', 'tg-technology', 'tg-water', 'tg-fire', 'tg-creatures',
  'tg-cats', 'tg-dogs', 'tg-birds', 'tg-sports', 'tg-jobs', 'tg-holidays',
  'tg-companies', 'tg-patterns', 'tg-prints', 'tg-symbols', 'tg-text',
  'tg-metatags', 'tg-year', 'tg-audio',
  'negative', 'tg-censorship',
];
const _byId = new Map(built.map(c => [c.id, c]));
const _order = [...PLAN.filter(id => _byId.has(id)), ...built.map(c => c.id).filter(id => !PLAN.includes(id))];
_order.forEach((id, i) => { _byId.get(id).order = (i + 1) * 10; });

built.sort((a, b) => a.order - b.order);
for (const c of built) c.count = c.items.length;

const total = built.reduce((n, c) => n + c.count, 0);
const withFreq = built.reduce((n, c) => n + c.items.filter(i => i.freq).length, 0);

const kb = {
  meta: {
    name: 'Anima 标签本地知识库',
    model: 'Anima 2B (CircleStone Labs × Comfy Org)',
    model_knowledge_cutoff: '2025-09',
    built_at: TODAY,
    retrieval_date: TODAY,
    total_tags: total,
    total_categories: built.length,
    tags_with_verified_frequency: withFreq,
    artist_index_count: allArtists.length,
    attire_dataset_count: 964,
    conventions: [
      '标签一律小写；空格即分词（Danbooru 的下划线在 Anima 里写空格）',
      '唯一保留下划线的标签族：score_1 … score_9',
      '画师必须加 @ 前缀：@dairi',
      '推荐顺序：[质量/元信息/年份/安全档] [人数] [角色] [作品] [画师] [外观动作] [构图光影场景]',
      '数据集标签 ye-pop / deviantart 必须置于提示词最行首并单独换行',
      '权重写法同 SDXL：(tag:1.3)；Anima 需要比 SDXL 更重的权重才能压制默认风格',
      '权威写法以 Gelbooru 标签为准，训练含随机 tag dropout，不必把所有标签堆满',
    ],
    global_sources: Object.entries(SRC).map(([k, v]) => ({ id: k, label: v[0], url: v[1] })),
  },
  categories: built,
};

fs.mkdirSync(path.join(ROOT, 'categories'), { recursive: true });
// 清掉上一轮遗留的 md（类目增删后文件名会变，否则会留下孤儿文件）
for (const f of fs.readdirSync(path.join(ROOT, 'categories'))) {
  if (f.endsWith('.md')) fs.unlinkSync(path.join(ROOT, 'categories', f));
}

/* ---------- 缩略图占位（真实图片缺失时才生成），需在写 tags.json 之前完成 ---------- */
const THUMBS = path.join(ROOT, 'thumbs');
fs.mkdirSync(THUMBS, { recursive: true });
let thumbCount = 0;
for (const c of built) {
  for (const it of c.items) {
    if (it.img) continue; // 数据集预览图 / Danbooru 检索链接优先
    it.placeholder = `t${hash(c.id + '::' + it.tag).toString(36)}.svg`;
    fs.writeFileSync(path.join(THUMBS, it.placeholder), thumbSvg(it.tag, c.id), 'utf8');
    thumbCount++;
  }
}

fs.writeFileSync(path.join(ROOT, 'tags.json'), JSON.stringify(kb, null, 2), 'utf8');

/* ---------- 按大分类分包（画师类/），供展览版按需加载 ---------- */
const SPLIT_DIR = path.join(ROOT, '画师类');
const TAGS_DIR = path.join(SPLIT_DIR, 'tags');
fs.mkdirSync(TAGS_DIR, { recursive: true });
// 只清掉上一轮生成的 json；README.md 及手工放入的其他文件一律保留
for (const d of [SPLIT_DIR, TAGS_DIR]) {
  for (const f of fs.readdirSync(d)) {
    if (f.endsWith('.json')) {
      const p = path.join(d, f);
      if (fs.statSync(p).isFile()) fs.rmSync(p, { force: true });
    }
  }
}
const SHORT = { tag: 0, zh: 1, weight: 2, freq: 3, confidence: 4, aliases: 5, note: 6, slot: 7, img: 8, placeholder: 9, source: 10, srcKey: 11 };
function packItem(it) {
  const r = [];
  r[SHORT.tag] = it.tag;
  r[SHORT.zh] = it.zh || '';
  r[SHORT.weight] = it.weight || '';
  if (it.freq) r[SHORT.freq] = it.freq;
  if (it.confidence) r[SHORT.confidence] = it.confidence;
  if (it.aliases && it.aliases.length) r[SHORT.aliases] = it.aliases;
  if (it.note) r[SHORT.note] = it.note;
  if (it.slot) r[SHORT.slot] = it.slot;
  if (it.img) r[SHORT.img] = it.img;
  if (it.placeholder) r[SHORT.placeholder] = it.placeholder;
  if (it.source) { r[SHORT.source] = it.source.label; r[SHORT.srcKey] = it.source.url; }
  return r;
}
const searchIdx = [];
const manifestCats = built.map(c=>{
  const file = `${String(c.order).padStart(3, '0')}-${c.id}.json`;
  c.items.forEach((it, i)=>{
    searchIdx.push([it.tag, c.id, c.order, it.zh || '', (it.aliases || []).join('|'), it.weight || '',
      it.freq || '', it.confidence || '', file, c.name, it.slot || '']);
  });
  fs.writeFileSync(path.join(TAGS_DIR, file), JSON.stringify({
    id: c.id, name: c.name, order: c.order, group: c.group, intro: c.intro,
    count: c.items.length, sources: c.sources, slots: c.slots ? Object.keys(c.slots) : undefined,
    items: c.items.map(packItem),
  }), 'utf8');
  return { id: c.id, name: c.name, order: c.order, group: c.group, count: c.items.length,
    intro: c.intro, sources: c.sources, file: `tags/${file}` };
});
fs.writeFileSync(path.join(SPLIT_DIR, 'manifest.json'), JSON.stringify({
  built_at: TODAY,
  meta: Object.assign({}, kb.meta, { total_tags: total, total_categories: built.length }),
  convention: { fields: ['tag', 'zh', 'weight', 'freq', 'confidence', 'aliases', 'note', 'slot', 'img', 'placeholder', 'source', 'sourceUrl'], shared: ['placeholder 指向 ../thumbs/<file>，img 为外链预览图'] },
  categories: manifestCats,
}, null, 2), 'utf8');
fs.writeFileSync(path.join(SPLIT_DIR, 'search-index.json'), JSON.stringify({
  fields: ['tag', 'cat', 'order', 'zh', 'aliases', 'weight', 'freq', 'confidence', 'file', 'catName', 'slot'],
  count: searchIdx.length,
  rows: searchIdx,
}), 'utf8');
// 画师类/README.md —— 说明这份分包数据怎么用、怎么改
fs.writeFileSync(path.join(SPLIT_DIR, 'README.md'), [
  '# 画师类 —— 展览版的分包数据',
  '',
  `> 构建日期：**${TODAY}** ｜ ${total} 条标签 / ${built.length} 个类别 ｜ 本目录由 \`node scripts/build-kb.mjs\` 自动生成（README 会被保留，json 每次重建）`,
  '',
  '## 这是什么',
  '',
  '把知识库的 2 万多条标签按大分类拆成小文件，让 `anima-tag-exhibition.html` **打开时只拉一个 77 KB 的清单**，其余按需并发加载（最多 6 个请求），而不是一次读 14.8 MB 的 `tags.json`。',
  '',
  '## 文件结构',
  '',
  '```',
  '画师类/',
  '├── README.md             ← 本文件（构建时保留，不会被清掉）',
  '├── manifest.json         ← 77 KB：meta（标签总数/类别数/画师索引数/检索日期）+ 字段约定 + 87 个类目清单',
  '├── search-index.json     ← 4.2 MB：22863 行扁平检索索引（精准搜索 + Fuse 模糊搜索都读它）',
  '└── tags/',
  '    ├── 010-quality.json  ← 命名规则：<三位 order>-<类别 id>.json，与 manifest.categories[].file 对应',
  '    └── …共 87 个文件',
  '```',
  '',
  '## 字段约定',
  '',
  '- `manifest.json`：`built_at`、`meta`、`convention.fields`、`categories[]`（每项含 `id / name / order / group / count / intro / sources / file`）。',
  '- `tags/<file>.json`：`{ id, name, order, group, intro, count, sources, slots?, items[] }`。',
  '- `items[]` 是**压缩后的稀疏数组**（不是对象），下标含义见 `manifest.convention.fields`：',
  '',
  '  | 下标 | 字段 | 说明 |',
  '  | --- | --- | --- |',
  '  | 0 | tag | 标签原文（小写、下划线换空格，画师带 `@`） |',
  '  | 1 | zh | 中文释义 |',
  '  | 2 | weight | 推荐权重区间，如 `1.0-1.4` |',
  '  | 3 | freq | Danbooru 真实投稿量（仅取证过的填） |',
  '  | 4 | confidence | 置信度：高 / 中 / 待验证 |',
  '  | 5 | aliases | 别名数组 |',
  '  | 6 | note | 备注 |',
  '  | 7 | slot | 子槽位（服装/姿势等成套标签用） |',
  '  | 8 | img | 外链预览图 |',
  '  | 9 | placeholder | 本地 SVG 占位图路径 |',
  '  | 10 | source | 来源名称 |',
  '  | 11 | srcKey | 来源链接 |',
  '',
  '- `search-index.json`：`fields` + `rows[]`，每行 `[tag, cat, order, zh, aliases(用 | 连接), weight, freq, confidence, file, catName, slot]`。',
  '',
  '## 怎么用',
  '',
  '```bash',
  '# 起静态服务器（必须用 http 打开，file:// 下 fetch 会被浏览器拦）',
  'cd anima-tag-kb && npx --yes serve . -l 8100',
  '# 然后浏览器访问 http://localhost:8100/anima-tag-exhibition.html',
  '```',
  '',
  '想在别处读数据：直接 `fetch("画师类/manifest.json")` 拿清单，再按 `file` 字段取各类；或 `fetch("画师类/search-index.json")` 一次性拿到全部标签的扁平索引。',
  '注意目录名是中文，URL 里会编码成 `%E7%94%BB%E5%B8%88%E7%B1%BB`，浏览器地址栏看着乱但能正常工作。',
  '',
  '## 怎么更新',
  '',
  '1. **不要手改这个目录里的 json** —— 下次构建会被覆盖。',
  '2. 要改数据：动 `scripts/build-kb.mjs`（`CATEGORIES` / `W` / `SOURCE`）或 `scripts/datasets.mjs`，然后跑 `node scripts/build-kb.mjs`。',
  '3. 要改界面：编辑 `viewer/template.html`，再跑构建（会自动复制成 `anima-tag-exhibition.html`）。',
  '4. 构建只删本目录的 `*.json` 与 `tags/*.json`，**README.md 与你自己放的任何非 json 文件都会被保留**。',
  '',
].join('\n'), 'utf8');
// 扁平检索索引
const lines = [];
for (const c of built) {
  for (const it of c.items) {
    lines.push(JSON.stringify({
      tag: it.tag, zh: it.zh, cat: c.id, catName: c.name, weight: it.weight,
      freq: it.freq, confidence: it.confidence, aliases: it.aliases, source: it.source.url,
      ...(it.slot ? { subgroup: it.slot } : {}),
    }));
  }
}
fs.writeFileSync(path.join(ROOT, 'tags-index.jsonl'), lines.join('\n') + '\n', 'utf8');
fs.writeFileSync(path.join(ROOT, 'data', 'artist-index.json'), JSON.stringify({ count: allArtists.length, artists: allArtists }, null, 0), 'utf8');

/* ---------- 每类别 md ---------- */
for (const c of built) {
  const md = [
    `# ${c.name}`,
    '',
    `> 类别 ID：\`${c.id}\` ｜ 分组：${c.group} ｜ 条目：${c.count} ｜ 检索日期：${TODAY}`,
    '',
    c.intro,
    '',
    ...(c.subgroups && c.subgroups.length
      ? ['## 子槽位', '', ...c.subgroups.map(sg => `- ${sg.name}：${sg.count} 条`), '']
      : []),
    '## 标签清单',
    '',
    '| 标签 | 中文释义 | 别名 | 推荐权重 | 频次 | 置信度 | 说明 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...c.items.map(i => `| \`${i.tag}\` | ${i.zh} | ${i.aliases.map(a => '`' + a + '`').join(' ') || '—'} | ${i.weight} | ${i.freq ? i.freq : '待验证'} | ${i.confidence} | ${i.note || '—'} |`),
    '',
    '## 来源',
    '',
    ...c.sources.map(x => `- [${x.label}](${x.url})`),
    '',
    `> 检索日期：${TODAY}；未取证项一律标注「待验证」，不作推测填充。`,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(ROOT, 'categories', `${String(c.order).padStart(2, '0')}-${c.id}.md`), md, 'utf8');
}

fs.writeFileSync(path.join(ROOT, 'data', 'kb-summary.json'), JSON.stringify({
  built_at: TODAY, total_tags: total, total_categories: built.length, tags_with_verified_frequency: withFreq,
  per_category: built.map(c => ({ id: c.id, name: c.name, count: c.count })),
  artist_index: allArtists.length,
}, null, 2), 'utf8');

/* ---------- 带图悬浮窗展览版 ---------- */
function thumbSvg(tag, catId) {
  const h = hash(tag);
  const hue = h % 360, hue2 = (hue + 42) % 360;
  const label = tag.length > 22 ? tag.slice(0, 21) + '…' : tag;
  const initial = escXml(tag.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || 'AI');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" width="320" height="200">
<defs>
<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="hsl(${hue} 62% 26%)"/><stop offset="1" stop-color="hsl(${hue2} 66% 13%)"/>
</linearGradient>
<pattern id="p" width="20" height="20" patternUnits="userSpaceOnUse">
<path d="M20 0H0V20" fill="none" stroke="hsl(${hue} 70% 70% / .10)" stroke-width="1"/>
</pattern>
</defs>
<rect width="320" height="200" fill="url(#g)"/><rect width="320" height="200" fill="url(#p)"/>
<circle cx="268" cy="42" r="34" fill="hsl(${hue} 80% 65% / .18)"/>
<text x="24" y="94" font-family="Georgia,serif" font-size="58" fill="hsl(${hue} 80% 84% / .22)">${initial}</text>
<text x="24" y="166" font-family="ui-monospace,Consolas,monospace" font-size="17" fill="#ffffff">${escXml(label)}</text>
<text x="24" y="186" font-family="ui-monospace,Consolas,monospace" font-size="10" fill="hsl(${hue} 70% 82% / .72)" letter-spacing="1.6">IMAGE SLOT · ${escXml(catId)}</text>
</svg>`;
}

const tpl = fs.readFileSync(path.join(ROOT, 'viewer', 'template.html'), 'utf8');
fs.writeFileSync(path.join(ROOT, 'anima-tag-exhibition.html'), tpl, 'utf8');

/* ---------- README ---------- */
const groups = [...new Set(built.map(c => c.group))].sort();
const readme = [
  '# Anima 标签本地知识库',
  '',
  `> 模型：**${kb.meta.model}** ｜ 动漫知识截止：${kb.meta.model_knowledge_cutoff} ｜ 构建与检索日期：**${kb.meta.retrieval_date}**`,
  `> 规模：**${total} 条策展标签 / ${built.length} 个类别** ｜ **${allArtists.length.toLocaleString()} 条模型内建画师索引** ｜ 服装槽位表 964 条 ｜ 已取证真实频次 ${withFreq} 条`,
  '',
  '## 1. 这是什么',
  '',
  '把 Anima（CircleStone Labs × Comfy Org，2B 动漫文生图模型）的提示词标签整理成可检索、可复用、来源可溯的本地知识库。',
  '每条标签都带：中文释义、别名、推荐权重区间、频次（有据才填）、置信度、来源链接。**凡未取证的字段一律标「待验证」，不做推测填充。**',
  '',
  '## 2. 目录结构',
  '',
  '```',
  'anima-tag-kb/',
  '├── README.md                     ← 本文件：分类总览与检索说明',
  '├── tags.json                     ← 主数据（按类别嵌套，含 meta / categories；完整但不参与网页加载）',
  '├── tags-index.jsonl              ← 扁平检索索引（每行一条标签，便于 grep / 向量化）',
  '├── anima-tag-exhibition.html     ← 带图悬浮窗展览版（本地服务器打开）',
  '├── 画师类/                       ← 展览版实际读取的分包数据（manifest + tags/*.json + 检索索引，详见 画师类/README.md）',
  '│   ├── manifest.json             ← 77 KB，meta + 字段约定 + 87 个类目的清单（含各自文件名）',
  '│   ├── search-index.json         ← 4.2 MB，22863 行扁平检索索引（供精准/模糊两种搜索用）',
  '│   └── tags/                     ← 87 个文件，命名 <三位序号>-<类别id>.json，如 010-quality.json',
  '├── vendor/',
  '│   └── fuse.min.js               ← Fuse.js 7.0.0（23.8 KB，离线自包含，模糊搜索用）',
  '├── categories/                   ← 每类别独立 md（可单独查阅）',
  '├── thumbs/                       ← 展览版缩略图占位（SVG，可替换为真实出图）',
  '├── data/                         ← 已取证原始数据',
  '│   ├── Anima2B_Artist_Index_59k.txt    （59,676 条画师索引）',
  '│   ├── data.js                         （40,600 条画师，含 Danbooru 真实投稿量与 uniqueness_score）',
  '│   ├── character_official_data.json    （7,999 组「角色||作品」→ 触发串 + 完整标签串）',
  '│   ├── character_data.js               （角色元数据：性别/发色/瞳色/投稿量）',
  '│   ├── background_data.js              （1,057+ 背景方案，含 CDN 预览图）',
  '│   ├── pose_data.js                    （297 姿势方案，含 CDN 预览图）',
  '│   ├── clothing_data.json              （430 服装方案，含 CDN 预览图）',
  '│   ├── danbooru_attire_data.json       （964 条服装槽位表）',
  '│   ├── taggroups-html/                 （Danbooru 56 个 tag_group 页原始 HTML）',
  '│   ├── tag-groups.json                 （从上述 HTML 抽取的 11,294 条官方分组标签）',
  '│   └── kb-summary.json                 （构建摘要）',
  '└── scripts/',
  '    ├── build-kb.mjs              ← 主生成器：数据一改，全部产物重建',
  '    ├── serve-kb.mjs              ← 零依赖本地静态服务（配合「启动展览板.cmd」使用）',
  '    ├── datasets.mjs              ← 数据驱动类目（角色/作品/画师/背景/姿势/服装/tag_group）',
  '    ├── extract-taggroups.mjs     ← 从 taggroups-html/ 抽标签 → tag-groups.json',
  '    └── ingest-server.mjs         ← 本地落盘接收器（配合真实浏览器抓 Danbooru 用）',
  '```',
  '',
  '根目录另有 `启动展览板.cmd`：双击即起 `scripts/serve-kb.mjs` 并打开浏览器（见第 4 节）。',
  '',
  '### 数据来源优先级（卡片配图）',
  '',
  '- **真实预览图**：`background-sets` / `pose-sets` / `clothing-sets` 使用 AnimaTags-DB、Dressing-doll 仓库的 CDN 图（jsDelivr）；',
  '- **Danbooru 直达检索**：`character-all` / `series-all` / `artist-ranked` 条目的 `img` 字段指向 `danbooru.donmai.us/posts?tags=...`；',
  '- **本地占位图**：其余标签使用构建时生成的 SVG（`thumbs/<hash>.svg`），出图后同名替换即可。',
  '',
  '## 3. 分类总览',
  '',
  '| 分组 | 类别 | 条目 | 独立文件 |',
  '| --- | --- | --- | --- |',
  ...built.map(c => `| ${c.group} | ${c.name} | ${c.count} | [categories/${String(c.order).padStart(2, '0')}-${c.id}.md](categories/${String(c.order).padStart(2, '0')}-${c.id}.md) |`),
  '',
  `合计 **${total}** 条。`,
  '',
  '## 4. 检索说明',
  '',
  '1. **按类别查**：打开 `categories/` 下对应 md，表格里有完整字段。',
  '2. **按关键词查**：`grep -i "画师\\|@dairi" tags-index.jsonl`，或直接搜 `tags.json`。',
  '3. **程序化查**：读 `tags.json`，`categories[].items[]` 每项的字段约定为 `tag / zh / aliases / weight / freq / freq_note / confidence / note / source{label,url}`。',
  '4. **展览版**：必须用本地小服务打开（**不要直接双击 HTML**，`file://` 下浏览器会拦掉数据加载）。二选一：',
  '   ```bash',
  '   # 最简单：双击知识库根目录的「启动展览板.cmd」（自动起服务 + 打开浏览器）',
  '   # 或者手动：',
  '   cd anima-tag-kb && node scripts/serve-kb.mjs          # 零依赖，默认 8100',
  '   # 浏览器打开 http://127.0.0.1:8100/anima-tag-exhibition.html',
  '   ```',
  '   - **分类优先浏览**：页面上方是一条分类条（A–L 分组 + 87 个分类 + 最左的「★ 收藏」）。点某个分类就**只显示那个分类的标签**；「全部分类」是总览模式，每个分类先只铺前 48 条，滚到哪个分类才载入哪个，想看完点分类条或卡片区的「查看这个分类全部 N 条」。',
  '   - **点标签名 = 加入已选 + 立即复制**：鼠标点卡片上的英文标签名，会加进底部常驻「已选」托盘并马上写剪贴板，标签名上方弹一下「已复制」提示（借鉴 `star-abyss/ai-tag-toolbox` 的手感）。',
  '   - **逐个删除 / 一键清空**：托盘里每个标签带独立 `×` 可单独删除；卡片右上角 `+`/`×` 也是加入/移出；顶部「一键清空」清空全部已选。',
  '   - **收藏夹**：卡片右上角 `☆` 收藏常用标签（例如固定画师、常用质量词），点分类条最左的「★ 收藏」只看收藏。已选与收藏都存在浏览器 `localStorage`（键：`animaKB.sel` / `animaKB.fav` / `animaKB.cat` / `animaKB.showImg`），换浏览器或清缓存会丢，但 `画师类/` 数据不受影响。',
  '   - **悬浮检视窗**：鼠标停在卡片上显示中文释义 / 推荐权重 / Danbooru 频次 / 别名 / 置信度 / 来源链接，并可直接「加入已选 / 收藏 / 复制标签」。',
  '   - **提示词装配台**（顶部「装配台」按钮或 `Ctrl/Cmd+B`）：按官方顺序分层（质量/元信息 → 人数 → 角色 → 作品 → 画师 → 外观动作 → 构图光影场景），自动补官方正向前缀并过滤重复，可复制整串；托盘另有「复制已选标签 / 复制这串 / 导出 txt」。',
  '   - **性能约束**：单类视图每类先渲染 240 张卡片，点「加载更多」每次追加 480 张；「全部分类」总览每类只先 48 张（`OV_CHUNK`），靠 `IntersectionObserver` 滚到附近才拉分包；分包按需拉取，并发上限 6。卡片配图按「数据集真实预览图 → 本地 SVG 占位图」优先级取值，可在顶部用「缩略图：开/关」切换。',
  '   - **数据加载方式**：页面不再一次性加载 14.8 MB 的 `tags.json`，而是先读 `画师类/manifest.json`（77 KB）建骨架，再按需并发（最多 6 个）拉 `画师类/tags/*.json`；因此打开即用。',
  '   - **搜索栏右侧的「精准搜索 / 模糊搜索」下拉**：',
  '     - **精准搜索**（默认）：对标签名 / 中文释义 / 别名做子串匹配，结果按「匹配位置」排序，标签名命中优先；查规则类标签（`score_7`）、画师（`@dairi`）、中文词（`和服`）用这个，结果**准确、无噪声**。',
  '     - **模糊搜索**：Fuse.js（`vendor/fuse.min.js`，离线自包含）+ 自研字面相似度过滤，容忍拼写误差（`masterpice` → `masterpiece`）并按**匹配度**排序；多词查询（如 `blue eyes`）要求每个词都出现在标签名里，避免把无关角色带出来。',
  '     - 命中卡片右上角会显示 `匹配度 0.9x` 小标；结果按原分类分组，每组显示命中数，可点「加载更多」继续加载（每类先 120 条、每次追加 300 条），也可「复制命中标签」整组复制；搜索时分类条自动隐藏，清空搜索框即回到分类浏览。',
  '   - 快捷键：`/` 或 `Ctrl/Cmd+K` 聚焦搜索框，`Enter` 立即搜，`Esc` 清空搜索框并回到分类浏览（悬浮窗也一起关），`Ctrl/Cmd+B` 开关装配台；顶部 `全部分组` 下拉可按 A–L 分组过滤。',
  '',
  '## 5. 官方硬规范（写提示词前必读）',
  '',
  ...kb.meta.conventions.map(x => `- ${x}`),
  '',
  '官方正向前缀：`masterpiece, best quality, score_7, safe, `',
  '',
  '官方负向词：`worst quality, low quality, score_1, score_2, score_3, artist name, blurry, jpeg artifacts, chromatic aberration`',
  '',
  '参数：Base/Aesthetic 建议 30–50 步、CFG 4–5；Turbo CFG 1、8–12 步；分辨率 512²–1536²。',
  '',
  '## 6. 数据来源与取证状态',
  '',
  '| 来源 | 用途 | 链接 |',
  '| --- | --- | --- |',
  ...kb.meta.global_sources.map(x => `| ${x.label} | — | ${x.url} |`),
  '',
  `> 检索日期：${TODAY}。未取证项：Civitai 文章 30800（登录墙）、Reddit（403）——本库未引用其内容。`,
  '',
  '## 7. 如何扩充',
  '',
  '1. **加人工策展标签**：在 `scripts/build-kb.mjs` 的 `CATEGORIES` 里加条目（构造器 `T(tag, 释义, 别名, 权重, 频次, 备注, 来源key)`）；',
  '2. **加数据驱动类目**：把数据集放进 `data/`，在 `scripts/datasets.mjs` 的 `TG_PLAN`（官方分组）或 `buildDatasetCategories`（角色/作品/画师/背景/姿势/服装）里声明；',
  '3. **补 Danbooru 官方分组**：Danbooru 会封 Node/PowerShell 直连（403），须用真实浏览器取页面后经 `ingest-server.mjs` 落盘到 `data/taggroups-html/`，再跑 `node scripts/extract-taggroups.mjs`；',
  '4. **补真实频次**：拿到投稿量后填进条目的 `freq` 字段，置信度会从「待验证」自动转为「中」；',
  '5. 重新运行 `node scripts/build-kb.mjs`，全部产物（json / jsonl / md / 展览版 / 缩略图 / `画师类/` 分包 / README）一次重建。',
  '',
  '### 更新与维护约定',
  '',
  '- **改数据**：只动 `scripts/` 下的表（`build-kb.mjs` 的 `CATEGORIES` / `W` / `SOURCE`，`datasets.mjs` 的 `TG_PLAN` / `buildDatasetCategories`），然后 `node scripts/build-kb.mjs`；**不要手改生成物**（`画师类/`、`tags.json`、`categories/`、`anima-tag-exhibition.html` 都会在下次构建时被覆盖）。',
  '- **改界面**：编辑 `viewer/template.html`（唯一界面源文件），再跑构建；构建脚本会把它复制成 `anima-tag-exhibition.html`。',
  '- **构建前清空**：`画师类/` 与 `画师类/tags/` 里的 `*.json`、以及 `categories/` 都会先清掉再写，避免旧类别残留（曾出现 172 个文件残留）；`画师类/README.md` 与手工放入的其他文件会被保留。',
  '- **只重出网页**：`node scripts/build-kb.mjs` 是幂等的全量重建，一次约十几秒，直接跑即可。',
  '- **看板数据**：`画师类/manifest.json` 的 `meta` 里带标签总数 / 类别数 / 画师索引数 / 已取证频次 / 检索日期，页面顶部那行统计读的就是它。',
  '',
].join('\n');
fs.writeFileSync(path.join(ROOT, 'README.md'), readme, 'utf8');

console.log(JSON.stringify({
  ok: true, total_tags: total, categories: built.length, tags_with_verified_frequency: withFreq,
  artist_index: allArtists.length, thumbnails: thumbCount,
  per_category: built.map(c => `${c.id}:${c.count}`),
}, null, 2));

