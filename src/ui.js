// DOM 介面：版面配置（PC / Mobile）、3D 熱點、資訊卡、塗裝、駕駛 HUD
import * as THREE from 'three';
import { CONFIG, LAYOUT_PC, LAYOUT_MOBILE } from './config.js';
import { HOTSPOT_ORDER, HOTSPOT_TEXT, LIVERIES } from './content.js';
import { RPM_LIMITS } from './physics.js';
import { formatTime } from './timing.js';

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
    const portrait = window.innerHeight > w;
    // 手機版面只給「窄的直式畫面」或觸控裝置；橫向小視窗用 PC 版面
    return (w < 760 && portrait) || w < 480 || (this.isTouchDevice && w < 1024) ? 'mobile' : 'pc';
  }

  get layout() {
    return this.layoutKey === 'mobile' ? LAYOUT_MOBILE : LAYOUT_PC;
  }

  applyLayout() {
    const key = this.layoutKey;
    document.body.classList.toggle('layout-mobile', key === 'mobile');
    document.body.classList.toggle('layout-pc', key === 'pc');
    document.body.classList.toggle('touch-ui', this.isTouchDevice || this.forceTouch);
    // 小視窗時整組 HUD 等比例縮小（設計基準 1280×780）
    const w = window.innerWidth;
    const h = window.innerHeight;
    UI_SCALE = key === 'pc' ? Math.min(1, Math.max(0.45, Math.min(w / 1280, h / 780))) : 1;
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
    $('.bar-demo', bar).addEventListener('click', () => this.cb.onDemo?.());
    $('.bar-line', bar).addEventListener('click', () => this.cb.onLine?.());
  }

  setLineLabel(style) {
    $('.bar-line .txt', this.elements.driveBar).textContent = style === 'best' ? '路線：最佳' : '路線：安全';
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

  // ---------- 賽道模式 HUD ----------
  initTrack(track) {
    document.body.classList.add('track-mode');
    const lt = this.elements.lapTimer;
    this.lt = {
      root: lt,
      lap: $('.lt-lap', lt),
      time: $('.lt-time', lt),
      delta: $('.lt-delta', lt),
      sectors: [...lt.querySelectorAll('.lt-sectors i')],
      last: $('.lt-last', lt),
      best: $('.lt-best', lt),
    };
    this.warnEl = this.elements.trackWarning;
    this.flash = { text: '', until: 0, kind: '' };
    const mm = this.elements.minimap;
    $('.mm-name', mm).textContent = `${track.def.name} · ${(track.length / 1000).toFixed(2)} km`;
    this.mm = { canvas: $('canvas', mm), track, base: null, size: 0 };
  }

  // 底圖（賽道線）只在尺寸改變時重畫
  drawMinimapBase() {
    const { canvas, track } = this.mm;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = Math.max(32, Math.round(canvas.clientWidth * dpr));
    if (size === this.mm.size && this.mm.base) return;
    canvas.width = canvas.height = size;
    const path = track.path2d;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of path) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const pad = size * 0.08;
    const k = (size - pad * 2) / Math.max(maxX - minX, maxY - minY);
    const ox = (size - (maxX - minX) * k) / 2 - minX * k;
    const oy = (size - (maxY - minY) * k) / 2 - minY * k;
    this.mm.map = (x, z) => [-x * k + ox, -z * k + oy];
    const base = document.createElement('canvas');
    base.width = base.height = size;
    const g = base.getContext('2d');
    g.lineJoin = g.lineCap = 'round';
    g.beginPath();
    path.forEach(([x, y], i) => (i ? g.lineTo(x * k + ox, y * k + oy) : g.moveTo(x * k + ox, y * k + oy)));
    g.closePath();
    g.strokeStyle = 'rgba(21,23,27,0.85)';
    g.lineWidth = size * 0.035;
    g.stroke();
    g.strokeStyle = '#ffffff';
    g.lineWidth = size * 0.012;
    g.stroke();
    // 起跑線
    const [sx, sy] = [path[0][0] * k + ox, path[0][1] * k + oy];
    g.fillStyle = '#e10600';
    g.beginPath();
    g.arc(sx, sy, size * 0.025, 0, Math.PI * 2);
    g.fill();
    this.mm.base = base;
    this.mm.size = size;
  }

  updateTrackHUD(timer, phys, now, others = null) {
    if (!this.lt) return;
    const L = this.lt;
    const set = (key, el, val) => {
      if (this._last[key] !== val) {
        el.textContent = val;
        this._last[key] = val;
      }
    };
    const mode = this.levelName ? ` · ${this.levelName}` : '';
    set('lap', L.lap, (timer.lap === 0 ? '暖胎圈' : `LAP ${timer.lap}`) + mode);
    L.time.textContent = timer.running ? formatTime(timer.time) : '0:00.000';
    L.root.classList.toggle('invalid', timer.running && !timer.valid);
    const d = timer.delta;
    set('delta', L.delta, d == null ? '' : `${d < 0 ? '−' : '+'}${Math.abs(d).toFixed(2)}`);
    L.delta.classList.toggle('faster', d != null && d < 0);
    L.delta.classList.toggle('slower', d != null && d >= 0);
    // 跨線後 4 秒內仍顯示上一圈的分段成績
    const showLast = timer.last && timer.running && timer.time < 4;
    const secs = showLast ? timer.last.sectors : timer.sectors;
    const states = showLast ? timer.last.states : timer.sectorState;
    L.sectors.forEach((el, i) => {
      const st = states[i];
      const label = secs[i] != null ? secs[i].toFixed(3) : `S${i + 1}`;
      set(`sec${i}`, el, label);
      el.className = st;
    });
    set('last', L.last, timer.last ? formatTime(timer.last.time) + (timer.last.valid ? '' : ' ✕') : '--:--.---');
    set('best', L.best, timer.best ? formatTime(timer.best.time) : '--:--.---');

    // 警告／訊息：逆向 > 出界 > 短暫訊息
    let text = '';
    let kind = '';
    if (timer.wrongWay > 1.2) text = '⚠ 逆向行駛';
    else if (timer.offTrack) text = timer.running ? '賽道外・該圈不計' : '賽道外';
    else if (now < this.flash.until) {
      text = this.flash.text;
      kind = this.flash.kind;
    }
    set('warn', this.warnEl, text);
    this.warnEl.classList.toggle('info', kind === 'info');

    // 小地圖
    this.drawMinimapBase();
    const ctx = this.mm.canvas.getContext('2d');
    const size = this.mm.size;
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(this.mm.base, 0, 0);
    // 對手：彩色小圓點
    if (others) {
      for (const o of others) {
        const [ox, oy] = this.mm.map(o.x, o.z);
        ctx.fillStyle = o.color;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = size * 0.008;
        ctx.beginPath();
        ctx.arc(ox, oy, size * 0.028, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    const [cx, cy] = this.mm.map(phys.x, phys.z);
    const ang = Math.atan2(-Math.cos(phys.yaw), -Math.sin(phys.yaw));
    const r = size * 0.05;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    ctx.fillStyle = '#e10600';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = size * 0.012;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(-r * 0.7, r * 0.6);
    ctx.lineTo(-r * 0.7, -r * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // ---------- 難度與教學 ----------
  initDifficulty(onChange) {
    const el = this.elements.difficulty;
    this.diffBtns = [...el.querySelectorAll('[data-level]')];
    this.diffBtns.forEach((b) => b.addEventListener('click', () => onChange(b.dataset.level)));
  }

  // ---------- 對手比賽 ----------
  // 練習／比賽切換（展示間）
  initSession(current, onChange) {
    const el = this.elements.sessionPicker;
    if (!el) return;
    this.sessionBtns = [...el.querySelectorAll('[data-session]')];
    this.sessionBtns.forEach((b) => b.addEventListener('click', () => onChange(b.dataset.session)));
    this.setSession(current);
  }

  setSession(id) {
    this.sessionBtns?.forEach((b) => b.classList.toggle('active', b.dataset.session === id));
    const desc = id === 'race' ? `4 台 AI 對手同場、會碰撞；${CONFIG.race.laps} 圈決勝負，看你排第幾` : '單人跑圈，挑戰自己的最佳圈';
    $('.diff-desc', this.elements.sessionPicker).textContent = desc;
    document.body.classList.toggle('session-race', id === 'race');
  }

  // 名次表、紅燈、終點成績（每幀呼叫，DOM 只在內容改變時更新）
  updateRace(race, standings) {
    const tower = this.elements.raceTower;
    if (!this.rt) {
      this.rt = { pos: $('.rt-pos', tower), lap: $('.rt-lap', tower), rows: $('.rt-rows', tower), lights: [...this.elements.startLights.querySelectorAll('i')], html: '' };
    }
    const me = race.entries.find((e) => e.isPlayer);
    const myPos = standings.indexOf(me) + 1;
    this.rt.pos.textContent = `P${myPos}`;
    const lapNo = Math.min(race.laps, Math.max(1, me.lap + 1));
    this.rt.lap.textContent = me.finished ? '完賽' : `第 ${lapNo} / ${race.laps} 圈`;
    const leader = standings[0];
    const html = standings
      .map((e, k) => {
        let gap = '';
        if (k > 0) {
          const laps = Math.floor((leader.progress - e.progress) / race.trackLength);
          if (laps >= 1 && !e.finished) gap = `+${laps} 圈`;
          else {
            const g = race.gap(e, leader);
            gap = g == null ? '' : `+${g.toFixed(1)}`;
          }
        }
        const hue = e.opp ? e.opp.hue : null;
        const chip = hue == null ? 'style="background:#e10600"' : `style="--hue:${hue}"`;
        return `<li class="${e.isPlayer ? 'me' : ''}"><b>${k + 1}</b><i class="chip" ${chip}></i><span>${e.name}</span><em>${gap}</em></li>`;
      })
      .join('');
    if (html !== this.rt.html) {
      this.rt.rows.innerHTML = html;
      this.rt.html = html;
    }
    // 起跑紅燈：一盞盞亮，全部熄滅＝起跑
    const showLights = race.state === 'lights';
    document.body.classList.toggle('race-lights', showLights);
    this.rt.lights.forEach((el, k) => el.classList.toggle('on', showLights && k < race.lightsOn));
  }

  showRaceResult(race, standings) {
    const el = this.elements.raceResult;
    const me = race.entries.find((e) => e.isPlayer);
    const pos = standings.indexOf(me) + 1;
    $('.rr-title', el).textContent = pos === 1 ? '冠軍！' : `第 ${pos} 名`;
    const fastest = Math.min(...race.entries.filter((e) => e.best).map((e) => e.best));
    $('.rr-sub', el).textContent = me.best ? `你的最快圈 ${formatTime(me.best)}${me.best <= fastest + 1e-6 ? '（全場最快）' : `，比全場最快慢 ${(me.best - fastest).toFixed(3)} 秒`}` : '';
    $('tbody', el).innerHTML = standings
      .map((e, k) => {
        const t = e.finished ? formatTime(e.finishTime) : '比賽中';
        const best = e.best ? formatTime(e.best) : '—';
        return `<tr class="${e.isPlayer ? 'me' : ''}"><td>${k + 1}</td><td>${e.name}</td><td>${t}</td><td class="${e.best && e.best <= fastest + 1e-6 ? 'fastest' : ''}">${best}</td></tr>`;
      })
      .join('');
    document.body.classList.add('race-done');
  }

  hideRaceResult() {
    document.body.classList.remove('race-done');
  }

  // 賽道選單：每條賽道一個按鈕，下方顯示全名與長度
  initTracks(defs, current, onChange) {
    const el = this.elements.trackPicker;
    if (!el) return;
    const opts = $('.diff-opts', el);
    opts.innerHTML = Object.entries(defs)
      .map(([id, d]) => `<button type="button" data-track="${id}" class="${id === current ? 'active' : ''}">${d.label}</button>`)
      .join('');
    opts.querySelectorAll('[data-track]').forEach((b) => b.addEventListener('click', () => onChange(b.dataset.track)));
    $('.diff-desc', el).textContent = defs[current].fullName;
  }

  setDifficulty(level, def) {
    this.diffBtns?.forEach((b) => b.classList.toggle('active', b.dataset.level === level));
    $('.diff-desc', this.elements.difficulty).textContent = def.desc;
    this.levelName = def.name;
  }

  showTutorial(def) {
    const el = this.elements.tutorial;
    $('.tut-title', el).textContent = `怎麼開（${def.name}模式）`;
    $('.tut-steps', el).innerHTML = def.tutorial.map(([k, t]) => `<li><b>${k}</b><span>${t}</span></li>`).join('');
    document.body.classList.add('tut-open');
  }

  hideTutorial() {
    document.body.classList.remove('tut-open');
  }

  // 示範駕駛：亮出目前按下的鍵
  updateKeyViz(ctl) {
    const el = this.elements.keyViz;
    if (!this.kv) {
      this.kv = { w: $('.kv-w', el), a: $('.kv-a', el), s: $('.kv-s', el), d: $('.kv-d', el), target: $('.kv-target', el) };
    }
    this.kv.w.classList.toggle('on', ctl.throttle > 0.5);
    this.kv.s.classList.toggle('on', ctl.brake > 0.5);
    this.kv.a.classList.toggle('on', ctl.steer > 0.15);
    this.kv.d.classList.toggle('on', ctl.steer < -0.15);
    this.kv.target.textContent = (ctl.targetSpeed || 0) >= 99 ? '全速' : Math.round(ctl.targetSpeed * 3.6);
  }

  flashMessage(text, kind = 'info', seconds = 3) {
    if (!this.flash) return;
    this.flash = { text, kind, until: performance.now() / 1000 + seconds };
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

// 目前的 HUD 整體縮放（小視窗會小於 1）
let UI_SCALE = 1;
export const uiScale = () => UI_SCALE;

// 依 anchor 與偏移量擺放元素（偏移與縮放都乘上 UI_SCALE）
export function placeElement(el, cfg) {
  const k = UI_SCALE;
  const s = el.style;
  const a = cfg.anchor || 'tl';
  const H = a.endsWith('l') ? 'l' : a.endsWith('r') ? 'r' : 'c';
  const V = a.startsWith('t') ? 't' : a.startsWith('b') ? 'b' : 'c';
  s.left = s.right = s.top = s.bottom = '';
  let tx = '0';
  let ty = '0';
  const x = cfg.x * k;
  const y = cfg.y * k;
  if (H === 'l') s.left = `${x}px`;
  else if (H === 'r') s.right = `${x}px`;
  else {
    s.left = `calc(50% + ${x}px)`;
    tx = '-50%';
  }
  if (V === 't') s.top = `${y}px`;
  else if (V === 'b') s.bottom = `${y}px`;
  else {
    s.top = `calc(50% + ${y}px)`;
    ty = '-50%';
  }
  s.transformOrigin = `${H === 'l' ? 'left' : H === 'r' ? 'right' : 'center'} ${V === 't' ? 'top' : V === 'b' ? 'bottom' : 'center'}`;
  s.transform = `translate(${tx}, ${ty}) scale(${cfg.scale * k})`;
  s.fontSize = `${cfg.fontSize}px`;
  s.setProperty('--c', cfg.color);
  s.setProperty('--o', cfg.opacity);
}
