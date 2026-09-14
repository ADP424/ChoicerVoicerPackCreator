const STAGES: Array<[string, string]> = [
  ['extract', 'Extract tracks'], ['separate', 'Separate vocals'], ['vad', 'Detect lines'],
  ['diarize', 'Group speakers'], ['transcribe', 'Transcribe'],
];

export function ProcessingView({ stage, message, fraction, onCancel }: {
  stage: string; message: string; fraction?: number; onCancel: () => void;
}) {
  const idx = STAGES.findIndex(([k]) => k === stage);
  return (
    <div className="processing">
      <h2>Building voice pack…</h2>
      <ol className="stages">
        {STAGES.map(([k, label], i) => (
          <li key={k} className={i < idx ? 'done' : i === idx ? 'active' : ''}>{label}</li>
        ))}
      </ol>
      <p>{message}</p>
      <progress value={fraction ?? undefined} max={1} />
      <p className="muted small">First run downloads models (~100–300 MB depending on options); they are cached afterwards.</p>
      <button onClick={onCancel}>Cancel</button>
    </div>
  );
}
