// DEV 微調值的暫存：只記錄「跟原始碼預設不同」的欄位，連同當時的預設值一起存
// 載入時若原始碼預設已經被改過（例如已 baked），該欄位的舊暫存值會自動失效
import { CONFIG, LAYOUT_PC, LAYOUT_MOBILE } from './config.js';
import { storageGet, storageSet } from './util.js';

export const OVERRIDE_KEY = 'pitlane.dev.overrides.v1';
const roots = () => ({ CONFIG, LAYOUT_PC, LAYOUT_MOBILE });

export function snapshot() {
  return JSON.parse(JSON.stringify(roots()));
}

// 模組載入時的值就是原始碼預設
export const DEFAULTS = snapshot();

function leaves(obj, path = [], out = []) {
  if (obj && typeof obj === 'object') {
    for (const k of Object.keys(obj)) leaves(obj[k], [...path, k], out);
  } else {
    out.push([path, obj]);
  }
  return out;
}

function getPath(obj, path) {
  return path.reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setPath(obj, path, value) {
  const parent = getPath(obj, path.slice(0, -1));
  if (parent && path[path.length - 1] in parent) parent[path[path.length - 1]] = value;
}

// 目前值與預設值的差異清單
export function diff() {
  const now = snapshot();
  return leaves(DEFAULTS)
    .map(([path, base]) => ({ path, base, value: getPath(now, path) }))
    .filter((d) => d.value !== d.base);
}

export function loadOverrides() {
  const saved = storageGet(OVERRIDE_KEY);
  if (!Array.isArray(saved)) return 0;
  const r = roots();
  let applied = 0;
  for (const d of saved) {
    if (!Array.isArray(d.path)) continue;
    if (getPath(DEFAULTS, d.path) !== d.base) continue;
    setPath(r, d.path, d.value);
    applied++;
  }
  return applied;
}

export function saveOverrides() {
  const d = diff();
  storageSet(OVERRIDE_KEY, d.length ? d : null);
  return d.length;
}

export function clearOverrides() {
  storageSet(OVERRIDE_KEY, null);
  const r = roots();
  for (const [path, base] of leaves(DEFAULTS)) setPath(r, path, base);
}
