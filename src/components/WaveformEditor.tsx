import { useEffect, useRef, useState } from 'react';
import type { PackLine, Speaker } from '../types';
import type { Player } from '../hooks/usePlayer';
import { speakerColor } from './SpeakersPanel';

const PAD = 1.5, H = 160;

export function WaveformEditor({ audio, sampleRate, duration, line, others, speakers, onCommit, onSplit, player }: {
  audio: Float32Array; sampleRate: number; duration: number; line: PackLine; others: PackLine[]; speakers: Speaker[];
  onCommit: (patch: { start?: number; end?: number }) => void; onSplit: (at: number) => void; player: Player;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [local, setLocal] = useState({ start: line.start, end: line.end });
  const [cursor, setCursor] = useState<number | null>(null);
  const drag = useRef<'start' | 'end' | null>(null);

  useEffect(() => { setLocal({ start: line.start, end: line.end }); setCursor(null); }, [line.id, line.start, line.end]);

  const vs = Math.max(0, line.start - PAD), ve = Math.min(duration, line.end + PAD);
  const W = () => canvas.current!.width;
  const tToX = (t: number) => ((t - vs) / (ve - vs)) * W();
  const xToT = (x: number) => vs + (x / W()) * (ve - vs);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const c = canvas.current; if (!c) return;
      const ctx = c.getContext('2d')!;
      const w = c.width, h = c.height;
      ctx.fillStyle = '#14161a'; ctx.fillRect(0, 0, w, h);

      for (const o of others) {
        if (o.end < vs || o.start > ve) continue;
        ctx.fillStyle = speakerColor(speakers, o.speakerId) + '22';
        ctx.fillRect(tToX(o.start), 0, tToX(o.end) - tToX(o.start), h);
      }
      ctx.fillStyle = speakerColor(speakers, line.speakerId) + '55';
      ctx.fillRect(tToX(local.start), 0, tToX(local.end) - tToX(local.start), h);

      ctx.strokeStyle = '#9fb3c8'; ctx.beginPath();
      const spp = ((ve - vs) * sampleRate) / w;
      for (let x = 0; x < w; x++) {
        const i0 = Math.floor((vs + (x / w) * (ve - vs)) * sampleRate), i1 = Math.floor(i0 + spp);
        let mn = 0, mx = 0;
        for (let i = i0; i < i1 && i < audio.length; i++) { const v = audio[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
        ctx.moveTo(x + 0.5, h / 2 - mx * (h / 2 - 4)); ctx.lineTo(x + 0.5, h / 2 - mn * (h / 2 - 4));
      }
      ctx.stroke();

      ctx.fillStyle = '#e6edf3'; ctx.font = '11px sans-serif';
      for (const wd of line.words) {
        const x = tToX(wd.start);
        ctx.fillStyle = '#ffffff66'; ctx.fillRect(x, h - 22, 1, 6);
        ctx.fillStyle = '#e6edf3'; ctx.fillText(wd.text, x + 2, h - 8);
      }

      ctx.fillStyle = '#ffd54f';
      for (const t of [local.start, local.end]) ctx.fillRect(tToX(t) - 1.5, 0, 3, h);
      if (cursor !== null) { ctx.fillStyle = '#ff6b6b'; ctx.fillRect(tToX(cursor) - 0.5, 0, 1, h); }
      const pos = player.position();
      if (pos !== null && pos >= vs && pos <= ve) { ctx.fillStyle = '#7fd37a'; ctx.fillRect(tToX(pos) - 0.5, 0, 1, h); }
      ctx.fillStyle = '#8b949e'; ctx.fillText(`${vs.toFixed(2)}s`, 4, 12); ctx.fillText(`${ve.toFixed(2)}s`, w - 50, 12);
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  });

  const px = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return ((e.clientX - r.left) / r.width) * W();
  };
  const onDown = (e: React.PointerEvent) => {
    const x = px(e);
    if (Math.abs(x - tToX(local.start)) < 8) drag.current = 'start';
    else if (Math.abs(x - tToX(local.end)) < 8) drag.current = 'end';
    else { setCursor(Math.max(local.start, Math.min(local.end, xToT(x)))); return; }
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const t = Math.max(0, Math.min(duration, xToT(px(e))));
    setLocal((l) => drag.current === 'start' ? { ...l, start: Math.min(t, l.end - 0.05) } : { ...l, end: Math.max(t, l.start + 0.05) });
  };
  const onUp = () => {
    if (!drag.current) return;
    drag.current = null;
    if (local.start !== line.start || local.end !== line.end) onCommit(local);
  };

  return (
    <div className="waveform">
      <canvas ref={canvas} width={1000} height={H} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} />
      <div className="row">
        <button onClick={() => player.playAll(local.start, local.end, line.id)} title="Play every track's own mix plus the backing track, all at once">▶ Mix (all tracks)</button>
        <button onClick={() => player.play(local.start, local.end, line.trackId, 'vocals', line.id)}>▶ Vocals only</button>
        <button onClick={() => player.play(Math.max(0, local.start - 1), Math.min(duration, local.end + 1), line.trackId, 'mix', line.id)}>▶ With context</button>
        <button onClick={player.stop}>■ Stop</button>
      </div>
      <div className="row">
        <button disabled={cursor === null} onClick={() => cursor !== null && onSplit(cursor)}>Split at cursor</button>
        <button onClick={() => onCommit({ start: Math.max(0, local.start - 0.05) })}>Start −50ms</button>
        <button onClick={() => onCommit({ start: Math.min(local.end - 0.05, local.start + 0.05) })}>Start +50ms</button>
        <button onClick={() => onCommit({ end: Math.max(local.start + 0.05, local.end - 0.05) })}>End −50ms</button>
        <button onClick={() => onCommit({ end: Math.min(duration, local.end + 0.05) })}>End +50ms</button>
      </div>
      <p className="muted small">Drag the yellow handles to trim. Click inside the line to place the split cursor.</p>
    </div>
  );
}
