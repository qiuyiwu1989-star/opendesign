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
    return await apiRequest<SceneDocument>(`/api/projects/${projectId}`);
  } catch (error) {
    if (error instanceof Error && error.message === "Project not found") return null;
    throw error;
  }
}

export async function listProjects(): Promise<ProjectSummary[]> {
  return (await apiRequest<{ projects: ProjectSummary[] }>("/api/projects")).projects;
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
