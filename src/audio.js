// Web Audio 合成音效：V6 渦輪混合動力引擎（AudioWorklet 逐次燃燒合成）、渦輪聲、輪胎尖叫、撞錐聲；不需要音檔
import { CONFIG } from './config.js';
import { clamp } from './util.js';
import engineWorkletUrl from './engineWorklet.js?url';

export class EngineAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.running = false;
    this.lastThrottle = 0;
    this.lastRpm = 0;
    this.popCooldown = 0;
    this.cutTimer = 0;
    this.blipTimer = 0;
    this.spool = 0;
    this.engine = null;
    this.ready = Promise.resolve();
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

    // 總輸出：壓縮器把突然的大聲收住，整體聽起來比較穩、不刺耳
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -18;
    this.comp.knee.value = 12;
    this.comp.ratio.value = 3.5;
    this.comp.attack.value = 0.005;
    this.comp.release.value = 0.15;
    this.comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(this.comp);

    // 引擎：AudioWorklet 合成 → 稍微壓低 3 kHz 附近（人耳最敏感、最容易覺得吵的區段）
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineEq = ctx.createBiquadFilter();
    this.engineEq.type = 'peaking';
    this.engineEq.frequency.value = 3000;
    this.engineEq.Q.value = 0.9;
    this.engineEq.gain.value = -4;
    // 低音加強：讓引擎聲有厚度
    this.engineBass = ctx.createBiquadFilter();
    this.engineBass.type = 'lowshelf';
    this.engineBass.frequency.value = 250;
    this.engineBass.gain.value = CONFIG.audio.bass ?? 4;
    this.engineGain.connect(this.engineBass).connect(this.engineEq).connect(this.master);
    this.ready = ctx.audioWorklet
      ? ctx.audioWorklet
          .addModule(engineWorkletUrl)
          .then(() => {
            this.engine = new AudioWorkletNode(ctx, 'f1-engine', { numberOfInputs: 0, outputChannelCount: [1] });
            this.engine.connect(this.engineGain);
          })
          .catch(() => this.buildFallbackEngine())
      : Promise.resolve(this.buildFallbackEngine());

    // 渦輪哨音（收油時最明顯）
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

    // 路緣石：輪胎壓過一條條凸起的「噠噠噠」— 鋸齒波（頻率＝每秒壓過幾條）＋低通
    this.rumble = ctx.createOscillator();
    this.rumble.type = 'sawtooth';
    this.rumble.frequency.value = 40;
    this.rumbleFilter = ctx.createBiquadFilter();
    this.rumbleFilter.type = 'lowpass';
    this.rumbleFilter.frequency.value = 380;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    this.rumble.connect(this.rumbleFilter).connect(this.rumbleGain).connect(this.master);
    this.rumble.start();
    noise.start();

    this.applyVolume();
  }

  // 不支援 AudioWorklet 時（例如用區網 http 連線的手機）：單一鋸齒波＋低通，不加失真
  buildFallbackEngine() {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.value = 0.35;
    osc.connect(lp).connect(g).connect(this.engineGain);
    osc.start();
    this.fallback = { osc, lp };
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

  // rpm: 實際轉速；throttle 0..1；skid 0..1；dt 秒；curb：{ amount 0..1, rate 每秒壓過幾條 }
  update(dt, rpm, throttle, skid, curb = null) {
    if (!this.ctx || !this.running) return;
    const A = CONFIG.audio;
    const t = this.ctx.currentTime;
    const rpmN = clamp((rpm - 4000) / 9200, 0, 1);
    const rate = dt > 0 ? (rpm - this.lastRpm) / dt : 0;
    // 升檔：全油門時轉速瞬間掉下 → 極短斷火；降檔：收油時轉速往上跳 → 補油（brap）
    if (throttle > 0.5 && rate < -15000) this.cutTimer = 0.035;
    if (throttle < 0.2 && rate > 9000 && this.lastRpm > 0) this.blipTimer = 0.07;
    this.cutTimer = Math.max(0, this.cutTimer - dt);
    this.blipTimer = Math.max(0, this.blipTimer - dt);
    const load = Math.max(throttle, this.blipTimer > 0 ? 0.55 : 0);

    if (this.engine) {
      const P = this.engine.parameters;
      P.get('rpm').setTargetAtTime(rpm, t, 0.012);
      P.get('load').setTargetAtTime(load, t, 0.025);
      P.get('cut').setTargetAtTime(this.cutTimer > 0 ? 1 : 0, t, 0.004);
      for (const k of ['bright', 'rasp', 'resonance', 'jitter', 'body']) {
        const v = A[k] ?? P.get(k).defaultValue;
        if (P.get(k).value !== v) P.get(k).value = v;
      }
    } else if (this.fallback) {
      this.fallback.osc.frequency.setTargetAtTime((rpm / 60) * 3, t, 0.02);
      this.fallback.lp.frequency.setTargetAtTime((700 + load * 1800 + rpmN * 800) * (A.bright ?? 1), t, 0.04);
    }
    this.engineGain.gain.setTargetAtTime(A.engine * (this.fallback ? 0.4 + 0.6 * load : 1), t, 0.05);
    if (this.engineBass.gain.value !== (A.bass ?? 4)) this.engineBass.gain.value = A.bass ?? 4;

    // 渦輪：跟著油門與轉速慢慢轉起來、收油後慢慢停；收油時哨音最明顯
    const spoolTarget = throttle * rpmN;
    this.spool += (spoolTarget - this.spool) * clamp(dt / (spoolTarget > this.spool ? 0.5 : 1.4), 0, 1);
    this.turbo.frequency.setTargetAtTime(1500 + this.spool * 3000, t, 0.08);
    this.turboGain.gain.setTargetAtTime(A.turbo * 0.03 * this.spool * (0.3 + 0.7 * (1 - throttle)), t, 0.1);
    this.screechFilter.frequency.setTargetAtTime(950 + skid * 650, t, 0.05);
    this.screechGain.gain.setTargetAtTime(A.screech * clamp(skid, 0, 1) * 0.6, t, 0.06);
    if (this.rumble) {
      const amt = curb ? curb.amount : 0;
      if (curb) this.rumble.frequency.setTargetAtTime(clamp(curb.rate, 8, 160), t, 0.02);
      this.rumbleGain.gain.setTargetAtTime((A.curb ?? 0.5) * amt * 0.5, t, 0.03);
    }

    // 高轉速收油：排氣管裡幾聲輕微的劈啪（混合動力 F1 不像舊引擎那樣大聲回火）
    this.popCooldown -= dt;
    if (this.lastThrottle > 0.6 && throttle < 0.1 && rpm > 9500) this.pops = 1 + Math.floor(Math.random() * 3);
    if (this.pops > 0 && this.popCooldown <= 0) {
      this.burst(0.04 + Math.random() * 0.04, 300 + Math.random() * 300, 0.18 * A.engine);
      this.pops--;
      this.popCooldown = 0.06 + Math.random() * 0.1;
    }
    this.lastThrottle = throttle;
    this.lastRpm = rpm;
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
