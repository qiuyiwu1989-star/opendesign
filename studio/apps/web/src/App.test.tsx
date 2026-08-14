import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "@opendesign/studio-contracts/fixtures/proposal-v0";
import { App } from "./App";

const generatedDocument = {
  ...fixture,
  documentId: "project_generated_001",
  title: "让文章成为一套可编辑的视觉提案",
  scenes: fixture.scenes.map((scene, index) => index === 0 ? { ...scene, title: "主张", elements: scene.elements.map((element) => element.role === "title" ? { ...element, content: "让文章成为一套可编辑的视觉提案" } : element) } : scene),
};

function workflowFixture(status: "draft" | "confirmed" | "running" = "draft", generationJobId?: string) {
  const stages = [
    ["stage_diagnose", "diagnose", "确认目标与证据边界"],
    ["stage_direction", "direction", "形成一主两备设计方向"],
    ["stage_compose", "compose", "生成 Structured HTML"],
    ["stage_import", "import", "安全导入 Scene IR"],
    ["stage_qa", "qa", "执行确定性 QA"],
    ["stage_edit", "edit", "人工局部编辑"],
    ["stage_review", "review", "人工候选确认"],
    ["stage_export", "export", "明确导出"],
  ].map(([stageId, kind, objective], index) => ({ stageId, order: index + 1, kind, objective, skillPins: [{ id: "opendesign-design-director", version: "0.3.0" }], toolIds: [], requiredArtifactTypes: [], expectedArtifactTypes: [index === 0 ? "diagnosis" : "scene-ir"], approval: index > 4 ? "human-before" : "none", maxAttempts: 1 }));
  return {
    workOrder: {
      contractVersion: "0.1.0", workOrderId: "workorder_ui000001", createdAt: "2026-08-14T01:00:00.000Z", title: "Agent Studio 提案",
      objective: "把文章或提案转化成一套能继续编辑、持续迭代的视觉叙事。", audience: { description: "内容创作者与决策者", decisionOrAction: "确认下一阶段" },
      deliverable: { kind: "proposal", formats: ["html", "pptx"], language: "zh-CN", pageCount: { min: 6, max: 8 } },
      sources: [{ sourceId: "source_brief", type: "brief", title: "用户 Brief" }], brand: { name: "OpenDesign", assetIds: [], guidance: ["清晰"] }, constraints: ["不补造事实"], successCriteria: ["三个方向", "可编辑"], confidentiality: "public",
    },
    plan: {
      contractVersion: "0.1.0", planId: "plan_ui000001", workOrderId: "workorder_ui000001", revision: 1, createdAt: "2026-08-14T01:00:00.000Z", status: "draft",
      designPack: { id: "executive-proposal-cn", version: "1.0.0" },
      capabilityPins: [{ id: "opendesign-design-director", version: "0.3.0" }, { id: "narrative-architect", version: "0.1.0" }, { id: "art-director", version: "0.1.0" }, { id: "design-critic", version: "0.1.0" }],
      stages, budget: { maxDurationSeconds: 180, maxModelCalls: 2, maxImageCalls: 0 },
    },
    projection: { workOrderId: "workorder_ui000001", planId: "plan_ui000001", status, stageStatuses: Object.fromEntries(stages.map((stage) => [stage.stageId, "queued"])), lastSequence: status === "draft" ? 0 : 1 },
    events: status === "draft" ? [] : [{ contractVersion: "0.1.0", eventId: "event_ui_confirm", commandId: "confirm_ui", sequence: 1, workOrderId: "workorder_ui000001", planId: "plan_ui000001", type: "plan_confirmed", occurredAt: "2026-08-14T01:00:01.000Z", actor: { actorId: "studio_public_session", kind: "human" }, inputArtifactIds: [], outputArtifactIds: [] }],
    ...(generationJobId ? { generationJobId } : {}),
  };
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input);
    if (init?.method === "PUT") {
      const request = JSON.parse(String(init.body)) as { document: typeof fixture };
      return new Response(JSON.stringify({ document: request.document, revision: { revisionId: "revision_test", parentRevisionId: null, createdAt: new Date().toISOString(), reason: "edit", patches: [] }, persisted: true }), { status: 200 });
    }
    if (init?.method === "POST" && path === "/api/work-orders") return new Response(JSON.stringify({ workflow: workflowFixture() }), { status: 201 });
    if (init?.method === "POST" && path === "/api/work-orders/workorder_ui000001/confirm") return new Response(JSON.stringify({ workflow: workflowFixture("confirmed", "job_completed001"), job: { jobId: "job_completed001", status: "completed", createdAt: "2026-08-14T01:00:00.000Z", updatedAt: "2026-08-14T01:00:05.000Z", projectId: generatedDocument.documentId } }), { status: 202 });
    if (!init?.method && path === "/api/work-orders/workorder_ui000001") return new Response(JSON.stringify({ workflow: workflowFixture("confirmed", "job_completed001") }), { status: 200 });
    if (init?.method === "POST" && path === "/api/generation-jobs/job_queued0001/cancel") return new Response(JSON.stringify({ job: { jobId: "job_queued0001", status: "cancelled", createdAt: "2026-08-14T01:00:00.000Z", updatedAt: "2026-08-14T01:00:02.000Z" } }), { status: 200 });
    if (init?.method === "POST" && path === "/api/design-director/drafts") return new Response(JSON.stringify({
      outputVersion: "0.1.0",
      status: "accepted",
      html: "<main data-od-contract-version=\"0.1.0\"></main>",
      manifest: {
        taskId: "studio_test",
        documentId: "project_director_001",
        compiler: { name: "opendesign-design-director", version: "0.1.0", deterministic: true },
        designPack: { id: "executive-proposal-cn", version: "1.0.0" },
        sceneIds: fixture.scenes.map((scene) => scene.id),
        elementIds: fixture.scenes.flatMap((scene) => scene.elements.map((element) => element.id)),
        sourceCoverage: { declaredSourceIds: ["source-product-brief", "source-constraints", "source-benchmark"], usedSourceIds: ["source-product-brief", "source-constraints", "source-benchmark"], unusedSourceIds: [], unresolvedSourceIds: [] },
        diagnosis: { objective: "把内容转成可编辑提案", audience: "产品负责人", designPrinciples: ["结论先行"], evidenceBoundary: "仅使用三个已声明来源。", risks: ["发布前人工确认"] },
      },
      diagnostics: [],
      importResult: { importVersion: "0.1.0", status: "accepted", document: { ...generatedDocument, documentId: "project_director_001" }, diagnostics: [], security: { untrustedInput: true, executableContent: "blocked", blockedNodeCount: 0 } },
    }), { status: 201 });
    if (init?.method === "POST" && path === "/api/model/drafts") return new Response(JSON.stringify({
      generation: {
        contractVersion: "0.1.0",
        requestId: "model_test",
        status: "accepted",
        provider: { id: "fixture", model: "design-director-fixture-v1" },
        usage: {},
        output: {
          outputVersion: "0.1.0",
          status: "accepted",
          html: "<main data-od-contract-version=\"0.1.0\"></main>",
          manifest: {
            taskId: "studio_test",
            documentId: "project_model_001",
            compiler: { name: "opendesign-design-director", version: "0.1.0", deterministic: true },
            designPack: { id: "executive-proposal-cn", version: "1.0.0" },
            sceneIds: fixture.scenes.map((scene) => scene.id),
            elementIds: fixture.scenes.flatMap((scene) => scene.elements.map((element) => element.id)),
            sourceCoverage: { declaredSourceIds: ["source-product-brief", "source-constraints", "source-benchmark"], usedSourceIds: ["source-product-brief", "source-constraints", "source-benchmark"], unusedSourceIds: [], unresolvedSourceIds: [] },
            diagnosis: { objective: "把内容转成可编辑提案", audience: "产品负责人", designPrinciples: ["结论先行"], evidenceBoundary: "仅使用三个已声明来源。", risks: ["发布前人工确认"] },
          },
          diagnostics: [],
          importResult: { importVersion: "0.1.0", status: "accepted", document: { ...generatedDocument, documentId: "project_model_001" }, diagnostics: [], security: { untrustedInput: true, executableContent: "blocked", blockedNodeCount: 0 } },
        },
      },
      review: { reviewId: "review_project_model_001", status: "draft", draft: { revisionId: "revision_model" }, lastSequence: 1 },
    }), { status: 201 });
    if (init?.method === "POST" && path === "/api/imports/html") {
      const request = JSON.parse(String(init.body)) as { html: string; provenance: unknown };
      return new Response(JSON.stringify({
        importVersion: "0.1.0",
        status: request.html.includes("data-od-contract-version") ? "accepted" : "rejected",
        ...(request.html.includes("data-od-contract-version") ? { document: { ...fixture, documentId: "doc_imported_ui", title: "安全导入作品", designPack: { id: "executive-proposal-cn", version: "1.0.0" }, provenance: request.provenance } } : {}),
        diagnostics: request.html.includes("data-od-contract-version") ? [] : [{ diagnosticId: "diag_test", code: "design_pack.pin_missing", severity: "error", disposition: "blocked", message: "Contract root is missing", sourcePath: "/html" }],
        security: { untrustedInput: true, executableContent: "blocked", blockedNodeCount: 0 },
      }), { status: request.html.includes("data-od-contract-version") ? 201 : 422 });
    }
    if (init?.method === "POST" && path === "/api/qa") return new Response(JSON.stringify({ documentId: fixture.documentId, summary: { blocker: 0, error: 0, warning: 0, note: 0, total: 0 }, issues: [] }), { status: 200 });
    if (init?.method === "POST" && path.endsWith("/assets")) return new Response(JSON.stringify({ assetId: "asset_test", name: "sample.png", mimeType: "image/png", width: 320, height: 180, url: "/api/assets/doc_studio_v0/asset_test.png" }), { status: 201 });
    if (!init?.method && path === "/api/projects") return new Response(JSON.stringify({ projects: [] }), { status: 200 });
    if (!init?.method && path === `/api/projects/${generatedDocument.documentId}`) return new Response(JSON.stringify(generatedDocument), { status: 200 });
    if (!init?.method && path.endsWith("/revisions")) return new Response(JSON.stringify({ revisions: [] }), { status: 200 });
    if (init?.method === "POST" && path.endsWith("/exports")) {
      const kind = JSON.parse(String(init.body)) as { kind: "html" | "png" | "pptx" };
      return new Response(JSON.stringify({
        exportId: `export_test_${kind.kind}`,
        kind: kind.kind,
        renderer: "test-renderer",
        files: kind.kind === "png"
          ? Array.from({ length: 6 }, (_, index) => ({ name: `slide-${index + 1}.png`, downloadUrl: `/api/exports/export_test_png/slide-${index + 1}.png` }))
          : [{ name: `doc_studio_v0.${kind.kind}`, downloadUrl: `/api/exports/export_test_${kind.kind}/doc_studio_v0.${kind.kind}` }],
        ...(kind.kind === "png" ? { bundle: { name: "doc_studio_v0-png.zip", downloadUrl: "/api/exports/export_test_png/doc_studio_v0-png.zip" } } : {}),
      }), { status: 201 });
    }
    return new Response(JSON.stringify({ error: "Project not found" }), { status: 404 });
  }));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("OpenDesign Studio workspace", () => {
  it("renders the contracts fixture and switches scenes and directions", () => {
    render(<App />);

    expect(screen.getAllByText("让视觉作品在生成之后，继续生长。").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "第 2 页：问题" }));
    expect(screen.getAllByText("漂亮截图，不等于可用作品。").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /Structural Blue/ }));
    expect(screen.getByRole("button", { name: /Structural Blue/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("walks the offline Golden Task from grounded sources to a pinned Design Pack", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /Sources/ }));
    expect(screen.getByText("Studio 产品简报")).toBeInTheDocument();
    expect(screen.getAllByText("snapshot")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "载入 Golden Brief" }));
    expect(screen.getByRole("button", { name: /Outline/ })).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("executive-summary")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Direction/ }));
    expect(screen.getByRole("button", { name: /商业提案/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: /文章叙事配图/ }));
    expect(screen.getByRole("button", { name: /文章叙事配图/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/1 项页面草稿/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "04 Studio" }));
    fireEvent.click(screen.getByRole("button", { name: "复制 Agent 标注" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining("editorial-story-graphics-cn@1.0.0")));
    expect(screen.getByRole("button", { name: "已复制 Agent 标注" })).toBeInTheDocument();
  });

  it("003 imports Structured HTML through the inert API and opens returned Scene IR", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Sources/ }));
    fireEvent.click(screen.getByRole("button", { name: "加载 Golden HTML" }));
    expect(screen.getByLabelText<HTMLTextAreaElement>("Structured HTML 源码").value).toContain("data-od-contract-version");
    fireEvent.click(screen.getByRole("button", { name: "安全导入 Scene IR" }));
    expect((await screen.findAllByText("安全导入作品")).length).toBeGreaterThan(0);
    expect(fetch).toHaveBeenCalledWith("/api/imports/html", expect.objectContaining({ method: "POST" }));
  });

  it("003 shows rejected import diagnostics without opening or persisting a document", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Sources/ }));
    fireEvent.change(screen.getByLabelText("Structured HTML 源码"), { target: { value: "<main>unsupported</main>" } });
    fireEvent.click(screen.getByRole("button", { name: "安全导入 Scene IR" }));
    expect(await screen.findByText("rejected")).toBeInTheDocument();
    expect(screen.getByText("design_pack.pin_missing")).toBeInTheDocument();
    expect(screen.getAllByText("OpenDesign Studio：让视觉作品继续生长").length).toBeGreaterThan(0);
  });

  it("004 creates a grounded Design Director Skill draft and opens accepted Scene IR", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Design Director Skill 初稿/ }));
    expect(await screen.findByText("Skill draft 已通过安全导入")).toBeInTheDocument();
    expect(screen.getByText(/3\/3 来源/)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/design-director/drafts", expect.objectContaining({ method: "POST" }));
    const call = vi.mocked(fetch).mock.calls.find(([path]) => path === "/api/design-director/drafts");
    const request = JSON.parse(String(call?.[1]?.body)) as { designPack: { id: string }; editability: { requireNativeText: boolean }; sources: unknown[] };
    expect(request.designPack.id).toBe("executive-proposal-cn");
    expect(request.editability.requireNativeText).toBe(true);
    expect(request.sources).toHaveLength(3);
  });

  it("005 exposes an honest quality baseline and fixture model provenance", async () => {
    render(<App />);
    expect(screen.getByLabelText("Design Quality Benchmark 基线")).toHaveTextContent("仍有质量债");
    expect(screen.getByLabelText("Design Quality Benchmark 基线")).toHaveTextContent("research-keynote");
    expect(screen.getByLabelText("Design Quality Benchmark 基线")).toHaveTextContent("QA 未过");
    expect(screen.getByLabelText("Design Quality Benchmark 基线")).toHaveTextContent("aggregation: prohibited");
    fireEvent.click(screen.getByRole("button", { name: /安全模型生成/ }));
    expect(await screen.findByText("Provider 证据")).toBeInTheDocument();
    expect(screen.getByText("fixture / design-director-fixture-v1")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/model/drafts", expect.objectContaining({ method: "POST" }));
  });

  it("records and persists text edits as Scene IR patches", async () => {
    render(<App />);

    const title = screen.getByRole("button", { name: /title: 让视觉作品/ });
    fireEvent.doubleClick(title);
    const editor = screen.getByLabelText("文字内容");
    fireEvent.change(editor, { target: { value: "让每一次修改，都有迹可循。" } });

    expect(screen.getAllByText("让每一次修改，都有迹可循。").length).toBeGreaterThan(0);
    expect(screen.getByText("1 个 IR patch")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存修订" }));
    await waitFor(() => expect(screen.getByText("已持久化到本地")).toBeInTheDocument());
  });

  it("shows live deterministic QA rather than canned issues", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: /QA/ }));
    expect(await screen.findByText("确定性检查已通过")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/qa", expect.objectContaining({ method: "POST" }));
  });

  it("offers one PNG ZIP download for the complete deck", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "导出作品" }));
    fireEvent.click(screen.getByRole("button", { name: "PNG 图集：生成" }));
    expect(await screen.findByRole("link", { name: "下载 6 页 ZIP" })).toHaveAttribute("href", "/api/exports/export_test_png/doc_studio_v0-png.zip");
  });

  it("changes direction typography and inserts a local image after generation", async () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText("标题字体"), { target: { value: "Songti SC, SimSun, serif" } });
    expect(screen.getByText("1 个 IR patch")).toBeInTheDocument();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([new Uint8Array([1, 2, 3])], "sample.png", { type: "image/png" })] } });
    const image = await screen.findByRole("button", { name: /image: sample/ });
    fireEvent.click(image);
    fireEvent.change(screen.getByLabelText("图片替代文本"), { target: { value: "产品工作台预览" } });
    fireEvent.change(screen.getByLabelText("图片适配方式"), { target: { value: "contain" } });
    expect(screen.getByRole("button", { name: /image: 产品工作台预览/ })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/projects/doc_studio_v0/assets", expect.objectContaining({ method: "POST" }));
  });

  it("persists before creating a real local export", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "导出作品" }));

    const htmlExport = screen.getByRole("button", { name: "交互式 HTML：生成" });
    fireEvent.click(htmlExport);
    expect(await screen.findByText("真实导出文件已生成")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "下载文件" })).toHaveAttribute("href", "/api/exports/export_test_html/doc_studio_v0.html");
  });

  it("creates a Creation Contract, waits for human confirmation, then opens the completed project", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /诊断并制定计划/ }));
    expect(await screen.findByRole("button", { name: "确认计划并开始创作" })).toBeInTheDocument();
    expect(screen.getByLabelText("已固定的专家 Skills")).toHaveTextContent("design-critic@0.1.0");
    expect(fetch).not.toHaveBeenCalledWith("/api/work-orders/workorder_ui000001/confirm", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "确认计划并开始创作" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/work-orders/workorder_ui000001/confirm", expect.anything()));
    expect(await screen.findByText("生成完成")).toBeInTheDocument();
    expect(screen.getAllByText("让视觉作品在生成之后，继续生长。").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "打开新作品" }));
    expect(await screen.findAllByText("让文章成为一套可编辑的视觉提案")).not.toHaveLength(0);
    expect(fetch).toHaveBeenCalledWith("/api/work-orders", expect.objectContaining({ method: "POST" }));
    expect(fetch).toHaveBeenCalledWith("/api/work-orders/workorder_ui000001/confirm", expect.objectContaining({ method: "POST" }));
    const call = vi.mocked(fetch).mock.calls.find(([path]) => path === "/api/work-orders");
    expect(JSON.parse(String(call?.[1]?.body))).toEqual(expect.objectContaining({ brief: expect.any(String), title: expect.any(String), designPack: expect.objectContaining({ id: expect.any(String), version: expect.any(String) }) }));
  });

  it("shows version history and can restore an earlier snapshot", async () => {
    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const path = String(input);
      if (!init?.method && path === "/api/projects") return new Response(JSON.stringify({ projects: [] }), { status: 200 });
      if (!init?.method && path === "/api/projects/doc_studio_v0") return new Response(JSON.stringify(fixture), { status: 200 });
      if (!init?.method && path.endsWith("/revisions")) return new Response(JSON.stringify({ revisions: [
        { revision: { revisionId: "revision_new", parentRevisionId: "revision_old", createdAt: "2026-08-12T02:00:00.000Z", reason: "edit", patches: [] }, document: fixture },
        { revision: { revisionId: "revision_old", parentRevisionId: null, createdAt: "2026-08-12T01:00:00.000Z", reason: "initial", patches: [] }, document: fixture },
      ] }), { status: 200 });
      if (init?.method === "PUT") {
        const request = JSON.parse(String(init.body)) as { document: typeof fixture };
        return new Response(JSON.stringify({ document: request.document, revision: { revisionId: "revision_restore", parentRevisionId: "revision_new", createdAt: "2026-08-12T03:00:00.000Z", reason: "regenerate", patches: [] } }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "Project not found" }), { status: 404 });
    });
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: /版本/ }));
    expect(await screen.findByText("2 个版本")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "恢复此版本" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/projects/doc_studio_v0", expect.objectContaining({ method: "PUT" })));
  });

  it("duplicates and deletes a page as an explicit local draft", () => {
    render(<App />);
    fireEvent.click(screen.getAllByRole("button", { name: "复制当前页" })[0]!);
    expect(screen.getByRole("button", { name: "第 2 页：封面副本" })).toBeInTheDocument();
    expect(screen.getByText(/1 项页面草稿/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "删除当前页" }));
    expect(screen.queryByRole("button", { name: "第 2 页：封面副本" })).not.toBeInTheDocument();
  });

  it("edits typography, frame and layer order as v0.2 patches with undo", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /title: 让视觉作品/ }));
    fireEvent.change(screen.getByLabelText("字号"), { target: { value: "80" } });
    fireEvent.change(screen.getByLabelText("行距"), { target: { value: "1.4" } });
    fireEvent.change(screen.getByLabelText("元素 x"), { target: { value: "200" } });
    fireEvent.click(screen.getByRole("button", { name: "上移一层" }));
    expect(screen.getByText("4 个 IR patch")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(screen.getByLabelText("元素 x")).toHaveValue(200);
  });

  it("keeps a dirty draft visible until the user opens a completed generation", async () => {
    render(<App />);
    fireEvent.doubleClick(screen.getByRole("button", { name: /title: 让视觉作品/ }));
    fireEvent.change(screen.getByLabelText("文字内容"), { target: { value: "保留我的人工判断" } });
    fireEvent.click(screen.getByRole("button", { name: /诊断并制定计划/ }));
    fireEvent.click(await screen.findByRole("button", { name: "确认计划并开始创作" }));
    expect(await screen.findByText("生成完成")).toBeInTheDocument();
    expect(screen.getAllByText("保留我的人工判断").length).toBeGreaterThan(0);
    expect(screen.getByText("当前作品不会自动被覆盖。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打开新作品" }));
    expect(await screen.findAllByText("让文章成为一套可编辑的视觉提案")).not.toHaveLength(0);
    expect(screen.queryByText("保留我的人工判断")).not.toBeInTheDocument();
  });

  it("presents a conversation-first project, director and result workspace", () => {
    render(<App />);
    expect(screen.getByLabelText("项目导航")).toBeInTheDocument();
    expect(screen.getByLabelText("设计总监对话")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "页面" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "打开编辑面板" })).toBeInTheDocument();
  });

  it("switches result views and opens the inspector only on demand", () => {
    render(<App />);
    const inspector = screen.getByLabelText("作品检查器");
    expect(inspector).not.toHaveClass("is-open");
    fireEvent.click(screen.getByRole("tab", { name: "大纲" }));
    expect(screen.getByText("先看叙事，再看页面")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打开质量检查" }));
    expect(inspector).toHaveClass("is-open");
    fireEvent.click(screen.getByRole("button", { name: "关闭检查器" }));
    expect(inspector).not.toHaveClass("is-open");
  });

  it("shows a clearly labeled first-use example without starting generation", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "新建设计" }));
    expect(screen.getByText("第一次使用？从一个完整示例开始")).toBeInTheDocument();
    expect(screen.getByText("示例只会填入输入框，不代表已经开始生成。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "使用示例需求" }));
    expect(screen.getByLabelText<HTMLTextAreaElement>("项目 Brief").value).toContain("AI 如何改变创作者工作流");
    expect(fetch).not.toHaveBeenCalledWith("/api/work-orders", expect.anything());
    expect(screen.getByText(/清除浏览器 Cookie 后/)).toBeInTheDocument();
  });

  it("polls a bounded job, exposes all explicit stages and supports cancellation", async () => {
    let poll = 0;
    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const path = String(input);
      const now = "2026-08-14T01:00:00.000Z";
      if (init?.method === "POST" && path === "/api/work-orders") return new Response(JSON.stringify({ workflow: workflowFixture() }), { status: 201 });
      if (init?.method === "POST" && path === "/api/work-orders/workorder_ui000001/confirm") return new Response(JSON.stringify({ workflow: workflowFixture("confirmed", "job_queued0001"), job: { jobId: "job_queued0001", status: "queued", createdAt: now, updatedAt: now } }), { status: 202 });
      if (init?.method === "POST" && path.endsWith("/cancel")) return new Response(JSON.stringify({ job: { jobId: "job_queued0001", status: "cancelled", createdAt: now, updatedAt: now } }), { status: 200 });
      if (!init?.method && path === "/api/generation-jobs/job_queued0001") {
        const status = (["analyzing", "generating", "validating"] as const)[Math.min(poll++, 2)]!;
        return new Response(JSON.stringify({ job: { jobId: "job_queued0001", status, createdAt: now, updatedAt: now } }), { status: 200 });
      }
      if (!init?.method && path === "/api/projects") return new Response(JSON.stringify({ projects: [] }), { status: 200 });
      if (!init?.method && path.endsWith("/revisions")) return new Response(JSON.stringify({ revisions: [] }), { status: 200 });
      return new Response(JSON.stringify({ error: "Project not found" }), { status: 404 });
    });
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /诊断并制定计划/ }));
    fireEvent.click(await screen.findByRole("button", { name: "确认计划并开始创作" }));
    expect(await screen.findByText("已排队")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消生成" }));
    expect(await screen.findByText("已取消")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/generation-jobs/job_queued0001/cancel", expect.objectContaining({ method: "POST" }));
  });

  it("restores only the recent job id after refresh and never stores brief content", async () => {
    window.localStorage.setItem("opendesign.studio.active-generation-job", "job_restore_001");
    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const path = String(input);
      if (path === "/api/generation-jobs/job_restore_001") return new Response(JSON.stringify({ job: { jobId: "job_restore_001", status: "completed", createdAt: "2026-08-14T01:00:00.000Z", updatedAt: "2026-08-14T01:00:05.000Z", projectId: generatedDocument.documentId } }), { status: 200 });
      if (path === "/api/projects") return new Response(JSON.stringify({ projects: [] }), { status: 200 });
      return new Response(JSON.stringify({ error: "Project not found" }), { status: 404 });
    });
    render(<App />);
    expect(await screen.findByText("生成完成")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/generation-jobs/job_restore_001", expect.any(Object));
    expect(JSON.stringify(window.localStorage)).not.toContain("把文章或提案");
  });

  it.each([
    [429, { error: { code: "rate_limited", message: "too many" } }, "当前任务已达上限"],
    [503, { error: { code: "provider_unavailable", message: "missing provider" } }, "生成服务暂未配置"],
    [422, { error: { code: "invalid_input", message: "brief too short" } }, "需求还不够完整"],
  ])("explains generation HTTP failures with an actionable state", async (status, payload, expected) => {
    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const path = String(input);
      if (init?.method === "POST" && path === "/api/work-orders") return status === 422 ? new Response(JSON.stringify(payload), { status }) : new Response(JSON.stringify({ workflow: workflowFixture() }), { status: 201 });
      if (init?.method === "POST" && path === "/api/work-orders/workorder_ui000001/confirm") return new Response(JSON.stringify(payload), { status });
      if (path === "/api/projects") return new Response(JSON.stringify({ projects: [] }), { status: 200 });
      return new Response(JSON.stringify({ error: "Project not found" }), { status: 404 });
    });
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /诊断并制定计划/ }));
    const confirm = await screen.findByRole("button", { name: "确认计划并开始创作" }).catch(() => null);
    if (confirm) fireEvent.click(confirm);
    expect(await screen.findByText(expected)).toBeInTheDocument();
  });

  it("rejects a malformed completed job response instead of opening an unknown project", async () => {
    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const path = String(input);
      if (init?.method === "POST" && path === "/api/work-orders") return new Response(JSON.stringify({ workflow: workflowFixture() }), { status: 201 });
      if (init?.method === "POST" && path === "/api/work-orders/workorder_ui000001/confirm") return new Response(JSON.stringify({ workflow: workflowFixture("confirmed", "job_bad"), job: { jobId: "job_bad", status: "completed", createdAt: "2026-08-14T01:00:00.000Z", updatedAt: "2026-08-14T01:00:01.000Z" } }), { status: 202 });
      if (path === "/api/projects") return new Response(JSON.stringify({ projects: [] }), { status: 200 });
      return new Response(JSON.stringify({ error: "Project not found" }), { status: 404 });
    });
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /诊断并制定计划/ }));
    fireEvent.click(await screen.findByRole("button", { name: "确认计划并开始创作" }));
    expect(await screen.findByText("生成任务没有完成")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打开新作品" })).not.toBeInTheDocument();
  });

  it("renders a terminal job failure without changing the open project", async () => {
    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const path = String(input);
      if (init?.method === "POST" && path === "/api/work-orders") return new Response(JSON.stringify({ workflow: workflowFixture() }), { status: 201 });
      if (init?.method === "POST" && path === "/api/work-orders/workorder_ui000001/confirm") return new Response(JSON.stringify({ workflow: workflowFixture("confirmed", "job_failed0001"), job: { jobId: "job_failed0001", status: "failed", createdAt: "2026-08-14T01:00:00.000Z", updatedAt: "2026-08-14T01:00:03.000Z", error: { code: "generation_internal_failure", message: "validation stopped", retryable: true } } }), { status: 202 });
      if (path === "/api/projects") return new Response(JSON.stringify({ projects: [] }), { status: 200 });
      return new Response(JSON.stringify({ error: "Project not found" }), { status: 404 });
    });
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /诊断并制定计划/ }));
    fireEvent.click(await screen.findByRole("button", { name: "确认计划并开始创作" }));
    expect(await screen.findByText("生成失败")).toBeInTheDocument();
    expect(screen.getByText("validation stopped")).toBeInTheDocument();
    expect(screen.getAllByText("让视觉作品在生成之后，继续生长。").length).toBeGreaterThan(0);
  });

  it("distinguishes an offline submit from provider and input failures", async () => {
    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const path = String(input);
      if (init?.method === "POST" && path === "/api/work-orders") throw new TypeError("offline");
      if (path === "/api/projects") return new Response(JSON.stringify({ projects: [] }), { status: 200 });
      return new Response(JSON.stringify({ error: "Project not found" }), { status: 404 });
    });
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /诊断并制定计划/ }));
    expect(await screen.findByText("网络已断开")).toBeInTheDocument();
    expect(screen.getByText("检查网络后恢复任务")).toBeInTheDocument();
  });
});
