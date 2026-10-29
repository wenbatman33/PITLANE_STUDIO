// 真人模式測試：一群「照教學玩」的模擬玩家，各在 Monza 連跑 3 圈
// 用法：TRACK=Suzuka node scripts/human-test.mjs [rookie|standard|expert] [人數] [覆寫 JSON：physics 鍵、driver、guide]
//   TRACK：assets/source/tracks/ 下的賽道檔名（Monza、Suzuka、Budapest、Catalunya、Silverstone、Zandvoort），預設 Monza
//   操作方式＝真人鍵盤：方向鍵只會「按住／放開」（路線偏左就按住 A，回正就放開）
//   煞車只看地上路線顏色：紅線按住空白鍵、離開紅線放開；其他時候按住 W（不知道目標速度）
//   反應 0.2~0.3 秒、按鍵最快 0.1 秒切換、畫面 30 或 60Hz；與遊戲相同的難度輔助設定
// 嚴格標準：四輪出界＝車子中心超出柏油邊緣 1m 以上；打轉＝車尾外滑超過 25°；胎痕＝輪胎真的超過抓地極限
import fs from 'node:fs';
import * as THREE from 'three';
import { CarPhysics } from '../src/physics.js';
import { CONFIG } from '../src/config.js';
import { LEVELS, LINE_STYLES } from '../src/content.js';
import { createGuide, createDriver, brakeAssist, steerAssist, lineKeepAssist } from '../src/autopilot.js';
import { clamp } from '../src/util.js';

const LEVEL = process.argv[2] || 'standard';
const COUNT = Number(process.argv[3] || 12);
const OVERRIDE = process.argv[4] ? JSON.parse(process.argv[4]) : {};
const LAPS = Number(process.env.LAPS || 3);
const LV = LEVELS[LEVEL];
const P = {
  ...CONFIG.physics,
  tractionControl: LV.tc,
  abs: LV.abs,
  esc: LV.esc,
  steerAssist: LV.keySteerAssist,
  ...OVERRIDE,
};
const T = CONFIG.track;
const DEG = Math.PI / 180;

// ---------- 賽道（與 src/track.js 相同的處理） ----------
const readCsv = (f) =>
  fs
    .readFileSync(new URL(`../assets/source/tracks/${f}`, import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => l.split(',').map(Number));
const TRACK = process.env.TRACK || 'Monza';
const raw = readCsv(`${TRACK}.csv`);
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
const smooth = (arr, r) =>
  arr.map((_, i) => {
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

function projector() {
  let hint = (N - Math.round(T.gridOffset / 2)) % N;
  return (x, z) => {
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
    return { i: best, s: (S[best] + dx * Tan[best].x + dz * Tan[best].z + L) % L, lat: dx * Tan[best].z - dz * Tan[best].x };
  };
}

const rl = readCsv(`${TRACK}_raceline.csv`);
const rlCurve = new THREE.CatmullRomCurve3(rl.map(([x, y]) => new THREE.Vector3(-x, 0, y)), true, 'centripetal');
rlCurve.arcLengthDivisions = rl.length * 8;
const RL = rlCurve.getSpacedPoints(Math.round(rlCurve.getLength() / 2)).slice(0, -1).map((p) => ({ x: p.x, z: p.z }));
// 路線：LINE=safe|best（預設用難度的預設路線）
const LINE = process.env.LINE || LV.lineStyle || 'safe';
const guide = createGuide(RL, P, { ...LINE_STYLES[LINE].guide, ...(OVERRIDE.guide || {}) }, Pts.map((p) => ({ x: p.x, z: p.z })));

// ---------- 一位玩家連跑 LAPS 圈 ----------
function drive(person, hz) {
  const driver = createDriver(guide, P, 'person', LV.brakeAssist ? 'none' : 'color', person);
  const bAssist = LV.brakeAssist ? brakeAssist(guide, guide.locator()) : null;
  const sAssist = LV.steerAssist ? steerAssist(guide, guide.locator(), P, 1, 0.35) : LV.lineKeep ? lineKeepAssist(guide, guide.locator(), P, LV.lineKeep) : null;
  const project = projector();
  const car = new CarPhysics(P);
  const iGrid = (N - Math.round(T.gridOffset / 2)) % N;
  car.reset(Pts[iGrid].x, Pts[iGrid].z, Math.atan2(Tan[iGrid].x, Tan[iGrid].z));
  const dt = 1 / 120;
  const every = Math.max(1, Math.round(120 / hz));
  let ctl = { throttle: 0, brake: 0, steer: 0 };
  let t = 0;
  let prevS = null;
  let lapStart = 0;
  let lap = 0;
  const laps = [];
  let cur = null;
  const newLap = () => ({ allOut: [], over: 0, spins: 0, maxOver: 0, skid: 0, keys: 0 });
  let wasOut = false;
  let wasOver = false;
  let spinning = false;
  let step = 0;
  const hist = [];
  const spinLog = [];
  while (t < 140 * (LAPS + 1) && laps.length < LAPS) {
    if (step % every === 0) {
      const pr = project(car.x, car.z);
      const c = driver.control(car, every * dt);
      if (bAssist) bAssist(c, car);
      if (sAssist) sAssist(c, car);
      if (cur && (c.steer !== ctl.steer || c.brake !== ctl.brake || c.throttle !== ctl.throttle)) cur.keys++;
      ctl = c;
      const edge = pr.lat > 0 ? WL[pr.i] : WR[pr.i];
      const over = Math.abs(pr.lat) - edge;
      if (process.env.WHY && step % 24 === 0) {
        hist.push(`s=${pr.s.toFixed(0)} 偏${pr.lat.toFixed(1)}/${(pr.lat > 0 ? WL[pr.i] : -WR[pr.i]).toFixed(1)} ${(car.speed * 3.6).toFixed(0)}/${(c.targetSpeed * 3.6).toFixed(0)}km/h 油${c.throttle} 煞${c.brake} 舵${c.steer} 前輪${(car.steer / DEG).toFixed(1)}° 輔助${((c.assistSteer || 0) / DEG).toFixed(1)}° 可用${(car.ayCap / 9.81).toFixed(1)}G 側G${((car.speed * car.r) / 9.81).toFixed(1)}`);
        if (hist.length > 10) hist.shift();
      }
      const off = Math.abs(pr.lat) > edge + T.curbWidth + T.offMargin;
      car.surfaceGrip = off ? T.offGrip : 1;
      car.surfaceDrag = off ? T.offDrag : 0;
      if (cur) {
        if (over > 0 && !wasOver) cur.over++;
        if (over > 1 && !wasOut) {
          cur.allOut.push(Math.round(pr.s));
          if (process.env.WHY) console.log(`    ✗ 出界 s=${pr.s.toFixed(0)} 偏${pr.lat.toFixed(1)}m 邊${edge.toFixed(1)}m ${(car.speed * 3.6).toFixed(0)}km/h 鍵 油${ctl.throttle} 煞${ctl.brake} 舵${ctl.steer}\n      ${hist.join('\n      ')}`);
        }
      }
      wasOver = over > 0;
      wasOut = over > 1;
      if (prevS != null && pr.s < prevS - L / 2 && t - lapStart > 20) {
        if (cur) laps.push({ ...cur, time: t - lapStart });
        cur = newLap();
        lap++;
        lapStart = t;
      }
      prevS = pr.s;
    }
    car.step(dt, ctl);
    if (process.env.SPINS && step % 24 === 0) {
      spinLog.push(`${(car.speed * 3.6).toFixed(0)}油${ctl.throttle}煞${ctl.brake}舵${ctl.steer}β${(car.beta / DEG).toFixed(0)}空${car.spinVel.toFixed(1)}鎖${car.lock.toFixed(1)}`);
      if (spinLog.length > 5) spinLog.shift();
    }
    if (process.env.DEBUG && step % Number(process.env.DEBUG) === 0) {
      const pr = project(car.x, car.z);
      console.log(`t=${t.toFixed(1)} s=${pr.s.toFixed(0)} 偏${pr.lat.toFixed(1)} v=${(car.speed * 3.6).toFixed(0)}/${(ctl.targetSpeed * 3.6).toFixed(0)} 油${ctl.throttle} 煞${ctl.brake} 舵${ctl.steer} 圈${lap}`);
    }
    if (cur) {
      const oversteer = (-car.beta * (Math.sign(car.r) || 1)) / DEG;
      cur.maxOver = Math.max(cur.maxOver, oversteer);
      if (oversteer > 25 && !spinning) {
        cur.spins++;
        spinning = true;
        if (process.env.SPINS) {
          const pr = project(car.x, car.z);
          console.log(`    ↻ 打轉 s=${pr.s.toFixed(0)} ${(car.speed * 3.6).toFixed(0)}km/h 油${ctl.throttle} 煞${ctl.brake} 舵${ctl.steer} 前輪${(car.steer / DEG).toFixed(1)}° 鎖死${car.lock.toFixed(2)} 空轉${car.spinVel.toFixed(1)} 檔${car.gear}｜前 1 秒：${spinLog.join(' / ')}`);
        }
      }
      if (oversteer < 10) spinning = false;
      if (Math.max(car.slipF, car.slipR) - CONFIG.fx.skidThreshold > 0.9) cur.skid += dt; // 胎痕強度 > 0.15
    }
    t += dt;
    step++;
  }
  return laps;
}

let seed = Number(process.env.SEED || 20261029);
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a, b) => a + (b - a) * rand();
const fmt = (x) => `${Math.floor(x / 60)}:${(x % 60).toFixed(3).padStart(6, '0')}`;

console.log(`【真人模式・${TRACK}・${LV.name}・${LINE_STYLES[LINE].name}】${COUNT} 位玩家 × ${LAPS} 圈｜ABS ${P.abs ? '開' : '關'}・車身穩定 ${P.esc}・自動煞車 ${LV.brakeAssist ? '開' : '關'}・循跡輔助 ${LV.steerAssist ? '全自動' : LV.lineKeep || 0}`);
let cleanLaps = 0;
let totalLaps = 0;
let cleanPeople = 0;
let worstOver = 0;
let skidTotal = 0;
let spinTotal = 0;
for (let k = 0; k < COUNT; k++) {
  const person = {
    reaction: +pick(0.2, 0.3).toFixed(2),
    lookGain: +pick(0.3, 0.5).toFixed(2),
    steerOn: +(pick(1, 2.5) * DEG).toFixed(4),
    minHold: +pick(0.08, 0.15).toFixed(2),
    coastYellow: rand() < 0.5,
    ...(OVERRIDE.driver || {}),
  };
  const hz = rand() < 0.5 ? 30 : 60;
  const laps = drive(person, hz);
  const done = laps.length === LAPS;
  const outs = laps.reduce((a, l) => a + l.allOut.length, 0);
  const spins = laps.reduce((a, l) => a + l.spins, 0);
  cleanLaps += laps.filter((l) => !l.allOut.length && !l.spins).length;
  totalLaps += LAPS;
  if (done && !outs && !spins) cleanPeople++;
  const mo = Math.max(0, ...laps.map((l) => l.maxOver));
  worstOver = Math.max(worstOver, mo);
  skidTotal += laps.reduce((a, l) => a + l.skid, 0);
  spinTotal += spins;
  const times = laps.map((l) => fmt(l.time)).join(' ');
  const where = laps.flatMap((l) => l.allOut).join(',');
  const kps = laps.length ? laps.reduce((a, l) => a + l.keys / l.time, 0) / laps.length : 0;
  console.log(
    `  玩家${String(k + 1).padStart(2)} 反應${person.reaction}s 門檻${(person.steerOn / DEG).toFixed(1)}° 黃線${person.coastYellow ? '放油' : '踩油'} ${hz}Hz → ${done ? times : `只完成 ${laps.length} 圈`}｜四輪出界 ${outs}${where ? `（${where}m）` : ''}｜打轉 ${spins}｜甩尾最大 ${mo.toFixed(1)}°｜按鍵 ${kps.toFixed(1)} 次/秒`,
  );
}
console.log(`結果：全程乾淨 ${cleanPeople}/${COUNT} 人｜乾淨圈 ${cleanLaps}/${totalLaps}｜打轉 ${spinTotal} 次｜最大甩尾 ${worstOver.toFixed(1)}°｜胎痕共 ${skidTotal.toFixed(1)} 秒`);
