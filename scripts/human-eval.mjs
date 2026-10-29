// 模擬玩家群體測試：產生多位條件不同的模擬玩家各跑一圈，統計完賽率
// 用法：node scripts/human-eval.mjs [rookie|standard] [人數] [參數覆寫 JSON]
// 每位玩家的反應時間、判斷頻率、輕點力道、看的距離、畫面更新率都不同（固定亂數種子，結果可重現）
import { execFileSync } from 'node:child_process';

const MODE = process.argv[2] || 'standard';
const COUNT = Number(process.argv[3] || 12);
const BASE = process.argv[4] ? JSON.parse(process.argv[4]) : {};

let seed = Number(process.env.SEED || 20261029);
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a, b) => a + (b - a) * rand();

const results = [];
for (let i = 0; i < COUNT; i++) {
  const driver = {
    reaction: +pick(0.15, 0.3).toFixed(2),
    period: +pick(0.1, 0.25).toFixed(2),
    minTap: +pick(0.05, 0.1).toFixed(2),
    pwmGain: +pick(1, 2.5).toFixed(2),
    lookGain: +pick(0.3, 0.6).toFixed(2),
  };
  const hz = rand() < 0.5 ? 30 : 60;
  const cfg = { ...BASE, driver: { ...(BASE.driver || {}), ...driver } };
  const out = execFileSync('node', ['scripts/lap-test.mjs', MODE, JSON.stringify(cfg)], {
    env: { ...process.env, HZ: String(hz) },
    encoding: 'utf8',
  });
  const lap = out.match(/第 2 圈 ([0-9:.]+)/)?.[1] || null;
  const allOut = Number(out.match(/四輪出界 (\d+) 次/)?.[1] ?? 99);
  const over = Number(out.match(/壓出白線 (\d+) 次/)?.[1] ?? 99);
  results.push({ ...driver, hz, lap, allOut, over });
  process.stdout.write(`  玩家${String(i + 1).padStart(2)} 反應${driver.reaction}s 判斷每${driver.period}s 力道${driver.pwmGain} ${hz}Hz → ${lap ?? '未完賽'} 四輪出界${allOut}\n`);
}
const clean = results.filter((r) => r.lap && r.allOut === 0).length;
const ok1 = results.filter((r) => r.lap && r.allOut <= 1).length;
const avg = results.reduce((a, r) => a + r.allOut, 0) / results.length;
console.log(`【${MODE}】0 次出界完賽 ${clean}/${COUNT}｜出界 ≤1 次 ${ok1}/${COUNT}｜平均四輪出界 ${avg.toFixed(1)} 次`);
