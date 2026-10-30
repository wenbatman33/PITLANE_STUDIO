// 單人計時練習：圈速、三分段、與最佳圈的即時差距、逆向偵測
// 出界的圈照樣計時，另外記一個「含出界最佳圈」；有效最佳圈只收沒出界的圈
import { CONFIG } from './config.js';
import { storageGet, storageSet } from './util.js';

const BUCKET = 10; // 即時差距以每 10 公尺記錄一次時間

export function formatTime(t) {
  if (t == null || !isFinite(t)) return '--:--.---';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

export class LapTimer {
  constructor(track) {
    this.track = track;
    this.key = `pitlane.best.${track.id}`;
    const saved = storageGet(this.key, null);
    // 舊版重複計圈留下的異常紀錄（短於 30 秒）直接忽略
    this.best = saved?.time > 30 ? saved : null; // { time, sectors, trace }
    this.bestSectors = saved?.bestSectors || [null, null, null];
    this.anyKey = `pitlane.bestAny.${track.id}`;
    const savedAny = storageGet(this.anyKey, null);
    this.bestAny = savedAny?.time > 30 ? savedAny : null; // 含出界最佳圈（所有圈裡最快的，不論有沒有出界）{ time, trace }
    // 舊紀錄只有有效最佳圈：含出界最佳圈至少跟它一樣快
    if (this.best && (!this.bestAny || this.best.time < this.bestAny.time)) this.bestAny = { time: this.best.time, trace: this.best.trace };
    this.buckets = Math.ceil(track.length / BUCKET);
    this.events = [];
    this.reset();
  }

  reset() {
    this.lap = 0; // 0 = 暖胎圈（還沒跨過起跑線）
    this.running = false;
    this.time = 0;
    this.sectorStart = 0;
    this.sectorIdx = 0;
    this.sectors = [null, null, null];
    this.sectorState = ['', '', ''];
    this.valid = true;
    this.excluded = false; // 示範駕駛開過一部分的圈：兩種最佳圈都不收
    this.prevS = null;
    this.last = null;
    this.wrongWay = 0;
    this.offTrack = false;
    this.trace = new Float32Array(this.buckets).fill(NaN);
    this.delta = null;
    this.armed = true; // 跑過半圈後才允許下一次跨線計圈（避免在線上抖動重複計圈）
  }

  // proj 來自 track.project()
  update(dt, proj, phys) {
    const L = this.track.length;
    const s = proj.s;
    // 出界：整台車越過路緣石外緣
    const T = CONFIG.track;
    const edge = proj.lateral > 0 ? proj.wl : proj.wr;
    this.offTrack = Math.abs(proj.lateral) > edge + T.curbWidth + T.offMargin;
    if (this.prevS == null) {
      this.prevS = s;
      return;
    }
    let ds = s - this.prevS;
    if (ds > L / 2) ds -= L;
    if (ds < -L / 2) ds += L;

    if (phys.speed > 4) this.wrongWay = ds < 0 ? this.wrongWay + dt : Math.max(0, this.wrongWay - dt * 3);
    if (this.running) this.time += dt;

    if (s > L * 0.4 && s < L * 0.6) this.armed = true;
    if (ds > 0 && s < this.prevS) {
      if (this.armed) {
        this.armed = false;
        this.completeLap();
      }
    } else if (this.running && ds > 0) {
      const b = [L / 3, (2 * L) / 3];
      if (this.sectorIdx < 2 && this.prevS < b[this.sectorIdx] && s >= b[this.sectorIdx]) this.split(this.sectorIdx);
      const k = Math.min(this.buckets - 1, Math.floor(s / BUCKET));
      if (Number.isNaN(this.trace[k])) this.trace[k] = this.time;
      // 即時差距：跟有效最佳圈比；還沒有有效最佳圈時跟含出界最佳圈比
      const ref = (this.best || this.bestAny)?.trace?.[k];
      this.delta = ref != null && !Number.isNaN(ref) ? this.time - ref : null;
    }

    if (this.offTrack && this.running && this.valid) {
      this.valid = false;
      this.events.push({ type: 'invalid' });
    }
    this.prevS = s;
  }

  split(k) {
    const t = this.time - this.sectorStart;
    this.sectors[k] = t;
    this.sectorStart = this.time;
    this.sectorIdx = k + 1;
    this.sectorState[k] = this.rateSector(k, t);
  }

  // 紫 = 歷來最快、綠 = 比上一圈快、黃 = 較慢
  rateSector(k, t) {
    let state = 'yellow';
    if (this.valid && !this.noSave && (this.bestSectors[k] == null || t < this.bestSectors[k])) {
      this.bestSectors[k] = t;
      state = 'purple';
    } else if (this.last?.sectors?.[k] != null && t < this.last.sectors[k]) {
      state = 'green';
    }
    return state;
  }

  completeLap() {
    if (this.running) {
      this.split(2);
      const time = this.time;
      this.last = { time, valid: this.valid, sectors: [...this.sectors], states: [...this.sectorState] };
      // 示範駕駛的圈速不寫進玩家紀錄
      const counts = !this.noSave && !this.excluded;
      const isBest = counts && this.valid && (!this.best || time < this.best.time);
      if (isBest) this.best = { time, sectors: [...this.sectors], trace: Array.from(this.trace) };
      const isBestAny = counts && (!this.bestAny || time < this.bestAny.time);
      if (isBestAny) this.bestAny = { time, trace: Array.from(this.trace) };
      if (!this.noSave) {
        storageSet(this.key, this.best ? { ...this.best, bestSectors: this.bestSectors } : { bestSectors: this.bestSectors });
        if (isBestAny) storageSet(this.anyKey, this.bestAny);
      }
      this.events.push({ type: 'lap', lap: this.lap, time, valid: this.valid, best: isBest, bestAny: isBestAny, excluded: this.excluded });
    }
    this.lap++;
    this.running = true;
    this.time = 0;
    this.sectorStart = 0;
    this.sectorIdx = 0;
    this.sectors = [null, null, null];
    this.sectorState = ['', '', ''];
    this.valid = true;
    this.excluded = false;
    this.trace = new Float32Array(this.buckets).fill(NaN);
    this.delta = null;
  }

  clearBest() {
    this.best = null;
    this.bestAny = null;
    this.bestSectors = [null, null, null];
    storageSet(this.key, null);
    storageSet(this.anyKey, null);
  }
}
