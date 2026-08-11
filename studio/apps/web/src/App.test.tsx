import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input);
    if (init?.method === "PUT") {
      return new Response(JSON.stringify({ persisted: true }), { status: 200 });
    }
    if (init?.method === "POST" && path.endsWith("/exports")) {
      const kind = JSON.parse(String(init.body)) as { kind: "html" | "png" | "pptx" };
      return new Response(JSON.stringify({
        exportId: `export_test_${kind.kind}`,
        kind: kind.kind,
        renderer: "test-renderer",
        files: [{ name: `doc_studio_v0.${kind.kind}`, downloadUrl: `/api/exports/export_test_${kind.kind}/doc_studio_v0.${kind.kind}` }],
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

  it("locates QA issues and exposes safe fixes", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: /QA/ }));

    fireEvent.click(screen.getByText("正文接近安全行数上限，建议精简 12–18 个字。"));
    expect(screen.getAllByText("漂亮截图，不等于可用作品。").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "安全修复" }));
    expect(screen.getByText("2 项需要确认")).toBeInTheDocument();
    expect(screen.getByText("1 个 IR patch")).toBeInTheDocument();
  });

  it("persists before creating a real local export", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "导出作品" }));

    const htmlExport = screen.getByRole("button", { name: "交互式 HTML：生成" });
    fireEvent.click(htmlExport);
    expect(await screen.findByText("真实导出文件已生成")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "下载文件" })).toHaveAttribute("href", "/api/exports/export_test_html/doc_studio_v0.html");
  });
});
