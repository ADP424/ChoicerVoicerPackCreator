import { AutoModel, AutoProcessor } from '@huggingface/transformers';
import './transformersEnv';

const MODEL = 'Xenova/wespeaker-voxceleb-resnet34-LM';
const SR = 16000;

/** Average-linkage agglomerative clustering on cosine distance (Lance–Williams update). */
function agglomerative(embs: Float32Array[], threshold: number): number[] {
  const n = embs.length;
  if (n === 0) return [];
  const D = new Float32Array(n * n);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    let dot = 0; for (let k = 0; k < embs[i].length; k++) dot += embs[i][k] * embs[j][k];
    D[i * n + j] = D[j * n + i] = 1 - dot;
  }
  const size = new Int32Array(n).fill(1);
  const alive = new Uint8Array(n).fill(1);
  const label = Array.from({ length: n }, (_, i) => i);
  for (;;) {
    let bi = -1, bj = -1, best = Infinity;
    for (let i = 0; i < n; i++) if (alive[i]) for (let j = i + 1; j < n; j++) if (alive[j] && D[i * n + j] < best) { best = D[i * n + j]; bi = i; bj = j; }
    if (bi < 0 || best > threshold) break;
    for (let k = 0; k < n; k++) if (alive[k] && k !== bi && k !== bj) {
      const d = (size[bi] * D[bi * n + k] + size[bj] * D[bj * n + k]) / (size[bi] + size[bj]);
      D[bi * n + k] = D[k * n + bi] = d;
    }
    size[bi] += size[bj]; alive[bj] = 0;
    for (let k = 0; k < n; k++) if (label[k] === bj) label[k] = bi;
  }
  return label;
}

/** Returns a speaker id ("Speaker N", numbered by first appearance) per segment. */
export async function diarize(
  audio16k: Float32Array, segments: Array<[number, number]>, threshold: number, onProgress: (f: number) => void,
): Promise<string[]> {
  const processor = await AutoProcessor.from_pretrained(MODEL);
  const model = await AutoModel.from_pretrained(MODEL, { device: 'wasm', dtype: 'fp32' });
  const embs: Float32Array[] = [];
  for (let i = 0; i < segments.length; i++) {
    const [s, e] = segments[i];
    let slice = audio16k.slice(Math.floor(s * SR), Math.ceil(e * SR));
    if (slice.length > SR * 20) slice = slice.slice(0, SR * 20);
    if (slice.length < SR) { // tile very short clips to ≥1 s for a stable embedding
      const t = new Float32Array(SR);
      for (let j = 0; j < SR; j++) t[j] = slice[j % slice.length];
      slice = t;
    }
    const inputs = await processor(slice);
    const { embeddings } = await model(inputs);
    const v = Float32Array.from(embeddings.data as Float32Array);
    let norm = 0; for (const x of v) norm += x * x; norm = Math.sqrt(norm) || 1;
    for (let k = 0; k < v.length; k++) v[k] /= norm;
    embs.push(v);
    onProgress(i / segments.length);
  }
  const labels = agglomerative(embs, threshold);
  const names = new Map<number, string>();
  return labels.map((l) => {
    if (!names.has(l)) names.set(l, `Speaker ${names.size + 1}`);
    return names.get(l)!;
  });
}
