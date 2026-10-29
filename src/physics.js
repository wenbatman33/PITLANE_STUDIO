// 賽車物理：雙軸（bicycle）模型 + 輪胎飽和 + 後輪牽引圓，可甩尾、原地轉圈
// 座標：車頭朝 +Z，yaw 為繞 Y 軸角度；左轉 = yaw 增加；左方 = (cos yaw, -sin yaw)
import { clamp, lerp, smoothstep, damp, DEG } from './util.js';

const G = 9.81;
const GEAR_TOP_KMH = [0, 92, 128, 162, 196, 230, 264, 298, 345];
const MAX_RPM = 13200;
const IDLE_RPM = 4200;

export class CarPhysics {
  constructor(params) {
    this.P = params;
    this.reset();
  }

  reset(x = 0, z = 0, yaw = 0) {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.vx = 0;
    this.vz = 0;
    this.r = 0; // yaw rate
    this.steerInput = 0;
    this.steerAngle = 0; // 鍵盤轉向的實際前輪角（rad）
    this.steer = 0; // 前輪實際角度（rad）
    this.vF = 0;
    this.vL = 0;
    this.speed = 0;
    this.kmh = 0;
    this.beta = 0; // 車身滑移角
    this.accF = 0;
    this.accL = 0;
    this.gear = 0;
    this.rpm = IDLE_RPM;
    this.shiftTimer = 0;
    this.shiftEvent = 0;
    this.reverse = false;
    this.brakePedal = 0;
    this.keyGrip = 1; // 目前可用側向抓地 ÷ 不煞車時的側向抓地（鍵盤轉向上限用）
    this.ayCap = 99; // 前後輪目前都撐得住的最大側向加速度 m/s²
    this.spin = 0; // 後輪空轉程度（spinVel / 10）
    this.spinVel = 0; // 後輪面比地面快多少 m/s
    // 路面狀態（出界壓到草地時由外部設定）：抓地倍率、額外線性阻力 N/(m/s)
    this.surfaceGrip = 1;
    this.surfaceDrag = 0;
    this.lock = 0; // 煞車鎖死程度
    this.handbrake = 0;
    this.throttle = 0;
    this.slipF = 0; // 前軸側滑速度 m/s
    this.slipR = 0;
    this.wheelOmegaF = 0;
    this.wheelOmegaR = 0;
  }

  get a() {
    return this.P.wheelbase * (1 - this.P.frontWeight);
  }

  get b() {
    return this.P.wheelbase * this.P.frontWeight;
  }

  step(dt, input) {
    const P = this.P;
    const m = P.mass;
    const L = P.wheelbase;
    const a = this.a;
    const b = this.b;

    const cs = Math.cos(this.yaw);
    const sn = Math.sin(this.yaw);
    const vF = this.vx * sn + this.vz * cs;
    const vL = this.vx * cs - this.vz * sn;
    const speed = Math.hypot(this.vx, this.vz);

    const thr = clamp(input.throttle || 0, 0, 1);
    const hb = input.handbrake ? 1 : 0;
    // 鍵盤煞車像踏板一樣漸進：約 0.2 秒踩到底、放開較快；手把類比直接跟隨
    const brkTarget = clamp(input.brake || 0, 0, 1);
    if (input.analog) this.brakePedal = brkTarget;
    else {
      const r = (brkTarget > this.brakePedal ? P.brakeRampUp : P.brakeRampDown) * dt;
      this.brakePedal += clamp(brkTarget - this.brakePedal, -r, r);
    }
    const brk = this.brakePedal;
    this.throttle = thr;
    this.handbrake = hb;

    // 倒車：只有按住倒車鍵（X）且車子幾乎停住時才會倒退；煞車鍵永遠只是煞車
    if (!this.reverse && input.reverse && Math.abs(vF) < 1) this.reverse = true;
    if (this.reverse && !input.reverse) this.reverse = false;
    const drive = this.reverse ? -1 : thr;
    const brakeIn = brk;

    // 轉向：高速時可打角變小；甩尾時允許反打到滑移角
    const beta = speed > 2 ? Math.atan2(vL, Math.abs(vF)) : 0;
    const speedT = Math.pow(clamp(speed / 70, 0, 1), 0.7);
    let maxSteer = lerp(P.maxSteerDeg, P.highSpeedSteerDeg, speedT) * DEG;
    // 轉向輔助（鍵盤）：按住方向鍵最多只打到「當下速度最能抓地」的角度
    // = 幾何轉角（依可用側向抓地與下壓力）+ 輪胎最佳滑移角；過彎只要按住，不用連點
    // 煞車時前輪抓地力被煞車用掉一部分（摩擦圓），上限也跟著縮小；放開煞車後逐漸恢復，避免車頭突然被拉進去
    if (P.steerAssist && !input.analog) {
      maxSteer = Math.min(maxSteer, assistSteerLimit(P, speed, this.keyGrip));
    }
    // 只有「反打」（方向盤朝滑出方向）時才放寬打角，順著彎道一直按不會越打越大
    const counter = Math.sign(input.steer || 0) === Math.sign(beta) && Math.abs(beta) > 0.05;
    if (counter) maxSteer = Math.min(Math.max(maxSteer, Math.abs(beta) * 1.1), P.maxSteerDeg * DEG);
    // 鍵盤是數位輸入：按住才逐漸加大打角，速度越快加得越慢；輕點只會轉一點點
    // 觸控、手把是類比輸入，直接跟隨（只做輕微平滑）
    const target = clamp(input.steer || 0, -1, 1);
    const returning = Math.abs(target) < Math.abs(this.steerInput) || Math.sign(target) !== Math.sign(this.steerInput);
    const rateT = clamp((speed - 12) / 50, 0, 1); // 約 43 km/h 以下用低速打角速度，220 km/h 以上用高速打角速度
    const buildRate = input.analog ? P.steerRate * 3 : lerp(P.steerRate, P.steerRateHigh, rateT);
    // 回正：高速時下壓力壓在前輪、回正力矩大，方向盤被拉正得更快；低速較柔
    const returnRate = lerp(P.steerReturn, P.steerReturnHigh ?? P.steerReturn, rateT);
    const rate = (returning ? returnRate : buildRate) * dt;
    this.steerInput += clamp(target - this.steerInput, -rate, rate);
    // 轉向曲線：小角度區間解析度更高，微調比較容易
    const shaped = Math.sign(this.steerInput) * Math.pow(Math.abs(this.steerInput), P.steerCurve);
    let steer = shaped * maxSteer;
    // 鍵盤轉向：按住時「側向加速度」以固定速度增加（打角速度 ∝ 1/v²）
    // 低速打角快（減速彎來得及左右換），高速輕點只動零點幾度（不會一點就甩出去）
    if (!input.analog && P.steerJerk > 0) {
      const v2 = Math.max(speed * speed, 1);
      const build = clamp((P.steerJerk * L) / v2, P.steerRateMinDeg * DEG, P.steerRateMaxDeg * DEG) * dt;
      const goal = target * maxSteer;
      const back = Math.abs(goal) < Math.abs(this.steerAngle) || Math.sign(goal) !== Math.sign(this.steerAngle);
      const step = back ? build * P.steerReturnMul : build;
      this.steerAngle += clamp(goal - this.steerAngle, -step, step);
      // 高速時最大打角變小，已打的角度也要跟著收
      this.steerAngle = clamp(this.steerAngle, -maxSteer, maxSteer);
      steer = this.steerAngle;
    } else {
      this.steerAngle = steer;
    }
    // 循跡穩定輔助：額外加上的修正角度（rad），不影響玩家的鍵盤轉向處理
    if (input.assistSteer) steer = clamp(steer + input.assistSteer, -P.maxSteerDeg * DEG, P.maxSteerDeg * DEG);
    this.steer = steer;

    // 軸荷：靜態 + 下壓力 + 加減速重量轉移
    const down = P.downforce * speed * speed;
    const transfer = (m * this.accF * P.cgHeight) / L;
    const aeroF = P.aeroFront ?? 0.45; // 下壓力前軸分配
    const Nf = Math.max(300, m * G * P.frontWeight + down * aeroF - transfer);
    const Nr = Math.max(300, m * G * (1 - P.frontWeight) + down * (1 - aeroF) + transfer);

    // 驅動力（後輪）
    let Fdrive = 0;
    if (drive > 0) {
      const powerLimited = (P.powerKW * 1000) / Math.max(Math.abs(vF), 1);
      Fdrive = drive * Math.min(P.maxDriveForce, powerLimited);
      if (this.shiftTimer > 0) Fdrive *= 0.65;
    } else if (drive < 0) {
      Fdrive = vF > -P.maxReverseSpeed ? drive * P.reverseForce : 0;
    }

    // 煞車（不超過四輪總抓地）
    const muF = P.muFront * this.surfaceGrip;
    const muR = P.muRear * this.surfaceGrip;
    const brakeMax = (muF * Nf + muR * Nr) * 0.98;
    let Fbrake = brakeIn * P.brakeForce;

    const vAbs = Math.max(Math.abs(vF), P.slipRefSpeed);
    const dir = vF >= 0 ? 1 : -1;
    const alphaF = Math.atan2(vL + a * this.r, vAbs) - steer * dir;
    const vRL = vL - b * this.r; // 後軸側向滑移速度
    const alphaR = Math.atan2(vRL, vAbs);
    const bias = P.brakeBias ?? 0.6;
    const frontMaxFull = muF * Nf;
    const rearMaxFull = muR * Nr;

    if (P.abs) {
      // ABS：煞車力上限略低於抓地極限，輪胎不鎖死、仍能轉向
      Fbrake = Math.min(Fbrake, brakeMax * 0.92);
      // 彎道 ABS（等同真實車手的循跡煞車：邊轉邊收煞車）：輪胎正在轉彎時，煞車只用剩下的抓地力
      // 前後輪各自保留目前轉彎需要的側向抓地；至少保留 cornerBrakeMin 的煞車，轉彎中踩煞車仍會減速
      const needF = Math.tanh(Math.abs(P.stiffFront * Nf * alphaF) / frontMaxFull);
      const needR = Math.tanh(Math.abs(P.stiffRear * Nr * alphaR) / rearMaxFull);
      const keep = P.cornerBrakeMin ?? 0.4;
      const capF = (frontMaxFull * 0.97 * Math.max(keep, Math.sqrt(1 - needF * needF))) / bias;
      const capR = (rearMaxFull * 0.97 * Math.max(keep, Math.sqrt(1 - needR * needR))) / (1 - bias);
      Fbrake = Math.min(Fbrake, capF, capR);
    }
    const lock = Fbrake > brakeMax ? Fbrake / brakeMax - 1 : 0;
    this.lock = lerp(this.lock, Math.abs(vF) > 1 ? lock : 0, damp(12, dt));
    Fbrake = Math.min(Fbrake, brakeMax);
    // 收油時的引擎煞車與滾動阻力
    if (Math.abs(drive) < 0.05) Fbrake += 650 + P.rollResist * 10;

    // ---- 前輪：側滑角 + tanh 飽和 ----
    // 摩擦圓：煞車用掉的抓地力要從轉向能力扣掉（煞車力依前後分配）
    const frontMax = frontMaxFull * (lock > 0 ? 0.55 : 1);
    const FbF = Math.min(Fbrake * bias, frontMax * 0.97);
    const frontLat = Math.sqrt(Math.max(frontMax * frontMax * 0.04, frontMax * frontMax - FbF * FbF));
    const FyF = -frontLat * Math.tanh((P.stiffFront * Nf * alphaF) / Math.max(frontLat, 1));

    // ---- 後輪：抓地狀態（牽引圓）與空轉／鎖死滑行狀態混合 ----
    const FbR = Math.min(Fbrake * (1 - bias), rearMaxFull * 0.97);
    const rearMax = Math.sqrt(Math.max(rearMaxFull * rearMaxFull * 0.04, rearMaxFull * rearMaxFull - FbR * FbR));

    // 前後輪目前都撐得住的最大側向加速度（穩態過彎：前軸分擔 b/L、後軸分擔 a/L）
    // 煞車時重量往前移、後輪又分到煞車力，後輪會先到極限 —— 這就是「邊煞邊轉車尾滑出」的來源
    this.ayCap = Math.min((frontLat * L) / (m * b), (rearMax * L) / (m * a));
    // 不煞車、不加減速時的同一個值，用來算比例
    const NfS = m * G * P.frontWeight + down * aeroF;
    const NrS = m * G * (1 - P.frontWeight) + down * (1 - aeroF);
    const ayCap0 = Math.min((muF * NfS * L) / (m * b), (muR * NrS * L) / (m * a));
    // 下一步鍵盤轉向上限用：變小立刻跟上、變大（放開煞車）慢慢恢復，車頭不會突然被拉進去
    const gripNow = clamp(this.ayCap / Math.max(ayCap0, 1), 0.05, 1);
    this.keyGrip = gripNow < this.keyGrip ? gripNow : lerp(this.keyGrip, gripNow, damp(P.steerGripRecover ?? 3, dt));
    const FyGrip = -rearMax * Math.tanh((P.stiffRear * Nr * alphaR) / rearMax);
    const longAvail = Math.sqrt(Math.max(0, rearMax * rearMax - FyGrip * FyGrip));
    let FxGrip = Fdrive;
    let excess = Math.abs(Fdrive) - longAvail;
    if (excess > 0) {
      FxGrip = Math.sign(Fdrive) * longAvail;
      if (P.tractionControl) excess = 0;
    }
    // 空轉速度（輪面比地面快多少 m/s），有遲滯讓甩尾能延續
    const spinTarget = drive > 0 && excess > 0 ? P.spinBase * Math.min(1, excess / (rearMax * 0.1)) + (excess / rearMax) * P.spinGain : 0;
    const spinRate = spinTarget > this.spinVel ? 70 : 32;
    this.spinVel += clamp(spinTarget - this.spinVel, -spinRate * dt, spinRate * dt);
    const slideMu = rearMax * 0.92;
    const sMag = Math.hypot(this.spinVel, vRL) || 1;
    const sBlend = smoothstep(0, P.spinBlend, this.spinVel);
    let FxR = lerp(FxGrip, (slideMu * this.spinVel) / sMag, sBlend);
    let FyR = lerp(FyGrip, (-slideMu * vRL) / sMag, sBlend);

    // 手煞車：後輪鎖死，力沿接地點速度反方向
    let hbBlend = 0;
    if (hb) {
      hbBlend = smoothstep(0.3, 2, Math.abs(vF));
      const hbMu = rearMax * P.handbrakeGrip;
      const vm = Math.hypot(vF, vRL) || 1;
      FxR = lerp(FxR, (-hbMu * vF) / vm, hbBlend);
      FyR = lerp(FyR, (-hbMu * vRL) / vm, hbBlend);
    }
    this.spin = this.spinVel / 10;

    const Fdrag = P.dragCoef * vF * Math.abs(vF) + this.surfaceDrag * vF;
    const Fx = FxR - Fdrag - FyF * Math.sin(steer);
    const Fy = FyR + FyF * Math.cos(steer);
    const torque = a * FyF * Math.cos(steer) - b * FyR;
    const I = m * a * b * P.inertiaScale;

    // 世界座標積分
    const aF = Fx / m;
    const aL = Fy / m;
    let nvx = this.vx + (aF * sn + aL * cs) * dt;
    let nvz = this.vz + (aF * cs - aL * sn) * dt;
    let nr = this.r + (torque / I) * dt;

    let nvF = nvx * sn + nvz * cs;
    let nvL = nvx * cs - nvz * sn;

    // 煞車沿「行進方向」減速（前進與側向速度等比例縮小），不會反向
    // 只減車頭方向的速度會讓側向速度相對變大，邊煞邊轉時車尾被硬推出去而打轉
    const dv = (Fbrake / m) * dt;
    const vNow = Math.hypot(nvF, nvL);
    if (vNow <= dv) {
      nvF = 0;
      nvL = 0;
    } else {
      const k = 1 - dv / vNow;
      nvF *= k;
      nvL *= k;
    }

    // 穩定輔助：把 yaw rate 輕微拉向方向盤要求的值
    const rKin = (nvF * Math.tan(steer)) / L;
    // 拉向的目標不超過輪胎做得到的轉速（高速時方向盤角度換算的轉速遠大於抓地極限，硬拉會把車尾甩出去）
    const rFeasible = this.ayCap / Math.max(Math.abs(nvF), 1);
    nr += (clamp(rKin, -rFeasible, rFeasible) - nr) * clamp(P.yawDamping * dt * (1 - hbBlend) * (1 - sBlend), 0, 1);

    // 車身穩定（ESC）：車尾滑出超過門檻就把偏航拉回來；手煞車時與放開後 0.8 秒內停用，保留甩尾
    this.hbCooldown = hb ? 0.8 : Math.max(0, (this.hbCooldown || 0) - dt);
    if (P.esc > 0 && this.hbCooldown <= 0 && speed > 6) {
      const thr = P.escThresholdDeg * DEG;
      const bNow = Math.atan2(nvL, Math.abs(nvF));
      const excessB = bNow - clamp(bNow, -thr, thr);
      nr += P.esc * excessB * dt * 10;
      nvL -= nvL * Math.min(1, P.esc * Math.abs(excessB) * dt);
    }

    // 低速改用運動學模型，避免側滑角在靜止附近抖動；空轉或手煞車時維持動態
    const w = Math.max(smoothstep(P.lowSpeedBlendStart, P.lowSpeedBlendEnd, speed), sBlend, hbBlend);
    nr = lerp(rKin, nr, w);
    nvL = lerp(nvL * Math.exp(-14 * dt), nvL, w);

    this.vx = nvF * sn + nvL * cs;
    this.vz = nvF * cs - nvL * sn;
    this.r = nr;
    this.yaw += nr * dt;
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    this.accF = lerp(this.accF, (nvF - vF) / dt, damp(10, dt));
    this.accL = lerp(this.accL, nvF * nr + (nvL - vL) / dt, damp(10, dt));
    this.vF = nvF;
    this.vL = nvL;
    this.speed = Math.hypot(this.vx, this.vz);
    this.kmh = this.speed * 3.6;
    this.beta = this.speed > 2 ? Math.atan2(nvL, Math.abs(nvF)) : 0;

    // 輪胎「真的在滑」的速度（給胎痕、煙、音效用）：只算超過抓地極限（tanh 飽和約 96%）的那部分滑移角
    // 正常過彎輪胎本來就有幾度滑移角，那是抓地狀態，不會留胎痕
    const vFa = Math.abs(nvF);
    const peakF = (2 * frontLat) / Math.max(P.stiffFront * Nf, 1);
    const peakR = (2 * rearMax) / Math.max(P.stiffRear * Nr, 1);
    this.slipF = Math.sin(Math.max(0, Math.abs(alphaF) - peakF)) * Math.hypot(vFa, nvL + a * nr) + this.lock * vFa * 0.8;
    this.slipR =
      Math.sin(Math.max(0, Math.abs(alphaR) - peakR)) * Math.hypot(vFa, nvL - b * nr) +
      this.spinVel +
      this.lock * vFa * 0.8 +
      hbBlend * vFa * 0.5;

    // 輪子角速度（視覺用）
    const radius = 0.36;
    this.wheelOmegaF = this.lock > 0.05 ? 0 : nvF / radius;
    const rearLocked = (hb && vFa > 0.5) || this.lock > 0.05;
    this.wheelOmegaR = rearLocked ? 0 : (nvF + this.spinVel) / radius;

    this.updateGearbox(dt, drive);
  }

  updateGearbox(dt, drive) {
    const P = this.P;
    this.shiftTimer = Math.max(0, this.shiftTimer - dt);
    const kmh = Math.abs(this.vF) * 3.6;

    if (this.reverse) {
      this.gear = -1;
    } else if (kmh < 3 && drive <= 0.05) {
      this.gear = 0;
    } else {
      if (this.gear < 1) this.gear = 1;
      const rpmInGear = (MAX_RPM * kmh) / GEAR_TOP_KMH[this.gear];
      if (rpmInGear > P.autoShiftUp && this.gear < 8 && this.spin < 0.2) {
        this.gear++;
        this.shiftTimer = 0.08;
        this.shiftEvent++;
      } else if (this.gear > 1 && rpmInGear < P.autoShiftDown) {
        this.gear--;
        this.shiftEvent++;
      }
    }

    let target;
    if (this.gear <= 0) {
      target =
        this.gear === -1
          ? IDLE_RPM + Math.min(1, kmh / (P.maxReverseSpeed * 3.6)) * 7000
          : IDLE_RPM + Math.abs(drive) * 6500;
    } else {
      target = Math.max(IDLE_RPM, (MAX_RPM * kmh) / GEAR_TOP_KMH[this.gear]);
      target += this.spin * 4500;
    }
    target = Math.min(target, MAX_RPM);
    this.rpm = lerp(this.rpm, target, damp(this.shiftTimer > 0 ? 30 : 14, dt));
  }
}

export const RPM_LIMITS = { idle: IDLE_RPM, max: MAX_RPM };

// 轉向輔助：按住方向鍵時允許的最大前輪角
// 依「這個速度要拉多少側向 G」算：幾何轉角 + 輪胎在該側向力下需要的滑移角
// 側向 G 取「抓地極限 × steerAssistGrip」與「steerAssistMaxG」較小者 —— 高速時不會一按就是 6G 急轉
// grip：前輪剩餘側向抓地比例（煞車時 < 1）
export function assistSteerLimit(P, speed, grip = 1) {
  const v2 = Math.max(speed * speed, 1);
  const ayMax = grip * P.muFront * (G + (P.downforce * v2) / P.mass);
  // 低速用 steerAssistGrip（低速打角快，給太多真人會轉過頭）；高速漸變到 steerAssistGripHigh（方向盤重、連續彎要拉得住）
  const t = clamp((speed - (P.steerGripLowSpeed ?? 25)) / ((P.steerGripHighSpeed ?? 55) - (P.steerGripLowSpeed ?? 25)), 0, 1);
  const k = lerp(P.steerAssistGrip, P.steerAssistGripHigh ?? P.steerAssistGrip, t);
  const ay = Math.min(k * ayMax, P.steerAssistMaxG * G);
  const ratio = Math.min(ay / ayMax, 0.95);
  const slip = Math.atanh(ratio) * grip * (P.muFront / P.stiffFront) * P.steerAssistSlip;
  return Math.atan((P.wheelbase * ay) / v2) + slip;
}
