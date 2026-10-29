// 共用數學工具

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
// 與幀率無關的平滑追隨係數
export const damp = (rate, dt) => 1 - Math.exp(-rate * dt);
export const DEG = Math.PI / 180;

export const EASES = {
  linear: (t) => t,
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
  easeInOutQuint: (t) => (t < 0.5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2),
  easeOutExpo: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  easeInOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  easeOutBack: (t) => {
    const c1 = 1.4;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
};

export function storageGet(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function storageSet(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 隱私模式等情況下寫不進去就算了 */
  }
}

// 深層覆寫（只覆寫 target 已存在的鍵，避免舊存檔塞進奇怪欄位）
export function deepAssign(target, source) {
  if (!source || typeof source !== 'object') return target;
  for (const key of Object.keys(source)) {
    if (!(key in target)) continue;
    const sv = source[key];
    const tv = target[key];
    if (Array.isArray(tv) && Array.isArray(sv)) {
      for (let i = 0; i < tv.length && i < sv.length; i++) tv[i] = sv[i];
    } else if (tv && typeof tv === 'object' && sv && typeof sv === 'object') {
      deepAssign(tv, sv);
    } else if (typeof tv === typeof sv) {
      target[key] = sv;
    }
  }
  return target;
}
