import { useEffect, useState } from 'react';

/** Input that commits on blur / Enter so every keystroke doesn't create an undo step. */
export function TextField({ value, onCommit, multiline, ...rest }: {
  value: string; onCommit: (v: string) => void; multiline?: boolean;
} & Omit<React.InputHTMLAttributes<HTMLInputElement> & React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'>) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  const commit = () => { if (local !== value) onCommit(local); };
  const props = {
    ...rest, value: local, onBlur: commit,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setLocal(e.target.value),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (!multiline || e.ctrlKey)) { (e.target as HTMLElement).blur(); }
      if (e.key === 'Escape') { setLocal(value); (e.target as HTMLElement).blur(); }
      e.stopPropagation();
    },
  } as any;
  return multiline ? <textarea {...props} /> : <input {...props} />;
}
