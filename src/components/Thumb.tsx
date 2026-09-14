import { useEffect, useState } from 'react';
import type { FrameGrabber } from '../lib/frames';

/** Shows a user-supplied image, or a video frame at `time` when none is set. */
export function Thumb({ file, grabber, time, width = 96 }: {
  file: File | null | undefined; grabber: FrameGrabber | null; time?: number; width?: number;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const key = time === undefined ? undefined : Math.round(time * 4) / 4; // don't re-seek on every pixel of a drag

  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    setSrc(null);
    if (file) { url = URL.createObjectURL(file); setSrc(url); }
    else if (grabber && key !== undefined) {
      grabber.capture(key, 320).then((b) => { if (alive && b) { url = URL.createObjectURL(b); setSrc(url); } });
    }
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [file, grabber, key]);

  return (
    <div className="thumb" style={{ width }}>
      {src ? <img src={src} alt="" /> : <span className="muted small">no image</span>}
    </div>
  );
}
