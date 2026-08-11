import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
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

  it("records text edits as Scene IR patches", () => {
    render(<App />);

    const title = screen.getByRole("button", { name: /title: 让视觉作品/ });
    fireEvent.doubleClick(title);
    const editor = screen.getByLabelText("文字内容");
    fireEvent.change(editor, { target: { value: "让每一次修改，都有迹可循。" } });

    expect(screen.getAllByText("让每一次修改，都有迹可循。").length).toBeGreaterThan(0);
    expect(screen.getByText("1 个 IR patch")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存修订" }));
    expect(screen.getByText("已存为本地修订")).toBeInTheDocument();
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

  it("runs the local export mock without uploading", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "导出作品" }));

    const htmlExport = screen.getByRole("button", { name: "交互式 HTML：生成" });
    fireEvent.click(htmlExport);
    expect(screen.getByRole("button", { name: "交互式 HTML：处理中" })).toBeDisabled();
    expect(await screen.findByText("本地模拟文件已生成", {}, { timeout: 1500 })).toBeInTheDocument();
  });
});
