import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import issueSchema from "../issue.schema.json" with { type: "json" };
import revisionSchema from "../revision.schema.json" with { type: "json" };
import sceneIrSchema from "../scene-ir.schema.json" with { type: "json" };
import type { Revision, SceneDocument, StudioIssue } from "./index.js";

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
const validateSceneSchema = ajv.compile(sceneIrSchema);
const validateRevisionSchema = ajv.compile(revisionSchema);
const validateIssueSchema = ajv.compile(issueSchema);

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
