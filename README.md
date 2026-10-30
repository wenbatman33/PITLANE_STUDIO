# F1 RACE

F1 互動展示間 + 自由駕駛（Three.js + Vite）。

- 展示間：拖曳旋轉、滾輪縮放、點熱點看零件特寫（前翼、輪胎、Halo、側箱、動力單元、尾翼 DRS、底板）
- 賽道：真實 Monza 賽道（白色地面上只有賽道），單人計時練習：圈速、三分段、與最佳圈即時差距、出界照樣計時（另記含出界最佳圈，有效最佳圈只收沒出界的圈）、逆向警告、小地圖
- 駕駛：甩尾物理、胎痕與輪胎煙霧、四種鏡頭、Web Audio 合成引擎聲（AudioWorklet 逐次燃燒合成 1.6L V6 渦輪混合動力：點火頻率＝轉速/60×3、左右兩排汽缸差異產生的低音、排氣管共鳴、渦輪悶住高頻、升檔斷火、降檔補油；音色可在 DEV 工具「🔊 音效」調）
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
| 空白鍵 / ↓ | 煞車（像踏板一樣漸進） |
| X | 倒車（停住時） |
| A D / ← → | 轉向 |
| C | 切換鏡頭 |
| R | 重置 |
| M | 靜音 |
| P | 示範駕駛（看怎麼開） |
| L | 切換安全／最佳路線 |
| H | 再看一次教學 |
| Esc | 回展示間 |
| Enter | 展示間開始駕駛 |

## 賽道

展示間「開始駕駛」上方可選六條賽道（選擇會記住，切換時重新載入）：蒙扎 Monza、鈴鹿 Suzuka、匈牙利 Hungaroring、巴塞隆納 Catalunya、銀石 Silverstone、贊德沃特 Zandvoort。最佳圈依賽道分開記錄。鈴鹿是 8 字形，立體交叉處以平面呈現（不畫橋）。煞車看板：蒙扎為手動指定，其餘依建議路線中降速 80 km/h 以上的重煞區自動擺放。

測試腳本用 `TRACK` 選賽道：`TRACK=Suzuka node scripts/human-test.mjs standard 12`。

## 對手比賽

展示間上方切到「對手比賽」：4 台 AI 對手（冠軍、老手、中段、新秀，實力由快到慢）與你同場，五盞紅燈熄滅起跑，預設 3 圈。

- 車對車有碰撞：撞到車頭／車尾會被撞轉、擦撞會互相拖慢（`src/collision.js`）
- AI 會跟車、選邊超車（空間大的一邊或下一彎內側）、被逼近時防守一次、並排保持距離、進彎落後半個車身會讓；被撞出賽道會自己回到賽道（`src/opponents.js`）
- 左側名次表顯示名次與差距，小地圖上有對手位置；完賽後顯示成績與各車最快圈，Enter 再比一次
- 比賽中按 R 會把你放回賽道上（身後、離其他車夠遠的位置），不會重來整場；比賽中不提供示範駕駛
- 對手實力與碰撞參數在 `CONFIG.race`，DEV 面板「🏎️ 對手比賽」可即時調整

## 路緣石

壓到紅白路緣石時有隨車速變快的「噠噠」聲與細小震動（`CONFIG.audio.curb`、`CONFIG.camera.curbShake`，設 0 可關）。

## 部署

- Cloudflare Workers：`wrangler.jsonc` 指定先 `npm run build` 再上傳 `dist/`
- GitHub Pages：`.github/workflows/pages.yml` 推到 main 時自動 build 並發佈（repo 的 Settings → Pages → Source 需選「GitHub Actions」）

## 難度

| 模式 | 地上路線 | 自動煞車 | 轉向輔助 | ABS／循跡／車身穩定 |
| --- | --- | --- | --- | --- |
| 新手（預設） | ✓ | ✓ | ✓（A／D 在路線上左右偏） | ✓ |
| 標準 | ✓ | — | 循跡穩定 50%（自己轉向，遊戲幫你修一半） | ✓ |
| 專家 | ✓（預設最佳路線） | — | — | — |

專家模式關掉 ABS、循跡控制、車身穩定：鍵盤煞車按到底在中低速會鎖死（前輪鎖死就轉不了彎，要點放煞車），出彎油門太大後輪會空轉甩尾（空轉是漸進的，來得及收油反打）。按住方向鍵的打角仍依車速限制（等同方向盤靈敏度，不算駕駛輔助）。

### 安全路線／最佳路線（按 L 切換）

- **安全路線**（新手、標準預設）：往賽道中間收、速度保守，照著開比較不會出界
- **最佳路線**（專家預設）：TUMFTM 資料庫的最小曲率賽車線原樣顯示，外－內－外貼著賽道邊緣、速度與煞車點用 95% 極限計算，適合練最快圈速；模擬真人照著開每圈約有 1～2 次四輪出界，需要很精準

地上路線的顏色依你**目前的車速**即時變化（像 F1 遊戲的輔助線）：

- 紅：用現在的速度開到那裡會太快 → 車子底下是紅色就按住空白鍵，不紅了就放開（已提前約 0.35 秒，留給人的反應時間）
- 黃：接近極限速度 → 不要再加速
- 綠：還有餘裕 → 全油門

## 測試

```bash
node scripts/human-test.mjs standard 12      # 真人模式：12 位照教學玩的模擬玩家各跑 3 圈（方向鍵只按住／放開、反應 0.2~0.3 秒、看路線顏色煞車）
SEED=777 node scripts/human-test.mjs rookie  # 換一批玩家
TRACK_ID=suzuka node scripts/browser-human.mjs standard 2   # 真的 Chrome 打開遊戲（需 npm run dev），送出真實按鍵跑 2 圈；負載超過 20 自動停止
LINE=best TRACK=Suzuka node scripts/human-test.mjs standard  # 照「最佳路線」開
node scripts/brake-turn.mjs standard         # 60~300 km/h 邊煞車邊轉向：車尾會甩出幾度
node scripts/camera-jitter.mjs               # 全油門加速 14 秒：車子在畫面上的上下抖動（像素）
node scripts/lap-test.mjs demo               # 遊戲內示範駕駛
node scripts/engine-sound.mjs [舊版 audio.js]  # 真 Chrome 離線算出引擎聲 WAV（test-output/），量各段音量、頻譜重心、2–5 kHz 刺耳區比例；需 npm run dev
TRACK=Suzuka node scripts/race-test.mjs person standard   # 對手比賽整場模擬（碰撞、超車、出界、重生）
SOLO=冠軍 TRACK=Zandvoort node scripts/race-test.mjs idle  # 單獨測一台 AI
```

報表會列出圈速、四輪出界位置（車子中心超出柏油邊緣 1 公尺）、打轉次數、最大甩尾角與胎痕時間。

## DEV 微調工具

開發模式下按 `` ` `` 或右下角齒輪開啟：可直接拖曳 UI 元件與 3D 熱點，即時調整版面（PC / 手機）、鏡頭、物理、燈光、特效、音效，並可一鍵匯出數值到 `tuning/export.json`。

## 素材授權

- 賽車模型：[2026 | F1 Audi FOM Update](https://sketchfab.com/models/f2b3a61651b347ad8cd82d497bcb408e)，作者 sohyalebret，授權 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)。模型塗裝含 Audi、F1 等商標，商標權屬各權利人。
- `assets/source/f1-car.original.glb` 為上述模型的原始下載檔備份；`npm run optimize:model` 會由它產生壓縮版 `public/models/f1-car.glb`。
- 賽道資料：[TUMFTM racetrack-database](https://github.com/TUMFTM/racetrack-database)（LGPL-3.0），中心線源自 © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors；賽車線為該資料庫以「最小曲率」最佳化算出（不是最短圈速路線）。原始檔在 `assets/source/tracks/`：Monza、Suzuka、Budapest（Hungaroring）、Catalunya、Silverstone、Zandvoort，各有中心線 `*.csv` 與賽車線 `*_raceline.csv`。
- 其餘程式碼與程序化貼圖為本專案原創。找不到外部模型時，會自動改用程式建模的賽車。
