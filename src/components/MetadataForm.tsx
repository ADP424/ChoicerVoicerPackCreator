import type { PackMetadata } from '../types';
import { TextField } from './TextField';

export function MetadataForm({ metadata, onChange }: { metadata: PackMetadata; onChange: (p: Partial<PackMetadata>) => void }) {
  return (
    <fieldset className="panel">
      <legend>Pack info</legend>
      <div className="grid">
        <label>Title<TextField value={metadata.title} onCommit={(v) => onChange({ title: v.trim() })} /></label>
        <label>Authors (comma-separated)
          <TextField value={metadata.authors.join(', ')} onCommit={(v) => onChange({ authors: v.split(',').map((s) => s.trim()).filter(Boolean) })} />
        </label>
        <label className="span2">Readme<TextField multiline rows={3} value={metadata.readme} onCommit={(v) => onChange({ readme: v.trim() })} /></label>
        <label>Icon (PNG)
          <input type="file" accept="image/png" onChange={(e) => onChange({ iconFile: e.target.files?.[0] ?? null })} />
          {metadata.iconFile && <span className="muted small">{metadata.iconFile.name}</span>}
        </label>
      </div>
    </fieldset>
  );
}
