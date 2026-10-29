// DEV 開發者微調工具：` 鍵或右下角齒輪開關
// 可拖曳 UI 元件與 3D 熱點、即時調整所有版面／鏡頭／物理／燈光數值、切換遊戲狀態、匯出 JSON
import GUI from 'lil-gui';
import * as THREE from 'three';
import { CONFIG, LAYOUT_PC, LAYOUT_MOBILE } from './config.js';
import { HOTSPOT_ORDER, HOTSPOT_TEXT } from './content.js';
import { EASES } from './util.js';
import { placeElement, uiScale } from './ui.js';
import { diff, saveOverrides, clearOverrides, snapshot } from './overrides.js';

const ANCHORS = ['tl', 't', 'tr', 'l', 'c', 'r', 'bl', 'b', 'br'];
const UI_NAMES = {
  brand: '品牌標誌',
  showroomHint: '展示間提示',
  driveBtn: '開始駕駛按鈕',
  liveryBar: '塗裝選擇',
  infoPanel: '熱點資訊卡',
  shiftLights: '換檔燈',
  driftMeter: '甩尾計分',
  speedo: '速度表',
  driveHint: '操作說明',
  driveBar: '右上工具列',
  touchSteer: '觸控方向',
  touchGas: '觸控油門',
  touchBrake: '觸控煞車',
  credit: '模型作者標示',
  lapTimer: '圈速計時',
  minimap: '小地圖',
  trackWarning: '賽道警告',
  keyViz: '示範按鍵顯示',
  difficulty: '難度選擇',
  trackPicker: '賽道選單',
  sessionPicker: '練習／比賽切換',
  raceTower: '比賽名次表',
  startLights: '起跑紅燈',
  raceResult: '比賽成績',
  tutorial: '教學卡',
};

const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

export function initDev(api) {
  const { ui, car, world, rig, camera, audio, actions, phys, renderer } = api;

  // ---------- 開關按鈕與狀態標籤 ----------
  const gearBtn = document.createElement('button');
  gearBtn.className = 'dev-gear';
  gearBtn.type = 'button';
  gearBtn.title = 'DEV 微調工具（` 鍵）';
  gearBtn.textContent = '⚙';
  document.body.appendChild(gearBtn);
  const badge = document.createElement('div');
  badge.className = 'dev-badge';
  document.body.appendChild(badge);

  const gui = new GUI({ title: 'PITLANE DEV 微調工具', width: Math.min(340, window.innerWidth - 20) });
  gui.hide();
  const toggle = (force) => {
    const show = force ?? gui._hidden;
    show ? gui.show() : gui.hide();
    gearBtn.classList.toggle('on', show);
  };
  gearBtn.addEventListener('click', () => toggle());
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Backquote') toggle();
  });

  const refreshAll = () => gui.controllersRecursive().forEach((c) => c.updateDisplay());
  const applyAll = () => {
    car.applyColors();
    world.applyLighting();
    ui.applyLayout();
    rig.applyLimits();
    audio.applyVolume();
  };

  // 變更後自動暫存到瀏覽器（只存差異）
  let saveTimer = 0;
  const updateBadge = () => {
    const n = diff().length;
    badge.textContent = n ? `DEV · ${n} 項微調暫存中（尚未寫進原始碼）` : 'DEV';
    badge.style.opacity = n ? '1' : '0.5';
  };
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveOverrides();
      updateBadge();
    }, 300);
  };
  updateBadge();

  const state = {
    layoutMode: 'auto',
    showTouch: false,
    dragUI: false,
    dragHotspots: false,
  };

  // ================= 💾 匯出 =================
  const fSave = gui.addFolder('💾 匯出 / 鎖定');
  fSave
    .add({ export: () => exportValues() }, 'export')
    .name('💾 匯出目前數值（寫入 tuning/export.json）');
  fSave
    .add(
      {
        reset: () => {
          if (!confirm('把所有微調值重置回原始碼預設？')) return;
          clearOverrides();
          applyAll();
          rebuildLayoutFolder();
          refreshAll();
          updateBadge();
        },
      },
      'reset',
    )
    .name('↺ 全部重置為預設');

  // ================= 🎬 狀態切換 =================
  const fState = gui.addFolder('🎬 狀態切換');
  const stateActions = {
    showroom: () => actions.showroom(),
    drive: () => actions.drive(),
    overview: () => actions.closeHotspot(),
    drs: () => actions.hotspotAction('drs'),
    rev: () => actions.hotspotAction('rev'),
    cockpit: () => actions.hotspotAction('cockpitView'),
    donut: () => runAutopilot('donut'),
    handbrake: () => runAutopilot('handbrake'),
    reset: () => actions.resetDrive(),
    cam: () => actions.cycleCamera(),
    raceRestart: () => actions.restartRace(),
    raceResult: () => actions.raceResult(),
    popWin: () => actions.pop('+2480'),
    popFail: () => actions.pop('SPIN！失去分數', true),
  };
  fState.add(stateActions, 'showroom').name('回展示間');
  fState.add(stateActions, 'drive').name('開始駕駛');
  fState.add(stateActions, 'overview').name('展示間：回總覽');
  const fHs = fState.addFolder('打開熱點').close();
  HOTSPOT_ORDER.forEach((id) => fHs.add({ go: () => actions.openHotspot(id) }, 'go').name(HOTSPOT_TEXT[id].title));
  fState.add(stateActions, 'drs').name('切換 DRS');
  fState.add(stateActions, 'rev').name('轟油門展示');
  fState.add(stateActions, 'cockpit').name('車手視角');
  fState.add(stateActions, 'donut').name('自動原地甩尾（駕駛中）');
  fState.add(stateActions, 'handbrake').name('自動手煞車迴轉（駕駛中）');
  fState.add(stateActions, 'reset').name('重置賽車');
  fState.add(stateActions, 'cam').name('切換駕駛鏡頭');
  fState.add(stateActions, 'raceRestart').name('對手比賽：重新起跑（比賽中）');
  fState.add(stateActions, 'raceResult').name('對手比賽：顯示成績卡（比賽中）');
  fState.add(stateActions, 'popWin').name('顯示得分彈出');
  fState.add(stateActions, 'popFail').name('顯示失敗彈出');

  function runAutopilot(kind) {
    let t = 0;
    actions.setAutopilot((dt) => {
      t += dt;
      if (kind === 'donut') {
        if (t < 0.6) return { throttle: 1 };
        if (t < 7) return { throttle: 1, steer: 1 };
      } else {
        if (t < 3) return { throttle: 0.8 };
        if (t < 3.9) return { throttle: 0.3, steer: 1, handbrake: true };
        if (t < 6) return { throttle: 0.6 };
      }
      actions.setAutopilot(null);
      return null;
    });
  }

  // ================= 📐 版面 =================
  const fLayout = gui.addFolder('📐 UI 版面（PC / Mobile）');
  fLayout
    .add(state, 'layoutMode', { '自動（依視窗）': 'auto', 'PC 版': 'pc', '手機版': 'mobile' })
    .name('編輯／預覽版面')
    .onChange((v) => {
      ui.forcedLayout = v === 'auto' ? null : v;
      ui.applyLayout();
      rebuildLayoutFolder();
    });
  fLayout
    .add(state, 'showTouch')
    .name('顯示觸控元件')
    .onChange((v) => {
      ui.forceTouch = v;
      ui.applyLayout();
    });
  fLayout
    .add(state, 'dragUI')
    .name('🖐 直接拖曳 UI 元件')
    .onChange((v) => document.body.classList.toggle('dev-drag-ui', v));
  let fElems = null;
  function rebuildLayoutFolder() {
    fElems?.destroy();
    const key = ui.layoutKey;
    const L = key === 'mobile' ? LAYOUT_MOBILE : LAYOUT_PC;
    fElems = fLayout.addFolder(`元件數值（目前：${key === 'mobile' ? '手機版' : 'PC 版'}）`);
    for (const id of Object.keys(L)) {
      const f = fElems.addFolder(UI_NAMES[id] || id).close();
      const cfg = L[id];
      const apply = () => {
        const el = ui.elements[id];
        if (el) placeElement(el, cfg);
      };
      f.add(cfg, 'anchor', ANCHORS).name('對齊角落').onChange(apply);
      f.add(cfg, 'x', -1200, 1200, 1).name('x 偏移').onChange(apply);
      f.add(cfg, 'y', -1200, 1200, 1).name('y 偏移').onChange(apply);
      f.add(cfg, 'scale', 0.3, 2.5, 0.01).name('縮放').onChange(apply);
      f.add(cfg, 'fontSize', 6, 40, 0.5).name('字級 px').onChange(apply);
      f.addColor(cfg, 'color').name('文字顏色').onChange(apply);
      f.add(cfg, 'opacity', 0, 1, 0.01).name('透明度').onChange(apply);
    }
  }
  rebuildLayoutFolder();
  window.addEventListener('resize', () => {
    if (state.layoutMode === 'auto') rebuildLayoutFolder();
  });

  // UI 拖曳：攔截 pointer / click，不讓按鈕在編輯時被觸發
  let uiDrag = null;
  let selectedEl = null;
  const tag = document.createElement('div');
  tag.className = 'dev-tag';
  const anchorAxes = (a) => ({ H: a.endsWith('l') ? 'l' : a.endsWith('r') ? 'r' : 'c', V: a.startsWith('t') ? 't' : a.startsWith('b') ? 'b' : 'c' });
  const select = (el) => {
    selectedEl?.classList.remove('dev-selected');
    selectedEl = el;
    el.classList.add('dev-selected');
    tag.textContent = UI_NAMES[el.dataset.ui] || el.dataset.ui;
    el.appendChild(tag);
  };
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (!state.dragUI) return;
      const el = e.target.closest?.('[data-ui]');
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      const cfg = ui.layout[el.dataset.ui];
      uiDrag = { el, cfg, sx: e.clientX, sy: e.clientY, x0: cfg.x, y0: cfg.y };
      select(el);
    },
    true,
  );
  window.addEventListener('pointermove', (e) => {
    if (!uiDrag) return;
    const { el, cfg } = uiDrag;
    const { H, V } = anchorAxes(cfg.anchor);
    const dx = e.clientX - uiDrag.sx;
    const dy = e.clientY - uiDrag.sy;
    // 拖曳距離換算回未縮放的設計座標
    const k = uiScale();
    cfg.x = Math.round(uiDrag.x0 + (H === 'r' ? -dx : dx) / k);
    cfg.y = Math.round(uiDrag.y0 + (V === 'b' ? -dy : dy) / k);
    placeElement(el, cfg);
  });
  window.addEventListener('pointerup', () => {
    if (!uiDrag) return;
    uiDrag = null;
    refreshAll();
    scheduleSave();
  });
  window.addEventListener(
    'click',
    (e) => {
      if (state.dragUI && e.target.closest?.('[data-ui]')) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true,
  );
  // 拖曳模式下，滾輪可縮放選中的元件
  window.addEventListener(
    'wheel',
    (e) => {
      if (!state.dragUI || !selectedEl || !e.target.closest?.('[data-ui]')) return;
      e.preventDefault();
      e.stopPropagation();
      const cfg = ui.layout[selectedEl.dataset.ui];
      cfg.scale = round(Math.min(2.5, Math.max(0.3, cfg.scale - Math.sign(e.deltaY) * 0.03)), 2);
      placeElement(selectedEl, cfg);
      refreshAll();
      scheduleSave();
    },
    { capture: true, passive: false },
  );

  // ================= 📍 熱點 =================
  const fHot = gui.addFolder('📍 熱點與展示間鏡頭').close();
  fHot
    .add(state, 'dragHotspots')
    .name('🖐 直接拖曳熱點（貼在車身上）')
    .onChange((v) => document.body.classList.toggle('dev-drag-hotspots', v));
  const fShow = fHot.addFolder('展示間預設鏡頭').close();
  const C = CONFIG.camera;
  addVec(fShow, C.showroomPos, '鏡頭位置', 20);
  addVec(fShow, C.showroomTarget, '注視點', 5);
  addVec(fShow, C.introFrom, '開場起點', 40);
  fShow.add(C, 'showroomFov', 15, 80, 0.5).name('FOV');
  fShow.add(C, 'minDist', 1, 10, 0.1).name('最近距離').onChange(() => rig.applyLimits());
  fShow.add(C, 'maxDist', 5, 40, 0.1).name('最遠距離').onChange(() => rig.applyLimits());
  fShow.add(C, 'maxPolarDeg', 30, 90, 0.5).name('最低俯角限制').onChange(() => rig.applyLimits());
  fShow.add(C, 'autoRotateSpeed', 0, 5, 0.05).name('自動旋轉速度').onChange(() => rig.applyLimits());
  fShow
    .add(
      {
        cap: () => {
          C.showroomPos.splice(0, 3, ...camera.position.toArray().map((v) => round(v)));
          C.showroomTarget.splice(0, 3, ...rig.controls.target.toArray().map((v) => round(v)));
          C.showroomFov = round(camera.fov, 1);
          refreshAll();
          scheduleSave();
        },
      },
      'cap',
    )
    .name('📷 以目前畫面設為展示間預設');
  fShow.add({ go: () => actions.showroomView() }, 'go').name('▶ 飛到預設視角');

  HOTSPOT_ORDER.forEach((id) => {
    const h = CONFIG.hotspots[id];
    const f = fHot.addFolder(`熱點：${HOTSPOT_TEXT[id].title}`).close();
    addVec(f, h.anchor, '熱點位置（車身座標）', 3);
    addVec(f, h.camPos, '鏡頭位置', 10);
    addVec(f, h.camTarget, '注視點', 4);
    f.add({ go: () => actions.openHotspot(id) }, 'go').name('▶ 飛過去看');
    f.add(
      {
        cap: () => {
          h.camPos.splice(0, 3, ...camera.position.toArray().map((v) => round(v)));
          h.camTarget.splice(0, 3, ...rig.controls.target.toArray().map((v) => round(v)));
          refreshAll();
          scheduleSave();
        },
      },
      'cap',
    ).name('📷 以目前畫面設為此熱點視角');
  });

  // 熱點拖曳：射線打在車身上
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const nrm = new THREE.Vector3();
  let hsDrag = null;
  document.getElementById('hotspots').addEventListener(
    'pointerdown',
    (e) => {
      if (!state.dragHotspots) return;
      const el = e.target.closest('.hotspot');
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      hsDrag = el.dataset.id;
      ui.suppressClick = true;
      rig.controls.enabled = false;
    },
    true,
  );
  window.addEventListener('pointermove', (e) => {
    if (!hsDrag) return;
    ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(car.pickMeshes, false)[0];
    if (!hit) return;
    nrm.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
    const p = hit.point.clone().addScaledVector(nrm, 0.02);
    car.root.worldToLocal(p);
    CONFIG.hotspots[hsDrag].anchor.splice(0, 3, round(p.x), round(p.y), round(p.z));
  });
  window.addEventListener('pointerup', () => {
    if (!hsDrag) return;
    hsDrag = null;
    if (rig.mode === 'orbit') rig.controls.enabled = true;
    setTimeout(() => (ui.suppressClick = false), 0);
    refreshAll();
    scheduleSave();
  });

  // ================= 🎥 駕駛鏡頭 =================
  const fCam = gui.addFolder('🎥 駕駛鏡頭').close();
  fCam.add(C, 'chaseDist', 2, 20, 0.1).name('追車距離');
  fCam.add(C, 'chaseHeight', 0.3, 8, 0.05).name('追車高度');
  fCam.add(C, 'chaseLookHeight', 0, 3, 0.05).name('注視高度');
  fCam.add(C, 'chaseLookAhead', -3, 15, 0.1).name('注視前方距離');
  fCam.add(C, 'chaseStiffness', 0.5, 20, 0.1).name('跟隨硬度');
  fCam.add(C, 'chaseSlipFollow', 0, 1, 0.01).name('甩尾時跟隨速度方向');
  fCam.add(C, 'chaseFov', 30, 100, 0.5).name('基本 FOV');
  fCam.add(C, 'chaseFovSpeedGain', 0, 40, 0.5).name('高速 FOV 增量');
  fCam.add(C, 'speedShake', 0, 0.05, 0.001).name('高速震動（0 = 關）');
  fCam.add(C, 'skidShake', 0, 0.08, 0.001).name('打滑震動（0 = 關）');
  fCam.add(C, 'curbShake', 0, 0.05, 0.001).name('路緣石震動（0 = 關）');
  fCam.add(C, 'farDistScale', 1, 4, 0.05).name('遠景距離倍率');
  fCam.add(C, 'farHeightScale', 1, 5, 0.05).name('遠景高度倍率');
  fCam.add(C, 'driverCamHeight', 0.5, 1.5, 0.01).name('車手視角：眼睛高度');
  fCam.add(C, 'driverCamForward', -1.5, 1.5, 0.01).name('車手視角：前後');
  fCam.add(C, 'driverCamLookHeight', -1, 2, 0.01).name('車手視角：看的高度');
  fCam.add(C, 'driverCamFov', 40, 100, 1).name('車手視角：視角 FOV');
  fCam.add(C, 'heliHeight', 5, 80, 0.5).name('空拍高度');

  // ================= 🏎 外觀 =================
  const fCar = gui.addFolder('🏎 賽車外觀').close();
  const recolor = () => car.applyColors();
  fCar.addColor(CONFIG.car, 'bodyColor').name('車身主色').onChange(recolor);
  fCar.addColor(CONFIG.car, 'accentColor').name('碳纖/副色').onChange(recolor);
  fCar.addColor(CONFIG.car, 'stripeColor').name('飾條色').onChange(recolor);
  fCar.addColor(CONFIG.car, 'helmetColor').name('安全帽').onChange(recolor);
  fCar.addColor(CONFIG.car, 'rimColor').name('輪圈').onChange(recolor);
  fCar.addColor(CONFIG.car, 'compoundColor').name('輪胎配方色').onChange(recolor);
  fCar.add(CONFIG.car, 'paintRoughness', 0, 1, 0.01).name('烤漆粗糙度').onChange(recolor);
  fCar.add(CONFIG.car, 'paintMetalness', 0, 1, 0.01).name('烤漆金屬感').onChange(recolor);
  fCar.add(CONFIG.car, 'clearcoat', 0, 1, 0.01).name('透明漆').onChange(recolor);

  // ================= 🧩 外部模型 =================
  const fModel = gui.addFolder('🧩 外部高精度模型').close();
  const MD = CONFIG.model;
  const ext = car.external;
  fModel.add({ info: ext ? `已載入：${ext.meshes.length} 網格、${ext.wheels.length} 顆輪子` : '未載入（使用程式建模）' }, 'info').name('狀態').disable();
  fModel.add(MD, 'rotY', ['auto', 0, 90, 180, 270]).name('車頭方向（需重載）');
  fModel.add(MD, 'length', 3, 8, 0.01).name('車長 m（需重載）');
  fModel.add(MD, 'scaleAdjust', 0.5, 1.5, 0.001).name('縮放微調（需重載）');
  fModel.add(MD, 'yOffset', -0.3, 0.3, 0.001).name('高度偏移（需重載）');
  fModel.add(MD, 'zOffset', -1, 1, 0.001).name('前後偏移（需重載）');
  if (ext) {
    const names = [...ext.materials.keys()];
    const paintState = { pick: '' };
    fModel.add(MD, 'paintMaterial').name('車漆材質（逗號分隔）').onChange(() => car.applyColors());
    fModel
      .add(paintState, 'pick', ['', ...names])
      .name('＋加入材質')
      .onChange((v) => {
        if (!v) return;
        const list = MD.paintMaterial.split(',').map((n) => n.trim()).filter(Boolean);
        if (!list.includes(v)) list.push(v);
        MD.paintMaterial = list.join(',');
        car.applyColors();
        refreshAll();
      });
  }
  const fHelmet = fModel.addFolder('車手安全帽').close();
  fHelmet.add(MD.helmet, 'show').name('顯示');
  addVec(fHelmet, MD.helmet.pos, '位置', 3);
  fHelmet.add(MD.helmet, 'scale', 0.5, 1.6, 0.01).name('大小');
  fModel
    .add(
      {
        reload: () => {
          saveOverrides();
          location.reload();
        },
      },
      'reload',
    )
    .name('↻ 套用並重新載入');

  // ================= 🏎️ 對手比賽 =================
  {
    const R = CONFIG.race;
    const fRace = gui.addFolder('🏎️ 對手比賽').close();
    fRace.add(R, 'laps', 1, 20, 1).name('圈數（下一場生效）');
    fRace.add(R, 'playerSlot', 0, R.opponents.length, 1).name('玩家發車格（重載生效）');
    fRace.add(R, 'followGap', 4, 30, 0.5).name('AI 跟車距離 m');
    fRace.add(R, 'sideGap', 2, 4, 0.05).name('AI 並排側向距離 m');
    fRace.add(R, 'restitution', 0, 1, 0.01).name('碰撞反彈');
    fRace.add(R, 'contactFriction', 0, 1, 0.01).name('擦撞摩擦');
    fRace.add(R, 'spinFactor', 0, 2, 0.05).name('撞擊轉動倍率');
    fRace.add(R, 'hitShake', 0, 0.2, 0.005).name('被撞鏡頭衝擊（0 = 關）');
    fRace.add(R, 'lightsInterval', 0.3, 2, 0.05).name('紅燈間隔 s');
  }

  // ================= 🏁 賽道 =================
  if (api.track) {
    const T = CONFIG.track;
    const tr = api.track;
    const fTrack = gui.addFolder(`🏁 賽道（${tr.def.label}）`).close();
    const rebuild = () => tr.rebuild();
    fTrack.add(T, 'widthScale', 0.6, 2, 0.01).name('寬度倍率').onFinishChange(rebuild);
    fTrack.add(CONFIG.assist, 'guideOpacity', 0, 1, 0.01).name('建議路線透明度');
    fTrack.addColor(T, 'asphaltColor').name('柏油顏色').onChange((v) => tr.materials.asphalt.color.set(v));
    fTrack.add(T, 'edgeLineWidth', 0, 1, 0.01).name('白邊線寬').onFinishChange(rebuild);
    fTrack.add(T, 'curbRadius', 30, 400, 1).name('路緣石：彎道半徑門檻').onFinishChange(rebuild);
    fTrack.add(T, 'curbExtend', 0, 40, 1).name('路緣石：前後延伸').onFinishChange(rebuild);
    fTrack.add(T, 'curbWidth', 0.3, 3, 0.05).name('路緣石寬').onFinishChange(rebuild);
    fTrack.add(T, 'curbStripe', 0.5, 6, 0.1).name('紅白一組長度').onFinishChange(rebuild);
    fTrack.add(T, 'offGrip', 0.1, 1, 0.01).name('出界抓地倍率');
    fTrack.add(T, 'offDrag', 0, 600, 5).name('出界阻力');
    fTrack.add(T, 'offMargin', -1, 3, 0.05).name('出界判定寬容');
    fTrack.add(T, 'gridOffset', 0, 60, 0.5).name('發車位距起跑線（需重載）');
    fTrack.add(T, 'gridLateral', -6, 6, 0.1).name('發車位左右（需重載）');
    const fJump = fTrack.addFolder('傳送到彎道前（駕駛中）');
    const L = tr.length;
    const jumps =
      tr.id === 'monza'
        ? [
            ['起跑線前', L - 250],
            ['T1 Rettifilo 減速彎', 919],
            ['Curva Grande', 1250],
            ['Roggia 減速彎', 2133],
            ['Lesmo 1', 2503],
            ['Lesmo 2', 2858],
            ['Ascari 減速彎', 3942],
            ['Parabolica', 5126],
          ]
        : [['起跑線前', L - 250], ...tr.brakeZones.map((s, k) => [`重煞彎 ${k + 1}（${Math.round(s)} m）`, s])];
    jumps.forEach(([name, s]) => fJump.add({ go: () => actions.teleport(s - (name === '起跑線前' ? 0 : 220)) }, 'go').name(name));
    fTrack
      .add(
        {
          clear: () => {
            if (confirm('清除 Monza 的最佳圈紀錄？')) api.timer.clearBest();
          },
        },
        'clear',
      )
      .name('清除最佳圈紀錄');
  }

  // ================= ⚙️ 物理 =================
  const fPhys = gui.addFolder('⚙️ 駕駛物理').close();
  const P = CONFIG.physics;
  const physRanges = {
    mass: [400, 1400, 1, '車重 kg'],
    frontWeight: [0.3, 0.65, 0.01, '前軸重量比'],
    cgHeight: [0.1, 0.6, 0.01, '重心高度'],
    powerKW: [100, 1500, 10, '馬力 kW'],
    maxDriveForce: [2000, 18000, 100, '最大驅動力'],
    reverseForce: [500, 9000, 100, '倒車力'],
    maxReverseSpeed: [2, 25, 0.5, '倒車極速 m/s'],
    brakeForce: [4000, 60000, 500, '煞車力'],
    brakeBias: [0.3, 0.8, 0.01, '煞車前軸比例'],
    brakeRampUp: [1, 30, 0.5, '鍵盤煞車踩下速度'],
    brakeRampDown: [1, 30, 0.5, '鍵盤煞車放開速度'],
    dragCoef: [0.1, 2.5, 0.01, '風阻'],
    rollResist: [0, 200, 1, '滾動阻力'],
    downforce: [0, 8, 0.05, '下壓力係數'],
    muFront: [0.4, 3, 0.01, '前輪抓地 μ'],
    muRear: [0.4, 3, 0.01, '後輪抓地 μ'],
    stiffFront: [1, 25, 0.1, '前輪側向剛性'],
    stiffRear: [1, 25, 0.1, '後輪側向剛性'],
    handbrakeGrip: [0.05, 1.5, 0.01, '手煞車滑動摩擦'],
    spinBase: [0, 12, 0.1, '空轉起始滑速'],
    spinGain: [0, 60, 0.5, '空轉增益'],
    spinBlend: [0.3, 8, 0.1, '空轉→滑行過渡'],
    slipRefSpeed: [0.5, 6, 0.1, '低速側滑參考速度'],
    maxSteerDeg: [5, 45, 0.5, '最大打角°'],
    highSpeedSteerDeg: [1, 25, 0.5, '高速打角°'],
    steerRate: [0.3, 10, 0.05, '低速打角速度'],
    steerRateHigh: [0.2, 6, 0.05, '高速打角速度'],
    steerReturn: [0.5, 20, 0.1, '低速回正速度'],
    steerReturnHigh: [0.5, 30, 0.1, '高速回正速度'],
    steerCurve: [1, 3, 0.05, '轉向曲線（越大小角度越細）'],
    inertiaScale: [0.15, 2, 0.01, '轉動慣量倍率'],
    yawDamping: [0, 6, 0.05, '穩定輔助'],
    lowSpeedBlendStart: [0, 6, 0.1, '低速模型起點'],
    lowSpeedBlendEnd: [0.5, 12, 0.1, '低速模型終點'],
    autoShiftUp: [8000, 13200, 50, '自動升檔 rpm'],
    autoShiftDown: [4500, 11000, 50, '自動降檔 rpm'],
  };
  for (const [k, [min, max, step, name]] of Object.entries(physRanges)) fPhys.add(P, k, min, max, step).name(name);
  fPhys.add(P, 'steerAssist').name('輔助：轉向（按住＝最佳打角）');
  fPhys.add(P, 'steerAssistGrip', 0.3, 1.2, 0.01).name('按住方向鍵抓地比例（低速）');
  fPhys.add(P, 'steerAssistGripHigh', 0.3, 1.2, 0.01).name('按住方向鍵抓地比例（高速）');
  fPhys.add(P, 'steerAssistSlip', 0, 2, 0.01).name('轉向輔助滑移角倍率');
  fPhys.add(P, 'steerAssistMaxG', 1, 8, 0.1).name('轉向輔助最多拉幾 G');
  fPhys.add(P, 'steerJerk', 0, 200, 1).name('鍵盤轉向靈敏度（0 = 舊式）');
  fPhys.add(P, 'steerRateMinDeg', 0.1, 5, 0.1).name('鍵盤打角速度下限°/s');
  fPhys.add(P, 'steerRateMaxDeg', 10, 200, 1).name('鍵盤打角速度上限°/s');
  fPhys.add(P, 'steerReturnMul', 1, 6, 0.1).name('放開回正倍率');
  fPhys.add(P, 'tractionControl').name('輔助：循跡控制（不空轉）');
  fPhys.add(P, 'abs').name('輔助：ABS（不鎖死）');
  fPhys.add(P, 'cornerBrakeMin', 0, 1, 0.01).name('輔助：彎道 ABS 至少保留煞車');
  fPhys.add(P, 'steerGripRecover', 0.5, 20, 0.1).name('放開煞車後轉向上限恢復速度');
  fPhys.add(P, 'esc', 0, 4, 0.05).name('輔助：車身穩定強度（0 = 關）');
  fPhys.add(P, 'escThresholdDeg', 2, 30, 0.5).name('輔助：滑出幾度才介入');
  fPhys.add(P, 'aeroFront', 0.3, 0.6, 0.01).name('下壓力前軸分配');

  // ================= 💡 燈光 =================
  const fLight = gui.addFolder('💡 燈光與場景').close();
  const relight = () => world.applyLighting();
  const L = CONFIG.lighting;
  fLight.add(L, 'exposure', 0.2, 2.5, 0.01).name('曝光').onChange(relight);
  fLight.add(L, 'envIntensity', 0, 3, 0.01).name('環境反射').onChange(relight);
  fLight.add(L, 'sunIntensity', 0, 8, 0.05).name('主光強度').onChange(relight);
  fLight.add(L, 'sunAzimuth', -180, 180, 1).name('主光方位°');
  fLight.add(L, 'sunElevation', 5, 90, 1).name('主光仰角°');
  fLight.add(L, 'hemiIntensity', 0, 3, 0.01).name('天光強度').onChange(relight);
  fLight.addColor(L, 'background').name('背景色').onChange(relight);
  fLight.addColor(L, 'floorColor').name('地板色').onChange(relight);
  fLight.add(L, 'gridOpacity', 0, 1, 0.01).name('格線濃度').onChange(relight);
  fLight.add(L, 'fogNear', 0, 300, 1).name('霧起點').onChange(relight);
  fLight.add(L, 'fogFar', 20, 800, 1).name('霧終點').onChange(relight);
  fLight.add(L, 'contactShadow', 0, 1, 0.01).name('車底陰影');

  // ================= ✨ 特效 =================
  const fFx = gui.addFolder('✨ 胎痕與煙霧').close();
  const F = CONFIG.fx;
  fFx.add(F, 'skidOpacity', 0, 1, 0.01).name('胎痕濃度');
  fFx.add(F, 'skidWidthScale', 0.2, 2, 0.01).name('胎痕寬度');
  fFx.add(F, 'skidThreshold', 0, 10, 0.1).name('胎痕門檻 m/s');
  fFx.add(F, 'smokeAmount', 0, 4, 0.05).name('煙霧量');
  fFx.add(F, 'smokeSize', 0.2, 8, 0.05).name('煙霧大小');
  fFx.add(F, 'smokeLife', 0.2, 6, 0.05).name('煙霧壽命');
  fFx.addColor(F, 'smokeColor').name('煙霧顏色');
  fFx.add(F, 'smokeOpacity', 0, 1, 0.01).name('煙霧濃度');

  // ================= 🔊 音效 =================
  const fAudio = gui.addFolder('🔊 音效').close();
  const A = CONFIG.audio;
  fAudio.add(A, 'master', 0, 1, 0.01).name('總音量').onChange(() => audio.applyVolume());
  fAudio.add(A, 'engine', 0, 1.5, 0.01).name('引擎');
  fAudio.add(A, 'screech', 0, 1.5, 0.01).name('輪胎尖叫');
  fAudio.add(A, 'curb', 0, 1.5, 0.01).name('路緣石噠噠聲');
  fAudio.add(A, 'turbo', 0, 1.5, 0.01).name('渦輪');

  // ================= ⏱ 動畫 =================
  const fAnim = gui.addFolder('⏱ 動畫與轉場').close();
  const AN = CONFIG.anim;
  fAnim.add(AN, 'tweenDuration', 0.2, 5, 0.05).name('鏡頭飛行秒數');
  fAnim.add(AN, 'tweenEase', Object.keys(EASES)).name('鏡頭緩動曲線');
  fAnim.add(AN, 'introDuration', 0.2, 8, 0.05).name('開場飛入秒數');
  fAnim.add(AN, 'fadeTime', 0.05, 2, 0.05).name('淡入淡出秒數');
  fAnim.add(AN, 'hotspotPulse', 0.4, 5, 0.05).name('熱點脈動週期');
  fAnim.add(AN, 'idleAutoRotate', 1, 30, 0.5).name('閒置幾秒後自轉');
  fAnim.add(AN, 'drsAngleDeg', 0, 70, 0.5).name('DRS 開啟角度');

  // ================= 📊 即時數值 =================
  const fStats = gui.addFolder('📊 即時數值').close();
  const stats = { fps: 0, kmh: 0, rpm: 0, gear: 'N', slipDeg: 0, slipR: 0, calls: 0 };
  fStats.add(stats, 'fps').name('FPS').listen().disable();
  fStats.add(stats, 'kmh').name('時速').listen().disable();
  fStats.add(stats, 'rpm').name('轉速').listen().disable();
  fStats.add(stats, 'gear').name('檔位').listen().disable();
  fStats.add(stats, 'slipDeg').name('車身滑移角°').listen().disable();
  fStats.add(stats, 'slipR').name('後輪滑移 m/s').listen().disable();
  fStats.add(stats, 'calls').name('Draw calls').listen().disable();

  gui.onChange(() => scheduleSave());

  // ---------- 匯出 ----------
  async function exportValues() {
    const changes = diff().map((d) => ({ path: d.path.join('.'), from: d.base, to: d.value }));
    const data = { exportedAt: new Date().toISOString(), changes, ...snapshot() };
    const json = JSON.stringify(data, null, 2);
    console.log('[PITLANE DEV EXPORT]', data);
    let msg = '';
    try {
      const res = await fetch('/__dev/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json });
      const j = await res.json();
      msg = j.ok ? `已寫入 ${j.file}` : `寫檔失敗：${j.error}`;
    } catch {
      msg = '目前不是 dev server，未寫入檔案';
    }
    try {
      await navigator.clipboard.writeText(json);
      msg += '，並已複製到剪貼簿';
    } catch {
      /* 剪貼簿權限被擋就算了 */
    }
    showModal(json, `${msg}。共 ${changes.length} 項與原始碼不同 — 跟 Claude 說「我調好了，鎖定」即可寫進原始碼。`);
  }

  function showModal(text, msg) {
    const wrap = document.createElement('div');
    wrap.className = 'dev-modal';
    wrap.innerHTML = `<div class="dev-modal-card"><div class="row"><span></span><button type="button">關閉</button></div><textarea readonly></textarea></div>`;
    wrap.querySelector('span').textContent = msg;
    wrap.querySelector('textarea').value = text;
    wrap.querySelector('button').addEventListener('click', () => wrap.remove());
    wrap.addEventListener('click', (e) => e.target === wrap && wrap.remove());
    document.body.appendChild(wrap);
  }

  // ---------- 每幀更新即時數值 ----------
  let fpsAcc = 0;
  let fpsN = 0;
  return {
    refresh: () => {
      refreshAll();
      scheduleSave();
    },
    tick(dt) {
      if (gui._hidden) return;
      fpsAcc += dt;
      fpsN++;
      if (fpsAcc > 0.5) {
        stats.fps = Math.round(fpsN / fpsAcc);
        fpsAcc = 0;
        fpsN = 0;
      }
      stats.kmh = Math.round(phys.kmh);
      stats.rpm = Math.round(phys.rpm);
      stats.gear = phys.gear === -1 ? 'R' : phys.gear === 0 ? 'N' : String(phys.gear);
      stats.slipDeg = Math.round((phys.beta * 180) / Math.PI);
      stats.slipR = round(phys.slipR, 1);
      stats.calls = renderer.info.render.calls;
    },
  };
}

function addVec(folder, arr, label, range) {
  const f = folder.addFolder(label);
  ['x', 'y', 'z'].forEach((axis, i) => f.add(arr, i, -range, range, 0.01).name(axis));
  return f;
}
