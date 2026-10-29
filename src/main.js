// 入口：組裝場景、狀態機（展示間 ⇄ 駕駛）、主迴圈
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { HOTSPOT_ORDER, LEVELS } from './content.js';
import { buildCar } from './car.js';
import { loadCarModel } from './carModel.js';
import { createWorld } from './environment.js';
import { CarPhysics } from './physics.js';
import { Skidmarks, Smoke } from './fx.js';
import { EngineAudio } from './audio.js';
import { Input } from './input.js';
import { CameraRig, CHASE_MODES, DRIVER_CAM } from './camera.js';
import { UI } from './ui.js';
import { clamp, storageGet, storageSet } from './util.js';
import * as TX from './textures.js';
import { loadOverrides } from './overrides.js';
import { createTrack, TRACKS } from './track.js';
import { createRace } from './race.js';
import { createRaceView } from './raceView.js';
import { LapTimer, formatTime } from './timing.js';
import { createGuide, createDriver, brakeAssist, steerAssist, lineKeepAssist, heavyBrakeEntries } from './autopilot.js';
import { createGuideLine } from './guideLine.js';

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

const camera = new THREE.PerspectiveCamera(CONFIG.camera.showroomFov, window.innerWidth / window.innerHeight, 0.1, 900);

// DEV 暫存的微調值要在建立場景前套用
let devApi = null;
if (DEV_ENABLED) loadOverrides();

const world = createWorld(renderer);

// 真實賽道：白色地面上只放賽道，不放三角錐與展示間地標
// 賽道：展示間選單選的那條（記在 localStorage），沒有就用設定檔預設
const savedTrack = storageGet('pitlane.track', CONFIG.track.id);
const trackId = TRACKS[savedTrack] ? savedTrack : CONFIG.track.id;
const track = CONFIG.track.enabled ? createTrack(world.scene, trackId) : null;
const timer = track ? new LapTimer(track) : null;
if (track) {
  world.mark.visible = false;
  // 地面往下移，避免遠處賽道與地面深度互搶（閃爍）
  world.ground.position.y = -0.03;
}
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
  // 計時練習（practice）或對手比賽（race）
  session: storageGet('pitlane.session', 'practice') === 'race' ? 'race' : 'practice',
  racing: false,
};

// ---------- 對手比賽（AI 對手同場、有碰撞；第一次進入比賽時才建立） ----------
let race = null;
let raceView = null;
let loadedModel = null;
function ensureRace() {
  if (race || !track?.raceline) return;
  race = createRace({ track, player: phys, P: physParams, raceline: track.raceline, center: track.points, physOffset: modelOffset() });
  raceView = createRaceView(world.scene, race, loadedModel, (c, v) => c.a - v.axleOffset.front, document.getElementById('opp-tags'));
  if (window.__pitlane) window.__pitlane.race = race;
}
function setRacing(on) {
  game.racing = on;
  document.body.classList.toggle('race-on', on);
  raceView?.setVisible(on);
  game.raceShown = false;
  game.raceGo = false;
  ui.hideRaceResult();
}

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
  onDemo: () => (game.demo ? stopDemo() : startDemo()),
});
ui.initDifficulty((level) => applyLevel(level));
ui.initSession(game.session, (id) => {
  game.session = id;
  storageSet('pitlane.session', id);
  ui.setSession(id);
});
// 換賽道：記住選擇後重新載入（賽道、建議路線、計時、小地圖都要重建）
if (track)
  ui.initTracks(TRACKS, track.id, (id) => {
    if (id === track.id) return;
    storageSet('pitlane.track', id);
    location.reload();
  });
ui.setMuteLabel(game.muted);
if (track) ui.initTrack(track);
// 駕駛鏡頭：預設車手視角；玩家按 C 切換後記住
{
  const m = Number(storageGet('pitlane.cam', CONFIG.camera.defaultChaseMode));
  rig.chaseMode = Number.isInteger(m) && m >= 0 && m < CHASE_MODES.length ? m : 0;
}
ui.setCameraLabel(CHASE_MODES[rig.chaseMode]);
audio.setMuted(game.muted);
input.bindTouch({
  steerEl: document.querySelector('[data-ui="touchSteer"]'),
  knobEl: document.querySelector('.steer-knob'),
  gasEl: document.querySelector('[data-ui="touchGas"]'),
  brakeEl: document.querySelector('[data-ui="touchBrake"]'),
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
  resetTiming();
  world.cones.reset();
  world.cones.setVisible(!track);
  // 對手比賽：所有車放上發車格（玩家在 CONFIG.race.playerSlot 那一格）
  const racing = game.session === 'race' && !!track?.raceline;
  if (racing) {
    ensureRace();
    race.reset();
  }
  setRacing(racing);
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
      if (game.pendingDemo) {
        game.pendingDemo = false;
        startDemo();
      } else if (game.racing) {
        race.startLights();
      } else if (track) {
        ui.showTutorial(LEVELS[game.level]);
        game.tutTimer = 14;
      }
    },
  });
}

// 對手比賽：回到發車格重新起跑
function restartRace() {
  if (!game.racing) return;
  fade(() => {
    resetCar();
    resetTiming();
    race.reset();
    setRacing(true);
    skids.last = [];
    const pose = rig.chasePose(phys);
    rig.jumpTo(pose.pos, pose.look);
    rig.startChase();
    race.startLights();
  });
}

// 對手比賽中按 R：放回賽道上（身後、離其他車夠遠的位置），不重來整場
function respawnInRace() {
  const locate = guide.locator();
  const i = locate(phys.x, phys.z);
  for (let back = 10; back < 200; back += 10) {
    const j = (i - back + guide.n) % guide.n;
    const p = guide.line[j];
    if (!race.entries.every((o) => o.isPlayer || Math.hypot(o.car.x - p.x, o.car.z - p.z) > 16)) continue;
    const t = guide.tan[j];
    fade(() => {
      phys.reset(p.x, p.z, Math.atan2(t.x, t.z));
      const pose = rig.chasePose(phys);
      rig.jumpTo(pose.pos, pose.look);
      rig.startChase();
    });
    return;
  }
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
  stopDemo();
  setMode('toShowroom');
  input.enabled = false;
  fade(() => {
    input.enabled = true;
    bankDrift();
    resetCar();
    resetTiming();
    setRacing(false);
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
  if (game.racing) return respawnInRace();
  stopDemo();
  fade(() => {
    bankDrift();
    resetCar();
    resetTiming();
    skids.last = [];
    world.cones.reset();
    const pose = rig.chasePose(phys);
    rig.jumpTo(pose.pos, pose.look);
    rig.startChase();
  });
}

function cycleCamera() {
  rig.chaseMode = (rig.chaseMode + 1) % CHASE_MODES.length;
  storageSet('pitlane.cam', rig.chaseMode);
  ui.setCameraLabel(CHASE_MODES[rig.chaseMode]);
}

function toggleMute() {
  game.muted = !game.muted;
  storageSet('pitlane.muted', game.muted);
  audio.unlock();
  audio.setMuted(game.muted);
  ui.setMuteLabel(game.muted);
}

// ---------- 難度：建議路線、自動煞車、轉向輔助、ABS／TC／ESC ----------
let guide = null;
let guideLine = null;
let assists = null;
game.level = LEVELS[storageGet('pitlane.level', 'rookie')] ? storageGet('pitlane.level', 'rookie') : 'rookie';

function buildGuide() {
  if (!track?.raceline) return;
  guide = createGuide(track.raceline, physParams, {}, track.points);
  guideLine = createGuideLine(scene, guide);
  assists = {
    brake: brakeAssist(guide, guide.locator()),
    steer: steerAssist(guide, guide.locator(), physParams),
    lineKeep: lineKeepAssist(guide, guide.locator(), physParams, LEVELS.standard.lineKeep),
  };
  if (window.__pitlane) window.__pitlane.guide = guide;
  // 沒有手動指定煞車看板的賽道：放在建議路線的重煞區結束點（彎道入口）前
  if (!track.def.brakeZones) {
    const entries = heavyBrakeEntries(guide).map((i) => track.project(guide.line[i].x, guide.line[i].z).s);
    track.resetHint();
    track.setBrakeZones(entries.sort((a, b) => a - b));
  }
}

function applyLevel(level) {
  if (!LEVELS[level]) return;
  game.level = level;
  storageSet('pitlane.level', level);
  const L = LEVELS[level];
  physParams.tractionControl = L.tc;
  physParams.abs = L.abs;
  physParams.esc = L.esc;
  physParams.steerAssist = L.keySteerAssist;
  guideLine?.setVisible(L.line);
  ui.setDifficulty(level, L);
}

// ---------- 示範駕駛：自動駕駛用鍵盤式操作（只有按／不按）跑給你看 ----------
function startDemo() {
  if (!guide) return;
  if (game.session === 'race') {
    ui.flashMessage('對手比賽不提供示範駕駛，請先在展示間切到「計時練習」', 'info', 3);
    return;
  }
  ui.hideTutorial();
  if (game.mode === 'showroom') {
    game.pendingDemo = true;
    startDrive();
    return;
  }
  if (game.mode !== 'drive') return;
  // 從發車格重新開始；示範圈速不寫進你的紀錄
  resetCar();
  resetTiming();
  skids.last = [];
  timer.noSave = true;
  const pose = rig.chasePose(phys);
  rig.jumpTo(pose.pos, pose.look);
  rig.startChase();
  // 示範：油門／煞車由示範車自己判斷，方向用轉向輔助沿路線（與新手模式相同），一圈乾淨不出界
  const driver = createDriver(guide, physParams, 'bot', 'self');
  const demoSteer = steerAssist(guide, guide.locator(), physParams, 1, 0);
  game.demo = { last: null };
  game.autopilot = (dt) => {
    const c = demoSteer(driver.control(phys, dt), phys);
    game.demo.last = c;
    return c;
  };
  document.body.classList.add('demo');
  ui.flashMessage('示範駕駛：看畫面下方亮起的按鍵學煞車點與轉向', 'info', 4);
}

function stopDemo() {
  if (!game.demo) return;
  game.demo = null;
  game.autopilot = null;
  document.body.classList.remove('demo');
  if (timer) {
    // 接手當圈有一部分是示範開的，不計入
    if (timer.running) timer.valid = false;
    timer.noSave = false;
  }
}

// ---------- 賽道計時 ----------
function resetTiming() {
  if (!track) return;
  track.resetHint();
  timer.reset();
  phys.surfaceGrip = 1;
  phys.surfaceDrag = 0;
}

function updateTrack(dt) {
  const proj = track.project(phys.x, phys.z);
  // 路緣石：壓上去時有噠噠聲與細碎震動（每秒壓過幾條＝車速 ÷ 每條長度）
  const onCurb = track.curbContact(proj) * clamp(phys.speed / 25, 0, 1);
  game.curb = { amount: onCurb, rate: phys.speed / (CONFIG.track.curbStripe / 2) };
  rig.curb = game.curb;
  timer.update(dt, proj, phys);
  // 出界壓到白色地面：抓地變差、阻力變大
  phys.surfaceGrip = timer.offTrack ? CONFIG.track.offGrip : 1;
  phys.surfaceDrag = timer.offTrack ? CONFIG.track.offDrag : 0;
  // 路線顏色依目前車速即時變化：車子底下是紅色＝要煞車
  guideLine?.update(phys.speed);
  for (const e of timer.events.splice(0)) {
    if (e.type === 'lap') {
      const tag = !e.valid ? '（該圈不計）' : e.best ? '・最佳圈！' : '';
      ui.flashMessage(`LAP ${e.lap}  ${formatTime(e.time)} ${tag}`, 'info', 4);
    }
  }
  const others = game.racing ? race.entries.filter((e) => !e.isPlayer).map((e) => ({ x: e.car.x, z: e.car.z, color: `hsl(${e.opp.hue}, 70%, 45%)` })) : null;
  ui.updateTrackHUD(timer, phys, performance.now() / 1000, others);
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
  const cs = Math.cos(car.root.rotation.y);
  const sn = Math.sin(car.root.rotation.y);
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
const TAKEOVER_KEYS = ['KeyW', 'KeyA', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];
input.on('press', (k) => {
  // 教學卡：任意鍵關閉，H 再開
  if (document.body.classList.contains('tut-open') && k !== 'KeyH') {
    ui.hideTutorial();
    game.tutTimer = 0;
  }
  if (k === 'KeyH' && game.mode === 'drive') {
    if (document.body.classList.contains('tut-open')) ui.hideTutorial();
    else {
      ui.showTutorial(LEVELS[game.level]);
      game.tutTimer = 14;
    }
  }
  if (game.demo && TAKEOVER_KEYS.includes(k)) {
    stopDemo();
    ui.flashMessage('你已接手駕駛', 'info', 2);
  }
  if (k === 'KeyP' && (game.mode === 'drive' || game.mode === 'showroom')) game.demo ? stopDemo() : startDemo();
  if (k === 'Enter' && game.mode === 'showroom') startDrive();
  if (k === 'Enter' && game.mode === 'drive' && game.racing && race.state === 'finished') restartRace();
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
// 物理插值：物理固定 120Hz、畫面約 60Hz，兩者不同步時每格畫面會多走或少走一步，高速時看起來會跳動
// 畫面上的位置改用「前一步 → 目前步」依時間比例內插；其餘欄位（速度、滑移等）沿用 phys
const view = Object.create(phys);
const prevPose = { x: phys.x, z: phys.z, yaw: phys.yaw };
const focus = new THREE.Vector3();

function frame(ts) {
  // 用 rAF 提供的垂直同步時間戳，比自己量的 performance.now() 穩定
  const now = ts ?? performance.now();
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  if (game.mode === 'drive') {
    game.driveTime += dt;
    if (game.driveTime > 7) document.body.classList.add('hint-faded');
    let ctl = input.read();
    if (game.autopilot) ctl = game.autopilot(dt) || ctl;
    else if (assists) {
      // 新手輔助：自動煞車、沿建議路線轉向（玩家的 A／D 會在上面往左右偏）
      const L = LEVELS[game.level];
      if (L.brakeAssist) assists.brake(ctl, phys);
      if (L.steerAssist) assists.steer(ctl, phys);
      else if (L.lineKeep) assists.lineKeep(ctl, phys);
      if (ctl.assistBraking && !game.wasAssistBraking) ui.flashMessage('自動煞車', 'info', 1.2);
      game.wasAssistBraking = !!ctl.assistBraking;
    }
    if (game.tutTimer > 0) {
      game.tutTimer -= dt;
      if (game.tutTimer <= 0) ui.hideTutorial();
    }
    if (game.racing) {
      race.update(dt);
      // 紅燈熄滅前不能起步
      if (race.state === 'grid' || race.state === 'lights') ctl = { ...ctl, throttle: 0, brake: 1, reverse: false };
    }
    acc += dt;
    while (acc >= STEP) {
      prevPose.x = phys.x;
      prevPose.z = phys.z;
      prevPose.yaw = phys.yaw;
      phys.step(STEP, ctl);
      // AI 推進與碰撞（玩家也參與碰撞）
      if (game.racing) race.step(STEP);
      acc -= STEP;
    }
    if (game.racing) race.track();
    const hits = track ? 0 : world.cones.update(dt, phys);
    if (track) updateTrack(dt);
    if (hits) {
      audio.hit();
      rig.bump(0.06);
    }
    updateDrift(dt);
    ui.updateHUD(phys, game.drift);
    if (game.demo?.last) ui.updateKeyViz(game.demo.last);
  } else {
    acc = 0;
    world.cones.update(dt, null);
    updateRevDemo(dt);
  }

  // 插值後的顯示位置（重置／傳送造成的大位移直接跳過，不內插）
  if (Math.hypot(phys.x - prevPose.x, phys.z - prevPose.z) > 5 || game.mode !== 'drive') {
    prevPose.x = phys.x;
    prevPose.z = phys.z;
    prevPose.yaw = phys.yaw;
  }
  const alpha = game.mode === 'drive' ? acc / STEP : 1;
  view.x = prevPose.x + (phys.x - prevPose.x) * alpha;
  view.z = prevPose.z + (phys.z - prevPose.z) * alpha;
  view.yaw = prevPose.yaw + (phys.yaw - prevPose.yaw) * alpha;

  // 車子姿態
  const off = modelOffset();
  car.root.position.set(view.x + Math.sin(view.yaw) * off, 0, view.z + Math.cos(view.yaw) * off);
  car.root.rotation.y = view.yaw;
  const driving = game.mode === 'drive';
  // 胎痕、煙霧、音效要在車子擺好位置之後算，才會剛好在輪子底下
  if (driving) {
    const skid = updateTyreFx(dt);
    audio.update(dt, phys.rpm, phys.throttle, skid, game.curb);
  }
  car.update(dt, driving ? phys : null, { idleShake: !!game.revDemo || game.mode === 'toDrive', rainLight: driving || game.mode === 'toDrive' });
  contactShadow.material.opacity = CONFIG.lighting.contactShadow;

  if (game.racing) updateRaceView(dt, alpha);
  rig.update(dt, view);
  car.setDriverView(rig.mode === 'chase' && rig.chaseMode === DRIVER_CAM);
  smoke.update(dt, renderer, camera);
  focus.set(view.x, 0, view.z);
  world.update(focus);

  if (game.mode === 'showroom') ui.updateHotspots(camera, car, game.hotspot);

  renderer.render(scene, camera);
  devApi?.tick?.(dt);
  requestAnimationFrame(frame);
}

function updateRaceView(dt, alpha) {
  const standings = race.standings();
  raceView.update(dt, alpha, camera, standings);
  ui.updateRace(race, standings);
  if (race.state === 'racing' && !game.raceGo) {
    game.raceGo = true;
    ui.flashMessage('GO!', 'info', 1.5);
  }
  if (race.state === 'finished' && !game.raceShown) {
    game.raceShown = true;
    ui.showRaceResult(race, standings);
  }
  // 玩家撞車：撞擊聲＋短暫衝擊（大小依衝量，上限 CONFIG.race.hitShake）
  const h = race.lastHit;
  if (h && h !== game.lastHitSeen) {
    game.lastHitSeen = h;
    if (h.a.isPlayer || h.b.isPlayer) {
      audio.hit();
      rig.bump(Math.min(CONFIG.race.hitShake, h.impulse / 80000));
    }
  }
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
    loadedModel = loaded;
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
  buildGuide();
  applyLevel(game.level);
  world.cones.setVisible(false);
  const C = CONFIG.camera;
  rig.jumpTo(C.introFrom, C.showroomTarget, C.showroomFov);
  rig.allowAutoRotate = true;
  document.getElementById('loader').classList.add('done');
  setMode('showroom');
  rig.flyTo(C.showroomPos, C.showroomTarget, { duration: CONFIG.anim.introDuration, ease: 'easeOutCubic', onDone: () => rig.toOrbit() });

  if (DEV_ENABLED) {
    // 方便在 console 檢查場景
    window.__pitlane = { THREE, scene, car, camera, rig, phys, world, track, timer, guide, physParams };
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
      track,
      timer,
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
        restartRace: () => restartRace(),
        raceResult: () => game.racing && ui.showRaceResult(race, race.standings()),
        setAutopilot: (fn) => (game.autopilot = fn),
        teleport: (s) => {
          const p = track.poseAt(s);
          const off = modelOffset();
          phys.reset(p.x - Math.sin(p.yaw) * off, p.z - Math.cos(p.yaw) * off, p.yaw);
          resetTiming();
          skids.last = [];
          if (game.mode === 'drive') {
            const pose = rig.chasePose(phys);
            rig.jumpTo(pose.pos, pose.look);
            rig.startChase();
          }
        },
      },
    });
  }
  frame();
}

boot();
