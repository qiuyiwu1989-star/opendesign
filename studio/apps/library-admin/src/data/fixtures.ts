import type { PipelineRun, ReviewCase } from "../domain";
import type { GitReadOnlySnapshot, SnapshotAdapterInput } from "./types";

/**
 * Small, visibly synthetic fixture for tests/Storybook-like previews only.
 * Consumers must keep its `source` state as `snapshot` and label it synthetic.
 */
export const syntheticSiteIndexFixture = {
  _meta: {
    version: "fixture-1",
    built_at: "2026-08-12T00:00:00.000Z",
    count: 3,
  },
  sites: [
    {
      id: "fixture-complete",
      title: "Fixture Complete",
      url: "https://example.com/complete",
      image: "https://example.com/complete.png",
      tags: ["Editorial", "Fixture"],
      status: "completed",
      has_spec: true,
      has_pack: true,
    },
    {
      id: "fixture-spec",
      title: "Fixture Spec",
      url: "https://example.com/spec",
      image: "https://example.com/spec.png",
      tags: ["Product", "Fixture"],
      status: "completed",
      has_spec: true,
      has_pack: false,
    },
    {
      id: "fixture-preview-missing",
      title: "Fixture Preview Missing",
      url: "https://example.com/no-preview",
      image: "",
      tags: ["Fixture"],
      status: "completed",
      has_spec: false,
      has_pack: false,
    },
  ],
} as const;

export const syntheticReviewFixture: ReviewCase[] = [{
  id: "submission:fixture-1",
  source: "submission",
  status: "pending",
  priority: "medium",
  title: "Synthetic submission",
  summary: "Fixture only; this is not a production submission.",
  createdAt: "2026-08-12T00:00:00.000Z",
  evidence: ["synthetic fixture"],
  previewOnly: true,
}];

export const syntheticPipelineFixture: PipelineRun[] = [{
  id: "pipeline:fixture-1",
  kind: "collect",
  label: "Synthetic collection run",
  status: "failed",
  createdAt: "2026-08-12T00:00:00.000Z",
  summary: "Fixture only; no production pipeline ran.",
  checkpoints: [
    { id: "discover", label: "Discover", status: "completed" },
    { id: "extract", label: "Extract", status: "failed", detail: "Synthetic failure" },
    { id: "validate", label: "Validate", status: "pending" },
  ],
  retryFromCheckpointId: "extract",
  previewOnly: true,
}];

export const syntheticGitFixture: GitReadOnlySnapshot = {
  branch: "fixture/read-only",
  localRevision: "fixture-local",
  gitRevision: "fixture-local",
  githubRevision: "fixture-remote",
  publicRevision: "fixture-public",
  dirty: false,
};

export const syntheticSnapshotFixture: SnapshotAdapterInput = {
  siteIndex: syntheticSiteIndexFixture,
  packIndex: { "fixture-complete": { fixture: true } },
  reviews: syntheticReviewFixture,
  reviewSource: { kind: "snapshot", label: "synthetic review fixture" },
  pipelines: syntheticPipelineFixture,
  pipelineSource: { kind: "snapshot", label: "synthetic pipeline fixture" },
  syncSource: { kind: "snapshot", label: "synthetic sync fixture" },
  git: syntheticGitFixture,
  now: "2026-08-12T00:00:00.000Z",
};
