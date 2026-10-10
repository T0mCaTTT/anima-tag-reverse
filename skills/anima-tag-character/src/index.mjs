/**
 * index.mjs —— 门面 API
 *
 *   loadKb(opts)                       加载词库并建索引（进程内缓存）
 *   kbInfo(opts)                       词库概况（角色/作品条数、归属覆盖、角色最多的作品）
 *   resolveCharacter(name, {series})   「作品 + 角色名」→ 精确 Danbooru 角色标签（含消歧与候选）
 *   resolveSeries(name)                作品名 → 作品标签
 *   charactersOf(series)               某作品下的角色清单（消歧用：让用户挑）
 *   verifyTag(tag)                     校验候选标签是否存在、属于谁（冷门角色的兜底）
 *   searchNames(query)                 通用名称检索（角色 + 作品）
 *   buildPair(name, {series})          直接产出可交付的「角色 tag + 作品 tag」
 *   patchSpec(spec)                    把观察 JSON 里的中文角色/作品就地换成正确标签
 *   toTag(name)                        名称归一成 Anima 规范标签（空格代替下划线，括号不转义）
 *
 * 分工：**脚本负责事实**（词库里有什么、属于谁、置信度多少），
 * **会话里的我负责世界知识**（库里没有的冷门角色给罗马音候选），两者用 verifyTag 对接。
 */
import { loadKb, kbInfo, resolveKbDir } from './kb.mjs';
import { resolveCharacter, resolveSeries, charactersOf, verifyTag, searchNames, toTagPair } from './resolve.mjs';
import { patchSpec, buildPair } from './patch.mjs';
import { normalizeName, keyOf, toTag, splitParen, parseFreq } from './normalize.mjs';
import { renderResolve, renderVerify, renderSeries, renderSearch, renderInfo, renderPatch } from './render.mjs';

export {
  loadKb, kbInfo, resolveKbDir,
  resolveCharacter, resolveSeries, charactersOf, verifyTag, searchNames, toTagPair,
  patchSpec, buildPair,
  normalizeName, keyOf, toTag, splitParen, parseFreq,
  renderResolve, renderVerify, renderSeries, renderSearch, renderInfo, renderPatch
};

export const VERSION = '1.0.0';
