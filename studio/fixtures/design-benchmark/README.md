# Design quality benchmark fixtures

`suite.json` defines the three deterministic Studio scenarios: proposal,
research keynote, and article graphics. It references the Design Director input
fixtures instead of copying them.

The correction `operationCount` and `durationSeconds` values are synthetic
fixtures used to verify telemetry completeness. They are not measured user-study
results and must remain labeled `synthetic-fixture` in every report.

The current baseline is intentionally not all green:

- proposal: QA passes, with warnings retained;
- research keynote: 7 layout collision errors;
- article graphics: 12 layout collision errors.

Those errors are evidence of current fixture/compiler behavior. The benchmark
must not hide them to make CI green. The suite can still show that contract,
source coverage, native editability, export, telemetry completeness, and
determinism passed independently. Use `compareBenchmarkBaseline` to detect any
change, then explicitly review whether it is an improvement or a regression.

The aesthetic rubric is human-only. Hierarchy, rhythm, composition, brand fit,
and template feel remain separate dimensions; an aggregate aesthetic score is
prohibited.
