// 所有可微調數值集中於此；DEV 工具（` 鍵或右下角齒輪）會即時修改這些物件
// 匯出後由 Claude 把數值 baked 回這個檔案

export const CONFIG = {
  car: {
    bodyColor: '#d3202f',
    accentColor: '#15171b',
    stripeColor: '#f5f5f2',
    helmetColor: '#ffd23f',
    rimColor: '#2b2e33',
    compoundColor: '#e8322f',
    paintRoughness: 0.3,
    paintMetalness: 0.25,
    clearcoat: 1,
  },

  // 外部高精度模型（放在 public/models/）；檔案不存在時自動改用程式建模的車
  model: {
    url: 'models/f1-car.glb',
    rotY: 'auto', // 'auto' 或 0 / 90 / 180 / 270
    length: 5.5, // 縮放到的車長（公尺）
    scaleAdjust: 1,
    yOffset: 0,
    zOffset: 0,
    paintMaterial: '', // 要套用塗裝主色的材質名稱，逗號分隔
    hideNodes: '^(RIM_BLUR_|COCKPIT_LR$|CINTURE_ON$)', // 載入時移除的節點（正規表示式）：動態模糊輪圈、低精度座艙等重複版本
    drsNodes: '^(rearwingmoving_top_001|rearwingmoving_top-1)$', // DRS 活動翼片節點
    helmet: { show: false, pos: [0, 0.86, 0.3], scale: 1 }, // 座艙裡的車手安全帽（程式建模的簡易版，預設關閉）
    creditText: '模型：2026 | F1 Audi FOM Update — sohyalebret（CC BY 4.0）',
    creditUrl: 'https://sketchfab.com/models/f2b3a61651b347ad8cd82d497bcb408e',
  },

  physics: {
    mass: 798,
    frontWeight: 0.45, // 前軸重量分配
    wheelbase: 3.6,
    cgHeight: 0.28,
    powerKW: 700,
    maxDriveForce: 8400, // 低速最大驅動力，超過後輪抓地力就會打滑
    reverseForce: 3600,
    maxReverseSpeed: 9, // m/s
    brakeForce: 28000,
    dragCoef: 0.92,
    rollResist: 30,
    downforce: 2.6, // N / (m/s)^2
    muFront: 1.75,
    muRear: 1.8,
    stiffFront: 9,
    stiffRear: 10,
    handbrakeGrip: 0.7, // 手煞車鎖死時後輪滑動摩擦比例
    spinBase: 3, // 一開始空轉的基本滑移速度 m/s
    spinGain: 18, // 超出抓地力越多，空轉越快
    spinBlend: 2.5, // 空轉多快時完全進入滑行狀態
    slipRefSpeed: 2.5, // 低速時側滑角計算的最低參考速度
    tractionControl: false,
    maxSteerDeg: 24,
    highSpeedSteerDeg: 6,
    steerRate: 3.6, // 方向盤打角速度（每秒）
    steerReturn: 6,
    inertiaScale: 0.55,
    yawDamping: 0.6,
    lowSpeedBlendStart: 1.5,
    lowSpeedBlendEnd: 5,
    autoShiftUp: 11800,
    autoShiftDown: 7200,
  },

  camera: {
    showroomFov: 32,
    showroomPos: [6.4, 2.2, 6.9],
    showroomTarget: [0, 0.42, 0],
    introFrom: [16, 7.5, -14],
    minDist: 3.4,
    maxDist: 14,
    maxPolarDeg: 86,
    autoRotateSpeed: 0.55,
    chaseDist: 6.4,
    chaseHeight: 1.85,
    chaseLookHeight: 0.75,
    chaseLookAhead: 3.2,
    chaseStiffness: 6,
    chaseSlipFollow: 0.55, // 甩尾時鏡頭跟隨速度方向的比例
    chaseFov: 58,
    chaseFovSpeedGain: 16,
    farDistScale: 1.9,
    farHeightScale: 2.2,
    tcamHeight: 1.12,
    tcamForward: -0.35,
    heliHeight: 26,
  },

  lighting: {
    exposure: 1.0,
    envIntensity: 0.85,
    sunIntensity: 2.4,
    sunAzimuth: 38,
    sunElevation: 60,
    hemiIntensity: 0.6,
    background: '#eef0f2',
    floorColor: '#f4f5f7',
    gridOpacity: 0.22,
    fogNear: 45,
    fogFar: 230,
    contactShadow: 0.55,
  },

  fx: {
    skidOpacity: 0.55,
    skidWidthScale: 0.9,
    skidThreshold: 2.4, // 側滑速度門檻 m/s
    smokeAmount: 0.7,
    smokeSize: 1.3,
    smokeLife: 1.4,
    smokeColor: '#d3d6db',
    smokeOpacity: 0.26,
  },

  audio: {
    master: 0.55,
    engine: 0.8,
    screech: 0.4,
    turbo: 0.25,
  },

  anim: {
    tweenDuration: 1.5,
    tweenEase: 'easeInOutCubic',
    introDuration: 2.8,
    fadeTime: 0.45,
    hotspotPulse: 1.6,
    idleAutoRotate: 6, // 閒置幾秒後自動旋轉
    drsAngleDeg: 38,
  },

  // 熱點：anchor 為車身座標；camPos / camTarget 為展示間鏡頭預設位置（車在原點）
  hotspots: {
    frontWing: { anchor: [0.55, 0.3, 2.6], camPos: [3.0, 1.0, 4.8], camTarget: [0.3, 0.25, 2.5] },
    tyres: { anchor: [1.03, 0.52, 1.8], camPos: [3.6, 0.75, 2.6], camTarget: [0.8, 0.36, 1.8] },
    halo: { anchor: [0, 0.97, 0.62], camPos: [1.9, 2.05, 2.8], camTarget: [0, 0.8, 0.4] },
    sidepods: { anchor: [0.66, 0.62, 0.2], camPos: [3.4, 1.3, 1.5], camTarget: [0.45, 0.45, -0.2] },
    powerUnit: { anchor: [0, 1.08, -0.45], camPos: [-2.6, 2.0, -0.6], camTarget: [0, 0.75, -0.8] },
    rearWing: { anchor: [0.35, 1.03, -2.15], camPos: [-2.8, 1.8, -4.9], camTarget: [0, 0.8, -2.0] },
    floor: { anchor: [0.82, 0.14, -0.6], camPos: [3.7, 0.4, -1.4], camTarget: [0.4, 0.15, -0.5] },
  },
};

// UI 版面：anchor 為對齊角落（tl/t/tr/l/c/r/bl/b/br），x/y 為距離該角落的像素
export const LAYOUT_PC = {
  brand: { anchor: 'tl', x: 32, y: 28, scale: 1, fontSize: 16, color: '#15171b', opacity: 1 },
  showroomHint: { anchor: 't', x: 0, y: 32, scale: 1, fontSize: 13, color: '#3b3f46', opacity: 0.9 },
  driveBtn: { anchor: 'b', x: 0, y: 40, scale: 1, fontSize: 16, color: '#ffffff', opacity: 1 },
  liveryBar: { anchor: 'bl', x: 32, y: 44, scale: 1, fontSize: 12, color: '#15171b', opacity: 1 },
  infoPanel: { anchor: 'r', x: 32, y: 0, scale: 1, fontSize: 14, color: '#15171b', opacity: 1 },
  shiftLights: { anchor: 't', x: 0, y: 20, scale: 1, fontSize: 14, color: '#ffffff', opacity: 1 },
  driftMeter: { anchor: 't', x: 0, y: 66, scale: 1, fontSize: 16, color: '#15171b', opacity: 1 },
  speedo: { anchor: 'br', x: 32, y: 32, scale: 1, fontSize: 16, color: '#15171b', opacity: 1 },
  driveHint: { anchor: 'bl', x: 32, y: 32, scale: 1, fontSize: 12, color: '#3b3f46', opacity: 0.95 },
  driveBar: { anchor: 'tr', x: 24, y: 20, scale: 1, fontSize: 13, color: '#15171b', opacity: 1 },
  touchSteer: { anchor: 'bl', x: 28, y: 32, scale: 1, fontSize: 14, color: '#15171b', opacity: 0.95 },
  touchGas: { anchor: 'br', x: 28, y: 32, scale: 1, fontSize: 14, color: '#ffffff', opacity: 0.95 },
  touchBrake: { anchor: 'br', x: 130, y: 32, scale: 1, fontSize: 14, color: '#ffffff', opacity: 0.95 },
  touchDrift: { anchor: 'br', x: 130, y: 132, scale: 1, fontSize: 14, color: '#ffffff', opacity: 0.95 },
  credit: { anchor: 'br', x: 52, y: 16, scale: 1, fontSize: 11, color: '#8a9099', opacity: 0.9 },
};

export const LAYOUT_MOBILE = {
  brand: { anchor: 'tl', x: 16, y: 16, scale: 0.78, fontSize: 16, color: '#15171b', opacity: 1 },
  showroomHint: { anchor: 't', x: 0, y: 66, scale: 1, fontSize: 11, color: '#3b3f46', opacity: 0.9 },
  driveBtn: { anchor: 'b', x: 0, y: 24, scale: 0.88, fontSize: 16, color: '#ffffff', opacity: 1 },
  liveryBar: { anchor: 'b', x: 0, y: 96, scale: 0.85, fontSize: 12, color: '#15171b', opacity: 1 },
  infoPanel: { anchor: 'b', x: 0, y: 12, scale: 1, fontSize: 12.5, color: '#15171b', opacity: 1 },
  shiftLights: { anchor: 't', x: 0, y: 58, scale: 0.55, fontSize: 14, color: '#ffffff', opacity: 1 },
  driftMeter: { anchor: 't', x: 0, y: 80, scale: 0.7, fontSize: 16, color: '#15171b', opacity: 1 },
  speedo: { anchor: 'tl', x: 10, y: 10, scale: 0.55, fontSize: 16, color: '#15171b', opacity: 1 },
  driveHint: { anchor: 'bl', x: 16, y: 16, scale: 0.8, fontSize: 12, color: '#3b3f46', opacity: 0 },
  driveBar: { anchor: 'tr', x: 10, y: 10, scale: 1, fontSize: 12, color: '#15171b', opacity: 1 },
  touchSteer: { anchor: 'bl', x: 14, y: 22, scale: 0.92, fontSize: 14, color: '#15171b', opacity: 0.95 },
  touchGas: { anchor: 'br', x: 14, y: 22, scale: 0.92, fontSize: 14, color: '#ffffff', opacity: 0.95 },
  touchBrake: { anchor: 'br', x: 104, y: 22, scale: 0.92, fontSize: 14, color: '#ffffff', opacity: 0.95 },
  touchDrift: { anchor: 'br', x: 14, y: 150, scale: 0.92, fontSize: 14, color: '#ffffff', opacity: 0.95 },
  credit: { anchor: 'b', x: 0, y: 6, scale: 1, fontSize: 9, color: '#8a9099', opacity: 0.85 },
};
