// 真實賽道：讀取中心線＋左右寬度資料，生成路面、白邊線、路緣石、起跑線與發車格
// 也負責把車子位置投影到賽道上（圈速、分段、出界判定都靠它）
import * as THREE from 'three';
import monzaCsv from '../assets/source/tracks/Monza.csv?raw';
import monzaRaceline from '../assets/source/tracks/Monza_raceline.csv?raw';
import suzukaCsv from '../assets/source/tracks/Suzuka.csv?raw';
import suzukaRaceline from '../assets/source/tracks/Suzuka_raceline.csv?raw';
import budapestCsv from '../assets/source/tracks/Budapest.csv?raw';
import budapestRaceline from '../assets/source/tracks/Budapest_raceline.csv?raw';
import catalunyaCsv from '../assets/source/tracks/Catalunya.csv?raw';
import catalunyaRaceline from '../assets/source/tracks/Catalunya_raceline.csv?raw';
import silverstoneCsv from '../assets/source/tracks/Silverstone.csv?raw';
import silverstoneRaceline from '../assets/source/tracks/Silverstone_raceline.csv?raw';
import zandvoortCsv from '../assets/source/tracks/Zandvoort.csv?raw';
import zandvoortRaceline from '../assets/source/tracks/Zandvoort_raceline.csv?raw';
import { CONFIG } from './config.js';

// 賽道資料：TUMFTM racetrack-database（中心線＋左右寬度、最小曲率賽車線）
// brakeZones：需要重煞的彎道入口距離（公尺），彎前放 150 / 100 / 50 m 煞車看板；沒給就依建議路線的重煞區自動擺放
// file：assets/source/tracks/ 下的檔名（測試腳本用）
export const TRACKS = {
  monza: { name: 'MONZA', label: '蒙扎', fullName: 'Autodromo Nazionale Monza', file: 'Monza', csv: monzaCsv, raceline: monzaRaceline, brakeZones: [920, 2135, 2510, 2865, 3945, 5135] },
  suzuka: { name: 'SUZUKA', label: '鈴鹿', fullName: 'Suzuka International Racing Course', file: 'Suzuka', csv: suzukaCsv, raceline: suzukaRaceline },
  budapest: { name: 'HUNGARORING', label: '匈牙利', fullName: 'Hungaroring', file: 'Budapest', csv: budapestCsv, raceline: budapestRaceline },
  catalunya: { name: 'CATALUNYA', label: '巴塞隆納', fullName: 'Circuit de Barcelona-Catalunya', file: 'Catalunya', csv: catalunyaCsv, raceline: catalunyaRaceline },
  silverstone: { name: 'SILVERSTONE', label: '銀石', fullName: 'Silverstone Circuit', file: 'Silverstone', csv: silverstoneCsv, raceline: silverstoneRaceline },
  zandvoort: { name: 'ZANDVOORT', label: '贊德沃特', fullName: 'Circuit Zandvoort', file: 'Zandvoort', csv: zandvoortCsv, raceline: zandvoortRaceline },
};

const SPACING = 2; // 重新取樣間距（公尺）
const Y = { asphalt: 0.006, line: 0.01, curb: 0.008, start: 0.012 };

function parseCsv(text) {
  return text
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => l.split(',').map(Number));
}

function canvasTexture(w, h, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// 柏油顆粒
const asphaltTexture = () =>
  canvasTexture(256, 256, (g, w, h) => {
    const img = g.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const v = 232 + Math.random() * 23;
      img.data.set([v, v, v, 255], i * 4);
    }
    g.putImageData(img, 0, 0);
  });

// 紅白路緣石：u 方向每單位一組紅白
const curbTexture = () =>
  canvasTexture(64, 8, (g, w, h) => {
    g.fillStyle = '#d71920';
    g.fillRect(0, 0, w / 2, h);
    g.fillStyle = '#f4f4f4';
    g.fillRect(w / 2, 0, w / 2, h);
  });

// 煞車距離看板：白底黑字紅框
const boardTexture = (text) =>
  canvasTexture(
    256,
    192,
    (g, w, h) => {
      g.fillStyle = '#f7f7f5';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#d71920';
      g.lineWidth = 14;
      g.strokeRect(7, 7, w - 14, h - 14);
      g.fillStyle = '#111';
      g.font = '700 118px "Chakra Petch", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, w / 2, h / 2 + 6);
    },
    false,
  );

const checkerTexture = (cols, rows) =>
  canvasTexture(
    cols * 16,
    rows * 16,
    (g) => {
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < cols; x++) {
          g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
          g.fillRect(x * 16, y * 16, 16, 16);
        }
    },
    false,
  );

// 把一串「左緣點、右緣點」組成連續帶狀網格
function ribbon(lefts, rights, uvs, closed) {
  const n = lefts.length;
  const pos = new Float32Array(n * 2 * 3);
  const uv = new Float32Array(n * 2 * 2);
  for (let i = 0; i < n; i++) {
    pos.set(lefts[i], i * 6);
    pos.set(rights[i], i * 6 + 3);
    uv.set([uvs[i][0], uvs[i][1], uvs[i][2], uvs[i][1]], i * 4);
  }
  const idx = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = i * 2;
    const b = ((i + 1) % n) * 2;
    // 從上方看要是逆時針（法線朝上）
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export function createTrack(scene, id = 'monza') {
  const def = TRACKS[id] || TRACKS.monza;
  let brakeZones = def.brakeZones || [];
  const raw = parseCsv(def.csv);
  const group = new THREE.Group();
  group.name = 'track';
  scene.add(group);

  // ---------- 1) 座標轉換：資料 (x 東, y 北) → 世界 (X = -x, Z = y)，起跑方向轉成 +Z ----------
  const pts = raw.map(([x, y]) => new THREE.Vector3(-x, 0, y));
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  // 弧長取樣要夠密（預設 200 段對 5km 賽道太粗，間距會不均、全長會算短）
  curve.arcLengthDivisions = raw.length * 8;
  let length = curve.getLength();
  const N = Math.round(length / SPACING);
  const P = curve.getSpacedPoints(N).slice(0, N);
  const n0 = raw.length;
  const widthAt = (t, k) => {
    const f = t * n0;
    const i0 = Math.floor(f) % n0;
    const i1 = (i0 + 1) % n0;
    return raw[i0][k] + (raw[i1][k] - raw[i0][k]) * (f - Math.floor(f));
  };
  let WL = P.map((_, i) => widthAt(i / N, 3));
  let WR = P.map((_, i) => widthAt(i / N, 2));
  // 寬度平滑，避免邊緣鋸齒
  const smooth = (arr, r) => arr.map((_, i) => {
    let s = 0;
    for (let k = -r; k <= r; k++) s += arr[(i + k + N) % N];
    return s / (2 * r + 1);
  });
  WL = smooth(WL, 6);
  WR = smooth(WR, 6);

  // 切線、左法線
  const T = P.map((_, i) => P[(i + 1) % N].clone().sub(P[(i - 1 + N) % N]).normalize());
  const Lft = T.map((t) => new THREE.Vector3(t.z, 0, -t.x));

  // 讓「第一格發車位」落在原點、朝 +Z：起跑線在前方 gridOffset 公尺
  const C = CONFIG.track;
  const iGrid = (N - Math.round(C.gridOffset / SPACING)) % N;
  const yaw0 = Math.atan2(T[iGrid].x, T[iGrid].z);
  const rot = new THREE.Matrix4().makeRotationY(-yaw0);
  const gridPos = P[iGrid].clone().addScaledVector(Lft[iGrid], C.gridLateral);
  for (const arr of [P]) arr.forEach((p) => p.sub(gridPos).applyMatrix4(rot));
  // 最佳賽車路線（示範駕駛用），套用與中心線相同的座標轉換
  let raceline = null;
  if (def.raceline) {
    const rlRaw = parseCsv(def.raceline);
    const rc = new THREE.CatmullRomCurve3(rlRaw.map(([x, y]) => new THREE.Vector3(-x, 0, y)), true, 'centripetal');
    rc.arcLengthDivisions = rlRaw.length * 8;
    raceline = rc
      .getSpacedPoints(Math.round(rc.getLength() / SPACING))
      .slice(0, -1)
      .map((p) => {
        p.sub(gridPos).applyMatrix4(rot);
        return { x: p.x, z: p.z };
      });
  }
  T.forEach((t) => t.applyMatrix4(rot).normalize());
  Lft.forEach((l) => l.applyMatrix4(rot).normalize());

  // 累積距離與曲率
  const S = new Float32Array(N);
  for (let i = 1; i < N; i++) S[i] = S[i - 1] + P[i].distanceTo(P[i - 1]);
  // 全長＝取樣點實際累加的距離（與 S 一致，進度才會剛好在起跑線歸零）
  length = S[N - 1] + P[N - 1].distanceTo(P[0]);
  const K = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = T[(i - 3 + N) % N];
    const b = T[(i + 3) % N];
    const ang = Math.atan2(a.x * b.z - a.z * b.x, a.x * b.x + a.z * b.z);
    K[i] = ang / (6 * SPACING);
  }
  const Ks = smooth(Array.from(K), 5);

  const materials = {
    asphalt: new THREE.MeshStandardMaterial({ color: C.asphaltColor, map: asphaltTexture(), roughness: 0.95, metalness: 0 }),
    line: new THREE.MeshStandardMaterial({ color: '#f6f6f4', roughness: 0.6 }),
    curb: new THREE.MeshStandardMaterial({ map: curbTexture(), roughness: 0.6 }),
    start: new THREE.MeshStandardMaterial({ map: checkerTexture(24, 2), roughness: 0.6 }),
    board: Object.fromEntries(['150', '100', '50'].map((t) => [t, new THREE.MeshStandardMaterial({ map: boardTexture(t), roughness: 0.6 })])),
    boardBack: new THREE.MeshStandardMaterial({ color: '#e9eaec', roughness: 0.7 }),
    post: new THREE.MeshStandardMaterial({ color: '#8a8f97', roughness: 0.5, metalness: 0.4 }),
  };
  for (const m of [materials.asphalt, materials.line, materials.curb, materials.start]) {
    m.polygonOffset = true;
    m.polygonOffsetFactor = -1;
    m.polygonOffsetUnits = -1;
  }

  // 哪些取樣點有路緣石（build 時依曲率決定，給路緣石震動／聲音用）
  const curbMark = new Uint8Array(N);

  // ---------- 2) 生成網格（寬度倍率改變時可重建） ----------
  function build() {
    group.clear();
    const ws = C.widthScale;
    const edgeL = (i, extra = 0, y = Y.asphalt) => {
      const v = P[i].clone().addScaledVector(Lft[i], WL[i] * ws + extra);
      v.y = y;
      return v.toArray();
    };
    const edgeR = (i, extra = 0, y = Y.asphalt) => {
      const v = P[i].clone().addScaledVector(Lft[i], -(WR[i] * ws + extra));
      v.y = y;
      return v.toArray();
    };
    const all = [...Array(N).keys()];

    // 路面（UV 以公尺 / 6 為單位，讓顆粒貼圖密度一致）
    const asphalt = new THREE.Mesh(
      ribbon(
        all.map((i) => edgeL(i)),
        all.map((i) => edgeR(i)),
        all.map((i) => [0, S[i] / 6, ((WL[i] + WR[i]) * ws) / 6]),
        true,
      ),
      materials.asphalt,
    );
    asphalt.receiveShadow = true;
    group.add(asphalt);

    // 白色邊線（在路面邊緣往內）
    const lw = C.edgeLineWidth;
    for (const side of [1, -1]) {
      const outer = all.map((i) => (side > 0 ? edgeL(i, 0, Y.line) : edgeR(i, 0, Y.line)));
      const inner = all.map((i) => (side > 0 ? edgeL(i, -lw, Y.line) : edgeR(i, -lw, Y.line)));
      const geo = side > 0 ? ribbon(outer, inner, all.map(() => [0, 0, 1]), true) : ribbon(inner, outer, all.map(() => [0, 0, 1]), true);
      const m = new THREE.Mesh(geo, materials.line);
      m.receiveShadow = true;
      group.add(m);
    }

    // 路緣石：曲率大的地方，兩側往外延伸
    const kMin = 1 / C.curbRadius;
    const ext = Math.round(C.curbExtend / SPACING);
    const mark = curbMark;
    mark.fill(0);
    for (let i = 0; i < N; i++) if (Math.abs(Ks[i]) > kMin) for (let k = -ext; k <= ext; k++) mark[(i + k + N) % N] = 1;
    const runs = [];
    for (let i = 0; i < N; i++) {
      if (mark[i] && !mark[(i - 1 + N) % N]) {
        const run = [];
        for (let k = i; mark[k % N] && run.length < N; k++) run.push(k % N);
        runs.push(run);
      }
    }
    const cw = C.curbWidth;
    const stripe = C.curbStripe;
    for (const run of runs) {
      for (const side of [1, -1]) {
        const a = run.map((i) => (side > 0 ? edgeL(i, 0, Y.curb) : edgeR(i, 0, Y.curb)));
        const b = run.map((i) => (side > 0 ? edgeL(i, cw, Y.curb) : edgeR(i, cw, Y.curb)));
        const uvs = run.map((i) => [0, S[i] / stripe, 1]);
        const geo = side > 0 ? ribbon(b, a, uvs, false) : ribbon(a, b, uvs, false);
        // ribbon 的 u 是橫向、v 是縱向；路緣石要紅白沿縱向交替，所以把 UV 對調
        const uv = geo.attributes.uv;
        for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getY(k), uv.getX(k));
        const m = new THREE.Mesh(geo, materials.curb);
        m.receiveShadow = true;
        group.add(m);
      }
    }

    // 起跑線（方格旗帶）
    const i0 = 0;
    const width0 = (WL[i0] + WR[i0]) * ws;
    const start = new THREE.Mesh(new THREE.PlaneGeometry(width0, 1.2), materials.start);
    start.rotation.x = -Math.PI / 2;
    start.rotation.z = Math.atan2(T[i0].x, T[i0].z);
    const mid = P[i0].clone().addScaledVector(Lft[i0], ((WL[i0] - WR[i0]) * ws) / 2);
    start.position.set(mid.x, Y.start, mid.z);
    start.receiveShadow = true;
    group.add(start);

    // 發車格：左右交錯的白色框線
    const boxGeo = new THREE.PlaneGeometry(2.6, 0.22);
    const sideGeo = new THREE.PlaneGeometry(0.22, 2.2);
    for (let k = 0; k < 10; k++) {
      const s = length - C.gridOffset - k * 8 + 3.2;
      const i = Math.round(((s % length) + length) % length / SPACING) % N;
      const lat = C.gridLateral * (k % 2 === 0 ? 1 : -1);
      const yaw = Math.atan2(T[i].x, T[i].z);
      const base = P[i].clone().addScaledVector(Lft[i], lat);
      const bar = new THREE.Mesh(boxGeo, materials.line);
      bar.rotation.set(-Math.PI / 2, 0, yaw);
      bar.position.set(base.x, Y.start, base.z);
      group.add(bar);
      for (const sx of [1, -1]) {
        const tick = new THREE.Mesh(sideGeo, materials.line);
        tick.rotation.set(-Math.PI / 2, 0, yaw);
        const p = base.clone().addScaledVector(Lft[i], sx * 1.2).addScaledVector(T[i], -1.0);
        tick.position.set(p.x, Y.start, p.z);
        group.add(tick);
      }
    }

    // 煞車距離看板：立在彎道外側、面向來車
    const boardGeo = new THREE.BoxGeometry(1.5, 1.1, 0.08);
    const postGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.4, 8);
    for (const entry of brakeZones) {
      const ie = Math.round(entry / SPACING) % N;
      const side = Ks[(ie + 5) % N] < 0 ? -1 : 1; // 左彎（曲率為負）的外側在右邊
      for (const [dist, label] of [[150, '150'], [100, '100'], [50, '50']]) {
        const i = (ie - Math.round(dist / SPACING) + N) % N;
        const lat = side > 0 ? WL[i] * ws + C.curbWidth + 2.5 : -(WR[i] * ws + C.curbWidth + 2.5);
        const p = P[i].clone().addScaledVector(Lft[i], lat);
        const yaw = Math.atan2(-T[i].x, -T[i].z);
        const mats = [materials.boardBack, materials.boardBack, materials.boardBack, materials.boardBack, materials.board[label], materials.boardBack];
        const board = new THREE.Mesh(boardGeo, mats);
        board.position.set(p.x, 0.95, p.z);
        board.rotation.y = yaw;
        board.castShadow = true;
        group.add(board);
        const post = new THREE.Mesh(postGeo, materials.post);
        post.position.set(p.x, 0.2, p.z);
        group.add(post);
      }
    }
  }
  build();

  // ---------- 3) 投影：世界座標 → 賽道進度 ----------
  // projector()：每台車各自一份（各自記住上次位置，搜尋只看附近）
  function projector() {
    let hint = 0;
    const out = { i: 0, s: 0, lateral: 0, wl: 0, wr: 0 };
    const fn = (x, z) => {
      let best = -1;
      let bestD = Infinity;
      const scan = (from, to) => {
        for (let k = from; k <= to; k++) {
          const i = ((k % N) + N) % N;
          const dx = x - P[i].x;
          const dz = z - P[i].z;
          const d = dx * dx + dz * dz;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
    };
    scan(hint - 40, hint + 40);
    if (bestD > 40 * 40) scan(0, N - 1);
    hint = best;
    const dx = x - P[best].x;
    const dz = z - P[best].z;
    const along = dx * T[best].x + dz * T[best].z;
    out.i = best;
    out.s = (S[best] + along + length) % length;
    out.lateral = dx * Lft[best].x + dz * Lft[best].z;
    out.wl = WL[best] * C.widthScale;
    out.wr = WR[best] * C.widthScale;
    return out;
    };
    fn.reset = () => (hint = 0);
    return fn;
  }
  const project = projector();

  // 小地圖用的路徑（俯視、北朝上：畫面右 = -X、畫面上 = +Z）
  const path2d = P.filter((_, i) => i % 3 === 0).map((p) => [-p.x, -p.z]);

  function setVisible(v) {
    group.visible = v;
  }

  return {
    id: TRACKS[id] ? id : 'monza',
    def,
    group,
    length,
    count: N,
    points: P,
    tangents: T,
    project,
    rebuild: build,
    raceline,
    materials,
    setVisible,
    path2d,
    projector,
    resetHint: () => project.reset(),
    // 輪子有沒有壓在路緣石上（pr：project() 的結果）；輪距一半約 0.8m
    curbContact(pr) {
      if (!curbMark[pr.i]) return 0;
      const half = 0.8;
      const cw = C.curbWidth;
      const l = pr.lateral;
      const onL = l + half > pr.wl - 0.1 && l + half < pr.wl + cw + 0.3;
      const onR = -l + half > pr.wr - 0.1 && -l + half < pr.wr + cw + 0.3;
      return onL || onR ? 1 : 0;
    },
    // 第 k 格發車位（0 = 竿位，左右交錯、每格往後 8m）：車模型原點的位置與朝向
    gridPose(k) {
      const i = (iGrid - Math.round((k * 8) / SPACING) + N * 2) % N;
      const lat = C.gridLateral * (k % 2 === 0 ? 1 : -1);
      const p = P[i].clone().addScaledVector(Lft[i], lat);
      return { x: p.x, z: p.z, yaw: Math.atan2(T[i].x, T[i].z) };
    },
    get brakeZones() {
      return brakeZones;
    },
    // 設定煞車看板位置（彎道入口距離，公尺）並重建
    setBrakeZones(list) {
      brakeZones = list;
      build();
    },
    // 第 k 個彎道前的位置（DEV 傳送用）
    poseAt(s) {
      const i = Math.round((((s % length) + length) % length) / SPACING) % N;
      return { x: P[i].x, z: P[i].z, yaw: Math.atan2(T[i].x, T[i].z) };
    },
    curvature: Ks,
  };
}
