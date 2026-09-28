import { useState } from 'react';
import type { ExtraTrackInput, PipelineOptions, RestoreData } from '../types';
import { readReviewFile } from '../lib/reviewFile';
import { filesFromDirectoryHandle, filesFromFileList, filesFromZip, parsePack } from '../lib/importPack';
import { ProcessingOptionsFields } from './ProcessingOptionsFields';

const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;
const canPickDirectory = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

export const DEFAULT_OPTIONS: PipelineOptions = {
  device: hasWebGPU ? 'webgpu' : 'wasm',
  separation: 'mdx-net',
  whisperModel: hasWebGPU ? 'onnx-community/whisper-small' : 'onnx-community/whisper-base',
  language: 'auto',
  transcribe: true,
  diarize: true,
  clusterThreshold: 0.7,
  detection: 'speech',
  vadThreshold: 0.5,
  energyThreshold: 0.15,
  minSilenceMs: 300,
  minSpeechMs: 250,
  maxLineSec: 20,
};

const stripExt = (name: string) => name.replace(/\.[^.]+$/, '');

export function FilePicker({ onStart }: {
  onStart: (file: File, options: PipelineOptions, extraTracks: ExtraTrackInput[], restore: RestoreData | null) => void;
}) {
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const [file, setFile] = useState<File | null>(null);
  const [extraTracks, setExtraTracks] = useState<ExtraTrackInput[]>([]);
  const [restore, setRestore] = useState<{ label: string; data: RestoreData } | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const set = <K extends keyof PipelineOptions>(k: K, v: PipelineOptions[K]) => setOptions((o) => ({ ...o, [k]: v }));

  async function takeFiles(list: FileList | File[]) {
    for (const f of Array.from(list)) {
      const lower = f.name.toLowerCase();
      if (lower.endsWith('.json')) await loadReview(f);
      else if (lower.endsWith('.zip')) await loadPack(() => filesFromZip(f), f.name);
      else setFile(f);
    }
  }

  function takeExtraTracks(list: FileList | File[]) {
    const added: ExtraTrackInput[] = Array.from(list).map((f) => ({
      id: crypto.randomUUID(), kind: 'dub', file: f, label: stripExt(f.name),
      options: { ...DEFAULT_OPTIONS },
    }));
    setExtraTracks((ts) => [...ts, ...added]);
  }

  function updateExtraTrack(id: string, patch: Partial<ExtraTrackInput>) {
    setExtraTracks((ts) => ts.map((t) => (t.id === id ? ({ ...t, ...patch } as ExtraTrackInput) : t)));
  }

  function removeExtraTrack(id: string) {
    setExtraTracks((ts) => ts.filter((t) => t.id !== id));
  }

  function applyMainSettingsToAllTracks() {
    setExtraTracks((ts) => ts.map((t) => (t.kind === 'dub' ? { ...t, options: { ...options } } : t)));
  }

  async function loadReview(f: File) {
    try {
      const review = await readReviewFile(f);
      setRestore({ label: `${f.name} — ${review.lines.length} lines, ${review.speakers.length} speakers (saved for ${review.source.name})`, data: { kind: 'review', review } });
      setRestoreError(null);
      setOptions({ ...DEFAULT_OPTIONS, ...review.options, device: hasWebGPU ? review.options.device : 'wasm' });
    } catch (err) { setRestore(null); setRestoreError((err as Error).message); }
  }

  async function loadPack(getFiles: () => Promise<Map<string, Blob>> | Map<string, Blob>, label: string) {
    try {
      const pack = await parsePack(await getFiles(), label);
      setRestore({ label: `${label} — ${pack.lines.length} lines, ${pack.speakers.length} speakers${pack.metadata.title ? ` (“${pack.metadata.title}”)` : ''}`, data: { kind: 'pack', pack } });
      setRestoreError(null);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') { setRestore(null); setRestoreError((err as Error).message); }
    }
  }

  async function pickPackFolder() {
    const dir: FileSystemDirectoryHandle = await (window as any).showDirectoryPicker();
    await loadPack(() => filesFromDirectoryHandle(dir), dir.name);
  }

  return (
    <div className="picker">
      <h1>ChoicerVoicer Pack Creator</h1>
      <p className="muted">Everything runs in your browser — the video never leaves your machine.</p>

      <label
        className={`dropzone ${drag ? 'drag' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); takeFiles(e.dataTransfer.files); }}
      >
        <input type="file" accept="video/*,.mkv,.ogv,.avi,.mov,.webm,.mp4" hidden onChange={(e) => e.target.files && takeFiles(e.target.files)} />
        {file ? <strong>{file.name}</strong> : <span>Drop a video here or click to choose</span>}
        {file && <span className="muted"> ({(file.size / 1e6).toFixed(1)} MB)</span>}
        <div className="muted small">You can also drop a saved review .json or an exported pack .zip here.</div>
      </label>

      <fieldset className="panel">
        <legend>Restore a previous session (optional)</legend>
        <div className="row">
          <label className="row" style={{ gap: 4 }}>Review JSON:
            <input type="file" accept="application/json,.json" onChange={(e) => e.target.files?.[0] && loadReview(e.target.files[0])} style={{ maxWidth: 260 }} />
          </label>
          <span className="muted">or</span>
          {canPickDirectory
            ? <button onClick={pickPackFolder}>Choose exported pack folder…</button>
            : <label className="row" style={{ gap: 4 }}>Pack folder:
                <input type="file" {...({ webkitdirectory: '' } as any)}
                  onChange={(e) => { const l = e.target.files; if (l?.length) loadPack(() => filesFromFileList(l), 'pack folder'); e.currentTarget.value = ''; }} />
              </label>}
          <label className="row" style={{ gap: 4 }}>Pack .zip:
            <input type="file" accept=".zip,application/zip" onChange={(e) => { const f = e.target.files?.[0]; if (f) loadPack(() => filesFromZip(f), f.name); e.currentTarget.value = ''; }} style={{ maxWidth: 220 }} />
          </label>
          {restore && <button onClick={() => { setRestore(null); setOptions(DEFAULT_OPTIONS); }}>Clear</button>}
        </div>
        {restore && (
          <p className="small">
            Loaded <strong>{restore.label}</strong>. Transcription and speaker detection will be skipped; audio is re-taken from the selected video.
            {restore.data.kind === 'pack' && restore.data.pack.warnings.length > 0 &&
              <span className="warn"> {restore.data.pack.warnings.length} warning(s) — details shown on the review screen.</span>}
          </p>
        )}
        {restoreError && <p className="warn small">{restoreError}</p>}
      </fieldset>

      <details className="options" open={!restore}>
        <summary>Processing options{restore ? ' (only separation/device are used when restoring)' : ''}</summary>
        <ProcessingOptionsFields options={options} onChange={setOptions} disabled={!!restore} />
      </details>

      <fieldset className="panel">
        <legend>Additional audio tracks (optional)</legend>
        {restore ? (
          <p className="muted small">Additional tracks are not available when restoring a saved review or pack.</p>
        ) : (
          <>
            <p className="muted small">
              Each track can be added as a <strong>dub</strong> track (its own alternate lines — set "Vocal
              separation" to "None" in its Track options to skip separation and use the raw track) or a{' '}
              <strong>background</strong> track (music/ambience only — mixed straight into the exported backing
              track, no analysis).
            </p>
            <label className="row" style={{ gap: 4 }}>
              <input type="file" accept="audio/*,video/*" multiple onChange={(e) => { if (e.target.files?.length) takeExtraTracks(e.target.files); e.currentTarget.value = ''; }} />
            </label>
            {extraTracks.some((t) => t.kind === 'dub') && (
              <button className="small" onClick={applyMainSettingsToAllTracks} title="Copy the main track's processing options to every dub track">
                Apply main track settings to all dub tracks
              </button>
            )}
            {extraTracks.map((t) => (
              <div key={t.id} className="track-row">
                <div className="row" style={{ gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <input
                    value={t.label} onChange={(e) => updateExtraTrack(t.id, { label: e.target.value })}
                    style={{ maxWidth: 180 }}
                  />
                  <select
                    value={t.kind}
                    onChange={(e) => {
                      const kind = e.target.value as 'dub' | 'background';
                      if (kind === 'dub') updateExtraTrack(t.id, { kind, options: { ...DEFAULT_OPTIONS } } as Partial<ExtraTrackInput>);
                      else updateExtraTrack(t.id, { kind } as Partial<ExtraTrackInput>);
                    }}
                  >
                    <option value="dub">Dub track</option>
                    <option value="background">Background track</option>
                  </select>
                  <button className="icon danger" title="Remove this track" onClick={() => removeExtraTrack(t.id)}>🗑</button>
                </div>
                {t.kind === 'dub' && (
                  <details>
                    <summary className="small">Track options</summary>
                    <ProcessingOptionsFields options={t.options} onChange={(o) => updateExtraTrack(t.id, { options: o })} />
                  </details>
                )}
              </div>
            ))}
          </>
        )}
      </fieldset>

      <button className="primary" disabled={!file} onClick={() => file && onStart(file, options, extraTracks, restore?.data ?? null)}>
        {restore ? 'Restore session' : 'Build voice pack'}
      </button>
    </div>
  );
}
