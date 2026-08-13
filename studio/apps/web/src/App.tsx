import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { DesignDirection, HtmlImportResult, Scene, SceneDocument, SceneElement, ScenePatch, StudioIssue } from "@opendesign/studio-contracts";
import type { DesignDirectorInput, DesignDirectorOutput } from "@opendesign/studio-design-director";
import fixture from "@opendesign/studio-contracts/fixtures/proposal-v0";
import { designPacks, getDesignPack } from "@opendesign/studio-design-packs/catalog";
import { Badge, Button, Icon, Kicker, ProgressRing, Tabs } from "@opendesign/studio-ui";
import goldenTaskFixture from "../../../fixtures/golden-task/design-studio-brief-v01.json";
import goldenStructuredHtml from "../../../fixtures/golden-task/structured-html-v01.html?raw";
import benchmarkBaseline from "../../../fixtures/design-benchmark/baseline/benchmark-report.json";
import {
  createExport,
  createDesignDirectorDraft,
  createModelDraft,
  approveProjectCandidate,
  duplicateProject,
  generateProject,
  importProjectHtml,
  listProjects,
  listRevisions,
  loadProject,
  loadReview,
  persistProject,
  runProjectQa,
  submitProjectReview,
  uploadProjectImage,
  type ProjectSummary,
  type StoredRevision,
  type StudioExportResult,
  type ReviewResponse,
} from "./api";
import {
  changeZIndex,
  constrainFrame,
  createHistory,
  deleteScene as deleteSceneDraft,
  duplicateScene as duplicateSceneDraft,
  pushHistory,
  redoHistory,
  regenerationConflicts,
  undoHistory,
  type DraftHistory,
  type EditorElement,
  type FocalPoint,
  type ImageFit,
} from "./editor-model";

const initialDocument = fixture as unknown as SceneDocument;
const fontOptions = [
  { label: "现代无衬线", value: "Inter, system-ui, sans-serif" },
  { label: "中文黑体", value: "Hiragino Sans GB, Microsoft YaHei, sans-serif" },
  { label: "编辑宋体", value: "Songti SC, SimSun, serif" },
  { label: "经典衬线", value: "Georgia, Noto Serif SC, serif" },
  { label: "演示衬线", value: "Times New Roman, Songti SC, serif" },
  { label: "等宽技术", value: "Menlo, Consolas, monospace" },
] as const;

type InspectorTab = "edit" | "qa" | "history" | "export";
type ExportKind = "html" | "png" | "pptx";
type ExportState = "idle" | "working" | "ready" | "error";
type SyncState = "local" | "saving" | "saved" | "error";
type WorkflowStep = "sources" | "outline" | "direction" | "studio";

type GoldenTaskFixture = {
  sources: Array<{ sourceId: string; type: "brief" | "manual" | "document"; title: string; status: "snapshot"; sourceRef: string; content: string }>;
  brand: { name: string; voice: string[] };
  brief: { objective: string; audience: string; decisionRequest: string; mustAvoid: string[] };
  expectedOutline: Array<{ order: number; pageRole: string; intent: string; sourceIds: string[] }>;
  directions: Array<{ id: string; name: string; pack: { id: string; version: string }; stance: "primary" | "alternate"; selectionRationale: string }>;
  selectedDirectionId: string;
};

type BenchmarkBaseline = {
  passed: boolean;
  summary: { taskCount: number; contractPassed: number; nativeEditabilityComplete: number; qaBlockers: number; qaWarnings: number; exportsSucceeded: number; deterministicTasks: number };
  tasks: Array<{ taskId: string; scenario: string; passed: boolean; machine: { qa: { error: number; warning: number }; nativeEditability: { ratio: number }; export: { succeeded: boolean } } }>;
  manualAestheticRubric: { aggregation: "prohibited" };
};

const goldenTask = goldenTaskFixture as GoldenTaskFixture;
const qualityBaseline = benchmarkBaseline as BenchmarkBaseline;

const processSteps = [
  ["sources", "01", "Sources"],
  ["outline", "02", "Outline"],
  ["direction", "03", "Direction"],
  ["studio", "04", "Studio"],
] as const;

function sentenceFromBrief(value: string): string {
  const sentence = value.replace(/\s+/gu, " ").trim().split(/[。！？!?]/u)[0]?.trim() || "OpenDesign Studio 设计初稿";
  return sentence.length <= 64 ? sentence : `${sentence.slice(0, 63)}…`;
}

function getElement(document: SceneDocument, elementId: string | null) {
  if (!elementId) return null;
  return document.scenes.flatMap((scene) => scene.elements).find((element) => element.id === elementId) ?? null;
}

function patchElement(document: SceneDocument, patch: ScenePatch): SceneDocument {
  if ("directionId" in patch) {
    return { ...document, directions: document.directions.map((direction) => direction.id === patch.directionId ? { ...direction, tokens: { ...direction.tokens, [patch.field]: patch.value } } : direction) };
  }
  return {
    ...document,
    scenes: document.scenes.map((scene) => ({
      ...scene,
      elements: scene.elements.map((element) => element.id === patch.elementId ? { ...element, [patch.field]: patch.value } : element),
    })),
  };
}

function DirectionOption({ direction, active, onSelect }: { direction: DesignDirection; active: boolean; onSelect: () => void }) {
  return (
    <button className={`direction-option ${active ? "is-active" : ""}`} type="button" onClick={onSelect} aria-pressed={active}>
      <span className="direction-option__swatch" style={{ background: direction.tokens.background }}>
        <span style={{ background: direction.tokens.accent }} />
        <span style={{ background: direction.tokens.text }} />
      </span>
      <span className="direction-option__copy">
        <strong>{direction.name}</strong>
        <small>{direction.stance === "primary" ? "主方向" : "备选方向"}</small>
      </span>
      {active && <Icon name="check" size={14} />}
    </button>
  );
}

function SceneCanvas({ scene, direction, selectedElementId, issueElementIds, onSelect, onFrameChange }: {
  scene: Scene;
  direction: DesignDirection;
  selectedElementId: string | null;
  issueElementIds: Set<string>;
  onSelect: (element: SceneElement, edit: boolean) => void;
  onFrameChange: (elementId: string, frame: SceneElement["frame"]) => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(.5);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setScale(entry.contentRect.width / 1600);
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  function beginTransform(event: ReactPointerEvent, element: SceneElement, mode: "move" | "resize") {
    if (!element.editable || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(element, false);
    const origin = { x: event.clientX, y: event.clientY, frame: element.frame };
    const move = (pointer: PointerEvent) => {
      const dx = (pointer.clientX - origin.x) / scale;
      const dy = (pointer.clientY - origin.y) / scale;
      const candidate = mode === "move"
        ? { ...origin.frame, x: origin.frame.x + dx, y: origin.frame.y + dy }
        : { ...origin.frame, width: origin.frame.width + dx, height: origin.frame.height + dy };
      onFrameChange(element.id, constrainFrame(candidate, { width: 1600, height: 900 }));
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
  }

  return (
    <div className="scene-frame" ref={frameRef} data-testid="scene-canvas">
      <div
        className="scene-canvas"
        style={{
          width: 1600,
          height: 900,
          transform: `scale(${scale})`,
          background: direction.tokens.background,
          color: direction.tokens.text,
          fontFamily: direction.tokens.fontFamily,
          "--scene-accent": direction.tokens.accent,
          "--scene-surface": direction.tokens.surface,
          "--scene-muted": direction.tokens.muted,
          "--scene-line": direction.tokens.line,
          "--scene-heading": direction.tokens.headingFamily,
        } as CSSProperties}
      >
        <span className="scene-canvas__folio">{String(scene.order).padStart(2, "0")}</span>
        {scene.elements.map((rawElement) => {
          const element = rawElement as EditorElement;
          return (
          <button
            key={element.id}
            type="button"
            className={`scene-element scene-element--${element.type} scene-element--${element.role} ${selectedElementId === element.id ? "is-selected" : ""} ${issueElementIds.has(element.id) ? "has-issue" : ""}`}
            style={{
              left: element.frame.x,
              top: element.frame.y,
              width: element.frame.width,
              height: element.frame.height,
              color: element.color === "accent" ? direction.tokens.accent : element.color,
              background: element.fill === "accent" ? direction.tokens.accent : element.fill === "surface" ? direction.tokens.surface : element.fill,
              fontSize: element.fontSize,
              fontWeight: element.fontWeight,
              lineHeight: element.lineHeight,
              textAlign: element.align,
              zIndex: element.zIndex,
              fontFamily: element.fontFamily ?? (element.role === "title" || element.role === "quote" ? direction.tokens.headingFamily : undefined),
            }}
            onClick={() => onSelect(element, false)}
            onDoubleClick={() => onSelect(element, true)}
            onPointerDown={(event) => beginTransform(event, element, "move")}
            aria-label={`${element.role}: ${element.content ?? element.alt ?? "视觉元素"}`}
          >
            {element.type === "image" && element.assetSrc ? <img src={element.assetSrc} alt={element.alt ?? ""} style={{ objectFit: element.imageFit === "stretch" ? "fill" : element.imageFit ?? "cover", objectPosition: `${(element.focalPoint?.x ?? .5) * 100}% ${(element.focalPoint?.y ?? .5) * 100}%` }} /> : element.type !== "shape" && <span>{element.content}</span>}
            {issueElementIds.has(element.id) && <i className="scene-element__issue"><Icon name="warning" size={18} /></i>}
            {selectedElementId === element.id && element.editable && <i className="scene-element__resize" aria-label="缩放元素" onPointerDown={(event) => beginTransform(event, element, "resize")} />}
          </button>
        );})}
      </div>
    </div>
  );
}

function SceneThumbnail({ scene, direction, active, issueCount, onSelect }: { scene: Scene; direction: DesignDirection; active: boolean; issueCount: number; onSelect: () => void }) {
  return (
    <button type="button" className={`scene-thumb ${active ? "is-active" : ""}`} onClick={onSelect} aria-label={`第 ${scene.order} 页：${scene.title}`}>
      <span className="scene-thumb__preview" style={{ background: direction.tokens.background, color: direction.tokens.text }}>
        <span className="scene-thumb__line" style={{ background: direction.tokens.accent }} />
        <strong>{scene.elements.find((element) => element.role === "title" || element.role === "quote")?.content ?? scene.title}</strong>
        {issueCount > 0 && <i>{issueCount}</i>}
      </span>
      <span className="scene-thumb__label"><small>{String(scene.order).padStart(2, "0")}</small>{scene.title}</span>
    </button>
  );
}

function ExportCard({ kind, title, description, state, result, onExport }: { kind: ExportKind; title: string; description: string; state: ExportState; result: StudioExportResult | undefined; onExport: () => void }) {
  const labels: Record<ExportState, string> = { idle: "生成", working: "处理中", ready: "重新生成", error: "重试" };
  return (
    <div className="export-card">
      <span className={`export-card__icon export-card__icon--${kind}`}><Icon name={kind === "png" ? "image" : kind === "pptx" ? "layers" : "code"} /></span>
      <span className="export-card__copy"><strong>{title}</strong><small>{description}</small></span>
      <Button size="sm" tone={state === "ready" ? "quiet" : "outline"} onClick={onExport} disabled={state === "working"} aria-label={`${title}：${labels[state]}`}>
        {state === "working" ? <span className="spinner" /> : state === "ready" ? <Icon name="check" size={13} /> : <Icon name="download" size={13} />}
        {labels[state]}
      </Button>
      {state === "ready" && result?.files[0] && <a className="export-card__download" href={(kind === "png" ? result.bundle : result.files[0])?.downloadUrl ?? result.files[0].downloadUrl} download>{kind === "png" ? `下载 ${result.files.length} 页 ZIP` : "下载文件"}</a>}
      {state === "error" && <small className="export-card__error">生成失败，请检查本地 API。</small>}
    </div>
  );
}

export function App() {
  const [history, setHistory] = useState<DraftHistory<SceneDocument>>(() => createHistory(initialDocument));
  const document = history.present;
  const [selectedSceneId, setSelectedSceneId] = useState(initialDocument.scenes[0]?.id ?? "");
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("edit");
  const [brief, setBrief] = useState("把文章或提案转化成一套能继续编辑、持续迭代的视觉叙事。核心受众是需要快速交付提案的独立创作者与小团队。");
  const [patches, setPatches] = useState<ScenePatch[]>([]);
  const [documentDirty, setDocumentDirty] = useState(false);
  const [issues, setIssues] = useState<StudioIssue[]>([]);
  const [qaState, setQaState] = useState<"checking" | "ready" | "error">("checking");
  const [exportStates, setExportStates] = useState<Record<ExportKind, ExportState>>({ html: "idle", png: "idle", pptx: "idle" });
  const [exportResults, setExportResults] = useState<Partial<Record<ExportKind, StudioExportResult>>>({});
  const [syncState, setSyncState] = useState<SyncState>("local");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [revisions, setRevisions] = useState<StoredRevision[]>([]);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [generatorState, setGeneratorState] = useState<"idle" | "working" | "error">("idle");
  const [generatorError, setGeneratorError] = useState("");
  const [directorOutput, setDirectorOutput] = useState<DesignDirectorOutput | null>(null);
  const [modelProvider, setModelProvider] = useState<{ id: string; model: string } | null>(null);
  const [review, setReview] = useState<ReviewResponse | null>(null);
  const [reviewState, setReviewState] = useState<"idle" | "working" | "error">("idle");
  const [reviewReason, setReviewReason] = useState("已核对内容、来源、设计细节与 QA 结果，可作为发布候选继续评审。");
  const [reviewError, setReviewError] = useState("");
  const [assetState, setAssetState] = useState<"idle" | "uploading" | "error">("idle");
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [localDraftOperations, setLocalDraftOperations] = useState(0);
  const [regenerationPreview, setRegenerationPreview] = useState<{ document: SceneDocument; changedElementIds: string[] } | null>(null);
  const [fixPreviewIssueId, setFixPreviewIssueId] = useState<string | null>(null);
  const [workflowStep, setWorkflowStep] = useState<WorkflowStep>("studio");
  const initialPack = goldenTask.directions.find((item) => item.id === goldenTask.selectedDirectionId)?.pack;
  const [selectedPackId, setSelectedPackId] = useState(initialPack?.id ?? designPacks[0]?.id ?? "");
  const [annotationCopyState, setAnnotationCopyState] = useState<"idle" | "copied" | "manual">("idle");
  const [htmlInput, setHtmlInput] = useState("");
  const [importState, setImportState] = useState<"idle" | "working" | "ready" | "error">("idle");
  const [importResult, setImportResult] = useState<HtmlImportResult | null>(null);
  const [importError, setImportError] = useState("");
  const selectedPack = getDesignPack(selectedPackId);

  function commitDocument(update: SceneDocument | ((current: SceneDocument) => SceneDocument), localOnly = false) {
    setHistory((current) => {
      const next = typeof update === "function" ? update(current.present) : update;
      return pushHistory(current, next);
    });
    if (localOnly) setLocalDraftOperations((count) => count + 1);
    setDocumentDirty(true);
  }

  useEffect(() => {
    let active = true;
    Promise.all([loadProject(initialDocument.documentId), listProjects()])
      .then(([stored, availableProjects]) => {
        if (active) setProjects(availableProjects);
        if (active && stored) {
          setHistory(createHistory(stored));
          setSelectedSceneId(stored.scenes[0]?.id ?? "");
          setSyncState("saved");
          void refreshRevisions(stored.documentId);
        }
      })
      .catch(() => { if (active) setSyncState("local"); });
    return () => { active = false; };
  }, []);

  const scene = document.scenes.find((item) => item.id === selectedSceneId) ?? document.scenes[0]!;
  const direction = document.directions.find((item) => item.id === document.selectedDirectionId) ?? document.directions[0]!;
  const selectedElement = getElement(document, selectedElementId);
  const openIssues = issues.filter((issue) => issue.status === "open");
  const sceneIssues = openIssues.filter((issue) => issue.sceneId === scene.id);
  const issueElementIds = useMemo(() => new Set(sceneIssues.flatMap((issue) => issue.elementIds)), [sceneIssues]);
  const unsavedCount = patches.length;
  const hasUnsavedChanges = documentDirty || unsavedCount > 0;
  const qaScore = qaState === "ready" ? Math.max(0, 100 - openIssues.reduce((score, issue) => score + ({ blocker: 35, error: 20, warning: 8, note: 2 }[issue.severity]), 0)) : 0;
  const totalElements = document.scenes.reduce((count, item) => count + item.elements.length, 0);
  const pptxReport = exportResults.pptx?.editabilityReport as { summary?: { nativeElements?: number; rasterFallbacks?: number; omittedElements?: number } } | undefined;

  useEffect(() => {
    let active = true;
    setQaState("checking");
    const timeout = window.setTimeout(() => {
      runProjectQa(document)
        .then((report) => {
          if (!active) return;
          setIssues(report.issues.map((issue) => ({ ...issue, category: issue.category as StudioIssue["category"], status: "open" })));
          setQaState("ready");
        })
        .catch(() => { if (active) setQaState("error"); });
    }, 180);
    return () => { active = false; window.clearTimeout(timeout); };
  }, [document]);

  async function refreshProjects() {
    setProjects(await listProjects());
  }

  async function refreshRevisions(projectId = document.documentId) {
    setRevisions(await listRevisions(projectId));
  }

  async function refreshReview(projectId = document.documentId) {
    const next = await loadReview(`review_${projectId}`);
    setReview(next);
  }

  function openDocument(next: SceneDocument) {
    setHistory(createHistory(next));
    setSelectedSceneId(next.scenes[0]?.id ?? "");
    setSelectedElementId(null);
    setPatches([]);
    setDocumentDirty(false);
    setLocalDraftOperations(0);
    setRegenerationPreview(null);
    setExportResults({});
    setExportStates({ html: "idle", png: "idle", pptx: "idle" });
    setSyncState("saved");
    setInspectorTab("edit");
    setReview(null);
    setModelProvider(null);
    void refreshReview(next.documentId).catch(() => undefined);
  }

  function selectDirection(directionId: string) {
    commitDocument((current) => ({ ...current, selectedDirectionId: directionId }));
  }

  function selectDesignPack(packId: string) {
    const pack = getDesignPack(packId);
    if (!pack) return;
    setSelectedPackId(pack.id);
    setAnnotationCopyState("idle");
    commitDocument((current) => ({ ...current, designPack: { id: pack.id, version: pack.version } }), true);
  }

  function loadGoldenBrief() {
    setBrief(`${goldenTask.brief.objective}\n\n需要决策：${goldenTask.brief.decisionRequest}`);
    setWorkflowStep("outline");
  }

  async function copyAgentAnnotation() {
    if (!selectedPack) return;
    try {
      await navigator.clipboard.writeText(selectedPack.agentAnnotation.copyText);
      setAnnotationCopyState("copied");
    } catch {
      setAnnotationCopyState("manual");
    }
  }

  async function importHtml() {
    setImportState("working");
    setImportError("");
    setImportResult(null);
    try {
      const result = await importProjectHtml(htmlInput, {
        sources: [
          { sourceId: "source_brief", type: "brief", title: goldenTask.sources[0]?.title ?? "Studio 产品简报", sourceRef: goldenTask.sources[0]?.sourceRef ?? "fixture://golden/brief" },
          { sourceId: "source_constraints", type: "manual", title: goldenTask.sources[1]?.title ?? "安全约束", sourceRef: goldenTask.sources[1]?.sourceRef ?? "fixture://golden/constraints" },
          { sourceId: "source_benchmark", type: "document", title: goldenTask.sources[2]?.title ?? "验收基线", sourceRef: goldenTask.sources[2]?.sourceRef ?? "fixture://golden/benchmark" },
        ],
        generatedBy: { kind: "skill", name: "opendesign-director", version: "0.3.0" },
      });
      setImportResult(result);
      if (result.document) {
        openDocument(result.document);
        setSelectedPackId(result.document.designPack?.id ?? selectedPackId);
        await Promise.all([refreshProjects(), refreshRevisions(result.document.documentId)]);
      }
      setImportState("ready");
    } catch (error) {
      setImportState("error");
      setImportError(error instanceof Error ? error.message : "HTML 导入失败");
    }
  }

  function selectScene(sceneId: string) {
    setSelectedSceneId(sceneId);
    setSelectedElementId(null);
  }

  function selectElement(element: SceneElement, edit = false) {
    setSelectedElementId(element.id);
    if (edit && element.editable) setInspectorTab("edit");
  }

  function updateSelectedContent(value: string) {
    if (!selectedElement || !selectedElement.editable) return;
    const patch: ScenePatch = { elementId: selectedElement.id, field: "content", value };
    commitDocument((current) => patchElement(current, patch));
    setPatches((current) => [...current, patch]);
  }

  function updateDirectionFont(field: "fontFamily" | "headingFamily", value: string) {
    const patch: ScenePatch = { directionId: direction.id, field, value };
    commitDocument((current) => patchElement(current, patch));
    setPatches((current) => [...current, patch]);
  }

  function applyElementPatch(patch: ScenePatch) {
    commitDocument((current) => patchElement(current, patch));
    setPatches((current) => [...current, patch]);
  }

  function updateSelectedField(field: "fontFamily" | "fontSize" | "fontWeight" | "lineHeight" | "color" | "alt" | "imageFit" | "focalPoint", value: string | number | FocalPoint) {
    if (!selectedElement?.editable) return;
    applyElementPatch({ elementId: selectedElement.id, field, value } as ScenePatch);
  }

  function updateElementFrame(elementId: string, frame: SceneElement["frame"]) {
    const nextFrame = constrainFrame(frame, document.canvas);
    applyElementPatch({ elementId, field: "frame", value: nextFrame });
  }

  function duplicateCurrentScene() {
    const next = duplicateSceneDraft(document, scene.id);
    const index = document.scenes.findIndex((item) => item.id === scene.id);
    commitDocument(next, true);
    setSelectedSceneId(next.scenes[index + 1]?.id ?? scene.id);
    setSelectedElementId(null);
  }

  function removeCurrentScene() {
    if (document.scenes.length <= 1) return;
    const index = document.scenes.findIndex((item) => item.id === scene.id);
    const next = deleteSceneDraft(document, scene.id);
    commitDocument(next, true);
    setSelectedSceneId(next.scenes[Math.min(index, next.scenes.length - 1)]?.id ?? "");
    setSelectedElementId(null);
  }

  function moveLayer(delta: -1 | 1) {
    if (!selectedElement) return;
    const next = changeZIndex(document, selectedElement.id, delta);
    const nextElement = getElement(next, selectedElement.id);
    if (!nextElement) return;
    commitDocument(next);
    setPatches((current) => [...current, { elementId: selectedElement.id, field: "zIndex", value: nextElement.zIndex ?? 0 }]);
  }

  function alignSelected(axis: "left" | "center" | "right" | "top" | "middle" | "bottom") {
    if (!selectedElement) return;
    const frame = selectedElement.frame;
    const value = axis === "left" ? { ...frame, x: 0 }
      : axis === "center" ? { ...frame, x: (document.canvas.width - frame.width) / 2 }
      : axis === "right" ? { ...frame, x: document.canvas.width - frame.width }
      : axis === "top" ? { ...frame, y: 0 }
      : axis === "middle" ? { ...frame, y: (document.canvas.height - frame.height) / 2 }
      : { ...frame, y: document.canvas.height - frame.height };
    updateElementFrame(selectedElement.id, value);
  }

  function undo() {
    setHistory((current) => undoHistory(current));
    setDocumentDirty(true);
    setPatches([]);
  }

  function redo() {
    setHistory((current) => redoHistory(current));
    setDocumentDirty(true);
    setPatches([]);
  }

  async function insertOrReplaceImage(file: File) {
    setAssetState("uploading");
    try {
      const asset = await uploadProjectImage(document.documentId, file);
      if (selectedElement?.type === "image") {
        const sourcePatch: ScenePatch = { elementId: selectedElement.id, field: "assetSrc", value: asset.url };
        const altPatch: ScenePatch = { elementId: selectedElement.id, field: "alt", value: file.name.replace(/\.[^.]+$/, "") || "项目图片" };
        commitDocument((current) => patchElement(patchElement(current, sourcePatch), altPatch));
        setPatches((current) => [...current, sourcePatch, altPatch]);
      } else {
        const imageId = `image_${Date.now().toString(36)}`;
        const imageElement: SceneElement = { id: imageId, type: "image", role: "image", frame: { x: 1130, y: 500, width: 300, height: 230 }, assetSrc: asset.url, alt: file.name.replace(/\.[^.]+$/, "") || "项目图片", editable: true, zIndex: 4 };
        commitDocument((current) => ({ ...current, scenes: current.scenes.map((item) => item.id === scene.id ? { ...item, elements: [...item.elements, imageElement] } : item) }), true);
        setSelectedElementId(imageId);
      }
      setAssetState("idle");
    } catch {
      setAssetState("error");
    } finally {
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  }

  function locateIssue(issue: StudioIssue) {
    setSelectedSceneId(issue.sceneId);
    setSelectedElementId(issue.elementIds[0] ?? null);
    setInspectorTab("qa");
  }

  function previewIssueFix(issueId: string) {
    const issue = issues.find((candidate) => candidate.issueId === issueId);
    if (issue?.safeAutoFix) setFixPreviewIssueId(issueId);
  }

  function applyIssueFix(issueId: string) {
    const issue = issues.find((candidate) => candidate.issueId === issueId);
    if (!issue?.safeAutoFix) return;
    setFixPreviewIssueId(null);
    const targetElementId = issue.elementIds[0];
    if (issue.category === "readability.contrast" && targetElementId) {
      const patch: ScenePatch = { elementId: targetElementId, field: "color", value: "text" };
      commitDocument((current) => patchElement(current, patch));
      setPatches((current) => [...current, patch]);
    }
    if (issue.category === "readability.font_size" && targetElementId) {
      const target = getElement(document, targetElementId);
      if (target) {
        const minimum = target.role === "eyebrow" ? 16 : target.role === "title" ? 35 : target.role === "metric" || target.role === "quote" ? 24 : target.role === "caption" ? 14 : 16;
        const patch: ScenePatch = { elementId: targetElementId, field: "fontSize", value: minimum };
        commitDocument((current) => patchElement(current, patch));
        setPatches((current) => [...current, patch]);
      }
    }
  }

  async function saveRevision() {
    setSyncState("saving");
    try {
      await persistProject(document, patches, "edit");
      setPatches([]);
      setDocumentDirty(false);
      setLocalDraftOperations(0);
      setSyncState("saved");
      await Promise.all([refreshProjects(), refreshRevisions()]);
    } catch {
      setSyncState("error");
    }
  }

  async function startExport(kind: ExportKind) {
    setExportStates((current) => ({ ...current, [kind]: "working" }));
    try {
      if (hasUnsavedChanges) {
        await persistProject(document, patches, "edit");
        setPatches([]);
        setDocumentDirty(false);
        setLocalDraftOperations(0);
        setSyncState("saved");
        await Promise.all([refreshProjects(), refreshRevisions()]);
      }
      const result = await createExport(document.documentId, kind);
      setExportResults((current) => ({ ...current, [kind]: result }));
      setExportStates((current) => ({ ...current, [kind]: "ready" }));
    } catch {
      setExportStates((current) => ({ ...current, [kind]: "error" }));
    }
  }

  async function switchProject(projectId: string) {
    const stored = await loadProject(projectId);
    if (!stored) return;
    openDocument(stored);
    setProjectMenuOpen(false);
    await refreshRevisions(projectId);
  }

  async function createFromBrief() {
    setGeneratorState("working");
    setGeneratorError("");
    try {
      const generated = await generateProject(brief, undefined, selectedPack ? { id: selectedPack.id, version: selectedPack.version } : undefined);
      if (hasUnsavedChanges) {
        const conflict = regenerationConflicts(document, generated.document);
        setRegenerationPreview({ document: generated.document, changedElementIds: conflict.changedElementIds });
      } else {
        openDocument(generated.document);
        await Promise.all([refreshProjects(), refreshRevisions(generated.document.documentId)]);
      }
      setGeneratorState("idle");
    } catch (error) {
      setGeneratorError(error instanceof Error ? error.message : "生成失败");
      setGeneratorState("error");
    }
  }

  function designDirectorInput(): DesignDirectorInput | null {
    if (!selectedPack) return null;
    const kind = selectedPack.id === "research-keynote-cn" ? "keynote" : selectedPack.id === "editorial-story-graphics-cn" ? "article-graphics" : "proposal";
    return {
      inputVersion: "0.1.0",
      taskId: `studio_${Date.now().toString(36)}`,
      title: sentenceFromBrief(brief),
      brief: {
        objective: brief.trim(),
        audience: goldenTask.brief.audience,
        decisionRequest: goldenTask.brief.decisionRequest,
        constraints: goldenTask.brief.mustAvoid,
      },
      content: {
        summary: brief.trim(),
        keyPoints: goldenTask.expectedOutline.slice(0, 7).map((item) => ({ id: `point_${item.order}`, text: item.intent, sourceIds: item.sourceIds })),
        callToAction: goldenTask.brief.decisionRequest,
      },
      sources: goldenTask.sources.map((source) => ({ sourceId: source.sourceId, type: source.type, title: source.title, sourceRef: source.sourceRef, content: source.content })),
      brand: { name: goldenTask.brand.name, tone: goldenTask.brand.voice },
      deliverable: { kind, audience: goldenTask.brief.audience, language: "zh-CN", format: "structured-html", pageCount: 7 },
      designPack: { id: selectedPack.id, version: selectedPack.version },
      editability: {
        requiredCapabilities: [...selectedPack.agentAnnotation.requiredCapabilities],
        requireNativeText: true,
        requireReplaceableImages: true,
        requireReorderablePages: true,
      },
    };
  }

  async function createFromDesignDirector() {
    const input = designDirectorInput();
    if (!input) return;
    setGeneratorState("working");
    setGeneratorError("");
    setDirectorOutput(null);
    try {
      const output = await createDesignDirectorDraft(input);
      setDirectorOutput(output);
      if (output.status === "rejected") {
        setGeneratorState("error");
        setGeneratorError(output.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`).join("；"));
        return;
      }
      if (hasUnsavedChanges) {
        const conflict = regenerationConflicts(document, output.importResult.document);
        setRegenerationPreview({ document: output.importResult.document, changedElementIds: conflict.changedElementIds });
      } else {
        openDocument(output.importResult.document);
        await Promise.all([refreshProjects(), refreshRevisions(output.importResult.document.documentId)]);
      }
      setGeneratorState("idle");
    } catch (error) {
      setGeneratorError(error instanceof Error ? error.message : "Design Director Skill 生成失败");
      setGeneratorState("error");
    }
  }

  async function createFromFixtureModel() {
    const input = designDirectorInput();
    if (!input) return;
    setGeneratorState("working");
    setGeneratorError("");
    setDirectorOutput(null);
    try {
      const result = await createModelDraft(input);
      if (result.generation.status === "rejected") {
        setGeneratorState("error");
        setGeneratorError(`${result.generation.error.code}: ${result.generation.error.message}`);
        return;
      }
      setDirectorOutput(result.generation.output);
      if (hasUnsavedChanges) {
        const conflict = regenerationConflicts(document, result.generation.output.importResult.document);
        setRegenerationPreview({ document: result.generation.output.importResult.document, changedElementIds: conflict.changedElementIds });
      } else {
        openDocument(result.generation.output.importResult.document);
        await Promise.all([
          refreshProjects(),
          refreshRevisions(result.generation.output.importResult.document.documentId),
          refreshReview(result.generation.output.importResult.document.documentId).catch(() => undefined),
        ]);
      }
      setModelProvider(result.generation.provider);
      setGeneratorState("idle");
    } catch (error) {
      setGeneratorError(error instanceof Error ? error.message : "模型生成失败");
      setGeneratorState("error");
    }
  }

  async function submitCurrentReview() {
    const currentRevision = revisions[0]?.revision;
    if (!currentRevision) return;
    setReviewState("working");
    setReviewError("");
    try {
      const next = await submitProjectReview(`review_${document.documentId}`, currentRevision.revisionId, document);
      setReview(next);
      setReviewState("idle");
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : "送审失败");
      setReviewState("error");
    }
  }

  async function approveCurrentCandidate() {
    const currentRevision = revisions[0]?.revision;
    if (!currentRevision) return;
    setReviewState("working");
    setReviewError("");
    try {
      const next = await approveProjectCandidate(`review_${document.documentId}`, currentRevision.revisionId, reviewReason);
      setReview(next);
      setReviewState("idle");
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : "批准失败");
      setReviewState("error");
    }
  }

  function acceptRegeneration() {
    if (!regenerationPreview) return;
    openDocument(regenerationPreview.document);
  }

  async function copyCurrentProject() {
    setGeneratorState("working");
    try {
      const copy = await duplicateProject(document.documentId);
      openDocument(copy);
      setProjectMenuOpen(false);
      await Promise.all([refreshProjects(), refreshRevisions(copy.documentId)]);
      setGeneratorState("idle");
    } catch (error) {
      setGeneratorError(error instanceof Error ? error.message : "复制失败");
      setGeneratorState("error");
    }
  }

  async function restoreRevision(stored: StoredRevision) {
    setSyncState("saving");
    try {
      await persistProject(stored.document, [], "regenerate");
      openDocument(stored.document);
      await Promise.all([refreshProjects(), refreshRevisions(stored.document.documentId)]);
    } catch {
      setSyncState("error");
    }
  }

  return (
    <main className="studio-shell">
      <header className="topbar">
        <div className="brand" aria-label="OpenDesign Studio">
          <span className="brand__mark"><span /><span /><span /></span>
          <span className="brand__name">OpenDesign</span>
          <span className="brand__product">Studio</span>
        </div>
        <div className="project-title">
          <button type="button" onClick={() => setProjectMenuOpen((open) => !open)} aria-expanded={projectMenuOpen}><Icon name="chevron" size={14} /> 项目</button>
          <span>/</span>
          <strong>{document.title}</strong>
          {projectMenuOpen && <div className="project-menu">
            <div className="project-menu__heading"><span><Kicker>Local projects</Kicker><strong>{projects.length} 个本地项目</strong></span><Button size="sm" tone="outline" onClick={copyCurrentProject} disabled={generatorState === "working"}><Icon name="plus" size={12} /> 复制当前</Button></div>
            <div className="project-menu__list">
              {projects.length === 0 && <p>保存当前项目或从 Brief 生成一个新项目。</p>}
              {projects.map((project) => <button type="button" key={project.projectId} className={project.projectId === document.documentId ? "is-active" : ""} onClick={() => switchProject(project.projectId)}>
                <span><strong>{project.title}</strong><small>{project.sceneCount} 页 · {new Date(project.updatedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small></span>
                {project.projectId === document.documentId && <Icon name="check" size={13} />}
              </button>)}
            </div>
          </div>}
        </div>
        <div className="topbar__actions">
          <span className={`sync-state ${hasUnsavedChanges || syncState === "error" ? "is-dirty" : ""}`}><i />{syncState === "saving" ? "正在保存" : syncState === "error" ? "本地 API 不可用" : localDraftOperations > 0 ? `${localDraftOperations} 项页面草稿 · 待快照保存` : unsavedCount > 0 ? `${unsavedCount} 个 IR patch` : documentDirty ? "有未保存的设计变更" : syncState === "saved" ? "已持久化到本地" : "本地修订"}</span>
          <Button size="sm" tone="outline" onClick={saveRevision} disabled={!hasUnsavedChanges || syncState === "saving"}>保存修订</Button>
          <Button size="sm" tone="primary" onClick={() => setInspectorTab("export")}><Icon name="play" size={13} /> 导出作品</Button>
          <Button size="sm" aria-label="更多操作" disabled title="首版暂不提供更多操作"><Icon name="more" size={17} /></Button>
        </div>
      </header>

      <nav className="process-rail" aria-label="Studio 工作流">
        {processSteps.map(([id, number, label], index) => {
          const activeIndex = processSteps.findIndex(([stepId]) => stepId === workflowStep);
          return <button type="button" key={id} className={id === workflowStep ? "is-active" : index < activeIndex ? "is-done" : ""} aria-current={id === workflowStep ? "step" : undefined} onClick={() => setWorkflowStep(id)}><span>{index < activeIndex ? <Icon name="check" size={11} /> : number}</span><strong>{label}</strong><i /></button>;
        })}
      </nav>

      <div className="workspace">
        <aside className={`narrative-panel narrative-panel--${workflowStep}`}>
          <section className="panel-section workflow-section" aria-label="Golden Task 工作流">
            {workflowStep === "sources" && <>
              <div className="section-heading"><div><Kicker>Grounded input</Kicker><h2>来源与证据边界</h2></div><Badge tone="success">3 snapshots</Badge></div>
              <div className="source-list">{goldenTask.sources.map((source) => <article key={source.sourceId}><span><strong>{source.title}</strong><small>{source.sourceRef}</small></span><Badge>{source.status}</Badge></article>)}</div>
              <Button size="sm" tone="primary" onClick={loadGoldenBrief}>载入 Golden Brief</Button>
              <div className="html-importer">
                <div className="section-heading"><div><Kicker>Structured HTML</Kicker><h2>导入 Skill 生成结果</h2></div><Badge tone="accent">Inert parser</Badge></div>
                <label><span>HTML 源码</span><textarea aria-label="Structured HTML 源码" value={htmlInput} onChange={(event) => setHtmlInput(event.target.value)} placeholder="粘贴带 data-od-* 标注的 HTML；不会执行脚本或加载远程资源。" /></label>
                <div className="html-importer__actions"><Button size="sm" onClick={() => setHtmlInput(goldenStructuredHtml)}>加载 Golden HTML</Button><Button size="sm" tone="outline" onClick={importHtml} disabled={importState === "working" || htmlInput.trim().length === 0}>{importState === "working" ? "正在安全解析" : "安全导入 Scene IR"}</Button></div>
                {importState === "error" && <p className="import-error" role="alert">{importError}</p>}
                {importResult && <div className={`import-result import-result--${importResult.status}`} role="status"><span><strong>{importResult.status}</strong><small>{importResult.security.blockedNodeCount} 个可执行节点被阻断 · {importResult.diagnostics.length} 条诊断</small></span>{importResult.diagnostics.length > 0 && <ol>{importResult.diagnostics.slice(0, 6).map((diagnostic) => <li key={diagnostic.diagnosticId}><code>{diagnostic.code}</code><span>{diagnostic.sceneId ?? "document"}{diagnostic.elementId ? ` / ${diagnostic.elementId}` : ""}</span><p>{diagnostic.message}</p></li>)}</ol>}</div>}
              </div>
            </>}
            {workflowStep === "outline" && <>
              <div className="section-heading"><div><Kicker>Narrative plan</Kicker><h2>7 页决策故事线</h2></div><Badge>{goldenTask.expectedOutline.length} roles</Badge></div>
              <ol className="outline-list">{goldenTask.expectedOutline.map((item) => <li key={item.order}><span>{String(item.order).padStart(2, "0")}</span><span><strong>{item.pageRole}</strong><small>{item.intent}</small></span></li>)}</ol>
            </>}
            {workflowStep === "direction" && <>
              <div className="section-heading"><div><Kicker>Design packs</Kicker><h2>选择设计判断系统</h2></div><Badge tone="accent">3 packs</Badge></div>
              <div className="pack-list">{designPacks.map((pack) => {
                const directionChoice = goldenTask.directions.find((item) => item.pack.id === pack.id);
                return <button type="button" key={pack.id} className={pack.id === selectedPackId ? "is-active" : ""} aria-label={`${pack.name} · ${pack.id}@${pack.version}`} aria-pressed={pack.id === selectedPackId} onClick={() => selectDesignPack(pack.id)}><span className="pack-swatch" style={{ background: pack.tokens.background, color: pack.tokens.accent }}>Aa</span><span><strong>{pack.name}</strong><small>{pack.id}@{pack.version}</small><em>{directionChoice?.selectionRationale}</em></span>{pack.id === selectedPackId && <Icon name="check" size={13} />}</button>;
              })}</div>
            </>}
            {workflowStep === "studio" && <>
              <div className="section-heading"><div><Kicker>Agent handoff</Kicker><h2>结构化设计协议</h2></div><Badge tone="success">Scene IR</Badge></div>
              <dl className="contract-summary"><div><dt>Design Pack</dt><dd>{selectedPack ? `${selectedPack.id}@${selectedPack.version}` : "未选择"}</dd></div><div><dt>Contract</dt><dd>{selectedPack?.agentAnnotation.contractVersion ?? "—"}</dd></div><div><dt>Capabilities</dt><dd>{selectedPack?.agentAnnotation.requiredCapabilities.join(" · ") ?? "—"}</dd></div></dl>
              {selectedPack && <><label className="agent-annotation"><span>可复制给其他 Agent 的标注</span><textarea readOnly aria-label="Agent 设计标注" value={selectedPack.agentAnnotation.copyText} /></label><Button size="sm" tone="outline" onClick={copyAgentAnnotation}>{annotationCopyState === "copied" ? "已复制 Agent 标注" : annotationCopyState === "manual" ? "请在上方手动复制" : "复制 Agent 标注"}</Button></>}
            </>}
          </section>

          <section className="panel-section brief-section">
            <div className="section-heading"><Kicker>Project input</Kicker><Button size="sm" aria-label="编辑项目输入"><Icon name="edit" size={13} /></Button></div>
            <textarea value={brief} onChange={(event) => setBrief(event.target.value)} aria-label="项目 Brief" />
            <div className="source-meta"><span><Icon name="file" size={13} /> Brief · {[...brief].length} 字</span><Badge tone={brief.trim().length >= 12 ? "success" : "neutral"}>{brief.trim().length >= 12 ? "可生成" : "继续输入"}</Badge></div>
            <Button size="sm" tone="primary" onClick={createFromBrief} disabled={generatorState === "working" || brief.trim().length < 12}><Icon name="spark" size={13} />{generatorState === "working" ? "正在生成故事线" : "生成新项目"}</Button>
            <Button size="sm" tone="outline" onClick={createFromDesignDirector} disabled={generatorState === "working" || brief.trim().length < 12 || !selectedPack}><Icon name="layers" size={13} />Design Director Skill 初稿</Button>
            <Button size="sm" tone="outline" onClick={createFromFixtureModel} disabled={generatorState === "working" || brief.trim().length < 12 || !selectedPack}><Icon name="spark" size={13} />安全模型生成（Fixture）</Button>
            {generatorState === "error" && <small className="generator-error">{generatorError}</small>}
            {directorOutput?.status === "accepted" && <div className="director-result" role="status"><strong>Skill draft 已通过安全导入</strong><small>{directorOutput.manifest.designPack.id}@{directorOutput.manifest.designPack.version} · {directorOutput.manifest.sceneIds.length} 页 · {directorOutput.manifest.sourceCoverage.usedSourceIds.length}/{directorOutput.manifest.sourceCoverage.declaredSourceIds.length} 来源</small><p>{directorOutput.manifest.diagnosis.evidenceBoundary}</p></div>}
            {modelProvider && <div className="director-result" role="status"><strong>Provider 证据</strong><small>{modelProvider.id} / {modelProvider.model}</small><p>当前为确定性离线 Provider；真实模型未配置时不会伪装联网成功。</p></div>}
            {review && <div className="director-result review-result" role="status"><strong>人工审核：{review.projection.status}</strong><small>Revision {review.projection.reviewRevisionId ?? review.projection.draft.revisionId}</small>{review.projection.candidate && <p>候选已形成 · notPublished: {String(review.projection.candidate.notPublished)}</p>}{review.projection.status === "draft" && <Button size="sm" tone="outline" onClick={submitCurrentReview} disabled={reviewState === "working" || hasUnsavedChanges}>送交人工审核</Button>}{review.projection.status === "in_review" && <><label className="field"><span>批准理由</span><textarea aria-label="候选批准理由" value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} /></label><Button size="sm" tone="primary" onClick={approveCurrentCandidate} disabled={reviewState === "working" || hasUnsavedChanges || qaState !== "ready" || openIssues.some((issue) => issue.severity === "blocker" || issue.severity === "error")}>批准为候选（不发布）</Button></>}{reviewError && <small className="generator-error" role="alert">{reviewError}</small>}</div>}
            <div className="director-result benchmark-result" aria-label="Design Quality Benchmark 基线">
              <strong>Design Quality Benchmark · {qualityBaseline.passed ? "通过" : "仍有质量债"}</strong>
              <small>{qualityBaseline.summary.contractPassed}/{qualityBaseline.summary.taskCount} 契约 · {qualityBaseline.summary.nativeEditabilityComplete}/{qualityBaseline.summary.taskCount} 原生可编辑 · {qualityBaseline.summary.exportsSucceeded}/{qualityBaseline.summary.taskCount} 导出</small>
              <ol>{qualityBaseline.tasks.map((task) => <li key={task.taskId}><span>{task.scenario}</span><strong>{task.passed ? "PASS" : "QA 未过"}</strong><small>{task.machine.qa.error} error · {task.machine.qa.warning} warning · edit {Math.round(task.machine.nativeEditability.ratio * 100)}%</small></li>)}</ol>
              <p>审美维度由人工逐项评估；aggregation: {qualityBaseline.manualAestheticRubric.aggregation}。</p>
            </div>
          </section>

          <section className="panel-section storyline-section">
            <div className="section-heading"><div><Kicker>Storyline</Kicker><h2>故事线</h2></div><Badge>固定 6 页</Badge></div>
            <ol className="storyline-list">
              {document.scenes.map((item) => {
                const count = openIssues.filter((issue) => issue.sceneId === item.id).length;
                return <li key={item.id}><button type="button" className={item.id === scene.id ? "is-active" : ""} onClick={() => selectScene(item.id)}><span>{String(item.order).padStart(2, "0")}</span><span><strong>{item.title}</strong><small>{item.purpose}</small></span>{count > 0 && <i>{count}</i>}</button></li>;
              })}
            </ol>
          </section>

          <section className="panel-section direction-section">
            <div className="section-heading"><div><Kicker>Art direction</Kicker><h2>一主两备</h2></div><Badge tone="accent">3 个方向</Badge></div>
            <div className="direction-list">
              {document.directions.map((item) => <DirectionOption key={item.id} direction={item} active={item.id === direction.id} onSelect={() => selectDirection(item.id)} />)}
            </div>
            <p className="direction-rationale"><Icon name="spark" size={13} />{direction.rationale}</p>
          </section>
        </aside>

        <section className="stage" aria-label="设计画布">
          <div className="stage-toolbar">
            <div className="stage-toolbar__scene"><Kicker>Page {String(scene.order).padStart(2, "0")}</Kicker><strong>{scene.title}</strong><Badge>{scene.layout}</Badge></div>
            <div className="stage-toolbar__tools">
              <Button size="sm" aria-label="撤销" onClick={undo} disabled={history.past.length === 0}>↶</Button>
              <Button size="sm" aria-label="重做" onClick={redo} disabled={history.future.length === 0}>↷</Button>
              <span />
              <Button size="sm" aria-label="复制当前页" onClick={duplicateCurrentScene}>复制页</Button>
              <Button size="sm" tone="danger" aria-label="删除当前页" onClick={removeCurrentScene} disabled={document.scenes.length <= 1}>删除页</Button>
              <Badge tone="success">Scene IR {document.schemaVersion}</Badge>
              <span className="zoom-label">67%</span>
            </div>
          </div>

          <div className="stage-canvas-wrap">
            <SceneCanvas scene={scene} direction={direction} selectedElementId={selectedElementId} issueElementIds={issueElementIds} onSelect={selectElement} onFrameChange={updateElementFrame} />
            <p className="canvas-hint"><Icon name="spark" size={12} /> 拖动元素移动 · 右下角缩放 · 边界自动约束</p>
          </div>

          <div className="filmstrip" aria-label="页面缩略图">
            {document.scenes.map((item) => <SceneThumbnail key={item.id} scene={item} direction={direction} active={item.id === scene.id} issueCount={openIssues.filter((issue) => issue.sceneId === item.id).length} onSelect={() => selectScene(item.id)} />)}
            <button className="filmstrip__add" type="button" onClick={duplicateCurrentScene}><Icon name="plus" size={14} />复制当前页</button>
          </div>
        </section>

        <aside className="inspector-panel">
          <div className="inspector-tabs">
            <Tabs value={inspectorTab} onChange={setInspectorTab} label="检查器" items={[{ value: "edit", label: "编辑" }, { value: "qa", label: "QA", count: openIssues.length }, { value: "history", label: "版本", count: revisions.length }, { value: "export", label: "导出" }]} />
          </div>

          {inspectorTab === "edit" && (
            <div className="inspector-content">
              <div className="inspector-heading"><div><Kicker>Selection</Kicker><h2>{selectedElement ? selectedElement.role : "页面属性"}</h2></div>{selectedElement && <Badge tone={selectedElement.editable ? "success" : "neutral"}>{selectedElement.editable ? "可编辑" : "已锁定"}</Badge>}</div>
              {selectedElement ? <>
                {selectedElement.editable && selectedElement.content !== undefined && <label className="field"><span>文字内容</span><textarea value={selectedElement.content} onChange={(event) => updateSelectedContent(event.target.value)} autoFocus /></label>}
                <div className="property-grid">{(["x", "y", "width", "height"] as const).map((field) => <label className="field" key={field}><span>{field === "width" ? "W" : field === "height" ? "H" : field.toUpperCase()}</span><input aria-label={`元素 ${field}`} type="number" value={Math.round(selectedElement.frame[field])} onChange={(event) => updateElementFrame(selectedElement.id, { ...selectedElement.frame, [field]: Number(event.target.value) })} /></label>)}</div>
                {selectedElement.content !== undefined && <>
                  <label className="field"><span>元素字体</span><select aria-label="元素字体" value={(selectedElement as EditorElement).fontFamily ?? ""} onChange={(event) => updateSelectedField("fontFamily", event.target.value)}><option value="">跟随设计方向</option>{fontOptions.map((font) => <option key={font.value} value={font.value}>{font.label}</option>)}</select></label>
                  <div className="property-grid">
                    <label className="field"><span>字号</span><input aria-label="字号" type="number" min="8" max="240" value={selectedElement.fontSize ?? 16} onChange={(event) => updateSelectedField("fontSize", Number(event.target.value))} /></label>
                    <label className="field"><span>字重</span><select aria-label="字重" value={selectedElement.fontWeight ?? 400} onChange={(event) => updateSelectedField("fontWeight", Number(event.target.value))}>{[300, 400, 500, 600, 700, 800, 900].map((weight) => <option value={weight} key={weight}>{weight}</option>)}</select></label>
                    <label className="field"><span>行距</span><input aria-label="行距" type="number" min="0.8" max="3" step="0.05" value={(selectedElement as EditorElement).lineHeight ?? 1.2} onChange={(event) => updateSelectedField("lineHeight", Number(event.target.value))} /></label>
                    <label className="field"><span>颜色</span><input aria-label="文字颜色" value={selectedElement.color ?? "text"} onChange={(event) => updateSelectedField("color", event.target.value)} /></label>
                  </div>
                </>}
                <div className="align-tools" aria-label="元素对齐"><Button size="sm" tone="outline" onClick={() => alignSelected("left")}>左</Button><Button size="sm" tone="outline" onClick={() => alignSelected("center")}>水平中</Button><Button size="sm" tone="outline" onClick={() => alignSelected("right")}>右</Button><Button size="sm" tone="outline" onClick={() => alignSelected("top")}>上</Button><Button size="sm" tone="outline" onClick={() => alignSelected("middle")}>垂直中</Button><Button size="sm" tone="outline" onClick={() => alignSelected("bottom")}>下</Button></div>
                <div className="layer-tools"><Button size="sm" tone="outline" onClick={() => moveLayer(-1)}>下移一层</Button><Button size="sm" tone="outline" onClick={() => moveLayer(1)}>上移一层</Button></div>
                <div className="property-row"><span>类型</span><strong>{selectedElement.type} / {selectedElement.role}</strong></div>
                {selectedElement.type === "image" && <><div className="asset-preview"><img src={selectedElement.assetSrc} alt={selectedElement.alt ?? ""} style={{ objectFit: (selectedElement as EditorElement).imageFit === "stretch" ? "fill" : ((selectedElement as EditorElement).imageFit === "contain" ? "contain" : "cover"), objectPosition: `${((selectedElement as EditorElement).focalPoint?.x ?? .5) * 100}% ${((selectedElement as EditorElement).focalPoint?.y ?? .5) * 100}%` }} /></div><label className="field"><span>替代文本</span><input aria-label="图片替代文本" value={selectedElement.alt ?? ""} onChange={(event) => updateSelectedField("alt", event.target.value)} /></label><label className="field"><span>适配方式</span><select aria-label="图片适配方式" value={(selectedElement as EditorElement).imageFit ?? "cover"} onChange={(event) => updateSelectedField("imageFit", event.target.value as ImageFit)}><option value="cover">裁切填满</option><option value="contain">完整显示</option><option value="stretch">拉伸填满</option></select></label><div className="property-grid"><label className="field"><span>焦点 X</span><input aria-label="图片焦点 X" type="range" min="0" max="1" step="0.05" value={(selectedElement as EditorElement).focalPoint?.x ?? .5} onChange={(event) => updateSelectedField("focalPoint", { x: Number(event.target.value), y: (selectedElement as EditorElement).focalPoint?.y ?? .5 })} /></label><label className="field"><span>焦点 Y</span><input aria-label="图片焦点 Y" type="range" min="0" max="1" step="0.05" value={(selectedElement as EditorElement).focalPoint?.y ?? .5} onChange={(event) => updateSelectedField("focalPoint", { x: (selectedElement as EditorElement).focalPoint?.x ?? .5, y: Number(event.target.value) })} /></label></div><Button tone="outline" onClick={() => imageInputRef.current?.click()} disabled={assetState === "uploading"}>{assetState === "uploading" ? "正在导入" : "替换图片"}</Button></>}
                <div className="patch-card"><span><Icon name="code" size={15} /></span><div><strong>IR patch 已就绪</strong><small>{unsavedCount > 0 ? `${unsavedCount} 个变更等待保存为修订` : "当前选择没有未保存变更"}</small></div></div>
              </> : <>
                <div className="font-controls">
                  <label className="field"><span>标题字体</span><select value={direction.tokens.headingFamily} onChange={(event) => updateDirectionFont("headingFamily", event.target.value)}>{fontOptions.map((font) => <option key={font.value} value={font.value}>{font.label}</option>)}</select></label>
                  <label className="field"><span>正文字体</span><select value={direction.tokens.fontFamily} onChange={(event) => updateDirectionFont("fontFamily", event.target.value)}>{fontOptions.map((font) => <option key={font.value} value={font.value}>{font.label}</option>)}</select></label>
                  <Button tone="outline" onClick={() => imageInputRef.current?.click()} disabled={assetState === "uploading"}><Icon name="image" size={14} /> {assetState === "uploading" ? "正在导入图片" : "插入本地图片"}</Button>
                  {assetState === "error" && <small className="generator-error">图片导入失败，仅支持 4MB 内的 PNG/JPEG。</small>}
                </div>
                <div className="empty-selection"><span><Icon name="edit" size={22} /></span><h3>选择画布中的元素</h3><p>字体作用于当前设计方向；图片会作为原生元素进入 HTML、PNG 与 PPTX。</p></div>
              </>}
              <input ref={imageInputRef} className="visually-hidden" type="file" accept="image/png,image/jpeg" onChange={(event) => { const file = event.target.files?.[0]; if (file) void insertOrReplaceImage(file); }} />
              {regenerationPreview && <div className="conflict-preview" role="alertdialog" aria-label="AI 重新生成冲突预览"><Kicker>Regeneration conflict</Kicker><strong>AI 新版本没有覆盖你的人工修改</strong><p>{regenerationPreview.changedElementIds.length} 个同 ID 元素发生变化。当前草稿仍保留，可选择采用新版本。</p><div><Button size="sm" tone="primary" onClick={acceptRegeneration}>采用 AI 新版本</Button><Button size="sm" tone="outline" onClick={() => setRegenerationPreview(null)}>保留当前草稿</Button></div></div>}
            </div>
          )}

          {inspectorTab === "qa" && (
            <div className="inspector-content">
              <div className="qa-summary"><ProgressRing value={qaScore} /><div><Kicker>Render health</Kicker><h2>{qaState === "checking" ? "正在检查当前作品" : qaState === "error" ? "本地 QA 不可用" : `${openIssues.length} 项需要确认`}</h2><p>{openIssues.filter((issue) => issue.severity === "error" || issue.severity === "blocker").length} 错误 · {openIssues.filter((issue) => issue.severity === "warning").length} 警告 · {openIssues.filter((issue) => issue.severity === "note").length} 提示</p></div></div>
              <div className="qa-filter"><button type="button" className="is-active">全部 {openIssues.length}</button><button type="button">当前页 {sceneIssues.length}</button><button type="button">已修复 {issues.length - openIssues.length}</button></div>
              <div className="issue-list">
                {qaState === "ready" && openIssues.length === 0 && <div className="empty-history"><Icon name="check" size={22} /><strong>确定性检查已通过</strong><small>没有发现越界、碰撞、字号、对比度或资产问题。</small></div>}
                {openIssues.map((issue) => <div role="button" tabIndex={0} key={issue.issueId} className={`issue-card issue-card--${issue.severity} ${issue.sceneId === scene.id ? "is-current" : ""}`} onClick={() => locateIssue(issue)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") locateIssue(issue); }}>
                  <span className="issue-card__icon"><Icon name="warning" size={15} /></span>
                  <span className="issue-card__copy"><span><Badge tone={issue.severity === "error" ? "warning" : "neutral"}>{issue.category.split(".")[1]}</Badge><small>{document.scenes.find((item) => item.id === issue.sceneId)?.title}</small></span><strong>{issue.message}</strong><small>{issue.elementIds.join(" · ")}</small></span>
                  {issue.safeAutoFix && <Button size="sm" tone="outline" onClick={(event) => { event.stopPropagation(); previewIssueFix(issue.issueId); }}>预览安全修复</Button>}
                  {fixPreviewIssueId === issue.issueId && <div className="fix-preview" onClick={(event) => event.stopPropagation()}><strong>修复影响预览</strong><small>{issue.category === "readability.font_size" ? "将字号提高到该角色的最低可读值；内容和位置不变。" : "将文字颜色恢复为设计方向的正文色；内容和位置不变。"}</small><span><Button size="sm" tone="primary" onClick={() => applyIssueFix(issue.issueId)}>确认应用</Button><Button size="sm" tone="quiet" onClick={() => setFixPreviewIssueId(null)}>取消</Button></span></div>}
                </div>)}
              </div>
              <div className="qa-note"><Icon name="spark" size={14} /><p><strong>定位，不重做。</strong><br />每个问题都回指具体页面与元素 ID。</p></div>
            </div>
          )}

          {inspectorTab === "history" && (
            <div className="inspector-content">
              <div className="inspector-heading"><div><Kicker>Revision history</Kicker><h2>完整快照，可随时回退</h2></div><Badge>{revisions.length} 个版本</Badge></div>
              <p className="history-intro">每次保存都记录原因、时间和 Scene IR patch；回退会生成一个新版本，不会覆盖旧记录。</p>
              <div className="revision-list">
                {revisions.length === 0 && <div className="empty-history"><Icon name="layers" size={22} /><strong>还没有版本记录</strong><small>修改内容后点击“保存修订”。</small></div>}
                {revisions.map((stored, index) => <article className={index === 0 ? "is-current" : ""} key={stored.revision.revisionId}>
                  <div><span className="revision-dot" /><span><strong>{stored.revision.reason === "initial" ? "初始生成" : stored.revision.reason === "regenerate" ? "版本回退" : stored.revision.reason === "qa-fix" ? "QA 修复" : "编辑修订"}</strong><small>{new Date(stored.revision.createdAt).toLocaleString("zh-CN")}</small></span>{index === 0 && <Badge tone="success">当前</Badge>}</div>
                  <p>{stored.revision.patches.length > 0 ? `${stored.revision.patches.length} 个可追踪 patch` : "完整 Scene IR 快照"}</p>
                  {index > 0 && <Button size="sm" tone="outline" onClick={() => restoreRevision(stored)}>恢复此版本</Button>}
                </article>)}
              </div>
            </div>
          )}

          {inspectorTab === "export" && (
            <div className="inspector-content">
              <div className="inspector-heading"><div><Kicker>Export center</Kicker><h2>一次编辑，三个输出</h2></div><Badge tone={qaState === "ready" && openIssues.length === 0 ? "success" : "neutral"}>QA {qaState === "ready" ? qaScore : "—"}</Badge></div>
              <p className="export-intro">三个格式共享当前 Scene IR 修订，不从 HTML 反推 PPT。</p>
              <div className="export-list">
                <ExportCard kind="html" title="交互式 HTML" description="保留语义与响应式预览" state={exportStates.html} result={exportResults.html} onExport={() => startExport("html")} />
                <ExportCard kind="png" title="PNG 图集" description="6 页 · Scene IR 原生渲染" state={exportStates.png} result={exportResults.png} onExport={() => startExport("png")} />
                <ExportCard kind="pptx" title="可编辑 PPTX" description="原生文字与形状优先" state={exportStates.pptx} result={exportResults.pptx} onExport={() => startExport("pptx")} />
              </div>
              <div className="export-report"><div><Icon name="layers" size={16} /><strong>编辑性预检</strong></div><dl><div><dt>原生可编辑</dt><dd>{pptxReport?.summary?.nativeElements ?? totalElements} 元素</dd></div><div><dt>组件级栅格</dt><dd>{pptxReport?.summary?.rasterFallbacks ?? 0} 元素</dd></div><div><dt>遗漏或占位</dt><dd>{pptxReport?.summary?.omittedElements ?? 0} 元素</dd></div></dl>{exportResults.pptx?.files.find((file) => file.name === "editability.json") && <a className="report-download" href={exportResults.pptx.files.find((file) => file.name === "editability.json")!.downloadUrl} download>下载完整报告 <Icon name="arrow" size={13} /></a>}</div>
              {Object.values(exportStates).some((state) => state === "ready") && <div className="ready-callout"><Icon name="check" size={16} /><div><strong>真实导出文件已生成</strong><small>文件仅保存在本机 .local-data，不会上传生产存储。</small></div></div>}
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
