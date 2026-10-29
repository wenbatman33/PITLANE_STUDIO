// 鏡頭系統：展示間環繞、球座標飛行轉場、駕駛追車鏡頭（四種視角）
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CONFIG } from './config.js';
import { clamp, damp, lerp, smoothstep, EASES, DEG } from './util.js';

export const CHASE_MODES = ['追車', '遠景', '車頂', '空拍'];

const _s1 = new THREE.Spherical();
const _s2 = new THREE.Spherical();
const _v = new THREE.Vector3();

export class CameraRig {
  constructor(camera, dom) {
    this.camera = camera;
    this.controls = new OrbitControls(camera, dom);
    const c = this.controls;
    c.enableDamping = true;
    c.dampingFactor = 0.07;
    c.enablePan = false;
    c.rotateSpeed = 0.7;
    c.zoomSpeed = 0.8;
    this.mode = 'orbit';
    this.tween = null;
    this.chaseMode = 0;
    this.chasePos = new THREE.Vector3();
    this.lookPos = new THREE.Vector3();
    this.lastInteraction = performance.now();
    this.shake = 0;
    this.detailMinDist = null;
    c.addEventListener('start', () => {
      this.lastInteraction = performance.now();
      this.dragging = true;
    });
    c.addEventListener('end', () => {
      this.lastInteraction = performance.now();
      this.dragging = false;
    });
    this.applyLimits();
  }

  applyLimits() {
    const C = CONFIG.camera;
    const c = this.controls;
    c.minDistance = this.detailMinDist ?? C.minDist;
    c.maxDistance = C.maxDist;
    c.maxPolarAngle = C.maxPolarDeg * DEG;
    c.autoRotateSpeed = C.autoRotateSpeed;
  }

  // 以注視點為中心做球座標插值，飛行路徑會繞著車而不是穿過車身
  flyTo(toPos, toTarget, { duration = CONFIG.anim.tweenDuration, ease = CONFIG.anim.tweenEase, fov = null, onDone = null } = {}) {
    this.mode = 'tween';
    this.controls.enabled = false;
    this.controls.autoRotate = false;
    this.tween = {
      t: 0,
      duration: Math.max(0.01, duration),
      ease: EASES[ease] || EASES.easeInOutCubic,
      fromPos: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      toPos: new THREE.Vector3(...toPos),
      toTarget: new THREE.Vector3(...toTarget),
      fromFov: this.camera.fov,
      toFov: fov ?? this.camera.fov,
      onDone,
    };
  }

  // 結束轉場後回到環繞模式
  toOrbit(detailMinDist = null) {
    this.mode = 'orbit';
    this.detailMinDist = detailMinDist;
    this.applyLimits();
    this.controls.enabled = true;
    this.controls.update();
    this.lastInteraction = performance.now();
  }

  jumpTo(pos, target, fov) {
    this.camera.position.set(...pos);
    this.controls.target.set(...target);
    if (fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.lookAt(this.controls.target);
  }

  startChase() {
    this.mode = 'chase';
    this.controls.enabled = false;
    this.chasePos.copy(this.camera.position);
    this.lookPos.copy(this.controls.target);
  }

  // 依目前車況算出追車鏡頭的理想位置（轉場起點也用這個）
  chasePose(phys, out = {}) {
    const C = CONFIG.camera;
    const fx = Math.sin(phys.yaw);
    const fz = Math.cos(phys.yaw);
    let dx = fx;
    let dz = fz;
    if (phys.speed > 3 && phys.vF > 0) {
      const k = C.chaseSlipFollow * smoothstep(3, 12, phys.speed);
      dx = lerp(fx, phys.vx / phys.speed, k);
      dz = lerp(fz, phys.vz / phys.speed, k);
      const n = Math.hypot(dx, dz) || 1;
      dx /= n;
      dz /= n;
    }
    let dist = C.chaseDist;
    let height = C.chaseHeight;
    if (this.chaseMode === 1) {
      dist *= C.farDistScale;
      height *= C.farHeightScale;
    }
    out.pos = [phys.x - dx * dist, height, phys.z - dz * dist];
    out.look = [phys.x + fx * C.chaseLookAhead, C.chaseLookHeight, phys.z + fz * C.chaseLookAhead];
    return out;
  }

  update(dt, phys) {
    const cam = this.camera;
    if (this.mode === 'tween' && this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + dt / tw.duration);
      const k = tw.ease(tw.t);
      const target = _v.lerpVectors(tw.fromTarget, tw.toTarget, k);
      _s1.setFromVector3(tw.fromPos.clone().sub(tw.fromTarget));
      _s2.setFromVector3(tw.toPos.clone().sub(tw.toTarget));
      let dTheta = _s2.theta - _s1.theta;
      if (dTheta > Math.PI) dTheta -= Math.PI * 2;
      if (dTheta < -Math.PI) dTheta += Math.PI * 2;
      const sph = new THREE.Spherical(lerp(_s1.radius, _s2.radius, k), lerp(_s1.phi, _s2.phi, k), _s1.theta + dTheta * k);
      cam.position.setFromSpherical(sph).add(target);
      this.controls.target.copy(target);
      cam.fov = lerp(tw.fromFov, tw.toFov, k);
      cam.updateProjectionMatrix();
      cam.lookAt(target);
      if (tw.t >= 1) {
        this.tween = null;
        tw.onDone?.();
      }
      return;
    }

    if (this.mode === 'orbit') {
      const idle = (performance.now() - this.lastInteraction) / 1000;
      this.controls.autoRotate = this.allowAutoRotate && idle > CONFIG.anim.idleAutoRotate;
      this.controls.update();
      return;
    }

    if (this.mode === 'chase' && phys) {
      const C = CONFIG.camera;
      const fx = Math.sin(phys.yaw);
      const fz = Math.cos(phys.yaw);
      const speedT = clamp(phys.speed / 90, 0, 1);
      let fov = C.chaseFov + C.chaseFovSpeedGain * speedT;
      if (this.chaseMode === 2) {
        // 車頂鏡頭：剛性固定在進氣口上方
        const x = phys.x + fx * (C.tcamForward + 0.2);
        const z = phys.z + fz * (C.tcamForward + 0.2);
        this.chasePos.set(x, C.tcamHeight, z);
        this.lookPos.set(phys.x + fx * 25, 0.5, phys.z + fz * 25);
        fov += 8;
      } else if (this.chaseMode === 3) {
        _v.set(phys.x - fx * 6, C.heliHeight, phys.z - fz * 6);
        this.chasePos.lerp(_v, damp(3, dt));
        this.lookPos.lerp(_v.set(phys.x + phys.vx * 0.3, 0, phys.z + phys.vz * 0.3), damp(5, dt));
        fov = 42;
      } else {
        // 以車為圓心平滑「角度」而不是平滑位置，車子打轉時鏡頭不會切進車身
        const pose = this.chasePose(phys, _pose);
        const desired = Math.atan2(pose.pos[0] - phys.x, pose.pos[2] - phys.z);
        const cur = Math.atan2(this.chasePos.x - phys.x, this.chasePos.z - phys.z);
        let dA = desired - cur;
        dA = Math.atan2(Math.sin(dA), Math.cos(dA));
        const ang = cur + dA * damp(C.chaseStiffness, dt);
        // 距離不做位置平滑（否則高速時會越拖越遠），只依加減速做輕微伸縮
        this.distOffset = lerp(this.distOffset || 0, clamp(phys.accF * 0.06, -0.8, 1.0), damp(3, dt));
        const dist = Math.hypot(pose.pos[0] - phys.x, pose.pos[2] - phys.z) + this.distOffset;
        this.chasePos.set(
          phys.x + Math.sin(ang) * dist,
          lerp(this.chasePos.y, pose.pos[1], damp(C.chaseStiffness, dt)),
          phys.z + Math.cos(ang) * dist,
        );
        this.lookPos.lerp(_v.set(...pose.look), damp(C.chaseStiffness * 1.6, dt));
      }
      cam.position.copy(this.chasePos);
      // 高速與滑行時的輕微震動
      const skid = clamp((phys.slipR - 3) / 10, 0, 1);
      this.shake = Math.max(this.shake * Math.exp(-6 * dt), speedT * 0.012 + skid * 0.02);
      if (this.chaseMode !== 3) {
        cam.position.x += (Math.random() - 0.5) * this.shake;
        cam.position.y += (Math.random() - 0.5) * this.shake;
      }
      cam.lookAt(this.lookPos);
      cam.fov = lerp(cam.fov, fov, damp(4, dt));
      cam.updateProjectionMatrix();
    }
  }

  bump(amount) {
    this.shake = Math.max(this.shake, amount);
  }
}

const _pose = {};
