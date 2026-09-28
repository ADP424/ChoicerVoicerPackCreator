import type { PackLine, PcmAudio, PipelineOptions, PipelineResult, Progress, Speaker, WorkerIn, WorkerOut } from '../types';
import { mixdown, resample } from '../lib/dsp';
import { separate } from '../lib/separation';
import { detectEnergy, detectSpeech } from '../lib/vad';
import { diarize } from '../lib/diarize';
import { loadAsr, transcribeSegment } from '../lib/transcribe';

const post = (m: WorkerOut, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  if (e.data.type !== 'run') return;
  const { trackId, label } = e.data;
  const progress: Progress = (stage, message, fraction) => post({ type: 'progress', stage, message, fraction });
  try {
    const result = await run(e.data.mix, e.data.options, e.data.skipAnalysis, label, progress);
    const lines = result.lines.map((l) => ({ ...l, trackId }));
    const transfer = [...result.vocals.channels, ...(result.backing?.channels ?? [])].map((c) => c.buffer);
    post({ type: 'result', result: { ...result, lines, trackId, label } }, transfer);
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};

async function run(
  mix: PcmAudio, o: PipelineOptions, skipAnalysis: boolean, label: string, progress: Progress,
): Promise<PipelineResult> {
  progress('separate', 'Separating vocals from music/effects…', 0);
  const { vocals, backing, quality } = await separate(mix, o, (f) =>
    progress('separate', `Separating vocals… ${Math.round(f * 100)}%`, f));

  // Restoring from a saved review: lines/speakers come from the JSON, so stop here.
  if (skipAnalysis) {
    progress('done', 'Restoring saved review…');
    return { vocals, backing, backingQuality: quality, diarizationAvailable: true, lines: [], speakers: [] };
  }

  progress('vad', 'Detecting segments…', 0);
  const vocals16k = resample(mixdown(vocals.channels), vocals.sampleRate, 16000);
  const segments = o.detection === 'energy'
    ? await detectEnergy(vocals16k, {
        threshold: o.energyThreshold, minSpeechMs: o.minSpeechMs, minSilenceMs: o.minSilenceMs,
        speechPadMs: 30, maxSpeechSec: o.maxLineSec,
      }, (f) => progress('vad', `Detecting segments… ${Math.round(f * 100)}%`, f))
    : await detectSpeech(vocals16k, {
        modelUrl: `${self.location.origin}${import.meta.env.BASE_URL}models/silero_vad.onnx`,
        threshold: o.vadThreshold, minSpeechMs: o.minSpeechMs, minSilenceMs: o.minSilenceMs,
        speechPadMs: 30, maxSpeechSec: o.maxLineSec,
      }, (f) => progress('vad', `Detecting segments… ${Math.round(f * 100)}%`, f));

  const empty = { vocals, backing, backingQuality: quality, diarizationAvailable: false, lines: [], speakers: [] };
  if (!segments.length) { progress('done', 'No sound detected.'); return empty; }

  let speakerIds = segments.map(() => 'Speaker 1');
  let diarizationAvailable = false;
  if (o.diarize) {
    progress('diarize', 'Computing speaker embeddings…', 0);
    try {
      speakerIds = await diarize(vocals16k, segments, o.clusterThreshold, (f) =>
        progress('diarize', `Computing speaker embeddings… ${Math.round(f * 100)}%`, f));
      diarizationAvailable = true;
    } catch (err) {
      console.warn('Diarization failed', err);
      progress('diarize', 'Diarization unavailable — using a single speaker.');
    }
  }

  const lines: PackLine[] = [];
  if (o.transcribe) {
    progress('transcribe', `Loading ${o.whisperModel}…`);
    const asr = await loadAsr(o.whisperModel, o.device, (m) => progress('transcribe', m));
    const asrAudio = quality === 'mdx-net' ? vocals16k : resample(mixdown(mix.channels), mix.sampleRate, 16000);
    for (let i = 0; i < segments.length; i++) {
      progress('transcribe', `Transcribing line ${i + 1}/${segments.length}…`, i / segments.length);
      const [start, end] = segments[i];
      const { text, words } = await transcribeSegment(asr, asrAudio, start, end, o.language);
      lines.push({ id: crypto.randomUUID(), start, end, caption: text, speakerId: speakerIds[i], words, imageFile: null, included: true, trackId: '' });
    }
    await asr.dispose?.();
  } else {
    progress('transcribe', 'Skipping transcription…', 1);
    for (let i = 0; i < segments.length; i++) {
      const [start, end] = segments[i];
      lines.push({ id: crypto.randomUUID(), start, end, caption: '', speakerId: speakerIds[i], words: [], imageFile: null, included: true, trackId: '' });
    }
  }

  // Default speaker names to the track's own label rather than the generic "Speaker N".
  const uniqueIds = [...new Set(speakerIds)];
  const speakers: Speaker[] = uniqueIds.map((id, i) => ({
    id, name: uniqueIds.length > 1 ? `${label} ${i + 1}` : label, portraitFile: null,
  }));

  progress('done', 'Ready for review.');
  return { vocals, backing, backingQuality: quality, diarizationAvailable, lines, speakers };
}
