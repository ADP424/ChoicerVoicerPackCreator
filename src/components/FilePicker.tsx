import { useState } from 'react';
import type { PipelineOptions, RestoreData } from '../types';
import { readReviewFile } from '../lib/reviewFile';
import { filesFromDirectoryHandle, filesFromFileList, filesFromZip, parsePack } from '../lib/importPack';

const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;
const canPickDirectory = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

export const DEFAULT_OPTIONS: PipelineOptions = {
  device: hasWebGPU ? 'webgpu' : 'wasm',
  separation: 'mdx-net',
  whisperModel: hasWebGPU ? 'onnx-community/whisper-small' : 'onnx-community/whisper-base',
  language: 'auto',
  diarize: true,
  clusterThreshold: 0.7,
  vadThreshold: 0.5,
  minSilenceMs: 300,
  minSpeechMs: 250,
  maxLineSec: 20,
};

const WHISPER_MODELS = [
  ['onnx-community/whisper-tiny', 'tiny (fastest)'],
  ['onnx-community/whisper-base', 'base'],
  ['onnx-community/whisper-small', 'small'],
  ['onnx-community/whisper-large-v3-turbo', 'large-v3-turbo (best, WebGPU only realistically)'],
];
const LANGUAGES = [['auto', 'Auto-detect'], ['en', 'English'], ['ja', 'Japanese'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['zh', 'Chinese'], ['ko', 'Korean'], ['ru', 'Russian'], ['pt', 'Portuguese'], ['it', 'Italian']];

export function FilePicker({ onStart }: { onStart: (file: File, options: PipelineOptions, restore: RestoreData | null) => void }) {
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const [file, setFile] = useState<File | null>(null);
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
        <div className="grid">
          <label>Compute device
            <select value={options.device} onChange={(e) => set('device', e.target.value as any)}>
              <option value="webgpu" disabled={!hasWebGPU}>WebGPU {hasWebGPU ? '' : '(unavailable)'}</option>
              <option value="wasm">CPU (WebAssembly)</option>
            </select>
          </label>
          <label>Vocal separation
            <select value={options.separation} onChange={(e) => set('separation', e.target.value as any)}>
              <option value="mdx-net">MDX-Net (best quality, slow)</option>
              <option value="phase-cancel">Phase cancellation (fast, low quality)</option>
              <option value="none">None (no backing track)</option>
            </select>
          </label>
          <label>Whisper model
            <select value={options.whisperModel} disabled={!!restore} onChange={(e) => set('whisperModel', e.target.value)}>
              {WHISPER_MODELS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          <label>Language
            <select value={options.language} disabled={!!restore} onChange={(e) => set('language', e.target.value)}>
              {LANGUAGES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={options.diarize} disabled={!!restore} onChange={(e) => set('diarize', e.target.checked)} /> Auto-group speakers
          </label>
          <label>Speaker similarity threshold ({options.clusterThreshold.toFixed(2)})
            <input type="range" min={0.4} max={0.95} step={0.01} value={options.clusterThreshold} disabled={!!restore || !options.diarize} onChange={(e) => set('clusterThreshold', +e.target.value)} />
            <span className="muted">Lower → more speakers</span>
          </label>
          <label>Min silence between lines (ms)
            <input type="number" min={50} step={50} value={options.minSilenceMs} disabled={!!restore} onChange={(e) => set('minSilenceMs', +e.target.value)} />
          </label>
          <label>Min line length (ms)
            <input type="number" min={50} step={50} value={options.minSpeechMs} disabled={!!restore} onChange={(e) => set('minSpeechMs', +e.target.value)} />
          </label>
          <label>Max line length (s)
            <input type="number" min={3} step={1} value={options.maxLineSec} disabled={!!restore} onChange={(e) => set('maxLineSec', +e.target.value)} />
          </label>
          <label>Speech sensitivity ({options.vadThreshold.toFixed(2)})
            <input type="range" min={0.2} max={0.9} step={0.05} value={options.vadThreshold} disabled={!!restore} onChange={(e) => set('vadThreshold', +e.target.value)} />
          </label>
        </div>
      </details>

      <button className="primary" disabled={!file} onClick={() => file && onStart(file, options, restore?.data ?? null)}>
        {restore ? 'Restore session' : 'Build voice pack'}
      </button>
    </div>
  );
}
