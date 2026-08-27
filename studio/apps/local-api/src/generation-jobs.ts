import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SceneDocument } from "@opendesign/studio-contracts";
import type { DesignDirectorInput, DesignDirectorOutput } from "@opendesign/studio-design-director";
import {
  MODEL_ADAPTER_CONTRACT_VERSION,
  generateWithModel,
  type ModelProvider,
} from "@opendesign/studio-model-adapter";

export type GenerationJobStatus =
  | "queued"
  | "analyzing"
  | "generating"
  | "validating"
  | "completed"
  | "failed"
  | "cancelled";

export type GenerationJobError = {
  code: string;
  retryable: boolean;
  message: string;
};

export type GenerationJobStage = { status: GenerationJobStatus; at: string };

/** Public projection. Session scope and submitted model input are never exposed. */
export type GenerationJob = {
  jobId: string;
  status: GenerationJobStatus;
  createdAt: string;
  updatedAt: string;
  stages: GenerationJobStage[];
  projectId?: string;
  error?: GenerationJobError;
};

export type GenerationDocumentGate = { accepted: boolean; code?: string; message?: string; retryable?: boolean };

type PersistedGenerationJob = GenerationJob & {
  persistenceVersion: 1;
  scopeHash: string;
  input: DesignDirectorInput;
};

export type GenerationJobManagerOptions = {
  rootDirectory: string;
  provider: ModelProvider | null;
  projectWriter: (scopeHash: string, document: SceneDocument) => Promise<void>;
  documentGate?: (document: SceneDocument) => Promise<GenerationDocumentGate>;
  onAcceptedOutput?: (scopeHash: string, input: DesignDirectorInput, output: Extract<DesignDirectorOutput, { status: "accepted" }>) => Promise<void>;
  onDocumentChecked?: (scopeHash: string, input: DesignDirectorInput, document: SceneDocument, gate: GenerationDocumentGate) => Promise<void>;
  /** @deprecated Prefer onDocumentChecked so rejected QA evidence is also recorded. */
  onValidatedDocument?: (scopeHash: string, input: DesignDirectorInput, document: SceneDocument) => Promise<void>;
  onTransition?: (scopeHash: string, input: DesignDirectorInput, job: GenerationJob) => Promise<void>;
  now?: () => Date;
  id?: () => string;
  maxRunningPerScope?: number;
  stageYield?: (status: GenerationJobStatus, job: GenerationJob, signal: AbortSignal) => Promise<void>;
};

const SCOPE_HASH = /^(?:scope_)?[a-f0-9]{64}$/u;
const JOB_ID = /^job_[a-z0-9]{8,59}$/u;
const ACTIVE_STATUSES = new Set<GenerationJobStatus>(["queued", "analyzing", "generating", "validating"]);
const TERMINAL_STATUSES = new Set<GenerationJobStatus>(["completed", "failed", "cancelled"]);
const NEXT_STATUS: Readonly<Record<GenerationJobStatus, ReadonlySet<GenerationJobStatus>>> = {
  queued: new Set(["analyzing", "failed", "cancelled"]),
  analyzing: new Set(["generating", "failed", "cancelled"]),
  generating: new Set(["validating", "failed", "cancelled"]),
  validating: new Set(["completed", "failed", "cancelled"]),
  completed: new Set(),
  failed: new Set(),
  cancelled: new Set(),
};

export class GenerationJobLimitError extends Error {
  readonly code = "generation_concurrency_limit";
  readonly retryable = true;

  constructor(readonly limit: number) {
    super(`At most ${limit} generation jobs may be active in this session`);
    this.name = "GenerationJobLimitError";
  }
}

export class GenerationProviderUnavailableError extends Error {
  readonly code = "provider_unavailable";
  readonly retryable = true;

  constructor() {
    super("The generation provider is not configured");
    this.name = "GenerationProviderUnavailableError";
  }
}

function assertScopeHash(scopeHash: string): void {
  if (!SCOPE_HASH.test(scopeHash)) throw new TypeError("Invalid session scope hash");
}

function safeMessage(value: unknown): string {
  const message = value instanceof Error ? value.message : "The generation job failed";
  return message
    .replace(/((?:api[_-]?key|authorization|bearer|token|secret|password)\s*[:=]\s*)[^\s,;]+/giu, "$1[redacted]")
    .replace(/\b(?:sk|AKIA|AKID)[-_A-Za-z0-9]{12,}\b/gu, "[redacted]")
    .replace(/[\r\n\t]+/gu, " ")
    .slice(0, 240) || "The generation job failed";
}

function publicJob(job: PersistedGenerationJob): GenerationJob {
  return structuredClone({
    jobId: job.jobId,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    stages: job.stages,
    ...(job.projectId ? { projectId: job.projectId } : {}),
    ...(job.error ? { error: job.error } : {}),
  });
}

function isStatus(value: unknown): value is GenerationJobStatus {
  return typeof value === "string" && (ACTIVE_STATUSES.has(value as GenerationJobStatus) || TERMINAL_STATUSES.has(value as GenerationJobStatus));
}

function isPersistedJob(value: unknown, scopeHash: string): value is PersistedGenerationJob {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PersistedGenerationJob>;
  return candidate.persistenceVersion === 1
    && candidate.scopeHash === scopeHash
    && typeof candidate.jobId === "string"
    && JOB_ID.test(candidate.jobId)
    && isStatus(candidate.status)
    && typeof candidate.createdAt === "string"
    && typeof candidate.updatedAt === "string"
    && Array.isArray(candidate.stages)
    && !!candidate.input
    && typeof candidate.input === "object";
}

export class GenerationJobManager {
  readonly #jobs = new Map<string, Map<string, PersistedGenerationJob>>();
  readonly #controllers = new Map<string, AbortController>();
  readonly #workers = new Map<string, Promise<void>>();
  readonly #mutationLocks = new Map<string, Promise<void>>();
  readonly #now: () => Date;
  readonly #id: () => string;
  readonly #limit: number;
  readonly #yieldStage: NonNullable<GenerationJobManagerOptions["stageYield"]>;
  #initialized = false;

  constructor(readonly options: GenerationJobManagerOptions) {
    this.#now = options.now ?? (() => new Date());
    this.#id = options.id ?? (() => `job_${randomUUID().replaceAll("-", "")}`);
    this.#limit = options.maxRunningPerScope ?? 2;
    if (!Number.isSafeInteger(this.#limit) || this.#limit < 1 || this.#limit > 8) throw new TypeError("maxRunningPerScope must be between 1 and 8");
    this.#yieldStage = options.stageYield ?? (async () => Promise.resolve());
  }

  async initialize(): Promise<void> {
    if (this.#initialized) return;
    await mkdir(this.scopesDirectory(), { recursive: true });
    let scopes: string[] = [];
    try { scopes = await readdir(this.scopesDirectory()); } catch { scopes = []; }
    for (const scopeHash of scopes.filter((name) => SCOPE_HASH.test(name))) {
      const jobs = new Map<string, PersistedGenerationJob>();
      let names: string[] = [];
      try { names = await readdir(this.jobDirectory(scopeHash)); } catch { names = []; }
      for (const name of names.filter((candidate) => /^job_[a-z0-9]{8,59}\.json$/u.test(candidate))) {
        try {
          const parsed = JSON.parse(await readFile(join(this.jobDirectory(scopeHash), name), "utf8")) as unknown;
          if (!isPersistedJob(parsed, scopeHash) || `${parsed.jobId}.json` !== name) continue;
          if (ACTIVE_STATUSES.has(parsed.status)) {
            const at = this.timestamp();
            parsed.status = "queued";
            parsed.updatedAt = at;
            delete parsed.error;
            delete parsed.projectId;
            parsed.stages.push({ status: "queued", at });
            await this.persist(parsed);
          }
          jobs.set(parsed.jobId, parsed);
        } catch {
          // Corrupt or incomplete records are ignored rather than trusted.
        }
      }
      if (jobs.size > 0) this.#jobs.set(scopeHash, jobs);
    }
    this.#initialized = true;
    for (const scopeHash of this.#jobs.keys()) this.schedule(scopeHash);
  }

  async create(scopeHash: string, input: DesignDirectorInput): Promise<GenerationJob> {
    this.requireInitialized();
    assertScopeHash(scopeHash);
    if (!this.options.provider) throw new GenerationProviderUnavailableError();
    if (this.activeCount(scopeHash) >= this.#limit) throw new GenerationJobLimitError(this.#limit);
    const jobId = this.#id();
    if (!JOB_ID.test(jobId)) throw new TypeError("Injected generation job ID is invalid");
    const jobs = this.jobsFor(scopeHash);
    if (jobs.has(jobId)) throw new Error("Generation job ID already exists");
    const at = this.timestamp();
    const job: PersistedGenerationJob = {
      persistenceVersion: 1,
      scopeHash,
      jobId,
      status: "queued",
      createdAt: at,
      updatedAt: at,
      stages: [{ status: "queued", at }],
      input: structuredClone(input),
    };
    jobs.set(jobId, job);
    try { await this.persist(job); } catch (error) { jobs.delete(jobId); throw error; }
    const projection = publicJob(job);
    this.schedule(scopeHash);
    return projection;
  }

  get(scopeHash: string, jobId: string): GenerationJob | null {
    this.requireInitialized();
    assertScopeHash(scopeHash);
    if (!JOB_ID.test(jobId)) return null;
    const job = this.#jobs.get(scopeHash)?.get(jobId);
    return job ? publicJob(job) : null;
  }

  list(scopeHash: string): GenerationJob[] {
    this.requireInitialized();
    assertScopeHash(scopeHash);
    return [...(this.#jobs.get(scopeHash)?.values() ?? [])]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.jobId.localeCompare(left.jobId))
      .map(publicJob);
  }

  activeCount(scopeHash: string): number {
    this.requireInitialized();
    assertScopeHash(scopeHash);
    return [...(this.#jobs.get(scopeHash)?.values() ?? [])].filter((job) => ACTIVE_STATUSES.has(job.status)).length;
  }

  async cancel(scopeHash: string, jobId: string): Promise<GenerationJob | null> {
    this.requireInitialized();
    assertScopeHash(scopeHash);
    if (!JOB_ID.test(jobId)) return null;
    const job = this.#jobs.get(scopeHash)?.get(jobId);
    if (!job) return null;
    if (TERMINAL_STATUSES.has(job.status)) return publicJob(job);
    this.#controllers.get(this.jobKey(job))?.abort(new Error("generation job cancelled"));
    await this.transition(job, "cancelled");
    return publicJob(job);
  }

  async drain(): Promise<void> {
    while (this.#workers.size > 0) await Promise.allSettled([...this.#workers.values()]);
  }

  private requireInitialized(): void {
    if (!this.#initialized) throw new Error("GenerationJobManager.initialize() must be awaited first");
  }

  private timestamp(): string {
    return this.#now().toISOString();
  }

  private scopesDirectory(): string {
    return join(this.options.rootDirectory, "sessions");
  }

  private jobDirectory(scopeHash: string): string {
    assertScopeHash(scopeHash);
    return join(this.scopesDirectory(), scopeHash, "generation-jobs");
  }

  private jobsFor(scopeHash: string): Map<string, PersistedGenerationJob> {
    let jobs = this.#jobs.get(scopeHash);
    if (!jobs) {
      jobs = new Map();
      this.#jobs.set(scopeHash, jobs);
    }
    return jobs;
  }

  private async persist(job: PersistedGenerationJob): Promise<void> {
    const directory = this.jobDirectory(job.scopeHash);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const destination = join(directory, `${job.jobId}.json`);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(job, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, destination);
  }

  private async transition(job: PersistedGenerationJob, status: GenerationJobStatus, error?: GenerationJobError, projectId?: string): Promise<void> {
    await this.withMutationLock(this.jobKey(job), async () => {
      if (job.status === status && TERMINAL_STATUSES.has(status)) return;
      if (!NEXT_STATUS[job.status].has(status)) return;
      const at = this.timestamp();
      job.status = status;
      job.updatedAt = at;
      job.stages.push({ status, at });
      if (error) job.error = error; else delete job.error;
      if (projectId) job.projectId = projectId;
      await this.persist(job);
      await this.options.onTransition?.(job.scopeHash, structuredClone(job.input), publicJob(job));
    });
  }

  private jobKey(job: Pick<PersistedGenerationJob, "scopeHash" | "jobId">): string {
    return `${job.scopeHash}:${job.jobId}`;
  }

  private async withMutationLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#mutationLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.then(() => current);
    this.#mutationLocks.set(key, queued);
    await previous;
    try { return await operation(); } finally {
      release();
      if (this.#mutationLocks.get(key) === queued) this.#mutationLocks.delete(key);
    }
  }

  private schedule(scopeHash: string): void {
    if (!this.#initialized || !this.options.provider) return;
    const jobs = this.#jobs.get(scopeHash);
    if (!jobs) return;
    const running = [...this.#workers.keys()].filter((key) => key.startsWith(`${scopeHash}:`)).length;
    const capacity = this.#limit - running;
    if (capacity <= 0) return;
    const queued = [...jobs.values()].filter((job) => job.status === "queued").slice(0, capacity);
    for (const job of queued) {
      const key = this.jobKey(job);
      if (this.#workers.has(key)) continue;
      const worker = this.run(job).finally(() => {
        this.#workers.delete(key);
        this.#controllers.delete(key);
        this.schedule(scopeHash);
      });
      this.#workers.set(key, worker);
    }
  }

  private async run(job: PersistedGenerationJob): Promise<void> {
    const provider = this.options.provider;
    if (!provider || job.status !== "queued") return;
    const controller = new AbortController();
    this.#controllers.set(this.jobKey(job), controller);
    try {
      await this.transition(job, "analyzing");
      await this.#yieldStage("analyzing", publicJob(job), controller.signal);
      if (this.wasCancelled(job)) return;

      await this.transition(job, "generating");
      await this.#yieldStage("generating", publicJob(job), controller.signal);
      if (this.wasCancelled(job)) return;
      const result = await generateWithModel(provider, {
        contractVersion: MODEL_ADAPTER_CONTRACT_VERSION,
        requestId: job.jobId,
        input: structuredClone(job.input),
        signal: controller.signal,
      });
      if (this.wasCancelled(job)) return;
      if (result.status === "rejected") {
        await this.transition(job, "failed", {
          code: result.error.code,
          retryable: result.error.retryable,
          message: safeMessage(result.error.message),
        });
        return;
      }

      await this.options.onAcceptedOutput?.(job.scopeHash, structuredClone(job.input), structuredClone(result.output));

      await this.transition(job, "validating");
      await this.#yieldStage("validating", publicJob(job), controller.signal);
      if (this.wasCancelled(job)) return;
      const document = result.output.importResult.document;
      const gate = await this.options.documentGate?.(structuredClone(document)) ?? { accepted: true };
      await this.options.onDocumentChecked?.(job.scopeHash, structuredClone(job.input), structuredClone(document), structuredClone(gate));
      if (!gate.accepted) {
        await this.transition(job, "failed", {
          code: gate.code ?? "qa_failed",
          retryable: gate.retryable ?? false,
          message: safeMessage(gate.message ?? "The generated document did not pass QA"),
        });
        return;
      }
      await this.options.onValidatedDocument?.(job.scopeHash, structuredClone(job.input), structuredClone(document));
      await this.options.projectWriter(job.scopeHash, structuredClone(document));
      if (this.wasCancelled(job)) return;
      await this.transition(job, "completed", undefined, document.documentId);
    } catch (error) {
      if (this.wasCancelled(job)) return;
      await this.transition(job, "failed", {
        code: "generation_internal_failure",
        retryable: true,
        message: safeMessage(error),
      });
    }
  }

  private wasCancelled(job: PersistedGenerationJob): boolean {
    return job.status === "cancelled";
  }
}
