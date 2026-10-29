// 外部 GLB 賽車模型：自動定向（車頭朝 +Z）、縮放到指定車長、貼齊地面、找出四顆輪子
// 找不到檔案或解析失敗時回傳 null，由程式建模的車頂替
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { CONFIG } from './config.js';
import { DEG } from './util.js';

// 射線改走 BVH 加速（合併後的大網格做熱點遮擋判斷才不會卡）
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const WHEEL_RE = /(wheel|tyre|tire|rim|rueda|llanta|pneu|roue|reifen)/i;
const NOT_WHEEL_RE = /steer/i; // 方向盤不是輪子

function nameChain(obj, stop) {
  const names = [];
  for (let o = obj; o && o !== stop; o = o.parent) if (o.name) names.push(o.name);
  return names.join(' / ');
}

export async function loadCarModel(url, onProgress) {
  let gltf;
  try {
    gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url, onProgress);
  } catch (err) {
    console.info('[carModel] 未載入外部模型，改用程式建模：', err?.message || err);
    return null;
  }
  const M = CONFIG.model;
  const root = new THREE.Group();
  const holder = new THREE.Group();
  holder.name = 'externalModel';
  holder.add(gltf.scene);
  root.add(holder);

  // 移除重複版本的節點（例如動態模糊輪圈），用 remove 而非隱藏，避免影響尺寸量測
  if (M.hideNodes) {
    const re = new RegExp(M.hideNodes);
    const drop = [];
    gltf.scene.traverse((o) => {
      if (o.name && re.test(o.name)) drop.push(o);
    });
    drop.forEach((o) => o.parent?.remove(o));
    if (drop.length) console.info(`[carModel] 移除 ${drop.length} 個節點：`, drop.map((o) => o.name).join(', '));
  }

  const meshes = [];
  const materials = new Map();
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    meshes.push(o);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (m && !materials.has(m.name || m.uuid)) materials.set(m.name || m.uuid, m);
    }
  });
  const wheelMeshes = meshes.filter((m) => {
    const chain = nameChain(m, holder);
    return WHEEL_RE.test(chain) && !NOT_WHEEL_RE.test(chain);
  });

  const box = new THREE.Box3();
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();

  // 依目前 holder 的旋轉，量出整車尺寸並把輪子分到四個角
  function measure() {
    root.updateMatrixWorld(true);
    box.setFromObject(holder);
    box.getSize(size);
    box.getCenter(center);
    const groups = {};
    for (const m of wheelMeshes) {
      const b = new THREE.Box3().setFromObject(m);
      const s = b.getSize(new THREE.Vector3());
      // 一個網格就橫跨半台車的，代表四輪合併成一塊，無法個別轉動
      if (s.x > size.x * 0.5 || s.z > size.z * 0.4) continue;
      const c = b.getCenter(new THREE.Vector3());
      const key = `${c.x > center.x ? 'L' : 'R'}${c.z > center.z ? 'F' : 'B'}`;
      (groups[key] ||= { box: new THREE.Box3(), meshes: [] }).meshes.push(m);
      groups[key].box.union(b);
    }
    return groups;
  }

  // 1) 方向：長邊對齊 Z；自動模式下再用「後輪比前輪寬」判斷車頭
  let rot = M.rotY === 'auto' ? 0 : Number(M.rotY) || 0;
  holder.rotation.y = rot * DEG;
  let groups = measure();
  if (M.rotY === 'auto') {
    if (size.x > size.z) {
      rot = 90;
      holder.rotation.y = rot * DEG;
      groups = measure();
    }
    const width = (k) => (groups[k] ? groups[k].box.getSize(new THREE.Vector3()).x : 0);
    const front = Math.max(width('LF'), width('RF'));
    const rear = Math.max(width('LB'), width('RB'));
    if (front && rear && front > rear * 1.05) {
      rot += 180;
      holder.rotation.y = rot * DEG;
      groups = measure();
    }
  }

  // 2) 縮放到指定車長
  const scale = (M.length / size.z) * M.scaleAdjust;
  holder.scale.setScalar(scale);
  groups = measure();

  // 3) 置中：X 對中、輪胎底部貼地、前後軸中點放在原點
  const axles = { front: null, rear: null };
  const zOf = (k) => (groups[k] ? groups[k].box.getCenter(new THREE.Vector3()).z : null);
  const fz = [zOf('LF'), zOf('RF')].filter((v) => v != null);
  const rz = [zOf('LB'), zOf('RB')].filter((v) => v != null);
  if (fz.length && rz.length) {
    axles.front = fz.reduce((a, b) => a + b) / fz.length;
    axles.rear = rz.reduce((a, b) => a + b) / rz.length;
  }
  const midZ = axles.front != null ? (axles.front + axles.rear) / 2 : center.z;
  holder.position.x -= center.x;
  holder.position.y -= box.min.y - M.yOffset;
  holder.position.z -= midZ - M.zOffset;
  groups = measure();

  // 4) 輪子各自放進「轉向樞紐 → 滾動」兩層群組
  const wheels = [];
  for (const [key, g] of Object.entries(groups)) {
    const c = g.box.getCenter(new THREE.Vector3());
    const s = g.box.getSize(new THREE.Vector3());
    const pivot = new THREE.Group();
    pivot.name = `wheel_${key}`;
    pivot.position.copy(c);
    root.add(pivot);
    const spin = new THREE.Group();
    pivot.add(spin);
    root.updateMatrixWorld(true);
    for (const m of g.meshes) spin.attach(m);
    wheels.push({ hub: pivot, spin, front: key.endsWith('F'), side: key.startsWith('L') ? 1 : -1, x: c.x, z: c.z, width: s.x, radius: s.y / 2 });
  }

  // 5) DRS 活動翼片：樞紐放在翼片後緣頂端，打開時前緣上掀
  let drs = null;
  if (M.drsNodes) {
    const re = new RegExp(M.drsNodes);
    const parts = [];
    holder.traverse((o) => {
      if (o.name && re.test(o.name)) parts.push(o);
    });
    const isAncestor = (a, b) => {
      for (let o = b.parent; o; o = o.parent) if (o === a) return true;
      return false;
    };
    const top = parts.filter((p) => !parts.some((q) => q !== p && isAncestor(q, p)));
    if (top.length) {
      root.updateMatrixWorld(true);
      const b = new THREE.Box3();
      top.forEach((o) => b.expandByObject(o));
      drs = new THREE.Group();
      drs.name = 'drsPivot';
      drs.position.set((b.min.x + b.max.x) / 2, b.max.y, b.min.z);
      root.add(drs);
      root.updateMatrixWorld(true);
      top.forEach((o) => drs.attach(o));
    }
  }

  const front = wheels.filter((w) => w.front);
  const rear = wheels.filter((w) => !w.front);
  const avg = (arr, k) => arr.reduce((a, w) => a + w[k], 0) / arr.length;
  const wheelbase = front.length && rear.length ? avg(front, 'z') - avg(rear, 'z') : null;

  // 6) 依材質合併網格，大幅減少 draw call（車身、每顆輪子、DRS 各自合併）
  const before = meshes.length;
  const mergeTargets = [holder, ...wheels.map((w) => w.spin), ...(drs ? [drs] : [])];
  mergeTargets.forEach(mergeByMaterial);
  meshes.length = 0;
  root.traverse((o) => o.isMesh && meshes.push(o));
  for (const m of meshes) m.geometry.computeBoundsTree();
  console.info(`[carModel] 合併網格：${before} → ${meshes.length}`);

  console.info(
    `[carModel] 載入完成：${meshes.length} 個網格、${materials.size} 種材質、找到 ${wheels.length} 顆輪子（${wheelMeshes.length} 個輪胎相關網格）、方向 ${rot}°、縮放 ${scale.toFixed(4)}`,
  );

  return {
    body: holder,
    wheels,
    wheelbase,
    frontAxleZ: front.length ? avg(front, 'z') : null,
    wheelRadius: wheels.length ? avg(wheels, 'radius') : null,
    materials,
    meshes,
    drs,
    rotation: rot,
  };
}

// 量化（整數）屬性轉回 Float32，套用矩陣時才不會被截斷
function toFloatGeometry(src) {
  const geo = new THREE.BufferGeometry();
  const get = ['getX', 'getY', 'getZ', 'getW'];
  for (const [name, attr] of Object.entries(src.attributes)) {
    const n = attr.count;
    const s = attr.itemSize;
    const arr = new Float32Array(n * s);
    for (let i = 0; i < n; i++) for (let k = 0; k < s; k++) arr[i * s + k] = attr[get[k]](i);
    geo.setAttribute(name, new THREE.BufferAttribute(arr, s));
  }
  if (src.index) geo.setIndex(Array.from(src.index.array));
  return geo;
}

// 鏡像（行列式為負）的零件套用矩陣後三角形會反面，要把頂點順序翻回來
function flipWinding(geo) {
  if (!geo.index) geo.setIndex([...Array(geo.attributes.position.count).keys()]);
  const idx = geo.index.array;
  for (let i = 0; i < idx.length; i += 3) {
    const t = idx[i + 1];
    idx[i + 1] = idx[i + 2];
    idx[i + 2] = t;
  }
  geo.index.needsUpdate = true;
}

function mergeByMaterial(group) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map();
  group.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh || Array.isArray(o.material) || o.morphTargetInfluences) return;
    const g = o.geometry;
    const key = [o.material.uuid, !!g.index, ...Object.keys(g.attributes).sort().map((k) => `${k}${g.attributes[k].itemSize}`)].join('|');
    (buckets.get(key) || buckets.set(key, []).get(key)).push(o);
  });
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    const geos = list.map((m) => {
      const g = toFloatGeometry(m.geometry);
      // 統一成有 index 的幾何，mergeGeometries 才能合併
      if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
      const mtx = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
      g.applyMatrix4(mtx);
      if (mtx.determinant() < 0) flipWinding(g);
      return g;
    });
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, list[0].material);
    mesh.name = `merged_${list[0].material.name || 'mat'}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    list.forEach((m) => {
      m.removeFromParent();
      m.geometry.dispose();
    });
  }
}
