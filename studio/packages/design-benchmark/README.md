# Studio design quality benchmark

This package composes existing Design Director, deterministic QA, and PPTX
renderer evidence into one reproducible report. It does not invent a quality
score.

Public API:

- `runDesignBenchmark` produces contract, source coverage, native editability,
  QA severity, export, correction telemetry completeness, and determinism
  metrics for each task;
- `writeBenchmarkArtifacts` writes `benchmark-report.json` and
  `benchmark-summary.md`;
- `compareBenchmarkBaseline` reports path-level baseline differences;
- `assertBenchmarkIntegrity` rejects automated aesthetic judgments, aggregate
  aesthetic/quality scores, and correction telemetry that is not labeled as a
  synthetic fixture;
- `createManualAestheticRubric` returns unreviewed human-only placeholders for
  hierarchy, rhythm, composition, brand fit, and template feel.

`passed` is a quality gate, not a generation-success synonym. A task can compile
and export successfully while still failing because deterministic QA reports an
error. The current fixtures deliberately preserve that distinction.

## Known limits

- Synthetic operation count and correction time only prove schema completeness;
  they do not measure human editing efficiency.
- The benchmark validates native object export through renderer evidence and a
  non-empty `.pptx`; it does not automate PowerPoint UI inspection.
- Warnings remain visible but do not fail the quality gate. QA blockers and
  errors do.
- Baseline equality detects any drift; deciding whether a difference is an
  improvement still requires a reviewer.
