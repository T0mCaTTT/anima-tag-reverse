/* 生成「日/夜主题切换」Lottie 动画（assets/theme-toggle.json）
   零依赖：直接按 Lottie(Bodymovin) v5 结构写 JSON。
   运行：node scripts/make-theme-lottie.mjs
   设计参数与页面令牌一致：太阳 #FBBF24(--warn)、月亮 #22D3EE(--ac2)、画布 48×48、30fps、60 帧。

   两个必须遵守的 Lottie 结构约定（踩过的坑）：
   1) 形状的 i / o（入切线、出切线）必须与 v 逐点等长，直线段用 [0,0] 占位；
      否则播放器报 "Cannot create property '0' on number '0'"。
   2) shape 图层要把 anchor 与 position 都设成形状自身中心（a = p），旋转/缩放才会绕中心进行。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'assets', 'theme-toggle.json');

const W = 48, H = 48, FPS = 30, DUR = 60;      // 60 帧 = 2s 一次完整往返
const SUN = [0.984, 0.749, 0.141, 1];          // #FBBF24
const MOON = [0.133, 0.827, 0.933, 1];         // #22D3EE
const CX = 24, CY = 24;

const R = (n) => Math.round(n * 1000) / 1000;

/* 8 角星形（太阳光芒）：外半径/内半径交替取点，闭合成一条路径 */
function starPath(cx, cy, outer, inner, points = 8, rot = -Math.PI / 2){
  const v = [];
  for (let k = 0; k < points * 2; k++){
    const a = rot + k * Math.PI / points;
    const r = k % 2 === 0 ? outer : inner;
    v.push([R(cx + Math.cos(a) * r), R(cy + Math.sin(a) * r)]);
  }
  return { i: v.map(() => [0, 0]), o: v.map(() => [0, 0]), v, c: true };
}
/* 正圆（四段三次贝塞尔，kappa 近似），用于太阳核心 / 月亮本体 / 月面陨石坑 */
function circlePath(cx, cy, r){
  const k = 0.5523 * r;
  const v = [[cx, cy - r], [cx + r, cy], [cx, cy + r], [cx - r, cy]].map(p => [R(p[0]), R(p[1])]);
  const o = [[k, 0], [0, k], [-k, 0], [0, -k]].map(p => [R(p[0]), R(p[1])]);
  const i = [[-k, 0], [0, -k], [k, 0], [0, k]].map(p => [R(p[0]), R(p[1])]);
  return { i, o, v, c: true };
}
function shapeGroup(name, pathData, color){
  return {
    ty: 'gr', nm: name, np: pathData.v.length,
    it: [
      { ty: 'sh', nm: name + ' path', ks: { a: 0, k: pathData } },
      { ty: 'fl', nm: name + ' fill', c: { a: 0, k: color }, o: { a: 0, k: 100 }, r: 1 },
      { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } }
    ]
  };
}
/* 关键帧助手：缓动数值动画 */
const anim = (keys, ease = 'ease') => ({
  a: 1,
  k: keys.map(([t, v], idx) => {
    const isLast = idx === keys.length - 1;
    const kf = {
      t, s: Array.isArray(v) ? v : [v],
      i: ease === 'ease' ? { x: [0.4], y: [1] } : { x: [1], y: [1] },
      o: ease === 'ease' ? { x: [0.4], y: [0] } : { x: [0], y: [0] }
    };
    if (isLast){ delete kf.i; delete kf.o; }
    return kf;
  })
});
/* 图层变换：anchor 与 position 同点，旋转/缩放绕形状自身中心 */
const tf = (cx, cy) => ({ a: { a: 0, k: [cx, cy, 0] }, p: { a: 0, k: [cx, cy, 0] } });

const layers = [];

/* 1) 太阳光芒：旋转 + 缩放 + 淡出（帧 0 → 18） */
layers.push({
  ddd: 0, ind: 1, ty: 4, nm: 'sun-rays', sr: 1,
  ks: Object.assign(tf(CX, CY), {
    o: anim([[8, 100], [18, 0]]),
    r: anim([[0, 0], [18, 150]]),
    s: anim([[0, [100, 100, 100]], [18, [20, 20, 100]]])
  }),
  ao: 0,
  shapes: [shapeGroup('rays', starPath(CX, CY, 15.5, 9.5), SUN)],
  ip: 0, op: 20, st: 0, bm: 0
});

/* 2) 太阳核心：缩小淡出 */
layers.push({
  ddd: 0, ind: 2, ty: 4, nm: 'sun-core', sr: 1,
  ks: Object.assign(tf(CX, CY), {
    o: anim([[6, 100], [20, 0]]),
    r: { a: 0, k: 0 },
    s: anim([[0, [100, 100, 100]], [20, [55, 55, 100]]])
  }),
  ao: 0,
  shapes: [shapeGroup('core', circlePath(CX, CY, 8.4), SUN)],
  ip: 0, op: 24, st: 0, bm: 0
});

/* 3) 月亮本体 + 陨石坑：带一点回弹地放大进入（帧 12 → 26），中段保持，末段退出 */
layers.push({
  ddd: 0, ind: 3, ty: 4, nm: 'moon', sr: 1,
  ks: Object.assign(tf(CX, CY), {
    o: anim([[12, 0], [20, 100], [42, 100], [50, 0]], 'linear'),
    r: anim([[12, -35], [26, 0]]),
    s: anim([[12, [35, 35, 100]], [22, [104, 104, 100]], [26, [100, 100, 100]], [42, [100, 100, 100]], [50, [30, 30, 100]]])
  }),
  ao: 0,
  shapes: [
    shapeGroup('moon-disc', circlePath(CX, CY, 9.6), MOON),
    shapeGroup('crater-a', circlePath(CX - 3.4, CY - 3.2, 1.7), [1, 1, 1, 0.22]),
    shapeGroup('crater-b', circlePath(CX + 2.6, CY + 2.4, 2.3), [1, 1, 1, 0.18])
  ],
  ip: 12, op: 52, st: 0, bm: 0
});

/* 4) 小星光：月亮出现时闪一下 */
layers.push({
  ddd: 0, ind: 4, ty: 4, nm: 'sparkle', sr: 1,
  ks: Object.assign(tf(CX + 11.5, CY - 9.5), {
    o: anim([[18, 0], [24, 100], [32, 0]], 'linear'),
    r: { a: 0, k: 0 },
    s: anim([[18, [40, 40, 100]], [26, [100, 100, 100]]])
  }),
  ao: 0,
  shapes: [shapeGroup('sparkle', starPath(CX + 11.5, CY - 9.5, 3.6, 1.1, 4), [1, 1, 1, 0.9])],
  ip: 18, op: 34, st: 0, bm: 0
});

const lottie = {
  v: '5.7.1', fr: FPS, ip: 0, op: DUR, w: W, h: H, nm: 'Anima 标签工作台 · 主题切换', ddd: 0, assets: [], layers,
  markers: [
    { tm: 0, cm: 'sun to moon', dr: 30 },
    { tm: 30, cm: 'moon to sun (reverse)', dr: 30 }
  ]
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(lottie));
console.log('已写出 ' + path.relative(path.join(__dirname, '..'), OUT) + '：' + fs.statSync(OUT).size + ' B，图层 ' + layers.length + ' 个 / ' + DUR + ' 帧 @' + FPS + 'fps');
