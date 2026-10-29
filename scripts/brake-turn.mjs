// 邊煞車邊轉向測試：各種車速下，鍵盤按住 S＋A（或先後按）會不會甩尾／打轉
// 用法：node scripts/brake-turn.mjs [standard|expert] [參數覆寫 JSON]
// 輸出：最大甩尾角（車尾往彎外甩出多少度，不含推頭）、胎痕／尖叫聲出現多久（玩家看到的「打滑」）
import { CarPhysics } from '../src/physics.js';
import { CONFIG } from '../src/config.js';
import { LEVELS } from '../src/content.js';
import { clamp } from '../src/util.js';

const LEVEL = process.argv[2] || 'standard';
const OVERRIDE = process.argv[3] ? JSON.parse(process.argv[3]) : {};
const L = LEVELS[LEVEL];
const P = { ...CONFIG.physics, tractionControl: L.tc, abs: L.abs, esc: L.esc, steerAssist: L.keySteerAssist, ...OVERRIDE };
const DT = 1 / 120;
const DEG = 180 / Math.PI;
const F = CONFIG.fx;

// 情境：t 秒時的按鍵（brake 0/1、steer -1/0/1）
const SCENES = {
  '同時按 S＋A': (t) => ({ brake: 1, steer: 1 }),
  '先 S、0.3 秒後加 A': (t) => ({ brake: 1, steer: t > 0.3 ? 1 : 0 }),
  '先 A、0.4 秒後加 S': (t) => ({ brake: t > 0.4 ? 1 : 0, steer: 1 }),
  'S＋A 中途放開 S': (t) => ({ brake: t < 0.8 ? 1 : 0, steer: 1 }),
  'S＋A 左右換': (t) => ({ brake: 1, steer: t < 0.6 ? 1 : -1 }),
};
const SPEEDS = [60, 100, 150, 200, 250, 300];

function run(kmh, scene) {
  const phys = new CarPhysics(P);
  phys.reset();
  phys.vz = kmh / 3.6;
  phys.gear = 8;
  // 先直線穩定一下
  for (let i = 0; i < 30; i++) phys.step(DT, { throttle: 0.3, brake: 0, steer: 0 });
  let maxBeta = 0; // 車尾往彎外甩出的角度（甩尾方向）
  let maxR = 0;
  let skid = 0;
  let skidTime = 0;
  let spun = false;
  for (let t = 0; t < 2.5 && phys.speed > 3; t += DT) {
    const k = scene(t);
    phys.step(DT, { throttle: 0, brake: k.brake, steer: k.steer });
    maxBeta = Math.max(maxBeta, -phys.beta * (Math.sign(phys.r) || 1) * DEG);
    maxR = Math.max(maxR, Math.abs(phys.r) * DEG);
    const s = clamp((Math.max(phys.slipF, phys.slipR) - F.skidThreshold) / 6, 0, 1);
    skid = Math.max(skid, s);
    if (s > 0.15) skidTime += DT;
    if (-phys.beta * (Math.sign(phys.r) || 1) * DEG > 25 || phys.vF < 0) spun = true;
  }
  return { maxBeta, maxR, skid, skidTime, spun };
}

console.log(`【${LEVEL}】ABS ${P.abs ? '開' : '關'}・車身穩定 ${P.esc}・鍵盤轉向輔助 ${P.steerAssist ? '開' : '關'}`);
let spins = 0;
let worst = 0;
for (const [name, scene] of Object.entries(SCENES)) {
  const cells = SPEEDS.map((v) => {
    const r = run(v, scene);
    if (r.spun) spins++;
    worst = Math.max(worst, r.maxBeta);
    return `${v}:${r.spun ? '打轉' : `${r.maxBeta.toFixed(1)}°`}${r.skidTime > 0.05 ? `/胎痕${r.skidTime.toFixed(1)}s` : ''}`;
  });
  console.log(`  ${name.padEnd(14)} ${cells.join('  ')}`);
}
console.log(`打轉 ${spins} 次｜最大甩尾角 ${worst.toFixed(1)}°（車尾往彎外甩出的角度；真實 F1 煞車進彎約 1~3°）`);
