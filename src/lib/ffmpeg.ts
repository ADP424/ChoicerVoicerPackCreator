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

/** Runs one ffmpeg.wasm job with its own progress listener, cleaned up afterward regardless of outcome. */
async function withProgress<T>(ff: FFmpeg, onProgress: ((fraction: number) => void) | undefined, run: () => Promise<T>): Promise<T> {
  if (!onProgress) return run();
  const listener = ({ progress }: { progress: number }) => onProgress(Math.max(0, Math.min(1, progress)));
  ff.on('progress', listener);
  try { return await run(); } finally { ff.off('progress', listener); }
}

/** Strips audio and transcodes the video track to Theora/Ogg (`ogv`), the format the reconstructor expects. */
export async function stripAudio(file: File, onProgress?: (fraction: number) => void): Promise<{ blob: Blob; ext: string }> {
  const ff = await getFFmpeg();
  const ext = extOf(file.name) || 'mp4';
  const inName = `in.${ext}`;
  await ff.writeFile(inName, await fetchFile(file));
  try {
    const rc = await withProgress(ff, onProgress, () => ff.exec(['-i', inName, '-an', '-c:v', 'libtheora', '-q:v', '7', 'out.ogv']));
    if (rc !== 0) throw new Error(`ffmpeg exited with code ${rc}`);
    return { blob: new Blob([await readAndDelete(ff, 'out.ogv')], { type: 'video/ogg' }), ext: 'ogv' };
  } finally {
    await ff.deleteFile(inName).catch(() => {});
  }
}

/** Fallback when the browser cannot decode the container's audio natively. */
export async function extractWav(file: File, onProgress?: (fraction: number) => void): Promise<Blob> {
  const ff = await getFFmpeg();
  const inName = `in.${extOf(file.name) || 'bin'}`;
  await ff.writeFile(inName, await fetchFile(file));
  try {
    const rc = await withProgress(ff, onProgress, () => ff.exec(['-i', inName, '-vn', '-ac', '2', '-ar', '44100', 'out.wav']));
    if (rc !== 0) throw new Error('No decodable audio stream found in this file.');
    return new Blob([await readAndDelete(ff, 'out.wav')], { type: 'audio/wav' });
  } finally {
    await ff.deleteFile(inName).catch(() => {});
  }
}
