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
  createWorkOrder,
  answerWorkOrderClarifications,
  approveWorkOrderOutline,
  confirmWorkOrder,
  createModelDraft,
  cancelGenerationJob,
  approveProjectCandidate,
  acceptAgentChangeCandidate,
  createAgentChangeCandidate,
  duplicateProject,
  importProjectHtml,
  listProjects,
  listAgentChangeCandidates,
  listRevisions,
  loadProject,
  loadGenerationJob,
  loadWorkOrder,
  loadWorkOrderArtifact,
  loadReview,
  selectWorkOrderDirection,
  parseWorkOrderOutlinePayload,
  parseWorkOrderQaPayload,
  parseWorkOrderScenePayload,
  persistProject,
  rejectAgentChangeCandidate,
  runProjectQa,
  submitProjectReview,
  uploadProjectImage,
  type ProjectSummary,
  type AgentChangeCandidate,
  type GenerationJob,
  type GenerationJobErrorCode,
  type WorkOrderWorkflow,
  type WorkOrderOutlinePayload,
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
const generationJobStorageKey = "opendesign.studio.active-generation-job";
const agentChangeStorageKey = "opendesign.studio.active-agent-change";
const workOrderStorageKey = "opendesign.studio.active-work-order";
const generationPollIntervalMs = 1_200;
const generationPollLimit = 150;
const exampleBrief = "为一篇讨论 AI 如何改变创作者工作流的文章，制作 6 页中文视觉提案。受众是设计负责人，结论先行，使用真实内容层级，图片保留可替换位置。";
const fontOptions = [
  { label: "现代无衬线", value: "Inter, system-ui, sans-serif" },
  { label: "中文黑体", value: "Hiragino Sans GB, Microsoft YaHei, sans-serif" },
  { label: "编辑宋体", value: "Songti SC, SimSun, serif" },
  { label: "经典衬线", value: "Georgia, Noto Serif SC, serif" },
  { label: "演示衬线", value: "Times New Roman, Songti SC, serif" },
  { label: "等宽技术", value: "Menlo, Consolas, monospace" },
] as const;

type InspectorTab = "edit" | "qa" | "history" | "export";
type ResultView = "sources" | "outline" | "directions" | "slides" | "qa" | "export";
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
const goldenDirections = Array.isArray(goldenTask.directions) ? goldenTask.directions : [];

const processSteps = [
  ["sources", "01", "Sources"],
  ["outline", "02", "Outline"],
  ["direction", "03", "Direction"],
  ["studio", "04", "Studio"],
] as const;

const generationStageCopy: Record<GenerationJob["status"], { label: string; detail: string; progress: number }> = {
  queued: { label: "已排队", detail: "任务已进入安全队列，当前作品保持不变。", progress: 12 },
  analyzing: { label: "正在分析", detail: "设计总监正在提取目标、受众与内容边界。", progress: 30 },
  generating: { label: "正在生成", detail: "正在构建故事线、页面结构与可编辑元素。", progress: 62 },
  validating: { label: "正在验证", detail: "正在检查结构、安全性、来源覆盖和画布质量。", progress: 86 },
  completed: { label: "生成完成", detail: "新作品已经准备好，由你决定何时打开。", progress: 100 },
  failed: { label: "生成失败", detail: "任务已停止，当前作品没有被修改。", progress: 100 },
  cancelled: { label: "已取消", detail: "任务已取消，当前作品没有被修改。", progress: 100 },
};

const agentStageLabels: Record<string, string> = {
  diagnose: "诊断需求", direction: "设计方向", outline: "大纲确认", compose: "内容创作", import: "安全导入",
  qa: "质量检查", edit: "人工编辑", review: "候选确认", export: "明确导出",
};

function generationErrorCopy(code: GenerationJobErrorCode | undefined, fallback?: string) {
  if (code === "offline") return { title: "网络已断开", action: "检查网络后恢复任务", detail: fallback || "任务 ID 仍保存在此浏览器，不会因此覆盖当前作品。" };
  if (code === "rate_limited") return { title: "当前任务已达上限", action: "等待一个任务结束后重试", detail: "每个匿名空间最多同时运行 2 个生成任务。" };
  if (code === "provider_unavailable") return { title: "生成服务暂未配置", action: "稍后重试或联系维护者", detail: fallback || "服务没有伪装成真实 AI，当前作品仍可继续编辑。" };
  if (code === "invalid_input") return { title: "需求还不够完整", action: "补充受众、内容和交付目标", detail: fallback || "请说明作品给谁看、希望对方做什么决定。" };
  if (code === "creation_contract_incomplete") return { title: "Creation Contract 尚未确认", action: "回答必要问题并选择一个设计方向", detail: fallback || "完成两个决策点后才会启动生成。" };
  return { title: "生成任务没有完成", action: "保留当前内容并重新提交", detail: fallback || "任务已停止，当前作品和人工修改均未受影响。" };
}

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
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [resultView, setResultView] = useState<ResultView>("slides");
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
  const [generationJob, setGenerationJob] = useState<GenerationJob | null>(null);
  const [workOrderWorkflow, setWorkOrderWorkflow] = useState<WorkOrderWorkflow | null>(null);
  const [workOrderOutline, setWorkOrderOutline] = useState<WorkOrderOutlinePayload | null>(null);
  const [artifactState, setArtifactState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [generatedPreview, setGeneratedPreview] = useState<SceneDocument | null>(null);
  const [generatedQaReport, setGeneratedQaReport] = useState<Awaited<ReturnType<typeof runProjectQa>> | null>(null);
  const [artifactPreviewOpen, setArtifactPreviewOpen] = useState(false);
  const [artifactPreviewSceneId, setArtifactPreviewSceneId] = useState("");
  const [clarificationAnswers, setClarificationAnswers] = useState<Record<string, string>>({});
  const [generationJobError, setGenerationJobError] = useState<{ code: GenerationJobErrorCode; message: string } | null>(null);
  const [generationRecoveryJobId, setGenerationRecoveryJobId] = useState<string | null>(() => window.localStorage.getItem(generationJobStorageKey));
  const [generationElapsed, setGenerationElapsed] = useState(0);
  const [generationPolls, setGenerationPolls] = useState(0);
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
  const [agentChangeCandidates, setAgentChangeCandidates] = useState<AgentChangeCandidate[]>([]);
  const [activeAgentChange, setActiveAgentChange] = useState<AgentChangeCandidate | null>(null);
  const [agentChangeInstruction, setAgentChangeInstruction] = useState("改成：让 Agent 的每次修改都先成为可审查的候选");
  const [agentChangeReason, setAgentChangeReason] = useState("已对比修改前后内容，并确认采用这项局部调整。");
  const [agentChangeState, setAgentChangeState] = useState<"idle" | "working" | "error">("idle");
  const [agentChangeError, setAgentChangeError] = useState("");
  const [fixPreviewIssueId, setFixPreviewIssueId] = useState<string | null>(null);
  const [workflowStep, setWorkflowStep] = useState<WorkflowStep>("studio");
  const initialPack = goldenDirections.find((item) => item.id === goldenTask.selectedDirectionId)?.pack;
  const [selectedPackId, setSelectedPackId] = useState(initialPack?.id ?? designPacks[0]?.id ?? "");
  const [annotationCopyState, setAnnotationCopyState] = useState<"idle" | "copied" | "manual">("idle");
  const [htmlInput, setHtmlInput] = useState("");
  const [importState, setImportState] = useState<"idle" | "working" | "ready" | "error">("idle");
  const [importResult, setImportResult] = useState<HtmlImportResult | null>(null);
  const [importError, setImportError] = useState("");
  const selectedPack = getDesignPack(selectedPackId);
  const generationTerminal = generationJob ? ["completed", "failed", "cancelled"].includes(generationJob.status) : false;
  const generationRunning = Boolean(generationJob && !generationTerminal && !generationJobError);

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
          void refreshAgentChanges(stored.documentId).catch(() => undefined);
        }
      })
      .catch(() => { if (active) setSyncState("local"); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const workOrderId = workOrderWorkflow?.workOrder.workOrderId;
    const artifactId = workOrderWorkflow?.outlineReview.artifactId;
    if (!workOrderId || !artifactId) { setWorkOrderOutline(null); setArtifactState("idle"); return; }
    let active = true;
    setArtifactState("loading");
    loadWorkOrderArtifact(workOrderId, artifactId)
      .then((artifact) => { if (active) { setWorkOrderOutline(parseWorkOrderOutlinePayload(artifact.payload)); setArtifactState("ready"); } })
      .catch(() => { if (active) { setWorkOrderOutline(null); setArtifactState("error"); } });
    return () => { active = false; };
  }, [workOrderWorkflow?.workOrder.workOrderId, workOrderWorkflow?.outlineReview.artifactId]);

  useEffect(() => {
    const workOrderId = workOrderWorkflow?.workOrder.workOrderId;
    const sceneArtifact = workOrderWorkflow?.artifacts.filter((artifact) => artifact.artifactType === "scene-ir").at(-1);
    const qaArtifact = workOrderWorkflow?.artifacts.filter((artifact) => artifact.artifactType === "qa-report").at(-1);
    if (!workOrderId) { setGeneratedPreview(null); setGeneratedQaReport(null); return; }
    let active = true;
    if (sceneArtifact) {
      loadWorkOrderArtifact(workOrderId, sceneArtifact.artifactId)
        .then((artifact) => {
          if (!active || artifact.artifact.artifactType !== "scene-ir") return;
          const preview = parseWorkOrderScenePayload(artifact.payload);
          setGeneratedPreview(preview);
          setArtifactPreviewSceneId((current) => preview.scenes.some((scene) => scene.id === current) ? current : preview.scenes[0]?.id ?? "");
        })
        .catch(() => { if (active) setGeneratedPreview(null); });
    } else {
      setGeneratedPreview(null);
      setArtifactPreviewOpen(false);
    }
    if (qaArtifact) {
      loadWorkOrderArtifact(workOrderId, qaArtifact.artifactId)
        .then((artifact) => { if (active && artifact.artifact.artifactType === "qa-report") setGeneratedQaReport(parseWorkOrderQaPayload(artifact.payload)); })
        .catch(() => { if (active) setGeneratedQaReport(null); });
    } else {
      setGeneratedQaReport(null);
    }
    return () => { active = false; };
  }, [workOrderWorkflow?.workOrder.workOrderId, workOrderWorkflow?.artifacts]);

  useEffect(() => {
    const storedWorkOrderId = window.localStorage.getItem(workOrderStorageKey);
    if (!storedWorkOrderId) return;
    let active = true;
    loadWorkOrder(storedWorkOrderId)
      .then((workflow) => { if (active) setWorkOrderWorkflow(workflow); })
      .catch(() => { if (active) window.localStorage.removeItem(workOrderStorageKey); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const storedJobId = window.localStorage.getItem(generationJobStorageKey);
    if (!storedJobId) return;
    let active = true;
    loadGenerationJob(storedJobId)
      .then((job) => {
        if (!active) return;
        setGenerationJob(job);
        setGenerationJobError(null);
      })
      .catch((error) => {
        if (!active) return;
        const code = error instanceof Error && "code" in error ? (error as { code: GenerationJobErrorCode }).code : "generation_failed";
        setGenerationJobError({ code, message: error instanceof Error ? error.message : "无法恢复最近任务" });
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!generationJob) return;
    if (generationJob.status === "failed" || generationJob.status === "cancelled") {
      window.localStorage.removeItem(generationJobStorageKey);
      setGenerationRecoveryJobId(null);
      return;
    }
    window.localStorage.setItem(generationJobStorageKey, generationJob.jobId);
    setGenerationRecoveryJobId(generationJob.jobId);
  }, [generationJob]);

  useEffect(() => {
    if (!generationJob || generationTerminal || generationJobError || generationPolls >= generationPollLimit) return;
    let active = true;
    const timeout = window.setTimeout(() => {
      loadGenerationJob(generationJob.jobId)
        .then(async (job) => {
          if (!active) return;
          setGenerationJob(job);
          setGenerationPolls((count) => count + 1);
          if (workOrderWorkflow) {
            try { setWorkOrderWorkflow(await loadWorkOrder(workOrderWorkflow.workOrder.workOrderId)); } catch { /* Job remains recoverable even if plan evidence is temporarily unavailable. */ }
          }
        })
        .catch((error) => {
          if (!active) return;
          const code = error instanceof Error && "code" in error ? (error as { code: GenerationJobErrorCode }).code : "generation_failed";
          setGenerationJobError({ code, message: error instanceof Error ? error.message : "无法读取生成进度" });
        });
    }, generationPollIntervalMs);
    return () => { active = false; window.clearTimeout(timeout); };
  }, [generationJob, generationJobError, generationPolls, generationTerminal, workOrderWorkflow?.workOrder.workOrderId]);

  useEffect(() => {
    if (generationJob && !generationTerminal && generationPolls >= generationPollLimit && !generationJobError) {
      setGenerationJobError({ code: "generation_failed", message: "自动状态检查已停止。你可以手动恢复任务，不会重复提交。" });
    }
  }, [generationJob, generationJobError, generationPolls, generationTerminal]);

  useEffect(() => {
    if (!generationJob || generationTerminal) return;
    const tick = () => setGenerationElapsed(Math.max(0, Math.floor((Date.now() - Date.parse(generationJob.createdAt)) / 1000)));
    tick();
    const interval = window.setInterval(tick, 1_000);
    return () => window.clearInterval(interval);
  }, [generationJob?.jobId, generationTerminal]);

  const scene = document.scenes.find((item) => item.id === selectedSceneId) ?? document.scenes[0]!;
  const direction = document.directions.find((item) => item.id === document.selectedDirectionId) ?? document.directions[0]!;
  const previewScene = generatedPreview?.scenes.find((item) => item.id === artifactPreviewSceneId) ?? generatedPreview?.scenes[0] ?? null;
  const previewDirection = generatedPreview?.directions.find((item) => item.id === generatedPreview.selectedDirectionId) ?? generatedPreview?.directions[0] ?? null;
  const selectedElement = getElement(document, selectedElementId);
  const openIssues = issues.filter((issue) => issue.status === "open");
  const sceneIssues = openIssues.filter((issue) => issue.sceneId === scene.id);
  const issueElementIds = useMemo(() => new Set(sceneIssues.flatMap((issue) => issue.elementIds)), [sceneIssues]);
  const unsavedCount = patches.length;
  const hasUnsavedChanges = documentDirty || unsavedCount > 0;
  const qaScore = qaState === "ready" ? Math.max(0, 100 - openIssues.reduce((score, issue) => score + ({ blocker: 35, error: 20, warning: 8, note: 2 }[issue.severity]), 0)) : 0;
  const totalElements = document.scenes.reduce((count, item) => count + item.elements.length, 0);
  const pptxReport = exportResults.pptx?.editabilityReport as { summary?: { nativeElements?: number; rasterFallbacks?: number; omittedElements?: number } } | undefined;
  const latestArtifact = (type: WorkOrderWorkflow["artifacts"][number]["artifactType"]) => workOrderWorkflow?.artifacts.filter((artifact) => artifact.artifactType === type).at(-1);
  const resultStatus = (view: ResultView): "ready" | "draft" | "waiting" | "error" => {
    if (view === "sources") return latestArtifact("diagnosis")?.validationStatus === "accepted" ? "ready" : "waiting";
    if (view === "outline") return workOrderWorkflow?.outlineReview.status === "approved" ? "ready" : workOrderWorkflow?.outlineReview.status === "draft" ? "draft" : "waiting";
    if (view === "directions") return workOrderWorkflow?.directionConfirmed ? "ready" : "waiting";
    if (view === "slides") return latestArtifact("scene-ir")?.validationStatus === "accepted" || document.scenes.length > 0 ? "ready" : "waiting";
    if (view === "qa") return qaState === "error" ? "error" : latestArtifact("qa-report") || qaState === "ready" ? "ready" : "waiting";
    return latestArtifact("export-report") || Object.values(exportStates).some((state) => state === "ready") ? "ready" : "waiting";
  };

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

  async function refreshAgentChanges(projectId = document.documentId) {
    const candidates = await listAgentChangeCandidates(projectId);
    setAgentChangeCandidates(candidates);
    const storedId = window.localStorage.getItem(agentChangeStorageKey);
    setActiveAgentChange(candidates.find((candidate) => candidate.candidateId === storedId) ?? candidates.find((candidate) => candidate.status === "proposed") ?? candidates[0] ?? null);
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
    setArtifactPreviewOpen(false);
    setAgentChangeCandidates([]);
    setActiveAgentChange(null);
    setExportResults({});
    setExportStates({ html: "idle", png: "idle", pptx: "idle" });
    setSyncState("saved");
    setInspectorTab("edit");
    setReview(null);
    setModelProvider(null);
    void refreshReview(next.documentId).catch(() => undefined);
    void refreshAgentChanges(next.documentId).catch(() => undefined);
  }

  function selectDirection(directionId: string) {
    commitDocument((current) => ({ ...current, selectedDirectionId: directionId }));
  }

  function selectDesignPack(packId: string) {
    const pack = getDesignPack(packId);
    if (!pack) return;
    setSelectedPackId(pack.id);
    setAnnotationCopyState("idle");
    if (workOrderWorkflow?.projection.status === "draft") {
      setWorkOrderWorkflow(null);
      window.localStorage.removeItem(workOrderStorageKey);
    }
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
    setInspectorOpen(true);
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
    setGenerationJobError(null);
    setGenerationPolls(0);
    setGenerationElapsed(0);
    try {
      const workflow = await createWorkOrder({
        brief: brief.trim(),
        title: sentenceFromBrief(brief),
        ...(selectedPack ? { designPack: { id: selectedPack.id, version: selectedPack.version } } : {}),
      });
      setWorkOrderWorkflow(workflow);
      setGenerationJob(null);
      window.localStorage.setItem(workOrderStorageKey, workflow.workOrder.workOrderId);
      window.localStorage.removeItem(generationJobStorageKey);
      setGenerationRecoveryJobId(null);
      setGeneratorState("idle");
    } catch (error) {
      const code = error instanceof Error && "code" in error ? (error as { code: GenerationJobErrorCode }).code : "generation_failed";
      const message = error instanceof Error ? error.message : "生成失败";
      setGenerationJobError({ code, message });
      setGeneratorError(message);
      setGeneratorState("error");
    }
  }

  async function confirmCreationPlan() {
    if (!workOrderWorkflow) return;
    setResultView("slides");
    setGeneratorState("working");
    setGeneratorError("");
    setGenerationJobError(null);
    setGenerationPolls(0);
    setGenerationElapsed(0);
    try {
      const result = await confirmWorkOrder(workOrderWorkflow.workOrder.workOrderId);
      setWorkOrderWorkflow(result.workflow);
      setGenerationJob(result.job);
      window.localStorage.setItem(workOrderStorageKey, result.workflow.workOrder.workOrderId);
      window.localStorage.setItem(generationJobStorageKey, result.job.jobId);
      setGenerationRecoveryJobId(result.job.jobId);
      if (["completed", "failed", "cancelled"].includes(result.job.status)) {
        try { setWorkOrderWorkflow(await loadWorkOrder(result.workflow.workOrder.workOrderId)); } catch { /* The confirmed contract remains visible if refresh evidence is temporarily unavailable. */ }
      }
      setGeneratorState("idle");
    } catch (error) {
      const code = error instanceof Error && "code" in error ? (error as { code: GenerationJobErrorCode }).code : "generation_failed";
      const message = error instanceof Error ? error.message : "无法启动生成任务";
      setGenerationJobError({ code, message });
      setGeneratorError(message);
      setGeneratorState("error");
      try { setWorkOrderWorkflow(await loadWorkOrder(workOrderWorkflow.workOrder.workOrderId)); } catch { /* Keep the last valid local projection. */ }
    }
  }

  async function submitClarifications() {
    if (!workOrderWorkflow || workOrderWorkflow.clarification.status !== "required") return;
    setGeneratorState("working");
    setGeneratorError("");
    try {
      const answers = workOrderWorkflow.clarification.questions.map((question) => ({ questionId: question.questionId, answer: clarificationAnswers[question.questionId] ?? "" }));
      const workflow = await answerWorkOrderClarifications(workOrderWorkflow.workOrder.workOrderId, answers);
      setWorkOrderWorkflow(workflow);
      setClarificationAnswers({});
      setGeneratorState("idle");
    } catch (error) {
      const message = error instanceof Error ? error.message : "补充信息未能保存";
      setGeneratorError(message);
      setGeneratorState("error");
    }
  }

  async function chooseWorkOrderDirection(directionId: string) {
    if (!workOrderWorkflow) return;
    setGeneratorState("working");
    setGeneratorError("");
    try {
      const workflow = await selectWorkOrderDirection(workOrderWorkflow.workOrder.workOrderId, directionId);
      setWorkOrderWorkflow(workflow);
      setSelectedPackId(workflow.plan.designPack.id);
      setGeneratorState("idle");
    } catch (error) {
      const message = error instanceof Error ? error.message : "设计方向未能保存";
      setGeneratorError(message);
      setGeneratorState("error");
    }
  }

  async function approveCurrentOutline() {
    if (!workOrderWorkflow?.outlineReview.artifactId || workOrderWorkflow.outlineReview.status !== "draft") return;
    setGeneratorState("working");
    setGeneratorError("");
    try {
      const workflow = await approveWorkOrderOutline(workOrderWorkflow.workOrder.workOrderId, workOrderWorkflow.outlineReview.artifactId);
      setWorkOrderWorkflow(workflow);
      setResultView("outline");
      setGeneratorState("idle");
    } catch (error) {
      const message = error instanceof Error ? error.message : "大纲未能批准";
      setGeneratorError(message);
      setGeneratorState("error");
    }
  }

  async function cancelActiveGeneration() {
    if (!generationJob || generationTerminal) return;
    try {
      const job = await cancelGenerationJob(generationJob.jobId);
      setGenerationJob(job);
      setGenerationJobError(null);
      setGeneratorState("idle");
    } catch (error) {
      const code = error instanceof Error && "code" in error ? (error as { code: GenerationJobErrorCode }).code : "generation_failed";
      setGenerationJobError({ code, message: error instanceof Error ? error.message : "取消任务失败" });
    }
  }

  async function resumeGeneration() {
    const jobId = generationJob?.jobId ?? generationRecoveryJobId;
    if (!jobId) return;
    setGenerationJobError(null);
    setGenerationPolls(0);
    try {
      setGenerationJob(await loadGenerationJob(jobId));
    } catch (error) {
      const code = error instanceof Error && "code" in error ? (error as { code: GenerationJobErrorCode }).code : "generation_failed";
      setGenerationJobError({ code, message: error instanceof Error ? error.message : "无法恢复任务" });
    }
  }

  async function openGeneratedProject() {
    if (generationJob?.status !== "completed" || !generationJob.projectId) return;
    setGeneratorState("working");
    setGeneratorError("");
    try {
      const next = await loadProject(generationJob.projectId);
      if (!next) throw new Error("新作品不可用，请刷新后重试。");
      openDocument(next);
      await Promise.all([refreshProjects(), refreshRevisions(next.documentId)]);
      setGenerationJob(null);
      setGenerationRecoveryJobId(null);
      setGenerationJobError(null);
      window.localStorage.removeItem(generationJobStorageKey);
      setGeneratorState("idle");
    } catch (error) {
      setGeneratorError(error instanceof Error ? error.message : "无法打开新作品");
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

  async function requestAgentChange() {
    setAgentChangeError("");
    if (hasUnsavedChanges) {
      setAgentChangeState("error");
      setAgentChangeError("请先保存当前人工修订，再让 Agent 基于稳定版本提出修改。");
      return;
    }
    if (!revisions[0]) {
      setAgentChangeState("error");
      setAgentChangeError("当前作品还没有可引用的持久化 revision。");
      return;
    }
    const target = selectedElement && typeof selectedElement.content === "string"
      ? { kind: "element" as const, sceneId: scene.id, elementId: selectedElement.id }
      : { kind: "scene" as const, sceneId: scene.id };
    setAgentChangeState("working");
    try {
      const candidate = await createAgentChangeCandidate(document.documentId, { instruction: agentChangeInstruction, target });
      setAgentChangeCandidates((current) => [candidate, ...current.filter((item) => item.candidateId !== candidate.candidateId)]);
      setActiveAgentChange(candidate);
      window.localStorage.setItem(agentChangeStorageKey, candidate.candidateId);
      setAgentChangeState("idle");
    } catch (error) {
      setAgentChangeState("error");
      setAgentChangeError(error instanceof Error ? error.message : "Agent 未能生成修改候选");
    }
  }

  async function decideAgentChange(decision: "accept" | "reject") {
    if (!activeAgentChange || activeAgentChange.status !== "proposed") return;
    setAgentChangeState("working");
    setAgentChangeError("");
    try {
      if (decision === "accept") {
        const result = await acceptAgentChangeCandidate(document.documentId, activeAgentChange.candidateId, agentChangeReason);
        openDocument(result.document);
        setActiveAgentChange(result.candidate);
        setAgentChangeCandidates((current) => current.map((item) => item.candidateId === result.candidate.candidateId ? result.candidate : item));
        await Promise.all([refreshProjects(), refreshRevisions(result.document.documentId)]);
      } else {
        const candidate = await rejectAgentChangeCandidate(document.documentId, activeAgentChange.candidateId, agentChangeReason);
        setActiveAgentChange(candidate);
        setAgentChangeCandidates((current) => current.map((item) => item.candidateId === candidate.candidateId ? candidate : item));
      }
      window.localStorage.removeItem(agentChangeStorageKey);
      setAgentChangeState("idle");
    } catch (error) {
      setAgentChangeState("error");
      setAgentChangeError(error instanceof Error ? error.message : "Agent 修改候选决定失败");
      await refreshAgentChanges(document.documentId).catch(() => undefined);
    }
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
          <Button size="sm" tone="primary" onClick={() => { setInspectorTab("export"); setInspectorOpen(true); }}><Icon name="play" size={13} /> 导出作品</Button>
          <Button size="sm" aria-label="更多操作" disabled title="首版暂不提供更多操作"><Icon name="more" size={17} /></Button>
        </div>
      </header>

      <div className="workspace">
        <aside className="project-sidebar" aria-label="项目导航">
          <div className="project-sidebar__primary">
            <Button tone="primary" onClick={() => { setBrief(""); setWorkflowStep("sources"); }}><Icon name="plus" size={14} /> 新建设计</Button>
            <button type="button" className="project-nav-item is-active"><Icon name="layers" size={15} /><span>我的作品</span><small>{projects.length || 1}</small></button>
            <button type="button" className="project-nav-item" onClick={() => setResultView("sources")}><Icon name="file" size={15} /><span>设计素材</span></button>
          </div>
          <div className="project-sidebar__recent">
            <span className="project-sidebar__label">最近作品</span>
            <button type="button" className={projects.length === 0 ? "is-active" : ""} onClick={() => openDocument(initialDocument)}><span><i />{document.title}</span><small>{document.scenes.length} 页</small></button>
            {projects.map((project) => <button type="button" key={project.projectId} className={project.projectId === document.documentId ? "is-active" : ""} onClick={() => switchProject(project.projectId)}><span><i />{project.title}</span><small>{project.sceneCount} 页</small></button>)}
          </div>
          <div className="project-sidebar__footer">
            <button type="button" onClick={() => setWorkflowStep("direction")}><Icon name="spark" size={14} /> Design Packs</button>
            <button type="button" onClick={() => { setInspectorTab("history"); setInspectorOpen(true); }}><Icon name="layers" size={14} /> 版本记录</button>
            <p>公开预览 · 请勿上传机密材料</p>
          </div>
        </aside>

        <aside className={`narrative-panel narrative-panel--${workflowStep}`}>
          <div className="conversation-header">
            <span><i className="director-avatar">OD</i><span><strong>设计总监</strong><small>正在协作 · {selectedPack?.name ?? "默认方向"}</small></span></span>
            <Button size="sm" tone="quiet" aria-label="复制当前项目" onClick={copyCurrentProject}><Icon name="more" size={16} /></Button>
          </div>
          <div className="conversation-stream" aria-label="设计总监对话">
            <article className="chat-message chat-message--assistant">
              <span className="director-avatar">OD</span>
              <div><strong>先把目标说清楚，再开始设计。</strong><p>告诉我这份作品给谁看、希望对方做什么决定。你也可以上传文章、提案或图片。</p></div>
            </article>
            {brief.trim() ? <article className="chat-message chat-message--user"><p>{brief}</p></article> : <article className="chat-message chat-message--example"><div><strong>第一次使用？从一个完整示例开始</strong><p>{exampleBrief}</p><Button size="sm" tone="outline" onClick={() => setBrief(exampleBrief)}>使用示例需求</Button><small>示例只会填入输入框，不代表已经开始生成。</small></div></article>}
            <article className="chat-message chat-message--assistant">
              <span className="director-avatar">OD</span>
              <div><strong>我会按“诊断 → 故事线 → 设计方向 → 可编辑成品”推进。</strong><p>当前建议使用 {selectedPack?.name ?? "商业提案"}，生成后你可以直接改文字、字体、图片和版式。</p></div>
            </article>
            {workOrderWorkflow && <article className="creation-contract" aria-label="Creation Contract" aria-live="polite">
              <header><span><Kicker>Creation Contract</Kicker><strong>{workOrderWorkflow.workOrder.title}</strong></span><Badge tone={workOrderWorkflow.projection.status === "draft" ? "accent" : "success"}>{workOrderWorkflow.projection.status === "draft" ? "待你确认" : "计划已确认"}</Badge></header>
              <dl>
                <div><dt>目标</dt><dd>{workOrderWorkflow.workOrder.objective}</dd></div>
                <div><dt>受众与行动</dt><dd>{workOrderWorkflow.workOrder.audience.description} · {workOrderWorkflow.workOrder.audience.decisionOrAction}</dd></div>
                <div><dt>来源边界</dt><dd>{workOrderWorkflow.workOrder.sources.length} 个用户来源 · {workOrderWorkflow.workOrder.confidentiality === "public" ? "公开试用空间" : "私密空间"}</dd></div>
                <div><dt>Design Pack</dt><dd>{workOrderWorkflow.plan.designPack.id}@{workOrderWorkflow.plan.designPack.version}</dd></div>
              </dl>
              <div className="creation-contract__pins" aria-label="已固定的专家 Skills">{workOrderWorkflow.plan.capabilityPins.map((pin) => <span key={`${pin.id}@${pin.version}`}>{pin.id}<small>@{pin.version}</small></span>)}</div>
              {workOrderWorkflow.projection.status === "draft" && workOrderWorkflow.clarification.status === "required" && <section className="creation-contract__clarification" aria-label="澄清问题">
                <strong>开始设计前，还需要 {workOrderWorkflow.clarification.questions.length} 个关键信息</strong>
                {workOrderWorkflow.clarification.questions.map((question) => <label key={question.questionId}><span>{question.prompt}</span><small>{question.reason}</small><input aria-label={question.prompt} value={clarificationAnswers[question.questionId] ?? ""} onChange={(event) => setClarificationAnswers((current) => ({ ...current, [question.questionId]: event.target.value }))} maxLength={240} /></label>)}
                <Button size="sm" tone="outline" onClick={submitClarifications} disabled={generatorState === "working" || workOrderWorkflow.clarification.questions.some((question) => (clarificationAnswers[question.questionId] ?? "").trim().length < 2)}>保存补充信息</Button>
              </section>}
              {workOrderWorkflow.clarification.status !== "required" && <p className="creation-contract__decision-ok"><Icon name="check" size={10} /> {workOrderWorkflow.clarification.status === "not-needed" ? "Brief 已包含明确受众与行动" : "关键信息已补充并留痕"}</p>}
              <section className="creation-contract__directions" aria-label="三个设计方向">
                <strong>选择一个真实设计方向</strong>
                <div>{workOrderWorkflow.directionPreviews.map((direction) => <button type="button" key={direction.directionId} className={direction.directionId === workOrderWorkflow.selectedDirectionId ? "is-selected" : ""} aria-pressed={workOrderWorkflow.directionConfirmed && direction.directionId === workOrderWorkflow.selectedDirectionId} aria-label={`选择方向：${direction.name}`} onClick={() => chooseWorkOrderDirection(direction.directionId)} disabled={generatorState === "working" || workOrderWorkflow.projection.status !== "draft"}>
                  <span className="creation-contract__direction-slide" style={{ background: direction.tokens.background, color: direction.tokens.text, borderColor: direction.tokens.accent }}><i style={{ background: direction.tokens.accent }} /><b style={{ fontFamily: direction.tokens.headingFamily }}>Aa</b></span>
                  <span><b>{direction.name}</b><small>{direction.pack.id}@{direction.pack.version}</small><em>{direction.rationale}</em><em>{direction.composition.density} · {direction.composition.grid}</em><em>{direction.composition.rhythm}</em></span>
                  {direction.directionId === workOrderWorkflow.selectedDirectionId && workOrderWorkflow.directionConfirmed && <Icon name="check" size={11} />}
                </button>)}</div>
                <small>{workOrderWorkflow.directionConfirmed ? "方向已确认并写入执行计划。" : "当前高亮是建议方向；请点击一次明确确认，也可以选择其他方向。"}</small>
              </section>
              <section className="creation-contract__outline" aria-label="大纲确认">
                <span><strong>页面大纲</strong><small>{workOrderWorkflow.outlineReview.status === "unavailable" ? "确认方向后形成" : `${workOrderWorkflow.outlineReview.itemCount} 页 · ${workOrderWorkflow.outlineReview.status === "approved" ? "已批准" : "等待确认"}`}</small></span>
                {workOrderWorkflow.outlineReview.status !== "unavailable" && <Button size="sm" tone={workOrderWorkflow.outlineReview.status === "draft" ? "primary" : "outline"} onClick={() => setResultView("outline")} disabled={generatorState === "working"}>{workOrderWorkflow.outlineReview.status === "draft" ? "查看大纲" : "查看已批准大纲"}</Button>}
              </section>
              <ol className="creation-contract__stages">{workOrderWorkflow.plan.stages.map((item) => {
                const status = workOrderWorkflow.projection.stageStatuses[item.stageId] ?? "queued";
                return <li key={item.stageId} className={`is-${status}`}><i>{status === "completed" ? <Icon name="check" size={9} /> : item.order}</i><span><strong>{agentStageLabels[item.kind] ?? item.kind}</strong><small>{item.objective}</small></span><em>{status}</em></li>;
              })}</ol>
              <p className="creation-contract__budget">预算上限：{workOrderWorkflow.plan.budget.maxDurationSeconds} 秒 · {workOrderWorkflow.plan.budget.maxModelCalls} 次模型调用 · 不自动生成图片</p>
              {workOrderWorkflow.projection.status === "draft" && <div className="creation-contract__actions"><Button size="sm" tone="primary" onClick={confirmCreationPlan} disabled={generatorState === "working" || !workOrderWorkflow.readyForConfirmation}>确认计划并开始创作</Button><small>{workOrderWorkflow.readyForConfirmation ? "确认前不会调用模型，也不会改动当前作品。" : "请先补齐必要信息，确认方向并批准大纲。"}</small></div>}
              {workOrderWorkflow.projection.status === "confirmed" && !generationJob && <div className="creation-contract__actions"><Button size="sm" tone="outline" onClick={confirmCreationPlan} disabled={generatorState === "working"}>启动已确认计划</Button><small>计划已留痕；服务恢复后可继续。</small></div>}
            </article>}
            {generationJob && <article className={`generation-job generation-job--${generationJob.status}`} aria-live="polite" aria-label="生成任务状态">
              <header><span className="generation-job__state"><i /><span><strong>{generationStageCopy[generationJob.status].label}</strong><small>{generationElapsed} 秒 · {generationJob.jobId.slice(0, 12)}</small></span></span><Badge tone={generationJob.status === "completed" ? "success" : generationJob.status === "failed" || generationJob.status === "cancelled" ? "neutral" : "accent"}>{generationJob.status}</Badge></header>
              <div className="generation-job__track" aria-label={`生成进度 ${generationStageCopy[generationJob.status].progress}%`}><span style={{ width: `${generationStageCopy[generationJob.status].progress}%` }} /></div>
              <p>{generationStageCopy[generationJob.status].detail}</p>
              <ol className="generation-job__artifacts" aria-label="阶段产物">
                <li className={latestArtifact("structured-html") ? "is-ready" : ""}><i>{latestArtifact("structured-html") ? <Icon name="check" size={9} /> : "1"}</i><span><strong>Structured HTML</strong><small>{latestArtifact("structured-html") ? "已编译并登记" : "等待内容创作"}</small></span></li>
                <li className={latestArtifact("scene-ir") ? "is-ready" : ""}><i>{latestArtifact("scene-ir") ? <Icon name="check" size={9} /> : "2"}</i><span><strong>Scene IR</strong><small>{latestArtifact("scene-ir") ? "已安全导入，可只读预览" : "等待安全导入"}</small></span></li>
                <li className={latestArtifact("qa-report") ? latestArtifact("qa-report")?.validationStatus === "rejected" ? "is-error" : "is-ready" : ""}><i>{latestArtifact("qa-report") ? <Icon name={latestArtifact("qa-report")?.validationStatus === "rejected" ? "close" : "check"} size={9} /> : "3"}</i><span><strong>QA Report</strong><small>{latestArtifact("qa-report") ? latestArtifact("qa-report")?.validationStatus === "rejected" ? "已留存失败证据" : "检查已通过" : "等待确定性检查"}</small></span></li>
              </ol>
              {generatedPreview && <div className="generation-job__actions"><Button size="sm" tone="outline" onClick={() => { setArtifactPreviewOpen(true); setResultView("slides"); }}>查看阶段预览</Button><small>只读查看，不覆盖当前人工稿。</small></div>}
              {generationJob.status === "completed" && <div className="generation-job__actions"><Button size="sm" tone="primary" onClick={openGeneratedProject} disabled={generatorState === "working"}>打开新作品</Button><small>当前作品不会自动被覆盖。</small></div>}
              {generationJob.status === "failed" && <div className="generation-job__error" role="alert"><strong>{generationErrorCopy(generationJob.error?.code, generationJob.error?.message).title}</strong><p>{generationErrorCopy(generationJob.error?.code, generationJob.error?.message).detail}</p><small>{generationErrorCopy(generationJob.error?.code, generationJob.error?.message).action}</small></div>}
              {generationRunning && <Button size="sm" tone="quiet" onClick={cancelActiveGeneration}>取消生成</Button>}
            </article>}
            {generationJobError && <article className="generation-job generation-job--error" role="alert">
              <header><span><strong>{generationErrorCopy(generationJobError.code, generationJobError.message).title}</strong><small>{generationErrorCopy(generationJobError.code, generationJobError.message).action}</small></span></header>
              <p>{generationErrorCopy(generationJobError.code, generationJobError.message).detail}</p>
              {generationRecoveryJobId && <Button size="sm" tone="outline" onClick={resumeGeneration}>恢复任务状态</Button>}
            </article>}
            {directorOutput?.status === "accepted" && <article className="chat-message chat-message--assistant chat-message--success"><span className="director-avatar">OD</span><div><strong>初稿已经通过结构与安全检查</strong><p>{directorOutput.manifest.sceneIds.length} 页 · {directorOutput.manifest.sourceCoverage.usedSourceIds.length}/{directorOutput.manifest.sourceCoverage.declaredSourceIds.length} 个来源已使用。右侧可以继续人工修改。</p></div></article>}
          </div>

          <nav className="process-rail" aria-label="Studio 工作流">
            {processSteps.map(([id, number, label], index) => {
              const activeIndex = processSteps.findIndex(([stepId]) => stepId === workflowStep);
              return <button type="button" key={id} className={id === workflowStep ? "is-active" : index < activeIndex ? "is-done" : ""} aria-current={id === workflowStep ? "step" : undefined} onClick={() => setWorkflowStep(id)}><span>{index < activeIndex ? <Icon name="check" size={11} /> : number}</span><strong>{label}</strong></button>;
            })}
          </nav>

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
                const directionChoice = goldenDirections.find((item) => item.pack.id === pack.id);
                return <button type="button" key={pack.id} className={pack.id === selectedPackId ? "is-active" : ""} aria-label={`${pack.name} · ${pack.id}@${pack.version}`} aria-pressed={pack.id === selectedPackId} onClick={() => selectDesignPack(pack.id)}><span className="pack-swatch" style={{ background: pack.tokens.background, color: pack.tokens.accent }}>Aa</span><span><strong>{pack.name}</strong><small>{pack.id}@{pack.version}</small><em>{directionChoice?.selectionRationale}</em></span>{pack.id === selectedPackId && <Icon name="check" size={13} />}</button>;
              })}</div>
            </>}
            {workflowStep === "studio" && <>
              <div className="section-heading"><div><Kicker>Agent handoff</Kicker><h2>结构化设计协议</h2></div><Badge tone="success">Scene IR</Badge></div>
              <dl className="contract-summary"><div><dt>Design Pack</dt><dd>{selectedPack ? `${selectedPack.id}@${selectedPack.version}` : "未选择"}</dd></div><div><dt>Contract</dt><dd>{selectedPack?.agentAnnotation.contractVersion ?? "-"}</dd></div><div><dt>Capabilities</dt><dd>{selectedPack?.agentAnnotation.requiredCapabilities.join(" · ") ?? "-"}</dd></div></dl>
              {selectedPack && <><label className="agent-annotation"><span>可复制给其他 Agent 的标注</span><textarea readOnly aria-label="Agent 设计标注" value={selectedPack.agentAnnotation.copyText} /></label><Button size="sm" tone="outline" onClick={copyAgentAnnotation}>{annotationCopyState === "copied" ? "已复制 Agent 标注" : annotationCopyState === "manual" ? "请在上方手动复制" : "复制 Agent 标注"}</Button></>}
            </>}
          </section>

          <section className="panel-section brief-section">
            <label className="composer-label" htmlFor="studio-brief">给设计总监新的指令</label>
            <textarea id="studio-brief" value={brief} onChange={(event) => {
              setBrief(event.target.value);
              if (workOrderWorkflow?.projection.status === "draft") {
                setWorkOrderWorkflow(null);
                window.localStorage.removeItem(workOrderStorageKey);
              }
            }} aria-label="项目 Brief" placeholder="描述你想制作的提案、演讲或文章配图…" />
            <div className="source-meta"><span><Icon name="file" size={13} /> Brief · {[...brief].length} 字</span><Badge tone={brief.trim().length >= 12 ? "success" : "neutral"}>{brief.trim().length >= 12 ? "可生成" : "继续输入"}</Badge></div>
            <div className="composer-actions"><Button size="sm" tone="outline" onClick={() => setWorkflowStep("sources")}><Icon name="file" size={13} /> 添加素材</Button><Button size="sm" tone="primary" onClick={createFromBrief} disabled={generatorState === "working" || generationRunning || brief.trim().length < 12}><Icon name="spark" size={13} />{generatorState === "working" ? "正在提交" : generationRunning ? "任务进行中" : workOrderWorkflow?.projection.status === "draft" ? "重新诊断计划" : "诊断并制定计划"}</Button></div>
            <button className="composer-example" type="button" onClick={() => setBrief(exampleBrief)}>使用示例需求（仅填充）</button>
            <details className="advanced-generation"><summary>更多生成方式</summary><Button size="sm" tone="outline" onClick={createFromDesignDirector} disabled={generatorState === "working" || brief.trim().length < 12 || !selectedPack}><Icon name="layers" size={13} />Design Director Skill 初稿</Button><Button size="sm" tone="outline" onClick={createFromFixtureModel} disabled={generatorState === "working" || brief.trim().length < 12 || !selectedPack}><Icon name="spark" size={13} />安全模型生成（Fixture）</Button></details>
            {generatorState === "error" && !generationJobError && <small className="generator-error">{generatorError}</small>}
            <p className="anonymous-space-note"><Icon name="warning" size={12} /> 此空间由匿名 Cookie 识别。清除浏览器 Cookie 后，你将无法再访问这里的项目与任务。</p>
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
          <div className="result-tabs" role="tablist" aria-label="作品视图">
            {([['sources', '材料', 'file'], ['outline', '大纲', 'layers'], ['directions', '方向', 'spark'], ['slides', '幻灯片', 'play'], ['qa', 'QA', 'check'], ['export', '导出', 'arrow']] as const).map(([id, label, icon]) => <button key={id} type="button" role="tab" aria-selected={resultView === id} className={resultView === id ? "is-active" : ""} data-status={resultStatus(id)} onClick={() => setResultView(id)}><Icon name={icon} size={14} />{label}<i aria-hidden="true" /></button>)}
            <span className="result-tabs__count">{document.scenes.length} 页</span>
            <button type="button" className="result-tabs__tool" aria-label="打开编辑面板" onClick={() => { setInspectorTab("edit"); setInspectorOpen(true); }}><Icon name="edit" size={15} /></button>
            <button type="button" className="result-tabs__tool" aria-label="打开质量检查" onClick={() => { setInspectorTab("qa"); setInspectorOpen(true); }}><Icon name="check" size={15} /></button>
          </div>

          {resultView === "slides" && (artifactPreviewOpen && previewScene && previewDirection ? <>
          <div className="stage-toolbar stage-toolbar--preview">
            <div className="stage-toolbar__scene"><Kicker>Generated Preview · Page {String(previewScene.order).padStart(2, "0")}</Kicker><strong>{previewScene.title}</strong><Badge tone="accent">只读阶段预览</Badge></div>
            <div className="stage-toolbar__tools"><Button size="sm" tone="outline" onClick={() => setArtifactPreviewOpen(false)}>返回当前人工稿</Button></div>
          </div>
          <div className="stage-canvas-wrap stage-canvas-wrap--preview">
            <SceneCanvas scene={previewScene} direction={previewDirection} selectedElementId={null} issueElementIds={new Set()} onSelect={() => undefined} onFrameChange={() => undefined} />
            <p className="canvas-hint"><Icon name="spark" size={12} /> Importer 已接受 · {generatedQaReport ? generatedQaReport.summary.blocker === 0 && generatedQaReport.summary.error === 0 ? "QA 已通过" : `QA 未通过：${generatedQaReport.summary.blocker + generatedQaReport.summary.error} 项错误` : "QA 检查中"} · 当前人工稿未被覆盖</p>
          </div>
          <div className="filmstrip filmstrip--preview" aria-label="生成阶段预览页面">
            {(generatedPreview?.scenes ?? []).map((item) => <SceneThumbnail key={item.id} scene={item} direction={previewDirection} active={item.id === previewScene.id} issueCount={generatedQaReport?.issues.filter((issue) => issue.sceneId === item.id).length ?? 0} onSelect={() => setArtifactPreviewSceneId(item.id)} />)}
          </div>
          </> : <>
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
          </>)}

          {resultView === "outline" && <div className="result-view result-view--outline artifact-view"><header><span><Kicker>Outline Artifact</Kicker><h2>{workOrderOutline?.title ?? "先看叙事，再看页面"}</h2><p>每一页承担明确任务，并保留来源关系。大纲确认后才会调用生成 Worker。</p></span><Badge tone={workOrderWorkflow?.outlineReview.status === "approved" ? "success" : "accent"}>{artifactState === "loading" ? "读取中" : workOrderWorkflow?.outlineReview.status ?? "本地作品"}</Badge></header><ol>{(workOrderOutline?.items ?? document.scenes.map((item) => ({ itemId: item.id, order: item.order, role: "insight" as const, title: item.title, purpose: item.purpose, sourceIds: [] }))).map((item) => <li key={item.itemId}><button type="button" onClick={() => { const target = document.scenes.find((candidate) => candidate.order === item.order); if (target) { selectScene(target.id); setResultView("slides"); } }}><span>{String(item.order).padStart(2, "0")}</span><span><strong>{item.title}</strong><small>{item.role} · {item.purpose}</small></span><Badge>{item.sourceIds.length} 来源</Badge></button></li>)}</ol>{workOrderWorkflow?.outlineReview.status === "draft" && <div className="artifact-approval"><span><strong>这是确定性大纲候选</strong><small>请确认结构；尚未调用模型，也没有改动当前作品。</small></span><Button tone="primary" onClick={approveCurrentOutline} disabled={generatorState === "working"}>批准大纲</Button></div>}</div>}
          {resultView === "sources" && <div className="result-view result-view--files artifact-view"><header><span><Kicker>Sources Artifact</Kicker><h2>作品使用的材料</h2><p>来源只用于当前任务；事实、推断和建议不会混为一谈。</p></span><Badge tone="success">{workOrderWorkflow?.workOrder.sources.length ?? goldenTask.sources.length} sources</Badge></header><div>{(workOrderWorkflow?.workOrder.sources ?? goldenTask.sources).map((source) => <article key={source.sourceId}><span className="file-mark"><Icon name="file" size={18} /></span><span><strong>{source.title}</strong><small>{source.type} · {"sourceRef" in source && source.sourceRef ? source.sourceRef : source.sourceId}</small></span><Badge tone="success">已声明</Badge></article>)}</div><Button tone="outline" onClick={() => setWorkflowStep("sources")}><Icon name="plus" size={14} /> 添加文件或 HTML</Button></div>}
          {resultView === "directions" && <div className="result-view artifact-view artifact-directions"><header><span><Kicker>Direction Artifact</Kicker><h2>一主两备的设计判断</h2><p>方向来自受治理 Design Pack，而不是临时的文字风格名。</p></span><Badge tone={workOrderWorkflow?.directionConfirmed ? "success" : "accent"}>{workOrderWorkflow?.directionConfirmed ? "已确认" : "待选择"}</Badge></header><div>{(workOrderWorkflow?.directionPreviews ?? []).map((item) => <button type="button" key={item.directionId} className={workOrderWorkflow?.selectedDirectionId === item.directionId ? "is-selected" : ""} onClick={() => void chooseWorkOrderDirection(item.directionId)} disabled={workOrderWorkflow?.projection.status !== "draft"}><span style={{ background: item.tokens.background, color: item.tokens.text, borderColor: item.tokens.accent }}><i style={{ background: item.tokens.accent }} />Aa</span><strong>{item.name}</strong><small>{item.pack.id}@{item.pack.version}</small><p>{item.rationale}</p></button>)}</div></div>}
          {resultView === "qa" && <div className="result-view artifact-view artifact-summary"><header><span><Kicker>QA Artifact</Kicker><h2>{generatedQaReport ? `${generatedQaReport.summary.total} 项生成稿检查结果` : qaState === "ready" ? `${openIssues.length} 项当前稿检查结果` : "等待确定性检查"}</h2><p>问题回指页面和元素，不用单一审美总分替代判断。生成稿与当前人工稿的 QA 明确分开。</p></span><Badge tone={(generatedQaReport ? generatedQaReport.summary.blocker + generatedQaReport.summary.error > 0 : openIssues.some((issue) => issue.severity === "blocker" || issue.severity === "error")) ? "warning" : "success"}>{generatedQaReport ? "生成稿 QA" : `当前稿 QA ${qaState === "ready" ? qaScore : "-"}`}</Badge></header><dl><div><dt>错误</dt><dd>{generatedQaReport ? generatedQaReport.summary.blocker + generatedQaReport.summary.error : openIssues.filter((issue) => issue.severity === "blocker" || issue.severity === "error").length}</dd></div><div><dt>警告</dt><dd>{generatedQaReport ? generatedQaReport.summary.warning : openIssues.filter((issue) => issue.severity === "warning").length}</dd></div><div><dt>定位</dt><dd>{new Set((generatedQaReport?.issues ?? openIssues).map((issue) => issue.sceneId)).size} 页</dd></div></dl>{generatedQaReport ? <Button tone="outline" onClick={() => { setArtifactPreviewOpen(true); setResultView("slides"); }} disabled={!generatedPreview}>查看对应阶段预览</Button> : <Button tone="outline" onClick={() => { setInspectorTab("qa"); setInspectorOpen(true); }}>打开当前稿 QA</Button>}</div>}
          {resultView === "export" && <div className="result-view artifact-view artifact-summary"><header><span><Kicker>Export Artifact</Kicker><h2>可编辑与高保真明确分开</h2><p>所有格式消费当前 Scene IR；PPTX 不从整页 HTML 截图反推。</p></span><Badge>{latestArtifact("export-report") ? "已有导出证据" : "尚未导出"}</Badge></header><dl><div><dt>HTML</dt><dd>{exportStates.html}</dd></div><div><dt>PNG</dt><dd>{exportStates.png}</dd></div><div><dt>可编辑 PPTX</dt><dd>{exportStates.pptx}</dd></div></dl><Button tone="primary" onClick={() => { setInspectorTab("export"); setInspectorOpen(true); }}>打开导出中心</Button></div>}
        </section>

        <aside className={`inspector-panel ${inspectorOpen ? "is-open" : ""}`} aria-label="作品检查器">
          <div className="inspector-tabs">
            <Tabs value={inspectorTab} onChange={(value) => { setInspectorTab(value); setInspectorOpen(true); }} label="检查器" items={[{ value: "edit", label: "编辑" }, { value: "qa", label: "QA", count: openIssues.length }, { value: "history", label: "版本", count: revisions.length }, { value: "export", label: "导出" }]} />
            <button type="button" className="inspector-close" aria-label="关闭检查器" onClick={() => setInspectorOpen(false)}>×</button>
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
              <section className="agent-change-panel" aria-label="Agent 局部修改">
                <div className="inspector-heading"><div><Kicker>Agent change</Kicker><h2>先预览 Diff，再决定是否采用</h2></div><Badge>{agentChangeCandidates.filter((candidate) => candidate.status === "proposed").length} 待确认</Badge></div>
                <p>目标：{selectedElement && typeof selectedElement.content === "string" ? `${scene.title} / ${selectedElement.role}` : `${scene.title} / 页面标题`}</p>
                <label className="field"><span>修改要求</span><textarea aria-label="Agent 修改要求" value={agentChangeInstruction} onChange={(event) => setAgentChangeInstruction(event.target.value)} placeholder="例如：改成：新的页面判断" /></label>
                <Button tone="outline" onClick={requestAgentChange} disabled={agentChangeState === "working"}>{agentChangeState === "working" ? "正在形成候选" : "让 Agent 提出修改"}</Button>
                {hasUnsavedChanges && <small className="agent-change-panel__notice"><Icon name="warning" size={11} /> 当前有人工草稿；请先保存，Agent 不会基于未固定版本改写。</small>}
                {agentChangeError && <small className="generator-error" role="alert">{agentChangeError}</small>}
                {activeAgentChange && <article className={`agent-change-candidate is-${activeAgentChange.status}`} aria-label="Agent 修改候选" aria-live="polite">
                  <header><span><strong>{activeAgentChange.status === "proposed" ? "等待你的决定" : activeAgentChange.status === "accepted" ? "已接受并生成新 revision" : activeAgentChange.status === "rejected" ? "已拒绝，当前稿未变" : "基线已漂移，未覆盖当前稿"}</strong><small>{activeAgentChange.baseRevisionId}</small></span><Badge tone={activeAgentChange.status === "accepted" ? "success" : "neutral"}>{activeAgentChange.status}</Badge></header>
                  <p>{activeAgentChange.rationale}</p>
                  {activeAgentChange.diffs.map((diff) => <div className="agent-change-diff" key={`${activeAgentChange.candidateId}-${diff.elementId}`}><span><small>Before</small><del>{diff.before}</del></span><Icon name="arrow" size={13} /><span><small>After</small><ins>{diff.after}</ins></span></div>)}
                  <small>1 个 Scene IR patch · notPublished: true</small>
                  {activeAgentChange.status === "proposed" && <><label className="field"><span>决定理由</span><textarea aria-label="Agent 候选决定理由" value={agentChangeReason} onChange={(event) => setAgentChangeReason(event.target.value)} /></label><div className="agent-change-candidate__actions"><Button size="sm" tone="primary" onClick={() => decideAgentChange("accept")} disabled={agentChangeState === "working"}>接受修改</Button><Button size="sm" tone="outline" onClick={() => decideAgentChange("reject")} disabled={agentChangeState === "working"}>拒绝修改</Button></div></>}
                </article>}
              </section>
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
              <div className="inspector-heading"><div><Kicker>Export center</Kicker><h2>一次编辑，三个输出</h2></div><Badge tone={qaState === "ready" && openIssues.length === 0 ? "success" : "neutral"}>QA {qaState === "ready" ? qaScore : "-"}</Badge></div>
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
