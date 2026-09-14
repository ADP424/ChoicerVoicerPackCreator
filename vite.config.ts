import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Resolve the on-disk root of `pkg` exactly as Node/Vite would when importing it
 * from `fromDir`. Walks up from the resolved entry file to the package.json whose
 * "name" matches, so it works with any "exports" map and any package manager layout.
 */
function packageRoot(pkg: string, fromDir: string): string {
  const require = createRequire(path.join(fromDir, 'noop.js'));
  let dir = path.dirname(require.resolve(pkg));
  while (true) {
    const pj = path.join(dir, 'package.json');
    if (existsSync(pj) && JSON.parse(readFileSync(pj, 'utf8')).name === pkg) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`Could not locate package root for ${pkg}`);
    dir = parent;
  }
}

const appOrt = packageRoot('onnxruntime-web', __dirname);
const transformersRoot = packageRoot('@huggingface/transformers', __dirname);
const transformersOrt = packageRoot('onnxruntime-web', transformersRoot); // may equal appOrt if deduped

const glob = (root: string) => path.join(root, 'dist', '*.{wasm,mjs}').replace(/\\/g, '/');

export default defineConfig({
  plugins: [
    react(),
    // Ship the ORT runtime files that belong to the *installed* versions. These
    // folders are served in dev and emitted into dist/ on build.
    viteStaticCopy({
      targets: [
        { src: glob(appOrt), dest: 'ort' },
        { src: glob(transformersOrt), dest: 'ort-transformers' },
      ],
    }),
  ],
  // Cross-origin isolation enables SharedArrayBuffer → multi-threaded wasm.
  // Replicate these headers on your static host; the app degrades to 1 thread without them.
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  // Never let esbuild pre-bundle these: their loaders resolve files via import.meta.url.
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util', 'onnxruntime-web', '@huggingface/transformers'] },
  worker: { format: 'es' },
  build: { target: 'esnext' },
});
