import { env } from '@huggingface/transformers';
import { assetDir } from './ort';

// transformers.js owns a separate onnxruntime-web instance (possibly a different version).
// Point it at the runtime files vendored from *that* package, and apply the same thread rule.
env.allowLocalModels = false;
if (env.backends.onnx?.wasm) {
  env.backends.onnx.wasm.wasmPaths = assetDir('ort-transformers');
  env.backends.onnx.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
  env.backends.onnx.wasm.proxy = false;
}

export { env };
