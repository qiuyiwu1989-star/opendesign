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

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input);
    if (init?.method === "PUT") {
      const request = JSON.parse(String(init.body)) as { document: typeof fixture };
      return new Response(JSON.stringify({ document: request.document, revision: { revisionId: "revision_test", parentRevisionId: null, createdAt: new Date().toISOString(), reason: "edit", patches: [] }, persisted: true }), { status: 200 });
    }
    if (init?.method === "POST" && path.endsWith("/generate")) return new Response(JSON.stringify({ document: generatedDocument, storyline: [], generator: "local-rules-v0" }), { status: 201 });
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
    expect(await screen.findByText("安全导入作品")).toBeInTheDocument();
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

  it("generates a new six-page project from the Brief", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /生成新项目/ }));

    expect(await screen.findAllByText("让文章成为一套可编辑的视觉提案")).not.toHaveLength(0);
    expect(fetch).toHaveBeenCalledWith("/api/projects/generate", expect.objectContaining({ method: "POST" }));
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

  it("previews AI regeneration conflicts instead of replacing a dirty draft", async () => {
    render(<App />);
    fireEvent.doubleClick(screen.getByRole("button", { name: /title: 让视觉作品/ }));
    fireEvent.change(screen.getByLabelText("文字内容"), { target: { value: "保留我的人工判断" } });
    fireEvent.click(screen.getByRole("button", { name: /生成新项目/ }));
    expect(await screen.findByRole("alertdialog", { name: "AI 重新生成冲突预览" })).toBeInTheDocument();
    expect(screen.getAllByText("保留我的人工判断").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "保留当前草稿" }));
    expect(screen.queryByRole("alertdialog", { name: "AI 重新生成冲突预览" })).not.toBeInTheDocument();
  });
});
