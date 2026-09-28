import type { PackLine, Speaker } from '../types';
import type { EditorAction } from '../hooks/useDraft';
import type { Player } from '../hooks/usePlayer';
import { speakerColor } from './SpeakersPanel';
import { TextField } from './TextField';

const fmt = (t: number) => t.toFixed(2);

export function LinesTable({ lines, speakers, selectedId, onSelect, dispatch, player, onAddAfter, onDelete }: {
  lines: PackLine[]; speakers: Speaker[]; selectedId: string | null; onSelect: (id: string) => void;
  dispatch: React.Dispatch<EditorAction>; player: Player;
  onAddAfter: (id: string) => void; onDelete: (id: string) => void;
}) {
  return (
    <table className="lines">
      <thead>
        <tr><th>#</th><th>Start</th><th>End</th><th>Speaker</th><th>Caption</th><th>Incl.</th><th /></tr>
      </thead>
      <tbody>
        {lines.map((l, i) => (
          <tr
            key={l.id}
            className={`${l.id === selectedId ? 'selected' : ''} ${l.included ? '' : 'excluded'}`}
            onClick={() => onSelect(l.id)}
            style={{ borderLeft: `4px solid ${speakerColor(speakers, l.speakerId)}` }}
          >
            <td>{i}</td>
            <td>{fmt(l.start)}</td>
            <td>{fmt(l.end)}</td>
            <td>
              <select value={l.speakerId} onChange={(e) => dispatch({ type: 'updateLine', id: l.id, patch: { speakerId: e.target.value } })} onClick={(e) => e.stopPropagation()}>
                {speakers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </td>
            <td className="caption">
              <TextField value={l.caption} onCommit={(v) => dispatch({ type: 'updateLine', id: l.id, patch: { caption: v.trim() } })} />
              {!l.caption && l.included && <span className="warn small">empty caption</span>}
            </td>
            <td><input type="checkbox" checked={l.included} onChange={(e) => dispatch({ type: 'updateLine', id: l.id, patch: { included: e.target.checked } })} /></td>
            <td className="actions" onClick={(e) => e.stopPropagation()}>
              <button className="icon" title="Play (all tracks)" onClick={() => (player.playing === l.id ? player.stop() : player.playAll(l.start, l.end, l.id))}>
                {player.playing === l.id ? '■' : '▶'}
              </button>
              <button className="icon" title="Add a new line after this one" onClick={() => onAddAfter(l.id)}>＋</button>
              <button className="icon danger" title="Delete this line permanently" onClick={() => onDelete(l.id)}>🗑</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
