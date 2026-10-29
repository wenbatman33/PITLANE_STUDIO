// 對手比賽模擬：AI 對手＋玩家同場跑完整場比賽（含碰撞），檢查有沒有卡住、亂撞、出界、打轉
// 用法：TRACK=Suzuka node scripts/race-test.mjs [person|bot|idle] [難度 rookie|standard] [SEED]
//   person：照教學玩的模擬真人（方向鍵按住／放開、反應 0.25 秒、看路線顏色煞車）
//   bot   ：玩家換成示範駕駛（自己判斷煞車點＋轉向輔助）
//   idle  ：玩家停在發車格不動（測 AI 會不會閃開、會不會卡住）
//   SOLO=冠軍：只放這一台 AI、玩家移出賽道（單獨測 AI 能不能乾淨跑完）
//   OPP='{"grip":0.9,...}'：覆寫 SOLO 那台 AI 的設定
import { CarPhysics } from '../src/physics.js';
import { CONFIG } from '../src/config.js';
import { LEVELS } from '../src/content.js';
import { createGuide, createDriver, brakeAssist, steerAssist, lineKeepAssist } from '../src/autopilot.js';
import { createRace } from '../src/race.js';
import { loadSimTrack } from './lib/sim-track.mjs';

const TRACK = process.env.TRACK || 'Monza';
const MODE = process.argv[2] || 'person';
const LEVEL = process.argv[3] || 'standard';
let seed = Number(process.argv[4] || process.env.SEED || 20261029);
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

if (process.env.SOLO) {
  const o = CONFIG.race.opponents.find((q) => q.name === process.env.SOLO);
  CONFIG.race.opponents = [{ ...o, ...(process.env.OPP ? JSON.parse(process.env.OPP) : {}) }];
  CONFIG.race.playerSlot = 1;
}
const SOLO = !!process.env.SOLO;
const track = loadSimTrack(TRACK);
const LV = LEVELS[LEVEL];
const P = { ...CONFIG.physics, tractionControl: LV.tc, abs: LV.abs, esc: LV.esc, steerAssist: LV.keySteerAssist };
const player = new CarPhysics(P);
const race = createRace({ track, player, P, raceline: track.raceline, center: track.points, rand });

// 玩家的駕駛（與遊戲相同的難度輔助）
const guide = createGuide(track.raceline, P, {}, track.points);
const driver = MODE === 'idle' ? null : createDriver(guide, P, MODE === 'bot' ? 'bot' : 'person', MODE === 'bot' ? 'self' : LV.brakeAssist ? 'none' : 'color', { reaction: 0.25 });
const bAssist = LV.brakeAssist && MODE === 'person' ? brakeAssist(guide, guide.locator()) : null;
const sAssist =
  MODE === 'bot' ? steerAssist(guide, guide.locator(), P, 1, 0) : LV.steerAssist ? steerAssist(guide, guide.locator(), P, 1, 0.35) : LV.lineKeep ? lineKeepAssist(guide, guide.locator(), P, LV.lineKeep) : null;

const dt = 1 / 120;
const DEG = 180 / Math.PI;
const stats = race.entries.map(() => ({ outs: 0, wasOut: false, spins: 0, spinning: false, maxOver: 0 }));
let ctl = { throttle: 0, brake: 1, steer: 0 };
race.startLights();
if (SOLO) player.reset(1e5, 1e5, 0); // 玩家移出賽道
let step = 0;
const LIMIT = 60 + race.laps * 200;
while (race.time < LIMIT && !race.entries.every((e) => e.finished || (e.isPlayer && (MODE === 'idle' || SOLO)))) {
  if (step % 2 === 0) {
    race.update(2 * dt);
    if (race.state === 'racing' || race.state === 'finished') {
      if (driver && !SOLO) {
        ctl = driver.control(player, 2 * dt);
        if (bAssist) bAssist(ctl, player);
        if (sAssist) sAssist(ctl, player);
        // 真人看得到前車：正前方 25m 內、同一條線上而且比較慢 → 收油煞車，不故意撞上去
        const me = race.entries.find((e) => e.isPlayer);
        for (const o of race.entries) {
          if (o === me) continue;
          const L = track.length;
          const ds = ((((o.progress - me.progress) % L) + L * 1.5) % L) - L / 2;
          if (ds > 0 && ds < 25 && Math.abs(o.lat - me.lat) < 2.4 && o.car.speed < player.speed) {
            ctl = { ...ctl, throttle: 0, brake: ds < 12 ? 1 : 0.5 };
          }
        }
      } else ctl = { throttle: 0, brake: 1, steer: 0 };
    } else ctl = { throttle: 0, brake: 1, steer: 0 };
    const me = race.entries.find((e) => e.isPlayer);
    player.surfaceGrip = me.offTrack ? CONFIG.track.offGrip : 1;
    player.surfaceDrag = me.offTrack ? CONFIG.track.offDrag : 0;
  }
  player.step(dt, ctl);
  race.step(dt);
  race.track();
  if (race.state === 'racing' || race.state === 'finished')
    race.entries.forEach((e, k) => {
      const st = stats[k];
      const over = Math.abs(e.lat) - (e.lat > 0 ? e.wl : e.wr);
      if (over > 1 && !st.wasOut) {
        st.outs++;
        if (process.env.OUTS && !e.isPlayer) {
          const i = e.driver.locate(e.car.x, e.car.z);
          console.log(`  ✗ ${e.name} 出界 s=${e.s.toFixed(0)} 偏${e.lat.toFixed(1)}/${(e.lat > 0 ? e.wl : -e.wr).toFixed(1)} ${(e.car.speed * 3.6).toFixed(0)}/${(e.guide.speed[i] * 3.6).toFixed(0)}km/h 路線偏${e.lane[i].lat.toFixed(1)} 舵${(e.car.steer * DEG).toFixed(1)}° 油${e.ctl.throttle} 煞${e.ctl.brake} β${(e.car.beta * DEG).toFixed(1)}`);
        }
      }
      st.wasOut = over > 1;
      const o = -e.car.beta * (Math.sign(e.car.r) || 1) * DEG;
      st.maxOver = Math.max(st.maxOver, o);
      if (o > 25 && !st.spinning) {
        st.spins++;
        st.spinning = true;
      }
      if (o < 10) st.spinning = false;
    });
  step++;
  if (race.state === 'lights' || race.state === 'grid') continue;
}

if (process.env.HITS)
  race.hits.slice(0, 20).forEach((h) => {
    console.log(`  💥 ${h.time.toFixed(1)}s s=${h.s.toFixed(0)} ${h.back.name} 撞 ${h.front.name}（前車在前 ${h.gap.toFixed(1)}m、側向差 ${h.dLat.toFixed(1)}m）衝量 ${h.impulse.toFixed(0)}`);
  });
const fmt = (x) => (x == null ? '—' : `${Math.floor(x / 60)}:${(x % 60).toFixed(3).padStart(6, '0')}`);
console.log(`【比賽模擬・${TRACK}・${race.laps} 圈】玩家：${MODE}（${LV.name}）｜碰撞 ${race.collisions} 次`);
race.standings().forEach((e, k) => {
  const st = stats[e.id];
  console.log(
    `  P${k + 1} ${e.name.padEnd(3)} ${e.finished ? `完賽 ${fmt(e.finishTime)}` : `未完賽（${e.lap} 圈）`}｜最快圈 ${fmt(e.best)}｜四輪出界 ${st.outs}｜打轉 ${st.spins}｜重生 ${e.respawns}｜甩尾最大 ${st.maxOver.toFixed(1)}°`,
  );
});
