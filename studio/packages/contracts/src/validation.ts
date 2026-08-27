import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import designPackSchema from "../design-pack.schema.json" with { type: "json" };
import htmlImportResultSchema from "../html-import-result.schema.json" with { type: "json" };
import issueSchema from "../issue.schema.json" with { type: "json" };
import revisionSchema from "../revision.schema.json" with { type: "json" };
import sceneIrSchema from "../scene-ir.schema.json" with { type: "json" };
import structuredHtmlSchema from "../structured-html.schema.json" with { type: "json" };
import type { DesignPack, HtmlImportResult, Revision, SceneDocument, StructuredHtmlContract, StudioIssue } from "./index.js";

export type ContractIssue = {
  source: "schema" | "semantic";
  code: string;
  path: string;
  message: string;
};

export type ValidationSuccess<T> = {
  ok: true;
  value: T;
  issues: readonly [];
};

export type ValidationFailure = {
  ok: false;
  issues: readonly ContractIssue[];
};

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

export class SceneContractError extends Error {
  readonly issues: readonly ContractIssue[];

  constructor(issues: readonly ContractIssue[]) {
    super(`Scene document violates the contract (${issues.length} issue${issues.length === 1 ? "" : "s"})`);
    this.name = "SceneContractError";
    this.issues = issues;
  }
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
ajv.addSchema(sceneIrSchema);
const validateSceneSchema = ajv.getSchema(sceneIrSchema.$id)!;
const validateRevisionSchema = ajv.compile(revisionSchema);
const validateIssueSchema = ajv.compile(issueSchema);
const validateStructuredHtmlSchema = ajv.compile(structuredHtmlSchema);
const validateDesignPackSchema = ajv.compile(designPackSchema);
const validateHtmlImportResultSchema = ajv.compile(htmlImportResultSchema);

function schemaIssues(errors: ErrorObject[] | null | undefined): ContractIssue[] {
  return (errors ?? []).map((error) => ({
    source: "schema",
    code: `schema.${error.keyword}`,
    path: error.instancePath || "/",
    message: error.message ?? `failed ${error.keyword} validation`,
  }));
}

function validateWithSchema<T>(value: unknown, validator: ValidateFunction): ValidationResult<T> {
  if (validator(value)) {
    return { ok: true, value: value as T, issues: [] };
  }

  return { ok: false, issues: schemaIssues(validator.errors) };
}

function semanticIssues(document: SceneDocument): ContractIssue[] {
  const issues: ContractIssue[] = [];
  const ids = new Map<string, string>();

  const registerId = (id: string, path: string): void => {
    const existingPath = ids.get(id);
    if (existingPath !== undefined) {
      issues.push({
        source: "semantic",
        code: "id.duplicate",
        path,
        message: `ID \"${id}\" is already used at ${existingPath}`,
      });
      return;
    }
    ids.set(id, path);
  };

  registerId(document.documentId, "/documentId");

  const directionIds = new Set<string>();
  document.directions.forEach((direction, directionIndex) => {
    const path = `/directions/${directionIndex}/id`;
    registerId(direction.id, path);
    directionIds.add(direction.id);
  });

  if (!directionIds.has(document.selectedDirectionId)) {
    issues.push({
      source: "semantic",
      code: "direction.selected_missing",
      path: "/selectedDirectionId",
      message: `Selected direction \"${document.selectedDirectionId}\" does not exist`,
    });
  }

  const orders = new Map<number, string>();
  document.scenes.forEach((scene, sceneIndex) => {
    const scenePath = `/scenes/${sceneIndex}`;
    registerId(scene.id, `${scenePath}/id`);

    const existingOrder = orders.get(scene.order);
    if (existingOrder !== undefined) {
      issues.push({
        source: "semantic",
        code: "scene.order_duplicate",
        path: `${scenePath}/order`,
        message: `Scene order ${scene.order} is already used at ${existingOrder}`,
      });
    } else {
      orders.set(scene.order, `${scenePath}/order`);
    }

    scene.elements.forEach((element, elementIndex) => {
      const elementPath = `${scenePath}/elements/${elementIndex}`;
      registerId(element.id, `${elementPath}/id`);

      if (element.editableCapabilities !== undefined && !element.editable && element.editableCapabilities.length > 0) {
        issues.push({
          source: "semantic",
          code: "element.capabilities_locked",
          path: `${elementPath}/editableCapabilities`,
          message: "Locked elements cannot declare editable capabilities",
        });
      }

      element.sourceIds?.forEach((sourceId) => {
        if (!document.provenance?.sources.some((source) => source.sourceId === sourceId)) {
          issues.push({
            source: "semantic",
            code: "provenance.source_missing",
            path: `${elementPath}/sourceIds`,
            message: `Element source "${sourceId}" is not declared in document provenance`,
          });
        }
      });

      if (element.frame.x + element.frame.width > document.canvas.width) {
        issues.push({
          source: "semantic",
          code: "frame.horizontal_out_of_bounds",
          path: `${elementPath}/frame`,
          message: `Frame ends at x=${element.frame.x + element.frame.width}, beyond canvas width ${document.canvas.width}`,
        });
      }
      if (element.frame.y + element.frame.height > document.canvas.height) {
        issues.push({
          source: "semantic",
          code: "frame.vertical_out_of_bounds",
          path: `${elementPath}/frame`,
          message: `Frame ends at y=${element.frame.y + element.frame.height}, beyond canvas height ${document.canvas.height}`,
        });
      }

      if (["text", "metric", "quote"].includes(element.type) && !element.content?.trim()) {
        issues.push({
          source: "semantic",
          code: "element.text_content_missing",
          path: `${elementPath}/content`,
          message: `Element type \"${element.type}\" requires non-empty content`,
        });
      }

      if (element.type === "image") {
        if (!element.assetSrc?.trim()) {
          issues.push({
            source: "semantic",
            code: "element.image_source_missing",
            path: `${elementPath}/assetSrc`,
            message: "Image element requires a non-empty assetSrc",
          });
        }
        if (!element.alt?.trim()) {
          issues.push({
            source: "semantic",
            code: "element.image_alt_missing",
            path: `${elementPath}/alt`,
            message: "Image element requires non-empty alt text",
          });
        }
      }
    });
  });

  for (let expectedOrder = 1; expectedOrder <= document.scenes.length; expectedOrder += 1) {
    if (!orders.has(expectedOrder)) {
      issues.push({
        source: "semantic",
        code: "scene.order_gap",
        path: "/scenes",
        message: `Scene orders must be continuous from 1; missing order ${expectedOrder}`,
      });
    }
  }

  return issues;
}

export function validateSceneDocument(value: unknown): ValidationResult<SceneDocument> {
  const schemaResult = validateWithSchema<SceneDocument>(value, validateSceneSchema);
  if (!schemaResult.ok) {
    return schemaResult;
  }

  const issues = semanticIssues(schemaResult.value);
  return issues.length === 0
    ? { ok: true, value: schemaResult.value, issues: [] }
    : { ok: false, issues };
}

export function assertSceneDocument(value: unknown): asserts value is SceneDocument {
  const result = validateSceneDocument(value);
  if (!result.ok) {
    throw new SceneContractError(result.issues);
  }
}

export function validateRevision(value: unknown): ValidationResult<Revision> {
  return validateWithSchema<Revision>(value, validateRevisionSchema);
}

export function validateStudioIssue(value: unknown): ValidationResult<StudioIssue> {
  return validateWithSchema<StudioIssue>(value, validateIssueSchema);
}

function structuredHtmlSemanticIssues(contract: StructuredHtmlContract): ContractIssue[] {
  const issues: ContractIssue[] = [];
  const ids = new Map<string, string>();
  const sourceIds = new Set(contract.provenance.sources.map((source) => source.sourceId));
  const orders = new Set<number>();
  const register = (id: string, path: string): void => {
    const previous = ids.get(id);
    if (previous !== undefined) {
      issues.push({ source: "semantic", code: "id.duplicate", path, message: `ID \"${id}\" is already used at ${previous}` });
    } else {
      ids.set(id, path);
    }
  };
  register(contract.documentId, "/documentId");
  contract.scenes.forEach((scene, sceneIndex) => {
    const scenePath = `/scenes/${sceneIndex}`;
    register(scene.id, `${scenePath}/id`);
    if (orders.has(scene.order)) {
      issues.push({ source: "semantic", code: "scene.order_duplicate", path: `${scenePath}/order`, message: `Scene order ${scene.order} is duplicated` });
    }
    orders.add(scene.order);
    scene.elements.forEach((element, elementIndex) => {
      const elementPath = `${scenePath}/elements/${elementIndex}`;
      register(element.id, `${elementPath}/id`);
      element.sourceIds.forEach((sourceId) => {
        if (!sourceIds.has(sourceId)) {
          issues.push({ source: "semantic", code: "provenance.source_missing", path: `${elementPath}/sourceIds`, message: `Source \"${sourceId}\" is not declared` });
        }
      });
      if (element.role === "image" && element.tagName !== "img" && element.tagName !== "figure") {
        issues.push({ source: "semantic", code: "role.tag_mismatch", path: `${elementPath}/tagName`, message: "Image roles require img or figure tags" });
      }
    });
  });
  return issues;
}

export function validateStructuredHtmlContract(value: unknown): ValidationResult<StructuredHtmlContract> {
  const result = validateWithSchema<StructuredHtmlContract>(value, validateStructuredHtmlSchema);
  if (!result.ok) return result;
  const issues = structuredHtmlSemanticIssues(result.value);
  return issues.length === 0 ? result : { ok: false, issues };
}

export function validateDesignPack(value: unknown): ValidationResult<DesignPack> {
  const result = validateWithSchema<DesignPack>(value, validateDesignPackSchema);
  if (!result.ok) return result;
  const issues: ContractIssue[] = [];
  const pageRoleIds = new Set<string>();
  result.value.pageRoles.forEach((role, index) => {
    if (pageRoleIds.has(role.id)) issues.push({ source: "semantic", code: "page_role.duplicate", path: `/pageRoles/${index}/id`, message: `Page role \"${role.id}\" is duplicated` });
    pageRoleIds.add(role.id);
  });
  const orders = result.value.narrativeArc.map((step) => step.order);
  orders.forEach((order, index) => {
    if (order !== index + 1) issues.push({ source: "semantic", code: "narrative.order_invalid", path: `/narrativeArc/${index}/order`, message: "Narrative arc orders must be continuous from one" });
    const role = result.value.narrativeArc[index]?.role;
    if (role !== undefined && !pageRoleIds.has(role)) issues.push({ source: "semantic", code: "narrative.role_missing", path: `/narrativeArc/${index}/role`, message: `Page role \"${role}\" is not declared` });
  });
  return issues.length === 0 ? result : { ok: false, issues };
}

export function validateHtmlImportResult(value: unknown): ValidationResult<HtmlImportResult> {
  const result = validateWithSchema<HtmlImportResult>(value, validateHtmlImportResultSchema);
  if (!result.ok) return result;
  const issues: ContractIssue[] = [];
  if (result.value.status === "accepted" && result.value.document === undefined) {
    issues.push({ source: "semantic", code: "import.document_missing", path: "/document", message: "Accepted imports require a Scene IR document" });
  }
  if (result.value.status === "rejected" && result.value.document !== undefined) {
    issues.push({ source: "semantic", code: "import.rejected_document", path: "/document", message: "Rejected imports cannot expose a document" });
  }
  if (result.value.status !== "accepted" && result.value.diagnostics.length === 0) {
    issues.push({ source: "semantic", code: "import.diagnostic_missing", path: "/diagnostics", message: "Partial and rejected imports require diagnostics" });
  }
  if (result.value.document !== undefined) {
    const documentResult = validateSceneDocument(result.value.document);
    if (!documentResult.ok) issues.push(...documentResult.issues.map((issue) => ({ ...issue, path: `/document${issue.path === "/" ? "" : issue.path}` })));
  }
  return issues.length === 0 ? result : { ok: false, issues };
}
