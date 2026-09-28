import { useState } from 'react';
import type { PackLine, Speaker } from '../types';
import type { EditorAction } from '../hooks/useDraft';
import type { FrameGrabber } from '../lib/frames';
import { TextField } from './TextField';
import { Thumb } from './Thumb';

export const PALETTE = ['#4f9df7', '#f7a64f', '#7fd37a', '#e86fb0', '#b38cf5', '#f0d24f', '#5ad1c9', '#f76f6f'];
export const speakerColor = (speakers: Speaker[], id: string) =>
  PALETTE[Math.max(0, speakers.findIndex((s) => s.id === id)) % PALETTE.length];

export function SpeakersPanel({ speakers, lines, dispatch, onPlaySample, frames }: {
  speakers: Speaker[]; lines: PackLine[]; dispatch: React.Dispatch<EditorAction>;
  onPlaySample: (speakerId: string) => void; frames: FrameGrabber | null;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const counts = new Map<string, number>();
  const firstLine = new Map<string, PackLine>();
  for (const l of [...lines].sort((a, b) => a.start - b.start)) {
    if (!l.included) continue;
    counts.set(l.speakerId, (counts.get(l.speakerId) ?? 0) + 1);
    if (!firstLine.has(l.speakerId)) firstLine.set(l.speakerId, l);
  }
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <fieldset className="panel">
      <legend>Speakers</legend>
      <table className="speakers">
        <thead><tr><th /><th>Image</th><th>Cluster</th><th>Character name</th><th>Lines</th><th>Portrait override</th><th /><th /></tr></thead>
        <tbody>
          {speakers.map((s) => {
            const first = firstLine.get(s.id);
            const lineCount = lines.filter((l) => l.speakerId === s.id).length;
            return (
              <tr key={s.id} className={counts.get(s.id) ? '' : 'excluded'}>
                <td><input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} /></td>
                <td>
                  <Thumb width={72} grabber={frames} file={s.portraitFile ?? first?.imageFile}
                    time={first ? (first.start + first.end) / 2 : undefined} />
                </td>
                <td><span className="swatch" style={{ background: speakerColor(speakers, s.id) }} /> {s.id}</td>
                <td><TextField value={s.name} onCommit={(v) => dispatch({ type: 'renameSpeaker', id: s.id, name: v })} /></td>
                <td>{counts.get(s.id) ?? 0}</td>
                <td>
                  <input type="file" accept="image/png,image/jpeg" onChange={(e) => dispatch({ type: 'setPortrait', id: s.id, file: e.target.files?.[0] ?? null })} />
                  {s.portraitFile && <button className="small" onClick={() => dispatch({ type: 'setPortrait', id: s.id, file: null })}>Clear</button>}
                </td>
                <td><button disabled={!first} onClick={() => onPlaySample(s.id)} title="Play a sample line">▶</button></td>
                <td>
                  <button
                    className="icon danger" title="Delete this speaker (and its lines, if any)"
                    onClick={() => {
                      if (lineCount > 0 && !confirm(`"${s.name}" has ${lineCount} line(s). Delete the speaker and all of its lines?`)) return;
                      dispatch({ type: 'removeSpeaker', id: s.id });
                    }}
                  >🗑</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="row">
        <button onClick={() => dispatch({ type: 'addSpeaker' })}>＋ New speaker</button>
        <button
          disabled={selected.size < 2}
          onClick={() => { const ids = [...selected]; dispatch({ type: 'mergeSpeakers', sourceIds: ids, targetId: ids[0] }); setSelected(new Set()); }}
        >Merge selected into first</button>
        <span className="muted small">Speakers with no lines are not included in the exported pack.</span>
      </div>
    </fieldset>
  );
}
