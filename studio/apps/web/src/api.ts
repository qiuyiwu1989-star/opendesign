import type { SceneDocument } from "@opendesign/studio-contracts";

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

export async function persistProject(document: SceneDocument): Promise<void> {
  await apiRequest(`/api/projects/${document.documentId}`, {
    method: "PUT",
    body: JSON.stringify(document),
  });
}

export async function createExport(projectId: string, kind: StudioExportKind): Promise<StudioExportResult> {
  return apiRequest<StudioExportResult>(`/api/projects/${projectId}/exports`, {
    method: "POST",
    body: JSON.stringify({ kind }),
  });
}
