const STAGES: Array<[string, string]> = [
  ['extract', 'Extract tracks'], ['separate', 'Separate vocals'], ['vad', 'Detect lines'],
  ['diarize', 'Group speakers'], ['transcribe', 'Transcribe'],
];

export function ProcessingView({ stage, message, fraction, trackIndex, trackCount, trackLabel, onCancel }: {
  stage: string; message: string; fraction?: number;
  trackIndex: number; trackCount: number; trackLabel: string; onCancel: () => void;
}) {
  const idx = STAGES.findIndex(([k]) => k === stage);
  return (
    <div className="processing">
      <h2>Building voice pack…</h2>
      {trackCount > 1 && <p className="muted">Track {trackIndex + 1} of {trackCount}: <strong>{trackLabel}</strong></p>}
      <ol className="stages">
        {STAGES.map(([k, label], i) => (
          <li key={k} className={i < idx ? 'done' : i === idx ? 'active' : ''}>{label}</li>
        ))}
      </ol>
      <p>{message}</p>
      <progress value={fraction ?? undefined} max={1} />
      {trackCount > 1 && (
        <progress value={(trackIndex + (fraction ?? 0)) / trackCount} max={1} title="Overall progress across all tracks" />
      )}
      <p className="muted small">First run downloads models (~100–300 MB depending on options); they are cached afterwards.</p>
      <button onClick={onCancel}>Cancel</button>
    </div>
  );
}
