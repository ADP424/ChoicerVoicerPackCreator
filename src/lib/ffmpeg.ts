import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

const CORE = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
let instance: Promise<FFmpeg> | null = null;

export function getFFmpeg(): Promise<FFmpeg> {
  if (!instance) {
    instance = (async () => {
      const ff = new FFmpeg();
      await ff.load({
        coreURL: await toBlobURL(`${CORE}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${CORE}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      return ff;
    })();
  }
  return instance;
}

export const extOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';

async function readAndDelete(ff: FFmpeg, name: string): Promise<Uint8Array> {
  const data = (await ff.readFile(name)) as Uint8Array;
  await ff.deleteFile(name).catch(() => {});
  return data;
}

/** Strips audio and transcodes the video track to Theora/Ogg (`ogv`), the format the reconstructor expects. */
export async function stripAudio(file: File): Promise<{ blob: Blob; ext: string }> {
  const ff = await getFFmpeg();
  const ext = extOf(file.name) || 'mp4';
  const inName = `in.${ext}`;
  await ff.writeFile(inName, await fetchFile(file));
  try {
    const rc = await ff.exec(['-i', inName, '-an', '-c:v', 'libtheora', '-q:v', '7', 'out.ogv']);
    if (rc !== 0) throw new Error(`ffmpeg exited with code ${rc}`);
    return { blob: new Blob([await readAndDelete(ff, 'out.ogv')], { type: 'video/ogg' }), ext: 'ogv' };
  } finally {
    await ff.deleteFile(inName).catch(() => {});
  }
}

/** Fallback when the browser cannot decode the container's audio natively. */
export async function extractWav(file: File): Promise<Blob> {
  const ff = await getFFmpeg();
  const inName = `in.${extOf(file.name) || 'bin'}`;
  await ff.writeFile(inName, await fetchFile(file));
  try {
    const rc = await ff.exec(['-i', inName, '-vn', '-ac', '2', '-ar', '44100', 'out.wav']);
    if (rc !== 0) throw new Error('No decodable audio stream found in this file.');
    return new Blob([await readAndDelete(ff, 'out.wav')], { type: 'audio/wav' });
  } finally {
    await ff.deleteFile(inName).catch(() => {});
  }
}
