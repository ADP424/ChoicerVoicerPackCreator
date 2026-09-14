import type { BackingQuality, PcmAudio, PipelineOptions } from '../types';
import { DEFAULT_MDX, separateMdx } from './mdxnet';

function phaseCancel(mix: PcmAudio): PcmAudio {
  const [L, R] = mix.channels;
  const n = L.length;
  const a = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i++) { a[i] = 0.5 * L[i] - 0.5 * R[i]; b[i] = -a[i]; }
  return { sampleRate: mix.sampleRate, channels: [a, b] };
}

export async function separate(
  mix: PcmAudio, options: PipelineOptions, onProgress: (f: number) => void,
): Promise<{ vocals: PcmAudio; backing: PcmAudio | null; quality: BackingQuality }> {
  if (options.separation === 'none') return { vocals: mix, backing: null, quality: 'none' };
  if (options.separation === 'mdx-net') {
    try {
      const r = await separateMdx(mix, DEFAULT_MDX, options.device, onProgress);
      return { ...r, quality: 'mdx-net' };
    } catch (err) {
      console.warn('MDX-Net separation failed; falling back to phase cancellation.', err);
    }
  }
  if (mix.channels.length < 2) return { vocals: mix, backing: null, quality: 'none' };
  return { vocals: mix, backing: phaseCancel(mix), quality: 'phase-cancel-fallback' };
}
