import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import JSZip from "jszip";
import type { SceneDocument } from "@opendesign/studio-contracts";
import { runDeterministicQa } from "@opendesign/studio-qa";
import { exportDocumentToPptx, renderDocumentToHtml, renderSceneToPngBuffer } from "@opendesign/studio-renderers";
export type ExportKind = "html" | "png" | "pptx";

export type ExportFile = { name: string; downloadUrl: string };
export type LocalExportResult = {
  exportId: string;
  kind: ExportKind;
  files: ExportFile[];
  bundle?: ExportFile;
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
    if (qa.summary.blocker > 0) throw new Error("Export blocked by deterministic QA blocker");

    if (kind === "html") {
      const name = `${document.documentId}.html`;
      const portableDocument = structuredClone(document);
      for (const scene of portableDocument.scenes) {
        for (const element of scene.elements) {
          if (element.type !== "image" || !element.assetSrc) continue;
          const path = this.localAssetPath(document.documentId, element.assetSrc);
          if (!path) continue;
          const bytes = await readFile(path);
          element.assetSrc = `data:${path.endsWith(".png") ? "image/png" : "image/jpeg"};base64,${bytes.toString("base64")}`;
        }
      }
      await writeFile(join(directory, name), renderDocumentToHtml(portableDocument), "utf8");
      return { exportId, kind, renderer: "studio-html", files: this.files(exportId, [name]), qa };
    }

    if (kind === "png") {
      const pngNames: string[] = [];
      const zip = new JSZip();
      for (const [index, scene] of document.scenes.slice().sort((left, right) => left.order - right.order).entries()) {
        const name = `slide-${index + 1}.png`;
        const buffer = await renderSceneToPngBuffer(document, scene, (source) => this.resolveAsset(document.documentId, source));
        await writeFile(join(directory, name), buffer);
        zip.file(name, buffer);
        pngNames.push(name);
      }
      const bundleName = `${document.documentId}-png.zip`;
      await writeFile(join(directory, bundleName), await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } }));
      const bundle = this.files(exportId, [bundleName])[0]!;
      return {
        exportId,
        kind,
        renderer: "scene-ir-native-canvas",
        files: this.files(exportId, pngNames),
        bundle,
        qa,
      };
    }

    const pptxName = `${document.documentId}.pptx`;
    const pptxResult = await exportDocumentToPptx(document, {
      outputPath: join(directory, pptxName),
      generatedAt: new Date().toISOString(),
      assetResolver: async (source) => {
        const path = this.localAssetPath(document.documentId, source);
        if (!path) return null;
        return { path, mimeType: path.endsWith(".png") ? "image/png" : "image/jpeg" };
      },
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

  private localAssetPath(projectId: string, source: string): string | null {
    const match = source.match(/^\/api\/assets\/([a-z][a-z0-9_-]{2,63})\/(asset_[a-z0-9_]+\.(?:png|jpg))$/);
    if (!match || match[1] !== projectId) return null;
    return join(this.rootDirectory, "assets", projectId, match[2]!);
  }

  private async resolveAsset(projectId: string, source: string): Promise<Buffer | null> {
    const path = this.localAssetPath(projectId, source);
    if (!path) return null;
    try { return await readFile(path); } catch { return null; }
  }
}
