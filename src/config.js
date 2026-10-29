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
    driverHideNodes: '^hal[_-]', // 車手視角隱藏的節點：Halo 中柱（頂部橫桿屬於 safetycell，保留）
    helmet: { show: false, pos: [0, 0.86, 0.3], scale: 1 }, // 座艙裡的車手安全帽（程式建模的簡易版，預設關閉）
    creditText: '模型：2026 | F1 Audi FOM Update — sohyalebret（CC BY 4.0）· 賽道資料：TUMFTM / © OpenStreetMap contributors',
    creditUrl: 'https://sketchfab.com/models/f2b3a61651b347ad8cd82d497bcb408e',
  },

  // 真實賽道（資料：TUMFTM racetrack-database，源自 OpenStreetMap）
  track: {
    enabled: true,
    id: 'monza',
    widthScale: 1.25, // 資料寬度偏窄，放大到接近實際
    gridOffset: 14, // 第一格發車位在起跑線後方幾公尺
    gridLateral: 2.4, // 發車位左右偏移
    asphaltColor: '#5c5f65',
    edgeLineWidth: 0.25,
    curbRadius: 140, // 轉彎半徑小於此值的地方放路緣石
    curbExtend: 10, // 路緣石前後延伸公尺
    curbWidth: 1.2,
    curbStripe: 2, // 紅白一組的長度
    offGrip: 0.6, // 出界抓地倍率
    offDrag: 140, // 出界額外阻力
    offMargin: 0.4, // 超過路緣石外緣多少公尺算出界
  },

  // 對手比賽（AI 對手同場、有碰撞）
  race: {
    laps: 3,
    playerSlot: 2, // 玩家第幾格發車（0 = 竿位）
    // 對手：grip / brakeGrip / lineBlend 決定建議路線有多貼近極限（見 autopilot.js createGuide）
    //   exitThrottle：出彎給油積極度（越大越早全油門）；hue：車身塗裝色相偏移（度）
    opponents: [
      { name: '冠軍', hue: 270, grip: 0.93, brakeGrip: 0.95, lineBlend: 0.25, exitThrottle: 1.3, defend: 1 },
      { name: '老手', hue: 210, grip: 0.9, brakeGrip: 0.88, lineBlend: 0.3, exitThrottle: 1.35, defend: 0.8 },
      { name: '中段', hue: 120, grip: 0.84, brakeGrip: 0.8, lineBlend: 0.5, exitThrottle: 1.25, defend: 0.5 },
      { name: '新秀', hue: 50, grip: 0.78, brakeGrip: 0.74, lineBlend: 0.6, exitThrottle: 1.15, defend: 0.3 },
    ],
    followGap: 10, // AI 跟車距離 m
    sideGap: 2.7, // 並排時保持的側向距離 m（車寬約 2m）
    lightsInterval: 1, // 起跑紅燈每盞亮起間隔 s
    // 碰撞：車身用沿縱軸排列的圓近似（z：相對質心往前 m，r：半徑 m）
    hitCircles: [
      { z: -1.4, r: 1.0 },
      { z: 0.4, r: 1.0 },
      { z: 2.1, r: 0.95 },
    ],
    restitution: 0.25, // 碰撞反彈係數
    contactFriction: 0.35, // 擦撞摩擦
    spinFactor: 1, // 碰撞造成的轉動倍率
    hitShake: 0.03, // 玩家被撞時的鏡頭衝擊上限（0 = 關）
  },

  physics: {
    mass: 798,
    frontWeight: 0.45, // 前軸重量分配
    wheelbase: 3.6,
    cgHeight: 0.16, // 重心高度：越高煞車時重量越往前移、車尾越容易滑出
    powerKW: 700,
    maxDriveForce: 8400, // 低速最大驅動力，超過後輪抓地力就會打滑
    reverseForce: 3600,
    maxReverseSpeed: 9, // m/s
    brakeForce: 28000,
    brakeBias: 0.6, // 煞車力前軸比例（偏前 = 重煞時推頭而不是甩尾）
    brakeRampUp: 5, // 鍵盤煞車踩下速度（每秒；5 ≈ 0.2 秒踩到底）
    brakeRampDown: 10, // 放開煞車的速度
    dragCoef: 0.92,
    rollResist: 30,
    downforce: 4.0, // N / (m/s)^2（300 km/h 時約 3.5 倍車重，接近真實 F1）
    muFront: 1.9,
    muRear: 2.15,
    stiffFront: 24, // 輪胎側向剛性：越大越早出最大抓地（F1 約 4~6° 滑移角）
    stiffRear: 30,
    handbrakeGrip: 0.7, // 手煞車鎖死時後輪滑動摩擦比例
    spinBase: 1, // 空轉起始滑移速度 m/s（超出抓地越多越接近這個值）
    spinGain: 6, // 超出抓地力越多，空轉越快（沒有循跡控制時才會空轉）
    spinRise: 10, // 空轉上升速度 m/s²（越小越漸進，車手來得及收油；原本 70 會瞬間甩尾）
    spinBlend: 2.5, // 空轉多快時完全進入滑行狀態
    slipRefSpeed: 2.5, // 低速時側滑角計算的最低參考速度
    aeroFront: 0.36, // 下壓力前軸分配（偏後 = 極限時推頭、煞車進彎車尾穩定）
    // 駕駛輔助（賽道計時建議全開；DEV 可關閉體驗硬派手感）
    tractionControl: true, // 循跡控制：出彎不空轉
    abs: true, // 煞車不鎖死（含彎道 ABS：轉彎中自動收一點煞車，保留側向抓地）
    cornerBrakeMin: 0.4, // 彎道 ABS 至少保留的煞車比例
    steerGripRecover: 3, // 放開煞車後，鍵盤轉向上限恢復的速度（每秒）
    esc: 1, // 車身穩定強度（0 = 關）
    escThresholdDeg: 8, // 車尾滑出超過幾度才介入
    maxSteerDeg: 24,
    highSpeedSteerDeg: 9,
    steerRate: 3, // 低速時方向盤打角速度（每秒，1 = 打到底；太快真人按住會轉過頭）
    steerRateHigh: 2.5, // 高速時打角速度（下壓力壓在前輪，方向盤較重；低速較輕）
    steerAssist: true, // 轉向輔助：按住方向鍵＝最佳打角（鍵盤用）
    steerAssistGrip: 0.55, // 按住方向鍵用到多少抓地力（低一點：真人反應慢 0.25 秒也不會轉過頭；不夠的由循跡輔助補）
    steerAssistGripHigh: 0.55, // 高速時按住方向鍵用到多少抓地力（測過 0.7：贊德沃特較穩、鈴鹿較差，先與低速相同）
    steerAssistSlip: 1, // 輔助滑移角倍率（1 = 剛好達到該側向 G 所需的滑移角）
    steerAssistMaxG: 3.5, // 按住方向鍵最多拉幾 G（Monza 最快的彎約 3.3G）
    steerJerk: 0, // 鍵盤轉向（實驗）：按住時側向加速度每秒增加多少 m/s²；0 = 使用一般打角速度
    steerRateMinDeg: 0.6, // 鍵盤打角速度下限（°/s）
    steerRateMaxDeg: 70, // 鍵盤打角速度上限（°/s，低速時）
    steerReturnMul: 2.5, // 放開時回正比打角快幾倍
    steerReturn: 8, // 低速時放開或反打的回正速度（減速彎左右換方向要快）
    steerReturnHigh: 12, // 高速時回正速度（回正力矩大，方向盤被拉正）
    steerCurve: 1.7, // 轉向曲線（>1 小角度更細膩）
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
    speedShake: 0, // 高速鏡頭震動（0 = 關）
    skidShake: 0, // 打滑鏡頭震動（0 = 關）
    curbShake: 0.006, // 壓到路緣石時的鏡頭震動幅度 m（0 = 關）
    farDistScale: 1.9,
    farHeightScale: 2.2,
    defaultChaseMode: 2, // 開始駕駛時的鏡頭（0 追車、1 遠景、2 車手、3 空拍；玩家按 C 切換後會記住）
    driverCamHeight: 1.05, // 車手視角：眼睛離地高度 m（比真實車手略高：Halo 前段橫桿約 0.91，太低會橫在地平線上擋住遠方的路）
    driverCamForward: 0.45, // 車手視角：眼睛相對車身中心往前 m（方向盤後方）
    driverCamLookHeight: 0.4, // 車手視角：看向 40m 外的高度（越低越往下看）
    driverCamFov: 72,
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
    gridOpacity: 0,
    fogNear: 70,
    fogFar: 480,
    contactShadow: 0.55,
  },

  fx: {
    skidOpacity: 0.55,
    skidWidthScale: 0.9,
    skidThreshold: 0.8, // 超過抓地極限的滑動速度門檻 m/s（正常過彎不會有胎痕）
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
    curb: 0.5, // 壓到路緣石的噠噠聲
  },

  assist: {
    guideOpacity: 0.4, // 地上建議路線的透明度（越小越淡）
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
  difficulty: { anchor: 'b', x: 0, y: 112, scale: 1, fontSize: 14, color: '#15171b', opacity: 1 },
  trackPicker: { anchor: 'b', x: 0, y: 182, scale: 1, fontSize: 13, color: '#15171b', opacity: 1 },
  sessionPicker: { anchor: 'b', x: 0, y: 252, scale: 1, fontSize: 13, color: '#15171b', opacity: 1 },
  raceTower: { anchor: 'tl', x: 28, y: 200, scale: 1, fontSize: 14, color: '#15171b', opacity: 1 },
  startLights: { anchor: 't', x: 0, y: 120, scale: 1, fontSize: 14, color: '#ffffff', opacity: 1 },
  raceResult: { anchor: 'c', x: 0, y: 0, scale: 1, fontSize: 15, color: '#15171b', opacity: 1 },
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
  credit: { anchor: 'br', x: 52, y: 16, scale: 1, fontSize: 11, color: '#8a9099', opacity: 0.9 },
  lapTimer: { anchor: 'tl', x: 28, y: 22, scale: 1, fontSize: 14, color: '#15171b', opacity: 1 },
  minimap: { anchor: 'tr', x: 24, y: 72, scale: 1, fontSize: 14, color: '#15171b', opacity: 0.95 },
  trackWarning: { anchor: 't', x: 0, y: 72, scale: 1, fontSize: 18, color: '#e10600', opacity: 1 },
  keyViz: { anchor: 'b', x: 0, y: 32, scale: 1, fontSize: 14, color: '#ffffff', opacity: 1 },
  tutorial: { anchor: 'c', x: 0, y: -30, scale: 1, fontSize: 15, color: '#15171b', opacity: 1 },
};

export const LAYOUT_MOBILE = {
  brand: { anchor: 'tl', x: 16, y: 16, scale: 0.78, fontSize: 16, color: '#15171b', opacity: 1 },
  showroomHint: { anchor: 't', x: 0, y: 66, scale: 1, fontSize: 11, color: '#3b3f46', opacity: 0.9 },
  driveBtn: { anchor: 'b', x: 0, y: 24, scale: 0.88, fontSize: 16, color: '#ffffff', opacity: 1 },
  difficulty: { anchor: 'b', x: 0, y: 92, scale: 0.9, fontSize: 13, color: '#15171b', opacity: 1 },
  trackPicker: { anchor: 'b', x: 0, y: 156, scale: 0.85, fontSize: 13, color: '#15171b', opacity: 1 },
  sessionPicker: { anchor: 'b', x: 0, y: 226, scale: 0.85, fontSize: 13, color: '#15171b', opacity: 1 },
  raceTower: { anchor: 'tl', x: 10, y: 150, scale: 0.6, fontSize: 14, color: '#15171b', opacity: 1 },
  startLights: { anchor: 't', x: 0, y: 110, scale: 0.7, fontSize: 14, color: '#ffffff', opacity: 1 },
  raceResult: { anchor: 'c', x: 0, y: 0, scale: 0.85, fontSize: 15, color: '#15171b', opacity: 1 },
  liveryBar: { anchor: 'b', x: 0, y: 96, scale: 0.85, fontSize: 12, color: '#15171b', opacity: 1 },
  infoPanel: { anchor: 'b', x: 0, y: 12, scale: 1, fontSize: 12.5, color: '#15171b', opacity: 1 },
  shiftLights: { anchor: 't', x: 0, y: 58, scale: 0.55, fontSize: 14, color: '#ffffff', opacity: 0 },
  driftMeter: { anchor: 't', x: 0, y: 80, scale: 0.7, fontSize: 16, color: '#15171b', opacity: 1 },
  speedo: { anchor: 'tl', x: 10, y: 10, scale: 0.55, fontSize: 16, color: '#15171b', opacity: 1 },
  driveHint: { anchor: 'bl', x: 16, y: 16, scale: 0.8, fontSize: 12, color: '#3b3f46', opacity: 0 },
  driveBar: { anchor: 'tr', x: 10, y: 10, scale: 1, fontSize: 12, color: '#15171b', opacity: 1 },
  touchSteer: { anchor: 'bl', x: 14, y: 22, scale: 0.92, fontSize: 14, color: '#15171b', opacity: 0.95 },
  touchGas: { anchor: 'br', x: 14, y: 22, scale: 0.92, fontSize: 14, color: '#ffffff', opacity: 0.95 },
  touchBrake: { anchor: 'br', x: 104, y: 22, scale: 0.92, fontSize: 14, color: '#ffffff', opacity: 0.95 },
  credit: { anchor: 'b', x: 0, y: 6, scale: 1, fontSize: 9, color: '#8a9099', opacity: 0.85 },
  lapTimer: { anchor: 't', x: 0, y: 60, scale: 0.62, fontSize: 14, color: '#15171b', opacity: 1 },
  minimap: { anchor: 'tr', x: 10, y: 60, scale: 0.5, fontSize: 14, color: '#15171b', opacity: 0.95 },
  trackWarning: { anchor: 't', x: 0, y: 160, scale: 0.8, fontSize: 18, color: '#e10600', opacity: 1 },
  keyViz: { anchor: 'c', x: 0, y: 120, scale: 0.85, fontSize: 14, color: '#ffffff', opacity: 1 },
  tutorial: { anchor: 'c', x: 0, y: 0, scale: 0.85, fontSize: 14, color: '#15171b', opacity: 1 },
};
