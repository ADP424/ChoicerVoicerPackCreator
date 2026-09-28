import { useRef, useState } from 'react';
import type {
  Draft, ExtraTrackInput, PcmAudio, PipelineOptions, RestoreData, Speaker, TrackResult, WorkerIn, WorkerOut,
} from './types';
import { decodeAudioBlob } from './lib/audio';
import { extOf, extractWav, stripAudio } from './lib/ffmpeg';
import { mixTracks } from './lib/dsp';
import { applyReview } from './lib/reviewFile';
import { fitPackToDuration } from './lib/importPack';
import { FilePicker } from './components/FilePicker';
import { ProcessingView } from './components/ProcessingView';
import { ReviewScreen } from './components/ReviewScreen';

type Phase =
  | { kind: 'pick' }
  | { kind: 'processing'; stage: string; message: string; fraction?: number; trackIndex: number; trackCount: number; trackLabel: string }
  | { kind: 'review'; draft: Draft }
  | { kind: 'error'; message: string };

interface TrackJob { trackId: string; label: string; mix: PcmAudio; options: PipelineOptions }

function runWorker(
  jobs: TrackJob[], skipAnalysis: boolean,
  onProgress: (trackIndex: number, trackCount: number, trackLabel: string, s: string, m: string, f?: number) => void,
  ref: React.MutableRefObject<Worker | null>,
) {
  return new Promise<TrackResult[]>((resolve, reject) => {
    const worker = new Worker(new URL('./workers/pipeline.worker.ts', import.meta.url), { type: 'module' });
    ref.current = worker;
    const results: TrackResult[] = [];
    let i = 0;
    const sendNext = () => {
      const job = jobs[i];
      const copy: PcmAudio = { sampleRate: job.mix.sampleRate, channels: job.mix.channels.map((c) => c.slice()) };
      worker.postMessage(
        { type: 'run', trackId: job.trackId, label: job.label, mix: copy, options: job.options, skipAnalysis } satisfies WorkerIn,
        copy.channels.map((c) => c.buffer),
      );
    };
    worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data;
      if (m.type === 'progress') { onProgress(i, jobs.length, jobs[i].label, m.stage, m.message, m.fraction); return; }
      if (m.type === 'error') { worker.terminate(); ref.current = null; reject(new Error(m.message)); return; }
      results.push(m.result);
      i++;
      if (i < jobs.length) sendNext();
      else { worker.terminate(); ref.current = null; resolve(results); }
    };
    worker.onerror = (e) => { worker.terminate(); ref.current = null; reject(new Error(e.message || 'Worker crashed')); };
    sendNext();
  });
}

/** Namespaces a non-main track's speaker ids so they can't collide with another track's. */
function namespaceSpeakers(result: TrackResult): TrackResult {
  const remap = new Map(result.speakers.map((s) => [s.id, `${result.trackId}:${s.id}`]));
  return {
    ...result,
    speakers: result.speakers.map((s) => ({ ...s, id: remap.get(s.id)! })),
    lines: result.lines.map((l) => ({ ...l, speakerId: remap.get(l.speakerId) ?? l.speakerId })),
  };
}

function dedupeSpeakers(speakers: Speaker[]): Speaker[] {
  const seen = new Set<string>();
  return speakers.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
}

export default function App() {
  const [phase, setPhase] = useState<Phase>({ kind: 'pick' });
  const workerRef = useRef<Worker | null>(null);
  const cancelled = useRef(false);

  const cancel = () => { cancelled.current = true; workerRef.current?.terminate(); workerRef.current = null; setPhase({ kind: 'pick' }); };

  async function start(file: File, options: PipelineOptions, extraTracks: ExtraTrackInput[], restore: RestoreData | null) {
    cancelled.current = false;
    const progress = (
      trackIndex: number, trackCount: number, trackLabel: string, stage: string, message: string, fraction?: number,
    ) => { if (!cancelled.current) setPhase({ kind: 'processing', stage, message, fraction, trackIndex, trackCount, trackLabel }); };
    const soloProgress = (stage: string, message: string, fraction?: number) => progress(0, 1, '', stage, message, fraction);
    try {
      // Restoring a saved review/pack always re-runs against a single freshly picked video.
      if (restore !== null) extraTracks = [];

      soloProgress('extract', 'Decoding audio…');
      let mix: PcmAudio;
      try { mix = await decodeAudioBlob(file); }
      catch {
        mix = await decodeAudioBlob(await extractWav(file, (f) =>
          soloProgress('extract', `Browser could not decode this file directly — extracting audio with ffmpeg.wasm… ${Math.round(f * 100)}%`, f)));
      }
      if (cancelled.current) return;

      soloProgress('extract', 'Re-encoding video without audio (ffmpeg.wasm, Theora — this can take a while for large videos)…', 0);
      let video: { blob: Blob; ext: string; stripped: boolean };
      try {
        video = {
          ...(await stripAudio(file, (f) => soloProgress('extract', `Re-encoding video without audio (ffmpeg.wasm, Theora — this can take a while for large videos)… ${Math.round(f * 100)}%`, f))),
          stripped: true,
        };
      } catch (err) { console.warn(err); video = { blob: file, ext: extOf(file.name) || 'mp4', stripped: false }; }
      if (cancelled.current) return;

      const dubTracks = extraTracks.filter((t) => t.kind === 'dub');
      const backgroundTracks = extraTracks.filter((t) => t.kind === 'background');

      // ffmpeg.wasm runs as one shared instance with a single virtual filesystem, so its
      // calls (the extractWav fallback below) must never overlap — tracks are decoded
      // one at a time, not with Promise.all, even though decoding itself is otherwise
      // independent per track.
      const decodeOne = async (f: File, label: string) => {
        soloProgress('extract', `Decoding "${label}"…`);
        try { return await decodeAudioBlob(f); }
        catch {
          return await decodeAudioBlob(await extractWav(f, (fr) =>
            soloProgress('extract', `Browser could not decode "${label}" directly — extracting audio with ffmpeg.wasm… ${Math.round(fr * 100)}%`, fr)));
        }
      };
      const decodedDub: PcmAudio[] = [];
      for (const t of dubTracks) decodedDub.push(await decodeOne(t.file, t.label));
      const decodedBackground: PcmAudio[] = [];
      for (const t of backgroundTracks) decodedBackground.push(await decodeOne(t.file, t.label));
      if (cancelled.current) return;

      const jobs: TrackJob[] = [
        { trackId: 'main', label: 'Main', mix, options },
        ...dubTracks.map((t, i) => ({ trackId: t.id, label: t.label, mix: decodedDub[i], options: t.options })),
      ];

      const results = await runWorker(jobs, restore !== null, progress, workerRef);
      if (cancelled.current) return;

      const [mainResult, ...extraResultsRaw] = results;
      const extraResults = extraResultsRaw.map(namespaceSpeakers);

      let backgroundBacking: PcmAudio | null = null;
      const backingSources = [
        ...(mainResult.backing ? [mainResult.backing] : []),
        ...decodedBackground,
      ];
      if (backingSources.length) {
        soloProgress('extract', 'Mixing background tracks…');
        backgroundBacking = mixTracks(backingSources, mix.sampleRate);
      }

      const allLines = [...mainResult.lines, ...extraResults.flatMap((r) => r.lines)].sort((a, b) => a.start - b.start);
      const allSpeakers = dedupeSpeakers([...mainResult.speakers, ...extraResults.flatMap((r) => r.speakers)]);

      const durationSec = mix.channels[0].length / mix.sampleRate;
      let draft: Draft = {
        vocals: mainResult.vocals, backing: mainResult.backing, backingQuality: mainResult.backingQuality,
        diarizationAvailable: mainResult.diarizationAvailable, lines: mainResult.lines, speakers: mainResult.speakers,
        sourceFile: file, mix, videoBlob: video.blob, videoExt: video.ext, videoStripped: video.stripped,
        metadata: { title: file.name.replace(/\.[^.]+$/, ''), authors: [], readme: '', iconFile: null },
        options, importWarnings: [],
        extraTracks: extraResults.map((r, i) => ({ ...r, rawMix: decodedDub[i] })),
        backgroundBacking, allLines, allSpeakers,
      };
      if (restore?.kind === 'review') {
        const { snapshot, warnings } = applyReview(restore.review, { name: file.name, size: file.size, durationSec }, draft.metadata);
        draft = { ...draft, ...snapshot, allLines: snapshot.lines, allSpeakers: snapshot.speakers, importWarnings: warnings };
      } else if (restore?.kind === 'pack') {
        const fitted = fitPackToDuration(restore.pack, durationSec);
        draft = {
          ...draft,
          lines: fitted.lines,
          speakers: fitted.speakers,
          allLines: fitted.lines,
          allSpeakers: fitted.speakers,
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
