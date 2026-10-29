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
    this.spin = 0; // 後輪空轉程度（spinVel / 10）
    this.spinVel = 0; // 後輪面比地面快多少 m/s
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
    const brk = clamp(input.brake || 0, 0, 1);
    const hb = input.handbrake ? 1 : 0;
    this.throttle = thr;
    this.handbrake = hb;

    // 倒車切換：幾乎停住時按煞車進入倒車，按油門回到前進
    if (!this.reverse && brk > 0.1 && thr < 0.1 && Math.abs(vF) < 0.6) this.reverse = true;
    if (this.reverse && thr > 0.1 && vF > -0.6) this.reverse = false;
    const drive = this.reverse ? -brk : thr;
    const brakeIn = this.reverse ? thr : brk;

    // 轉向：高速時可打角變小；甩尾時允許反打到滑移角
    const beta = speed > 2 ? Math.atan2(vL, Math.abs(vF)) : 0;
    const speedT = Math.pow(clamp(speed / 70, 0, 1), 0.7);
    let maxSteer = lerp(P.maxSteerDeg, P.highSpeedSteerDeg, speedT) * DEG;
    maxSteer = Math.min(Math.max(maxSteer, Math.abs(beta) * 1.1), P.maxSteerDeg * DEG);
    const target = clamp(input.steer || 0, -1, 1);
    const returning = Math.abs(target) < Math.abs(this.steerInput) || Math.sign(target) !== Math.sign(this.steerInput);
    const rate = (returning ? P.steerReturn : P.steerRate) * dt;
    this.steerInput += clamp(target - this.steerInput, -rate, rate);
    const steer = this.steerInput * maxSteer;
    this.steer = steer;

    // 軸荷：靜態 + 下壓力 + 加減速重量轉移
    const down = P.downforce * speed * speed;
    const transfer = (m * this.accF * P.cgHeight) / L;
    const Nf = Math.max(300, m * G * P.frontWeight + down * 0.45 - transfer);
    const Nr = Math.max(300, m * G * (1 - P.frontWeight) + down * 0.55 + transfer);

    // 驅動力（後輪）
    let Fdrive = 0;
    if (drive > 0) {
      const powerLimited = (P.powerKW * 1000) / Math.max(Math.abs(vF), 1);
      Fdrive = drive * Math.min(P.maxDriveForce, powerLimited);
      if (this.shiftTimer > 0) Fdrive *= 0.35;
    } else if (drive < 0) {
      Fdrive = vF > -P.maxReverseSpeed ? drive * P.reverseForce : 0;
    }

    // 煞車（不超過四輪總抓地）
    const brakeMax = (P.muFront * Nf + P.muRear * Nr) * 0.98;
    let Fbrake = brakeIn * P.brakeForce;
    const lock = Fbrake > brakeMax ? Fbrake / brakeMax - 1 : 0;
    this.lock = lerp(this.lock, Math.abs(vF) > 1 ? lock : 0, damp(12, dt));
    Fbrake = Math.min(Fbrake, brakeMax);
    // 收油時的引擎煞車與滾動阻力
    if (Math.abs(drive) < 0.05) Fbrake += 650 + P.rollResist * 10;

    const vAbs = Math.max(Math.abs(vF), P.slipRefSpeed);
    const dir = vF >= 0 ? 1 : -1;

    // ---- 前輪：側滑角 + tanh 飽和 ----
    const alphaF = Math.atan2(vL + a * this.r, vAbs) - steer * dir;
    const frontMax = P.muFront * Nf * (lock > 0 ? 0.55 : 1);
    const FyF = -frontMax * Math.tanh((P.stiffFront * Nf * alphaF) / Math.max(frontMax, 1));

    // ---- 後輪：抓地狀態（牽引圓）與空轉／鎖死滑行狀態混合 ----
    const vRL = vL - b * this.r; // 後軸側向滑移速度
    const rearMax = P.muRear * Nr;
    const alphaR = Math.atan2(vRL, vAbs);
    const FyGrip = -rearMax * Math.tanh((P.stiffRear * Nr * alphaR) / rearMax);
    const longAvail = Math.sqrt(Math.max(0, rearMax * rearMax - FyGrip * FyGrip));
    let FxGrip = Fdrive;
    let excess = Math.abs(Fdrive) - longAvail;
    if (excess > 0) {
      FxGrip = Math.sign(Fdrive) * longAvail;
      if (P.tractionControl) excess = 0;
    }
    // 空轉速度（輪面比地面快多少 m/s），有遲滯讓甩尾能延續
    const spinTarget = drive > 0 && excess > 0 ? P.spinBase + (excess / rearMax) * P.spinGain : 0;
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

    const Fdrag = P.dragCoef * vF * Math.abs(vF);
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

    // 煞車沿車頭方向把速度拉向 0，不會反向
    const dv = (Fbrake / m) * dt;
    if (Math.abs(nvF) <= dv) nvF = 0;
    else nvF -= Math.sign(nvF) * dv;

    // 穩定輔助：把 yaw rate 輕微拉向方向盤要求的值
    const rKin = (nvF * Math.tan(steer)) / L;
    nr += (rKin - nr) * clamp(P.yawDamping * dt * (1 - hbBlend) * (1 - sBlend), 0, 1);

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

    // 輪胎側滑速度（給胎痕、煙、音效用）
    const vFa = Math.abs(nvF);
    this.slipF = Math.abs(Math.sin(alphaF)) * Math.hypot(vFa, nvL + a * nr) + this.lock * vFa * 0.8;
    this.slipR =
      Math.abs(Math.sin(alphaR)) * Math.hypot(vFa, nvL - b * nr) +
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
