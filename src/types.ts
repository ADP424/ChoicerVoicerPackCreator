export interface Word { text: string; start: number; end: number }

export interface PackLine {
  id: string;
  start: number;
  end: number;
  caption: string;
  speakerId: string;
  words: Word[];
  imageFile: File | null;
  included: boolean;
}

export interface Speaker { id: string; name: string; portraitFile: File | null }

export interface PackMetadata { title: string; authors: string[]; readme: string; iconFile: File | null }

export interface PcmAudio { sampleRate: number; channels: Float32Array[] }

export type BackingQuality = 'mdx-net' | 'phase-cancel-fallback' | 'none';
export type Device = 'webgpu' | 'wasm';

export interface PipelineOptions {
  device: Device;
  separation: 'mdx-net' | 'phase-cancel' | 'none';
  whisperModel: string;
  language: string; // 'auto' or ISO code
  diarize: boolean;
  clusterThreshold: number;
  vadThreshold: number;
  minSilenceMs: number;
  minSpeechMs: number;
  maxLineSec: number;
}

export interface PipelineResult {
  vocals: PcmAudio;
  backing: PcmAudio | null;
  backingQuality: BackingQuality;
  diarizationAvailable: boolean;
  lines: PackLine[];
  speakers: Speaker[];
}

export interface Draft extends PipelineResult {
  sourceFile: File;
  mix: PcmAudio;
  videoBlob: Blob;
  videoExt: string;
  videoStripped: boolean;
  metadata: PackMetadata;
  options: PipelineOptions;
  importWarnings: string[];
}

export type WorkerIn = { type: 'run'; mix: PcmAudio; options: PipelineOptions; skipAnalysis: boolean };
export type WorkerOut =
  | { type: 'progress'; stage: string; message: string; fraction?: number }
  | { type: 'result'; result: PipelineResult }
  | { type: 'error'; message: string };

export type Progress = (stage: string, message: string, fraction?: number) => void;

/** Saved review: everything except images. */
export interface ReviewFile {
  format: 'choicervoicer-review';
  version: 1;
  savedAt: string;
  source: { name: string; size: number; durationSec: number };
  options: PipelineOptions;
  metadata: { title: string; authors: string[]; readme: string };
  speakers: Array<{ id: string; name: string }>;
  lines: Array<Pick<PackLine, 'id' | 'start' | 'end' | 'caption' | 'speakerId' | 'words' | 'included'>>;
}

/** State recovered from an exported voice pack (includes images, unlike ReviewFile). */
export interface PackRestore {
  metadata: PackMetadata;
  speakers: Speaker[];
  lines: PackLine[];
  warnings: string[];
  label: string;
}

export type RestoreData =
  | { kind: 'review'; review: ReviewFile }
  | { kind: 'pack'; pack: PackRestore };
