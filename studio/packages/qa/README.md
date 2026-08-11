# Studio deterministic QA

`runDeterministicQa` checks Scene IR without a browser or model call:

- canvas bounds and meaningful element collisions;
- minimum font size and WCAG contrast ratio;
- missing image source and alternative text;
- unsupported primary fonts;
- renderer-provided raster or omitted export degradations.

Issue IDs and output order are deterministic, so the JSON report can be compared in CI. Shape/text containment is intentionally not treated as a collision because a shape commonly acts as a text backdrop.

Generate the local golden report with:

```sh
npm run golden --workspace @opendesign/studio-qa
```

Generated artifacts are ignored by Git.
