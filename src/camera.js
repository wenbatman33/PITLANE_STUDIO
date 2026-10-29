// 鏡頭系統：展示間環繞、球座標飛行轉場、駕駛追車鏡頭（四種視角）
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CONFIG } from './config.js';
import { clamp, damp, lerp, smoothstep, EASES, DEG } from './util.js';

export const CHASE_MODES = ['追車', '遠景', '車手', '空拍'];
export const DRIVER_CAM = 2; // 車手視角（駕駛艙內、眼睛高度）

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
    this.chaseAng = null;
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
    if (this.chaseMode === DRIVER_CAM) {
      // 車手視角：眼睛位置固定在駕駛艙，看向正前方遠處
      out.pos = [phys.x + fx * C.driverCamForward, C.driverCamHeight, phys.z + fz * C.driverCamForward];
      out.look = [phys.x + fx * 40, C.driverCamLookHeight, phys.z + fz * 40];
      return out;
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
      if (this.chaseMode === DRIVER_CAM) {
        // 車手視角：剛性固定在車手眼睛位置（不平滑、不隨車速改變視角）
        const pose = this.chasePose(phys, _pose);
        this.chasePos.set(...pose.pos);
        this.lookPos.set(...pose.look);
        this.chaseAng = Math.atan2(-fx, -fz);
        fov = C.driverCamFov;
      } else {
        // 以車為圓心平滑「角度」而不是平滑位置，車子打轉時鏡頭不會切進車身
        // 鏡頭位置與注視點都固定在車子座標系內（只有方向角會平滑）：
        // 不在世界座標裡追車，否則車速越快落後越多，加速／換檔／掉幀時畫面會上下晃
        const pose = this.chasePose(phys, _pose);
        const desired = Math.atan2(pose.pos[0] - phys.x, pose.pos[2] - phys.z);
        const cur = this.chaseAng ?? Math.atan2(this.chasePos.x - phys.x, this.chasePos.z - phys.z);
        let dA = desired - cur;
        dA = Math.atan2(Math.sin(dA), Math.cos(dA));
        const ang = cur + dA * damp(C.chaseStiffness, dt);
        this.chaseAng = ang;
        const bx = Math.sin(ang);
        const bz = Math.cos(ang);
        if (this.chaseMode === 3) {
          this.chasePos.set(phys.x + bx * 6, C.heliHeight, phys.z + bz * 6);
          this.lookPos.set(phys.x, 0, phys.z);
          fov = 42;
        } else {
          // 距離固定：不隨加減速伸縮（換檔時會變成一下一下的晃動）
          const dist = Math.hypot(pose.pos[0] - phys.x, pose.pos[2] - phys.z);
          this.chasePos.set(phys.x + bx * dist, lerp(this.chasePos.y, pose.pos[1], damp(C.chaseStiffness, dt)), phys.z + bz * dist);
          this.lookPos.set(phys.x - bx * C.chaseLookAhead, C.chaseLookHeight, phys.z - bz * C.chaseLookAhead);
        }
      }
      cam.position.copy(this.chasePos);
      // 路緣石震動：每壓過一條凸起上下一次（只在壓到路緣石時、幅度很小；CONFIG.camera.curbShake = 0 可關）
      if (this.curb && this.curb.amount > 0.01 && C.curbShake > 0 && this.chaseMode !== 3) {
        this.curbPhase = ((this.curbPhase || 0) + dt * this.curb.rate) % 1;
        cam.position.y += Math.sin(this.curbPhase * Math.PI * 2) * C.curbShake * this.curb.amount;
      }
      // 震動：撞擊時的衝擊（bump）為主；高速／打滑震動預設關閉，用平滑正弦而非每幀亂數
      const skid = clamp((phys.slipR - 3) / 10, 0, 1);
      this.shake = Math.max(this.shake * Math.exp(-6 * dt), speedT * C.speedShake + skid * C.skidShake);
      if (this.chaseMode !== 3 && this.shake > 0.0005) {
        const t = performance.now() / 1000;
        cam.position.x += Math.sin(t * 37) * Math.sin(t * 11) * this.shake;
        cam.position.y += Math.sin(t * 29 + 1.3) * Math.sin(t * 7) * this.shake;
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
