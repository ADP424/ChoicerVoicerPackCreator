import { createSession, ort } from './ort';
import { ArbitraryFFT, hannPeriodic, resample } from './dsp';
import type { Device, PcmAudio } from '../types';

export interface MdxConfig {
  url: string; nFft: number; hop: number; dimF: number; dimT: number;
  stem: 'vocals' | 'instrumental'; sampleRate: number;
}

/** UVR-MDX-NET-Voc_FT. Swap for e.g. Inst_HQ_3 (nFft 6144, stem 'instrumental'). */
export const DEFAULT_MDX: MdxConfig = {
  url: `${import.meta.env.BASE_URL}models/UVR-MDX-NET-Voc_FT.onnx`,
  nFft: 7680, hop: 1024, dimF: 3072, dimT: 256, stem: 'vocals', sampleRate: 44100,
};

/** Port of UVR's MDX-Net `demix_base` (trim-based chunking, no denoise pass). */
export async function separateMdx(
  mix: PcmAudio, cfg: MdxConfig, device: Device, onProgress: (f: number) => void,
): Promise<{ vocals: PcmAudio; backing: PcmAudio }> {
  const { nFft, hop, dimF, dimT, sampleRate: sr } = cfg;
  const src = mix.channels.length >= 2 ? [mix.channels[0], mix.channels[1]] : [mix.channels[0], mix.channels[0]];
  const input = src.map((ch) => resample(ch, mix.sampleRate, sr));

  const session = await createSession(cfg.url, {
    executionProviders: device === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'],
    graphOptimizationLevel: 'all',
  });
  const inName = session.inputNames[0], outName = session.outputNames[0];

  const bins = nFft / 2 + 1, trim = nFft / 2;
  const chunk = hop * (dimT - 1);
  const gen = chunk - 2 * trim;
  const N = input[0].length;
  const pad = gen - (N % gen);
  const total = N + pad;
  const padded = input.map((ch) => { const p = new Float32Array(trim + total + trim); p.set(ch, trim); return p; });
  const out = [new Float32Array(total), new Float32Array(total)];

  const fft = new ArbitraryFFT(nFft);
  const win = hannPeriodic(nFft);
  const re = new Float32Array(nFft), im = new Float32Array(nFft);
  const specIn = new Float32Array(4 * dimF * dimT);
  const ola = new Float32Array(chunk + nFft);
  const wsum = new Float32Array(chunk + nFft);
  for (let t = 0; t < dimT; t++) for (let j = 0; j < nFft; j++) wsum[t * hop + j] += win[j] * win[j];

  try {
    for (let pos = 0; pos < total; pos += gen) {
      // ---- STFT (center=True, reflect pad) → [1, 4, dimF, dimT] as [L_re, L_im, R_re, R_im]
      for (let c = 0; c < 2; c++) {
        const x = padded[c].subarray(pos, pos + chunk);
        for (let t = 0; t < dimT; t++) {
          const center = t * hop;
          for (let j = 0; j < nFft; j++) {
            let idx = center - trim + j;
            if (idx < 0) idx = -idx; else if (idx >= chunk) idx = 2 * (chunk - 1) - idx;
            re[j] = x[idx] * win[j]; im[j] = 0;
          }
          fft.transform(re, im);
          for (let f = 0; f < dimF; f++) {
            specIn[(2 * c * dimF + f) * dimT + t] = re[f];
            specIn[((2 * c + 1) * dimF + f) * dimT + t] = im[f];
          }
        }
      }
      const res = await session.run({ [inName]: new ort.Tensor('float32', specIn, [1, 4, dimF, dimT]) });
      const spec = res[outName].data as Float32Array;

      // ---- iSTFT
      for (let c = 0; c < 2; c++) {
        ola.fill(0);
        for (let t = 0; t < dimT; t++) {
          for (let f = 0; f < bins; f++) {
            if (f < dimF) {
              re[f] = spec[(2 * c * dimF + f) * dimT + t];
              im[f] = spec[((2 * c + 1) * dimF + f) * dimT + t];
            } else { re[f] = 0; im[f] = 0; }
          }
          im[0] = 0; im[nFft / 2] = 0;
          for (let f = 1; f < nFft / 2; f++) { re[nFft - f] = re[f]; im[nFft - f] = -im[f]; }
          fft.transform(re, im, true);
          const base = t * hop;
          for (let j = 0; j < nFft; j++) ola[base + j] += re[j] * win[j];
        }
        const o = out[c];
        for (let n = 0; n < gen; n++) {
          const k = 2 * trim + n; // skip center padding (trim) + chunk trim (trim)
          o[pos + n] = wsum[k] > 1e-8 ? ola[k] / wsum[k] : 0;
        }
      }
      (res[outName] as any).dispose?.();
      onProgress(Math.min(1, (pos + gen) / total));
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    await session.release();
  }

  const stem = out.map((o) => o.slice(0, N));
  const other = stem.map((s, c) => { const o = new Float32Array(N); for (let i = 0; i < N; i++) o[i] = input[c][i] - s[i]; return o; });
  const [vocals, backing] = cfg.stem === 'vocals' ? [stem, other] : [other, stem];
  return { vocals: { sampleRate: sr, channels: vocals }, backing: { sampleRate: sr, channels: backing } };
}
