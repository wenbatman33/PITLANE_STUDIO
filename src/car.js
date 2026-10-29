// 程序化 F1 賽車模型：車頭朝 +Z，左側為 +X，單位公尺
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clamp, damp, lerp, DEG } from './util.js';
import * as TX from './textures.js';

const UP = new THREE.Vector3(0, 1, 0);
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

const FRONT_AXLE_Z = 1.8;
const REAR_AXLE_Z = -1.8;
const WHEEL_R = 0.36;

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

// 斷面放樣：sections 由車頭往車尾排列，每個斷面為超橢圓（上圓下方）
export function loftGeometry(sections, { radial = 48, perSpan = 6, nTop = 2.6, nBot = 4 } = {}) {
  const keys = ['z', 'w', 'h', 'cy', 'cx'];
  const rings = [];
  const n = sections.length;
  for (let i = 0; i < n - 1; i++) {
    for (let s = 0; s < perSpan; s++) {
      const t = s / perSpan;
      const p0 = sections[Math.max(0, i - 1)];
      const p1 = sections[i];
      const p2 = sections[i + 1];
      const p3 = sections[Math.min(n - 1, i + 2)];
      const r = {};
      for (const k of keys) r[k] = catmull(p0[k] ?? 0, p1[k] ?? 0, p2[k] ?? 0, p3[k] ?? 0, t);
      r.w = Math.max(r.w, 0.004);
      r.h = Math.max(r.h, 0.004);
      rings.push(r);
    }
  }
  const last = sections[n - 1];
  rings.push({ ...last, cx: last.cx ?? 0 });

  const z0 = rings[0].z;
  const zLen = z0 - rings[rings.length - 1].z;
  const pos = [];
  const uv = [];
  const idx = [];
  const ringPoint = (r, j) => {
    const t = -Math.PI / 2 + (j / radial) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const e = 2 / (s >= 0 ? nTop : nBot);
    return [r.cx + r.w * Math.sign(c) * Math.abs(c) ** e, r.cy + r.h * Math.sign(s) * Math.abs(s) ** e, r.z];
  };

  rings.forEach((r) => {
    const v = (z0 - r.z) / zLen;
    for (let j = 0; j <= radial; j++) {
      pos.push(...ringPoint(r, j));
      uv.push(j / radial, v);
    }
  });
  const row = radial + 1;
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * row + j;
      const b = (i + 1) * row + j;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const sideCount = idx.length;

  // 前後封口（獨立頂點，法線不與側面混在一起）
  const cap = (r, front) => {
    const base = pos.length / 3;
    pos.push(r.cx, r.cy, r.z);
    uv.push(0.5, 0.5);
    for (let j = 0; j <= radial; j++) {
      pos.push(...ringPoint(r, j));
      uv.push(0.5, 0.5);
    }
    for (let j = 0; j < radial; j++) {
      if (front) idx.push(base, base + 1 + j, base + 2 + j);
      else idx.push(base, base + 2 + j, base + 1 + j);
    }
  };
  cap(rings[0], true);
  const frontCount = idx.length - sideCount;
  cap(rings[rings.length - 1], false);
  const backCount = idx.length - sideCount - frontCount;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.addGroup(0, sideCount, 0);
  geo.addGroup(sideCount, frontCount, 1);
  geo.addGroup(sideCount + frontCount, backCount, 2);
  geo.computeVertexNormals();
  return geo;
}

// NACA 風格翼型，前緣在 z=0、後緣在 z=-chord，展向沿 X 置中；倒裝產生下壓力
function airfoilGeometry(chord, thickness, span, camber = 0.05) {
  const N = 16;
  const upper = [];
  const lower = [];
  for (let i = 0; i <= N; i++) {
    const x = (1 - Math.cos((Math.PI * i) / N)) / 2;
    const yt = 5 * thickness * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    const yc = -camber * 4 * x * (1 - x);
    upper.push([x * chord, (yc + yt) * chord]);
    lower.push([x * chord, (yc - yt) * chord]);
  }
  const shape = new THREE.Shape();
  shape.moveTo(upper[0][0], upper[0][1]);
  for (let i = 1; i <= N; i++) shape.lineTo(upper[i][0], upper[i][1]);
  for (let i = N; i >= 0; i--) shape.lineTo(lower[i][0], lower[i][1]);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: span, bevelEnabled: false, curveSegments: 1 });
  geo.rotateY(Math.PI / 2);
  geo.translate(-span / 2, 0, 0);
  return geo;
}

// 側視輪廓（z, y）擠出成薄板，厚度沿 X 置中
function plateGeometry(points, thickness) {
  const shape = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  geo.rotateY(-Math.PI / 2);
  geo.translate(thickness / 2, 0, 0);
  return geo;
}

// 俯視輪廓（x, z）擠出成水平板
function floorGeometry(points, thickness) {
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

function rod(p1, p2, r, mat) {
  const len = p1.distanceTo(p2);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8, 1), mat);
  mesh.position.copy(p1).add(p2).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, p2.clone().sub(p1).normalize());
  return mesh;
}

export function buildCar() {
  const C = CONFIG.car;
  const root = new THREE.Group();
  root.name = 'car';
  const body = new THREE.Group();
  body.name = 'carBody';
  root.add(body);

  // ---------- 材質 ----------
  const bodyLivery = TX.createBodyLivery();
  const podLivery = TX.createPodLivery();
  const tyreTex = TX.createTyreTexture();
  const rimTex = TX.createRimTexture();
  const carbonTex = TX.createCarbonTexture();
  const numberTex = TX.createDecalTexture('07', { w: 256, h: 192, size: 150 });
  const wingText = TX.createDecalTexture('PITLANE', { w: 512, h: 128, size: 86 });

  const paintParams = () => ({
    roughness: C.paintRoughness,
    metalness: C.paintMetalness,
    clearcoat: C.clearcoat,
    clearcoatRoughness: 0.06,
  });
  const M = {
    livery: new THREE.MeshPhysicalMaterial({ map: bodyLivery.texture, ...paintParams() }),
    pod: new THREE.MeshPhysicalMaterial({ map: podLivery.texture, ...paintParams() }),
    paint: new THREE.MeshPhysicalMaterial({ color: C.bodyColor, ...paintParams() }),
    accent: new THREE.MeshPhysicalMaterial({ color: C.accentColor, roughness: 0.42, metalness: 0.2, clearcoat: 0.6 }),
    stripe: new THREE.MeshPhysicalMaterial({ color: C.stripeColor, roughness: 0.35, clearcoat: 0.8 }),
    carbon: new THREE.MeshStandardMaterial({ map: carbonTex, color: '#c8ccd2', roughness: 0.48, metalness: 0.3 }),
    dark: new THREE.MeshStandardMaterial({ color: '#0a0b0d', roughness: 0.7 }),
    tyre: new THREE.MeshStandardMaterial({ map: tyreTex.texture, roughness: 0.85, side: THREE.DoubleSide }),
    rim: new THREE.MeshStandardMaterial({ map: rimTex.texture, roughness: 0.35, metalness: 0.65 }),
    rimInner: new THREE.MeshStandardMaterial({ color: '#16171a', roughness: 0.5, metalness: 0.5 }),
    helmet: new THREE.MeshPhysicalMaterial({ color: C.helmetColor, roughness: 0.25, clearcoat: 1 }),
    visor: new THREE.MeshPhysicalMaterial({ color: '#0c0d10', roughness: 0.04, metalness: 0.9, clearcoat: 1 }),
    suspension: new THREE.MeshStandardMaterial({ color: '#1d2024', roughness: 0.4, metalness: 0.5 }),
    number: new THREE.MeshBasicMaterial({ map: numberTex.texture, transparent: true, depthWrite: false }),
    wingText: new THREE.MeshBasicMaterial({ map: wingText.texture, transparent: true, depthWrite: false }),
    rainLight: new THREE.MeshBasicMaterial({ color: '#ff1a1a' }),
  };
  M.rainLight.userData.on = new THREE.Color('#ff1a1a');
  M.rainLight.userData.off = new THREE.Color('#3a0606');

  const add = (mesh, parent = body) => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  // ---------- 主車身（車鼻 → 座艙 → 引擎蓋 → 變速箱） ----------
  const mainSections = [
    { z: 2.72, w: 0.07, h: 0.05, cy: 0.19 },
    { z: 2.45, w: 0.12, h: 0.075, cy: 0.23 },
    { z: 2.0, w: 0.16, h: 0.105, cy: 0.3 },
    { z: 1.5, w: 0.2, h: 0.135, cy: 0.37 },
    { z: 1.05, w: 0.24, h: 0.165, cy: 0.42 },
    { z: 0.7, w: 0.28, h: 0.16, cy: 0.44 },
    { z: 0.35, w: 0.31, h: 0.15, cy: 0.44 },
    { z: 0.05, w: 0.32, h: 0.2, cy: 0.5 },
    { z: -0.2, w: 0.27, h: 0.3, cy: 0.6 },
    { z: -0.55, w: 0.24, h: 0.27, cy: 0.55 },
    { z: -1.1, w: 0.2, h: 0.21, cy: 0.48 },
    { z: -1.7, w: 0.14, h: 0.15, cy: 0.4 },
    { z: -2.15, w: 0.09, h: 0.1, cy: 0.34 },
    { z: -2.35, w: 0.06, h: 0.07, cy: 0.32 },
  ];
  add(new THREE.Mesh(loftGeometry(mainSections, { radial: 56, perSpan: 7 }), [M.livery, M.accent, M.accent]));

  // ---------- 側箱（左右） ----------
  const podSections = [
    { z: 0.62, w: 0.17, h: 0.16, cy: 0.29, cx: 0.5 },
    { z: 0.35, w: 0.22, h: 0.2, cy: 0.3, cx: 0.55 },
    { z: -0.2, w: 0.21, h: 0.18, cy: 0.29, cx: 0.53 },
    { z: -0.8, w: 0.15, h: 0.14, cy: 0.27, cx: 0.44 },
    { z: -1.35, w: 0.09, h: 0.09, cy: 0.24, cx: 0.33 },
    { z: -1.7, w: 0.05, h: 0.06, cy: 0.22, cx: 0.24 },
  ];
  for (const s of [1, -1]) {
    const secs = podSections.map((p) => ({ ...p, cx: p.cx * s }));
    add(new THREE.Mesh(loftGeometry(secs, { radial: 40, perSpan: 6, nTop: 3, nBot: 5 }), [M.pod, M.dark, M.accent]));
  }

  // ---------- 底板與擴散器 ----------
  const floorPts = [
    [0.3, 1.3],
    [0.75, 0.75],
    [0.86, 0.4],
    [0.86, -1.1],
    [0.56, -1.4],
    [0.5, -2.0],
    [0.3, -2.2],
  ];
  const floorShape = [...floorPts, ...floorPts.slice().reverse().map(([x, z]) => [-x, z])];
  const floor = add(new THREE.Mesh(floorGeometry(floorShape, 0.025), M.carbon));
  floor.position.y = 0.05;
  // 底板邊緣的小翼
  for (const s of [1, -1]) {
    const edge = add(new THREE.Mesh(plateGeometry([[0.6, 0.05], [0.6, 0.12], [-1.0, 0.12], [-1.05, 0.05]], 0.012), M.carbon));
    edge.position.x = 0.86 * s;
  }
  const diffuser = add(new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.012, 0.66), M.carbon));
  diffuser.position.set(0, 0.17, -2.05);
  diffuser.rotation.x = 0.36;
  for (const x of [-0.48, -0.2, 0.2, 0.48]) {
    const fence = add(new THREE.Mesh(plateGeometry([[-1.75, 0.07], [-2.38, 0.3], [-2.38, 0.18], [-1.9, 0.06]], 0.01), M.carbon));
    fence.position.x = x;
  }

  // ---------- 前翼 ----------
  const frontWing = new THREE.Group();
  body.add(frontWing);
  const fwElements = [
    { chord: 0.32, span: 1.9, z: 2.94, y: 0.07, rot: 0.05, mat: M.accent },
    { chord: 0.2, span: 1.84, z: 2.66, y: 0.105, rot: 0.3, mat: M.paint },
    { chord: 0.16, span: 1.76, z: 2.5, y: 0.16, rot: 0.58, mat: M.accent },
    { chord: 0.12, span: 1.6, z: 2.39, y: 0.22, rot: 0.82, mat: M.stripe },
  ];
  for (const e of fwElements) {
    const m = add(new THREE.Mesh(airfoilGeometry(e.chord, 0.1, e.span), e.mat), frontWing);
    m.position.set(0, e.y, e.z);
    m.rotation.x = e.rot;
  }
  for (const s of [1, -1]) {
    const ep = add(
      new THREE.Mesh(
        plateGeometry(
          [
            [2.98, 0.03],
            [2.98, 0.17],
            [2.7, 0.3],
            [2.36, 0.33],
            [2.3, 0.26],
            [2.42, 0.03],
          ],
          0.014,
        ),
        M.paint,
      ),
      frontWing,
    );
    ep.position.x = 0.955 * s;
  }
  for (const s of [1, -1]) {
    const pylon = add(new THREE.Mesh(plateGeometry([[2.75, 0.08], [2.75, 0.2], [2.5, 0.25], [2.45, 0.12]], 0.02), M.accent), frontWing);
    pylon.position.x = 0.1 * s;
  }

  // ---------- 引擎蓋鯊魚鰭、進氣口、排氣 ----------
  const fin = add(
    new THREE.Mesh(
      plateGeometry(
        [
          [-0.3, 0.86],
          [-0.5, 0.95],
          [-1.75, 0.8],
          [-2.05, 0.62],
          [-1.8, 0.5],
          [-0.5, 0.74],
        ],
        0.012,
      ),
      M.paint,
    ),
  );
  fin.name = 'fin';
  for (const s of [1, -1]) {
    const n = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.255), M.number);
    n.rotation.y = (s * Math.PI) / 2;
    n.position.set(s * 0.008, 0.8, -1.15);
    body.add(n);
  }
  const intake = add(new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.1, 24), M.dark));
  intake.rotation.x = Math.PI / 2 - 0.35;
  intake.scale.set(1.25, 1, 1);
  intake.position.set(0, 0.81, -0.02);
  const exhaust = add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.16, 16, 1, true), M.suspension));
  exhaust.rotation.x = Math.PI / 2;
  exhaust.position.set(0, 0.43, -2.25);

  // ---------- 尾翼與 DRS ----------
  const rearWing = new THREE.Group();
  body.add(rearWing);
  const mainPlane = add(new THREE.Mesh(airfoilGeometry(0.3, 0.12, 1.0, 0.06), M.accent), rearWing);
  mainPlane.position.set(0, 0.78, -2.27);
  mainPlane.rotation.x = 0.12;
  const drsPivot = new THREE.Group();
  drsPivot.position.set(0, 0.86, -2.45);
  rearWing.add(drsPivot);
  const flap = add(new THREE.Mesh(airfoilGeometry(0.21, 0.1, 0.98, 0.05), M.paint), drsPivot);
  const flapBaseRot = 0.55;
  drsPivot.rotation.x = flapBaseRot;
  flap.name = 'drsFlap';
  for (const s of [1, -1]) {
    const ep = add(
      new THREE.Mesh(
        plateGeometry(
          [
            [-2.2, 0.45],
            [-2.18, 0.94],
            [-2.3, 0.99],
            [-2.72, 0.99],
            [-2.76, 0.8],
            [-2.6, 0.45],
          ],
          0.014,
        ),
        M.accent,
      ),
      rearWing,
    );
    ep.position.x = 0.5 * s;
    const txt = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.115), M.wingText);
    txt.rotation.y = (s * Math.PI) / 2;
    txt.position.set(0.509 * s, 0.86, -2.46);
    rearWing.add(txt);
  }
  const swan = add(
    new THREE.Mesh(
      plateGeometry(
        [
          [-2.12, 0.33],
          [-2.1, 0.42],
          [-2.3, 0.8],
          [-2.4, 0.8],
          [-2.3, 0.42],
          [-2.28, 0.33],
        ],
        0.024,
      ),
      M.carbon,
    ),
    rearWing,
  );
  swan.name = 'swanNeck';
  const beam = add(new THREE.Mesh(airfoilGeometry(0.18, 0.12, 0.72), M.carbon), rearWing);
  beam.position.set(0, 0.42, -2.3);
  beam.rotation.x = 0.28;

  // 尾燈（雨燈）
  const rainLight = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.02), M.rainLight);
  rainLight.position.set(0, 0.31, -2.36);
  body.add(rainLight);

  // ---------- Halo、方向盤、安全帽、後照鏡 ----------
  const haloCurve = new THREE.CatmullRomCurve3([
    v3(-0.27, 0.63, 0.02),
    v3(-0.285, 0.76, 0.25),
    v3(-0.19, 0.815, 0.5),
    v3(0, 0.83, 0.63),
    v3(0.19, 0.815, 0.5),
    v3(0.285, 0.76, 0.25),
    v3(0.27, 0.63, 0.02),
  ]);
  const halo = add(new THREE.Mesh(new THREE.TubeGeometry(haloCurve, 64, 0.027, 12, false), M.accent));
  halo.name = 'halo';
  add(rod(v3(0, 0.83, 0.63), v3(0, 0.6, 0.8), 0.028, M.accent));

  const wheelBox = add(new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.12, 0.04), M.dark));
  wheelBox.position.set(0, 0.62, 0.55);
  wheelBox.rotation.x = -0.5;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.04), new THREE.MeshBasicMaterial({ color: '#47ff8a' }));
  screen.position.set(0, 0.632, 0.528);
  screen.rotation.x = -0.5 + Math.PI;
  body.add(screen);

  const helmet = add(new THREE.Mesh(new THREE.SphereGeometry(0.125, 32, 24), M.helmet));
  helmet.scale.set(0.95, 0.95, 1.08);
  helmet.position.set(0, 0.67, 0.24);
  const visor = add(new THREE.Mesh(new THREE.SphereGeometry(0.127, 32, 12, -Math.PI * 0.28, Math.PI * 0.56, Math.PI * 0.36, Math.PI * 0.2), M.visor));
  visor.scale.copy(helmet.scale);
  visor.position.copy(helmet.position);
  const headrest = add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.16), M.accent));
  headrest.position.set(0, 0.62, 0.1);

  for (const s of [1, -1]) {
    add(rod(v3(0.4 * s, 0.47, 0.6), v3(0.43 * s, 0.6, 0.62), 0.01, M.carbon));
    const mirror = add(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.055, 0.05), M.paint));
    mirror.position.set(0.44 * s, 0.62, 0.62);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.04), M.visor);
    glass.position.set(0.44 * s, 0.62, 0.594);
    glass.rotation.y = Math.PI;
    body.add(glass);
  }

  // ---------- 懸吊 ----------
  const susp = (pairs, r = 0.013) => pairs.forEach(([p1, p2]) => add(rod(v3(...p1), v3(...p2), r, M.suspension)));
  for (const s of [1, -1]) {
    const F = FRONT_AXLE_Z;
    const R = REAR_AXLE_Z;
    susp([
      [[0.66 * s, 0.5, F], [0.18 * s, 0.47, F + 0.35]],
      [[0.66 * s, 0.5, F], [0.18 * s, 0.45, F - 0.35]],
      [[0.68 * s, 0.22, F], [0.14 * s, 0.24, F + 0.4]],
      [[0.68 * s, 0.22, F], [0.14 * s, 0.24, F - 0.4]],
      [[0.64 * s, 0.24, F - 0.02], [0.2 * s, 0.52, F - 0.1]],
      [[0.66 * s, 0.36, F + 0.12], [0.18 * s, 0.36, F + 0.15]],
      [[0.6 * s, 0.52, R], [0.14 * s, 0.45, R + 0.25]],
      [[0.6 * s, 0.52, R], [0.14 * s, 0.45, R - 0.25]],
      [[0.62 * s, 0.2, R], [0.12 * s, 0.24, R + 0.4]],
      [[0.62 * s, 0.2, R], [0.12 * s, 0.24, R - 0.3]],
      [[0.62 * s, 0.32, R - 0.15], [0.12 * s, 0.3, R - 0.2]],
    ]);
    add(rod(v3(0.6 * s, 0.36, R), v3(0.1 * s, 0.34, R), 0.028, M.suspension));
  }

  // ---------- 輪胎 ----------
  const wheels = [];
  const makeWheel = (width, x, z, front) => {
    const hub = new THREE.Group();
    hub.position.set(x, WHEEL_R, z);
    root.add(hub);
    const spin = new THREE.Group();
    hub.add(spin);
    const r = WHEEL_R;
    const hw = width / 2;
    const profile = [
      [0.235, -hw],
      [0.29, -hw * 1.0],
      [0.33, -hw * 0.97],
      [0.352, -hw * 0.88],
      [r, -hw * 0.68],
      [r, hw * 0.68],
      [0.352, hw * 0.88],
      [0.33, hw * 0.97],
      [0.29, hw],
      [0.235, hw],
    ].map(([a, b]) => new THREE.Vector2(a, b));
    const tyreGeo = new THREE.LatheGeometry(profile, 56);
    tyreGeo.rotateZ(Math.PI / 2);
    add(new THREE.Mesh(tyreGeo, M.tyre), spin);
    for (const side of [1, -1]) {
      const face = new THREE.Mesh(new THREE.CircleGeometry(0.236, 40), M.rim);
      face.rotation.y = (side * Math.PI) / 2;
      face.position.x = side * (hw - 0.012);
      spin.add(face);
    }
    const barrel = add(new THREE.Mesh(new THREE.CylinderGeometry(0.234, 0.234, width - 0.03, 32, 1, true), M.rimInner), spin);
    barrel.rotation.z = Math.PI / 2;
    // 煞車導風罩（不旋轉）
    const duct = add(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.08, 20), M.carbon), hub);
    duct.rotation.z = Math.PI / 2;
    duct.position.x = -Math.sign(x) * (hw + 0.03);
    const w = { hub, spin, front, side: Math.sign(x), x, z, width };
    wheels.push(w);
    return w;
  };
  makeWheel(0.305, 0.83, FRONT_AXLE_Z, true);
  makeWheel(0.305, -0.83, FRONT_AXLE_Z, true);
  makeWheel(0.405, 0.8, REAR_AXLE_Z, false);
  makeWheel(0.405, -0.8, REAR_AXLE_Z, false);

  // ---------- 塗裝套用 ----------
  function applyColors() {
    const c = CONFIG.car;
    bodyLivery.paint(c);
    podLivery.paint(c);
    tyreTex.paint(c.compoundColor);
    rimTex.paint(c.rimColor, c.compoundColor);
    numberTex.paint(c.stripeColor, c.accentColor);
    wingText.paint(c.stripeColor);
    M.paint.color.set(c.bodyColor);
    M.accent.color.set(c.accentColor);
    M.stripe.color.set(c.stripeColor);
    M.helmet.color.set(c.helmetColor);
    for (const m of [M.livery, M.pod, M.paint]) {
      m.roughness = c.paintRoughness;
      m.metalness = c.paintMetalness;
      m.clearcoat = c.clearcoat;
    }
    // 外部模型：只對 DEV 指定的「車漆材質」上色，其餘保持原貌
    if (external) {
      const names = CONFIG.model.paintMaterial.split(',').map((n) => n.trim()).filter(Boolean);
      for (const [name, mat] of external.materials) {
        if (!mat.color) continue;
        mat.userData.origColor ??= mat.color.clone();
        if (names.includes(name)) mat.color.set(c.bodyColor);
        else mat.color.copy(mat.userData.origColor);
      }
    }
  }
  let external = null;
  let modelHelmet = null;
  applyColors();

  // 收集可被射線命中的網格（熱點遮擋判斷與 DEV 拖曳用）
  const pickMeshes = [];
  root.traverse((o) => {
    if (o.isMesh && !o.material.transparent) pickMeshes.push(o);
  });

  // ---------- 動態 ----------
  const anim = { drs: 0, drsTarget: 0, pitch: 0, roll: 0, heave: 0, blink: 0, steerVisual: 0 };

  function update(dt, phys, opts = {}) {
    // 輪子
    const steer = phys ? phys.steer : opts.steer ?? 0;
    anim.steerVisual = lerp(anim.steerVisual, steer, damp(20, dt));
    for (const w of wheels) {
      if (w.front) w.hub.rotation.y = anim.steerVisual;
      const omega = phys ? (w.front ? phys.wheelOmegaF : phys.wheelOmegaR) : 0;
      w.spin.rotation.x += omega * dt * (WHEEL_R / (w.radius || WHEEL_R));
    }
    // 車身俯仰、側傾、下沉
    const accF = phys ? phys.accF : 0;
    const accL = phys ? phys.accL : 0;
    const spd = phys ? phys.speed : 0;
    anim.pitch = lerp(anim.pitch, clamp(-accF * 0.0022, -0.035, 0.035), damp(8, dt));
    anim.roll = lerp(anim.roll, clamp(accL * 0.0016, -0.03, 0.03), damp(8, dt));
    anim.heave = lerp(anim.heave, -Math.min(spd * spd * 0.0000045, 0.02), damp(6, dt));
    body.rotation.x = anim.pitch;
    body.rotation.z = anim.roll;
    body.position.y = anim.heave + (opts.idleShake ? Math.sin(performance.now() * 0.09) * 0.0012 : 0);

    // DRS
    anim.drs = lerp(anim.drs, anim.drsTarget, damp(9, dt));
    drsPivot.rotation.x = flapBaseRot - anim.drs * CONFIG.anim.drsAngleDeg * DEG;
    if (external?.drs) external.drs.rotation.x = -anim.drs * CONFIG.anim.drsAngleDeg * DEG;
    if (modelHelmet) {
      const H = CONFIG.model.helmet;
      modelHelmet.visible = H.show;
      modelHelmet.position.set(...H.pos);
      modelHelmet.scale.setScalar(H.scale);
    }

    // 雨燈閃爍
    anim.blink += dt;
    const on = opts.rainLight ? Math.floor(anim.blink * 4) % 2 === 0 : false;
    M.rainLight.color.copy(on ? M.rainLight.userData.on : M.rainLight.userData.off);
  }

  const axleOffset = { front: FRONT_AXLE_Z, rear: REAR_AXLE_Z };

  // 換成外部 GLB 模型：移除程式建模的車身與輪子，沿用同一套動畫介面
  function useModel(loaded) {
    for (const c of [...body.children]) body.remove(c);
    for (const w of wheels) root.remove(w.hub);
    wheels.length = 0;
    body.add(loaded.body);
    if (loaded.drs) body.add(loaded.drs);
    // 外部模型沒有車手：沿用程式建模的安全帽
    // 一律建立，顯示與否由 DEV 開關即時控制
    modelHelmet = new THREE.Group();
    modelHelmet.add(helmet, visor);
    helmet.position.set(0, 0, 0);
    visor.position.set(0, 0, 0);
    modelHelmet.visible = CONFIG.model.helmet.show;
    body.add(modelHelmet);
    for (const w of loaded.wheels) {
      root.add(w.hub);
      wheels.push(w);
    }
    external = loaded;
    if (loaded.frontAxleZ != null && loaded.wheelbase) {
      axleOffset.front = loaded.frontAxleZ;
      axleOffset.rear = loaded.frontAxleZ - loaded.wheelbase;
    }
    pickMeshes.length = 0;
    root.traverse((o) => {
      if (o.isMesh && !(Array.isArray(o.material) ? o.material[0] : o.material)?.transparent) pickMeshes.push(o);
    });
    applyColors();
  }

  return {
    root,
    body,
    wheels,
    materials: M,
    pickMeshes,
    applyColors,
    update,
    useModel,
    get external() {
      return external;
    },
    setDRS(open) {
      anim.drsTarget = open ? 1 : 0;
    },
    get drsOpen() {
      return anim.drsTarget > 0.5;
    },
    axleOffset,
    wheelRadius: WHEEL_R,
  };
}

export { FRONT_AXLE_Z, REAR_AXLE_Z, WHEEL_R };
