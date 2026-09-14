import { createSession, ort } from './ort';

export interface VadOptions {
  modelUrl: string; threshold: number; minSpeechMs: number; minSilenceMs: number;
  speechPadMs: number; maxSpeechSec: number;
}

const SR = 16000, FRAME = 512, CTX = 64;

/** Silero VAD v5 + a port of `get_speech_timestamps`, plus max-length splitting at the quietest frame. */
export async function detectSpeech(
  audio: Float32Array, o: VadOptions, onProgress: (f: number) => void,
): Promise<Array<[number, number]>> {
  const session = await createSession(o.modelUrl, { executionProviders: ['wasm'] });
  let state = new ort.Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]);
  const sr = new ort.Tensor('int64', BigInt64Array.from([BigInt(SR)]), []);
  const nFrames = Math.ceil(audio.length / FRAME);
  const probs = new Float32Array(nFrames);
  const frame = new Float32Array(CTX + FRAME);
  try {
    for (let i = 0; i < nFrames; i++) {
      frame.fill(0);
      const s = i * FRAME;
      for (let k = 0; k < CTX; k++) { const idx = s - CTX + k; if (idx >= 0) frame[k] = audio[idx]; }
      frame.set(audio.subarray(s, Math.min(audio.length, s + FRAME)), CTX);
      const res = await session.run({ input: new ort.Tensor('float32', frame, [1, CTX + FRAME]), state, sr });
      probs[i] = (res.output.data as Float32Array)[0];
      state = res.stateN as ort.Tensor;
      if (i % 250 === 0) onProgress(i / nFrames);
    }
  } finally { await session.release(); }

  const th = o.threshold, neg = th - 0.15;
  const minSpeech = (SR * o.minSpeechMs) / 1000, minSilence = (SR * o.minSilenceMs) / 1000;
  const padS = (SR * o.speechPadMs) / 1000;
  const segs: Array<{ start: number; end: number }> = [];
  let triggered = false, tempEnd = 0, start = 0;
  for (let i = 0; i < nFrames; i++) {
    const p = probs[i], pos = i * FRAME;
    if (p >= th && tempEnd) tempEnd = 0;
    if (p >= th && !triggered) { triggered = true; start = pos; continue; }
    if (p < neg && triggered) {
      if (!tempEnd) tempEnd = pos;
      if (pos - tempEnd < minSilence) continue;
      if (tempEnd - start > minSpeech) segs.push({ start, end: tempEnd });
      triggered = false; tempEnd = 0;
    }
  }
  if (triggered && audio.length - start > minSpeech) segs.push({ start, end: audio.length });

  for (let i = 0; i < segs.length; i++) {
    if (i === 0) segs[i].start = Math.max(0, segs[i].start - padS);
    if (i < segs.length - 1) {
      const gap = segs[i + 1].start - segs[i].end;
      if (gap < 2 * padS) { segs[i].end += gap / 2; segs[i + 1].start -= gap / 2; }
      else { segs[i].end = Math.min(audio.length, segs[i].end + padS); segs[i + 1].start = Math.max(0, segs[i + 1].start - padS); }
    } else segs[i].end = Math.min(audio.length, segs[i].end + padS);
  }

  // Split over-long segments at the lowest-probability point away from both ends.
  const maxLen = o.maxSpeechSec * SR;
  const out: Array<[number, number]> = [];
  const split = (s: number, e: number) => {
    if (e - s <= maxLen) { out.push([s / SR, e / SR]); return; }
    const lo = Math.floor((s + minSpeech * 2) / FRAME), hi = Math.floor((e - minSpeech * 2) / FRAME);
    let best = -1, bestP = Infinity;
    for (let f = lo; f < hi; f++) if (probs[f] < bestP) { bestP = probs[f]; best = f; }
    if (best < 0) { out.push([s / SR, e / SR]); return; }
    split(s, best * FRAME); split(best * FRAME, e);
  };
  for (const s of segs) split(Math.round(s.start), Math.round(s.end));
  return out;
}
