// 完賽測試：用遊戲同一套物理，在 Monza 上自動駕駛一圈，檢查能否完賽、圈速、出界與打轉次數
// 用法：HZ=20 node scripts/lap-test.mjs [bot|rookie|standard] [參數覆寫 JSON]
//   bot     ：示範車（自己判斷煞車點，按鍵最快 0.15 秒切換）
//   rookie  ：模擬真人・新手模式（反應 0.25 秒、按鍵最快 0.25 秒切換、一直踩油門、煞車交給自動煞車）
//   standard：模擬真人・標準模式（同上，但只看地上路線：紅色就踩煞車）
//   HZ：操作判斷頻率（預設 60；預覽面板約 20）
import fs from 'node:fs';
import * as THREE from 'three';
import { CarPhysics } from '../src/physics.js';
import { CONFIG } from '../src/config.js';
import { createGuide, createDriver, brakeAssist, steerAssist, lineKeepAssist } from '../src/autopilot.js';

const MODE = process.argv[2] || 'rookie';
const TRACK = process.env.TRACK || 'Monza'; // assets/source/tracks/ 下的賽道檔名
const OVERRIDE = process.argv[3] ? JSON.parse(process.argv[3]) : {};
const P = { ...CONFIG.physics, ...OVERRIDE };
const T = { ...CONFIG.track, ...(OVERRIDE.track || {}) };
const DEG = Math.PI / 180;

// ---------- 賽道（與 src/track.js 相同的處理） ----------
const raw = fs
  .readFileSync(new URL(`../assets/source/tracks/${TRACK}.csv`, import.meta.url), 'utf8')
  .split('\n')
  .filter((l) => l.trim() && !l.startsWith('#'))
  .map((l) => l.split(',').map(Number));
const curve = new THREE.CatmullRomCurve3(raw.map(([x, y]) => new THREE.Vector3(-x, 0, y)), true, 'centripetal');
curve.arcLengthDivisions = raw.length * 8;
let L = curve.getLength();
const N = Math.round(L / 2);
const Pts = curve.getSpacedPoints(N).slice(0, N);
const n0 = raw.length;
const widthAt = (t, k) => {
  const f = t * n0;
  const i0 = Math.floor(f) % n0;
  return raw[i0][k] + (raw[(i0 + 1) % n0][k] - raw[i0][k]) * (f - Math.floor(f));
};
const smooth = (arr, r) => arr.map((_, i) => {
  let s = 0;
  for (let k = -r; k <= r; k++) s += arr[(i + k + N) % N];
  return s / (2 * r + 1);
});
const WL = smooth(Pts.map((_, i) => widthAt(i / N, 3)), 6).map((w) => w * T.widthScale);
const WR = smooth(Pts.map((_, i) => widthAt(i / N, 2)), 6).map((w) => w * T.widthScale);
const Tan = Pts.map((_, i) => Pts[(i + 1) % N].clone().sub(Pts[(i - 1 + N) % N]).normalize());
const S = new Float64Array(N);
for (let i = 1; i < N; i++) S[i] = S[i - 1] + Pts[i].distanceTo(Pts[i - 1]);
L = S[N - 1] + Pts[N - 1].distanceTo(Pts[0]); // 全長與 S 一致
// 曲率（帶號）
const K = Pts.map((_, i) => {
  const a = Tan[(i - 4 + N) % N];
  const b = Tan[(i + 4) % N];
  return Math.atan2(a.x * b.z - a.z * b.x, a.x * b.x + a.z * b.z) / 16;
});

let hint = 0;
function project(x, z) {
  let best = hint;
  let bd = Infinity;
  for (let k = hint - 30; k <= hint + 30; k++) {
    const i = ((k % N) + N) % N;
    const d = (x - Pts[i].x) ** 2 + (z - Pts[i].z) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  hint = best;
  const dx = x - Pts[best].x;
  const dz = z - Pts[best].z;
  const lat = dx * Tan[best].z - dz * Tan[best].x; // 左正
  return { i: best, s: (S[best] + dx * Tan[best].x + dz * Tan[best].z + L) % L, lat };
}

// ---------- 自動駕駛：與遊戲「示範駕駛」共用 src/autopilot.js ----------
const rlRaw = fs
  .readFileSync(new URL(`../assets/source/tracks/${TRACK}_raceline.csv`, import.meta.url), 'utf8')
  .split('\n')
  .filter((l) => l.trim() && !l.startsWith('#'))
  .map((l) => l.split(',').map(Number));
const rlCurve = new THREE.CatmullRomCurve3(rlRaw.map(([x, y]) => new THREE.Vector3(-x, 0, y)), true, 'centripetal');
rlCurve.arcLengthDivisions = rlRaw.length * 8;
const RL = rlCurve.getSpacedPoints(Math.round(rlCurve.getLength() / 2)).slice(0, -1).map((p) => ({ x: p.x, z: p.z }));
const guide = createGuide(RL, P, OVERRIDE.guide || {}, Pts.map((p) => ({ x: p.x, z: p.z })));
const isBot = MODE === 'bot' || MODE === 'demo';
const driver = createDriver(guide, P, isBot ? 'bot' : 'human', isBot ? 'self' : MODE === 'standard' ? 'zone' : 'none', OVERRIDE.driver || {});
// 新手模式：自動煞車＋轉向輔助（與遊戲相同）
const assist = MODE === 'rookie' ? brakeAssist(guide, guide.locator()) : null;
// demo：遊戲內示範駕駛＝自己判斷油門煞車＋轉向輔助
const sAssist =
  MODE === 'rookie' || MODE === 'demo'
    ? steerAssist(guide, guide.locator(), P, 1, 0)
    : MODE === 'standard' && OVERRIDE.assistStrength
      ? lineKeepAssist(guide, guide.locator(), P, OVERRIDE.assistStrength)
      : null;
// 各彎最低速對照（只有 Monza 有真車參考值）
const CORNERS = TRACK !== 'Monza' ? [] : [
  ['Rettifilo', 860, 1060, 80],
  ['Curva Grande', 1350, 1800, 290],
  ['Roggia', 2080, 2260, 120],
  ['Lesmo 1', 2440, 2660, 190],
  ['Lesmo 2', 2790, 2990, 175],
  ['Ascari', 3880, 4260, 200],
  ['Parabolica', 5040, 5420, 210],
];
const cornerMin = CORNERS.map(() => Infinity);

const car = new CarPhysics(P);
const iGrid = (N - Math.round(T.gridOffset / 2)) % N;
car.reset(Pts[iGrid].x, Pts[iGrid].z, Math.atan2(Tan[iGrid].x, Tan[iGrid].z));
hint = iGrid;

const dt = 1 / 120;
let t = 0;
let prevS = null;
let lap = 0;
let lapStart = 0;
const laps = [];
let offEvents = 0;
let wasOff = false;
let spins = 0;
let spinning = false;
let maxBeta = 0;
let ctl = { throttle: 0, brake: 0, steer: 0, handbrake: false, analog: false };
let worstLat = 0;
let steerChanges = 0;
const HZ = Number(process.env.HZ || 60);
const CTRL_EVERY = Math.max(1, Math.round(120 / HZ));
const overLine = [];
const whyLog = [];
const allOut = [];
let wasOver = false;
let wasAllOut = false;
const offAt = [];
const trace = [];
let traced = false;

while (t < 400 && laps.length < 2) {
  // 每 1/HZ 秒更新一次輸入（模擬畫面更新頻率；預覽面板約 20Hz）
  if (Math.round(t / dt) % CTRL_EVERY === 0) {
    const pr = project(car.x, car.z);
    const v = car.speed;
    const c = driver.control(car, CTRL_EVERY * dt);
    if (assist) assist(c, car);
    if (sAssist) sAssist(c, car);
    if (process.env.STRAIGHT && lap === 1 && pr.s < 600 && Math.round(t * 20) % 4 === 0)
      console.log(`s=${pr.s.toFixed(0)} 偏移${pr.lat.toFixed(2)}m 航向誤差${((car.yaw - Math.atan2(Tan[pr.i].x, Tan[pr.i].z)) / DEG).toFixed(1)}° 方向鍵${c.steer} 前輪${(car.steer / DEG).toFixed(2)}° ${(car.speed * 3.6).toFixed(0)}km/h`);
    if (lap >= 1 && c.steer !== ctl.steer) steerChanges++;
    ctl = c;
    if (lap >= 1) CORNERS.forEach(([, a, b], k) => {
      if (pr.s > a && pr.s < b) cornerMin[k] = Math.min(cornerMin[k], v * 3.6);
    });
    // 出界判定（與遊戲相同）
    const edge = pr.lat > 0 ? WL[pr.i] : WR[pr.i];
    const off = Math.abs(pr.lat) > edge + T.curbWidth + T.offMargin;
    worstLat = Math.max(worstLat, Math.abs(pr.lat) - edge);
    // 嚴格標準：車子中心超出柏油邊緣＝壓出白線；超出邊緣 1m（車寬一半）＝四輪出界
    const over = Math.abs(pr.lat) - edge;
    if (lap >= 1 && over > 0 && !wasOver) overLine.push(Math.round(pr.s));
    if (lap >= 1 && over > 1.0 && !wasAllOut) {
      allOut.push(Math.round(pr.s));
      if (process.env.WHY) {
        const back = whyLog.slice(-8).map((w) => w).join('\n      ');
        console.log(`  ✗ 四輪出界 @ ${Math.round(pr.s)}m 往${pr.lat > 0 ? '左' : '右'}出去｜最近 2 秒：\n      ${back}`);
      }
    }
    if (process.env.WHY && Math.round(t * 20) % 5 === 0)
      whyLog.push(`s=${pr.s.toFixed(0)} ${(car.speed * 3.6).toFixed(0)}/${(c.targetSpeed * 3.6).toFixed(0)}km/h 偏${pr.lat.toFixed(1)}m(邊${edge.toFixed(1)}) 舵${(car.steer / DEG).toFixed(1)}° 鍵${c.steer} 油${c.throttle} 煞${c.brake} β${(car.beta / DEG).toFixed(1)}°`);
    wasOver = over > 0;
    wasAllOut = over > 1.0;
    if (off && !wasOff) {
      offEvents++;
      if (lap >= 1) offAt.push(Math.round(pr.s));
    }
    wasOff = off;
    car.surfaceGrip = off ? T.offGrip : 1;
    car.surfaceDrag = off ? T.offDrag : 0;
    // 圈數
    if (prevS != null && pr.s < prevS - L / 2 && t - lapStart > 20) {
      if (lap > 0) laps.push({ time: t - lapStart, off: offEvents, spins, corners: cornerMin.slice(), steerChanges, offAt: offAt.slice(), overLine: overLine.slice(), allOut: allOut.slice() });
      overLine.length = 0;
      allOut.length = 0;
      steerChanges = 0;
      offAt.length = 0;
      cornerMin.fill(Infinity);
      lap++;
      lapStart = t;
      offEvents = 0;
      spins = 0;
    }
    prevS = pr.s;
  }
  car.step(dt, ctl);
  if (process.env.TRACE) {
    trace.push(`${t.toFixed(2)}s v=${(car.speed * 3.6).toFixed(0)} 油${ctl.throttle.toFixed(2)} 煞${ctl.brake.toFixed(2)} 舵${(car.steer / DEG).toFixed(1)}° β=${(car.beta / DEG).toFixed(1)}° 空轉=${car.spinVel.toFixed(1)} 鎖=${car.lock.toFixed(2)}`);
    if (trace.length > 60) trace.shift();
    if (Math.abs(car.beta) > 0.6 && !traced) {
      traced = true;
      console.log(trace.filter((_, k) => k % 6 === 0).join('\n'));
    }
  }
  const b = Math.abs(car.beta);
  maxBeta = Math.max(maxBeta, b);
  if (b > 0.6 && !spinning) {
    spins++;
    spinning = true;
  }
  if (b < 0.2) spinning = false;
  t += dt;
}

const fmt = (x) => `${Math.floor(x / 60)}:${(x % 60).toFixed(3).padStart(6, '0')}`;
console.log(`模式 ${MODE}｜${TRACK}｜賽道長 ${L.toFixed(0)} m`);
if (!laps.length) {
  const pr = project(car.x, car.z);
  console.log(`✗ 未完賽：${t.toFixed(0)} 秒內只跑到 ${pr.s.toFixed(0)} m，打轉 ${spins} 次，出界 ${offEvents} 次`);
} else {
  laps.forEach((l, k) => console.log(`✓ 第 ${k + 1} 圈 ${fmt(l.time)}｜出界 ${l.off} 次｜打轉 ${l.spins} 次`));
  const last = laps[laps.length - 1];
  console.log(`【嚴格】壓出白線 ${last.overLine.length} 次 ${last.overLine.join(', ')}｜四輪出界 ${last.allOut.length} 次 ${last.allOut.join(', ')}`);
  console.log(`方向鍵切換 ${last.steerChanges} 次／圈（平均每秒 ${(last.steerChanges / last.time).toFixed(1)} 次）｜出界位置 ${last.offAt.join(', ') || '無'} m`);
  console.log('彎道最低速（實際 / 真車約）：' + CORNERS.map(([n, , , real], k) => `${n} ${Math.round(last.corners[k])}/${real}`).join('｜'));
}
console.log(`最大車身滑移 ${(maxBeta / DEG).toFixed(1)}°｜最遠超出邊線 ${worstLat.toFixed(2)} m`);
