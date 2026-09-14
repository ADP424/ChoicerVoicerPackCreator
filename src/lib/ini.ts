const INVALID = /[<>:"/\\|?*\x00-\x1f]/g;

export function sanitizeFilenamePart(name: string): string {
  const cleaned = name.replace(INVALID, '').trim().replace(/\s+/g, ' ');
  return cleaned || 'Unknown';
}

export function toSmartQuotes(text: string): string {
  let open = true;
  return text.replace(/\\/g, '').replace(/"/g, () => { const q = open ? '“' : '”'; open = !open; return q; });
}

export const formatIniString = (v: string) => `"${toSmartQuotes(v)}"`;
export const formatIniStringList = (vs: string[]) => `[${vs.map(formatIniString).join(', ')}]`;
