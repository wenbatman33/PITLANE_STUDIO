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
