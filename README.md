# PITLANE STUDIO

F1 互動展示間 + 自由駕駛（Three.js + Vite）。

- 展示間：拖曳旋轉、滾輪縮放、點熱點看零件特寫（前翼、輪胎、Halo、側箱、動力單元、尾翼 DRS、底板）
- 駕駛：甩尾物理、胎痕與輪胎煙霧、甩尾計分、四種鏡頭、Web Audio 合成引擎聲
- 支援鍵盤、手把、手機觸控

## 開發

```bash
npm install
npm run dev
```

## 操作

| 按鍵 | 功能 |
| --- | --- |
| W / ↑ | 油門 |
| S / ↓ | 煞車／倒車 |
| A D / ← → | 轉向 |
| Space | 手煞車甩尾 |
| C | 切換鏡頭 |
| R | 重置 |
| M | 靜音 |
| Esc | 回展示間 |
| Enter | 展示間開始駕駛 |

## DEV 微調工具

開發模式下按 `` ` `` 或右下角齒輪開啟：可直接拖曳 UI 元件與 3D 熱點，即時調整版面（PC / 手機）、鏡頭、物理、燈光、特效、音效，並可一鍵匯出數值到 `tuning/export.json`。

## 素材授權

- 賽車模型：[2026 | F1 Audi FOM Update](https://sketchfab.com/models/f2b3a61651b347ad8cd82d497bcb408e)，作者 sohyalebret，授權 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)。模型塗裝含 Audi、F1 等商標，商標權屬各權利人。
- `assets/source/f1-car.original.glb` 為上述模型的原始下載檔備份。
- 其餘程式碼與程序化貼圖為本專案原創。找不到外部模型時，會自動改用程式建模的賽車。
