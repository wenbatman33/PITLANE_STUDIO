// 瀏覽器實測：用真的 Chrome 打開遊戲頁面，由「照教學玩的真人」送出真實鍵盤事件跑完整圈
// 用法：node scripts/browser-human.mjs [rookie|standard] [圈數] [網址]
//   需要 dev server（npm run dev，預設 http://localhost:5188/）；Chrome 無畫面執行，結束一定關閉
//   操作：W／空白鍵／A／D 真實按鍵；反應 0.25 秒；方向鍵只會按住／放開；煞車只看地上路線顏色
//   量測：遊戲自己的計時器（圈速、該圈是否有效）＋ 嚴格出界（車子中心超出柏油邊緣 1m＝四輪出界）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { CONFIG } from '../src/config.js';
import { createDriver } from '../src/autopilot.js';

const LEVEL = process.argv[2] || 'standard';
const LAPS = Number(process.argv[3] || 2);
const URL_ = process.argv[4] || 'http://localhost:5188/';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PERSON = { reaction: 0.25, lookGain: 0.4, steerOn: (1.8 * Math.PI) / 180, minHold: 0.1, coastYellow: false };
const TIME_LIMIT = (LAPS + 1) * 150 * 1000;

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pitlane-chrome-'));
let browser = null;
const cleanup = async () => {
  try {
    await browser?.close();
  } catch {}
  browser = null;
  fs.rmSync(userDataDir, { recursive: true, force: true });
};
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => cleanup().then(() => process.exit(1)));
process.on('unhandledRejection', (e) => {
  console.error(e);
  cleanup().then(() => process.exit(1));
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (x) => `${Math.floor(x / 60)}:${(x % 60).toFixed(3).padStart(6, '0')}`;

try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    userDataDir,
    protocolTimeout: 60000,
    args: ['--no-first-run', '--no-default-browser-check', '--mute-audio', '--window-size=1280,780', '--use-angle=metal', '--enable-gpu'],
    defaultViewport: { width: 1280, height: 780 },
  });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((level) => {
    localStorage.setItem('pitlane.muted', 'true');
    localStorage.setItem('pitlane.level', JSON.stringify(level));
  }, LEVEL);
  await page.goto(URL_, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__pitlane?.guide && window.__pitlane?.track, { timeout: 60000 });
  await sleep(1500);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.body.className.includes('mode-drive'), { timeout: 20000 });
  await sleep(500);
  await page.keyboard.press('KeyQ'); // 關掉教學卡（任意鍵）

  // 遊戲畫面上的建議路線（與玩家看到的同一份）
  const g = await page.evaluate(() => {
    const G = window.__pitlane.guide;
    return { line: G.line, speed: Array.from(G.speed), zone: G.zone, n: G.n };
  });
  const guide = {
    ...g,
    locator() {
      let hint = 0;
      return (x, z) => {
        let best = hint;
        let bd = Infinity;
        const scan = (a, b) => {
          for (let k = a; k <= b; k++) {
            const i = ((k % g.n) + g.n) % g.n;
            const d = (x - g.line[i].x) ** 2 + (z - g.line[i].z) ** 2;
            if (d < bd) {
              bd = d;
              best = i;
            }
          }
        };
        scan(hint - 30, hint + 30);
        if (bd > 900) scan(0, g.n - 1);
        return (hint = best);
      };
    },
  };
  const driver = createDriver(guide, CONFIG.physics, 'person', LEVEL === 'rookie' ? 'none' : 'color', PERSON);

  const KEYS = { throttle: 'KeyW', brake: 'Space', left: 'KeyA', right: 'KeyD' };
  const down = new Set();
  const setKey = async (code, on) => {
    if (on && !down.has(code)) {
      down.add(code);
      await page.keyboard.down(code);
    } else if (!on && down.has(code)) {
      down.delete(code);
      await page.keyboard.up(code);
    }
  };

  const t0 = Date.now();
  let last = t0;
  let frames0 = null;
  let keyChanges = 0;
  let wasOut = false;
  let lapsSeen = 0;
  let outs = [];
  const laps = [];
  let maxOver = 0;
  let prevKeys = '';
  let loops = 0;
  while (Date.now() - t0 < TIME_LIMIT && laps.length < LAPS) {
    const s = await page.evaluate(() => {
      const { phys, track, timer } = window.__pitlane;
      const pr = track.project(phys.x, phys.z);
      return {
        x: phys.x,
        z: phys.z,
        yaw: phys.yaw,
        speed: phys.speed,
        vx: phys.vx,
        vz: phys.vz,
        r: phys.r,
        beta: phys.beta,
        lat: pr.lateral,
        edge: pr.lateral > 0 ? pr.wl : pr.wr,
        s: pr.s,
        lap: timer.lap,
        last: timer.last,
        frames: window.__frames || 0,
      };
    });
    const now = Date.now();
    const dt = Math.max(0.005, (now - last) / 1000);
    last = now;
    loops++;
    const c = driver.control(s, dt);
    await setKey(KEYS.throttle, c.throttle > 0.5);
    await setKey(KEYS.brake, c.brake > 0.5);
    await setKey(KEYS.left, c.steer > 0);
    await setKey(KEYS.right, c.steer < 0);
    const ks = `${c.throttle}${c.brake}${c.steer}`;
    if (ks !== prevKeys) keyChanges++;
    prevKeys = ks;
    // 嚴格出界（與 scripts/human-test.mjs 相同）
    const over = Math.abs(s.lat) - s.edge;
    if (s.lap >= 1 && over > 1 && !wasOut) outs.push(Math.round(s.s));
    wasOut = over > 1;
    if (s.lap >= 1) maxOver = Math.max(maxOver, (-s.beta * (Math.sign(s.r) || 1) * 180) / Math.PI);
    if (s.lap > lapsSeen) {
      if (lapsSeen >= 1 && s.last) {
        laps.push({ time: s.last.time, valid: s.last.valid, outs });
        console.log(`  第 ${laps.length} 圈 ${fmt(s.last.time)}｜${s.last.valid ? '有效' : '該圈不計'}｜四輪出界 ${outs.length} 次${outs.length ? `（${outs.join(', ')} m）` : ''}`);
      }
      outs = [];
      lapsSeen = s.lap;
    }
    await sleep(20);
  }
  const fps = await page.evaluate(
    () =>
      new Promise((res) => {
        let n = 0;
        const t = performance.now();
        const f = () => (++n, performance.now() - t < 1000 ? requestAnimationFrame(f) : res(n));
        requestAnimationFrame(f);
      }),
  );
  const secs = (Date.now() - t0) / 1000;
  console.log(
    `【瀏覽器實測・${LEVEL}】完成 ${laps.length}/${LAPS} 圈｜有效圈 ${laps.filter((l) => l.valid).length}｜四輪出界共 ${laps.reduce((a, l) => a + l.outs.length, 0)} 次｜甩尾最大 ${maxOver.toFixed(1)}°｜按鍵變化 ${(keyChanges / secs).toFixed(1)} 次/秒｜畫面 ${fps} fps｜判斷 ${(loops / secs).toFixed(0)} 次/秒`,
  );
} finally {
  await cleanup();
}
