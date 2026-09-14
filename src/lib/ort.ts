import * as ort from 'onnxruntime-web/webgpu';

/** Absolute URL of a folder under the app's base, valid on the main thread and in workers. */
export function assetDir(name: string): string {
  return new URL(`${import.meta.env.BASE_URL}${name}/`, self.location.origin).href;
}

// Runtime files vendored from the installed onnxruntime-web package (see vite.config.ts).
ort.env.wasm.wasmPaths = assetDir('ort');
// Threads only work when cross-origin isolated; otherwise ORT must be told to use one.
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
ort.env.wasm.proxy = false;

/** InferenceSession.create with an actionable error if the runtime itself can't load. */
export async function createSession(url: string, options: ort.InferenceSession.SessionOptions) {
  try {
    return await ort.InferenceSession.create(url, options);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/no available backend|initWasm/i.test(msg)) {
      throw new Error(
        `ONNX Runtime failed to initialise (${msg}). ` +
        `wasmPaths=${ort.env.wasm.wasmPaths}, version=${ort.env.versions.web ?? 'unknown'}, ` +
        `threads=${ort.env.wasm.numThreads}, crossOriginIsolated=${self.crossOriginIsolated}. ` +
        `Check that ${ort.env.wasm.wasmPaths} is reachable and served with correct MIME types.`,
      );
    }
    throw err;
  }
}

export { ort };
