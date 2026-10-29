// Node 測試用賽道：與 src/track.js 相同的取樣、寬度平滑、投影、發車格（不建網格、不做座標轉換）
import fs from 'node:fs';
import * as THREE from 'three';
import { CONFIG } from '../../src/config.js';

const SPACING = 2;

const readCsv = (f) =>
  fs
    .readFileSync(new URL(`../../assets/source/tracks/${f}`, import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => l.split(',').map(Number));

export function loadSimTrack(name = 'Monza') {
  const C = CONFIG.track;
  const raw = readCsv(`${name}.csv`);
  const curve = new THREE.CatmullRomCurve3(raw.map(([x, y]) => new THREE.Vector3(-x, 0, y)), true, 'centripetal');
  curve.arcLengthDivisions = raw.length * 8;
  let length = curve.getLength();
  const N = Math.round(length / SPACING);
  const P = curve.getSpacedPoints(N).slice(0, N);
  const n0 = raw.length;
  const widthAt = (t, k) => {
    const f = t * n0;
    const i0 = Math.floor(f) % n0;
    return raw[i0][k] + (raw[(i0 + 1) % n0][k] - raw[i0][k]) * (f - Math.floor(f));
  };
  const smooth = (arr, r) =>
    arr.map((_, i) => {
      let s = 0;
      for (let k = -r; k <= r; k++) s += arr[(i + k + N) % N];
      return s / (2 * r + 1);
    });
  const WL = smooth(P.map((_, i) => widthAt(i / N, 3)), 6);
  const WR = smooth(P.map((_, i) => widthAt(i / N, 2)), 6);
  const T = P.map((_, i) => P[(i + 1) % N].clone().sub(P[(i - 1 + N) % N]).normalize());
  const Lft = T.map((t) => new THREE.Vector3(t.z, 0, -t.x));
  const S = new Float64Array(N);
  for (let i = 1; i < N; i++) S[i] = S[i - 1] + P[i].distanceTo(P[i - 1]);
  length = S[N - 1] + P[N - 1].distanceTo(P[0]);
  const iGrid = (N - Math.round(C.gridOffset / SPACING)) % N;

  const rl = readCsv(`${name}_raceline.csv`);
  const rlCurve = new THREE.CatmullRomCurve3(rl.map(([x, y]) => new THREE.Vector3(-x, 0, y)), true, 'centripetal');
  rlCurve.arcLengthDivisions = rl.length * 8;
  const raceline = rlCurve
    .getSpacedPoints(Math.round(rlCurve.getLength() / SPACING))
    .slice(0, -1)
    .map((p) => ({ x: p.x, z: p.z }));

  function projector() {
    let hint = iGrid;
    const out = { i: 0, s: 0, lateral: 0, wl: 0, wr: 0 };
    return (x, z) => {
      let best = -1;
      let bestD = Infinity;
      const scan = (from, to) => {
        for (let k = from; k <= to; k++) {
          const i = ((k % N) + N) % N;
          const d = (x - P[i].x) ** 2 + (z - P[i].z) ** 2;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
      };
      scan(hint - 40, hint + 40);
      if (bestD > 1600) scan(0, N - 1);
      hint = best;
      const dx = x - P[best].x;
      const dz = z - P[best].z;
      out.i = best;
      out.s = (S[best] + dx * T[best].x + dz * T[best].z + length) % length;
      out.lateral = dx * Lft[best].x + dz * Lft[best].z;
      out.wl = WL[best] * C.widthScale;
      out.wr = WR[best] * C.widthScale;
      return out;
    };
  }

  return {
    name,
    length,
    count: N,
    points: P.map((p) => ({ x: p.x, z: p.z })),
    raceline,
    projector,
    gridPose(k) {
      const i = (iGrid - Math.round((k * 8) / SPACING) + N * 2) % N;
      const lat = C.gridLateral * (k % 2 === 0 ? 1 : -1);
      const p = P[i].clone().addScaledVector(Lft[i], lat);
      return { x: p.x, z: p.z, yaw: Math.atan2(T[i].x, T[i].z) };
    },
  };
}
