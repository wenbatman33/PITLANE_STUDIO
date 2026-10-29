// AI 對手車手：沿自己等級的建議路線開，會跟車、超車、防守、並排保持距離
// 只依賴 CarPhysics 狀態與賽道投影結果，與畫面無關（scripts/race-test.mjs 共用）
import { CONFIG } from './config.js';
import { clamp, lerp } from './util.js';

const DEG = Math.PI / 180;

// guide：createGuide() 的結果；lane：guide 每一點相對賽道中心線的側向位置與左右寬度（{lat, wl, wr} 陣列，race.js 預先算好）
// opts.defend：防守積極度 0~1
export function createOpponentDriver(guide, lane, P, opts = {}) {
  const R = CONFIG.race;
  const { line, tan, speed, n } = guide;
  const locate = guide.locator();
  let offset = 0; // 相對建議路線的側向偏移（m，左正）
  let wantLat = null; // 想去的賽道側向位置（null＝回建議路線）
  let defendTimer = 0;
  let holdTimer = 0;
  let startLat = null; // 發車時的側向位置：起跑後 150m 內維持自己這一排，不急著併線

  // me / field 元素：{ car, s, lat, progress, wl, wr }
  function control(me, field, dt, trackLen) {
    const c = me.car;
    const v = c.speed;
    const i = locate(c.x, c.z);
    defendTimer = Math.max(0, defendTimer - dt);
    holdTimer = Math.max(0, holdTimer - dt);
    const L = lane[i];
    const pathLat = L.lat + offset; // 目前打算開的賽道側向位置
    const minLat = -(L.wr - 1.2);
    const maxLat = L.wl - 1.2;
    // 前方 80m 的彎道內側（給超車選邊）
    const kAhead = (() => {
      const a = tan[(i + 20) % n];
      const b = tan[(i + 45) % n];
      return a.x * b.z - a.z * b.x; // > 0：右彎（座標系：左＝(cos, −sin)）
    })();

    if (startLat == null) startLat = me.lat;
    let follow = Infinity;
    const look = Math.max(70, v * 2.5); // 看前方 2.5 秒會到的距離（高速時看更遠）
    let target = me.progress < 150 ? clamp(startLat, minLat, maxLat) : null;
    for (const o of field) {
      if (o === me) continue;
      // 賽道上的前後距離（差幾圈都換算成 −L/2 ~ L/2；被套圈的車也看得到）
      const ds = ((((o.progress - me.progress) % trackLen) + trackLen * 1.5) % trackLen) - trackLen / 2;
      const dl = o.lat - me.lat;
      // 並排（前後重疊）：保持側向距離，不往對方身上靠
      if (Math.abs(ds) < 7 && Math.abs(dl) < R.sideGap) {
        target = clamp(o.lat - Math.sign(dl || 1) * R.sideGap, minLat, maxLat);
        holdTimer = 0.6;
      }
      // 並排但我落後半個車身以上、前方要煞車進彎：收油讓對方先進彎（不硬擠）
      if (ds > 1.5 && ds < 7 && Math.abs(dl) < R.sideGap + 0.6 && speed[(i + 40) % n] < v - 8) {
        follow = Math.min(follow, o.car.speed - 2);
      }
      // 前車只領先不到一個車身、側向又重疊（快追撞了）：直接減速
      if (ds > 0 && ds < 7 && Math.abs(dl) < 2.3) follow = Math.min(follow, o.car.speed - 1.5);
      if (Math.abs(ds) < 7) continue;
      // 前車：在我要走的線上（車寬 2m＋餘裕）
      if (ds > 0 && ds < look && Math.abs(o.lat - pathLat) < 2.7) {
        const closing = v - o.car.speed;
        // 我比較快、而且夠近（約 1.8 秒內追上）：選邊超車（空間大的一邊；空間差不多時選下一個彎的內側）
        if (ds < Math.max(45, closing * 1.8 + 20) && closing > 0.3 && holdTimer <= 0) {
          const roomL = maxLat - (o.lat + R.sideGap);
          const roomR = o.lat - R.sideGap - minLat;
          let side = roomL > roomR ? 1 : -1;
          if (Math.abs(roomL - roomR) < 1.5) side = kAhead > 0 ? -1 : 1;
          const room = side > 0 ? roomL : roomR;
          if (room >= 0) target = clamp(o.lat + side * R.sideGap, minLat, maxLat);
        }
        // 跟車：用煞車距離算「追上前能不能減到跟前車一樣快」（以 20 m/s² 保守估計），保持 followGap
        // 前車正在煞車時提早跟著煞（accF < 0）
        const room = Math.max(0, ds - R.followGap);
        const vo = Math.max(0, o.car.speed + Math.min(0, o.car.accF) * 0.35);
        follow = Math.min(follow, Math.sqrt(vo * vo + 2 * 20 * room));
      }
      // 後車逼近：往對方那側擋一次（之後 2 秒不再變線）
      if (opts.defend && ds < -7 && ds > -25 && o.car.speed > v + 1 && defendTimer <= 0 && target == null) {
        if ((opts.rand || Math.random)() < opts.defend * dt * 3) {
          target = clamp(me.lat + Math.sign(dl || 1) * 1.6, minLat, maxLat);
          defendTimer = 2;
          holdTimer = 1.2;
        }
      }
    }
    if (target != null) wantLat = target;
    else if (holdTimer <= 0) wantLat = null;
    // 側向偏移平滑變化（換線速度隨車速加快：低速每秒 2.5m、300km/h 約 4.5m）
    const goal = wantLat == null ? 0 : wantLat - L.lat;
    const laneRate = Math.max(2.5, v * 0.055) * dt;
    offset += clamp(goal - offset, -laneRate, laneRate);

    // 轉向：純追蹤（pure pursuit），目標點＝前方建議路線點往左右偏 offset
    const Ld = 8 + 0.35 * v;
    const j = (i + Math.round(Ld / 2)) % n;
    const t = tan[j];
    const tx = line[j].x + t.z * offset;
    const tz = line[j].z - t.x * offset;
    const dx = tx - c.x;
    const dz = tz - c.z;
    const fwd = dx * Math.sin(c.yaw) + dz * Math.cos(c.yaw);
    const left = dx * Math.cos(c.yaw) - dz * Math.sin(c.yaw);
    let delta = Math.atan2(2 * P.wheelbase * Math.sin(Math.atan2(left, fwd)), Ld);
    // 偏離修正（Stanley）：離想走的線越遠修越多；純追蹤只看前方一點，高 G 出彎會被推離路線
    const ti = tan[i];
    const err = (c.x - line[i].x) * ti.z - (c.z - line[i].z) * ti.x - offset; // 左正
    delta -= Math.atan((opts.crossGain ?? 1.2) * err / Math.max(v, 5));
    const speedT = Math.pow(Math.min(v / 70, 1), 0.7);
    const maxSteer = lerp(P.maxSteerDeg, P.highSpeedSteerDeg, speedT) * DEG;
    const x = clamp(delta / maxSteer, -1, 1);
    const steer = Math.sign(x) * Math.pow(Math.abs(x), 1 / P.steerCurve);

    // 速度：看前方 lookSec 秒會到的地方的建議速度（與跟車速度取小）
    //   超過就全力煞車（ABS 不鎖死）、低於就全油門，中間一小段帶油維持 —— 像真人賽車手的開關式操作
    const lim = Math.min(speed[(i + 2 + Math.round((v * (opts.lookSec ?? 0.3)) / 2)) % n], follow);
    let throttle = 0;
    let brake = 0;
    if (v > lim + 0.3) brake = 1;
    else if (v < lim - 0.8) throttle = 1;
    else throttle = 0.35;
    // 出彎循序給油：側向 G 用得越多，油門越少（後輪抓地要留給轉彎，否則會被推出彎外）
    const usage = Math.abs(v * c.r) / Math.max(c.ayCap, 1);
    throttle = Math.min(throttle, clamp((opts.exitThrottle ?? 1.25) - usage, 0.15, 1));
    return { throttle, brake, steer, analog: true, handbrake: false, i };
  }

  return { control, locate };
}
