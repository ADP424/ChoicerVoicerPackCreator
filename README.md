## Running it

```bash
npm install
npm run fetch-models     # pulls silero_vad.onnx + UVR-MDX-NET-Voc_FT.onnx into public/models
npm run dev
```

Deploy `dist/` to any static host (GitHub Pages, Netlify, Cloudflare Pages). Add the COOP/COEP headers from `vite.config.ts` on the host for multi‑threaded WASM.
