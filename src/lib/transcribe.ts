import { pipeline } from '@huggingface/transformers';
import './transformersEnv';
import type { Device, Word } from '../types';

const SR = 16000;
export type Asr = any;

export async function loadAsr(model: string, device: Device, onStatus: (m: string) => void): Promise<Asr> {
  return pipeline('automatic-speech-recognition', model, {
    device,
    dtype: device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
    progress_callback: (p: any) => {
      if (p.status === 'progress' && p.file) onStatus(`Downloading ${p.file} — ${Math.round(p.progress)}%`);
    },
  });
}

const HALLUCINATIONS = /^(thank you\.?|thanks for watching\.?|subtitles by .*|\[.*\]|\(.*\))$/i;

function clean(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!/[\p{L}\p{N}]/u.test(t) || HALLUCINATIONS.test(t)) return '';
  return t;
}

export async function transcribeSegment(
  asr: Asr, audio16k: Float32Array, start: number, end: number, language: string,
): Promise<{ text: string; words: Word[] }> {
  const slice = audio16k.slice(Math.floor(start * SR), Math.ceil(end * SR));
  const base: any = { task: 'transcribe', language: language === 'auto' ? null : language };
  if (end - start > 30) { base.chunk_length_s = 30; base.stride_length_s = 5; }
  let out: any;
  try { out = await asr(slice, { ...base, return_timestamps: 'word' }); }
  catch { out = await asr(slice, base); }
  const text = clean(out.text ?? '');
  const words: Word[] = text
    ? (out.chunks ?? []).map((c: any) => ({
        text: String(c.text).trim(),
        start: start + (c.timestamp?.[0] ?? 0),
        end: start + (c.timestamp?.[1] ?? c.timestamp?.[0] ?? 0),
      })).filter((w: Word) => w.text)
    : [];
  return { text, words };
}
