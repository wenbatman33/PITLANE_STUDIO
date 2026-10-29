// 輸入整合：鍵盤、手把、觸控按鈕，輸出 throttle / brake / steer / handbrake
// 鍵盤：W／↑ 油門、空白鍵／↓ 煞車、A D／← → 轉向、X 倒車（F1 沒有手煞車，玩家輸入不提供；DEV 自動駕駛仍可用）
import { clamp } from './util.js';

export class Input {
  constructor() {
    this.keys = new Set();
    this.touch = { throttle: 0, brake: 0, steer: 0 };
    this.handlers = {};
    this.enabled = true;

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.target instanceof HTMLSelectElement) return;
      const k = normalize(e);
      if (!this.keys.has(k)) this.emit('press', k, e);
      this.keys.add(k);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(k)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(normalize(e)));
    window.addEventListener('blur', () => this.keys.clear());
  }

  on(evt, fn) {
    (this.handlers[evt] ||= []).push(fn);
  }

  emit(evt, ...args) {
    (this.handlers[evt] || []).forEach((fn) => fn(...args));
  }

  // 綁定觸控 DOM
  bindTouch({ steerEl, knobEl, gasEl, brakeEl }) {
    const pedal = (el, key) => {
      const down = (e) => {
        e.preventDefault();
        el.setPointerCapture?.(e.pointerId);
        el.classList.add('down');
        this.touch[key] = 1;
      };
      const up = () => {
        el.classList.remove('down');
        this.touch[key] = 0;
      };
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
    };
    pedal(gasEl, 'throttle');
    pedal(brakeEl, 'brake');

    let active = null;
    const track = steerEl.querySelector('.steer-track');
    const move = (e) => {
      const r = track.getBoundingClientRect();
      const half = r.width / 2 - knobEl.offsetWidth / 4;
      const v = clamp((e.clientX - (r.left + r.width / 2)) / half, -1, 1);
      // 螢幕右 = 右轉 = steer 負值
      this.touch.steer = -v;
      knobEl.style.transform = `translateX(${v * half}px)`;
    };
    const end = () => {
      active = null;
      this.touch.steer = 0;
      knobEl.style.transform = '';
    };
    track.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      active = e.pointerId;
      track.setPointerCapture?.(e.pointerId);
      move(e);
    });
    track.addEventListener('pointermove', (e) => {
      if (e.pointerId === active) move(e);
    });
    track.addEventListener('pointerup', end);
    track.addEventListener('pointercancel', end);
    track.addEventListener('lostpointercapture', end);
  }

  read() {
    const k = this.keys;
    let throttle = k.has('KeyW') || k.has('ArrowUp') ? 1 : 0;
    let brake = k.has('Space') || k.has('ArrowDown') ? 1 : 0;
    let steer = (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) - (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0);
    const reverse = k.has('KeyX');

    let analog = false;
    throttle = Math.max(throttle, this.touch.throttle);
    brake = Math.max(brake, this.touch.brake);
    if (Math.abs(this.touch.steer) > Math.abs(steer)) {
      steer = this.touch.steer;
      analog = true;
    }

    // 手把（標準配置：RT 油門、LT 煞車、左搖桿轉向）
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const ax = p.axes[0] || 0;
      if (Math.abs(ax) > 0.12 && Math.abs(ax) > Math.abs(steer)) {
        steer = -ax;
        analog = true;
      }
      throttle = Math.max(throttle, p.buttons[7]?.value || 0);
      brake = Math.max(brake, p.buttons[6]?.value || 0);
    }

    if (!this.enabled) return { throttle: 0, brake: 0, steer: 0, handbrake: false, analog: false, reverse: false };
    return { throttle, brake, steer, handbrake: false, analog, reverse };
  }
}

function normalize(e) {
  if (e.code === 'Space' || e.key === ' ') return 'Space';
  return e.code || e.key;
}
