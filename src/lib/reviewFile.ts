import type { PackLine, PackMetadata, PipelineOptions, ReviewFile, Speaker } from '../types';

export interface ReviewSnapshot { lines: PackLine[]; speakers: Speaker[]; metadata: PackMetadata }

export function serializeReview(
  snapshot: ReviewSnapshot, options: PipelineOptions, source: File, durationSec: number,
): string {
  const file: ReviewFile = {
    format: 'choicervoicer-review',
    version: 1,
    savedAt: new Date().toISOString(),
    source: { name: source.name, size: source.size, durationSec },
    options,
    metadata: { title: snapshot.metadata.title, authors: snapshot.metadata.authors, readme: snapshot.metadata.readme },
    speakers: snapshot.speakers.map(({ id, name }) => ({ id, name })),
    lines: [...snapshot.lines]
      .sort((a, b) => a.start - b.start)
      .map(({ id, start, end, caption, speakerId, words, included }) => ({ id, start, end, caption, speakerId, words, included })),
  };
  return JSON.stringify(file, null, 2);
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

/** Parses and structurally validates a review file. Throws a readable error on failure. */
export function parseReview(text: string): ReviewFile {
  let raw: any;
  try { raw = JSON.parse(text); } catch { throw new Error('Not valid JSON.'); }
  if (raw?.format !== 'choicervoicer-review') throw new Error('This is not a ChoicerVoicer review file.');
  if (raw.version !== 1) throw new Error(`Unsupported review file version ${raw.version}.`);
  if (!Array.isArray(raw.lines) || !Array.isArray(raw.speakers)) throw new Error('Review file is missing lines or speakers.');
  for (const [i, l] of raw.lines.entries()) {
    if (!isStr(l.id) || !isNum(l.start) || !isNum(l.end) || !isStr(l.caption) || !isStr(l.speakerId)) {
      throw new Error(`Line ${i} is malformed.`);
    }
  }
  for (const s of raw.speakers) if (!isStr(s.id) || !isStr(s.name)) throw new Error('A speaker entry is malformed.');
  return raw as ReviewFile;
}

/**
 * Turns a parsed review into editor state for a given source, repairing what it can
 * and reporting what it couldn't as warnings.
 */
export function applyReview(
  review: ReviewFile, source: { name: string; size: number; durationSec: number }, currentMetadata: PackMetadata,
): { snapshot: ReviewSnapshot; warnings: string[] } {
  const warnings: string[] = [];
  if (review.source.name !== source.name) warnings.push(`Review was saved for "${review.source.name}", but the selected video is "${source.name}".`);
  else if (review.source.size !== source.size) warnings.push('The video file has the same name but a different size than when the review was saved.');
  if (Math.abs(review.source.durationSec - source.durationSec) > 0.5) {
    warnings.push(`Audio duration differs (${review.source.durationSec.toFixed(1)}s saved vs ${source.durationSec.toFixed(1)}s now); line timings may be off.`);
  }

  const speakers: Speaker[] = review.speakers.map(({ id, name }) => ({ id, name, portraitFile: null }));
  const known = new Set(speakers.map((s) => s.id));
  const seenLineIds = new Set<string>();
  const lines: PackLine[] = [];
  let clamped = 0, dropped = 0;

  for (const l of review.lines) {
    if (!known.has(l.speakerId)) {
      speakers.push({ id: l.speakerId, name: l.speakerId, portraitFile: null });
      known.add(l.speakerId);
      warnings.push(`Speaker "${l.speakerId}" was referenced by a line but not defined; it was recreated.`);
    }
    let { start, end } = l;
    if (start >= source.durationSec) { dropped++; continue; }
    if (end > source.durationSec) { end = source.durationSec; clamped++; }
    if (end <= start) { dropped++; continue; }
    const id = seenLineIds.has(l.id) ? crypto.randomUUID() : l.id;
    seenLineIds.add(id);
    lines.push({
      id, start, end, caption: l.caption, speakerId: l.speakerId,
      words: Array.isArray(l.words) ? l.words.filter((w) => isStr(w?.text) && isNum(w?.start) && isNum(w?.end)) : [],
      imageFile: null, included: l.included !== false, trackId: 'main',
    });
  }
  if (clamped) warnings.push(`${clamped} line(s) extended past the end of the audio and were clamped.`);
  if (dropped) warnings.push(`${dropped} line(s) lay entirely outside the audio and were dropped.`);

  const metadata: PackMetadata = {
    title: review.metadata?.title ?? currentMetadata.title,
    authors: Array.isArray(review.metadata?.authors) ? review.metadata.authors : currentMetadata.authors,
    readme: review.metadata?.readme ?? currentMetadata.readme,
    iconFile: currentMetadata.iconFile, // images are never part of the review file
  };
  return { snapshot: { lines, speakers, metadata }, warnings };
}

export async function readReviewFile(file: File): Promise<ReviewFile> {
  return parseReview(await file.text());
}
