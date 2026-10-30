// 音效量測工具：WAV 讀寫、音量（dBFS）、頻譜重心、高頻比例
import fs from 'node:fs';

export function writeWav(file, samples, sr) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  fs.writeFileSync(file, buf);
}

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const ar = re[i + k + len / 2];
        const ai = im[i + k + len / 2];
        const tr = ar * wr - ai * wi;
        const ti = ar * wi + ai * wr;
        re[i + k + len / 2] = re[i + k] - tr;
        im[i + k + len / 2] = im[i + k] - ti;
        re[i + k] += tr;
        im[i + k] += ti;
      }
    }
  }
}

// 一段聲音的量測：rms（dBFS）、peak、頻譜重心 Hz、2–5 kHz（人耳最刺耳的區段）能量比例
export function measure(x, sr) {
  let s2 = 0;
  let peak = 0;
  for (const v of x) {
    s2 += v * v;
    peak = Math.max(peak, Math.abs(v));
  }
  const rms = Math.sqrt(s2 / x.length);
  const N = 4096;
  const spec = new Float64Array(N / 2);
  let frames = 0;
  for (let o = 0; o + N <= x.length; o += N / 2) {
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = x[o + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
    fft(re, im);
    for (let k = 0; k < N / 2; k++) spec[k] += re[k] * re[k] + im[k] * im[k];
    frames++;
  }
  let tot = 0;
  let cen = 0;
  let harsh = 0;
  for (let k = 1; k < N / 2; k++) {
    const f = (k * sr) / N;
    tot += spec[k];
    cen += spec[k] * f;
    if (f >= 2000 && f <= 5000) harsh += spec[k];
  }
  return {
    rmsDb: 20 * Math.log10(rms + 1e-12),
    peakDb: 20 * Math.log10(peak + 1e-12),
    centroid: tot ? cen / tot : 0,
    harsh: tot ? harsh / tot : 0,
    frames,
  };
}

// 開車測試劇本：（起秒, 迄秒, 油門, 煞車, 說明）
export const DRIVE_SCRIPT = [
  [0, 1.5, 0, 0, '怠速'],
  [1.5, 10.5, 1, 0, '起步全油門'],
  [10.5, 11, 0, 0, '收油'],
  [11, 13.5, 0, 1, '重煞降檔'],
  [13.5, 15.5, 0.4, 0, '半油門過彎'],
  [15.5, 19, 1, 0, '出彎全油門'],
];
export const scriptAt = (t) => DRIVE_SCRIPT.find((r) => t >= r[0] && t < r[1]) || DRIVE_SCRIPT[DRIVE_SCRIPT.length - 1];
export const SCRIPT_LEN = DRIVE_SCRIPT[DRIVE_SCRIPT.length - 1][1];
