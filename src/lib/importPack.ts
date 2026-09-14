import JSZip from 'jszip';
import type { PackLine, PackMetadata, PackRestore, Speaker } from '../types';

// ---------------------------------------------------------------------------
// INI parsing (reverses ini.ts: smart quotes → straight quotes)
// ---------------------------------------------------------------------------

const unsmart = (s: string) => s.replace(/[""]/g, '"');

function parseIni(text: string): Map<string, string> {
  const kv = new Map<string, string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('[') || line.startsWith(';') || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq > 0) kv.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }
  return kv;
}

function unquote(raw: string): string {
  let s = raw.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
  return unsmart(s);
}

const parseStringList = (raw: string): string[] =>
  [...unsmart(raw).matchAll(/"([^"]*)"/g)].map((m) => m[1]);

const parseNumberList = (raw: string): number[] =>
  (raw.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);

// ---------------------------------------------------------------------------
// Collecting pack files from a folder, a FileList (webkitdirectory) or a zip
// ---------------------------------------------------------------------------

export async function filesFromDirectoryHandle(dir: FileSystemDirectoryHandle): Promise<Map<string, Blob>> {
  const files = new Map<string, Blob>();
  for await (const [name, handle] of (dir as any).entries()) {
    if (handle.kind === 'file') files.set(name, await handle.getFile());
  }
  return files;
}

/** For <input webkitdirectory>: only files directly inside the chosen folder. */
export function filesFromFileList(list: FileList): Map<string, Blob> {
  const files = new Map<string, Blob>();
  for (const f of Array.from(list)) {
    const rel = (f as any).webkitRelativePath as string | undefined;
    if (!rel || rel.split('/').length <= 2) files.set(f.name, f);
  }
  return files;
}

export async function filesFromZip(file: Blob): Promise<Map<string, Blob>> {
  const zip = await JSZip.loadAsync(file);
  const entries = Object.values(zip.files).filter((e) => !e.dir);
  // The app's own zips wrap everything in one root folder — strip it if present.
  const roots = new Set(entries.map((e) => e.name.split('/')[0]));
  const prefix = roots.size === 1 && entries.every((e) => e.name.includes('/')) ? `${[...roots][0]}/` : '';
  const files = new Map<string, Blob>();
  for (const e of entries) {
    const name = e.name.startsWith(prefix) ? e.name.slice(prefix.length) : e.name;
    if (name && !name.includes('/')) files.set(name, await e.async('blob'));
  }
  return files;
}

// ---------------------------------------------------------------------------
// Parsing the pack itself
// ---------------------------------------------------------------------------

export async function parsePack(files: Map<string, Blob>, label: string): Promise<PackRestore> {
  const warnings: string[] = [];
  const metadata: PackMetadata = { title: '', authors: [], readme: '', iconFile: null };

  const info = files.get('_pack_info.ini');
  if (info) {
    const kv = parseIni(await info.text());
    metadata.title = unquote(kv.get('title') ?? '');
    if (kv.has('authors')) metadata.authors = parseStringList(kv.get('authors')!);
    if (kv.has('readme')) metadata.readme = unquote(kv.get('readme')!);
    const iconName = kv.has('icon') ? unquote(kv.get('icon')!) : null;
    if (iconName) {
      const blob = files.get(iconName);
      if (blob) metadata.iconFile = new File([blob], iconName, { type: 'image/png' });
      else warnings.push(`Pack icon "${iconName}" is referenced but missing.`);
    }
  } else {
    warnings.push('_pack_info.ini not found; pack metadata left empty.');
  }

  const txtNames = [...files.keys()]
    .filter((n) => n.toLowerCase().endsWith('.txt') && !n.startsWith('_'))
    .sort();
  if (!txtNames.length) throw new Error('No line files (NN_Name.txt) found — is this a voice pack?');

  const speakers: Speaker[] = [];
  const lines: PackLine[] = [];
  const ctx = new AudioContext(); // reused for measuring every clip's duration
  try {
    for (const name of txtNames) {
      const stem = name.slice(0, -4);
      const kv = parseIni(await files.get(name)!.text());

      const ts = parseNumberList(kv.get('dub_timestamps') ?? '');
      if (!ts.length) { warnings.push(`${name}: no dub_timestamps; line skipped.`); continue; }
      if (ts.length > 1) warnings.push(`${name}: multiple timestamps; only the first was kept.`);
      const start = ts[0];

      const chars = parseStringList(kv.get('dub_characters') ?? '');
      const speakerName = chars[0]?.trim() || 'Speaker 1';
      if (chars.length > 1) warnings.push(`${name}: multiple characters; assigned to "${speakerName}".`);
      if (!speakers.some((s) => s.id === speakerName)) {
        speakers.push({ id: speakerName, name: speakerName, portraitFile: null });
      }

      // The pack format has no end timestamp — recover it from the clip's length.
      let end = start + 3;
      const mp3 = files.get(`${stem}.mp3`);
      if (mp3) {
        try {
          const buf = await ctx.decodeAudioData(await mp3.arrayBuffer());
          end = start + buf.duration;
        } catch { warnings.push(`${name}: could not decode ${stem}.mp3; assumed a 3 s line.`); }
      } else {
        warnings.push(`${name}: ${stem}.mp3 is missing; assumed a 3 s line.`);
      }

      const imageName = kv.has('image') ? unquote(kv.get('image')!) : null;
      let imageFile: File | null = null;
      if (imageName) {
        const blob = files.get(imageName);
        if (blob) imageFile = new File([blob], imageName, { type: 'image/png' });
        else warnings.push(`${name}: referenced image "${imageName}" not found.`);
      }

      lines.push({
        id: crypto.randomUUID(), start, end,
        caption: unquote(kv.get('caption') ?? ''),
        speakerId: speakerName, words: [], imageFile, included: true,
      });
    }
  } finally {
    await ctx.close();
  }

  lines.sort((a, b) => a.start - b.start);
  return { metadata, speakers, lines, warnings, label };
}

/** Clamp/drop restored lines against the actual audio length of the selected video. */
export function fitPackToDuration(pack: PackRestore, durationSec: number): PackRestore {
  const warnings = [...pack.warnings];
  let clamped = 0, dropped = 0;
  const lines = pack.lines.flatMap((l) => {
    if (l.start >= durationSec) { dropped++; return []; }
    if (l.end > durationSec) { clamped++; return [{ ...l, end: durationSec }]; }
    return [l];
  });
  if (clamped) warnings.push(`${clamped} line(s) extended past the end of the audio and were clamped — is this the right video?`);
  if (dropped) warnings.push(`${dropped} line(s) started after the end of the audio and were dropped — is this the right video?`);
  warnings.push('Packs do not store word timestamps; "Split at cursor" will divide captions proportionally for restored lines.');
  return { ...pack, lines, warnings };
}
