import { parse } from "parse5";
import {
  HTML_IMPORT_RESULT_VERSION,
  STRUCTURED_HTML_ATTRIBUTES,
  STUDIO_SCHEMA_VERSION,
  validateHtmlImportResult,
  validateSceneDocument,
  validateStructuredHtmlContract,
  type DocumentProvenance,
  type EditableCapability,
  type ElementRole,
  type Frame,
  type HtmlImportDiagnostic,
  type HtmlImportDiagnosticCode,
  type HtmlImportResult,
  type Scene,
  type SceneDocument,
  type SceneElement,
  type StructuredHtmlContract,
  type StructuredHtmlElementDeclaration,
} from "@opendesign/studio-contracts";
import { designDirections, getDesignPack } from "@opendesign/studio-design-packs/catalog";

type HtmlAttribute = { name: string; value: string };
type HtmlNode = {
  nodeName: string;
  tagName?: string;
  attrs?: HtmlAttribute[];
  childNodes?: HtmlNode[];
  value?: string;
  parentNode?: HtmlNode;
  sourceCodeLocation?: { startLine?: number; startCol?: number };
};

export type StructuredHtmlImportInput = {
  html: string;
  provenance: DocumentProvenance;
};

const ATTRIBUTE = STRUCTURED_HTML_ATTRIBUTES;
const CONTRACT_TAGS = new Set(["main", "article", "div"]);
const SCENE_TAGS = new Set(["section", "article", "div"]);
const ELEMENT_TAGS = new Set(["h1", "h2", "h3", "p", "span", "img", "div", "figure", "blockquote"]);
const BLOCKED_TAGS = new Set(["script", "style", "iframe", "object", "embed", "link", "base", "form"]);
const URL_ATTRIBUTES = new Set(["src", "href", "action", "poster", "xlink:href"]);
const CAPABILITIES = new Set<EditableCapability>(["text", "typography", "asset", "frame", "order"]);
const ROLES = new Set<ElementRole>(["eyebrow", "title", "body", "caption", "metric", "quote", "image", "shape"]);
const SAFE_ID = /^[a-z][a-z0-9_-]{2,63}$/;

const KNOWN_OD_ATTRIBUTES = new Set<string>(Object.values(ATTRIBUTE));
const PASSIVE_ATTRIBUTES = new Set(["class", "id", "lang", "dir", "style", "alt", "src", "charset", "name", "content", "type", "data-element-id", "data-element-type", "data-scene-id"]);

function attributes(node: HtmlNode): Map<string, string> {
  return new Map((node.attrs ?? []).map((attribute) => [attribute.name.toLowerCase(), attribute.value]));
}

function descendants(node: HtmlNode): HtmlNode[] {
  const result: HtmlNode[] = [];
  const visit = (candidate: HtmlNode): void => {
    for (const child of candidate.childNodes ?? []) {
      result.push(child);
      visit(child);
    }
  };
  visit(node);
  return result;
}

function textContent(node: HtmlNode): string {
  if (node.nodeName === "#text") return node.value ?? "";
  return (node.childNodes ?? []).map(textContent).join("").replace(/\s+/gu, " ").trim();
}

function sourcePath(node: HtmlNode): string {
  const line = node.sourceCodeLocation?.startLine;
  const column = node.sourceCodeLocation?.startCol;
  return line === undefined ? `/${node.tagName ?? node.nodeName}` : `/html:${line}:${column ?? 1}/${node.tagName ?? node.nodeName}`;
}

function isSafeAssetUrl(value: string): boolean {
  return /^asset:\/\/[a-z][a-z0-9_./-]*$/i.test(value) || /^\/api\/assets\/[a-z][a-z0-9_-]{2,63}\/asset_[a-z0-9_]+\.(?:png|jpg)$/i.test(value);
}

function number(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function integer(value: string | undefined): number | undefined {
  const parsed = number(value);
  return parsed !== undefined && Number.isInteger(parsed) ? parsed : undefined;
}

function frame(value: string | undefined): Frame | undefined {
  if (!value) return undefined;
  const parts = value.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return undefined;
  return { x: parts[0]!, y: parts[1]!, width: parts[2]!, height: parts[3]! };
}

function focalPoint(value: string | undefined): { x: number; y: number } | undefined {
  if (!value) return undefined;
  const parts = value.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 2 || parts.some((part) => !Number.isFinite(part))) return undefined;
  return { x: parts[0]!, y: parts[1]! };
}

function list(value: string | undefined): string[] {
  return value?.split(/[\s,]+/u).map((item) => item.trim()).filter(Boolean) ?? [];
}

export function importStructuredHtml(input: StructuredHtmlImportInput): HtmlImportResult {
  const diagnostics: HtmlImportDiagnostic[] = [];
  let blockedNodeCount = 0;
  let diagnosticSequence = 0;
  const report = (code: HtmlImportDiagnosticCode, severity: HtmlImportDiagnostic["severity"], disposition: HtmlImportDiagnostic["disposition"], message: string, node: HtmlNode, refs: { sceneId?: string; elementId?: string } = {}): void => {
    diagnosticSequence += 1;
    diagnostics.push({ diagnosticId: `diag_${diagnosticSequence}`, code, severity, disposition, message, sourcePath: sourcePath(node), nodeName: node.tagName ?? node.nodeName, ...refs });
  };

  const htmlBytes = Buffer.byteLength(input.html, "utf8");
  if (htmlBytes === 0 || htmlBytes > 512 * 1024) {
    const result: HtmlImportResult = {
      importVersion: HTML_IMPORT_RESULT_VERSION,
      status: "rejected",
      diagnostics: [{ diagnosticId: "diag_1", code: "import.empty", severity: "error", disposition: "blocked", message: htmlBytes === 0 ? "HTML is empty" : "HTML exceeds 512 KiB", sourcePath: "/html" }],
      security: { untrustedInput: true, executableContent: "blocked", blockedNodeCount: 0 },
    };
    return result;
  }

  const tree = parse(input.html, { sourceCodeLocationInfo: true }) as unknown as HtmlNode;
  const nodes = descendants(tree).filter((node) => node.tagName !== undefined);

  for (const node of nodes) {
    const tag = node.tagName!;
    const attrs = attributes(node);
    if (BLOCKED_TAGS.has(tag)) {
      blockedNodeCount += 1;
      report("security.script_blocked", "error", "blocked", `<${tag}> is never executed or imported`, node);
    }
    for (const [name, value] of attrs) {
      if (name.startsWith("on")) {
        blockedNodeCount += 1;
        report("security.event_handler_blocked", "error", "blocked", `Event handler ${name} was blocked`, node);
      }
      if (!BLOCKED_TAGS.has(tag) && URL_ATTRIBUTES.has(name) && !(tag === "img" && name === "src" && isSafeAssetUrl(value))) {
        blockedNodeCount += 1;
        report("security.url_blocked", "error", "blocked", `URL attribute ${name} is outside the asset allowlist`, node);
      }
      if (name.startsWith("data-od-") && !KNOWN_OD_ATTRIBUTES.has(name)) {
        report("node.unsupported", "warning", "unsupported", `Unknown OpenDesign attribute ${name} was ignored`, node);
      } else if (!name.startsWith("data-od-") && !PASSIVE_ATTRIBUTES.has(name)) {
        report("node.unsupported", "warning", "unsupported", `Attribute ${name} was ignored`, node);
      }
    }
  }

  const contractNodes = nodes.filter((node) => attributes(node).has(ATTRIBUTE.contractVersion));
  const root = contractNodes[0];
  if (!root || contractNodes.length !== 1 || !CONTRACT_TAGS.has(root.tagName!)) {
    const anchor = root ?? tree;
    report("design_pack.pin_missing", "error", "blocked", "Exactly one supported contract root is required", anchor);
    return rejected(diagnostics, blockedNodeCount);
  }

  const rootAttributes = attributes(root);
  const documentId = rootAttributes.get(ATTRIBUTE.documentId) ?? "";
  const title = rootAttributes.get(ATTRIBUTE.documentTitle) ?? "";
  const packId = rootAttributes.get(ATTRIBUTE.designPackId) ?? "";
  const packVersion = rootAttributes.get(ATTRIBUTE.designPackVersion) ?? "";
  const pack = getDesignPack(packId, packVersion);
  if (!pack) report("design_pack.pin_missing", "error", "blocked", `Design Pack ${packId || "(missing)"}@${packVersion || "(missing)"} is unavailable`, root);
  if (!SAFE_ID.test(documentId)) report("id.missing", "error", "blocked", "Contract root requires a valid document ID", root);
  if (!title.trim()) report("scene_ir.invalid", "error", "blocked", "Contract root requires data-od-title", root);

  const sceneNodes = descendants(root).filter((node) => attributes(node).has(ATTRIBUTE.sceneId));
  const scenes: Scene[] = [];
  const declarations: StructuredHtmlContract["scenes"] = [];

  for (const sceneNode of sceneNodes) {
    const sceneAttributes = attributes(sceneNode);
    const sceneId = sceneAttributes.get(ATTRIBUTE.sceneId) ?? "";
    const order = integer(sceneAttributes.get(ATTRIBUTE.sceneOrder));
    const pageRole = sceneAttributes.get(ATTRIBUTE.pageRole) ?? "";
    const layout = sceneAttributes.get(ATTRIBUTE.layout) ?? "";
    const sceneTitle = sceneAttributes.get(ATTRIBUTE.documentTitle) ?? pageRole;
    const purpose = sceneAttributes.get(ATTRIBUTE.scenePurpose) ?? pageRole;
    if (!SCENE_TAGS.has(sceneNode.tagName!)) report("node.unsupported", "error", "unsupported", `Tag <${sceneNode.tagName}> cannot declare a scene`, sceneNode, { sceneId });
    if (!SAFE_ID.test(sceneId)) report("id.missing", "error", "blocked", "Scene requires a valid stable ID", sceneNode);
    if (order === undefined || !pageRole || !layout) report("scene_ir.invalid", "error", "blocked", "Scene order, page role and layout are required", sceneNode, { sceneId });

    const elementNodes = descendants(sceneNode).filter((node) => {
      const parentScene = closestScene(node);
      return parentScene === sceneNode && attributes(node).has(ATTRIBUTE.elementId);
    });
    const elements: SceneElement[] = [];
    const elementDeclarations: StructuredHtmlElementDeclaration[] = [];

    for (const elementNode of elementNodes) {
      const elementAttributes = attributes(elementNode);
      const elementId = elementAttributes.get(ATTRIBUTE.elementId) ?? "";
      const roleValue = elementAttributes.get(ATTRIBUTE.role) ?? "";
      const role = ROLES.has(roleValue as ElementRole) ? roleValue as ElementRole : undefined;
      const parsedFrame = frame(elementAttributes.get(ATTRIBUTE.frame));
      const capabilityValues = list(elementAttributes.get(ATTRIBUTE.editableCapabilities));
      const capabilities = capabilityValues.filter((value): value is EditableCapability => CAPABILITIES.has(value as EditableCapability));
      const sourceIds = list(elementAttributes.get(ATTRIBUTE.sourceIds));
      const pptx = elementAttributes.get(ATTRIBUTE.exportPptx);
      if (!ELEMENT_TAGS.has(elementNode.tagName!)) report("node.unsupported", "error", "unsupported", `Tag <${elementNode.tagName}> cannot declare an element`, elementNode, { sceneId, elementId });
      if (!SAFE_ID.test(elementId)) report("id.missing", "error", "blocked", "Element requires a valid stable ID", elementNode, { sceneId });
      if (!role) report("role.unsupported", "error", "blocked", `Role ${roleValue || "(missing)"} is unsupported`, elementNode, { sceneId, elementId });
      if (!parsedFrame) report("scene_ir.invalid", "error", "blocked", "Element requires data-od-frame=x,y,width,height", elementNode, { sceneId, elementId });
      if (capabilities.length !== capabilityValues.length) report("capability.invalid", "error", "blocked", "One or more editable capabilities are invalid", elementNode, { sceneId, elementId });
      if (!sourceIds.length) report("provenance.missing", "error", "blocked", "Element requires at least one source ID", elementNode, { sceneId, elementId });
      if (pptx !== "native" && pptx !== "raster" && pptx !== "omitted") report("scene_ir.invalid", "error", "blocked", "Element requires a valid PPTX export hint", elementNode, { sceneId, elementId });
      if (!role || !parsedFrame || !SAFE_ID.test(elementId) || !sourceIds.length || (pptx !== "native" && pptx !== "raster" && pptx !== "omitted")) continue;

      const type = role === "image" ? "image" : role === "shape" ? "shape" : role === "metric" ? "metric" : role === "quote" ? "quote" : "text";
      const base: SceneElement = {
        id: elementId,
        type,
        role,
        frame: parsedFrame,
        editable: capabilities.length > 0,
        editableCapabilities: capabilities,
        exportHint: { html: "native", pptx },
        sourceIds,
      };
      const fontSize = number(elementAttributes.get(ATTRIBUTE.fontSize));
      const fontWeight = integer(elementAttributes.get(ATTRIBUTE.fontWeight));
      const lineHeight = number(elementAttributes.get(ATTRIBUTE.lineHeight));
      const zIndex = integer(elementAttributes.get(ATTRIBUTE.zIndex));
      const focal = focalPoint(elementAttributes.get(ATTRIBUTE.focalPoint));
      const align = elementAttributes.get(ATTRIBUTE.align);
      const imageFit = elementAttributes.get(ATTRIBUTE.imageFit);
      if (type === "image") {
        const src = elementAttributes.get("src") ?? "";
        const alt = elementAttributes.get("alt") ?? "";
        if (!isSafeAssetUrl(src) || !alt.trim()) report("security.url_blocked", "error", "blocked", "Images require an allowlisted asset URL and non-empty alt text", elementNode, { sceneId, elementId });
        base.assetSrc = src;
        base.alt = alt;
      } else if (type === "shape") {
        base.fill = elementAttributes.get(ATTRIBUTE.fill) ?? "surface";
      } else {
        base.content = textContent(elementNode);
      }
      if (fontSize !== undefined) base.fontSize = fontSize;
      if (fontWeight !== undefined) base.fontWeight = fontWeight;
      if (lineHeight !== undefined) base.lineHeight = lineHeight;
      if (zIndex !== undefined) base.zIndex = zIndex;
      if (focal !== undefined) base.focalPoint = focal;
      const fontFamily = elementAttributes.get(ATTRIBUTE.fontFamily);
      const color = elementAttributes.get(ATTRIBUTE.color);
      if (fontFamily) base.fontFamily = fontFamily;
      if (color) base.color = color;
      if (align === "left" || align === "center" || align === "right") base.align = align;
      if (imageFit === "contain" || imageFit === "cover" || imageFit === "stretch") base.imageFit = imageFit;
      elements.push(base);
      elementDeclarations.push({ id: elementId, tagName: elementNode.tagName! as StructuredHtmlElementDeclaration["tagName"], role, editableCapabilities: capabilities, exportHint: { html: "native", pptx }, sourceIds });
    }

    for (const candidate of descendants(sceneNode)) {
      if (!candidate.tagName || BLOCKED_TAGS.has(candidate.tagName)) continue;
      const candidateAttributes = attributes(candidate);
      if (closestScene(candidate) === sceneNode && !candidateAttributes.has(ATTRIBUTE.sceneId)) {
        if (!ELEMENT_TAGS.has(candidate.tagName)) {
          report("node.unsupported", "warning", "unsupported", `Node <${candidate.tagName}> is outside the Structured HTML allowlist`, candidate, { sceneId });
        } else if (!candidateAttributes.has(ATTRIBUTE.elementId)) {
          report("id.missing", "warning", "unsupported", `Content node <${candidate.tagName}> has no stable element ID`, candidate, { sceneId });
        }
      }
    }

    if (order !== undefined && sceneId && pageRole && layout) {
      scenes.push({ id: sceneId, order, title: sceneTitle, purpose, layout, elements });
      declarations.push({ id: sceneId, order, pageRole, layout, elements: elementDeclarations });
    }
  }

  const manifest: StructuredHtmlContract = {
    contractVersion: "0.1.0",
    documentId,
    title,
    canvas: { width: 1600, height: 900, unit: "logical-px" },
    designPack: { id: packId, version: packVersion },
    provenance: input.provenance,
    scenes: declarations,
  };
  const manifestValidation = validateStructuredHtmlContract(manifest);
  if (!manifestValidation.ok) {
    for (const issue of manifestValidation.issues) {
      const code: HtmlImportDiagnosticCode = issue.code === "id.duplicate" ? "id.duplicate" : issue.code === "provenance.source_missing" ? "provenance.missing" : "scene_ir.invalid";
      diagnostics.push({ diagnosticId: `diag_${++diagnosticSequence}`, code, severity: "error", disposition: "blocked", message: issue.message, sourcePath: issue.path });
    }
  }

  if (!pack) return rejected(diagnostics, blockedNodeCount);
  const document: SceneDocument = {
    schemaVersion: STUDIO_SCHEMA_VERSION,
    documentId,
    title,
    canvas: { width: 1600, height: 900, unit: "logical-px" },
    directions: designDirections(pack.id),
    selectedDirectionId: `direction_${pack.id}`,
    scenes,
    designPack: { id: pack.id, version: pack.version },
    provenance: structuredClone(input.provenance),
  };
  const documentValidation = validateSceneDocument(document);
  if (!documentValidation.ok) {
    for (const issue of documentValidation.issues) diagnostics.push({ diagnosticId: `diag_${++diagnosticSequence}`, code: issue.code === "id.duplicate" ? "id.duplicate" : "scene_ir.invalid", severity: "error", disposition: "blocked", message: issue.message, sourcePath: issue.path });
  }

  const fatal = diagnostics.some((diagnostic) => diagnostic.severity === "error");
  const result: HtmlImportResult = {
    importVersion: HTML_IMPORT_RESULT_VERSION,
    status: fatal ? "rejected" : diagnostics.length ? "partial" : "accepted",
    ...(fatal ? {} : { document }),
    diagnostics,
    security: { untrustedInput: true, executableContent: "blocked", blockedNodeCount },
  };
  const validated = validateHtmlImportResult(result);
  return validated.ok ? result : rejected([...diagnostics, ...validated.issues.map((issue, index) => ({ diagnosticId: `diag_contract_${index + 1}`, code: "scene_ir.invalid" as const, severity: "error" as const, disposition: "blocked" as const, message: issue.message, sourcePath: issue.path }))], blockedNodeCount);
}

function closestScene(node: HtmlNode): HtmlNode | undefined {
  let current = node.parentNode;
  while (current) {
    if (attributes(current).has(ATTRIBUTE.sceneId)) return current;
    current = current.parentNode;
  }
  return undefined;
}

function rejected(diagnostics: HtmlImportDiagnostic[], blockedNodeCount: number): HtmlImportResult {
  return { importVersion: HTML_IMPORT_RESULT_VERSION, status: "rejected", diagnostics: diagnostics.length ? diagnostics : [{ diagnosticId: "diag_empty", code: "import.empty", severity: "error", disposition: "blocked", message: "No importable content", sourcePath: "/html" }], security: { untrustedInput: true, executableContent: "blocked", blockedNodeCount } };
}
