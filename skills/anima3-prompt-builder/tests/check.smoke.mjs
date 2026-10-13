#!/usr/bin/env node
/**
 * check.smoke.mjs —— 校验器回归测试
 * 跑法：node tests/check.smoke.mjs
 */
import { check } from '../bin/check.mjs';

const CASES = [
  {
    name: '合规 · 单人简单档',
    prompt: 'masterpiece, best quality, highres, score_9, @eonsang, 1girl, solo, long blonde hair, green eyes, petite, pale skin, fox ears, white frilled dress, standing, hands up, blush, open mouth, looking at viewer, upper body, simple background, white background',
    ok: true, errContains: [],
  },
  {
    name: '合规 · 双人标准档',
    prompt: 'masterpiece, best quality, highres, score_9, @eonsang, 1girl, 1boy, hetero, blonde hair, green eyes, pale skin, black hair, tall male, white dress, half undressed, missionary, spread legs, faceless male, blush, sweat, open mouth, from above, bedroom, bed, motion lines, group of 2',
    ok: true, errContains: [],
  },
  {
    name: '缺质量词',
    prompt: '1girl, solo, blonde hair, looking at viewer',
    ok: false, errContains: ['质量词'],
  },
  {
    name: '缺画师',
    prompt: 'masterpiece, best quality, highres, 1girl, solo, blonde hair',
    ok: false, errContains: ['画师'],
  },
  {
    name: '禁光效词',
    prompt: 'masterpiece, best quality, highres, score_9, @eonsang, 1girl, solo, blonde hair, backlighting, rim light, warm colors',
    ok: false, errContains: ['灯光禁令'],
  },
  {
    name: '权重语法',
    prompt: 'masterpiece, best quality, highres, score_9, @eonsang, 1girl, (blonde hair:1.2)',
    ok: false, errContains: ['权重'],
  },
  {
    name: '重复标签（含权重写法）',
    prompt: 'masterpiece, best quality, highres, score_9, @eonsang, 1girl, blonde hair, (blonde hair:1.3)',
    ok: false, errContains: ['重复'],
  },
  {
    name: '互斥 · 视角',
    prompt: 'masterpiece, best quality, highres, score_9, @eonsang, 1girl, solo, from above, from below',
    ok: false, errContains: ['互斥'],
  },
  {
    name: '互斥 · 腿部状态',
    prompt: 'masterpiece, best quality, highres, score_9, @eonsang, 1girl, solo, spread legs, legs together',
    ok: false, errContains: ['互斥'],
  },
  {
    name: '互斥 · solo 配 1boy',
    prompt: 'masterpiece, best quality, highres, score_9, @eonsang, 1girl, solo, 1boy, hetero',
    ok: false, errContains: ['人数一致', '互斥'],
  },
  {
    name: '互斥 · 全裸配校服',
    prompt: 'masterpiece, best quality, highres, score_9, @eonsang, 1girl, solo, completely nude, school uniform',
    ok: false, errContains: ['互斥'],
  },
  {
    name: '互斥 · 蒙眼配眼镜',
    prompt: 'masterpiece, best quality, highres, score_9, @eonsang, 1girl, solo, blindfold, glasses',
    ok: false, errContains: ['互斥'],
  },
  {
    name: 'markdown 污染',
    prompt: '```\nmasterpiece, best quality, highres, score_9, @eonsang, 1girl, solo\n```',
    ok: false, errContains: ['输出形式'],
  },
  {
    name: '换行',
    prompt: 'masterpiece, best quality, highres, score_9, @eonsang, 1girl,\nsolo',
    ok: false, errContains: ['行数'],
  },
  {
    name: '大小写警告（不阻断）',
    prompt: 'masterpiece, best quality, highres, score_9, @Eonsang, 1girl, solo, Blonde Hair',
    ok: true, warnContains: ['大小写'],
  },
  {
    name: '标签数超区间（警告）',
    prompt: 'masterpiece, best quality, highres, score_9, @eonsang, 1girl, solo, blonde hair, green eyes',
    ok: true, warnContains: ['标签数'],
  },
  {
    name: '光影白名单 · 四条放行',
    prompt: 'masterpiece, best quality, highres, score_9, @eonsang, 1girl, solo, soft lighting, bloom, bokeh, gradient sky, blue hair, long hair, sitting, blush, looking at viewer, upper body, outdoors, sky, day',
    ok: true, errContains: [],
  },
  {
    name: '光影白名单 · 不连带放行同类词',
    prompt: 'masterpiece, best quality, score_9, @eonsang, 1girl, soft lighting, hard lighting, studio lighting',
    ok: false, errContains: ['灯光禁令'],
  },
  {
    name: 'group sex 人数不足',
    prompt: 'masterpiece, best quality, highres, score_9, @eonsang, 1girl, 1boy, group sex',
    ok: false, errContains: ['group sex'],
  },
];

let pass = 0, fail = 0;
for (const c of CASES) {
  const r = check(c.prompt);
  const probs = [];
  if (r.ok !== c.ok) probs.push(`ok 期望 ${c.ok} 实得 ${r.ok}`);
  for (const kw of c.errContains || []) {
    if (!r.errors.some(e => e.msg.includes(kw) || e.rule.includes(kw))) probs.push(`缺少错误「${kw}」`);
  }
  for (const kw of c.warnContains || []) {
    if (!r.warnings.some(w => w.msg.includes(kw) || w.rule.includes(kw))) probs.push(`缺少警告「${kw}」`);
  }
  if (probs.length) { fail++; console.log(`[失败] ${c.name}：${probs.join('；')}`); }
  else { pass++; console.log(`[通过] ${c.name}`); }
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
