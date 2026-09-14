import { useCallback, useEffect, useRef, useState } from 'react';
import type { PcmAudio } from '../types';
import { toAudioBuffer } from '../lib/audio';

export type Track = 'mix' | 'vocals';
export interface Player {
  play: (start: number, end: number, track: Track, key: string) => void;
  stop: () => void;
  playing: string | null;
  position: () => number | null; // absolute seconds into the source, or null
}

export function usePlayer(mix: PcmAudio, vocals: PcmAudio): Player {
  const ctx = useRef<AudioContext | null>(null);
  const buffers = useRef<Partial<Record<Track, AudioBuffer>>>({});
  const src = useRef<AudioBufferSourceNode | null>(null);
  const startInfo = useRef<{ ctxTime: number; offset: number; end: number } | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  const stop = useCallback(() => {
    try { src.current?.stop(); } catch { /* already stopped */ }
    src.current = null; startInfo.current = null; setPlaying(null);
  }, []);

  const play = useCallback((start: number, end: number, track: Track, key: string) => {
    stop();
    const c = (ctx.current ??= new AudioContext());
    const buf = (buffers.current[track] ??= toAudioBuffer(c, track === 'mix' ? mix : vocals));
    const node = c.createBufferSource();
    node.buffer = buf;
    node.connect(c.destination);
    node.onended = () => { if (src.current === node) { src.current = null; startInfo.current = null; setPlaying(null); } };
    node.start(0, start, Math.max(0.05, end - start));
    src.current = node;
    startInfo.current = { ctxTime: c.currentTime, offset: start, end };
    setPlaying(key);
  }, [mix, vocals, stop]);

  const position = useCallback(() => {
    const s = startInfo.current, c = ctx.current;
    if (!s || !c) return null;
    const t = s.offset + (c.currentTime - s.ctxTime);
    return t > s.end ? null : t;
  }, []);

  useEffect(() => () => { stop(); ctx.current?.close(); }, [stop]);
  return { play, stop, playing, position };
}
