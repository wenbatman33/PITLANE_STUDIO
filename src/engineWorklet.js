// AudioWorklet：F1 1.6L V6 渦輪混合動力引擎聲
// 做法：每一次燃燒產生一個排氣脈衝 → 排氣管共鳴 → 渦輪把高頻悶掉
//   V6 四行程：曲軸轉 2 圈＝一個循環，6 缸各點火一次（每 120° 一次）→ 點火頻率＝轉速/60×3
//   每次燃燒的力道有些微隨機、各缸音量也略有差異 → 聽起來是引擎，而不是固定的電子蜂鳴
//   V 型左右兩排汽缸輪流點火，兩排排氣到渦輪的管長不同 → 兩排脈衝力道、寬度不一樣
//   → 出現「點火頻率一半」與「循環頻率」的低音（每排自己每 240° 才點火一次），聲音才渾厚，不會只剩一個高音
// 這個檔案由瀏覽器單獨載入，不能 import 其他模組；scripts/engine-sound.mjs 也直接用它離線算聲音

const CYL = 6;
// 各缸排氣歧管長度不同造成的些微音量差
const CYL_GAIN = [1, 0.96, 1.03, 0.98, 1.02, 0.95];
const TAU = Math.PI * 2;

export const ENGINE_PARAMS = [
  { name: 'rpm', defaultValue: 4200, minValue: 0, maxValue: 20000 },
  { name: 'load', defaultValue: 0, minValue: 0, maxValue: 1 }, // 油門（燃燒力道）
  { name: 'cut', defaultValue: 0, minValue: 0, maxValue: 1 }, // 換檔瞬間斷火
  { name: 'bright', defaultValue: 1.2, minValue: 0.2, maxValue: 3 }, // 音色亮度（低通頻率倍率）
  { name: 'rasp', defaultValue: 0.4, minValue: 0, maxValue: 2 }, // 粗糙顆粒感
  { name: 'resonance', defaultValue: 0.6, minValue: 0, maxValue: 0.95 }, // 排氣管共鳴
  { name: 'jitter', defaultValue: 1, minValue: 0, maxValue: 3 }, // 燃燒不規則程度
  { name: 'body', defaultValue: 1.2, minValue: 0, maxValue: 2 }, // 渾厚度（兩排汽缸差異 → 低音）
];

export class EngineSynth {
  constructor(sr, seed = 1) {
    this.sr = sr;
    this.seed = seed >>> 0 || 1;
    this.phase = 0; // 0..1＝一個完整四行程循環
    this.prevA = new Float32Array(CYL).fill(1);
    this.amp = new Float32Array(CYL);
    this.rpm = 4200;
    this.load = 0;
    this.cut = 0;
    // 排氣管：尾管（長）與歧管（短）兩段延遲回授
    this.bufLen = Math.ceil(sr * 0.01);
    this.buf1 = new Float32Array(this.bufLen);
    this.buf2 = new Float32Array(this.bufLen);
    this.w = 0;
    this.d1 = Math.round(sr * 0.0026);
    this.d2 = Math.round(sr * 0.0011);
    this.damp1 = 0;
    this.damp2 = 0;
    // 直流隔離、兩段低通、粗糙噪音的帶通
    this.dcX = 0;
    this.dcY = 0;
    this.lp1 = 0;
    this.lp2 = 0;
    this.bpLow = 0;
    this.bpBand = 0;
  }

  rand() {
    // xorshift：可重現的亂數（離線測試每次結果一樣）
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x >>> 0;
    return this.seed / 4294967296;
  }

  // out：Float32Array；p：{ rpm, load, cut, bright, rasp, resonance, jitter }
  render(out, p) {
    const n = out.length;
    const sr = this.sr;
    const rpm0 = this.rpm;
    const load0 = this.load;
    const cut0 = this.cut;
    const res = p.resonance;
    const g1 = -0.55 * res; // 開口端反射：相位反轉
    const g2 = 0.3 * res;
    // 粗糙噪音帶通（中心約 900 Hz；太高會像吸塵器的嘶嘶聲）
    const bf = 2 * Math.sin((Math.PI * 900) / sr);
    const bq = 1.2;
    for (let i = 0; i < n; i++) {
      // 參數在一個區塊內線性內插，避免轉速跳動的爆音
      const k = (i + 1) / n;
      const rpm = rpm0 + (p.rpm - rpm0) * k;
      const load = load0 + (p.load - load0) * k;
      const cut = cut0 + (p.cut - cut0) * k;
      this.phase += rpm / 120 / sr;
      if (this.phase >= 1) this.phase -= 1;
      // 排氣脈衝寬度：收油約 100° 曲軸角、全油門約 60°；重負載時壓力上升更陡（高頻更多）
      const W0 = 0.14 - 0.055 * load;
      const sharp = 10 + 30 * load;
      const body = p.body;
      let x = 0;
      let env = 0;
      for (let c = 0; c < CYL; c++) {
        // 點火順序左右兩排輪流：奇數缸＝另一排（到渦輪的管比較長：脈衝較弱、稍晚到）
        const bankB = c & 1;
        const W = W0;
        let a = this.phase - c / CYL - (bankB ? 0.012 * body : 0);
        if (a < 0) a += 1;
        if (a < this.prevA[c]) {
          // 新的一次燃燒：收油時燃燒很弱、而且比較不規則
          const base = 0.26 + 0.74 * Math.pow(load, 0.85);
          const jit = p.jitter * (0.05 + 0.22 * (1 - load));
          const g = (this.rand() + this.rand() + this.rand() - 1.5) * 1.4; // 近似常態分布
          const cylGain = 1 + (CYL_GAIN[c] - 1) * (1 + 2 * body);
          let amp = base * cylGain * (bankB ? 1 - 0.4 * body : 1) * (1 + jit * g);
          if (load < 0.2 && this.rand() < 0.07 * p.jitter) amp *= 0.35; // 收油時偶爾燒不完全
          this.amp[c] = Math.max(0, amp) * (1 - 0.85 * cut);
        }
        this.prevA[c] = a;
        if (a < W) {
          const u = a / W;
          const v = 1 - u;
          x += this.amp[c] * (1 - Math.exp(-u * sharp)) * v * v;
          env += this.amp[c] * v * v * v; // 只在脈衝剛開始時有顆粒，避免一直嘶嘶響
        }
      }
      // 直流隔離（脈衝都是正的）
      const dc = x - this.dcX + 0.995 * this.dcY;
      this.dcX = x;
      this.dcY = dc;
      // 排氣管共鳴：兩段延遲回授，回授路徑裡有阻尼
      const r1 = this.buf1[(this.w - this.d1 + this.bufLen) % this.bufLen];
      const r2 = this.buf2[(this.w - this.d2 + this.bufLen) % this.bufLen];
      this.damp1 += 0.45 * (r1 - this.damp1);
      this.damp2 += 0.6 * (r2 - this.damp2);
      const y1 = dc + g1 * this.damp1;
      const y2 = y1 + g2 * this.damp2;
      this.buf1[this.w] = y1;
      this.buf2[this.w] = y2;
      this.w = (this.w + 1) % this.bufLen;
      // 粗糙顆粒：跟著每次燃燒起伏的噪音
      const noise = (this.rand() * 2 - 1) * env * p.rasp * (0.25 + 0.75 * load);
      this.bpLow += bf * this.bpBand;
      const high = noise - this.bpLow - bq * this.bpBand;
      this.bpBand += bf * high;
      // 渦輪悶住高頻：重負載、高轉速時比較亮
      const rpmN = Math.min(1, Math.max(0, (rpm - 4000) / 9000));
      const fc = Math.min(sr * 0.45, (800 + 2000 * load + 900 * rpmN) * p.bright);
      const lpA = 1 - Math.exp((-TAU * fc) / sr);
      this.lp1 += lpA * (y2 + 0.9 * this.bpBand - this.lp1);
      this.lp2 += lpA * (this.lp1 - this.lp2);
      out[i] = this.lp2 * 0.9;
    }
    this.rpm = p.rpm;
    this.load = p.load;
    this.cut = p.cut;
  }
}

if (typeof registerProcessor === 'function') {
  registerProcessor(
    'f1-engine',
    class extends AudioWorkletProcessor {
      static get parameterDescriptors() {
        return ENGINE_PARAMS.map((d) => ({ ...d, automationRate: 'k-rate' }));
      }
      constructor() {
        super();
        this.synth = new EngineSynth(sampleRate, (Math.random() * 4294967296) >>> 0);
        this.p = {};
      }
      process(inputs, outputs, params) {
        const out = outputs[0][0];
        for (const d of ENGINE_PARAMS) this.p[d.name] = params[d.name][0];
        this.synth.render(out, this.p);
        return true;
      }
    },
  );
}
