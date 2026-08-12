import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { DesignDirection, Scene, SceneDocument, SceneElement, ScenePatch, StudioIssue } from "@opendesign/studio-contracts";
import fixture from "@opendesign/studio-contracts/fixtures/proposal-v0";
import { Badge, Button, Icon, Kicker, ProgressRing, Tabs } from "@opendesign/studio-ui";
import {
  createExport,
  duplicateProject,
  generateProject,
  listProjects,
  listRevisions,
  loadProject,
  persistProject,
  runProjectQa,
  uploadProjectImage,
  type ProjectSummary,
  type StoredRevision,
  type StudioExportResult,
} from "./api";

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

const processSteps = [
  ["01", "项目输入"],
  ["02", "故事线与方向"],
  ["03", "编辑与检查"],
  ["04", "导出中心"],
] as const;

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

function SceneCanvas({ scene, direction, selectedElementId, issueElementIds, onSelect }: {
  scene: Scene;
  direction: DesignDirection;
  selectedElementId: string | null;
  issueElementIds: Set<string>;
  onSelect: (element: SceneElement, edit: boolean) => void;
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
        {scene.elements.map((element) => (
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
              textAlign: element.align,
              zIndex: element.zIndex,
              fontFamily: element.role === "title" || element.role === "quote" ? direction.tokens.headingFamily : undefined,
            }}
            onClick={() => onSelect(element, false)}
            onDoubleClick={() => onSelect(element, true)}
            aria-label={`${element.role}: ${element.content ?? element.alt ?? "视觉元素"}`}
          >
            {element.type === "image" && element.assetSrc ? <img src={element.assetSrc} alt={element.alt ?? ""} /> : element.type !== "shape" && <span>{element.content}</span>}
            {issueElementIds.has(element.id) && <i className="scene-element__issue"><Icon name="warning" size={18} /></i>}
          </button>
        ))}
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
  const [document, setDocument] = useState<SceneDocument>(initialDocument);
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
  const [assetState, setAssetState] = useState<"idle" | "uploading" | "error">("idle");
  const imageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    Promise.all([loadProject(initialDocument.documentId), listProjects()])
      .then(([stored, availableProjects]) => {
        if (active) setProjects(availableProjects);
        if (active && stored) {
          setDocument(stored);
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

  function openDocument(next: SceneDocument) {
    setDocument(next);
    setSelectedSceneId(next.scenes[0]?.id ?? "");
    setSelectedElementId(null);
    setPatches([]);
    setDocumentDirty(false);
    setExportResults({});
    setExportStates({ html: "idle", png: "idle", pptx: "idle" });
    setSyncState("saved");
    setInspectorTab("edit");
  }

  function selectDirection(directionId: string) {
    setDocument((current) => ({ ...current, selectedDirectionId: directionId }));
    setDocumentDirty(true);
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
    setDocument((current) => patchElement(current, patch));
    setPatches((current) => [...current, patch]);
    setDocumentDirty(true);
  }

  function updateDirectionFont(field: "fontFamily" | "headingFamily", value: string) {
    const patch: ScenePatch = { directionId: direction.id, field, value };
    setDocument((current) => patchElement(current, patch));
    setPatches((current) => [...current, patch]);
    setDocumentDirty(true);
  }

  async function insertOrReplaceImage(file: File) {
    setAssetState("uploading");
    try {
      const asset = await uploadProjectImage(document.documentId, file);
      if (selectedElement?.type === "image") {
        const sourcePatch: ScenePatch = { elementId: selectedElement.id, field: "assetSrc", value: asset.url };
        const altPatch: ScenePatch = { elementId: selectedElement.id, field: "alt", value: file.name.replace(/\.[^.]+$/, "") || "项目图片" };
        setDocument((current) => patchElement(patchElement(current, sourcePatch), altPatch));
        setPatches((current) => [...current, sourcePatch, altPatch]);
      } else {
        const imageId = `image_${Date.now().toString(36)}`;
        const imageElement: SceneElement = { id: imageId, type: "image", role: "image", frame: { x: 1130, y: 500, width: 300, height: 230 }, assetSrc: asset.url, alt: file.name.replace(/\.[^.]+$/, "") || "项目图片", editable: true, zIndex: 4 };
        setDocument((current) => ({ ...current, scenes: current.scenes.map((item) => item.id === scene.id ? { ...item, elements: [...item.elements, imageElement] } : item) }));
        setSelectedElementId(imageId);
        setDocumentDirty(true);
      }
      setDocumentDirty(true);
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

  function fixIssue(issueId: string) {
    const issue = issues.find((candidate) => candidate.issueId === issueId);
    if (!issue?.safeAutoFix) return;
    const targetElementId = issue.elementIds[0];
    if (issue.category === "readability.contrast" && targetElementId) {
      const patch: ScenePatch = { elementId: targetElementId, field: "color", value: "text" };
      setDocument((current) => patchElement(current, patch));
      setPatches((current) => [...current, patch]);
      setDocumentDirty(true);
    }
    if (issue.category === "readability.font_size" && targetElementId) {
      const target = getElement(document, targetElementId);
      if (target) {
        const minimum = target.role === "eyebrow" ? 16 : target.role === "title" ? 35 : target.role === "metric" || target.role === "quote" ? 24 : target.role === "caption" ? 14 : 16;
        const patch: ScenePatch = { elementId: targetElementId, field: "fontSize", value: minimum };
        setDocument((current) => patchElement(current, patch));
        setPatches((current) => [...current, patch]);
        setDocumentDirty(true);
      }
    }
  }

  async function saveRevision() {
    setSyncState("saving");
    try {
      await persistProject(document, patches, "edit");
      setPatches([]);
      setDocumentDirty(false);
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
      const generated = await generateProject(brief);
      openDocument(generated.document);
      await Promise.all([refreshProjects(), refreshRevisions(generated.document.documentId)]);
      setGeneratorState("idle");
    } catch (error) {
      setGeneratorError(error instanceof Error ? error.message : "生成失败");
      setGeneratorState("error");
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
          <span className={`sync-state ${hasUnsavedChanges || syncState === "error" ? "is-dirty" : ""}`}><i />{syncState === "saving" ? "正在保存" : syncState === "error" ? "本地 API 不可用" : unsavedCount > 0 ? `${unsavedCount} 个 IR patch` : documentDirty ? "有未保存的设计变更" : syncState === "saved" ? "已持久化到本地" : "本地修订"}</span>
          <Button size="sm" tone="outline" onClick={saveRevision} disabled={!hasUnsavedChanges || syncState === "saving"}>保存修订</Button>
          <Button size="sm" tone="primary" onClick={() => setInspectorTab("export")}><Icon name="play" size={13} /> 导出作品</Button>
          <Button size="sm" aria-label="更多操作" disabled title="首版暂不提供更多操作"><Icon name="more" size={17} /></Button>
        </div>
      </header>

      <nav className="process-rail" aria-label="Studio 工作流">
        {processSteps.map(([number, label], index) => <div key={number} className={index === 2 ? "is-active" : index < 2 ? "is-done" : ""}><span>{index < 2 ? <Icon name="check" size={11} /> : number}</span><strong>{label}</strong><i /></div>)}
      </nav>

      <div className="workspace">
        <aside className="narrative-panel">
          <section className="panel-section brief-section">
            <div className="section-heading"><Kicker>Project input</Kicker><Button size="sm" aria-label="编辑项目输入"><Icon name="edit" size={13} /></Button></div>
            <textarea value={brief} onChange={(event) => setBrief(event.target.value)} aria-label="项目 Brief" />
            <div className="source-meta"><span><Icon name="file" size={13} /> Brief · {[...brief].length} 字</span><Badge tone={brief.trim().length >= 12 ? "success" : "neutral"}>{brief.trim().length >= 12 ? "可生成" : "继续输入"}</Badge></div>
            <Button size="sm" tone="primary" onClick={createFromBrief} disabled={generatorState === "working" || brief.trim().length < 12}><Icon name="spark" size={13} />{generatorState === "working" ? "正在生成故事线" : "生成新项目"}</Button>
            {generatorState === "error" && <small className="generator-error">{generatorError}</small>}
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
              <Badge tone="success">Scene IR 0.1</Badge>
              <span className="zoom-label">67%</span>
            </div>
          </div>

          <div className="stage-canvas-wrap">
            <SceneCanvas scene={scene} direction={direction} selectedElementId={selectedElementId} issueElementIds={issueElementIds} onSelect={selectElement} />
            <p className="canvas-hint"><Icon name="spark" size={12} /> 双击文字开始编辑 · 所有元素来自 Scene IR 0.1</p>
          </div>

          <div className="filmstrip" aria-label="页面缩略图">
            {document.scenes.map((item) => <SceneThumbnail key={item.id} scene={item} direction={direction} active={item.id === scene.id} issueCount={openIssues.filter((issue) => issue.sceneId === item.id).length} onSelect={() => selectScene(item.id)} />)}
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
                <div className="property-grid"><label className="field"><span>X</span><input value={selectedElement.frame.x} readOnly /></label><label className="field"><span>Y</span><input value={selectedElement.frame.y} readOnly /></label><label className="field"><span>W</span><input value={selectedElement.frame.width} readOnly /></label><label className="field"><span>H</span><input value={selectedElement.frame.height} readOnly /></label></div>
                <div className="property-row"><span>类型</span><strong>{selectedElement.type} / {selectedElement.role}</strong></div>
                <div className="property-row"><span>字号</span><strong>{selectedElement.fontSize ? `${selectedElement.fontSize}px` : "—"}</strong></div>
                {selectedElement.type === "image" && <><div className="asset-preview"><img src={selectedElement.assetSrc} alt={selectedElement.alt ?? ""} /></div><Button tone="outline" onClick={() => imageInputRef.current?.click()} disabled={assetState === "uploading"}>{assetState === "uploading" ? "正在导入" : "替换图片"}</Button></>}
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
                  {issue.safeAutoFix && <Button size="sm" tone="outline" onClick={(event) => { event.stopPropagation(); fixIssue(issue.issueId); }}>安全修复</Button>}
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
