// 對手比賽的畫面：AI 車模型（換色）、位置插值、輪子／車身動畫、頭上名牌
import * as THREE from 'three';
import { buildCar } from './car.js';
import { cloneCarModel } from './carModel.js';

const _v = new THREE.Vector3();

// race：createRace() 的結果；loaded：loadCarModel() 的結果（沒有就用程式建模的車）
// offsetOf(phys)：物理質心到模型原點的距離（與玩家相同算法）
export function createRaceView(scene, race, loaded, offsetOf, tagLayer) {
  const views = race.entries
    .filter((e) => !e.isPlayer)
    .map((e) => {
      const car = buildCar();
      if (loaded) car.useModel(cloneCarModel(loaded, e.opp.hue));
      car.root.traverse((o) => {
        if (o.isMesh) o.castShadow = true;
      });
      scene.add(car.root);
      const tag = document.createElement('div');
      tag.className = 'opp-tag';
      tag.style.setProperty('--hue', `${(e.opp.hue + 0) % 360}`);
      tagLayer.appendChild(tag);
      return { e, car, tag, last: '' };
    });

  return {
    views,
    setVisible(v) {
      views.forEach((w) => {
        w.car.root.visible = v;
        w.tag.hidden = !v;
      });
    },
    // alpha：物理插值比例（與玩家相同）；positions：名次表（給名牌顯示 P 幾）
    update(dt, alpha, camera, standings) {
      const W = innerWidth;
      const H = innerHeight;
      for (const w of views) {
        const c = w.e.car;
        const p = w.e.prev;
        const jump = Math.hypot(c.x - p.x, c.z - p.z) > 5; // 被放回賽道：不插值
        const a = jump ? 1 : alpha;
        const x = p.x + (c.x - p.x) * a;
        const z = p.z + (c.z - p.z) * a;
        let dy = c.yaw - p.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        const yaw = p.yaw + dy * a;
        const off = offsetOf(c, w.car);
        w.car.root.position.set(x + Math.sin(yaw) * off, 0, z + Math.cos(yaw) * off);
        w.car.root.rotation.y = yaw;
        w.car.update(dt, c);
        // 名牌：車頂上方 1.6m，太遠或在鏡頭後方就藏起來
        _v.set(x, 1.6, z);
        const dist = _v.distanceTo(camera.position);
        _v.project(camera);
        const show = _v.z < 1 && dist < 140 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1;
        w.tag.style.opacity = show ? String(Math.min(1, (140 - dist) / 40)) : '0';
        if (show) w.tag.style.transform = `translate(${((_v.x + 1) / 2) * W}px, ${((1 - _v.y) / 2) * H}px) translate(-50%, -100%)`;
        const pos = standings.indexOf(w.e) + 1;
        const label = `P${pos} ${w.e.name}`;
        if (label !== w.last) {
          w.tag.textContent = label;
          w.last = label;
        }
      }
    },
  };
}
