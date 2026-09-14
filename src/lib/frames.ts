/** Grabs PNG screenshots from the source video at arbitrary times, serialised and cached. */
export class FrameGrabber {
  private video = document.createElement('video');
  private url: string;
  private ready: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  private cache = new Map<string, Promise<Blob | null>>();
  private disposed = false;

  constructor(source: Blob) {
    this.url = URL.createObjectURL(source);
    const v = this.video;
    v.muted = true; v.preload = 'auto'; v.playsInline = true;
    this.ready = new Promise((resolve, reject) => {
      v.addEventListener('loadeddata', () => resolve(), { once: true });
      v.addEventListener('error', () => reject(new Error('The browser cannot decode this video for screenshots.')), { once: true });
    });
    this.ready.catch(() => {}); // avoid unhandled-rejection noise if never awaited
    v.src = this.url;
  }

  /** True only if the video decoded AND this instance hasn't been disposed. */
  available(): Promise<boolean> {
    return this.ready.then(() => !this.disposed, () => false);
  }

  capture(time: number, maxWidth = 960): Promise<Blob | null> {
    if (this.disposed) return Promise.resolve(null);
    const key = `${time.toFixed(2)}@${maxWidth}`;
    let p = this.cache.get(key);
    if (!p) {
      p = this.queue = this.queue.then(() => this.grab(time, maxWidth).catch((err) => {
        console.warn('Frame capture failed at', time, err);
        return null;
      })) as Promise<Blob | null>;
      this.cache.set(key, p);
    }
    return p;
  }

  private async grab(time: number, maxWidth: number): Promise<Blob | null> {
    await this.ready;
    if (this.disposed) return null;
    const v = this.video;
    const t = Math.max(0, Math.min(time, (v.duration || time) - 0.05));
    if (Math.abs(v.currentTime - t) > 0.01 || v.readyState < 2) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('seek timeout')), 10_000);
        v.addEventListener('seeked', () => { clearTimeout(timer); resolve(); }, { once: true });
        v.currentTime = t;
      });
    }
    if (this.disposed || !v.videoWidth) return null;
    const scale = Math.min(1, maxWidth / v.videoWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(v.videoWidth * scale);
    canvas.height = Math.round(v.videoHeight * scale);
    canvas.getContext('2d')!.drawImage(v, 0, 0, canvas.width, canvas.height);
    return new Promise((res) => canvas.toBlob(res, 'image/png'));
  }

  dispose() {
    this.disposed = true;
    this.cache.clear();
    this.video.removeAttribute('src');
    this.video.load();
    URL.revokeObjectURL(this.url);
  }
}
