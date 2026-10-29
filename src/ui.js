// DOM 介面：版面配置（PC / Mobile）、3D 熱點、資訊卡、塗裝、駕駛 HUD
import * as THREE from 'three';
import { CONFIG, LAYOUT_PC, LAYOUT_MOBILE } from './config.js';
import { HOTSPOT_ORDER, HOTSPOT_TEXT, LIVERIES } from './content.js';
import { RPM_LIMITS } from './physics.js';

const $ = (sel, root = document) => root.querySelector(sel);

export class UI {
  constructor(cb) {
    this.cb = cb;
    this.forcedLayout = null; // DEV 可強制 'pc' / 'mobile'
    this.forceTouch = false;
    this.isTouchDevice = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.elements = {};
    document.querySelectorAll('[data-ui]').forEach((el) => (this.elements[el.dataset.ui] = el));

    this.buildHotspots();
    this.buildLivery();
    this.buildShiftLights();
    this.bindInfo();
    this.bindDriveBar();

    $('[data-ui="driveBtn"]').addEventListener('click', () => cb.onDrive());
    this.applyLayout();
    window.addEventListener('resize', () => this.applyLayout());
  }

  // ---------- 版面 ----------
  get layoutKey() {
    if (this.forcedLayout) return this.forcedLayout;
    const w = window.innerWidth;
    return w < 760 || (this.isTouchDevice && w < 1024) ? 'mobile' : 'pc';
  }

  get layout() {
    return this.layoutKey === 'mobile' ? LAYOUT_MOBILE : LAYOUT_PC;
  }

  applyLayout() {
    const key = this.layoutKey;
    document.body.classList.toggle('layout-mobile', key === 'mobile');
    document.body.classList.toggle('layout-pc', key === 'pc');
    document.body.classList.toggle('touch-ui', this.isTouchDevice || this.forceTouch);
    const L = this.layout;
    for (const [id, el] of Object.entries(this.elements)) {
      if (L[id]) placeElement(el, L[id]);
    }
  }

  // ---------- 熱點 ----------
  buildHotspots() {
    const wrap = $('#hotspots');
    this.hotspotEls = {};
    HOTSPOT_ORDER.forEach((id) => {
      const btn = document.createElement('button');
      btn.className = 'hotspot';
      btn.type = 'button';
      btn.dataset.id = id;
      btn.innerHTML = `<span class="hs-label">${HOTSPOT_TEXT[id].title}</span>`;
      btn.addEventListener('click', () => {
        if (this.suppressClick) return;
        this.cb.onHotspot(id);
      });
      wrap.appendChild(btn);
      this.hotspotEls[id] = btn;
    });
    this._ray = new THREE.Raycaster();
    this._ray.firstHitOnly = true; // three-mesh-bvh：只找第一個交點
    this._v = new THREE.Vector3();
    this._w = new THREE.Vector3();
    this._frame = 0;
  }

  updateHotspots(camera, car, activeId) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this._frame++;
    const checkOcclusion = this._frame % 3 === 0;
    document.documentElement.style.setProperty('--pulse', `${CONFIG.anim.hotspotPulse}s`);
    for (const id of HOTSPOT_ORDER) {
      const el = this.hotspotEls[id];
      const world = car.root.localToWorld(this._w.set(...CONFIG.hotspots[id].anchor));
      const p = this._v.copy(world).project(camera);
      const behind = p.z > 1;
      el.classList.toggle('hidden', behind || (activeId && activeId !== id));
      el.classList.toggle('active', activeId === id);
      if (behind) continue;
      const x = (p.x * 0.5 + 0.5) * w;
      const y = (-p.y * 0.5 + 0.5) * h;
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      if (checkOcclusion) {
        const dir = world.clone().sub(camera.position);
        const dist = dir.length();
        this._ray.set(camera.position, dir.normalize());
        this._ray.far = dist;
        const hit = this._ray.intersectObjects(car.pickMeshes, false)[0];
        el.classList.toggle('occluded', !!hit && hit.distance < dist - 0.06);
      }
    }
  }

  // ---------- 資訊卡 ----------
  bindInfo() {
    const panel = this.elements.infoPanel;
    $('.info-close', panel).addEventListener('click', () => this.cb.onCloseHotspot());
    $('.info-prev', panel).addEventListener('click', () => this.cb.onStepHotspot(-1));
    $('.info-next', panel).addEventListener('click', () => this.cb.onStepHotspot(1));
    $('.info-action', panel).addEventListener('click', (e) => this.cb.onAction(e.currentTarget.dataset.action));
  }

  showInfo(id) {
    const t = HOTSPOT_TEXT[id];
    const panel = this.elements.infoPanel;
    const i = HOTSPOT_ORDER.indexOf(id);
    $('.info-index', panel).textContent = `${String(i + 1).padStart(2, '0')} / ${String(HOTSPOT_ORDER.length).padStart(2, '0')}`;
    $('.info-en', panel).textContent = t.en;
    $('.info-title', panel).textContent = t.title;
    $('.info-desc', panel).textContent = t.desc;
    $('.info-specs', panel).innerHTML = (t.specs || []).map(([k, v]) => `<li><span>${k}</span><b>${v}</b></li>`).join('');
    const btn = $('.info-action', panel);
    btn.hidden = !t.action;
    if (t.action) {
      btn.textContent = t.action.label;
      btn.dataset.action = t.action.id;
    }
    document.body.classList.add('info-open');
  }

  hideInfo() {
    document.body.classList.remove('info-open');
  }

  // ---------- 塗裝 ----------
  buildLivery() {
    const wrap = $('.swatches', this.elements.liveryBar);
    this.swatches = LIVERIES.map((lv, i) => {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.type = 'button';
      b.title = lv.name;
      b.style.background = lv.body;
      b.style.setProperty('--s2', lv.stripe);
      b.style.setProperty('--s3', lv.accent);
      b.addEventListener('click', () => {
        this.setActiveSwatch(i);
        this.cb.onLivery(lv);
      });
      wrap.appendChild(b);
      return b;
    });
    this.setActiveSwatch(0);
  }

  setActiveSwatch(i) {
    this.swatches.forEach((b, j) => b.classList.toggle('active', i === j));
  }

  // ---------- 駕駛 HUD ----------
  buildShiftLights() {
    const el = this.elements.shiftLights;
    el.innerHTML = '';
    this.leds = [];
    for (let i = 0; i < 15; i++) {
      const led = document.createElement('i');
      led.className = i < 5 ? 'g' : i < 10 ? 'r' : 'b';
      el.appendChild(led);
      this.leds.push(led);
    }
    const sp = this.elements.speedo;
    this.hud = {
      gear: $('.gear', sp),
      speed: $('.speed b', sp),
      rpm: $('.rpm i', sp),
      drift: this.elements.driftMeter,
      driftPoints: $('.drift-points', this.elements.driftMeter),
      driftMult: $('.drift-mult', this.elements.driftMeter),
      driftSum: $('.drift-sum', this.elements.driftMeter),
      driftBest: $('.drift-best', this.elements.driftMeter),
      driftPop: $('.drift-pop', this.elements.driftMeter),
    };
    this._last = {};
  }

  bindDriveBar() {
    const bar = this.elements.driveBar;
    $('.bar-home', bar).addEventListener('click', () => this.cb.onExitDrive());
    $('.bar-cam', bar).addEventListener('click', () => this.cb.onCamera());
    $('.bar-reset', bar).addEventListener('click', () => this.cb.onReset());
    $('.bar-mute', bar).addEventListener('click', () => this.cb.onMute());
  }

  setMuteLabel(muted) {
    const btn = $('.bar-mute', this.elements.driveBar);
    $('.txt', btn).textContent = muted ? '音效 關' : '音效 開';
    $('.ico', btn).textContent = muted ? '✕' : '♪';
  }

  setCameraLabel(name) {
    $('.bar-cam .txt', this.elements.driveBar).textContent = `鏡頭：${name}`;
  }

  updateHUD(phys, drift) {
    const set = (key, el, val) => {
      if (this._last[key] !== val) {
        el.textContent = val;
        this._last[key] = val;
      }
    };
    const gear = phys.gear === -1 ? 'R' : phys.gear === 0 ? 'N' : String(phys.gear);
    set('gear', this.hud.gear, gear);
    set('speed', this.hud.speed, String(Math.round(phys.kmh)));
    const rpmN = (phys.rpm - RPM_LIMITS.idle) / (RPM_LIMITS.max - RPM_LIMITS.idle);
    this.hud.rpm.style.width = `${Math.max(0, Math.min(1, rpmN)) * 100}%`;

    // 換檔燈：9,000 rpm 起亮，接近紅線整排閃藍
    const lit = Math.round(((phys.rpm - 9000) / (12600 - 9000)) * 15);
    const limiter = phys.rpm > 12900;
    this.elements.shiftLights.classList.toggle('flash', limiter && Math.floor(performance.now() / 70) % 2 === 0);
    this.leds.forEach((led, i) => led.classList.toggle('on', i < lit));

    this.hud.drift.classList.toggle('active', drift.active);
    set('dp', this.hud.driftPoints, String(Math.round(drift.points)));
    set('dm', this.hud.driftMult, `×${drift.mult}`);
    set('ds', this.hud.driftSum, String(drift.total));
    set('db', this.hud.driftBest, String(drift.best));
  }

  pop(text, fail = false) {
    const el = this.hud.driftPop;
    el.textContent = text;
    el.classList.remove('show', 'fail');
    void el.offsetWidth;
    el.classList.add('show');
    el.classList.toggle('fail', fail);
  }
}

// 依 anchor 與偏移量擺放元素
export function placeElement(el, cfg) {
  const s = el.style;
  const a = cfg.anchor || 'tl';
  const H = a.endsWith('l') ? 'l' : a.endsWith('r') ? 'r' : 'c';
  const V = a.startsWith('t') ? 't' : a.startsWith('b') ? 'b' : 'c';
  s.left = s.right = s.top = s.bottom = '';
  let tx = '0';
  let ty = '0';
  if (H === 'l') s.left = `${cfg.x}px`;
  else if (H === 'r') s.right = `${cfg.x}px`;
  else {
    s.left = `calc(50% + ${cfg.x}px)`;
    tx = '-50%';
  }
  if (V === 't') s.top = `${cfg.y}px`;
  else if (V === 'b') s.bottom = `${cfg.y}px`;
  else {
    s.top = `calc(50% + ${cfg.y}px)`;
    ty = '-50%';
  }
  s.transformOrigin = `${H === 'l' ? 'left' : H === 'r' ? 'right' : 'center'} ${V === 't' ? 'top' : V === 'b' ? 'bottom' : 'center'}`;
  s.transform = `translate(${tx}, ${ty}) scale(${cfg.scale})`;
  s.fontSize = `${cfg.fontSize}px`;
  s.setProperty('--c', cfg.color);
  s.setProperty('--o', cfg.opacity);
}
