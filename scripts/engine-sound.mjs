// 引擎聲比較：用真 Chrome 的 OfflineAudioContext 把遊戲音效（完整音效鏈）離線算成 WAV，並量音量與刺耳程度
// 用法：node scripts/engine-sound.mjs [舊版 audio.js 路徑]
//   需要 dev server（npm run dev，預設 http://localhost:5188/，可用 URL= 指定）
//   開車劇本見 scripts/lib/audio-metrics.mjs（怠速 → 全油門升檔 → 收油 → 重煞降檔 → 半油門 → 全油門）
//   轉速與油門由遊戲物理（src/physics.js）實際跑出來；輸出 test-output/engine-new.wav（有給舊版時另出 engine-old.wav）
//   負載保護：整台電腦 1 分鐘平均負載超過 LOAD_LIMIT（預設 20）就停止；結束一定關閉 Chrome
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { CONFIG } from '../src/config.js';
import { CarPhysics } from '../src/physics.js';
import { writeWav, measure, DRIVE_SCRIPT, scriptAt, SCRIPT_LEN } from './lib/audio-metrics.mjs';

const OLD = process.argv[2];
const URL_ = process.env.URL || 'http://localhost:5188/';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LOAD_LIMIT = Number(process.env.LOAD_LIMIT || 20);
const SR = 44100;
const FPS = 60;
const OUT_DIR = path.resolve('test-output');

// 遊戲物理跑出每一格畫面的轉速與油門
const phys = new CarPhysics(CONFIG.physics);
phys.reset(0, 0, 0);
const frames = [];
const STEP = 1 / 120;
for (let t = 0, f = 0; f < SCRIPT_LEN * FPS; f++) {
  while (t < f / FPS) {
    const r = scriptAt(t);
    phys.step(STEP, { throttle: r[2], brake: r[3] });
    t += STEP;
  }
  frames.push([Math.round(phys.rpm), phys.throttle]);
}

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
const loadGuard = setInterval(() => {
  const l = os.loadavg()[0];
  if (l > LOAD_LIMIT) {
    console.error(`系統負載 ${l.toFixed(1)} 超過 ${LOAD_LIMIT}，停止測試`);
    clearInterval(loadGuard);
    cleanup().then(() => process.exit(3));
  }
}, 1000);
process.on('unhandledRejection', (e) => {
  console.error(e);
  cleanup().then(() => process.exit(1));
});

try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    userDataDir,
    protocolTimeout: 120000,
    args: ['--no-first-run', '--no-default-browser-check', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('頁面錯誤：', e.message));
  // 輕量的同源頁面（不載入整個遊戲），只用來 import 音效模組
  await page.goto(new URL('package.json', URL_).href, { waitUntil: 'load', timeout: 60000 });

  const versions = [['new', null]];
  if (OLD) {
    // 舊版原始碼：把相對 import 換成 dev server 的完整網址，再用 blob 載入
    const src = fs.readFileSync(OLD, 'utf8').replace(/from '\.\/([\w.]+)'/g, (m, f) => `from '${new URL(`src/${f}`, URL_).href}'`);
    versions.push(['old', src]);
  }
  for (const [name, src] of versions) {
    const data = await page.evaluate(
      async (src, frames, SR, FPS, LEN) => {
        const url = src ? URL.createObjectURL(new Blob([src], { type: 'text/javascript' })) : '/src/audio.js';
        const { EngineAudio } = await import(url);
        const ctx = new OfflineAudioContext(1, Math.round(SR * LEN), SR);
        const RealAC = window.AudioContext;
        window.AudioContext = function () {
          return ctx;
        };
        const audio = new EngineAudio();
        audio.unlock();
        window.AudioContext = RealAC;
        await audio.ready;
        audio.setRunning(true);
        // 每一格畫面暫停一次，照遊戲的方式呼叫 update()
        frames.forEach(([rpm, thr], f) => {
          if (f === 0) return;
          ctx.suspend(f / FPS).then(() => {
            audio.update(1 / FPS, rpm, thr, 0, null);
            ctx.resume();
          });
        });
        audio.update(1 / FPS, frames[0][0], frames[0][1], 0, null);
        const buf = await ctx.startRendering();
        return Array.from(buf.getChannelData(0));
      },
      src,
      frames,
      SR,
      FPS,
      SCRIPT_LEN,
    );
    const x = Float32Array.from(data);
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const file = path.join(OUT_DIR, `engine-${name}.wav`);
    writeWav(file, x, SR);
    console.log(`\n【${name === 'new' ? '新版' : '舊版'}】${file}`);
    for (const r of DRIVE_SCRIPT) {
      const m = measure(x.subarray(Math.round(r[0] * SR), Math.round(r[1] * SR)), SR);
      console.log(
        `  ${r[4].padEnd(6, '　')} 音量 ${m.rmsDb.toFixed(1)} dBFS｜峰值 ${m.peakDb.toFixed(1)}｜頻譜重心 ${m.centroid.toFixed(0)} Hz｜2–5 kHz 刺耳區 ${(m.harsh * 100).toFixed(1)}%`,
      );
    }
  }
} finally {
  clearInterval(loadGuard);
  await cleanup();
}
