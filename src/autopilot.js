// 駕駛導引：建議路線（含煞車區）、自動煞車輔助、自動駕駛
// 遊戲內「建議路線／自動煞車／示範駕駛」與 scripts/lap-test.mjs 完賽測試共用這一份
import { assistSteerLimit } from './physics.js';

const DEG = Math.PI / 180;
const G = 9.81;

// grip：建議過彎速度用的抓地比例（保守一點，新手照著開也不會衝出去）
// brakeGrip：紅線（煞車區）長度用「車子實際煞車減速度 × brakeGrip」算
//   ＝ 照教學「紅線按住煞車、變黃就放開」剛好降到彎道速度；太小會煞過頭（甚至在紅線上停住）
// lineBlend：建議路線從最佳賽車路線往中心線收多少（留安全餘裕）
export const DEFAULT_GUIDE = { grip: 0.84, brakeGrip: 0.8, lineBlend: 0.6 };

// 自動駕駛的操作特性
//   bot  ：每 1/60 秒判斷、按鍵最快 0.15 秒切換（示範用）
//   human：模擬真人 —— 反應延遲 0.25 秒、按鍵最快 0.25 秒切換（每秒最多 4 次）、只看路線顏色決定煞車
export const DRIVER_PROFILES = {
  bot: { reaction: 0, minHold: 0.15, lookBase: 9, lookGain: 0.3, steerOn: 1.5 * DEG },
  // human 的方向鍵：每 period 秒判斷一次，依需要的打角決定這段時間按多久（最短 minTap 輕點～整段按住）
  // 一般玩家水準：反應 0.2 秒、每 0.15 秒判斷一次（每秒約 6~7 次）、最短輕點 0.06 秒
  human: { reaction: 0.2, minHold: 0.25, lookBase: 12, lookGain: 0.35, steerOn: 2 * DEG, pwm: true, period: 0.15, minTap: 0.06, pwmGain: 1.5 },
  // person：照教學玩的真人 —— 方向鍵只有「按住／放開」：路線在左邊就按住 A，回到正前方就放開（有遲滯）
  // 不知道目標速度：紅線按住煞車、離開紅線放開；其他時候按住 W
  //   判斷依據是「前方路線點在車頭左右偏幾度」（眼睛看到的角度），不是演算法算出的轉向角
  //   lead：看到車頭已經在轉回來，會提早放開（預判幾秒後的偏角；彎道本身的轉動不算）
  person: { reaction: 0.25, anticipate: 0.5, minHold: 0.1, lookBase: 10, lookGain: 0.4, steerOn: 1.5 * DEG, steerOff: 0.4 * DEG, relay: true, bearing: true, lead: 0.35 },
};

// 建議路線與每一點的建議速度
// raceline：最佳賽車路線 [{x, z}]（每 2 公尺一點、封閉）；center：賽道中心線（選填）
export function createGuide(raceline, P, opts = {}, center = null) {
  const O = { ...DEFAULT_GUIDE, ...opts };
  const line = blendLine(raceline, center, O.lineBlend);
  const n = line.length;
  const tan = line.map((_, i) => {
    const a = line[(i - 1 + n) % n];
    const b = line[(i + 1) % n];
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { x: (b.x - a.x) / l, z: (b.z - a.z) / l };
  });
  const curv = tan.map((_, i) => {
    const a = tan[(i - 5 + n) % n];
    const b = tan[(i + 5) % n];
    return Math.abs(Math.atan2(a.x * b.z - a.z * b.x, a.x * b.x + a.z * b.z)) / 20;
  });

  // 過彎極速：前後軸各自撐得住的側向加速度（與 physics.js 的 ayCap 相同算法）
  //   前軸分擔 b/L、後軸分擔 a/L；每軸能力 = μ ×（靜態載重 + 下壓力分配）→ ay = c0 + c1·v²
  //   v²κ = grip·(c0 + c1·v²) → v² = grip·c0 /（κ − grip·c1）；兩軸取較慢者，再用煞車距離往回推
  const fw = P.frontWeight;
  const aeroF = P.aeroFront ?? 0.45;
  const axles = [
    { mu: P.muFront, w: fw, aero: aeroF, share: fw }, // 前軸：分擔 b/L = frontWeight
    { mu: P.muRear, w: 1 - fw, aero: 1 - aeroF, share: 1 - fw },
  ].map((x) => ({ c0: (x.mu * G * x.w) / x.share, c1: (x.mu * P.downforce * x.aero) / (P.mass * x.share) }));
  const ayCapAt = (v) => Math.min(...axles.map((x) => x.c0 + x.c1 * v * v));
  const vCorner = curv.map((k) =>
    Math.min(100, ...axles.map((x) => (k <= O.grip * x.c1 + 1e-6 ? 100 : Math.sqrt((O.grip * x.c0) / (k - O.grip * x.c1))))),
  );
  const speed = vCorner.slice();
  // 車子實際的全力煞車減速度（與 physics.js 相同：ABS 上限 × 四輪抓地、煞車力上限、風阻、引擎煞車）
  const decelAt = (v) => {
    const down = P.downforce * v * v;
    const grip = 0.98 * (P.abs ? 0.92 : 1) * (P.muFront * (P.mass * G * fw + down * aeroF) + P.muRear * (P.mass * G * (1 - fw) + down * (1 - aeroF)));
    return (O.brakeGrip * (Math.min(P.brakeForce, grip) + P.dragCoef * v * v + 650 + P.rollResist * 10)) / P.mass;
  };
  // 摩擦圓：彎中邊轉邊煞時，輪胎要分一部分抓地力給轉彎，能用來減速的變少（物理的彎道 ABS 也會這樣放煞車）
  const latFrac = (v, k) => Math.min(1, (v * v * k) / ayCapAt(v));
  for (let pass = 0; pass < 2; pass++)
    for (let i = n - 1; i >= 0; i--) {
      const j = (i + 1) % n;
      const nx = speed[j];
      const f = latFrac(nx, curv[j]);
      const d = decelAt(nx) * Math.sqrt(Math.max(O.minBrakeShare ?? 0.35, 1 - f * f));
      speed[i] = Math.min(speed[i], Math.sqrt(nx * nx + 2 * d * 2));
    }
  // 分區：brake＝要煞車（建議速度受前方彎道限制）、corner＝彎中保持、full＝全油門
  const zone = speed.map((v, i) => (v < vCorner[i] - 0.5 ? 'brake' : v >= 99 ? 'full' : 'corner'));

  // 找最近的路線點（各使用者各自持有 hint）
  function locator() {
    let hint = 0;
    return (x, z) => {
      let best = hint;
      let bd = Infinity;
      const scan = (from, to) => {
        for (let k = from; k <= to; k++) {
          const i = ((k % n) + n) % n;
          const d = (x - line[i].x) ** 2 + (z - line[i].z) ** 2;
          if (d < bd) {
            bd = d;
            best = i;
          }
        }
      };
      scan(hint - 30, hint + 30);
      if (bd > 900) scan(0, n - 1);
      return (hint = best);
    };
  }

  return { line, tan, speed, zone, n, locator };
}

// 重煞區：建議速度一路往下降超過 minDrop（m/s）的區段，回傳每段結束點（＝彎道入口）的路線索引
// 用來自動擺放 150／100／50 m 煞車看板
//   曲率雜訊會把同一段煞車區切成好幾小段：間隔小於 mergeGap 點（每點 2m）的合併成一段
//   兩段入口相距小於 minGap 點時只留降速較多的那段
export function heavyBrakeEntries(guide, minDrop = 80 / 3.6, mergeGap = 20, minGap = 125) {
  const { speed, zone, n } = guide;
  // 從非煞車區開始掃，避免從煞車區中間切開
  const i0 = zone.findIndex((z) => z !== 'brake');
  const runs = [];
  let start = -1;
  for (let k = 0; k <= n; k++) {
    const i = (i0 + k) % n;
    if (zone[i] === 'brake' && start < 0) start = k;
    if (zone[i] !== 'brake' && start >= 0) {
      runs.push([start, k - 1]);
      start = -1;
    }
  }
  const merged = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && r[0] - last[1] <= mergeGap) last[1] = r[1];
    else merged.push([...r]);
  }
  const cands = merged
    .map(([a, b]) => {
      const ia = (i0 + a) % n;
      const ib = (i0 + b) % n;
      return { end: ib, k: b, drop: speed[ia] - speed[ib] };
    })
    .filter((c) => c.drop >= minDrop)
    .sort((x, y) => y.drop - x.drop);
  const kept = [];
  for (const c of cands) {
    const near = kept.some((q) => {
      const d = Math.abs(q.k - c.k);
      return Math.min(d, n - d) < minGap;
    });
    if (!near) kept.push(c);
  }
  return kept.map((c) => c.end);
}

// 動態路線顏色（像 F1 遊戲的輔助線）：依「目前車速」決定路線上某一點的顏色
//   brake 紅：以目前車速開到這裡會太快 → 到這裡時要按住煞車
//   corner 黃：接近這一點的極限速度 → 不要再加速
//   full 綠：還有餘裕 → 全油門
// 玩家規則因此永遠成立：車子底下的線是紅色就煞車、不是紅色就放開
// lead：紅色提前多少秒出現（真人看到紅線再按下去約慢 0.3 秒，加上煞車踩到底的時間）
export function guideColor(guide, i, v, yellowBand = 3, lead = guide.lead ?? 0.35) {
  const lim = guide.speed[(i + Math.round((v * lead) / 2)) % guide.n];
  if (v > lim + 0.5) return 'brake';
  if (v > lim - yellowBand) return 'corner';
  return 'full';
}

// 自動煞車輔助（新手模式）：比建議速度快就自動煞車、收油
export function brakeAssist(guide, locate) {
  return (ctl, car) => {
    const i = locate(car.x, car.z);
    const target = guide.speed[(i + 2) % guide.n];
    if (car.speed > target + 1) {
      ctl.brake = Math.max(ctl.brake || 0, Math.min(1, Math.max(0.35, (car.speed - target) / 4)));
      ctl.throttle = 0;
      ctl.assistBraking = true;
    }
    return ctl;
  };
}

// 轉向輔助（新手模式）：遊戲自動沿建議路線轉向；玩家按 A / D 時，在自動轉向上往左右偏
// 輸出改成類比方向值（analog），由物理直接跟隨
export function steerAssist(guide, locate, P, strength = 1, nudge = 0.35) {
  const DEGR = Math.PI / 180;
  return (ctl, car) => {
    const v = car.speed;
    const i = locate(car.x, car.z);
    const Ld = 8 + 0.35 * v;
    const j = (i + Math.round(Ld / 2)) % guide.n;
    const dx = guide.line[j].x - car.x;
    const dz = guide.line[j].z - car.z;
    const fwd = dx * Math.sin(car.yaw) + dz * Math.cos(car.yaw);
    const left = dx * Math.cos(car.yaw) - dz * Math.sin(car.yaw);
    const delta = Math.atan2(2 * P.wheelbase * Math.sin(Math.atan2(left, fwd)), Ld);
    // 物理的類比轉向：角度 = (輸入^曲線) × 最大打角，所以這裡要反推輸入值
    const speedT = Math.pow(Math.min(v / 70, 1), 0.7);
    const maxSteer = (P.maxSteerDeg + (P.highSpeedSteerDeg - P.maxSteerDeg) * speedT) * DEGR;
    const x = Math.max(-1, Math.min(1, delta / maxSteer));
    const auto = Math.sign(x) * Math.pow(Math.abs(x), 1 / P.steerCurve);
    ctl.steer = Math.max(-1, Math.min(1, auto * strength + (ctl.steer || 0) * nudge));
    ctl.analog = true;
    return ctl;
  };
}

// 循跡穩定輔助（標準模式）：玩家自己轉向，遊戲只額外加上「往路線修正」角度的一部分
export function lineKeepAssist(guide, locate, P, strength = 0.3) {
  return (ctl, car) => {
    const v = car.speed;
    const i = locate(car.x, car.z);
    const Ld = 8 + 0.35 * v;
    const j = (i + Math.round(Ld / 2)) % guide.n;
    const dx = guide.line[j].x - car.x;
    const dz = guide.line[j].z - car.z;
    const fwd = dx * Math.sin(car.yaw) + dz * Math.cos(car.yaw);
    const left = dx * Math.cos(car.yaw) - dz * Math.sin(car.yaw);
    const delta = Math.atan2(2 * P.wheelbase * Math.sin(Math.atan2(left, fwd)), Ld);
    ctl.assistSteer = delta * strength;
    return ctl;
  };
}

// 自動駕駛：沿建議路線，用鍵盤式操作（方向只有 -1/0/1、油門煞車只有 0/1）
// profile：'bot'、'human' 或 'person'
// brakeMode：'self'（自己依建議速度煞車）、'zone'（紅色且比建議速度快才煞）、'color'（只看路線顏色）、'none'（交給自動煞車）
export function createDriver(guide, P, profile = 'bot', brakeMode = 'self', overrides = {}) {
  const D = { ...DRIVER_PROFILES[profile], ...overrides };
  const { line, n } = guide;
  const locate = guide.locator();
  const keys = { steer: 0, throttle: 0, brake: 0 };
  const since = { steer: 1, throttle: 1, brake: 1 };
  const press = (name, want, dt) => {
    since[name] += dt;
    if (want !== keys[name] && since[name] >= D.minHold) {
      keys[name] = want;
      since[name] = 0;
    }
    return keys[name];
  };
  // 反應延遲：用「reaction 秒前」看到的車況做判斷
  const history = [];
  let clock = 0;
  const pwm = { t: 1, on: 0, dir: 0 };
  // 按住方向鍵時物理允許的最大打角（與 physics.js 的轉向輔助相同）
  const assistedMax = (v) => {
    const speedT = Math.pow(Math.min(v / 70, 1), 0.7);
    let m = (P.maxSteerDeg + (P.highSpeedSteerDeg - P.maxSteerDeg) * speedT) * DEG;
    if (P.steerAssist) m = Math.min(m, assistSteerLimit(P, v));
    return m;
  };

  function control(car, dt = 1 / 60) {
    clock += dt;
    history.push({ t: clock, x: car.x, z: car.z, yaw: car.yaw, speed: car.speed, vx: car.vx, vz: car.vz, r: car.r, spin: car.spinVel || 0, beta: car.beta || 0 });
    while (history.length > 2 && history[1].t <= clock - D.reaction) history.shift();
    const h = history[0];
    // 真人看到的是 reaction 秒前的畫面，但會依當時的移動與轉向趨勢預判現在的位置
    const T = D.reaction * (D.anticipate ?? 1);
    const seen = { x: h.x + (h.vx || 0) * T, z: h.z + (h.vz || 0) * T, yaw: h.yaw + (h.r || 0) * T, speed: h.speed };
    const v = seen.speed;
    const ri = locate(seen.x, seen.z);

    // 純追蹤（pure pursuit）：看向前方路線上的一點
    const Ld = D.lookBase + D.lookGain * v;
    const j = (ri + Math.round(Ld / 2)) % n;
    const dx = line[j].x - seen.x;
    const dz = line[j].z - seen.z;
    const fwd = dx * Math.sin(seen.yaw) + dz * Math.cos(seen.yaw);
    const left = dx * Math.cos(seen.yaw) - dz * Math.sin(seen.yaw);
    const delta = Math.atan2(2 * P.wheelbase * Math.sin(Math.atan2(left, fwd)), Ld);
    let wantSteer = delta > D.steerOn ? 1 : delta < -D.steerOn ? -1 : 0;
    let steerKey = null;
    if (D.pwm) {
      pwm.t += dt;
      if (pwm.t >= D.period) {
        pwm.t = 0;
        const duty = Math.min(1, (Math.abs(delta) / assistedMax(v)) * D.pwmGain);
        pwm.dir = Math.sign(delta);
        // 測試用：按錯方向
        if (D.randomSteer && Math.random() < D.randomSteer) pwm.dir = Math.random() < 0.5 ? -1 : 1;
        pwm.on = Math.abs(delta) < D.steerOn * 0.5 ? 0 : Math.max(D.minTap, duty * D.period);
      }
      steerKey = pwm.t < pwm.on ? pwm.dir : 0;
    }
    if (D.relay) {
      // 按住／放開：偏離超過 steerOn 才按，回到 steerOff 以內（或已經轉過頭）就放開；反向偏太多直接換邊
      let e = D.bearing ? Math.atan2(left, fwd) : delta;
      if (D.lead) {
        // 路線本身的轉動率（左轉為正）：前後 10 點切線的夾角 ÷ 20m × 車速
        const a = guide.tan[ri];
        const b = guide.tan[(ri + 10) % n];
        const rPath = (-(a.x * b.z - a.z * b.x) / 20) * v;
        e -= ((h.r || 0) - rPath) * D.lead;
      }
      const cur = keys.steer;
      if (cur === 0) wantSteer = e > D.steerOn ? 1 : e < -D.steerOn ? -1 : 0;
      else if (cur * e < -D.steerOn) wantSteer = -cur;
      else wantSteer = cur * e < D.steerOff ? 0 : cur;
    }
    // 測試用：模擬不熟練的玩家，有一定機率亂按方向鍵
    if (D.randomSteer && Math.random() < D.randomSteer) wantSteer = Math.random() < 0.5 ? -1 : 1;

    let wantBrake = 0;
    let wantThrottle = 1;
    const target = guide.speed[(ri + 2) % n];
    if (brakeMode === 'self') {
      wantBrake = v > target + 2 ? 1 : 0;
      wantThrottle = !wantBrake && v < target - 1 ? 1 : 0;
    } else if (brakeMode === 'color') {
      // 只看車子底下路線的顏色（動態：依當時車速）：紅＝煞車；黃＝coastYellow 時放開油門滑行；其他＝全油門
      const z = guideColor(guide, ri, v);
      wantBrake = z === 'brake' ? 1 : 0;
      wantThrottle = wantBrake || (D.coastYellow && z === 'corner') ? 0 : 1;
      // 沒有循跡控制時：看到（反應延遲後）後輪空轉或車尾滑出，就先放油
      if (!P.tractionControl && (h.spin > 1.5 || Math.abs(h.beta) > 0.07)) wantThrottle = 0;
    } else if (brakeMode === 'zone') {
      // 真人只看地上路線：紅色就踩煞車，其他時候踩油門
      wantBrake = guide.zone[ri] === 'brake' && v > target - 3 ? 1 : 0;
      wantThrottle = wantBrake ? 0 : 1;
    }
    return {
      steer: steerKey ?? press('steer', wantSteer, dt),
      throttle: press('throttle', wantThrottle, dt),
      brake: press('brake', wantBrake, dt),
      handbrake: false,
      analog: false,
      targetSpeed: target,
    };
  }

  return { control };
}

// 把賽車路線往中心線拉近一部分（每點找最近的中心線點做內插）
function blendLine(race, center, k) {
  if (!center || k <= 0) return race;
  let hint = 0;
  const m = center.length;
  return race.map((p) => {
    let best = hint;
    let bd = Infinity;
    for (let d = -40; d <= 40; d++) {
      const i = (((hint + d) % m) + m) % m;
      const dd = (p.x - center[i].x) ** 2 + (p.z - center[i].z) ** 2;
      if (dd < bd) {
        bd = dd;
        best = i;
      }
    }
    if (bd > 2500) {
      for (let i = 0; i < m; i++) {
        const dd = (p.x - center[i].x) ** 2 + (p.z - center[i].z) ** 2;
        if (dd < bd) {
          bd = dd;
          best = i;
        }
      }
    }
    hint = best;
    return { x: p.x + (center[best].x - p.x) * k, z: p.z + (center[best].z - p.z) * k };
  });
}
