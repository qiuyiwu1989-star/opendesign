import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import type {
  ReadOnlySyncNode,
  SyncApiResponse,
} from "../src/data/sync";

const execFileAsync = promisify(execFile);
const DEFAULT_OBSERVED_AT = "1970-01-01T00:00:00.000Z";

export interface GitCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type ReadOnlyGitRunner = (
  args: readonly string[],
  cwd: string,
) => Promise<GitCommandResult>;

export interface GitEvidence {
  branch?: string;
  head?: string;
  originRevision?: string;
  dirty?: boolean;
  observedAt: string;
  diagnostics: string[];
}

export interface LibraryBuildEvidence {
  version?: string;
  builtAt?: string;
  count?: number;
  observedAt: string;
  diagnostics: string[];
}

export interface InjectedRevision {
  revision?: string;
  observedAt?: string;
  detail?: string;
}

export interface BuildSyncSnapshotOptions {
  repoRoot: string;
  observedAt?: string;
  runGit?: ReadOnlyGitRunner;
  github?: InjectedRevision;
  public?: InjectedRevision;
}

export interface ReadGitEvidenceOptions {
  repoRoot: string;
  observedAt?: string;
  runGit?: ReadOnlyGitRunner;
}

export interface ReadLibraryBuildEvidenceOptions {
  repoRoot: string;
  observedAt?: string;
}

const ALLOWED_GIT_COMMANDS = new Set([
  "symbolic-ref --quiet --short HEAD",
  "rev-parse --verify HEAD",
  "status --porcelain=v1 --untracked-files=normal",
]);

function isoNow(value?: string): string {
  if (value && !Number.isNaN(Date.parse(value))) return value;
  return new Date().toISOString();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Executes only the Git read commands used by this snapshot builder. It never
 * invokes fetch, pull, checkout, update-ref, or any other mutating/network
 * operation.
 */
export const runReadOnlyGit: ReadOnlyGitRunner = async (args, cwd) => {
  const signature = args.join(" ");
  const isOriginRefRead = args.length === 3
    && args[0] === "show-ref"
    && args[1] === "--verify"
    && args[2]?.startsWith("refs/remotes/origin/");
  if (!ALLOWED_GIT_COMMANDS.has(signature) && !isOriginRefRead) {
    throw new Error(`Refused non-read-only Git command: ${signature}`);
  }
  try {
    const result = await execFileAsync("git", [...args], {
      cwd,
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 512 * 1024,
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
      exitCode: typeof failure.code === "number" ? failure.code : 1,
    };
  }
};

async function gitValue(
  run: ReadOnlyGitRunner,
  repoRoot: string,
  args: readonly string[],
): Promise<string | undefined> {
  const result = await run(args, repoRoot);
  if (result.exitCode !== 0) return undefined;
  return optionalString(result.stdout);
}

export async function readGitEvidence(
  options: ReadGitEvidenceOptions,
): Promise<GitEvidence> {
  const observedAt = isoNow(options.observedAt);
  const run = options.runGit ?? runReadOnlyGit;
  const diagnostics: string[] = [];
  const [branch, head, status] = await Promise.all([
    gitValue(run, options.repoRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
    gitValue(run, options.repoRoot, ["rev-parse", "--verify", "HEAD"]),
    run(["status", "--porcelain=v1", "--untracked-files=normal"], options.repoRoot),
  ]);
  if (!branch) diagnostics.push("Current branch is unavailable or HEAD is detached.");
  if (!head) diagnostics.push("Local HEAD revision is unavailable.");
  if (status.exitCode !== 0) diagnostics.push("Working-tree status is unavailable.");

  let originRevision: string | undefined;
  if (branch) {
    const originLine = await gitValue(run, options.repoRoot, [
      "show-ref",
      "--verify",
      `refs/remotes/origin/${branch}`,
    ]);
    originRevision = originLine?.split(/\s+/u)[0];
    if (!originRevision) diagnostics.push(`Cached origin/${branch} ref is unavailable; no fetch was attempted.`);
  }

  return {
    ...(branch ? { branch } : {}),
    ...(head ? { head } : {}),
    ...(originRevision ? { originRevision } : {}),
    ...(status.exitCode === 0 ? { dirty: Boolean(status.stdout.trim()) } : {}),
    observedAt,
    diagnostics,
  };
}

export async function readLibraryBuildEvidence(
  options: ReadLibraryBuildEvidenceOptions,
): Promise<LibraryBuildEvidence> {
  const observedAt = isoNow(options.observedAt);
  const diagnostics: string[] = [];
  try {
    const raw = JSON.parse(await readFile(`${options.repoRoot}/sites-index.json`, "utf8")) as unknown;
    if (!isRecord(raw) || !isRecord(raw._meta)) {
      return { observedAt, diagnostics: ["sites-index.json has no _meta build evidence."] };
    }
    const version = optionalString(raw._meta.version);
    const builtAt = optionalString(raw._meta.built_at);
    const count = typeof raw._meta.count === "number" && Number.isFinite(raw._meta.count)
      ? raw._meta.count
      : undefined;
    if (!builtAt) diagnostics.push("sites-index.json build timestamp is unavailable.");
    return {
      ...(version ? { version } : {}),
      ...(builtAt ? { builtAt } : {}),
      ...(count !== undefined ? { count } : {}),
      observedAt,
      diagnostics,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown read error";
    return { observedAt, diagnostics: [`Unable to read sites-index.json: ${message}`] };
  }
}

function revisionDrift(revision: string | undefined, baseline: string | undefined) {
  if (!revision || !baseline) return "unknown" as const;
  return revision === baseline ? "in-sync" as const : "diverged" as const;
}

function node(
  location: ReadOnlySyncNode["location"],
  label: string,
  observedAt: string,
  revision: string | undefined,
  drift: ReadOnlySyncNode["drift"],
  detail?: string,
): ReadOnlySyncNode {
  return {
    location,
    label,
    state: drift === "in-sync" ? "healthy" : drift === "unknown" ? "unknown" : "attention",
    drift,
    ...(revision ? { revision } : {}),
    observedAt,
    ...(detail ? { detail } : {}),
    readOnly: true,
  };
}

function injectedNode(
  location: "github" | "public",
  label: string,
  injected: InjectedRevision | undefined,
  baseline: string | undefined,
  fallbackObservedAt: string,
): ReadOnlySyncNode {
  const observedAt = isoNow(injected?.observedAt ?? fallbackObservedAt);
  const revision = optionalString(injected?.revision);
  return node(
    location,
    label,
    observedAt,
    revision,
    revisionDrift(revision, baseline),
    injected?.detail ?? (revision ? "Externally injected read-only revision evidence." : "No revision was injected; no network request was attempted."),
  );
}

export async function buildSyncSnapshot(
  options: BuildSyncSnapshotOptions,
): Promise<SyncApiResponse> {
  const observedAt = isoNow(options.observedAt);
  const [git, build] = await Promise.all([
    readGitEvidence({
      repoRoot: options.repoRoot,
      observedAt,
      ...(options.runGit ? { runGit: options.runGit } : {}),
    }),
    readLibraryBuildEvidence({ repoRoot: options.repoRoot, observedAt }),
  ]);
  const buildDetail = [
    build.version ? `sites-index schema ${build.version}` : undefined,
    build.builtAt ? `built ${build.builtAt}` : undefined,
    build.count !== undefined ? `${build.count} assets` : undefined,
  ].filter(Boolean).join(" · ");
  const localDrift = !git.head ? "unknown" : git.dirty ? "ahead" : "in-sync";
  const nodes: ReadOnlySyncNode[] = [
    node("database", "Database", observedAt, undefined, "unknown", "Production database is intentionally disconnected."),
    node(
      "local",
      "Local",
      git.observedAt,
      git.head,
      localDrift,
      [git.dirty ? "Working tree has uncommitted changes." : "Working tree is clean.", buildDetail].filter(Boolean).join(" "),
    ),
    node(
      "git",
      "Git",
      git.observedAt,
      git.originRevision,
      revisionDrift(git.originRevision, git.head),
      git.branch
        ? `Cached origin/${git.branch}; no fetch was attempted.`
        : "Current branch is unavailable; no fetch was attempted.",
    ),
    injectedNode("github", "GitHub", options.github, git.head, observedAt),
    injectedNode("public", "Public", options.public, git.head, observedAt),
  ];
  const known = nodes.filter((candidate) => candidate.drift !== "unknown");
  const drifted = known.filter((candidate) => candidate.drift !== "in-sync");
  const state = drifted.length ? "attention" : known.length >= 2 ? "healthy" : "unknown";
  const diagnostics = [
    ...git.diagnostics.map((message, index) => ({
      code: `git-evidence-${index + 1}`,
      level: "warning" as const,
      message,
    })),
    ...build.diagnostics.map((message, index) => ({
      code: `build-evidence-${index + 1}`,
      level: "warning" as const,
      message,
    })),
  ];
  return {
    source: {
      kind: "snapshot",
      label: "local read-only sync snapshot",
      generatedAt: observedAt,
      detail: "Local Git refs and checked-in build metadata; no fetch or network request",
    },
    observedAt,
    diagnostics,
    sync: {
      state,
      summary: drifted.length
        ? `${drifted.length} 个已知位置与本地 HEAD 不一致。`
        : known.length >= 2
          ? "已知位置与本地 HEAD 一致。"
          : "可比较的只读修订证据不足。",
      ...(git.branch ? { branch: git.branch } : {}),
      ...(git.head ? { localRevision: git.head } : {}),
      nodes,
      readOnly: true,
    },
  };
}

export { DEFAULT_OBSERVED_AT };
