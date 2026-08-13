import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ModelProvider } from "@opendesign/studio-model-adapter";
import {
  KIMI_CHINA_CHAT_COMPLETIONS_ENDPOINT,
  KIMI_DEFAULT_MODEL,
  KIMI_GLOBAL_CHAT_COMPLETIONS_ENDPOINT,
  configureGenerationProvider,
} from "./model-provider.js";

describe("generation provider configuration", () => {
  it("is unavailable unless a mode is explicitly selected", () => {
    const configured = configureGenerationProvider({ env: {} });
    assert.equal(configured.mode, "unavailable");
    assert.equal(configured.provider, null);
    assert.deepEqual(configured.publicInfo, { generationMode: "unavailable", reason: "mode_not_configured" });
  });

  it("does not disguise incomplete live configuration as fixture", () => {
    const configured = configureGenerationProvider({
      env: { STUDIO_GENERATION_MODE: "live", STUDIO_GENERATION_ENDPOINT: "https://models.example/v1/chat/completions" },
    });
    assert.equal(configured.mode, "unavailable");
    assert.equal(configured.provider, null);
    assert.equal(configured.publicInfo.reason, "live_configuration_incomplete");
    assert.doesNotMatch(JSON.stringify(configured.publicInfo), /key|secret|token/iu);
  });

  it("only enables fixture mode when it is explicitly selected", () => {
    const fixture: ModelProvider = {
      providerId: "test-fixture",
      model: "fixture-v2",
      async generate(request) { return { candidate: request.input }; },
    };
    const configured = configureGenerationProvider({
      env: { STUDIO_GENERATION_MODE: "fixture" },
      fixtureProvider: fixture,
    });
    assert.equal(configured.mode, "fixture");
    assert.equal(configured.provider, fixture);
    assert.deepEqual(configured.publicInfo, { generationMode: "fixture", providerId: "test-fixture", model: "fixture-v2" });
  });

  it("constructs live configuration without exposing the credential", () => {
    const secret = "sk-top-secret-never-return";
    const configured = configureGenerationProvider({
      env: {
        STUDIO_GENERATION_MODE: "live",
        STUDIO_GENERATION_ENDPOINT: "https://models.example/v1/chat/completions",
        STUDIO_GENERATION_MODEL: "model-v1",
        STUDIO_GENERATION_API_KEY: secret,
        STUDIO_GENERATION_PROVIDER_ID: "private-cloud",
      },
      fetch: async () => new Response(null, { status: 500 }),
    });
    assert.equal(configured.mode, "live");
    assert.ok(configured.provider);
    assert.deepEqual(configured.publicInfo, { generationMode: "live", providerId: "private-cloud", model: "model-v1" });
    assert.doesNotMatch(JSON.stringify(configured), new RegExp(secret, "u"));
  });

  it("configures the official Kimi China preset without storing endpoint or model beside the secret", async () => {
    const secret = "runtime-kimi-key-never-return";
    let requestUrl = "";
    let requestAuthorization = "";
    const configured = configureGenerationProvider({
      env: {
        STUDIO_GENERATION_MODE: "live",
        STUDIO_GENERATION_PROVIDER: "kimi-cn",
        STUDIO_GENERATION_API_KEY: secret,
      },
      fetch: async (input, init) => {
        requestUrl = String(input);
        requestAuthorization = new Headers(init?.headers).get("authorization") ?? "";
        return Response.json({ id: "request-kimi", choices: [{ message: { content: "{}" } }] });
      },
    });
    assert.equal(configured.mode, "live");
    assert.ok(configured.provider);
    assert.deepEqual(configured.publicInfo, { generationMode: "live", providerId: "kimi", model: KIMI_DEFAULT_MODEL });
    await configured.provider.generate({
      contractVersion: "0.1.0",
      requestId: "request_kimi",
      input: {} as never,
      signal: new AbortController().signal,
    });
    assert.equal(requestUrl, KIMI_CHINA_CHAT_COMPLETIONS_ENDPOINT);
    assert.equal(requestAuthorization, `Bearer ${secret}`);
    assert.doesNotMatch(JSON.stringify(configured), new RegExp(secret, "u"));
  });

  it("keeps Kimi global and China endpoints explicit and rejects unknown presets", () => {
    assert.notEqual(KIMI_GLOBAL_CHAT_COMPLETIONS_ENDPOINT, KIMI_CHINA_CHAT_COMPLETIONS_ENDPOINT);
    const global = configureGenerationProvider({
      env: { STUDIO_GENERATION_MODE: "live", STUDIO_GENERATION_PROVIDER: "kimi-global", STUDIO_GENERATION_API_KEY: "runtime-only" },
      fetch: async (input) => {
        assert.equal(String(input), KIMI_GLOBAL_CHAT_COMPLETIONS_ENDPOINT);
        return Response.json({ choices: [{ message: { content: "{}" } }] });
      },
    });
    assert.equal(global.mode, "live");
    const unknown = configureGenerationProvider({
      env: { STUDIO_GENERATION_MODE: "live", STUDIO_GENERATION_PROVIDER: "made-up", STUDIO_GENERATION_API_KEY: "runtime-only" },
    });
    assert.equal(unknown.mode, "unavailable");
    assert.equal(unknown.publicInfo.reason, "live_preset_unsupported");
  });

  it("allows an explicit reviewed model override while keeping the preset endpoint", () => {
    const configured = configureGenerationProvider({
      env: {
        STUDIO_GENERATION_MODE: "live",
        STUDIO_GENERATION_PROVIDER: "kimi-cn",
        STUDIO_GENERATION_MODEL: "kimi-k2.7-code-highspeed",
        STUDIO_GENERATION_API_KEY: "runtime-only",
      },
      fetch: async () => new Response(null, { status: 500 }),
    });
    assert.deepEqual(configured.publicInfo, { generationMode: "live", providerId: "kimi", model: "kimi-k2.7-code-highspeed" });
  });

  it("does not let generic endpoint or provider ID overrides weaken a reviewed Kimi preset", async () => {
    let requestUrl = "";
    const configured = configureGenerationProvider({
      env: {
        STUDIO_GENERATION_MODE: "live",
        STUDIO_GENERATION_PROVIDER: "kimi-cn",
        STUDIO_GENERATION_ENDPOINT: "https://attacker.example/v1/chat/completions",
        STUDIO_GENERATION_PROVIDER_ID: "spoofed-provider",
        STUDIO_GENERATION_API_KEY: "runtime-only",
      },
      fetch: async (input) => {
        requestUrl = String(input);
        return Response.json({ choices: [{ message: { content: "{}" } }] });
      },
    });
    assert.ok(configured.provider);
    await configured.provider.generate({ contractVersion: "0.1.0", requestId: "request_kimi", input: {} as never, signal: new AbortController().signal });
    assert.equal(requestUrl, KIMI_CHINA_CHAT_COMPLETIONS_ENDPOINT);
    assert.equal(configured.publicInfo.providerId, "kimi");
  });

  it("fails closed for an invalid live endpoint", () => {
    const configured = configureGenerationProvider({
      env: {
        STUDIO_GENERATION_MODE: "live",
        STUDIO_GENERATION_ENDPOINT: "http://models.example/v1/chat/completions",
        STUDIO_GENERATION_MODEL: "model-v1",
        STUDIO_GENERATION_API_KEY: "not-returned",
      },
    });
    assert.equal(configured.mode, "unavailable");
    assert.equal(configured.publicInfo.reason, "live_configuration_invalid");
  });
});
