import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { SceneDocument } from "@opendesign/studio-contracts";
import { runDeterministicQa } from "@opendesign/studio-qa";
import { exportDocumentToPptx, renderDocumentToHtml, renderSceneToPngBuffer } from "@opendesign/studio-renderers";
export type ExportKind = "html" | "png" | "pptx";

export type ExportFile = { name: string; downloadUrl: string };
export type LocalExportResult = {
  exportId: string;
  kind: ExportKind;
  files: ExportFile[];
  renderer: string;
  warning?: string;
  editabilityReport?: unknown;
  qa: ReturnType<typeof runDeterministicQa>;
};

function safeExportId(): string {
  return `export_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
}

export class LocalExportService {
  constructor(readonly rootDirectory: string) {}

  exportDirectory(exportId: string): string {
    if (!/^export_[a-z0-9_]+$/.test(exportId)) throw new Error("Invalid export ID");
    return join(this.rootDirectory, "exports", exportId);
  }

  exportFilePath(exportId: string, fileName: string): string {
    if (basename(fileName) !== fileName || !/^[a-zA-Z0-9._-]+$/.test(fileName)) throw new Error("Invalid export file name");
    return join(this.exportDirectory(exportId), fileName);
  }

  async create(document: SceneDocument, kind: ExportKind): Promise<LocalExportResult> {
    const exportId = safeExportId();
    const directory = this.exportDirectory(exportId);
    await mkdir(directory, { recursive: true });
    const qa = runDeterministicQa(document);
    if (qa.summary.blocker > 0 || qa.summary.error > 0) throw new Error("Export blocked by deterministic QA");

    if (kind === "html") {
      const name = `${document.documentId}.html`;
      await writeFile(join(directory, name), renderDocumentToHtml(document), "utf8");
      return { exportId, kind, renderer: "studio-html", files: this.files(exportId, [name]), qa };
    }

    if (kind === "png") {
      const pngNames: string[] = [];
      for (const [index, scene] of document.scenes.slice().sort((left, right) => left.order - right.order).entries()) {
        const name = `slide-${index + 1}.png`;
        await writeFile(join(directory, name), renderSceneToPngBuffer(document, scene));
        pngNames.push(name);
      }
      return {
        exportId,
        kind,
        renderer: "scene-ir-native-canvas",
        files: this.files(exportId, pngNames),
        qa,
      };
    }

    const pptxName = `${document.documentId}.pptx`;
    const pptxResult = await exportDocumentToPptx(document, {
      outputPath: join(directory, pptxName),
      generatedAt: new Date().toISOString(),
    });
    await writeFile(join(directory, "editability.json"), `${JSON.stringify(pptxResult.report, null, 2)}\n`, "utf8");

    return {
      exportId,
      kind,
      renderer: "pptxgenjs-editable",
      files: this.files(exportId, [pptxName, "editability.json"]),
      editabilityReport: pptxResult.report,
      qa,
    };
  }

  private files(exportId: string, names: string[]): ExportFile[] {
    return names.map((name) => ({ name, downloadUrl: `/api/exports/${exportId}/${name}` }));
  }
}
