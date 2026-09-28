import { useEffect, useRef } from 'react';
import type { PackLine, Speaker } from '../types';
import { speakerColor } from './SpeakersPanel';

const H = 64;

/** Zoomed-out view of an entire track's audio, with every line's span highlighted. Click a line's band to select it. */
export function TrackOverview({ audio, sampleRate, duration, lines, speakers, selectedId, onSelect }: {
  audio: Float32Array; sampleRate: number; duration: number; lines: PackLine[]; speakers: Speaker[];
  selectedId: string | null; onSelect: (id: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const tToX = (t: number, w: number) => (t / duration) * w;

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    const w = c.width, h = c.height;
    ctx.fillStyle = '#14161a'; ctx.fillRect(0, 0, w, h);

    for (const l of lines) {
      const x0 = tToX(l.start, w), x1 = tToX(l.end, w);
      ctx.fillStyle = speakerColor(speakers, l.speakerId) + (l.id === selectedId ? 'aa' : l.included ? '55' : '22');
      ctx.fillRect(x0, 0, Math.max(1, x1 - x0), h);
    }

    ctx.strokeStyle = '#9fb3c8'; ctx.beginPath();
    const spp = (duration * sampleRate) / w;
    for (let x = 0; x < w; x++) {
      const i0 = Math.floor(x * spp), i1 = Math.floor(i0 + spp);
      let mn = 0, mx = 0;
      for (let i = i0; i < i1 && i < audio.length; i++) { const v = audio[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
      ctx.moveTo(x + 0.5, h / 2 - mx * (h / 2 - 2)); ctx.lineTo(x + 0.5, h / 2 - mn * (h / 2 - 2));
    }
    ctx.stroke();

    if (selectedId) {
      const sel = lines.find((l) => l.id === selectedId);
      if (sel) { ctx.fillStyle = '#ffd54f'; ctx.fillRect(tToX(sel.start, w) - 1, 0, 2, h); ctx.fillRect(tToX(sel.end, w) - 1, 0, 2, h); }
    }
  }, [audio, sampleRate, duration, lines, speakers, selectedId]);

  const onClick = (e: React.MouseEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    const t = ((e.clientX - r.left) / r.width) * duration;
    const hit = lines.find((l) => t >= l.start && t <= l.end);
    if (hit) onSelect(hit.id);
  };

  return (
    <div className="track-overview">
      <canvas ref={canvas} width={2000} height={H} onClick={onClick} />
      <p className="muted small">Whole-track overview — every detected snippet is highlighted; click one to jump to it.</p>
    </div>
  );
}
