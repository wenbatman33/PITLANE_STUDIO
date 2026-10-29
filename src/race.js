// 對手比賽：發車格、起跑紅燈、AI 推進、碰撞、圈數／名次／差距、終點成績、AI 脫困
// 與畫面無關：遊戲（main.js）與 scripts/race-test.mjs 共用
//   track 介面：length、projector() → (x, z) => { s, lateral, wl, wr }、gridPose(k) → { x, z, yaw }（發車格位置）
import { CarPhysics } from './physics.js';
import { CONFIG } from './config.js';
import { createGuide } from './autopilot.js';
import { createOpponentDriver } from './opponents.js';
import { resolveCollisions } from './collision.js';

const MARK = 50; // 每 50 m 記一次通過時間，用來算差距

// player：玩家的 CarPhysics；P：物理參數（AI 用同一份，但 AI 自己的輔助設定另外處理）
// raceline / center：建議路線來源（與遊戲 createGuide 相同的輸入）
// physOffset：發車格點（車模型原點）到物理質心的距離（往前為正）
export function createRace({ track, player, P, raceline, center, physOffset = 0, rand = Math.random, playerName = '你' }) {
  const R = CONFIG.race;
  const L = track.length;
  const project0 = track.projector();
  // AI 物理：與玩家同一台車，輔助（ABS／循跡／車身穩定）全開
  const aiP = Object.assign(Object.create(P), { abs: true, tractionControl: true, esc: 1, steerAssist: false });

  // 每個等級一份建議路線，並預先算出每一點相對賽道的側向位置與寬度
  function laneOf(guide) {
    const proj = track.projector();
    return guide.line.map((p) => {
      const pr = proj(p.x, p.z);
      return { lat: pr.lateral, wl: pr.wl, wr: pr.wr };
    });
  }

  const entries = [];
  const slots = [];
  const nCars = R.opponents.length + 1;
  for (let k = 0, o = 0; k < nCars; k++) {
    if (k === R.playerSlot) slots.push({ player: true });
    else slots.push({ opp: R.opponents[o++] });
  }
  slots.forEach((slot, k) => {
    const e = {
      id: k,
      slot: k,
      name: slot.player ? playerName : slot.opp.name,
      isPlayer: !!slot.player,
      opp: slot.opp || null,
      car: slot.player ? player : new CarPhysics(aiP),
      project: track.projector(),
      s: 0,
      lat: 0,
      wl: 5,
      wr: 5,
      lap: -1, // 完成圈數；起跑線前為 -1（progress = lap·L + s）
      prevS: null,
      armed: true, // 越線防抖：越線後要先跑過賽道中段，下一次越線才算
      progress: 0,
      marks: new Float64Array(Math.ceil(((R.laps + 2) * L) / MARK) + 4).fill(NaN),
      crossTimes: [],
      lapTimes: [],
      best: null,
      finished: false,
      finishTime: null,
      stuck: 0,
      respawns: 0,
      offTrack: false,
      ctl: { throttle: 0, brake: 0, steer: 0 },
      prev: { x: 0, z: 0, yaw: 0 },
    };
    if (slot.opp) {
      const g = createGuide(raceline, aiP, { grip: slot.opp.grip, brakeGrip: slot.opp.brakeGrip, lineBlend: slot.opp.lineBlend }, center);
      e.guide = g;
      e.lane = laneOf(g);
      e.driver = createOpponentDriver(g, e.lane, aiP, { defend: slot.opp.defend, exitThrottle: slot.opp.exitThrottle, rand });
    }
    entries.push(e);
  });

  const race = {
    entries,
    state: 'grid', // grid → lights → racing → finished（玩家完賽）
    time: 0, // 綠燈後經過秒數
    lightsOn: 0, // 亮了幾盞紅燈（0~5）
    lightsT: 0,
    goDelay: 0,
    collisions: 0, // 碰撞次數（兩車開始接觸才算一次）
    hits: [], // 每次碰撞的紀錄 { a, b, impulse, time, s }
    touching: new Set(),
    lastHit: null, // { a, b, impulse }：給音效用
    laps: R.laps,
    trackLength: L,

    // 把所有車放到發車格、停住
    reset() {
      entries.forEach((e) => {
        const g = track.gridPose(e.slot);
        const fx = Math.sin(g.yaw);
        const fz = Math.cos(g.yaw);
        e.car.reset(g.x - fx * physOffset, g.z - fz * physOffset, g.yaw);
        e.prev = { x: e.car.x, z: e.car.z, yaw: e.car.yaw };
        e.lap = -1;
        e.prevS = null;
        e.armed = true;
        e.marks.fill(NaN);
        e.crossTimes.length = 0;
        e.lapTimes.length = 0;
        e.best = null;
        e.finished = false;
        e.finishTime = null;
        e.stuck = 0;
        e.respawns = 0;
        e.ctl = { throttle: 0, brake: 0, steer: 0 };
      });
      this.state = 'grid';
      this.laps = R.laps;
      this.time = 0;
      this.lightsOn = 0;
      this.lightsT = 0;
      this.collisions = 0;
      this.hits = [];
      this.touching = new Set();
      this.track();
    },

    // 開始起跑程序：紅燈一盞盞亮，全亮後隨機 0.4~1.4 秒熄燈起跑
    startLights() {
      this.state = 'lights';
      this.lightsOn = 0;
      this.lightsT = 0;
      this.goDelay = 0.4 + rand();
    },

    // 每幀：起跑程序、AI 決策（玩家的輸入由外部處理）
    update(dt) {
      if (this.state === 'lights') {
        this.lightsT += dt;
        this.lightsOn = Math.min(5, Math.floor(this.lightsT / R.lightsInterval));
        if (this.lightsT >= 5 * R.lightsInterval + this.goDelay) {
          this.state = 'racing';
          this.lightsOn = 0;
          this.time = 0;
        }
      }
      const moving = this.state === 'racing' || this.state === 'finished';
      for (const e of entries) {
        if (e.isPlayer) continue;
        if (!moving) {
          e.ctl = { throttle: 0, brake: 1, steer: 0, analog: true };
          continue;
        }
        e.ctl = e.driver.control(e, entries, dt, L);
        // 完賽後收油巡航
        if (e.finished) e.ctl.throttle *= 0.5;
        this.recover(e, dt);
      }
    },

    // 固定步長物理：推進 AI、處理碰撞、更新進度
    step(dt) {
      for (const e of entries) {
        e.prev.x = e.car.x;
        e.prev.z = e.car.z;
        e.prev.yaw = e.car.yaw;
        if (!e.isPlayer) {
          e.car.surfaceGrip = e.offTrack ? CONFIG.track.offGrip : 1;
          e.car.surfaceDrag = e.offTrack ? CONFIG.track.offDrag : 0;
          e.car.step(dt, e.ctl);
        }
      }
      if (this.state === 'racing' || this.state === 'finished') this.time += dt;
      const cars = entries.map((e) => e.car);
      const now = new Set();
      resolveCollisions(cars, (a, b, imp) => {
        const key = a * 16 + b;
        now.add(key);
        if (!this.touching.has(key) && imp > 200) {
          this.collisions++;
          const A = entries[a];
          const B = entries[b];
          // 記下當下誰在前（progress 大的在前）與側向差
          const [front, back] = A.progress >= B.progress ? [A, B] : [B, A];
          this.lastHit = { a: A, b: B, front, back, gap: front.progress - back.progress, dLat: front.lat - back.lat, impulse: imp, time: this.time, s: A.s };
          this.hits.push(this.lastHit);
        }
      });
      this.touching = now;
    },

    // 玩家跑完一個物理步驟後呼叫：記錄玩家的上一步位置（讓畫面插值一致）
    markPlayerPrev(x, z, yaw) {
      const e = entries.find((q) => q.isPlayer);
      e.prev.x = x;
      e.prev.z = z;
      e.prev.yaw = yaw;
    },

    // 每幀：投影到賽道、圈數、名次
    track() {
      for (const e of entries) {
        const pr = e.project(e.car.x, e.car.z);
        e.s = pr.s;
        e.lat = pr.lateral;
        e.wl = pr.wl;
        e.wr = pr.wr;
        e.offTrack = Math.abs(pr.lateral) > (pr.lateral > 0 ? pr.wl : pr.wr) + CONFIG.track.curbWidth + CONFIG.track.offMargin;
        if (e.prevS != null && e.prevS - e.s > L / 2 && e.armed) {
          this.crossLine(e);
          e.armed = false;
        }
        if (!e.armed && e.s > L * 0.35 && e.s < L * 0.65) e.armed = true;
        e.prevS = e.s;
        // 剛越線後在線上前後抖動（或被放回線後）時，進度不能突然多一整圈
        e.progress = e.lap * L + e.s - (!e.armed && e.s > L * 0.65 ? L : 0);
        if (this.state === 'racing' || this.state === 'finished') {
          const m = Math.floor((e.progress + L) / MARK);
          if (m >= 0 && m < e.marks.length && Number.isNaN(e.marks[m])) e.marks[m] = this.time;
        }
      }
    },

    crossLine(e) {
      e.lap++;
      if (this.state !== 'racing' && this.state !== 'finished') return;
      e.crossTimes[e.lap] = this.time;
      if (e.lap >= 1 && e.crossTimes[e.lap - 1] != null) {
        const t = e.crossTimes[e.lap] - e.crossTimes[e.lap - 1];
        e.lapTimes.push(t);
        if (!e.best || t < e.best) e.best = t;
      }
      if (e.lap >= R.laps && !e.finished) {
        e.finished = true;
        e.finishTime = this.time;
        if (e.isPlayer) this.state = 'finished';
      }
    },

    // 名次：已完賽的依完賽時間，其餘依進度
    standings() {
      return [...entries].sort((a, b) => {
        if (a.finished && b.finished) return a.finishTime - b.finishTime;
        if (a.finished !== b.finished) return a.finished ? -1 : 1;
        return b.progress - a.progress;
      });
    },

    // 與另一台車的時間差（秒，正＝我落後）：用兩車都通過的最近一個 50m 點
    gap(e, other) {
      const m = Math.floor((Math.min(e.progress, other.progress) + L) / MARK);
      for (let k = m; k >= 0; k--) {
        const a = e.marks[k];
        const b = other.marks[k];
        if (!Number.isNaN(a) && !Number.isNaN(b)) return a - b;
      }
      return null;
    },

    // AI 脫困：停住、方向反了、或離賽道太遠超過 2.5 秒 → 放回賽道（避開其他車）
    recover(e, dt) {
      const c = e.car;
      const g = e.guide;
      const i = e.driver.locate(c.x, c.z);
      const t = g.tan[i];
      const heading = Math.atan2(Math.sin(c.yaw - Math.atan2(t.x, t.z)), Math.cos(c.yaw - Math.atan2(t.x, t.z)));
      const far = Math.abs(e.lat) > Math.max(e.wl, e.wr) + 12;
      const bad = (c.speed < 2 && this.time > 4) || Math.abs(heading) > 1.8 || far;
      e.stuck = bad ? e.stuck + dt : 0;
      if (e.stuck < 2.5) return;
      for (let back = 15; back < 120; back += 10) {
        const j = (i - back + g.n) % g.n;
        const p = g.line[j];
        const clear = entries.every((o) => o === e || Math.hypot(o.car.x - p.x, o.car.z - p.z) > 14);
        if (!clear) continue;
        const tj = g.tan[j];
        c.reset(p.x, p.z, Math.atan2(tj.x, tj.z));
        e.prev = { x: c.x, z: c.z, yaw: c.yaw };
        e.stuck = 0;
        e.respawns++;
        return;
      }
    },
  };
  race.reset();
  return race;
}
