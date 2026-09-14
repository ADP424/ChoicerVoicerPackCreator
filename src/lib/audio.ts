import type { PcmAudio } from '../types';

export async function decodeAudioBlob(blob: Blob): Promise<PcmAudio> {
  const ctx = new AudioContext();
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const channels: Float32Array[] = [];
    for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) channels.push(buf.getChannelData(c).slice());
    return { sampleRate: buf.sampleRate, channels };
  } finally {
    await ctx.close();
  }
}

export function slicePcm(audio: PcmAudio, start: number, end: number): PcmAudio {
  const a = Math.max(0, Math.floor(start * audio.sampleRate));
  const b = Math.min(audio.channels[0].length, Math.ceil(end * audio.sampleRate));
  return { sampleRate: audio.sampleRate, channels: audio.channels.map((ch) => ch.slice(a, b)) };
}

export function toAudioBuffer(ctx: BaseAudioContext, audio: PcmAudio): AudioBuffer {
  const buf = ctx.createBuffer(audio.channels.length, audio.channels[0].length, audio.sampleRate);
  audio.channels.forEach((ch, i) => buf.copyToChannel(ch, i));
  return buf;
}
