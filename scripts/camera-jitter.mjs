// 鏡頭晃動量測：用遊戲同一套物理與 CameraRig，全油門直線加速，逐幀算出車子在畫面上的上下位置
// 用法：node scripts/camera-jitter.mjs [秒數]
//   幀間隔模擬真實瀏覽器：60Hz 為主、偶爾掉一幀（33ms）、每幀 ±1ms 抖動
//   輸出：畫面高 780px 時，車子在畫面上的「慢漂移」與「高頻抖動」（像素）
import * as THREE from 'three';
import { CarPhysics } from '../src/physics.js';
import { CameraRig } from '../src/camera.js';
import { CONFIG } from '../src/config.js';
import { clamp, lerp, damp } from '../src/util.js';

const SECS = Number(process.argv[2] || 14);
const H = 780;
const STEP = 1 / 120;

const phys = new CarPhysics(Object.create(CONFIG.physics));
const camera = new THREE.PerspectiveCamera(CONFIG.camera.chaseFov, 1280 / 780, 0.1, 2000);
const rig = new CameraRig(camera, null);
const view = Object.create(phys);
const prev = { x: 0, z: 0, yaw: 0 };
const pose = rig.chasePose(phys);
rig.jumpTo(pose.pos, pose.look, CONFIG.camera.chaseFov);
rig.startChase();

// 車身俯仰（與 src/car.js 相同公式），用來算車頭在畫面上的位置
let pitch = 0;
let heave = 0;

let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

let t = 0;
let acc = 0;
const rows = [];
const v = new THREE.Vector3();
while (t < SECS) {
  let dt = 1 / 60 + (rand() - 0.5) * 0.002;
  if (rand() < 0.03) dt += 1 / 60; // 偶爾掉一幀
  t += dt;
  acc += dt;
  while (acc >= STEP) {
    prev.x = phys.x;
    prev.z = phys.z;
    prev.yaw = phys.yaw;
    phys.step(STEP, { throttle: 1, brake: 0, steer: 0 });
    acc -= STEP;
  }
  const a = acc / STEP;
  view.x = prev.x + (phys.x - prev.x) * a;
  view.z = prev.z + (phys.z - prev.z) * a;
  view.yaw = prev.yaw + (phys.yaw - prev.yaw) * a;
  pitch = lerp(pitch, clamp(-phys.accF * 0.0008, -0.012, 0.012), damp(2.5, dt));
  heave = lerp(heave, -Math.min(phys.speed * phys.speed * 0.0000045, 0.02), damp(6, dt));
  rig.update(dt, view);
  camera.updateMatrixWorld();
  // 車身中心（離地 0.5m）與車頭（前 2.6m、受俯仰影響）在畫面上的 y 像素
  v.set(view.x, 0.5 + heave, view.z).project(camera);
  const cy = ((1 - v.y) / 2) * H;
  v.set(view.x, 0.5 + heave - Math.sin(pitch) * 2.6, view.z + 2.6).project(camera);
  const ny = ((1 - v.y) / 2) * H;
  const dir = camera.getWorldDirection(new THREE.Vector3());
  rows.push({ t, dt, kmh: phys.speed * 3.6, gear: phys.gear, accF: phys.accF, cy, ny, camPitch: (Math.asin(dir.y) * 180) / Math.PI, fov: camera.fov });
}

// 高頻抖動：與前後 0.25 秒平均的差
const hf = (key) => {
  let max = 0;
  let sum = 0;
  let n = 0;
  for (let i = 15; i < rows.length - 15; i++) {
    let m = 0;
    for (let k = -15; k <= 15; k++) m += rows[i + k][key];
    m /= 31;
    const d = Math.abs(rows[i][key] - m);
    max = Math.max(max, d);
    sum += d * d;
    n++;
  }
  return { max, rms: Math.sqrt(sum / n) };
};
// 幀與幀之間的跳動
const step = (key) => {
  let max = 0;
  for (let i = 1; i < rows.length; i++) max = Math.max(max, Math.abs(rows[i][key] - rows[i - 1][key]));
  return max;
};
const cy = rows.map((r) => r.cy);
console.log('時間  速度   檔 加速度  鏡頭俯角  車身中心y  車頭y  FOV');
for (let i = 0; i < rows.length; i += Math.round(rows.length / 28)) {
  const r = rows[i];
  console.log(
    `${r.t.toFixed(1).padStart(4)}s ${r.kmh.toFixed(0).padStart(4)} ${r.gear} ${r.accF.toFixed(1).padStart(5)}  ${r.camPitch.toFixed(2).padStart(6)}°  ${r.cy.toFixed(1).padStart(6)}px ${r.ny.toFixed(1).padStart(6)}px ${r.fov.toFixed(1)}`,
  );
}
const hc = hf('cy');
const hn = hf('ny');
console.log(`車身中心：畫面位置範圍 ${Math.min(...cy).toFixed(1)}~${Math.max(...cy).toFixed(1)}px（慢漂移 ${(Math.max(...cy) - Math.min(...cy)).toFixed(1)}px）`);
console.log(`高頻抖動（相對 0.5 秒平均）：車身中心 最大 ${hc.max.toFixed(2)}px／均方根 ${hc.rms.toFixed(2)}px；車頭 最大 ${hn.max.toFixed(2)}px／均方根 ${hn.rms.toFixed(2)}px`);
console.log(`相鄰兩幀最大跳動：車身中心 ${step('cy').toFixed(2)}px、車頭 ${step('ny').toFixed(2)}px、鏡頭俯角 ${step('camPitch').toFixed(3)}°`);
