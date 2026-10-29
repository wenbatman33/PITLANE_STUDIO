// Web Audio 合成音效：V6 引擎（隨轉速變調）、渦輪聲、輪胎尖叫、撞錐聲；不需要音檔
import { CONFIG } from './config.js';
import { clamp } from './util.js';

export class EngineAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.running = false;
    this.lastThrottle = 0;
    this.popCooldown = 0;
  }

  // 必須在使用者手勢內呼叫（iOS 限制）
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    // 引擎：三組振盪器 → 失真 → 低通
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 1.4;
    const shaper = ctx.createWaveShaper();
    shaper.curve = makeDistortion(3.2);
    shaper.oversample = '2x';
    this.oscs = [
      { type: 'sawtooth', mult: 1, gain: 0.42 },
      { type: 'square', mult: 0.5, gain: 0.22 },
      { type: 'sawtooth', mult: 2, gain: 0.12 },
      { type: 'triangle', mult: 3, gain: 0.06 },
    ].map((o) => {
      const osc = ctx.createOscillator();
      osc.type = o.type;
      osc.frequency.value = 200 * o.mult;
      const g = ctx.createGain();
      g.gain.value = o.gain;
      osc.connect(g).connect(shaper);
      osc.start();
      return { osc, mult: o.mult };
    });
    // 轉速抖動讓聲音比較「粗」
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 31;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 6;
    lfo.connect(lfoGain);
    this.oscs.forEach((o) => lfoGain.connect(o.osc.detune));
    lfo.start();
    shaper.connect(this.filter).connect(this.engineGain).connect(this.master);

    // 渦輪哨音
    this.turbo = ctx.createOscillator();
    this.turbo.type = 'sine';
    this.turboGain = ctx.createGain();
    this.turboGain.gain.value = 0;
    this.turbo.connect(this.turboGain).connect(this.master);
    this.turbo.start();

    // 噪音源（輪胎尖叫、回火）
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuf = noiseBuf;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;
    noise.loop = true;
    this.screechFilter = ctx.createBiquadFilter();
    this.screechFilter.type = 'bandpass';
    this.screechFilter.Q.value = 9;
    this.screechFilter.frequency.value = 1200;
    this.screechGain = ctx.createGain();
    this.screechGain.gain.value = 0;
    noise.connect(this.screechFilter).connect(this.screechGain).connect(this.master);
    noise.start();

    this.applyVolume();
  }

  applyVolume() {
    if (!this.ctx) return;
    const v = this.muted || !this.running ? 0 : CONFIG.audio.master;
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.12);
  }

  setRunning(on) {
    this.running = on;
    this.applyVolume();
  }

  setMuted(m) {
    this.muted = m;
    this.applyVolume();
  }

  // rpm: 實際轉速；throttle 0..1；skid 0..1；dt 秒
  update(dt, rpm, throttle, skid) {
    if (!this.ctx || !this.running) return;
    const A = CONFIG.audio;
    const t = this.ctx.currentTime;
    const rpmN = clamp((rpm - 4000) / 9200, 0, 1);
    // V6 四行程：每轉點火 3 次
    const f = (rpm / 60) * 3 * 0.5;
    for (const o of this.oscs) o.osc.frequency.setTargetAtTime(f * o.mult, t, 0.02);
    this.filter.frequency.setTargetAtTime(500 + rpmN * 3800 + throttle * 1800, t, 0.04);
    this.engineGain.gain.setTargetAtTime(A.engine * (0.28 + throttle * 0.42 + rpmN * 0.3), t, 0.05);
    this.turbo.frequency.setTargetAtTime(2200 + rpmN * 3600, t, 0.08);
    this.turboGain.gain.setTargetAtTime(A.turbo * 0.05 * throttle * rpmN, t, 0.15);
    this.screechFilter.frequency.setTargetAtTime(950 + skid * 650, t, 0.05);
    this.screechGain.gain.setTargetAtTime(A.screech * clamp(skid, 0, 1) * 0.6, t, 0.06);

    // 高轉速收油時的回火爆音
    this.popCooldown -= dt;
    if (this.lastThrottle > 0.6 && throttle < 0.1 && rpm > 8500) this.pops = 4 + Math.floor(Math.random() * 4);
    if (this.pops > 0 && this.popCooldown <= 0) {
      this.burst(0.06 + Math.random() * 0.05, 220 + Math.random() * 300, 0.5 * A.engine);
      this.pops--;
      this.popCooldown = 0.05 + Math.random() * 0.09;
    }
    this.lastThrottle = throttle;
  }

  // 短促噪音（回火、撞錐）
  burst(duration, freq, gain) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = freq;
    filt.Q.value = 1.2;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filt).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5, duration + 0.05);
  }

  hit() {
    this.burst(0.18, 180, 0.9);
  }
}

function makeDistortion(k) {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return curve;
}
