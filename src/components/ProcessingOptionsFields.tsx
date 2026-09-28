import type { PipelineOptions } from '../types';

const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;

const WHISPER_MODELS = [
  ['onnx-community/whisper-tiny', 'tiny (fastest)'],
  ['onnx-community/whisper-base', 'base'],
  ['onnx-community/whisper-small', 'small'],
  ['onnx-community/whisper-large-v3-turbo', 'large-v3-turbo (best, WebGPU only realistically)'],
];
const LANGUAGES = [['auto', 'Auto-detect'], ['en', 'English'], ['ja', 'Japanese'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['zh', 'Chinese'], ['ko', 'Korean'], ['ru', 'Russian'], ['pt', 'Portuguese'], ['it', 'Italian']];

export function ProcessingOptionsFields({ options, onChange, disabled = false }: {
  options: PipelineOptions; onChange: (options: PipelineOptions) => void; disabled?: boolean;
}) {
  const set = <K extends keyof PipelineOptions>(k: K, v: PipelineOptions[K]) => onChange({ ...options, [k]: v });
  return (
    <div className="grid">
      <label>Compute device
        <select value={options.device} disabled={disabled} onChange={(e) => set('device', e.target.value as any)}>
          <option value="webgpu" disabled={!hasWebGPU}>WebGPU {hasWebGPU ? '' : '(unavailable)'}</option>
          <option value="wasm">CPU (WebAssembly)</option>
        </select>
      </label>
      <label>Vocal separation
        <select value={options.separation} disabled={disabled} onChange={(e) => set('separation', e.target.value as any)}>
          <option value="mdx-net">MDX-Net (best quality, slow)</option>
          <option value="phase-cancel">Phase cancellation (fast, low quality)</option>
          <option value="none">None (no backing track)</option>
        </select>
      </label>
      <label>Whisper model
        <select value={options.whisperModel} disabled={disabled} onChange={(e) => set('whisperModel', e.target.value)}>
          {WHISPER_MODELS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </label>
      <label>Language
        <select value={options.language} disabled={disabled} onChange={(e) => set('language', e.target.value)}>
          {LANGUAGES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={options.transcribe} disabled={disabled} onChange={(e) => set('transcribe', e.target.checked)} /> Transcribe captions
      </label>
      <label className="check">
        <input type="checkbox" checked={options.diarize} disabled={disabled} onChange={(e) => set('diarize', e.target.checked)} /> Auto-group speakers
      </label>
      <label>Speaker similarity threshold ({options.clusterThreshold.toFixed(2)})
        <input type="range" min={0.4} max={0.95} step={0.01} value={options.clusterThreshold} disabled={disabled || !options.diarize} onChange={(e) => set('clusterThreshold', +e.target.value)} />
        <span className="muted">Lower → more speakers</span>
      </label>
      <label>Segment detection
        <select value={options.detection} disabled={disabled} onChange={(e) => set('detection', e.target.value as any)}>
          <option value="speech">Speech only (Silero VAD)</option>
          <option value="energy">Any sound above a noise floor</option>
        </select>
      </label>
      <label>Min silence between lines (ms)
        <input type="number" min={50} step={50} value={options.minSilenceMs} disabled={disabled} onChange={(e) => set('minSilenceMs', +e.target.value)} />
      </label>
      <label>Min line length (ms)
        <input type="number" min={50} step={50} value={options.minSpeechMs} disabled={disabled} onChange={(e) => set('minSpeechMs', +e.target.value)} />
      </label>
      <label>Max line length (s)
        <input type="number" min={3} step={1} value={options.maxLineSec} disabled={disabled} onChange={(e) => set('maxLineSec', +e.target.value)} />
      </label>
      {options.detection === 'speech' ? (
        <label>Speech sensitivity ({options.vadThreshold.toFixed(2)})
          <input type="range" min={0.2} max={0.9} step={0.05} value={options.vadThreshold} disabled={disabled} onChange={(e) => set('vadThreshold', +e.target.value)} />
        </label>
      ) : (
        <label>Noise floor ({options.energyThreshold.toFixed(2)})
          <input type="range" min={0.02} max={0.6} step={0.01} value={options.energyThreshold} disabled={disabled} onChange={(e) => set('energyThreshold', +e.target.value)} />
          <span className="muted">Lower → catches quieter sound</span>
        </label>
      )}
    </div>
  );
}
