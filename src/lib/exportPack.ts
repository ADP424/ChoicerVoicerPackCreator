import JSZip from 'jszip';
import type { Draft, PackLine, PackMetadata, Speaker } from '../types';
import { slicePcm } from './audio';
import { formatIniString, formatIniStringList, sanitizeFilenamePart } from './ini';
import { encodeMp3 } from './mp3';
import type { FrameGrabber } from './frames';

export interface ExportInput {
  draft: Draft; lines: PackLine[]; speakers: Speaker[]; metadata: PackMetadata;
  /** Source of default screenshots; null if the video can't be decoded by the browser. */
  frames: FrameGrabber | null;
}

const ICON_MAX_WIDTH = 512;
const FRAME_MAX_WIDTH = 960;

async function toPng(file: File): Promise<Blob> {
  if (file.type === 'image/png') return file;
  const bmp = await createImageBitmap(file);
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}

export async function buildPackFiles(
  { draft, lines, speakers, metadata, frames }: ExportInput, onProgress: (msg: string) => void,
): Promise<{ files: Map<string, Blob>; exportedCount: number; warnings: string[] }> {
  const files = new Map<string, Blob>();
  const speakerById = new Map(speakers.map((s) => [s.id, s]));
  const duration = draft.mix.channels[0].length / draft.mix.sampleRate;
  const warnings: string[] = [];

  files.set(`dub_video.${draft.videoExt}`, draft.videoBlob);
  if (draft.backing) { onProgress('Encoding backing track…'); files.set('_backing_track.mp3', encodeMp3(draft.backing)); }

  onProgress('Preparing icon…');
  const icon = metadata.iconFile
    ? await toPng(metadata.iconFile)
    : frames ? await frames.capture(duration / 2, ICON_MAX_WIDTH) : null;
  if (icon) files.set('icon.png', icon);
  else if (!metadata.iconFile) warnings.push('No default icon could be captured from the video; pack exported without an icon.');

  const info = ['[data]', '', `title=${formatIniString(metadata.title)}`];
  if (icon) info.push('icon="icon.png"');
  if (metadata.authors.length) info.push(`authors=${formatIniStringList(metadata.authors)}`);
  if (metadata.readme) info.push(`readme=${formatIniString(metadata.readme)}`);
  files.set('_pack_info.ini', new Blob([info.join('\n') + '\n'], { type: 'text/plain' }));

  const included = lines.filter((l) => l.included).sort((a, b) => a.start - b.start);
  for (let i = 0; i < included.length; i++) {
    const line = included[i];
    const speaker = speakerById.get(line.speakerId)!;
    const stem = `${String(i).padStart(2, '0')}_${sanitizeFilenamePart(speaker.name)}`;
    onProgress(`Encoding line ${i + 1}/${included.length}…`);

    // line image → speaker portrait → screenshot from the middle of the clip
    const userImage = line.imageFile ?? speaker.portraitFile;
    const image = userImage
      ? await toPng(userImage)
      : frames ? await frames.capture((line.start + line.end) / 2, FRAME_MAX_WIDTH) : null;
    if (image) files.set(`${stem}.png`, image);
    else warnings.push(`Line ${i} ("${stem}"): no image could be captured; exported without one.`);

    files.set(`${stem}.mp3`, encodeMp3(slicePcm(draft.mix, line.start, line.end)));

    const txt = ['[data]', '', `caption=${formatIniString(line.caption)}`];
    if (image) txt.push(`image="${stem}.png"`);
    txt.push(`dub_timestamps=[${line.start.toFixed(3)}]`);
    txt.push(`dub_characters=${formatIniStringList([speaker.name])}`);
    files.set(`${stem}.txt`, new Blob([txt.join('\n') + '\n'], { type: 'text/plain' }));
    await new Promise((r) => setTimeout(r, 0));
  }
  return { files, exportedCount: included.length, warnings };
}

/** Mirrors the reconstructor's reader logic: find dub_video.* and count line .txt files. */
export async function selfCheck(files: Map<string, Blob>, expected: number): Promise<string> {
  if (![...files.keys()].some((k) => k.startsWith('dub_video.'))) return 'reconstructor would not find dub_video.* in the exported pack.';
  let count = 0;
  for (const [name, blob] of files) {
    if (!name.endsWith('.txt') || name.startsWith('_')) continue;
    if (/^dub_timestamps=\[/m.test(await blob.text())) count++;
  }
  return count === expected ? '' : `reconstructor would find ${count} line timestamp(s), expected ${expected}.`;
}

export async function zipFiles(files: Map<string, Blob>, folder: string): Promise<Blob> {
  const zip = new JSZip();
  const dir = zip.folder(folder)!;
  for (const [name, blob] of files) dir.file(name, blob);
  return zip.generateAsync({ type: 'blob', compression: 'STORE' });
}

export async function isDirectoryEmpty(dir: FileSystemDirectoryHandle): Promise<boolean> {
  for await (const _ of (dir as any).keys()) return false;
  return true;
}

export async function writeFilesToDirectory(dir: FileSystemDirectoryHandle, files: Map<string, Blob>) {
  for (const [name, blob] of files) {
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(blob);
    await w.close();
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
