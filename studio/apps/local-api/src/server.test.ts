import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import fixture from "../../../packages/contracts/fixtures/proposal-v0.json" with { type: "json" };
import { createStudioServer } from "./server.js";

test("local API persists a project and returns a real HTML export", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opendesign-api-"));
  const server = createStudioServer({ dataDirectory: directory });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const health = await fetch(`${base}/api/health`).then((response) => response.json()) as { ok: boolean };
    assert.equal(health.ok, true);

    const saved = await fetch(`${base}/api/projects/doc_studio_v0`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(fixture),
    });
    assert.equal(saved.status, 200);

    const exported = await fetch(`${base}/api/projects/doc_studio_v0/exports`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "html" }),
    });
    assert.equal(exported.status, 201);
    const result = await exported.json() as { files: Array<{ downloadUrl: string }> };
    const html = await fetch(`${base}${result.files[0]!.downloadUrl}`).then((response) => response.text());
    assert.match(html, /data-scene-id="scene_cover"/);
    assert.match(html, /让视觉作品在生成之后/);

    const pngExport = await fetch(`${base}/api/projects/doc_studio_v0/exports`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "png" }),
    });
    assert.equal(pngExport.status, 201);
    const pngResult = await pngExport.json() as { renderer: string; files: Array<{ downloadUrl: string }> };
    assert.equal(pngResult.renderer, "scene-ir-native-canvas");
    assert.equal(pngResult.files.length, 6);
    const pngBytes = await fetch(`${base}${pngResult.files[0]!.downloadUrl}`).then((response) => response.arrayBuffer()) as ArrayBuffer;
    const png = new Uint8Array(pngBytes);
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  } finally {
    server.close();
    await once(server, "close");
    await rm(directory, { recursive: true, force: true });
  }
});
