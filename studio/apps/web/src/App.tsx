import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { DesignDirection, Scene, SceneDocument, SceneElement, ScenePatch, StudioIssue } from "@opendesign/studio-contracts";
import fixture from "@opendesign/studio-contracts/fixtures/proposal-v0";
import { Badge, Button, Icon, Kicker, ProgressRing, Tabs } from "@opendesign/studio-ui";

const initialDocument = fixture as unknown as SceneDocument;

const initialIssues: StudioIssue[] = [
  {
    issueId: "issue_reading_length",
    sceneId: "scene_problem",
    elementIds: ["problem_body"],
    category: "layout.overflow",
    severity: "warning",
    message: "正文接近安全行数上限，建议精简 12–18 个字。",
    status: "open",
    safeAutoFix: false,
  },
  {
    issueId: "issue_metric_contrast",
    sceneId: "scene_system",
    elementIds: ["system_html"],
    category: "readability.contrast",
    severity: "error",
    message: "该输出标签在当前方向下的对比度低于 4.5:1。",
    status: "open",
    safeAutoFix: true,
  },
  {
    issueId: "issue_title_export",
    sceneId: "scene_cover",
    elementIds: ["cover_title"],
    category: "export.font_missing",
    severity: "note",
    message: "PPTX 将使用可编辑的系统衬线字体替代。",
    status: "open",
    safeAutoFix: false,
  },
];

type InspectorTab = "edit" | "qa" | "export";
type ExportKind = "html" | "png" | "pptx";
type ExportState = "idle" | "working" | "ready";

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
            {element.type !== "shape" && <span>{element.content}</span>}
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

function ExportCard({ kind, title, description, state, onExport }: { kind: ExportKind; title: string; description: string; state: ExportState; onExport: () => void }) {
  const labels: Record<ExportState, string> = { idle: "生成", working: "处理中", ready: "重新生成" };
  return (
    <div className="export-card">
      <span className={`export-card__icon export-card__icon--${kind}`}><Icon name={kind === "png" ? "image" : kind === "pptx" ? "layers" : "code"} /></span>
      <span className="export-card__copy"><strong>{title}</strong><small>{description}</small></span>
      <Button size="sm" tone={state === "ready" ? "quiet" : "outline"} onClick={onExport} disabled={state === "working"} aria-label={`${title}：${labels[state]}`}>
        {state === "working" ? <span className="spinner" /> : state === "ready" ? <Icon name="check" size={13} /> : <Icon name="download" size={13} />}
        {labels[state]}
      </Button>
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
  const [savedPatchCount, setSavedPatchCount] = useState(0);
  const [issues, setIssues] = useState(initialIssues);
  const [exportStates, setExportStates] = useState<Record<ExportKind, ExportState>>({ html: "idle", png: "idle", pptx: "idle" });

  const scene = document.scenes.find((item) => item.id === selectedSceneId) ?? document.scenes[0]!;
  const direction = document.directions.find((item) => item.id === document.selectedDirectionId) ?? document.directions[0]!;
  const selectedElement = getElement(document, selectedElementId);
  const openIssues = issues.filter((issue) => issue.status === "open");
  const sceneIssues = openIssues.filter((issue) => issue.sceneId === scene.id);
  const issueElementIds = useMemo(() => new Set(sceneIssues.flatMap((issue) => issue.elementIds)), [sceneIssues]);
  const unsavedCount = patches.length - savedPatchCount;

  function selectDirection(directionId: string) {
    setDocument((current) => ({ ...current, selectedDirectionId: directionId }));
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
  }

  function locateIssue(issue: StudioIssue) {
    setSelectedSceneId(issue.sceneId);
    setSelectedElementId(issue.elementIds[0] ?? null);
    setInspectorTab("qa");
  }

  function fixIssue(issueId: string) {
    setIssues((current) => current.map((issue) => issue.issueId === issueId ? { ...issue, status: "fixed" } : issue));
  }

  function startExport(kind: ExportKind) {
    setExportStates((current) => ({ ...current, [kind]: "working" }));
    window.setTimeout(() => setExportStates((current) => ({ ...current, [kind]: "ready" })), 850);
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
          <button type="button"><Icon name="chevron" size={14} /> 项目</button>
          <span>/</span>
          <strong>{document.title}</strong>
        </div>
        <div className="topbar__actions">
          <span className={`sync-state ${unsavedCount > 0 ? "is-dirty" : ""}`}><i />{unsavedCount > 0 ? `${unsavedCount} 个 IR patch` : "已存为本地修订"}</span>
          <Button size="sm" tone="outline" onClick={() => setSavedPatchCount(patches.length)} disabled={unsavedCount === 0}>保存修订</Button>
          <Button size="sm" tone="primary" onClick={() => setInspectorTab("export")}><Icon name="play" size={13} /> 导出作品</Button>
          <Button size="sm" aria-label="更多操作"><Icon name="more" size={17} /></Button>
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
            <div className="source-meta"><span><Icon name="file" size={13} /> Brief · 84 字</span><Badge tone="success">已解析</Badge></div>
          </section>

          <section className="panel-section storyline-section">
            <div className="section-heading"><div><Kicker>Storyline</Kicker><h2>故事线</h2></div><Button size="sm" aria-label="添加页面"><Icon name="plus" size={13} /></Button></div>
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
              <Button size="sm" aria-label="文本工具"><Icon name="text" size={15} /></Button>
              <Button size="sm" aria-label="图片工具"><Icon name="image" size={15} /></Button>
              <Button size="sm" aria-label="图层"><Icon name="layers" size={15} /></Button>
              <span />
              <Button size="sm"><Icon name="eye" size={15} /> 适应画布</Button>
              <span className="zoom-label">67%</span>
            </div>
          </div>

          <div className="stage-canvas-wrap">
            <SceneCanvas scene={scene} direction={direction} selectedElementId={selectedElementId} issueElementIds={issueElementIds} onSelect={selectElement} />
            <p className="canvas-hint"><Icon name="spark" size={12} /> 双击文字开始编辑 · 所有元素来自 Scene IR 0.1</p>
          </div>

          <div className="filmstrip" aria-label="页面缩略图">
            {document.scenes.map((item) => <SceneThumbnail key={item.id} scene={item} direction={direction} active={item.id === scene.id} issueCount={openIssues.filter((issue) => issue.sceneId === item.id).length} onSelect={() => selectScene(item.id)} />)}
            <button type="button" className="filmstrip__add"><Icon name="plus" /><span>新增页面</span></button>
          </div>
        </section>

        <aside className="inspector-panel">
          <div className="inspector-tabs">
            <Tabs value={inspectorTab} onChange={setInspectorTab} label="检查器" items={[{ value: "edit", label: "编辑" }, { value: "qa", label: "QA", count: openIssues.length }, { value: "export", label: "导出" }]} />
          </div>

          {inspectorTab === "edit" && (
            <div className="inspector-content">
              <div className="inspector-heading"><div><Kicker>Selection</Kicker><h2>{selectedElement ? selectedElement.role : "页面属性"}</h2></div>{selectedElement && <Badge tone={selectedElement.editable ? "success" : "neutral"}>{selectedElement.editable ? "可编辑" : "已锁定"}</Badge>}</div>
              {selectedElement ? <>
                {selectedElement.editable && selectedElement.content !== undefined && <label className="field"><span>文字内容</span><textarea value={selectedElement.content} onChange={(event) => updateSelectedContent(event.target.value)} autoFocus /></label>}
                <div className="property-grid"><label className="field"><span>X</span><input value={selectedElement.frame.x} readOnly /></label><label className="field"><span>Y</span><input value={selectedElement.frame.y} readOnly /></label><label className="field"><span>W</span><input value={selectedElement.frame.width} readOnly /></label><label className="field"><span>H</span><input value={selectedElement.frame.height} readOnly /></label></div>
                <div className="property-row"><span>类型</span><strong>{selectedElement.type} / {selectedElement.role}</strong></div>
                <div className="property-row"><span>字号</span><strong>{selectedElement.fontSize ? `${selectedElement.fontSize}px` : "—"}</strong></div>
                <div className="patch-card"><span><Icon name="code" size={15} /></span><div><strong>IR patch 已就绪</strong><small>{unsavedCount > 0 ? `${unsavedCount} 个变更等待保存为修订` : "当前选择没有未保存变更"}</small></div></div>
              </> : <div className="empty-selection"><span><Icon name="edit" size={22} /></span><h3>选择画布中的元素</h3><p>双击可编辑文字，修改会记录为可追踪的 Scene IR patch。</p></div>}
            </div>
          )}

          {inspectorTab === "qa" && (
            <div className="inspector-content">
              <div className="qa-summary"><ProgressRing value={82} /><div><Kicker>Render health</Kicker><h2>{openIssues.length} 项需要确认</h2><p>{openIssues.filter((issue) => issue.severity === "error").length} 错误 · {openIssues.filter((issue) => issue.severity === "warning").length} 警告 · {openIssues.filter((issue) => issue.severity === "note").length} 提示</p></div></div>
              <div className="qa-filter"><button type="button" className="is-active">全部 {openIssues.length}</button><button type="button">当前页 {sceneIssues.length}</button><button type="button">已修复 {issues.length - openIssues.length}</button></div>
              <div className="issue-list">
                {openIssues.map((issue) => <div role="button" tabIndex={0} key={issue.issueId} className={`issue-card issue-card--${issue.severity} ${issue.sceneId === scene.id ? "is-current" : ""}`} onClick={() => locateIssue(issue)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") locateIssue(issue); }}>
                  <span className="issue-card__icon"><Icon name="warning" size={15} /></span>
                  <span className="issue-card__copy"><span><Badge tone={issue.severity === "error" ? "warning" : "neutral"}>{issue.category.split(".")[1]}</Badge><small>{document.scenes.find((item) => item.id === issue.sceneId)?.title}</small></span><strong>{issue.message}</strong><small>{issue.elementIds.join(" · ")}</small></span>
                  {issue.safeAutoFix && <Button size="sm" tone="outline" onClick={(event) => { event.stopPropagation(); fixIssue(issue.issueId); }}>安全修复</Button>}
                </div>)}
              </div>
              <div className="qa-note"><Icon name="spark" size={14} /><p><strong>定位，不重做。</strong><br />每个问题都回指具体页面与元素 ID。</p></div>
            </div>
          )}

          {inspectorTab === "export" && (
            <div className="inspector-content">
              <div className="inspector-heading"><div><Kicker>Export center</Kicker><h2>一次编辑，三个输出</h2></div><Badge tone="success">QA 82</Badge></div>
              <p className="export-intro">三个格式共享当前 Scene IR 修订，不从 HTML 反推 PPT。</p>
              <div className="export-list">
                <ExportCard kind="html" title="交互式 HTML" description="保留语义与响应式预览" state={exportStates.html} onExport={() => startExport("html")} />
                <ExportCard kind="png" title="PNG 图集" description="6 页 · 2× 清晰度" state={exportStates.png} onExport={() => startExport("png")} />
                <ExportCard kind="pptx" title="可编辑 PPTX" description="原生文字与形状优先" state={exportStates.pptx} onExport={() => startExport("pptx")} />
              </div>
              <div className="export-report"><div><Icon name="layers" size={16} /><strong>编辑性预检</strong></div><dl><div><dt>原生可编辑</dt><dd>21 元素</dd></div><div><dt>组件级栅格</dt><dd>0 元素</dd></div><div><dt>字体替换</dt><dd>1 项</dd></div></dl><Button tone="outline" size="sm">查看完整报告 <Icon name="arrow" size={13} /></Button></div>
              {Object.values(exportStates).some((state) => state === "ready") && <div className="ready-callout"><Icon name="check" size={16} /><div><strong>本地模拟文件已生成</strong><small>Mock adapter 不会上传或写入生产存储。</small></div></div>}
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
