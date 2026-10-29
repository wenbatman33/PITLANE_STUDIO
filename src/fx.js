// 胎痕（環狀緩衝區）與輪胎煙霧（點精靈）
import * as THREE from 'three';
import { CONFIG } from './config.js';

export class Skidmarks {
  constructor(scene, maxQuads = 6000) {
    this.max = maxQuads;
    this.pos = new Float32Array(maxQuads * 4 * 3);
    this.col = new Float32Array(maxQuads * 4 * 4);
    const idx = new Uint32Array(maxQuads * 6);
    for (let k = 0; k < maxQuads; k++) {
      const b = k * 4;
      idx.set([b, b + 1, b + 2, b + 2, b + 1, b + 3], k * 6);
    }
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('color', this.colAttr);
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);
    this.geo = geo;
    this.material = new THREE.MeshBasicMaterial({
      color: '#ffffff',
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      opacity: CONFIG.fx.skidOpacity,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.cursor = 0;
    this.count = 0;
    this.last = [];
    this.dirtyMin = Infinity;
    this.dirtyMax = -1;
    this.fullDirty = false;
  }

  clear() {
    this.cursor = 0;
    this.count = 0;
    this.last = [];
    this.geo.setDrawRange(0, 0);
  }

  // 每個輪子每幀呼叫；intensity <= 0 代表這一輪沒有在滑
  add(i, x, z, dirX, dirZ, width, intensity) {
    if (intensity <= 0.02) {
      this.last[i] = null;
      return;
    }
    const prev = this.last[i];
    const hw = width / 2;
    const px = dirZ * hw;
    const pz = -dirX * hw;
    const cur = { lx: x + px, lz: z + pz, rx: x - px, rz: z - pz, a: Math.min(1, intensity), x, z };
    if (!prev) {
      this.last[i] = cur;
      return;
    }
    const dx = x - prev.x;
    const dz = z - prev.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < 0.0144) return; // 移動超過 12cm 才畫一段
    if (d2 > 4) {
      this.last[i] = cur; // 瞬移（重置）時不要拉出長線
      return;
    }
    const k = this.cursor;
    const y = 0.012;
    const p = k * 12;
    this.pos.set([prev.lx, y, prev.lz, prev.rx, y, prev.rz, cur.lx, y, cur.lz, cur.rx, y, cur.rz], p);
    const c = k * 16;
    const g = 0.08;
    this.col.set([g, g, g, prev.a, g, g, g, prev.a, g, g, g, cur.a, g, g, g, cur.a], c);
    this.dirtyMin = Math.min(this.dirtyMin, k);
    this.dirtyMax = Math.max(this.dirtyMax, k);
    this.cursor = (k + 1) % this.max;
    if (this.cursor === 0) this.fullDirty = true;
    this.count = Math.min(this.count + 1, this.max);
    this.last[i] = cur;
  }

  flush() {
    this.material.opacity = CONFIG.fx.skidOpacity;
    if (this.dirtyMax < 0 && !this.fullDirty) return;
    for (const [attr, stride] of [
      [this.posAttr, 12],
      [this.colAttr, 16],
    ]) {
      attr.clearUpdateRanges();
      if (!this.fullDirty) attr.addUpdateRange(this.dirtyMin * stride, (this.dirtyMax - this.dirtyMin + 1) * stride);
      attr.needsUpdate = true;
    }
    this.geo.setDrawRange(0, this.count * 6);
    this.dirtyMin = Infinity;
    this.dirtyMax = -1;
    this.fullDirty = false;
  }
}

export class Smoke {
  constructor(scene, max = 420) {
    this.max = max;
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.sizeArr = new Float32Array(max);
    this.alphaArr = new Float32Array(max);
    this.next = 0;

    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.sizeArr, 1).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(this.alphaArr, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aSize', this.sizeAttr);
    geo.setAttribute('aAlpha', this.alphaAttr);

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        uColor: { value: new THREE.Color(CONFIG.fx.smokeColor) },
        uScale: { value: 400 },
        uOpacity: { value: CONFIG.fx.smokeOpacity },
      },
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aAlpha;
        uniform float uScale;
        varying float vAlpha;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
          vAlpha = aAlpha;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying float vAlpha;
        void main() {
          vec2 q = gl_PointCoord - 0.5;
          float d = length(q);
          float a = smoothstep(0.5, 0.05, d) * vAlpha * uOpacity;
          if (a < 0.004) discard;
          gl_FragColor = vec4(uColor, a);
          #include <colorspace_fragment>
        }
      `,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    scene.add(this.points);
  }

  emit(x, y, z, vx, vz, strength) {
    const i = this.next;
    this.next = (i + 1) % this.max;
    const F = CONFIG.fx;
    this.p[i * 3] = x + (Math.random() - 0.5) * 0.3;
    this.p[i * 3 + 1] = y;
    this.p[i * 3 + 2] = z + (Math.random() - 0.5) * 0.3;
    this.v[i * 3] = vx * 0.25 + (Math.random() - 0.5) * 1.6;
    this.v[i * 3 + 1] = 0.6 + Math.random() * 0.8;
    this.v[i * 3 + 2] = vz * 0.25 + (Math.random() - 0.5) * 1.6;
    const life = F.smokeLife * (0.7 + Math.random() * 0.6);
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size0[i] = F.smokeSize * (0.5 + Math.random() * 0.4) * (0.6 + strength * 0.4);
  }

  update(dt, renderer, camera) {
    const F = CONFIG.fx;
    this.material.uniforms.uColor.value.set(F.smokeColor);
    this.material.uniforms.uOpacity.value = F.smokeOpacity;
    const h = renderer.getDrawingBufferSize(_size).y;
    this.material.uniforms.uScale.value = h / (2 * Math.tan((camera.fov * Math.PI) / 360));
    const drag = Math.exp(-1.6 * dt);
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.alphaArr[i] = 0;
        this.sizeArr[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      const j = i * 3;
      this.v[j] *= drag;
      this.v[j + 2] *= drag;
      this.v[j + 1] = this.v[j + 1] * drag + 0.25 * dt;
      this.p[j] += this.v[j] * dt;
      this.p[j + 1] += this.v[j + 1] * dt;
      this.p[j + 2] += this.v[j + 2] * dt;
      this.sizeArr[i] = this.size0[i] * (1 + t * 1.8);
      this.alphaArr[i] = Math.min(1, t * 8) * (1 - t) * (1 - t);
    }
    this.posAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
  }
}

const _size = new THREE.Vector2();
