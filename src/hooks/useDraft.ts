import { useReducer } from 'react';
import type { Draft, PackLine, PackMetadata, Speaker } from '../types';

const MAX_HISTORY = 3;

interface Snapshot { lines: PackLine[]; speakers: Speaker[] }
export interface EditorState extends Snapshot { metadata: PackMetadata; past: Snapshot[]; future: Snapshot[] }

export type EditorAction =
  | { type: 'updateLine'; id: string; patch: Partial<PackLine> }
  | { type: 'splitLine'; id: string; at: number }
  | { type: 'mergeWithNext'; id: string }
  | { type: 'addLine'; id: string; start: number; end: number; afterId: string | null; trackId: string }
  | { type: 'removeLine'; id: string }
  | { type: 'addSpeaker' }
  | { type: 'newSpeakerForLine'; id: string }
  | { type: 'renameSpeaker'; id: string; name: string }
  | { type: 'setPortrait'; id: string; file: File | null }
  | { type: 'mergeSpeakers'; sourceIds: string[]; targetId: string }
  | { type: 'removeSpeaker'; id: string }
  | { type: 'setMetadata'; patch: Partial<PackMetadata> }
  | { type: 'loadReview'; lines: PackLine[]; speakers: Speaker[]; metadata: PackMetadata }
  | { type: 'undo' } | { type: 'redo' };

const uuid = () => crypto.randomUUID();

function nextSpeakerId(speakers: Speaker[]): string {
  let n = speakers.length + 1;
  while (speakers.some((s) => s.id === `Speaker ${n}`)) n++;
  return `Speaker ${n}`;
}

function splitLineAt(line: PackLine, at: number): [PackLine, PackLine] {
  let capA: string, capB: string, wordsA: PackLine['words'] = [], wordsB: PackLine['words'] = [];
  if (line.words.length) {
    wordsA = line.words.filter((w) => (w.start + w.end) / 2 < at);
    wordsB = line.words.filter((w) => (w.start + w.end) / 2 >= at);
    capA = wordsA.map((w) => w.text).join(' ');
    capB = wordsB.map((w) => w.text).join(' ');
  } else {
    const tokens = line.caption.split(/\s+/).filter(Boolean);
    const k = Math.round(tokens.length * ((at - line.start) / (line.end - line.start)));
    capA = tokens.slice(0, k).join(' ');
    capB = tokens.slice(k).join(' ');
  }
  return [
    { ...line, end: at, caption: capA, words: wordsA },
    { ...line, id: uuid(), start: at, caption: capB, words: wordsB, imageFile: null },
  ];
}

function commit(state: EditorState, patch: Partial<Snapshot>): EditorState {
  return {
    ...state, ...patch,
    past: [...state.past.slice(-(MAX_HISTORY - 1)), { lines: state.lines, speakers: state.speakers }],
    future: [],
  };
}

function reducer(state: EditorState, a: EditorAction): EditorState {
  switch (a.type) {
    case 'updateLine':
      return commit(state, { lines: state.lines.map((l) => (l.id === a.id ? { ...l, ...a.patch } : l)) });
    case 'splitLine': {
      const line = state.lines.find((l) => l.id === a.id);
      if (!line || a.at <= line.start + 0.05 || a.at >= line.end - 0.05) return state;
      const [x, y] = splitLineAt(line, a.at);
      return commit(state, { lines: state.lines.flatMap((l) => (l.id === a.id ? [x, y] : [l])) });
    }
    case 'mergeWithNext': {
      const cur = state.lines.find((l) => l.id === a.id);
      if (!cur) return state;
      const sameTrack = state.lines.filter((l) => l.trackId === cur.trackId).sort((x, y) => x.start - y.start);
      const i = sameTrack.findIndex((l) => l.id === a.id);
      if (i < 0 || i === sameTrack.length - 1) return state;
      const next = sameTrack[i + 1];
      const merged: PackLine = {
        ...cur, end: Math.max(cur.end, next.end),
        caption: [cur.caption, next.caption].filter(Boolean).join(' '),
        words: [...cur.words, ...next.words],
      };
      return commit(state, { lines: state.lines.filter((l) => l.id !== next.id).map((l) => (l.id === cur.id ? merged : l)) });
    }
    case 'addLine': {
      let speakers = state.speakers;
      if (!speakers.length) speakers = [{ id: 'Speaker 1', name: 'Speaker 1', portraitFile: null }];
      const after = a.afterId ? state.lines.find((l) => l.id === a.afterId) : undefined;
      const line: PackLine = {
        id: a.id, start: a.start, end: a.end, caption: '',
        speakerId: after?.speakerId ?? speakers[0].id, words: [], imageFile: null, included: true,
        trackId: a.trackId,
      };
      const lines = [...state.lines];
      lines.splice(after ? lines.indexOf(after) + 1 : lines.length, 0, line);
      return commit(state, { speakers, lines });
    }
    case 'removeLine':
      return commit(state, { lines: state.lines.filter((l) => l.id !== a.id) });
    case 'addSpeaker': {
      const id = nextSpeakerId(state.speakers);
      return commit(state, { speakers: [...state.speakers, { id, name: id, portraitFile: null }] });
    }
    case 'newSpeakerForLine': {
      const id = nextSpeakerId(state.speakers);
      return commit(state, {
        speakers: [...state.speakers, { id, name: id, portraitFile: null }],
        lines: state.lines.map((l) => (l.id === a.id ? { ...l, speakerId: id } : l)),
      });
    }
    case 'renameSpeaker':
      return commit(state, { speakers: state.speakers.map((s) => (s.id === a.id ? { ...s, name: a.name } : s)) });
    case 'setPortrait':
      return commit(state, { speakers: state.speakers.map((s) => (s.id === a.id ? { ...s, portraitFile: a.file } : s)) });
    case 'mergeSpeakers': {
      const gone = new Set(a.sourceIds.filter((id) => id !== a.targetId));
      return commit(state, {
        speakers: state.speakers.filter((s) => !gone.has(s.id)),
        lines: state.lines.map((l) => (gone.has(l.speakerId) ? { ...l, speakerId: a.targetId } : l)),
      });
    }
    case 'removeSpeaker':
      return commit(state, {
        speakers: state.speakers.filter((s) => s.id !== a.id),
        lines: state.lines.filter((l) => l.speakerId !== a.id),
      });
    case 'setMetadata':
      return { ...state, metadata: { ...state.metadata, ...a.patch } };
    case 'loadReview':
      return { ...commit(state, { lines: a.lines, speakers: a.speakers }), metadata: a.metadata };
    case 'undo': {
      const prev = state.past.at(-1);
      if (!prev) return state;
      return { ...state, ...prev, past: state.past.slice(0, -1), future: [{ lines: state.lines, speakers: state.speakers }, ...state.future].slice(0, MAX_HISTORY) };
    }
    case 'redo': {
      const next = state.future[0];
      if (!next) return state;
      return { ...state, ...next, past: [...state.past, { lines: state.lines, speakers: state.speakers }].slice(-MAX_HISTORY), future: state.future.slice(1) };
    }
  }
}

export function useDraft(draft: Draft) {
  return useReducer(reducer, draft, (d): EditorState => ({
    lines: d.allLines, speakers: d.allSpeakers, metadata: d.metadata, past: [], future: [],
  }));
}
