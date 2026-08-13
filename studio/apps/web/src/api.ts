import type { DesignPackPin, DocumentProvenance, HtmlImportResult, Revision, SceneDocument, ScenePatch } from "@opendesign/studio-contracts";
import type { DesignDirectorInput, DesignDirectorOutput } from "@opendesign/studio-design-director";
import type { ModelGenerationResult } from "@opendesign/studio-model-adapter";
import type { ReviewLedger, ReviewProjection } from "@opendesign/studio-publishing";

export type ProjectSummary = { projectId: string; title: string; sceneCount: number; updatedAt: string };
export type StoredRevision = { revision: Revision; document: SceneDocument };
export type GeneratedProject = {
  document: SceneDocument;
  storyline: Array<{ sceneId: string; order: number; title: string; purpose: string; headline: string }>;
  generator: "local-rules-v0";
};

export type StudioExportKind = "html" | "png" | "pptx";
export type StudioExportResult = {
  exportId: string;
  kind: StudioExportKind;
  renderer: string;
  warning?: string;
  files: Array<{ name: string; downloadUrl: string }>;
  bundle?: { name: string; downloadUrl: string };
  editabilityReport?: unknown;
};

export type StudioQaIssue = {
  issueId: string;
  sceneId: string;
  elementIds: string[];
  category: string;
  severity: "blocker" | "error" | "warning" | "note";
  message: string;
  safeAutoFix: boolean;
};

export type StudioQaReport = {
  documentId: string;
  summary: { blocker: number; error: number; warning: number; note: number; total: number };
  issues: StudioQaIssue[];
};

export type ProjectAsset = { assetId: string; name: string; mimeType: "image/png" | "image/jpeg"; width: number; height: number; url: string };
export type ReviewResponse = { ledger: ReviewLedger; projection: ReviewProjection };
export type ModelDraftResponse = { generation: ModelGenerationResult; review?: ReviewProjection };

export const generationJobStatuses = ["queued", "analyzing", "generating", "validating", "completed", "failed", "cancelled"] as const;
export type GenerationJobStatus = typeof generationJobStatuses[number];
export type GenerationJobErrorCode = "offline" | "rate_limited" | "provider_unavailable" | "invalid_input" | "generation_failed";
export type GenerationJob = {
  jobId: string;
  status: GenerationJobStatus;
  createdAt: string;
  updatedAt: string;
  projectId?: string;
  error?: { code: GenerationJobErrorCode; message: string; retryable?: boolean };
};
export type CreateGenerationJobInput = { brief: string; title?: string; designPack?: DesignPackPin };

export class StudioApiError extends Error {
  readonly code: GenerationJobErrorCode;
  readonly status: number;

  constructor(message: string, code: GenerationJobErrorCode, status = 0) {
    super(message);
    this.name = "StudioApiError";
    this.code = code;
    this.status = status;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function parseGenerationJob(value: unknown): GenerationJob {
  if (!isObject(value)
    || typeof value.jobId !== "string" || value.jobId.length === 0
    || !generationJobStatuses.includes(value.status as GenerationJobStatus)
    || !isIsoDate(value.createdAt) || !isIsoDate(value.updatedAt)) {
    throw new StudioApiError("生成任务响应格式无效，请稍后重试。", "generation_failed");
  }
  if (value.projectId !== undefined && (typeof value.projectId !== "string" || value.projectId.length === 0)) {
    throw new StudioApiError("生成任务返回了无效的作品 ID。", "generation_failed");
  }
  let error: GenerationJob["error"];
  if (value.error !== undefined) {
    if (!isObject(value.error)
      || typeof value.error.code !== "string" || value.error.code.length === 0
      || typeof value.error.message !== "string"
      || (value.error.retryable !== undefined && typeof value.error.retryable !== "boolean")) {
      throw new StudioApiError("生成任务返回了无效的错误信息。", "generation_failed");
    }
    const code = ["offline", "rate_limited", "provider_unavailable", "invalid_input"].includes(value.error.code) ? value.error.code as GenerationJobErrorCode : "generation_failed";
    error = { code, message: value.error.message, ...(value.error.retryable === undefined ? {} : { retryable: value.error.retryable }) };
  }
  if (value.status === "completed" && !value.projectId) {
    throw new StudioApiError("生成已完成，但没有可打开的作品。", "generation_failed");
  }
  if (value.status === "failed" && !error) {
    throw new StudioApiError("生成失败，但服务端没有返回诊断信息。", "generation_failed");
  }
  return {
    jobId: value.jobId,
    status: value.status as GenerationJobStatus,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    ...(value.projectId ? { projectId: value.projectId } : {}),
    ...(error ? { error } : {}),
  };
}

function apiErrorFromPayload(payload: unknown, status: number): StudioApiError {
  const object = isObject(payload) ? payload : {};
  const nested = isObject(object.error) ? object.error : undefined;
  const rawCode = nested?.code ?? object.code;
  const code = status === 429 ? "rate_limited"
    : rawCode === "provider_unavailable" ? "provider_unavailable"
    : rawCode === "invalid_input" ? "invalid_input"
    : rawCode === "rate_limited" ? "rate_limited"
    : "generation_failed";
  const message = typeof nested?.message === "string" ? nested.message
    : typeof object.error === "string" ? object.error
    : typeof object.message === "string" ? object.message
    : `Studio API returned ${status}`;
  return new StudioApiError(message, code, status);
}

async function generationRequest(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
    });
  } catch {
    throw new StudioApiError("当前网络不可用。恢复网络后可重试；已建立的任务仍可通过任务 ID 恢复。", "offline");
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new StudioApiError("生成服务返回了无法读取的响应。", "generation_failed", response.status);
  }
  if (!response.ok) throw apiErrorFromPayload(payload, response.status);
  return payload;
}

function parseJobEnvelope(payload: unknown): GenerationJob {
  if (!isObject(payload) || !("job" in payload)) {
    throw new StudioApiError("生成服务没有返回任务。", "generation_failed");
  }
  return parseGenerationJob(payload.job);
}

export async function createGenerationJob(input: CreateGenerationJobInput): Promise<GenerationJob> {
  return parseJobEnvelope(await generationRequest("/api/generation-jobs", { method: "POST", body: JSON.stringify(input) }));
}

export async function loadGenerationJob(jobId: string): Promise<GenerationJob> {
  return parseJobEnvelope(await generationRequest(`/api/generation-jobs/${encodeURIComponent(jobId)}`));
}

export async function cancelGenerationJob(jobId: string): Promise<GenerationJob> {
  return parseJobEnvelope(await generationRequest(`/api/generation-jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST", body: "{}" }));
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || `Studio API returned ${response.status}`);
  return payload;
}

export async function loadProject(projectId: string): Promise<SceneDocument | null> {
  try {
    const document = await apiRequest<SceneDocument>(`/api/projects/${projectId}`);
    if (!document || document.documentId !== projectId || !Array.isArray(document.scenes) || !Array.isArray(document.directions)) {
      throw new Error("Studio API returned an invalid project document");
    }
    return document;
  } catch (error) {
    if (error instanceof Error && error.message === "Project not found") return null;
    throw error;
  }
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const payload = await apiRequest<{ projects?: ProjectSummary[] }>("/api/projects");
  if (!Array.isArray(payload.projects)) throw new Error("Studio API returned an invalid project list");
  return payload.projects;
}

export async function generateProject(brief: string, title?: string, designPack?: DesignPackPin): Promise<GeneratedProject> {
  return apiRequest<GeneratedProject>("/api/projects/generate", {
    method: "POST",
    body: JSON.stringify({ brief, ...(title ? { title } : {}), ...(designPack ? { designPack } : {}) }),
  });
}

export async function createDesignDirectorDraft(input: DesignDirectorInput): Promise<DesignDirectorOutput> {
  const response = await fetch("/api/design-director/drafts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await response.json() as DesignDirectorOutput & { error?: string };
  if (response.status === 422 && payload.status === "rejected") return payload;
  if (!response.ok) throw new Error(payload.error || `Studio API returned ${response.status}`);
  return payload;
}

export async function createModelDraft(input: DesignDirectorInput): Promise<ModelDraftResponse> {
  const result = await apiRequest<ModelDraftResponse>("/api/model/drafts", {
    method: "POST",
    body: JSON.stringify({ requestId: `model_${Date.now().toString(36)}`, input }),
  });
  return result;
}

export async function loadReview(reviewId: string): Promise<ReviewResponse | null> {
  try {
    return await apiRequest<ReviewResponse>(`/api/reviews/${reviewId}`);
  } catch (error) {
    if (error instanceof Error && error.message === "Review not found") return null;
    throw error;
  }
}

export async function submitProjectReview(reviewId: string, revisionId: string, currentDocument: SceneDocument): Promise<ReviewResponse> {
  return apiRequest<ReviewResponse>(`/api/reviews/${reviewId}/submit`, {
    method: "POST",
    body: JSON.stringify({ revisionId, currentDocument }),
  });
}

export async function approveProjectCandidate(reviewId: string, revisionId: string, reason: string): Promise<ReviewResponse> {
  return apiRequest<ReviewResponse>(`/api/reviews/${reviewId}/approve`, {
    method: "POST",
    body: JSON.stringify({ revisionId, reason }),
  });
}

export async function importProjectHtml(html: string, provenance: DocumentProvenance): Promise<HtmlImportResult> {
  const response = await fetch("/api/imports/html", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ html, provenance }),
  });
  const payload = await response.json() as HtmlImportResult & { error?: string };
  if (response.status === 422 && payload.status === "rejected") return payload;
  if (!response.ok) throw new Error(payload.error || `Studio API returned ${response.status}`);
  return payload;
}

export async function duplicateProject(projectId: string): Promise<SceneDocument> {
  return (await apiRequest<{ document: SceneDocument }>(`/api/projects/${projectId}/duplicate`, { method: "POST", body: "{}" })).document;
}

export async function listRevisions(projectId: string): Promise<StoredRevision[]> {
  return (await apiRequest<{ revisions: StoredRevision[] }>(`/api/projects/${projectId}/revisions`)).revisions;
}

export async function persistProject(document: SceneDocument, patches: ScenePatch[] = [], reason: "edit" | "qa-fix" | "regenerate" = "edit"): Promise<StoredRevision> {
  const result = await apiRequest<{ document: SceneDocument; revision: Revision }>(`/api/projects/${document.documentId}`, {
    method: "PUT",
    body: JSON.stringify({ document, patches, reason }),
  });
  return { document: result.document, revision: result.revision };
}

export async function createExport(projectId: string, kind: StudioExportKind): Promise<StudioExportResult> {
  return apiRequest<StudioExportResult>(`/api/projects/${projectId}/exports`, {
    method: "POST",
    body: JSON.stringify({ kind }),
  });
}

export async function runProjectQa(document: SceneDocument): Promise<StudioQaReport> {
  return apiRequest<StudioQaReport>("/api/qa", {
    method: "POST",
    body: JSON.stringify({ document }),
  });
}

export async function uploadProjectImage(projectId: string, file: File): Promise<ProjectAsset> {
  const buffer = new Uint8Array(await new Response(file).arrayBuffer());
  let binary = "";
  for (const byte of buffer) binary += String.fromCharCode(byte);
  return apiRequest<ProjectAsset>(`/api/projects/${projectId}/assets`, {
    method: "POST",
    body: JSON.stringify({ name: file.name, mimeType: file.type, data: btoa(binary) }),
  });
}
