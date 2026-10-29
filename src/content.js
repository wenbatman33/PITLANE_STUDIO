// 展示間文案與塗裝預設

export const HOTSPOT_ORDER = ['frontWing', 'tyres', 'halo', 'sidepods', 'powerUnit', 'rearWing', 'floor'];

export const HOTSPOT_TEXT = {
  frontWing: {
    en: 'FRONT WING',
    title: '前翼',
    desc: '車頭第一個切開氣流的部件。多片可調翼片負責前輪下壓力，同時把亂流導離前輪、送往底板，直接決定轉向手感。',
    specs: [
      ['翼展', '約 1,900 mm'],
      ['翼片數', '主翼 + 3 片'],
    ],
  },
  tyres: {
    en: 'TYRES',
    title: '輪胎與輪圈',
    desc: '18 吋光頭胎完全沒有胎紋，靠升溫後的橡膠黏性抓地。側壁色環代表配方：紅色最軟、抓地最強但磨耗最快。',
    specs: [
      ['前胎寬', '305 mm'],
      ['後胎寬', '405 mm'],
    ],
  },
  halo: {
    en: 'HALO',
    title: 'Halo 座艙防護',
    desc: '包覆座艙的鈦合金防護環，能擋下飛散的輪胎與碎片。看似細瘦，卻能承受十幾噸的負載。',
    specs: [
      ['材質', '鈦合金'],
      ['重量', '約 7 kg'],
    ],
    action: { label: '從車手視角看', id: 'cockpitView' },
  },
  sidepods: {
    en: 'SIDEPODS',
    title: '側箱與散熱',
    desc: '側箱內塞滿散熱器，前方開口吸入冷空氣。外型同時要整理氣流、把空氣導向車尾，是各隊造型差異最大的地方。',
    specs: [
      ['作用', '散熱 + 導流'],
      ['開口', '前置進氣'],
    ],
  },
  powerUnit: {
    en: 'POWER UNIT',
    title: '動力單元',
    desc: '1.6 升 V6 渦輪增壓引擎，搭配從煞車與廢氣回收能量的混合動力系統，總輸出約 1,000 匹馬力。駕駛座上方的開口就是引擎進氣口。',
    specs: [
      ['引擎', '1.6L V6 Turbo'],
      ['轉速上限', '15,000 rpm'],
    ],
    action: { label: '▶ 發動並轟油門', id: 'rev' },
  },
  rearWing: {
    en: 'REAR WING · DRS',
    title: '尾翼與 DRS',
    desc: '尾翼提供後輪下壓力。直道上按下 DRS，上層翼片會掀開降低阻力，讓尾速多出 10 km/h 以上，是超車的關鍵。',
    specs: [
      ['DRS 開啟', '翼片掀開'],
      ['尾速增益', '+10~15 km/h'],
    ],
    action: { label: '切換 DRS', id: 'drs' },
  },
  floor: {
    en: 'FLOOR · GROUND EFFECT',
    title: '底板與地面效應',
    desc: '整片底板就是一支倒過來的翼。車底的文氏通道加速氣流、壓低壓力，把車子「吸」在地上，貢獻了大部分下壓力。',
    specs: [
      ['離地高度', '約 30 mm'],
      ['下壓力', '時速 250 約 2 倍車重'],
    ],
  },
};

export const LIVERIES = [
  { name: '烈焰紅', body: '#d3202f', accent: '#15171b', stripe: '#f5f5f2', helmet: '#ffd23f' },
  { name: '極光藍', body: '#1f4fd8', accent: '#0d1220', stripe: '#ffd23f', helmet: '#f5f5f2' },
  { name: '霓虹綠', body: '#12b76a', accent: '#111316', stripe: '#e9fbf1', helmet: '#111316' },
  { name: '午夜黑', body: '#1a1c21', accent: '#2c3038', stripe: '#ff4b2b', helmet: '#ff4b2b' },
  { name: '珍珠白', body: '#f1f1ee', accent: '#1b1d22', stripe: '#e10600', helmet: '#1f4fd8' },
];

// 難度：新手（路線＋自動煞車＋轉向輔助）、標準（路線＋自己煞車）、專家（全部關閉）
// 地上建議路線的兩種：安全（往中心收、速度保守）與最佳（原始最佳賽車線、速度用 95% 極限）
export const LINE_STYLES = {
  safe: { name: '安全路線', desc: '往賽道中間收、速度保守，比較不會出界', guide: {} },
  best: { name: '最佳路線', desc: '精確的最佳賽車線：外－內－外貼著賽道邊緣、速度接近極限，要很精準', guide: { lineBlend: 0, grip: 0.95, brakeGrip: 0.95 } },
};

export const LEVELS = {
  rookie: {
    name: '新手',
    desc: '地上有路線、自動煞車、自動沿路線轉向。按住 W 就能跑完一圈。',
    line: true,
    brakeAssist: true,
    steerAssist: true,
    tc: true,
    abs: true,
    esc: 1,
    keySteerAssist: true,
    tutorial: [
      ['W', '一路按住 W 踩油門就好'],
      ['路線', '地上的線：綠色＝加速、黃色＝彎中、紅色＝遊戲會自動幫你煞車'],
      ['A D', '車子會自己沿路線轉彎；想往左或右偏，就按 A 或 D'],
      ['P', '想看怎麼開？按 P 看示範駕駛'],
    ],
  },
  standard: {
    name: '標準',
    desc: '地上路線依你的車速變色，紅色就煞車；方向自己轉，循跡穩定輔助會幫你修正一半。',
    line: true,
    brakeAssist: false,
    steerAssist: false,
    lineKeep: 0.5, // 循跡穩定輔助強度（玩家仍需自己轉向，不轉會出界）
    tc: true,
    abs: true,
    esc: 1,
    keySteerAssist: true,
    tutorial: [
      ['W', '線是綠色就按住 W 全油門；變黃色＝快到極限，可以放開 W'],
      ['空白鍵', '車子底下的線變紅色＝按住空白鍵煞車，不紅了就放開（紅線會依你的車速提早出現）'],
      ['A D', '路線往哪邊彎就按住哪邊，車頭對準路線就放開；不用連點'],
      ['P', '不知道煞車點？按 P 看示範駕駛'],
    ],
  },
  expert: {
    name: '專家',
    desc: '地上是精確的最佳賽車線（貼著極限算）；沒有任何輔助，ABS／循跡控制／車身穩定全關。',
    line: true,
    lineStyle: 'best', // 預設顯示精確最佳賽車線（玩家可按 L 切換）
    brakeAssist: false,
    steerAssist: false,
    tc: false,
    abs: false,
    esc: 0,
    // 鍵盤轉向依車速限制打角（等同方向盤靈敏度，F1 遊戲用鍵盤／手把也都有），不算駕駛輔助
    keySteerAssist: true,
    tutorial: [
      ['!', '所有輔助已關閉：煞車會鎖死、出彎油門太大會甩尾'],
      ['路線', '地上是最佳賽車線：外－內－外貼著賽道邊緣走，紅色＝這個速度到那裡必須在煞車'],
      ['看板', '彎前的 150／100／50 看板是煞車參考點'],
    ],
  },
};
