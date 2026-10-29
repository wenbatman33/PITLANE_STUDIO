// 白色攝影棚場景：燈光、無限地面、展示間地標、三角錐
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CONFIG } from './config.js';
import { DEG } from './util.js';
import * as TX from './textures.js';

const TILE = 20; // 地面貼圖一格代表的公尺數
const GROUND_SIZE = 640;

export function createWorld(renderer) {
  const L = CONFIG.lighting;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(L.background);
  scene.fog = new THREE.Fog(L.background, L.fogNear, L.fogFar);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  const hemi = new THREE.HemisphereLight('#ffffff', '#d5d9df', L.hemiIntensity);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight('#ffffff', L.sunIntensity);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -6;
  sc.right = 6;
  sc.top = 6;
  sc.bottom = -6;
  sc.near = 1;
  sc.far = 80;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);

  // 地面：格線貼圖會隨車子以整格跳動，看起來是無限延伸
  const groundTex = TX.createGroundTexture();
  groundTex.texture.repeat.set(GROUND_SIZE / TILE, GROUND_SIZE / TILE);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
    new THREE.MeshStandardMaterial({ color: L.floorColor, map: groundTex.texture, roughness: 0.9, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.name = 'ground';
  scene.add(ground);

  // 展示間轉盤標誌
  const mark = new THREE.Mesh(
    new THREE.PlaneGeometry(13, 13),
    new THREE.MeshBasicMaterial({ map: TX.createFloorMarkTexture(), transparent: true, depthWrite: false }),
  );
  mark.rotation.x = -Math.PI / 2;
  mark.position.y = 0.004;
  mark.renderOrder = 0;
  scene.add(mark);

  const cones = createCones(scene);

  function applyLighting() {
    const l = CONFIG.lighting;
    renderer.toneMappingExposure = l.exposure;
    scene.environmentIntensity = l.envIntensity;
    sun.intensity = l.sunIntensity;
    hemi.intensity = l.hemiIntensity;
    scene.background.set(l.background);
    scene.fog.color.set(l.background);
    scene.fog.near = l.fogNear;
    scene.fog.far = l.fogFar;
    ground.material.color.set(l.floorColor);
    groundTex.paint(l.gridOpacity);
    document.documentElement.style.setProperty('--paper', l.background);
  }
  applyLighting();

  const sunDir = new THREE.Vector3();
  const snapped = new THREE.Vector3();
  function update(focus) {
    ground.position.x = Math.round(focus.x / TILE) * TILE;
    ground.position.z = Math.round(focus.z / TILE) * TILE;
    // 陰影相機對齊陰影貼圖的像素格線，車子移動時影子邊緣才不會閃爍
    const texel = (sc.right - sc.left) / sun.shadow.mapSize.x;
    snapped.set(Math.round(focus.x / texel) * texel, 0, Math.round(focus.z / texel) * texel);
    const l = CONFIG.lighting;
    const az = l.sunAzimuth * DEG;
    const el = l.sunElevation * DEG;
    sunDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
    sun.target.position.copy(snapped);
    sun.position.copy(snapped).addScaledVector(sunDir, 40);
  }

  return { scene, sun, hemi, ground, mark, cones, applyLighting, update };
}

// ---------- 三角錐：InstancedMesh + 簡易被撞飛物理 ----------
function createCones(scene) {
  const layout = [];
  for (let i = 0; i < 8; i++) layout.push([i % 2 ? 1.2 : -1.2, 30 + i * 13]);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    layout.push([-34 + Math.cos(a) * 11, 18 + Math.sin(a) * 11]);
  }
  layout.push([-34, 18]);
  for (const [x, z] of [
    [38, 40],
    [46, 40],
    [38, 90],
    [46, 90],
    [-4, 150],
    [4, 150],
  ])
    layout.push([x, z]);

  const count = layout.length;
  const coneGeo = new THREE.ConeGeometry(0.16, 0.5, 16, 1);
  coneGeo.translate(0, 0.28, 0);
  const baseGeo = new THREE.BoxGeometry(0.38, 0.035, 0.38);
  baseGeo.translate(0, 0.0175, 0);
  const coneMat = new THREE.MeshStandardMaterial({ map: TX.createConeTexture(), roughness: 0.6 });
  const baseMat = new THREE.MeshStandardMaterial({ color: '#1b1c1f', roughness: 0.8 });
  const bodies = new THREE.InstancedMesh(coneGeo, coneMat, count);
  const bases = new THREE.InstancedMesh(baseGeo, baseMat, count);
  for (const m of [bodies, bases]) {
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    scene.add(m);
  }

  const state = layout.map(([x, z]) => ({
    home: new THREE.Vector3(x, 0, z),
    pos: new THREE.Vector3(x, 0, z),
    vel: new THREE.Vector3(),
    rot: new THREE.Euler(),
    ang: new THREE.Vector3(),
    active: false,
  }));

  const mtx = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const axis = new THREE.Vector3();

  function writeMatrices() {
    state.forEach((c, i) => {
      q.setFromEuler(c.rot);
      mtx.compose(c.pos, q, one);
      bodies.setMatrixAt(i, mtx);
      bases.setMatrixAt(i, mtx);
    });
    bodies.instanceMatrix.needsUpdate = true;
    bases.instanceMatrix.needsUpdate = true;
  }

  function reset() {
    for (const c of state) {
      c.pos.copy(c.home);
      c.vel.set(0, 0, 0);
      c.rot.set(0, 0, 0);
      c.ang.set(0, 0, 0);
      c.active = false;
    }
    writeMatrices();
  }
  reset();

  // 回傳本幀被撞到的數量
  function update(dt, phys) {
    let hits = 0;
    let moved = false;
    if (phys) {
      const cs = Math.cos(phys.yaw);
      const sn = Math.sin(phys.yaw);
      for (const c of state) {
        const dx = c.pos.x - phys.x;
        const dz = c.pos.z - phys.z;
        if (dx * dx + dz * dz > 16) continue;
        // 轉到車身座標（前 = +Z，左 = +X）
        const lz = dx * sn + dz * cs;
        const lx = dx * cs - dz * sn;
        if (Math.abs(lx) < 1.15 && Math.abs(lz) < 3.0 && c.pos.y < 0.4 && phys.speed > 0.5) {
          const sp = phys.speed;
          const len = Math.hypot(dx, dz) || 1;
          c.vel.set(phys.vx * 1.05 + (dx / len) * 2.5, 2 + sp * 0.12, phys.vz * 1.05 + (dz / len) * 2.5);
          c.ang.set((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 18);
          c.pos.y = Math.max(c.pos.y, 0.05);
          if (!c.active) hits++;
          c.active = true;
        }
      }
    }
    for (const c of state) {
      if (!c.active) continue;
      moved = true;
      c.vel.y -= 9.81 * dt;
      c.pos.addScaledVector(c.vel, dt);
      c.rot.x += c.ang.x * dt;
      c.rot.y += c.ang.y * dt;
      c.rot.z += c.ang.z * dt;
      // 倒下時中心離地較高
      axis.set(0, 1, 0).applyEuler(c.rot);
      const floorY = (1 - Math.abs(axis.y)) * 0.16;
      if (c.pos.y < floorY) {
        c.pos.y = floorY;
        c.vel.y = Math.abs(c.vel.y) * 0.25;
        c.vel.x *= 0.72;
        c.vel.z *= 0.72;
        c.ang.multiplyScalar(0.7);
        if (c.vel.lengthSq() < 0.05 && c.ang.lengthSq() < 0.2) c.active = false;
      }
    }
    if (moved || hits) writeMatrices();
    return hits;
  }

  function setVisible(v) {
    bodies.visible = v;
    bases.visible = v;
  }

  return { update, reset, setVisible, state };
}
