import type { Revision, SceneDocument, ScenePatch } from "@opendesign/studio-contracts";

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
  editabilityReport?: unknown;
};

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

export async function generateProject(brief: string, title?: string): Promise<GeneratedProject> {
  return apiRequest<GeneratedProject>("/api/projects/generate", {
    method: "POST",
    body: JSON.stringify({ brief, ...(title ? { title } : {}) }),
  });
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
