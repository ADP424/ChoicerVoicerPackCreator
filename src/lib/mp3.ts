import { Mp3Encoder } from '@breezystack/lamejs';
import type { PcmAudio } from '../types';

export function encodeMp3(audio: PcmAudio, kbps = 192): Blob {
  const stereo = audio.channels.length >= 2;
  const enc = new Mp3Encoder(stereo ? 2 : 1, audio.sampleRate, kbps);
  const toInt16 = (f: Float32Array) => {
    const o = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) o[i] = Math.max(-32768, Math.min(32767, Math.round(f[i] * 32767)));
    return o;
  };
  const L = toInt16(audio.channels[0]);
  const R = stereo ? toInt16(audio.channels[1]) : null;
  const parts: Uint8Array[] = [];
  const push = (b: Int8Array) => { if (b.length) parts.push(new Uint8Array(b.buffer, b.byteOffset, b.length)); };
  const BLOCK = 1152;
  for (let i = 0; i < L.length; i += BLOCK) {
    const l = L.subarray(i, i + BLOCK);
    push(R ? enc.encodeBuffer(l, R.subarray(i, i + BLOCK)) : enc.encodeBuffer(l));
  }
  push(enc.flush());
  return new Blob(parts, { type: 'audio/mpeg' });
}
