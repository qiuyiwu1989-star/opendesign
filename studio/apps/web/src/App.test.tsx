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
    expect(await screen.findByRole("button", { name: /image: sample/ })).toBeInTheDocument();
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
});
