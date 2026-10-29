// 程序化 canvas 貼圖：不需要任何外部圖檔
import * as THREE from 'three';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function tex(c, { flipY = false, repeat = null, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.flipY = flipY;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

const FONT = '"Chakra Petch", "Noto Sans TC", sans-serif';

// 主車身塗裝：u = 繞斷面一圈（0 底、0.25 左側、0.5 頂、0.75 右側），v = 車頭到車尾
export function createBodyLivery() {
  const [c, g] = canvas(1024, 1024);
  const texture = tex(c);
  const W = 1024;
  const H = 1024;
  // 座艙開口對應的 v 範圍（由 car.js 依車身長度算出）
  const cockpit = { v0: 0.383, v1: 0.513 };

  function paint({ bodyColor, accentColor, stripeColor }) {
    g.fillStyle = bodyColor;
    g.fillRect(0, 0, W, H);

    // 下半部碳纖維黑，往車尾逐漸變高
    g.fillStyle = accentColor;
    for (const mirror of [false, true]) {
      g.beginPath();
      const u = (x) => (mirror ? W - x * W : x * W);
      g.moveTo(u(0), 0);
      g.lineTo(u(0.17), 0);
      g.bezierCurveTo(u(0.2), H * 0.35, u(0.22), H * 0.55, u(0.27), H * 0.7);
      g.lineTo(u(0.31), H);
      g.lineTo(u(0), H);
      g.closePath();
      g.fill();
    }

    // 頂部中央飾條與車鼻箭頭
    g.fillStyle = stripeColor;
    g.fillRect(W * 0.485, 0, W * 0.03, H * cockpit.v0 - 6);
    g.fillRect(W * 0.485, H * cockpit.v1 + 40, W * 0.03, H);
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(W * (0.5 + s * 0.035), H * 0.04);
      g.lineTo(W * (0.5 + s * 0.12), H * 0.3);
      g.lineTo(W * (0.5 + s * 0.105), H * 0.3);
      g.lineTo(W * (0.5 + s * 0.022), H * 0.07);
      g.closePath();
      g.fill();
    }
    // 側面細飾線
    g.fillRect(W * 0.31, H * 0.6, W * 0.012, H * 0.4);
    g.fillRect(W * 0.678, H * 0.6, W * 0.012, H * 0.4);

    // 座艙開口
    const cx = W * 0.5;
    const cy = H * ((cockpit.v0 + cockpit.v1) / 2);
    const rx = W * 0.11;
    const ry = (H * (cockpit.v1 - cockpit.v0)) / 2;
    g.fillStyle = '#9aa0a8';
    roundRect(g, cx - rx - 5, cy - ry - 5, (rx + 5) * 2, (ry + 5) * 2, 60);
    g.fillStyle = '#060708';
    roundRect(g, cx - rx, cy - ry, rx * 2, ry * 2, 55);

    texture.needsUpdate = true;
  }

  return { texture, paint, cockpit };
}

// 側箱塗裝：外側印上品牌字
export function createPodLivery() {
  const [c, g] = canvas(1024, 512);
  const texture = tex(c);
  const W = 1024;
  const H = 512;
  function paint({ bodyColor, accentColor, stripeColor }) {
    g.fillStyle = bodyColor;
    g.fillRect(0, 0, W, H);
    g.fillStyle = accentColor;
    g.fillRect(0, 0, W * 0.2, H);
    g.fillRect(W * 0.8, 0, W * 0.2, H);
    g.fillStyle = stripeColor;
    g.fillRect(W * 0.2, 0, W * 0.014, H);
    g.fillRect(W * 0.786, 0, W * 0.014, H);

    g.font = `700 64px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // 左側箱外側（u≈0.33）文字沿 +v；右側箱外側（u≈0.67）沿 -v
    for (const [u, rot] of [
      [0.32, Math.PI / 2],
      [0.68, -Math.PI / 2],
    ]) {
      g.save();
      g.translate(W * u, H * 0.38);
      g.rotate(rot);
      g.scale(1, 0.85);
      g.fillStyle = stripeColor;
      g.fillText('PITLANE', 0, 0);
      g.restore();
    }
    texture.needsUpdate = true;
  }
  return { texture, paint };
}

// 輪胎：側壁配方色環 + 白字，旋轉時看得出來
export function createTyreTexture() {
  const [c, g] = canvas(1024, 128);
  const texture = tex(c);
  function paint(compoundColor) {
    g.fillStyle = '#141416';
    g.fillRect(0, 0, 1024, 128);
    // 胎面略亮一點
    g.fillStyle = '#1b1b1e';
    g.fillRect(0, 128 * 0.3, 1024, 128 * 0.4);
    g.fillStyle = compoundColor;
    g.fillRect(0, 128 * 0.045, 1024, 128 * 0.035);
    g.fillRect(0, 128 * 0.92, 1024, 128 * 0.035);
    g.fillStyle = '#e8e8e8';
    g.font = `700 11px ${FONT}`;
    g.textBaseline = 'middle';
    for (let i = 0; i < 4; i++) {
      g.fillText('PITLANE  SLICK', i * 256 + 40, 128 * 0.12);
      g.fillText('PITLANE  SLICK', i * 256 + 168, 128 * 0.88);
    }
    texture.needsUpdate = true;
  }
  return { texture, paint };
}

// 輪圈：雙輻條 + 中央螺帽
export function createRimTexture() {
  const [c, g] = canvas(512, 512);
  const texture = tex(c);
  function paint(rimColor, nutColor) {
    g.clearRect(0, 0, 512, 512);
    g.save();
    g.translate(256, 256);
    g.fillStyle = '#0d0e10';
    g.beginPath();
    g.arc(0, 0, 256, 0, Math.PI * 2);
    g.fill();
    // 外圈輪緣
    g.strokeStyle = rimColor;
    g.lineWidth = 22;
    g.beginPath();
    g.arc(0, 0, 240, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(0, 0, 228, 0, Math.PI * 2);
    g.stroke();
    // 輻條
    g.fillStyle = rimColor;
    for (let i = 0; i < 5; i++) {
      g.save();
      g.rotate((i / 5) * Math.PI * 2);
      for (const off of [-16, 16]) {
        g.beginPath();
        g.moveTo(off * 0.5, 40);
        g.lineTo(off * 1.9 - 7, 232);
        g.lineTo(off * 1.9 + 7, 232);
        g.lineTo(off * 0.5 + (off > 0 ? 9 : -9), 40);
        g.closePath();
        g.fill();
      }
      g.restore();
    }
    g.beginPath();
    g.arc(0, 0, 58, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = nutColor;
    g.beginPath();
    g.arc(0, 0, 30, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#111';
    g.beginPath();
    g.arc(0, 0, 10, 0, Math.PI * 2);
    g.fill();
    g.restore();
    texture.needsUpdate = true;
  }
  return { texture, paint };
}

// 碳纖維編織
export function createCarbonTexture() {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#1a1c20';
  g.fillRect(0, 0, 128, 128);
  const s = 16;
  for (let y = 0; y < 128; y += s) {
    for (let x = 0; x < 128; x += s) {
      const odd = ((x + y) / s) % 2 === 0;
      const grad = odd ? g.createLinearGradient(x, y, x + s, y) : g.createLinearGradient(x, y, x, y + s);
      grad.addColorStop(0, '#16181b');
      grad.addColorStop(0.5, '#2c3036');
      grad.addColorStop(1, '#16181b');
      g.fillStyle = grad;
      g.fillRect(x + 1, y + 1, s - 2, s - 2);
    }
  }
  return tex(c, { repeat: [6, 6] });
}

// 地面格線：一張貼圖代表 20m × 20m
export function createGroundTexture() {
  const [c, g] = canvas(1024, 1024);
  const texture = tex(c, { repeat: [1, 1] });
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  function paint(opacity) {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 1024, 1024);
    const step = 1024 / 10;
    for (let i = 0; i <= 10; i++) {
      const major = i % 5 === 0;
      g.fillStyle = `rgba(40,46,56,${opacity * (major ? 1 : 0.45)})`;
      const w = major ? 4 : 2;
      g.fillRect(i * step - w / 2, 0, w, 1024);
      g.fillRect(0, i * step - w / 2, 1024, w);
    }
    // 格線交點小十字
    g.fillStyle = `rgba(40,46,56,${opacity * 1.2})`;
    for (let i = 0; i <= 10; i += 5) {
      for (let j = 0; j <= 10; j += 5) {
        g.fillRect(i * step - 14, j * step - 2, 28, 4);
        g.fillRect(i * step - 2, j * step - 14, 4, 28);
      }
    }
    texture.needsUpdate = true;
  }
  return { texture, paint };
}

// 展示間地面標誌（轉盤圓環 + 文字）
export function createFloorMarkTexture() {
  const [c, g] = canvas(1024, 1024);
  g.translate(512, 512);
  g.strokeStyle = 'rgba(21,23,27,0.55)';
  g.lineWidth = 6;
  g.beginPath();
  g.arc(0, 0, 480, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 2;
  g.beginPath();
  g.arc(0, 0, 452, 0, Math.PI * 2);
  g.stroke();
  for (let i = 0; i < 120; i++) {
    const a = (i / 120) * Math.PI * 2;
    const long = i % 10 === 0;
    g.lineWidth = long ? 4 : 2;
    g.beginPath();
    g.moveTo(Math.cos(a) * 452, Math.sin(a) * 452);
    g.lineTo(Math.cos(a) * (long ? 420 : 436), Math.sin(a) * (long ? 420 : 436));
    g.stroke();
  }
  g.fillStyle = 'rgba(21,23,27,0.6)';
  g.font = `700 34px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const label = 'PITLANE STUDIO  ·  BOX 07  ·  ';
  const chars = (label + label).split('');
  chars.forEach((ch, i) => {
    g.save();
    g.rotate((i / chars.length) * Math.PI * 2);
    g.fillText(ch, 0, -385);
    g.restore();
  });
  g.fillStyle = 'rgba(225,6,0,0.75)';
  g.fillRect(-460, -3, 40, 6);
  g.fillRect(420, -3, 40, 6);
  return tex(c);
}

// 車底接觸陰影
export function createContactShadowTexture() {
  const [c, g] = canvas(256, 256);
  const grad = g.createRadialGradient(128, 128, 10, 128, 128, 128);
  grad.addColorStop(0, 'rgba(0,0,0,0.85)');
  grad.addColorStop(0.45, 'rgba(0,0,0,0.5)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  return tex(c, { srgb: false });
}

// 數字／文字貼紙
export function createDecalTexture(text, { w = 512, h = 256, color = '#ffffff', size = 180, stroke = null } = {}) {
  const [c, g] = canvas(w, h);
  const texture = tex(c, { flipY: true });
  function paint(fill = color, strokeColor = stroke) {
    g.clearRect(0, 0, w, h);
    g.font = `700 ${size}px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (strokeColor) {
      g.lineWidth = size * 0.08;
      g.strokeStyle = strokeColor;
      g.strokeText(text, w / 2, h / 2 + size * 0.05);
    }
    g.fillStyle = fill;
    g.fillText(text, w / 2, h / 2 + size * 0.05);
    texture.needsUpdate = true;
  }
  paint();
  return { texture, paint };
}

// 三角錐：橘色 + 白色反光環
export function createConeTexture() {
  const [c, g] = canvas(64, 256);
  g.fillStyle = '#ff5a1f';
  g.fillRect(0, 0, 64, 256);
  g.fillStyle = '#f4f4f4';
  g.fillRect(0, 256 * 0.32, 64, 256 * 0.16);
  g.fillRect(0, 256 * 0.62, 64, 256 * 0.08);
  return tex(c, { flipY: true });
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
  g.fill();
}
