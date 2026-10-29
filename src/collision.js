// 車對車碰撞：每台車用沿車身縱軸排列的幾個圓近似（前翼、座艙、車尾）
// 重疊時把兩車推開，並在接觸點施加衝量（含轉動）：撞到車尾會被撞轉、擦撞會互相拖慢
// 只用 CarPhysics 的 x / z / yaw / vx / vz / r，與畫面無關（scripts/race-test.mjs 共用）
import { CONFIG } from './config.js';

const _a = [];
const _b = [];

// 圓心的世界座標（車頭方向 = (sin yaw, cos yaw)）
function circles(car, out) {
  const C = CONFIG.race.hitCircles;
  const fx = Math.sin(car.yaw);
  const fz = Math.cos(car.yaw);
  for (let k = 0; k < C.length; k++) {
    out[k] = out[k] || { x: 0, z: 0, r: 0, ox: 0, oz: 0 };
    out[k].ox = fx * C[k].z; // 相對質心的位移
    out[k].oz = fz * C[k].z;
    out[k].x = car.x + out[k].ox;
    out[k].z = car.z + out[k].oz;
    out[k].r = C[k].r;
  }
  out.length = C.length;
  return out;
}

const inertia = (car) => car.P.mass * car.a * car.b * car.P.inertiaScale;

// 處理一對車；回傳衝量大小（N·s），沒碰到回傳 0
export function collidePair(A, B) {
  const R = CONFIG.race;
  // 粗略排除：質心距離超過車長就不可能碰到
  const dx0 = A.x - B.x;
  const dz0 = A.z - B.z;
  if (dx0 * dx0 + dz0 * dz0 > 49) return 0;
  const ca = circles(A, _a);
  const cb = circles(B, _b);
  // 找最深的一組重疊
  let best = null;
  let depth = 0;
  for (const p of ca)
    for (const q of cb) {
      const dx = p.x - q.x;
      const dz = p.z - q.z;
      const d = Math.hypot(dx, dz);
      const o = p.r + q.r - d;
      if (o > depth) {
        depth = o;
        best = { p, q, nx: d > 1e-6 ? dx / d : 1, nz: d > 1e-6 ? dz / d : 0 };
      }
    }
  if (!best) return 0;
  const { p, q, nx, nz } = best;
  const mA = A.P.mass;
  const mB = B.P.mass;
  const IA = inertia(A);
  const IB = inertia(B);
  // 位置修正：依質量比例推開（A 沿 +n、B 沿 −n）
  const push = depth + 0.01;
  A.x += (nx * push * mB) / (mA + mB);
  A.z += (nz * push * mB) / (mA + mB);
  B.x -= (nx * push * mA) / (mA + mB);
  B.z -= (nz * push * mA) / (mA + mB);
  // 接觸點：兩圓連線上、各自圓周
  const rax = p.ox - nx * p.r;
  const raz = p.oz - nz * p.r;
  const rbx = q.ox + nx * q.r;
  const rbz = q.oz + nz * q.r;
  // 接觸點速度：v + ω × r（繞 Y 軸：(ω·rz, −ω·rx)）
  const vax = A.vx + A.r * raz;
  const vaz = A.vz - A.r * rax;
  const vbx = B.vx + B.r * rbz;
  const vbz = B.vz - B.r * rbx;
  const rvx = vax - vbx;
  const rvz = vaz - vbz;
  const vn = rvx * nx + rvz * nz;
  if (vn >= 0) return 0; // 已在分離
  const crossA = raz * nx - rax * nz; // (r × n)_y
  const crossB = rbz * nx - rbx * nz;
  const k = 1 / mA + 1 / mB + (crossA * crossA) / IA + (crossB * crossB) / IB;
  const j = (-(1 + R.restitution) * vn) / k;
  // 切線摩擦（擦撞時互相拖慢），上限 μ·j
  let tx = rvx - vn * nx;
  let tz = rvz - vn * nz;
  const vt = Math.hypot(tx, tz);
  let jt = 0;
  if (vt > 1e-4) {
    tx /= vt;
    tz /= vt;
    const ctA = raz * tx - rax * tz;
    const ctB = rbz * tx - rbx * tz;
    const kt = 1 / mA + 1 / mB + (ctA * ctA) / IA + (ctB * ctB) / IB;
    jt = Math.min(vt / kt, R.contactFriction * j);
  }
  const Jx = j * nx - jt * tx;
  const Jz = j * nz - jt * tz;
  A.vx += Jx / mA;
  A.vz += Jz / mA;
  A.r += ((raz * Jx - rax * Jz) / IA) * R.spinFactor;
  B.vx -= Jx / mB;
  B.vz -= Jz / mB;
  B.r -= ((rbz * Jx - rbx * Jz) / IB) * R.spinFactor;
  return Math.hypot(Jx, Jz);
}

// 所有車兩兩檢查；onHit(i, j, 衝量) 給音效／統計用
export function resolveCollisions(cars, onHit) {
  for (let i = 0; i < cars.length; i++)
    for (let j = i + 1; j < cars.length; j++) {
      const imp = collidePair(cars[i], cars[j]);
      if (imp > 0 && onHit) onHit(i, j, imp);
    }
}
