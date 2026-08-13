# OpenDesign Agent OS contracts

Versioned, provider-neutral contracts for one accountable design task. The package owns work orders, execution plans, evidence, artifacts, run events, review candidates, feedback and capability manifests.

It is a pure domain package: no model calls, network access, persistence, publication or production configuration. External input must pass the exported validators. Final approval remains human-only and every candidate is `notPublished: true`.
