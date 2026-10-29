// 地上的建議路線：綠＝全油門、黃＝不要再加速、紅＝煞車
// 駕駛中顏色是動態的（像 F1 遊戲的輔助線）：依目前車速算，車子底下是紅色就煞車、不是紅色就放開
import * as THREE from 'three';
import { guideColor } from './autopilot.js';
import { CONFIG } from './config.js';

const COLORS = {
  full: new THREE.Color('#22c55e'),
  corner: new THREE.Color('#facc15'),
  brake: new THREE.Color('#ef4444'),
};
const WIDTH = 0.9;
const Y = 0.016;

export function createGuideLine(scene, guide) {
  const { line, tan, zone, n } = guide;
  const pos = new Float32Array(n * 2 * 3);
  const col = new Float32Array(n * 2 * 3);
  for (let i = 0; i < n; i++) {
    const p = line[i];
    const t = tan[i];
    // 左法線 = (t.z, -t.x)
    const lx = t.z * (WIDTH / 2);
    const lz = -t.x * (WIDTH / 2);
    pos.set([p.x + lx, Y, p.z + lz, p.x - lx, Y, p.z - lz], i * 6);
  }
  const paint = (colorOf) => {
    for (let i = 0; i < n; i++) {
      const c = COLORS[colorOf(i)];
      col.set([c.r, c.g, c.b, c.r, c.g, c.b], i * 6);
    }
  };
  paint((i) => zone[i]);
  const idx = [];
  for (let i = 0; i < n; i++) {
    const a = i * 2;
    const b = ((i + 1) % n) * 2;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: CONFIG.assist.guideOpacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'guideLine';
  mesh.renderOrder = 1;
  mesh.frustumCulled = false;
  scene.add(mesh);
  const colorAttr = geo.getAttribute('color');
  let lastV = -1;
  return {
    mesh,
    setVisible: (v) => (mesh.visible = v),
    dispose() {
      scene.remove(mesh);
      geo.dispose();
      mat.dispose();
    },
    setOpacity: (o) => (mat.opacity = o),
    // 依目前車速（m/s）重新上色；速度變化不大時略過
    update(v) {
      mat.opacity = CONFIG.assist.guideOpacity; // DEV 面板可即時調整
      if (Math.abs(v - lastV) < 0.25) return;
      lastV = v;
      paint((i) => guideColor(guide, i, v));
      colorAttr.needsUpdate = true;
    },
  };
}
