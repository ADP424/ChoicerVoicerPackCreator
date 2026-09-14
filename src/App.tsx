import { useRef, useState } from 'react';
import type { Draft, PcmAudio, PipelineOptions, PipelineResult, RestoreData, WorkerIn, WorkerOut } from './types';
import { decodeAudioBlob } from './lib/audio';
import { extOf, extractWav, stripAudio } from './lib/ffmpeg';
import { applyReview } from './lib/reviewFile';
import { fitPackToDuration } from './lib/importPack';
import { FilePicker } from './components/FilePicker';
import { ProcessingView } from './components/ProcessingView';
import { ReviewScreen } from './components/ReviewScreen';

type Phase =
  | { kind: 'pick' }
  | { kind: 'processing'; stage: string; message: string; fraction?: number }
  | { kind: 'review'; draft: Draft }
  | { kind: 'error'; message: string };

function runWorker(
  mix: PcmAudio, options: PipelineOptions, skipAnalysis: boolean,
  onProgress: (s: string, m: string, f?: number) => void, ref: React.MutableRefObject<Worker | null>,
) {
  return new Promise<PipelineResult>((resolve, reject) => {
    const worker = new Worker(new URL('./workers/pipeline.worker.ts', import.meta.url), { type: 'module' });
    ref.current = worker;
    worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data;
      if (m.type === 'progress') onProgress(m.stage, m.message, m.fraction);
      else { worker.terminate(); ref.current = null; m.type === 'result' ? resolve(m.result) : reject(new Error(m.message)); }
    };
    worker.onerror = (e) => { worker.terminate(); ref.current = null; reject(new Error(e.message || 'Worker crashed')); };
    const copy: PcmAudio = { sampleRate: mix.sampleRate, channels: mix.channels.map((c) => c.slice()) };
    worker.postMessage({ type: 'run', mix: copy, options, skipAnalysis } satisfies WorkerIn, copy.channels.map((c) => c.buffer));
  });
}

export default function App() {
  const [phase, setPhase] = useState<Phase>({ kind: 'pick' });
  const workerRef = useRef<Worker | null>(null);
  const cancelled = useRef(false);

  const cancel = () => { cancelled.current = true; workerRef.current?.terminate(); workerRef.current = null; setPhase({ kind: 'pick' }); };

  async function start(file: File, options: PipelineOptions, restore: RestoreData | null) {
    cancelled.current = false;
    const progress = (stage: string, message: string, fraction?: number) => { if (!cancelled.current) setPhase({ kind: 'processing', stage, message, fraction }); };
    try {
      progress('extract', 'Decoding audio…');
      let mix: PcmAudio;
      try { mix = await decodeAudioBlob(file); }
      catch { progress('extract', 'Browser could not decode this file directly — extracting audio with ffmpeg.wasm…'); mix = await decodeAudioBlob(await extractWav(file)); }
      if (cancelled.current) return;

      progress('extract', 'Removing audio from the video track (ffmpeg.wasm)…');
      let video: { blob: Blob; ext: string; stripped: boolean };
      try { video = { ...(await stripAudio(file)), stripped: true }; }
      catch (err) { console.warn(err); video = { blob: file, ext: extOf(file.name) || 'mp4', stripped: false }; }
      if (cancelled.current) return;

      const result = await runWorker(mix, options, restore !== null, progress, workerRef);
      if (cancelled.current) return;

      const durationSec = mix.channels[0].length / mix.sampleRate;
      let draft: Draft = {
        ...result, sourceFile: file, mix, videoBlob: video.blob, videoExt: video.ext, videoStripped: video.stripped,
        metadata: { title: file.name.replace(/\.[^.]+$/, ''), authors: [], readme: '', iconFile: null },
        options, importWarnings: [],
      };
      if (restore?.kind === 'review') {
        const { snapshot, warnings } = applyReview(restore.review, { name: file.name, size: file.size, durationSec }, draft.metadata);
        draft = { ...draft, ...snapshot, importWarnings: warnings };
      } else if (restore?.kind === 'pack') {
        const fitted = fitPackToDuration(restore.pack, durationSec);
        draft = {
          ...draft,
          lines: fitted.lines,
          speakers: fitted.speakers,
          metadata: { ...fitted.metadata, title: fitted.metadata.title || draft.metadata.title },
          importWarnings: fitted.warnings,
        };
      }
      setPhase({ kind: 'review', draft });
    } catch (err) {
      if (!cancelled.current) setPhase({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  switch (phase.kind) {
    case 'pick': return <FilePicker onStart={start} />;
    case 'processing': return <ProcessingView {...phase} onCancel={cancel} />;
    case 'review': return <ReviewScreen draft={phase.draft} onRestart={() => setPhase({ kind: 'pick' })} />;
    case 'error': return (
      <div className="picker">
        <h2>Pipeline failed</h2>
        <pre className="notice error">{phase.message}</pre>
        <button onClick={() => setPhase({ kind: 'pick' })}>Back</button>
      </div>
    );
  }
}
