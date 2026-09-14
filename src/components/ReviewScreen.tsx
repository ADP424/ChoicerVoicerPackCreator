import { useEffect, useMemo, useRef, useState } from 'react';
import type { Draft } from '../types';
import { useDraft } from '../hooks/useDraft';
import { usePlayer } from '../hooks/usePlayer';
import { mixdown } from '../lib/dsp';
import { sanitizeFilenamePart } from '../lib/ini';
import { FrameGrabber } from '../lib/frames';
import { buildPackFiles, downloadBlob, isDirectoryEmpty, selfCheck, writeFilesToDirectory, zipFiles } from '../lib/exportPack';
import { applyReview, readReviewFile, serializeReview } from '../lib/reviewFile';
import { filesFromDirectoryHandle, filesFromFileList, filesFromZip, fitPackToDuration, parsePack } from '../lib/importPack';
import { MetadataForm } from './MetadataForm';
import { SpeakersPanel } from './SpeakersPanel';
import { LinesTable } from './LinesTable';
import { WaveformEditor } from './WaveformEditor';
import { TextField } from './TextField';
import { Thumb } from './Thumb';

const canPickDirectory = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

export function ReviewScreen({ draft, onRestart }: { draft: Draft; onRestart: () => void }) {
  const [state, dispatch] = useDraft(draft);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [importWarnings, setImportWarnings] = useState<string[]>(draft.importWarnings);
  const reviewInput = useRef<HTMLInputElement>(null);
  const packZipInput = useRef<HTMLInputElement>(null);
  const packDirInput = useRef<HTMLInputElement>(null);
  const player = usePlayer(draft.mix, draft.vocals);

  // Screenshot source for default images. Created/disposed strictly inside the
  // effect so StrictMode's mount→cleanup→mount cycle (and any real remount)
  // always leaves us holding a live, undisposed instance.
  const [grabber, setGrabber] = useState<FrameGrabber | null>(null);
  const [framesOk, setFramesOk] = useState<boolean | null>(null);
  useEffect(() => {
    const g = new FrameGrabber(draft.sourceFile);
    setGrabber(g);
    setFramesOk(null);
    g.available().then((ok) => setFramesOk(ok));
    return () => g.dispose();
  }, [draft.sourceFile]);
  const frames = framesOk === false ? null : grabber; // null only when known-broken (banner case)

  const duration = draft.mix.channels[0].length / draft.mix.sampleRate;
  const waveAudio = useMemo(() => mixdown(draft.vocals.channels), [draft.vocals]);
  const sorted = useMemo(() => [...state.lines].sort((a, b) => a.start - b.start), [state.lines]);
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? sorted.filter((l) => l.caption.toLowerCase().includes(q)) : sorted;
  }, [sorted, filter]);
  const selected = state.lines.find((l) => l.id === selectedId) ?? null;
  const selectedSpeaker = selected ? state.speakers.find((s) => s.id === selected.speakerId) : null;

  useEffect(() => { if (!selectedId && sorted.length) setSelectedId(sorted[0].id); }, [sorted, selectedId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); dispatch({ type: e.shiftKey ? 'redo' : 'undo' }); return; }
      if (!selected) return;
      const i = visible.findIndex((l) => l.id === selected.id);
      switch (e.key) {
        case ' ': e.preventDefault(); player.playing === selected.id ? player.stop() : player.play(selected.start, selected.end, 'mix', selected.id); break;
        case 'ArrowDown': e.preventDefault(); if (i < visible.length - 1) setSelectedId(visible[i + 1].id); break;
        case 'ArrowUp': e.preventDefault(); if (i > 0) setSelectedId(visible[i - 1].id); break;
        case 'Delete': case 'Backspace': dispatch({ type: 'updateLine', id: selected.id, patch: { included: !selected.included } }); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, visible, player, dispatch]);

  /** Insert an empty line after `afterId` (or after the last line when null), starting where that line ends. */
  function addLineAfter(afterId: string | null) {
    const ref = afterId ? state.lines.find((l) => l.id === afterId) : sorted.at(-1);
    const start = ref ? Math.min(ref.end, Math.max(0, duration - 0.1)) : 0;
    const next = ref ? sorted[sorted.findIndex((l) => l.id === ref.id) + 1] : undefined;
    let end = Math.min(duration, start + 1);
    if (next && next.start > start + 0.1) end = Math.min(end, next.start);
    const id = crypto.randomUUID();
    dispatch({ type: 'addLine', id, start, end, afterId: ref?.id ?? null });
    setSelectedId(id);
  }

  function deleteLine(id: string) {
    if (selectedId === id) {
      const i = sorted.findIndex((l) => l.id === id);
      setSelectedId(sorted[i + 1]?.id ?? sorted[i - 1]?.id ?? null);
    }
    dispatch({ type: 'removeLine', id });
  }

  function saveReview() {
    const json = serializeReview(state, draft.options, draft.sourceFile, duration);
    downloadBlob(new Blob([json], { type: 'application/json' }), `${sanitizeFilenamePart(state.metadata.title || 'review')}.review.json`);
  }

  async function loadReview(file: File) {
    try {
      const review = await readReviewFile(file);
      const { snapshot, warnings } = applyReview(
        review, { name: draft.sourceFile.name, size: draft.sourceFile.size, durationSec: duration }, state.metadata,
      );
      dispatch({ type: 'loadReview', ...snapshot });
      setSelectedId(null);
      setImportWarnings(warnings);
      setNotice({ kind: 'ok', text: `Loaded ${snapshot.lines.length} lines and ${snapshot.speakers.length} speakers from ${file.name}.` });
    } catch (err) {
      setNotice({ kind: 'error', text: `Could not load review: ${(err as Error).message}` });
    }
  }

  async function loadPackFrom(getFiles: () => Promise<Map<string, Blob>> | Map<string, Blob>, label: string) {
    try {
      const pack = fitPackToDuration(await parsePack(await getFiles(), label), duration);
      dispatch({ type: 'loadReview', lines: pack.lines, speakers: pack.speakers, metadata: pack.metadata });
      setSelectedId(null);
      setImportWarnings(pack.warnings);
      setNotice({ kind: 'ok', text: `Loaded ${pack.lines.length} lines and ${pack.speakers.length} speakers from ${label}.` });
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setNotice({ kind: 'error', text: `Could not load pack: ${(err as Error).message}` });
    }
  }

  function validate(): string | null {
    const included = state.lines.filter((l) => l.included);
    if (!included.length) return 'No included lines to export.';
    const byId = new Map(state.speakers.map((s) => [s.id, s]));
    for (const l of included) {
      if (!byId.get(l.speakerId)?.name.trim()) return 'Every included line needs a non-empty character name.';
      if (!(l.end > l.start)) return `Line at ${l.start.toFixed(2)}s has an invalid end time.`;
    }
    if (!state.metadata.title.trim()) return 'Pack title is required.';
    return null;
  }

  async function exportPack(mode: 'folder' | 'zip') {
    const problem = validate();
    if (problem) { setNotice({ kind: 'error', text: problem }); return; }
    setNotice(null);
    const folderName = sanitizeFilenamePart(state.metadata.title);
    try {
      let dir: FileSystemDirectoryHandle | null = null;
      if (mode === 'folder') {
        const root = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
        dir = await root.getDirectoryHandle(folderName, { create: true });
        if (!(await isDirectoryEmpty(dir!)) && !confirm(`"${folderName}" is not empty. Continue anyway?`)) return;
      }
      setBusy('Preparing export…');
      const framesForExport = grabber && (await grabber.available()) ? grabber : null;
      const { files, exportedCount, warnings: exportWarnings } = await buildPackFiles({ draft, ...state, frames: framesForExport }, setBusy);
      const check = await selfCheck(files, exportedCount);
      const allWarnings = [...exportWarnings, ...(check ? [check] : [])];
      if (dir) await writeFilesToDirectory(dir, files);
      else { setBusy('Zipping…'); downloadBlob(await zipFiles(files, folderName), `${folderName}.zip`); }
      setNotice({
        kind: 'ok',
        text: `Exported ${exportedCount} line(s) to ${mode === 'folder' ? `folder "${folderName}"` : `${folderName}.zip`}.` +
              (allWarnings.length ? `\nWarnings:\n• ${allWarnings.join('\n• ')}` : ''),
      });
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setNotice({ kind: 'error', text: `Export failed: ${(err as Error).message}` });
    } finally { setBusy(null); }
  }

  const playSample = (speakerId: string) => {
    const l = sorted.find((x) => x.speakerId === speakerId && x.included);
    if (l) player.play(l.start, l.end, 'mix', l.id);
  };

  return (
    <div className="review">
      <header className="row">
        <h1>Review voice pack</h1>
        <span className="spacer" />
        <button onClick={saveReview} title="Save timestamps, captions, speakers and settings (not images) to a JSON file">💾 Save review (JSON)</button>
        <button onClick={() => reviewInput.current?.click()}>📂 Load review…</button>
        <input ref={reviewInput} type="file" accept="application/json,.json" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) loadReview(f); e.target.value = ''; }} />
        <button onClick={async () => {
          if (canPickDirectory) {
            const dir: FileSystemDirectoryHandle = await (window as any).showDirectoryPicker().catch(() => null);
            if (dir) loadPackFrom(() => filesFromDirectoryHandle(dir), dir.name);
          } else packDirInput.current?.click();
        }}>📦 Load pack…</button>
        <button onClick={() => packZipInput.current?.click()} title="Load a pack from a .zip">📦 Load pack (.zip)…</button>
        <input ref={packZipInput} type="file" accept=".zip,application/zip" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) loadPackFrom(() => filesFromZip(f), f.name); e.target.value = ''; }} />
        <input ref={packDirInput} type="file" hidden {...({ webkitdirectory: '' } as any)}
          onChange={(e) => { const l = e.target.files; if (l?.length) loadPackFrom(() => filesFromFileList(l), 'pack folder'); e.target.value = ''; }} />
        <button onClick={onRestart}>Start over</button>
      </header>

      {!draft.diarizationAvailable && state.lines.length > 0 && (
        <div className="banner">Speaker grouping was unavailable — all lines start in one “Speaker 1” group. Create speakers below and reassign lines with the Speaker dropdown.</div>
      )}
      {draft.backingQuality === 'phase-cancel-fallback' && <div className="banner">Backing track quality: low (MDX-Net unavailable; used phase-cancellation fallback).</div>}
      {draft.backingQuality === 'none' && <div className="banner">No backing track could be produced; the pack will be exported without one.</div>}
      {!draft.videoStripped && <div className="banner">Could not strip audio from the video (ffmpeg.wasm failed); the original file will be exported as dub_video.</div>}
      {framesOk === false && <div className="banner">This browser cannot decode the video frames, so default screenshots are unavailable. Lines without an assigned image will be exported without one.</div>}

      {importWarnings.length > 0 && (
        <div className="banner">
          <strong>Review restored with warnings:</strong>
          <ul>{importWarnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          <button className="small" onClick={() => setImportWarnings([])}>Dismiss</button>
        </div>
      )}

      <MetadataForm metadata={state.metadata} onChange={(patch) => dispatch({ type: 'setMetadata', patch })} />
      <SpeakersPanel speakers={state.speakers} lines={state.lines} dispatch={dispatch} onPlaySample={playSample} frames={frames} />

      <fieldset className="panel lines-panel">
        <legend>Lines ({state.lines.filter((l) => l.included).length} included / {state.lines.length})</legend>
        <div className="row">
          <input placeholder="Filter captions…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: 320 }} />
          <span className="spacer" />
          <button onClick={() => dispatch({ type: 'undo' })} disabled={!state.past.length} title="Undo the last line/speaker edit (up to 3)">
            ↶ Undo{state.past.length ? ` (${state.past.length})` : ''}
          </button>
          <button onClick={() => dispatch({ type: 'redo' })} disabled={!state.future.length}>↷ Redo</button>
          {selected && <button onClick={() => dispatch({ type: 'mergeWithNext', id: selected.id })}>Merge with next</button>}
          {!state.lines.length && <button onClick={() => addLineAfter(null)}>Add line</button>}
        </div>
        <div className="lines-layout">
          <div className="lines-scroll">
            <LinesTable
              lines={visible} speakers={state.speakers} selectedId={selectedId} onSelect={setSelectedId}
              dispatch={dispatch} player={player} onAddAfter={addLineAfter} onDelete={deleteLine}
            />
          </div>
          {selected && (
            <div className="detail">
              <WaveformEditor
                audio={waveAudio} sampleRate={draft.vocals.sampleRate} duration={duration}
                line={selected} others={sorted.filter((l) => l.id !== selected.id)} speakers={state.speakers}
                onCommit={(patch) => dispatch({ type: 'updateLine', id: selected.id, patch })}
                onSplit={(at) => dispatch({ type: 'splitLine', id: selected.id, at })}
                player={player}
              />
              <div className="grid">
                <label>Start (s)
                  <TextField value={selected.start.toFixed(3)} onCommit={(v) => { const n = +v; if (Number.isFinite(n) && n >= 0 && n < selected.end) dispatch({ type: 'updateLine', id: selected.id, patch: { start: n } }); }} />
                </label>
                <label>End (s)
                  <TextField value={selected.end.toFixed(3)} onCommit={(v) => { const n = +v; if (Number.isFinite(n) && n > selected.start && n <= duration) dispatch({ type: 'updateLine', id: selected.id, patch: { end: n } }); }} />
                </label>
                <label className="span2">Caption
                  <TextField multiline rows={2} value={selected.caption} onCommit={(v) => dispatch({ type: 'updateLine', id: selected.id, patch: { caption: v.trim() } })} />
                </label>
                <div className="row span2">
                  <Thumb width={160} grabber={frames}
                    file={selected.imageFile ?? selectedSpeaker?.portraitFile}
                    time={(selected.start + selected.end) / 2} />
                  <label>Line image override
                    <input type="file" accept="image/png,image/jpeg" onChange={(e) => dispatch({ type: 'updateLine', id: selected.id, patch: { imageFile: e.target.files?.[0] ?? null } })} />
                    {selected.imageFile
                      ? <button className="small" onClick={() => dispatch({ type: 'updateLine', id: selected.id, patch: { imageFile: null } })}>Use default</button>
                      : <span className="muted small">{selectedSpeaker?.portraitFile ? 'Using speaker portrait' : 'Using screenshot from the middle of the clip'}</span>}
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>
      </fieldset>

      <footer className="row export">
        {notice && <div className={`notice ${notice.kind}`}>{notice.text}</div>}
        <span className="spacer" />
        {busy && <span className="muted">{busy}</span>}
        {canPickDirectory && <button className="primary" disabled={!!busy} onClick={() => exportPack('folder')}>Save pack to folder…</button>}
        <button className="primary" disabled={!!busy} onClick={() => exportPack('zip')}>Download pack (.zip)</button>
      </footer>
    </div>
  );
}
