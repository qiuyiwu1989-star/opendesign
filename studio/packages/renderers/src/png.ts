import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { SceneDocument } from "@opendesign/studio-contracts";
import { renderSceneToHtml } from "./html.js";
import type { PageScreenshotAdapter, PngExportOptions, PngExportResult, ScreenshotRequest } from "./types.js";

type PlaywrightModule = {
  chromium: {
    launch(options?: { headless?: boolean; executablePath?: string }): Promise<{
      newPage(options: { viewport: { width: number; height: number }; deviceScaleFactor: number }): Promise<{
        setContent(html: string, options: { waitUntil: "load" }): Promise<void>;
        screenshot(options: { path: string; type: "png"; animations: "disabled" }): Promise<void>;
      }>;
      close(): Promise<void>;
    }>;
  };
};

async function importPlaywright(): Promise<PlaywrightModule> {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;
  try {
    return (await dynamicImport("playwright")) as PlaywrightModule;
  } catch (error) {
    throw new Error("Playwright is not installed. Inject a PageScreenshotAdapter or install playwright with a Chromium runtime.", { cause: error });
  }
}

export function createPlaywrightScreenshotAdapter(options: { executablePath?: string } = {}): PageScreenshotAdapter {
  return {
    name: "playwright-chromium",
    async capture(request: ScreenshotRequest): Promise<void> {
      const playwright = await importPlaywright();
      const browser = await playwright.chromium.launch({ headless: true, ...(options.executablePath ? { executablePath: options.executablePath } : {}) });
      try {
        const page = await browser.newPage({
          viewport: { width: request.width, height: request.height },
          deviceScaleFactor: request.deviceScaleFactor ?? 1,
        });
        await page.setContent(request.html, { waitUntil: "load" });
        await page.screenshot({ path: request.outputPath, type: "png", animations: "disabled" });
      } finally {
        await browser.close();
      }
    },
  };
}

export async function exportDocumentToPng(document: SceneDocument, options: PngExportOptions): Promise<PngExportResult> {
  await mkdir(options.outputDirectory, { recursive: true });
  const pages: PngExportResult["pages"] = [];
  for (const scene of document.scenes.slice().sort((left, right) => left.order - right.order)) {
    const outputPath = join(options.outputDirectory, `${String(scene.order).padStart(2, "0")}-${scene.id}.png`);
    const fragment = renderSceneToHtml(document, scene);
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:${document.canvas.width}px;height:${document.canvas.height}px;overflow:hidden}</style></head><body>${fragment}</body></html>`;
    await options.adapter.capture({
      html,
      outputPath,
      width: document.canvas.width,
      height: document.canvas.height,
      deviceScaleFactor: options.deviceScaleFactor ?? 1,
    });
    pages.push({ sceneId: scene.id, outputPath });
  }
  return { adapter: options.adapter.name, pages };
}
