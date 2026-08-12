import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { controlRoomSnapshot, emptyControlRoomSnapshot } from "./test/fixtures";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function navigate(name: string) {
  const navigation = screen.getByRole("navigation");
  const destination = within(navigation).getByRole("button", { name: new RegExp(name, "i") });
  fireEvent.click(destination);
  return destination;
}

describe("OpenDesign Control Room Phase 1", () => {
  it("does not misrepresent fixture mode as an authenticated operator", () => {
    render(<App initialSnapshot={controlRoomSnapshot} initialSession={{ kind: "unauthenticated" }}/>);
    expect(screen.getByText("未登录")).toBeInTheDocument();
    expect(screen.queryByText("使用 GitHub 登录")).not.toBeInTheDocument();
  });

  it("requires the local admin login before loading the control room", async () => {
    render(<App initialSession={{ kind: "unauthenticated" }}/>);
    expect(screen.getByRole("heading", { name: "进入设计资源控制室" })).toBeInTheDocument();
    expect(screen.getByLabelText("账号")).toHaveValue("admin");
    expect(screen.getByLabelText("密码")).toHaveAttribute("type", "password");
    expect(screen.queryByRole("heading", { name: "今天，先做这三件事" })).not.toBeInTheDocument();
  });

  it("exposes six keyboard-operable destinations and identifies the current screen", () => {
    render(<App initialSnapshot={controlRoomSnapshot}/>);

    const navigation = screen.getByRole("navigation");
    const destinations = ["Today", "质量决策", "统一审核", "设计资源", "管线运行", "GitHub Sync"];
    for (const name of destinations) {
      expect(within(navigation).getByRole("button", { name: new RegExp(name, "i") })).toBeEnabled();
    }
    expect(within(navigation).getByRole("button", { name: /Today/i })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("main")).toContainElement(screen.getByRole("heading", { level: 1, name: "今天，先做这三件事" }));

    const sync = navigate("GitHub Sync");
    expect(sync).toHaveAttribute("aria-current", "page");
    expect(within(navigation).getByRole("button", { name: /Today/i })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("heading", { level: 1, name: "看见内容在五层之间的漂移" })).toBeInTheDocument();
  });

  it("shows an auditable AI curation journal with hard spam and ad signals", () => {
    render(<App initialSnapshot={controlRoomSnapshot}/>);
    navigate("质量决策");

    expect(screen.getByRole("heading", { level: 1, name: "每一个收录与拒绝，都留下判断证据" })).toBeInTheDocument();
    const journal = screen.getByRole("list", { name: "每日 AI 决策记录" });
    expect(within(journal).getByRole("listitem")).toHaveTextContent("建议拒绝");
    expect(screen.getAllByText("opendesign-curation-v1.0")).toHaveLength(2);
    expect(screen.getByText("mimo-v2.5")).toBeInTheDocument();
    expect(screen.getByText("垃圾风险")).toBeInTheDocument();
    expect(screen.getByText("广告风险")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "预览确认" })).toBeInTheDocument();
  });

  it("shows the top three actions in their supplied priority order and labels snapshot provenance", () => {
    render(<App initialSnapshot={controlRoomSnapshot}/>);

    expect(screen.getByRole("status")).toHaveTextContent("只读快照");
    const actions = within(screen.getByRole("list", { name: "今日优先行动" })).getAllByRole("listitem");
    expect(actions).toHaveLength(3);
    expect(actions.map((action) => within(action).getByRole("heading", { level: 2 }).textContent)).toEqual([
      "处理不可用源站",
      "定位失败检查点",
      "核对 GitHub 漂移",
    ]);
    expect(actions.every((action) => within(action).getByRole("button", { name: /进入工作区/ }).tabIndex === 0)).toBe(true);
  });

  it("keeps discovery, submission, quality and origin sources in one review list", () => {
    render(<App initialSnapshot={controlRoomSnapshot}/>);
    navigate("统一审核");

    const reviewList = screen.getByRole("list", { name: "统一审核案例" });
    expect(within(reviewList).getAllByRole("listitem")).toHaveLength(4);
    for (const label of ["自动发现", "用户投稿", "质量检查", "源站状态"]) {
      expect(within(reviewList).getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "筛选来源：自动发现" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "筛选来源：自动发现" }));
    expect(within(reviewList).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "筛选来源：自动发现" })).toHaveAttribute("aria-pressed", "true");
  });

  it("renders evidence, curation and origin as independent resource columns", () => {
    render(<App initialSnapshot={controlRoomSnapshot}/>);
    navigate("设计资源");

    const unavailableRow = screen.getByRole("row", { name: /Unavailable Origin/ });
    expect(within(unavailableRow).getByText("E0")).toBeInTheDocument();
    expect(within(unavailableRow).getByText("未审")).toBeInTheDocument();
    expect(within(unavailableRow).getByText("不可用")).toBeInTheDocument();

    const recommendedRow = screen.getByRole("row", { name: /Editorial Systems/ });
    expect(within(recommendedRow).getByText("E3")).toBeInTheDocument();
    expect(within(recommendedRow).getByText("推荐")).toBeInTheDocument();
    expect(within(recommendedRow).getByText("正常")).toBeInTheDocument();
    expect(within(recommendedRow).getByLabelText("资产完整度 100%")).toBeInTheDocument();
  });

  it("shows ordered pipeline checkpoints without an execution or retry control", () => {
    render(<App initialSnapshot={controlRoomSnapshot}/>);
    navigate("管线运行");

    const checkpoints = screen.getAllByRole("listitem").filter((item) => item.closest(".checkpoint-list"));
    expect(checkpoints.map((item) => item.querySelector("strong")?.textContent)).toEqual([
      "Discover",
      "Quality gate",
      "Build",
    ]);
    expect(checkpoints.map((item) => item.textContent)).toEqual([
      expect.stringContaining("完成"),
      expect.stringContaining("失败"),
      expect.stringContaining("待执行"),
    ]);
    expect(screen.queryByRole("button", { name: /^重试|^执行/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "预览重试计划" })).toBeInTheDocument();
  });

  it("shows five read-only sync locations and never offers push, merge, publish or deploy", () => {
    render(<App initialSnapshot={controlRoomSnapshot}/>);
    navigate("GitHub Sync");

    const track = screen.getByRole("list", { name: "同步位置状态" });
    for (const location of ["Database", "Local", "Git", "GitHub", "Public"]) {
      expect(within(track).getByRole("heading", { level: 2, name: location })).toBeInTheDocument();
    }
    expect(within(track).getAllByText("未知").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: "预览 Change Set" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /push|merge|publish|deploy|推送|合并|发布|部署/i })).not.toBeInTheDocument();
  });

  it("opens an explicitly read-only preview instead of mutating a review", () => {
    render(<App initialSnapshot={controlRoomSnapshot}/>);
    navigate("统一审核");

    fireEvent.click(screen.getByRole("button", { name: "预览判断变更" }));
    const dialog = screen.getByRole("dialog", { name: "判断变更集 预览" });
    expect(dialog).toHaveTextContent("PREVIEW · NO WRITE");
    expect(dialog).toHaveTextContent("不会写回");
    expect(dialog).toHaveTextContent("只读预览");
    fireEvent.click(within(dialog).getByRole("button", { name: "关闭预览" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("distinguishes an empty snapshot from unavailable data", () => {
    render(<App initialSnapshot={emptyControlRoomSnapshot}/>);

    expect(screen.getByRole("status")).toHaveTextContent("只读快照");
    expect(screen.getByText("今日队列已清空")).toBeInTheDocument();
    expect(screen.queryByText("控制室快照不可用")).not.toBeInTheDocument();
  });
});
