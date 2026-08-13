import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { DesignDirectorInput } from "@opendesign/studio-design-director";

import {
  MODEL_ADAPTER_CONTRACT_VERSION,
  ModelProviderFailure,
  createFixtureModelProvider,
  createOpenAICompatibleAdapter,
  generateWithModel,
  type ModelGenerationRequest,
  type ModelProvider,
} from "./index.js";

function input(): DesignDirectorInput {
  return {
    inputVersion: "0.1.0",
    taskId: "adapter_proposal",
    title: "让模型输出保持可编辑",
    brief: { objective: "用可追溯证据生成提案。", audience: "产品与设计决策者", constraints: ["不得补造数据"] },
    content: {
      summary: "Structured HTML 保留语义和人工编辑权。",
      keyPoints: [
        { id: "point_diagnose", text: "先诊断，再生成", sourceIds: ["source_brief"] },
        { id: "point_evidence", text: "事实必须绑定来源", sourceIds: ["source_research"] },
      ],
      callToAction: "人工确认后形成候选。",
    },
    sources: [
      { sourceId: "source_brief", type: "brief", title: "需求", content: "设计诊断先于视觉生成。" },
      { sourceId: "source_research", type: "document", title: "研究", content: "稳定结构支持可编辑交付。" },
    ],
    brand: { name: "OpenDesign", tone: ["克制", "编辑感"] },
    deliverable: { kind: "proposal", audience: "产品与设计决策者", language: "zh-CN", format: "structured-html", pageCount: 6 },
    designPack: { id: "executive-proposal-cn", version: "1.0.0" },
    editability: {
      requiredCapabilities: ["text", "typography", "asset", "frame", "order"],
      requireNativeText: true,
      requireReplaceableImages: true,
      requireReorderablePages: true,
    },
  };
}

function request(signal?: AbortSignal): ModelGenerationRequest {
  return {
    contractVersion: MODEL_ADAPTER_CONTRACT_VERSION,
    requestId: "request_fixture_01",
    input: input(),
    ...(signal ? { signal } : {}),
  };
}

function openAIResponse(candidate: unknown, init: { status?: number; contentType?: string; id?: string; usage?: Record<string, unknown> } = {}): Response {
  return new Response(JSON.stringify({
    id: init.id ?? "provider-01",
    choices: [{ message: { content: JSON.stringify(candidate) } }],
    usage: init.usage ?? { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46 },
  }), {
    status: init.status ?? 200,
    headers: { "content-type": init.contentType ?? "application/json" },
  });
}

describe("provider-neutral model adapter", () => {
  it("runs the deterministic fixture candidate through compiler and importer gates", async () => {
    const first = await generateWithModel(createFixtureModelProvider(), request());
    const second = await generateWithModel(createFixtureModelProvider(), request());
    assert.deepEqual(second, first);
    assert.equal(first.status, "accepted");
    if (first.status !== "accepted") return;
    assert.equal(first.output.importResult.status, "accepted");
    assert.deepEqual(first.output.manifest.sourceCoverage.unusedSourceIds, []);
    assert.equal(first.output.importResult.document.scenes.length, 6);
  });

  it("rejects a fixture candidate that drops source coverage without producing output", async () => {
    const provider = createFixtureModelProvider({
      transform(value) {
        value.content.keyPoints[1]!.sourceIds = ["source_brief"];
        return value;
      },
    });
    const result = await generateWithModel(provider, request());
    assert.equal(result.status, "rejected");
    if (result.status !== "rejected") return;
    assert.equal(result.error.code, "candidate.rejected");
    assert.ok(!("output" in result));
  });

  it("rejects a provider candidate that attempts to return an accepted output directly", async () => {
    const compiled = await generateWithModel(createFixtureModelProvider(), request());
    assert.equal(compiled.status, "accepted");
    if (compiled.status !== "accepted") return;
    const provider = createFixtureModelProvider({ transform: () => compiled.output });
    const result = await generateWithModel(provider, request());
    assert.equal(result.status, "rejected");
    if (result.status !== "rejected") return;
    assert.equal(result.error.code, "candidate.schema_invalid");
  });

  it("rejects an invalid input before calling the provider", async () => {
    let called = false;
    const provider: ModelProvider = {
      providerId: "never-called",
      model: "fixture",
      async generate() {
        called = true;
        return { candidate: input() };
      },
    };
    const invalid = request();
    invalid.input.designPack = { id: "missing-pack", version: "1.0.0" };
    const result = await generateWithModel(provider, invalid);
    assert.equal(result.status, "rejected");
    assert.equal(called, false);
    if (result.status !== "rejected") return;
    assert.equal(result.error.code, "request.invalid");
  });

  it("aborts a provider that ignores the signal when the timeout elapses", async () => {
    const provider: ModelProvider = {
      providerId: "slow-fixture",
      model: "never-resolves",
      generate: () => new Promise(() => undefined),
    };
    const result = await generateWithModel(provider, request(), { timeoutMs: 100 });
    assert.equal(result.status, "rejected");
    if (result.status !== "rejected") return;
    assert.equal(result.error.code, "provider.timeout");
    assert.equal(result.error.retryable, true);
  });

  it("honors caller abort and removes sensitive provider error details", async () => {
    const controller = new AbortController();
    const provider: ModelProvider = {
      providerId: "abort-fixture",
      model: "fixture",
      async generate({ signal }) {
        return await new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new ModelProviderFailure("provider.failure", "authorization=Bearer-secret-value password=hunter2", { retryable: true })), { once: true });
        });
      },
    };
    setTimeout(() => controller.abort("cancelled"), 10);
    const result = await generateWithModel(provider, request(controller.signal));
    assert.equal(result.status, "rejected");
    if (result.status !== "rejected") return;
    assert.equal(result.error.code, "request.aborted");
    assert.doesNotMatch(JSON.stringify(result), /Bearer-secret-value|hunter2/u);
  });

  it("rejects oversized candidates before validation", async () => {
    const provider = createFixtureModelProvider({ transform: () => ({ payload: "x".repeat(1024) }) });
    const result = await generateWithModel(provider, request(), { maxCandidateBytes: 128 });
    assert.equal(result.status, "rejected");
    if (result.status !== "rejected") return;
    assert.equal(result.error.code, "candidate.too_large");
  });

  it("sanitizes thrown provider messages and does not include response bodies", async () => {
    const provider: ModelProvider = {
      providerId: "error-fixture",
      model: "fixture",
      async generate() {
        throw new ModelProviderFailure("provider.http_error", "api_key=sk-super-secret-token", { retryable: false });
      },
    };
    const result = await generateWithModel(provider, request());
    assert.equal(result.status, "rejected");
    assert.doesNotMatch(JSON.stringify(result), /sk-super-secret-token/u);
    assert.match(JSON.stringify(result), /redacted/u);
  });
});

describe("OpenAI-compatible HTTP adapter", () => {
  it("requires explicit safe configuration and performs no I/O during construction", () => {
    let calls = 0;
    const mockFetch: typeof fetch = async () => {
      calls += 1;
      return openAIResponse(input());
    };
    createOpenAICompatibleAdapter({ endpoint: "https://models.example.test/v1/chat/completions", apiKey: "runtime-only", model: "test-model", fetch: mockFetch });
    assert.equal(calls, 0);
    assert.throws(() => createOpenAICompatibleAdapter({ endpoint: "http://models.example.test/v1/chat/completions", apiKey: "runtime-only", model: "test-model", fetch: mockFetch }), /HTTPS/u);
    assert.throws(() => createOpenAICompatibleAdapter({ endpoint: "https://models.example.test/v1/chat/completions", apiKey: "runtime-only", model: "test-model", fetch: mockFetch, extraHeaders: { Authorization: "override" } }), /cannot be overridden/u);
  });

  it("sends a deterministic JSON-only request and normalizes usage", async () => {
    let captured: RequestInit | undefined;
    const mockFetch: typeof fetch = async (_url, init) => {
      captured = init;
      return openAIResponse(input(), { id: "provider/id with spaces", usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 } });
    };
    const provider = createOpenAICompatibleAdapter({ endpoint: "https://models.example.test/v1/chat/completions", apiKey: "runtime-key", model: "test-model", fetch: mockFetch });
    const result = await generateWithModel(provider, request());
    assert.equal(result.status, "accepted");
    if (result.status !== "accepted") return;
    assert.deepEqual(result.usage, { inputTokens: 3, outputTokens: 5, totalTokens: 8 });
    assert.equal(result.provider.requestId, "provideridwithspaces");
    assert.equal(captured?.redirect, "error");
    const body = JSON.parse(String(captured?.body)) as Record<string, unknown>;
    assert.equal(body.temperature, 0);
    assert.deepEqual(body.response_format, { type: "json_object" });
    assert.equal((captured?.headers as Record<string, string>).authorization, "Bearer runtime-key");
  });

  it("rejects malformed envelope JSON and non-JSON content without calling the compiler", async () => {
    const cases: Array<readonly [string, typeof fetch]> = [
      ["invalid JSON", async () => new Response("not-json", { headers: { "content-type": "application/json" } })],
      ["non-JSON content type", async () => new Response("ok", { headers: { "content-type": "text/plain" } })],
      ["markdown-wrapped candidate", async () => new Response(JSON.stringify({ choices: [{ message: { content: "```json\\n{}\\n```" } }] }), { headers: { "content-type": "application/json" } })],
    ];
    for (const [_name, mockFetch] of cases) {
      const provider = createOpenAICompatibleAdapter({ endpoint: "https://models.example.test/v1/chat/completions", apiKey: "runtime-only", model: "test-model", fetch: mockFetch });
      const result = await generateWithModel(provider, request());
      assert.equal(result.status, "rejected");
      if (result.status !== "rejected") continue;
      assert.equal(result.error.code, "provider.response_invalid");
    }
  });

  it("rejects declared and streamed oversized responses", async () => {
    const declaredFetch: typeof fetch = async () => new Response("{}", { headers: { "content-type": "application/json", "content-length": "9999" } });
    const streamedFetch: typeof fetch = async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("x".repeat(512))); controller.close(); } }), { headers: { "content-type": "application/json" } });
    for (const mockFetch of [declaredFetch, streamedFetch]) {
      const provider = createOpenAICompatibleAdapter({ endpoint: "https://models.example.test/v1/chat/completions", apiKey: "runtime-only", model: "test-model", fetch: mockFetch, maxResponseBytes: 128 });
      const result = await generateWithModel(provider, request());
      assert.equal(result.status, "rejected");
      if (result.status !== "rejected") continue;
      assert.equal(result.error.code, "provider.response_too_large");
    }
  });

  it("maps HTTP status without exposing provider body or key", async () => {
    const mockFetch: typeof fetch = async () => new Response('{"error":"api_key=sk-do-not-leak"}', { status: 429, headers: { "content-type": "application/json" } });
    const provider = createOpenAICompatibleAdapter({ endpoint: "https://models.example.test/v1/chat/completions", apiKey: "runtime-only", model: "test-model", fetch: mockFetch });
    const result = await generateWithModel(provider, request());
    assert.equal(result.status, "rejected");
    if (result.status !== "rejected") return;
    assert.equal(result.error.code, "provider.http_error");
    assert.equal(result.error.retryable, true);
    assert.doesNotMatch(JSON.stringify(result), /sk-do-not-leak|runtime-only/u);
  });
});
