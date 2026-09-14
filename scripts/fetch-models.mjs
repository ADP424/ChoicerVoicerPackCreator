// Downloads the two ONNX models that are served from /public/models.
import { mkdirSync, createWriteStream, existsSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const MODELS = {
  'silero_vad.onnx': 'https://raw.githubusercontent.com/snakers4/silero-vad/master/src/silero_vad/data/silero_vad.onnx',
  'UVR-MDX-NET-Voc_FT.onnx': 'https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/UVR-MDX-NET-Voc_FT.onnx',
};
mkdirSync('public/models', { recursive: true });
for (const [name, url] of Object.entries(MODELS)) {
  const dest = `public/models/${name}`;
  if (existsSync(dest)) { console.log(`skip ${name}`); continue; }
  console.log(`fetching ${name}…`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}
