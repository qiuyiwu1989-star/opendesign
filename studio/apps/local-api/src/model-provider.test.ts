import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ModelProvider } from "@opendesign/studio-model-adapter";
import { configureGenerationProvider } from "./model-provider.js";

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
