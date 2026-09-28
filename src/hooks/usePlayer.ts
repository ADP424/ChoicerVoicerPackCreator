import { useCallback, useEffect, useRef, useState } from 'react';
import type { PcmAudio } from '../types';
import { toAudioBuffer } from '../lib/audio';

export type TrackKind = 'mix' | 'vocals';
export interface Player {
  play: (start: number, end: number, trackId: string, kind: TrackKind, key: string) => void;
  /** Plays every track's own mix plus the backing track (if any), all at once, for the same [start, end] window. */
  playAll: (start: number, end: number, key: string) => void;
  stop: () => void;
  playing: string | null;
  position: () => number | null; // absolute seconds into the source, or null
}

export function usePlayer(sources: Map<string, { mix: PcmAudio; vocals: PcmAudio }>, backing: PcmAudio | null): Player {
  const ctx = useRef<AudioContext | null>(null);
  const buffers = useRef<Map<string, AudioBuffer>>(new Map());
  const nodes = useRef<AudioBufferSourceNode[]>([]);
  const startInfo = useRef<{ ctxTime: number; offset: number; end: number } | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  const stop = useCallback(() => {
    for (const n of nodes.current) { try { n.stop(); } catch { /* already stopped */ } }
    nodes.current = []; startInfo.current = null; setPlaying(null);
  }, []);

  const getBuffer = useCallback((c: AudioContext, cacheKey: string, audio: PcmAudio) => {
    let buf = buffers.current.get(cacheKey);
    if (!buf) { buf = toAudioBuffer(c, audio); buffers.current.set(cacheKey, buf); }
    return buf;
  }, []);

  const startNode = useCallback((c: AudioContext, buf: AudioBuffer, start: number, dur: number, onEnded?: () => void) => {
    if (start >= buf.duration) { onEnded?.(); return null; }
    const node = c.createBufferSource();
    node.buffer = buf;
    node.connect(c.destination);
    if (onEnded) node.onended = onEnded;
    node.start(0, start, Math.min(dur, buf.duration - start));
    nodes.current.push(node);
    return node;
  }, []);

  const play = useCallback((start: number, end: number, trackId: string, kind: TrackKind, key: string) => {
    stop();
    const source = sources.get(trackId);
    if (!source) return;
    const c = (ctx.current ??= new AudioContext());
    const buf = getBuffer(c, `${trackId}:${kind}`, kind === 'mix' ? source.mix : source.vocals);
    const dur = Math.max(0.05, end - start);
    const onEnded = () => { nodes.current = []; startInfo.current = null; setPlaying(null); };
    if (!startNode(c, buf, start, dur, onEnded)) return;
    startInfo.current = { ctxTime: c.currentTime, offset: start, end };
    setPlaying(key);
  }, [sources, stop, getBuffer, startNode]);

  const playAll = useCallback((start: number, end: number, key: string) => {
    stop();
    const c = (ctx.current ??= new AudioContext());
    const dur = Math.max(0.05, end - start);
    let remaining = sources.size + (backing ? 1 : 0);
    const onOneEnded = () => {
      remaining--;
      if (remaining <= 0) { nodes.current = []; startInfo.current = null; setPlaying(null); }
    };
    for (const [trackId, source] of sources) {
      const buf = getBuffer(c, `${trackId}:mix`, source.mix);
      startNode(c, buf, start, dur, onOneEnded);
    }
    if (backing) startNode(c, getBuffer(c, 'backing', backing), start, dur, onOneEnded);
    startInfo.current = { ctxTime: c.currentTime, offset: start, end };
    setPlaying(key);
  }, [sources, backing, stop, getBuffer, startNode]);

  const position = useCallback(() => {
    const s = startInfo.current, c = ctx.current;
    if (!s || !c) return null;
    const t = s.offset + (c.currentTime - s.ctxTime);
    return t > s.end ? null : t;
  }, []);

  useEffect(() => () => { stop(); ctx.current?.close(); }, [stop]);
  return { play, playAll, stop, playing, position };
}
