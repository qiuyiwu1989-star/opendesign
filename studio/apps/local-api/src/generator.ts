import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import type { DesignPackPin, SceneDocument, SceneElement } from "@opendesign/studio-contracts";
import { designDirections, getDesignPack } from "@opendesign/studio-design-packs/catalog";
import fixture from "../../../packages/contracts/fixtures/proposal-v0.json" with { type: "json" };

export type StorylineItem = { sceneId: string; order: number; title: string; purpose: string; headline: string };
export type GeneratedProject = { document: SceneDocument; storyline: StorylineItem[]; generator: "local-rules-v0" };

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sentences(brief: string): string[] {
  const normalized = clean(brief);
  return (normalized.match(/[^。！？!?；;]+[。！？!?；;]?/gu) ?? [normalized])
    .map((item) => item.trim())
    .filter(Boolean);
}

function trimSentence(value: string, maximum: number): string {
  const normalized = value.replace(/[。！？!?；;]+$/u, "");
  return [...normalized].length <= maximum ? normalized : `${[...normalized].slice(0, maximum - 1).join("")}…`;
}

function text(element: SceneElement, content: string): SceneElement {
  return element.content === undefined ? element : { ...element, content };
}

export function generateProjectFromBrief(input: { brief: string; documentId?: string; title?: string; designPack?: DesignPackPin }): GeneratedProject {
  const brief = clean(input.brief);
  if (brief.length < 12) throw new Error("Brief 至少需要 12 个字符");
  if (brief.length > 12_000) throw new Error("Brief 不能超过 12,000 个字符");
  const parts = sentences(brief);
  const thesis = trimSentence(parts[0] ?? brief, 30);
  const evidence = trimSentence(parts[1] ?? parts[0] ?? brief, 42);
  const detail = trimSentence(parts.slice(2).join(" ") || brief, 64);
  const title = clean(input.title ?? "") || thesis;
  const documentId = input.documentId ?? `project_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`;
  const packPin = input.designPack ?? { id: "executive-proposal-cn", version: "1.0.0" };
  const pack = getDesignPack(packPin.id, packPin.version);
  if (!pack) throw new Error(`Unknown Design Pack ${packPin.id}@${packPin.version}`);
  const base = structuredClone(fixture) as SceneDocument;

  const sceneCopy: Array<{ title: string; purpose: string; contentById: Record<string, string> }> = [
    { title: "主张", purpose: "用一句话建立这份作品的核心判断。", contentById: { cover_title: title, cover_body: `从 Brief 出发，把“${thesis}”转化为一套可以继续编辑的视觉叙事。` } },
    { title: "问题", purpose: "说明为什么现在值得行动。", contentById: { problem_title: "真正要解决的，不只是第一次生成。", problem_body: `${evidence}。作品还需要能够修改、检查，并继续交付。`, problem_metric: "1 个改动\n≠\n整份重来" } },
    { title: "洞察", purpose: "提炼贯穿整份提案的关键判断。", contentById: { thesis_quote: `${thesis}，也要让之后每一次修改都有依据。`, thesis_body: detail } },
    { title: "方法", purpose: "解释内容、设计与输出如何形成闭环。", contentById: { system_title: "一份 Scene IR，连接内容、设计与真实输出。" } },
    { title: "可编辑性", purpose: "把错误定位为可以操作的对象。", contentById: { edit_title: "每一次修改，都应该回到具体页面与元素。" } },
    { title: "下一步", purpose: "给出可以立即开始的行动路径。", contentById: { roadmap_title: "先生成一个可用版本，再持续把它变好。", roadmap_body: `${detail}。下一步从真实内容开始验证。` } },
  ];

  const scenes = base.scenes.map((scene, sceneIndex) => {
    const copy = sceneCopy[sceneIndex]!;
    return {
      ...scene,
      title: copy.title,
      purpose: copy.purpose,
      elements: scene.elements.map((element) => copy.contentById[element.id] === undefined ? element : text(element, copy.contentById[element.id]!)),
    };
  });
  const directions = designDirections(pack.id);
  const document: SceneDocument = {
    ...base,
    documentId,
    title,
    directions,
    selectedDirectionId: `direction_${pack.id}`,
    scenes,
    designPack: { id: pack.id, version: pack.version },
    provenance: {
      sources: [{ sourceId: "source_brief", type: "brief", title: "Studio Brief", contentHash: `sha256:${createHash("sha256").update(brief).digest("hex")}` }],
      generatedBy: { kind: "human", name: "studio-local-generator", version: "0.3.0" },
    },
  };
  return {
    document,
    generator: "local-rules-v0",
    storyline: scenes.map((scene) => ({
      sceneId: scene.id,
      order: scene.order,
      title: scene.title,
      purpose: scene.purpose,
      headline: scene.elements.find((element) => element.role === "title" || element.role === "quote")?.content ?? scene.title,
    })),
  };
}
