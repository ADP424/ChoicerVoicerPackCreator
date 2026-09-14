export function mixdown(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const n = channels[0].length;
  const out = new Float32Array(n);
  const g = 1 / channels.length;
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i] * g;
  return out;
}

/** torch.hann_window(n) default (periodic=True). */
export function hannPeriodic(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

/** Band-limited windowed-sinc resampler (good enough for 48k/44.1k → 16k ML input). */
export function resample(x: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return x;
  const ratio = from / to;
  const fc = Math.min(1, 1 / ratio);
  const half = 16;
  const outLen = Math.round(x.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const p = i * ratio;
    const n0 = Math.floor(p);
    let acc = 0, norm = 0;
    for (let k = -half + 1; k <= half; k++) {
      const n = n0 + k;
      if (n < 0 || n >= x.length) continue;
      const t = n - p;
      const w = 0.5 + 0.5 * Math.cos((Math.PI * t) / half);
      const s = t === 0 ? fc : Math.sin(Math.PI * fc * t) / (Math.PI * t);
      acc += x[n] * s * w;
      norm += s * w;
    }
    out[i] = norm > 1e-9 ? acc / norm : 0;
  }
  return out;
}

/** In-place radix-2 complex FFT. */
export class FFT {
  private rev: Uint32Array;
  private cos: Float32Array;
  private sin: Float32Array;
  constructor(public readonly n: number) {
    if (n & (n - 1)) throw new Error('FFT size must be a power of two');
    const bits = Math.log2(n);
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.cos = new Float32Array(n / 2);
    this.sin = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
  }
  transform(re: Float32Array, im: Float32Array, inverse = false) {
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const j = this.rev[i];
      if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const wr = this.cos[k * step];
          const wi = inverse ? this.sin[k * step] : -this.sin[k * step];
          const a = start + k, b = a + half;
          const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
        }
      }
    }
    if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }
}

/** Arbitrary-length FFT (Bluestein) — needed because MDX-Net uses n_fft=6144/7680. */
export class ArbitraryFFT {
  private fft: FFT;
  private m: number;
  private pow2: boolean;
  private wr!: Float64Array; private wi!: Float64Array;
  private br!: Float32Array; private bi!: Float32Array;
  private ar!: Float32Array; private ai!: Float32Array;
  constructor(public readonly n: number) {
    this.pow2 = (n & (n - 1)) === 0;
    if (this.pow2) { this.fft = new FFT(n); this.m = n; return; }
    this.m = 1 << Math.ceil(Math.log2(2 * n - 1));
    this.fft = new FFT(this.m);
    this.wr = new Float64Array(n); this.wi = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      const ang = (Math.PI * ((k * k) % (2 * n))) / n; // w_k = exp(-iπk²/n)
      this.wr[k] = Math.cos(ang); this.wi[k] = -Math.sin(ang);
    }
    this.br = new Float32Array(this.m); this.bi = new Float32Array(this.m);
    this.br[0] = this.wr[0]; this.bi[0] = -this.wi[0];
    for (let k = 1; k < n; k++) {
      this.br[k] = this.br[this.m - k] = this.wr[k];
      this.bi[k] = this.bi[this.m - k] = -this.wi[k];
    }
    this.fft.transform(this.br, this.bi);
    this.ar = new Float32Array(this.m); this.ai = new Float32Array(this.m);
  }
  transform(re: Float32Array, im: Float32Array, inverse = false) {
    if (this.pow2) { this.fft.transform(re, im, inverse); return; }
    const { n, m, wr, wi, br, bi, ar, ai } = this;
    if (inverse) for (let i = 0; i < n; i++) im[i] = -im[i];
    ar.fill(0); ai.fill(0);
    for (let k = 0; k < n; k++) {
      ar[k] = re[k] * wr[k] - im[k] * wi[k];
      ai[k] = re[k] * wi[k] + im[k] * wr[k];
    }
    this.fft.transform(ar, ai);
    for (let i = 0; i < m; i++) {
      const r = ar[i] * br[i] - ai[i] * bi[i];
      ai[i] = ar[i] * bi[i] + ai[i] * br[i];
      ar[i] = r;
    }
    this.fft.transform(ar, ai, true);
    for (let k = 0; k < n; k++) {
      re[k] = ar[k] * wr[k] - ai[k] * wi[k];
      im[k] = ar[k] * wi[k] + ai[k] * wr[k];
    }
    if (inverse) for (let k = 0; k < n; k++) { re[k] /= n; im[k] = -im[k] / n; }
  }
}
