// 入口：組裝場景、狀態機（展示間 ⇄ 駕駛）、主迴圈
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { HOTSPOT_ORDER } from './content.js';
import { buildCar } from './car.js';
import { loadCarModel } from './carModel.js';
import { createWorld } from './environment.js';
import { CarPhysics } from './physics.js';
import { Skidmarks, Smoke } from './fx.js';
import { EngineAudio } from './audio.js';
import { Input } from './input.js';
import { CameraRig, CHASE_MODES } from './camera.js';
import { UI } from './ui.js';
import { clamp, storageGet, storageSet } from './util.js';
import * as TX from './textures.js';
import { loadOverrides } from './overrides.js';

const STEP = 1 / 120;
const DEV_ENABLED = import.meta.env.DEV || new URLSearchParams(location.search).has('dev');

// ---------- 渲染器 ----------
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const camera = new THREE.PerspectiveCamera(CONFIG.camera.showroomFov, window.innerWidth / window.innerHeight, 0.05, 900);

// DEV 暫存的微調值要在建立場景前套用
let devApi = null;
if (DEV_ENABLED) loadOverrides();

const world = createWorld(renderer);
const { scene } = world;
const car = buildCar();
scene.add(car.root);

// 車底接觸陰影
const contactShadow = new THREE.Mesh(
  new THREE.PlaneGeometry(2.7, 6.4),
  new THREE.MeshBasicMaterial({ map: TX.createContactShadowTexture(), color: '#000', transparent: true, depthWrite: false, opacity: CONFIG.lighting.contactShadow }),
);
contactShadow.rotation.x = -Math.PI / 2;
contactShadow.position.set(0, 0.008, 0.1);
contactShadow.renderOrder = 2;
car.root.add(contactShadow);

// 物理參數沿用 CONFIG（DEV 可即時改），軸距則依實際載入的模型覆寫
const physParams = Object.create(CONFIG.physics);
const phys = new CarPhysics(physParams);
const skids = new Skidmarks(scene);
const smoke = new Smoke(scene);
const audio = new EngineAudio();
const input = new Input();
const rig = new CameraRig(camera, canvas);

// 物理位置（重心）與模型原點的偏移
const modelOffset = () => phys.a - car.axleOffset.front;
const resetCar = () => phys.reset(0, -modelOffset(), 0);
resetCar();

const game = {
  mode: 'loading',
  hotspot: null,
  revDemo: null,
  muted: storageGet('pitlane.muted', false),
  drift: { active: false, points: 0, mult: 1, timer: 0, idle: 0, total: 0, best: storageGet('pitlane.best', 0) },
  driveTime: 0,
  smokeAcc: 0,
  autopilot: null,
};

// ---------- UI ----------
const ui = new UI({
  onDrive: () => startDrive(),
  onHotspot: (id) => openHotspot(id),
  onCloseHotspot: () => closeHotspot(),
  onStepHotspot: (d) => {
    const i = HOTSPOT_ORDER.indexOf(game.hotspot);
    openHotspot(HOTSPOT_ORDER[(i + d + HOTSPOT_ORDER.length) % HOTSPOT_ORDER.length]);
  },
  onAction: (id) => hotspotAction(id),
  onLivery: (lv) => {
    Object.assign(CONFIG.car, { bodyColor: lv.body, accentColor: lv.accent, stripeColor: lv.stripe, helmetColor: lv.helmet });
    car.applyColors();
    devApi?.refresh();
  },
  onExitDrive: () => toShowroom(),
  onCamera: () => cycleCamera(),
  onReset: () => resetDrive(),
  onMute: () => toggleMute(),
});
ui.setMuteLabel(game.muted);
ui.setCameraLabel(CHASE_MODES[0]);
audio.setMuted(game.muted);
input.bindTouch({
  steerEl: document.querySelector('[data-ui="touchSteer"]'),
  knobEl: document.querySelector('.steer-knob'),
  gasEl: document.querySelector('[data-ui="touchGas"]'),
  brakeEl: document.querySelector('[data-ui="touchBrake"]'),
  driftEl: document.querySelector('[data-ui="touchDrift"]'),
});

function setMode(mode) {
  game.mode = mode;
  document.body.classList.remove('mode-loading', 'mode-showroom', 'mode-drive', 'mode-transit');
  document.body.classList.add(`mode-${mode === 'toDrive' || mode === 'toShowroom' ? 'transit' : mode}`);
}

// ---------- 展示間 ----------
function showroomView(duration = CONFIG.anim.tweenDuration) {
  const C = CONFIG.camera;
  rig.flyTo(C.showroomPos, C.showroomTarget, { duration, fov: C.showroomFov, onDone: () => rig.toOrbit() });
}

function openHotspot(id) {
  if (game.mode !== 'showroom') return;
  game.hotspot = id;
  ui.showInfo(id);
  const h = CONFIG.hotspots[id];
  const dist = Math.hypot(h.camPos[0] - h.camTarget[0], h.camPos[1] - h.camTarget[1], h.camPos[2] - h.camTarget[2]);
  rig.allowAutoRotate = false;
  rig.flyTo(h.camPos, h.camTarget, { fov: CONFIG.camera.showroomFov, onDone: () => rig.toOrbit(Math.min(CONFIG.camera.minDist, dist * 0.7)) });
}

function closeHotspot() {
  if (!game.hotspot) return;
  game.hotspot = null;
  ui.hideInfo();
  rig.allowAutoRotate = true;
  showroomView();
}

function hotspotAction(id) {
  if (id === 'drs') car.setDRS(!car.drsOpen);
  if (id === 'rev') startRevDemo();
  if (id === 'cockpitView') {
    rig.flyTo([0, 0.86, 0.1], [0, 0.6, 2.6], { fov: 62, onDone: () => rig.toOrbit(0.5) });
  }
}

// 展示間轟油門：用預錄的轉速曲線驅動合成引擎聲
function startRevDemo() {
  audio.unlock();
  audio.setMuted(game.muted);
  audio.setRunning(true);
  game.revDemo = { t: 0 };
}

function updateRevDemo(dt) {
  const r = game.revDemo;
  if (!r) return;
  r.t += dt;
  const keys = [
    [0, 4200, 0],
    [0.6, 4300, 0],
    [0.9, 11500, 1],
    [1.15, 6000, 0],
    [1.6, 4400, 0],
    [1.85, 12800, 1],
    [2.25, 13000, 1],
    [2.5, 5200, 0],
    [3.4, 4200, 0],
    [4.2, 4200, 0],
  ];
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1][0] < r.t) i++;
  const [t0, r0, th0] = keys[i];
  const [t1, r1] = keys[i + 1];
  const k = clamp((r.t - t0) / (t1 - t0), 0, 1);
  const rpm = r0 + (r1 - r0) * k;
  audio.update(dt, rpm, th0, 0);
  game.revRpm = rpm;
  if (r.t > 4.2) {
    game.revDemo = null;
    game.revRpm = 0;
    if (game.mode === 'showroom') audio.setRunning(false);
  }
}

// ---------- 駕駛 ----------
function startDrive() {
  if (game.mode !== 'showroom') return;
  audio.unlock();
  audio.setMuted(game.muted);
  audio.setRunning(true);
  game.revDemo = null;
  if (game.hotspot) {
    game.hotspot = null;
    ui.hideInfo();
  }
  car.setDRS(false);
  resetCar();
  world.cones.reset();
  world.cones.setVisible(true);
  setMode('toDrive');
  const pose = rig.chasePose(phys);
  rig.flyTo(pose.pos, pose.look, {
    duration: CONFIG.anim.tweenDuration * 1.15,
    fov: CONFIG.camera.chaseFov,
    onDone: () => {
      rig.startChase();
      setMode('drive');
      game.driveTime = 0;
      document.body.classList.remove('hint-faded');
    },
  });
}

function fade(cb) {
  const el = document.getElementById('fade');
  const t = CONFIG.anim.fadeTime;
  el.style.transition = `opacity ${t}s ease`;
  el.style.opacity = '1';
  setTimeout(() => {
    cb();
    el.style.opacity = '0';
  }, t * 1000 + 30);
}

function toShowroom() {
  if (game.mode !== 'drive') return;
  setMode('toShowroom');
  input.enabled = false;
  fade(() => {
    input.enabled = true;
    bankDrift();
    resetCar();
    smoke.clear();
    world.cones.reset();
    world.cones.setVisible(false);
    audio.setRunning(false);
    const C = CONFIG.camera;
    rig.jumpTo(C.showroomPos, C.showroomTarget, C.showroomFov);
    rig.allowAutoRotate = true;
    rig.toOrbit();
    setMode('showroom');
  });
}

function resetDrive() {
  if (game.mode !== 'drive') return;
  fade(() => {
    bankDrift();
    resetCar();
    skids.last = [];
    world.cones.reset();
    const pose = rig.chasePose(phys);
    rig.jumpTo(pose.pos, pose.look);
    rig.startChase();
  });
}

function cycleCamera() {
  rig.chaseMode = (rig.chaseMode + 1) % CHASE_MODES.length;
  ui.setCameraLabel(CHASE_MODES[rig.chaseMode]);
}

function toggleMute() {
  game.muted = !game.muted;
  storageSet('pitlane.muted', game.muted);
  audio.unlock();
  audio.setMuted(game.muted);
  ui.setMuteLabel(game.muted);
}

// ---------- 甩尾計分 ----------
function updateDrift(dt) {
  const d = game.drift;
  const ang = Math.abs(phys.beta);
  const drifting = phys.speed > 7 && ang > 0.2 && ang < 1.7 && phys.vF > 0;
  if (drifting) {
    d.active = true;
    d.idle = 0;
    d.timer += dt;
    d.points += phys.speed * ang * dt * 12;
    d.mult = 1 + Math.min(4, Math.floor(d.timer / 2.5));
  } else if (d.active) {
    d.idle += dt;
    if (ang >= 1.7 && phys.speed > 4) {
      ui.pop('SPIN！失去分數', true);
      Object.assign(d, { active: false, points: 0, mult: 1, timer: 0, idle: 0 });
    } else if (d.idle > 0.8) {
      bankDrift();
    }
  }
}

function bankDrift() {
  const d = game.drift;
  if (!d.active) return;
  const gained = Math.round(d.points * d.mult);
  if (gained > 20) {
    d.total += gained;
    ui.pop(`+${gained}`);
    if (gained > d.best) {
      d.best = gained;
      storageSet('pitlane.best', d.best);
    }
  }
  Object.assign(d, { active: false, points: 0, mult: 1, timer: 0, idle: 0 });
}

// ---------- 輪胎特效 ----------
const _wheelWorld = (w) => {
  const cs = Math.cos(phys.yaw);
  const sn = Math.sin(phys.yaw);
  const ox = car.root.position.x;
  const oz = car.root.position.z;
  return [ox + w.x * cs + w.z * sn, oz - w.x * sn + w.z * cs];
};

function updateTyreFx(dt) {
  const F = CONFIG.fx;
  const sp = phys.speed;
  let dx = Math.sin(phys.yaw);
  let dz = Math.cos(phys.yaw);
  if (sp > 0.5) {
    dx = phys.vx / sp;
    dz = phys.vz / sp;
  }
  let skidMax = 0;
  car.wheels.forEach((w, i) => {
    const slip = w.front ? phys.slipF : phys.slipR;
    const intensity = clamp((slip - F.skidThreshold) / 6, 0, 1);
    skidMax = Math.max(skidMax, intensity);
    const [x, z] = _wheelWorld(w);
    skids.add(i, x, z, dx, dz, w.width * F.skidWidthScale, intensity);
    if (!w.front && intensity > 0.15) {
      game.smokeAcc += intensity * 45 * F.smokeAmount * dt;
      while (game.smokeAcc >= 1) {
        game.smokeAcc -= 1;
        smoke.emit(x, 0.25, z, phys.vx, phys.vz, intensity);
      }
    }
  });
  skids.flush();
  return skidMax;
}

// ---------- 鍵盤快捷鍵 ----------
input.on('press', (k) => {
  if (k === 'Enter' && game.mode === 'showroom') startDrive();
  if (k === 'Escape') {
    if (game.mode === 'drive') toShowroom();
    else if (game.mode === 'showroom' && game.hotspot) closeHotspot();
  }
  if (game.mode === 'showroom' && game.hotspot && (k === 'ArrowRight' || k === 'ArrowLeft')) {
    const i = HOTSPOT_ORDER.indexOf(game.hotspot);
    const d = k === 'ArrowRight' ? 1 : -1;
    openHotspot(HOTSPOT_ORDER[(i + d + HOTSPOT_ORDER.length) % HOTSPOT_ORDER.length]);
  }
  if (game.mode === 'drive') {
    if (k === 'KeyC') cycleCamera();
    if (k === 'KeyR') resetDrive();
  }
  if (k === 'KeyM') toggleMute();
});

// ---------- 主迴圈 ----------
let lastTime = performance.now();
let acc = 0;
const focus = new THREE.Vector3();

function frame() {
  const now = performance.now();
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  if (game.mode === 'drive') {
    game.driveTime += dt;
    if (game.driveTime > 7) document.body.classList.add('hint-faded');
    let ctl = input.read();
    if (game.autopilot) ctl = game.autopilot(dt) || ctl;
    acc += dt;
    while (acc >= STEP) {
      phys.step(STEP, ctl);
      acc -= STEP;
    }
    const hits = world.cones.update(dt, phys);
    if (hits) {
      audio.hit();
      rig.bump(0.06);
    }
    const skid = updateTyreFx(dt);
    updateDrift(dt);
    audio.update(dt, phys.rpm, phys.throttle, skid);
    ui.updateHUD(phys, game.drift);
  } else {
    acc = 0;
    world.cones.update(dt, null);
    updateRevDemo(dt);
  }

  // 車子姿態
  const off = modelOffset();
  car.root.position.set(phys.x + Math.sin(phys.yaw) * off, 0, phys.z + Math.cos(phys.yaw) * off);
  car.root.rotation.y = phys.yaw;
  const driving = game.mode === 'drive';
  car.update(dt, driving ? phys : null, { idleShake: !!game.revDemo || game.mode === 'toDrive', rainLight: driving || game.mode === 'toDrive' });
  contactShadow.material.opacity = CONFIG.lighting.contactShadow;

  rig.update(dt, phys);
  smoke.update(dt, renderer, camera);
  focus.set(phys.x, 0, phys.z);
  world.update(focus);

  if (game.mode === 'showroom') ui.updateHotspots(camera, car, game.hotspot);

  renderer.render(scene, camera);
  devApi?.tick?.(dt);
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

// ---------- 啟動 ----------
async function boot() {
  try {
    await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
  } catch {
    /* 字型載入失敗不影響 */
  }
  car.applyColors(); // 字型到齊後重畫貼圖文字

  // 有放外部高精度模型就換上去
  const loaded = await loadCarModel(CONFIG.model.url);
  if (loaded) {
    car.useModel(loaded);
    if (loaded.wheelbase) physParams.wheelbase = loaded.wheelbase;
    resetCar();
    const credit = document.querySelector('[data-ui="credit"]');
    credit.textContent = CONFIG.model.creditText;
    credit.href = CONFIG.model.creditUrl;
    credit.hidden = false;
    // 外部模型的塗裝印在貼圖上；沒指定車漆材質時不提供換色
    document.body.classList.toggle('livery-locked', !CONFIG.model.paintMaterial);
  }
  world.cones.setVisible(false);
  const C = CONFIG.camera;
  rig.jumpTo(C.introFrom, C.showroomTarget, C.showroomFov);
  rig.allowAutoRotate = true;
  document.getElementById('loader').classList.add('done');
  setMode('showroom');
  rig.flyTo(C.showroomPos, C.showroomTarget, { duration: CONFIG.anim.introDuration, ease: 'easeOutCubic', onDone: () => rig.toOrbit() });

  if (DEV_ENABLED) {
    // 方便在 console 檢查場景
    window.__pitlane = { THREE, scene, car, camera, rig, phys, world };
    const { initDev } = await import('./dev.js');
    devApi = initDev({
      renderer,
      camera,
      scene,
      car,
      world,
      rig,
      ui,
      audio,
      phys,
      skids,
      game,
      actions: {
        showroom: () => (game.mode === 'drive' ? toShowroom() : closeHotspot()),
        drive: () => startDrive(),
        openHotspot,
        closeHotspot,
        hotspotAction,
        resetDrive,
        cycleCamera,
        showroomView,
        pop: (t, f) => ui.pop(t, f),
        setAutopilot: (fn) => (game.autopilot = fn),
      },
    });
  }
  frame();
}

boot();
