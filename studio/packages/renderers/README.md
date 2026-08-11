# Studio renderers

Scene IR has independent output paths. HTML is never used as the source for PPTX.

- `renderDocumentToHtml` and `renderSceneToHtml` produce deterministic absolute-position HTML snapshots.
- `exportDocumentToPptx` maps text, image and shape elements to native PowerPoint objects. The default editable mode never rasterizes a whole page.
- `exportDocumentToPng` accepts a `PageScreenshotAdapter`; production can inject Playwright while tests use an in-memory adapter.
- `createPlaywrightScreenshotAdapter` loads Playwright at runtime and gives a clear error when it or a Chromium runtime is unavailable.

Every PPTX export returns an editability report. Each element is marked `native`, `raster`, or `omitted`, with a fallback reason whenever the output is not native.

Generate the local golden deck and report with:

```sh
npm run golden --workspace @opendesign/studio-renderers
```

Generated artifacts are ignored by Git.
