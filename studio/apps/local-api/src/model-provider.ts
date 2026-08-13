import {
  createFixtureModelProvider,
  createOpenAICompatibleAdapter,
  type ModelProvider,
} from "@opendesign/studio-model-adapter";

export type GenerationMode = "live" | "fixture" | "unavailable";

export type GenerationProviderPublicInfo = {
  generationMode: GenerationMode;
  providerId?: string;
  model?: string;
  reason?: "mode_not_configured" | "live_configuration_incomplete" | "live_configuration_invalid";
};

export type GenerationProviderConfiguration = {
  mode: GenerationMode;
  provider: ModelProvider | null;
  publicInfo: GenerationProviderPublicInfo;
};

export type ConfigureGenerationProviderOptions = {
  env: Readonly<Record<string, string | undefined>>;
  fetch?: typeof globalThis.fetch;
  fixtureProvider?: ModelProvider;
};

function trimmed(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function unavailable(reason: NonNullable<GenerationProviderPublicInfo["reason"]>): GenerationProviderConfiguration {
  return { mode: "unavailable", provider: null, publicInfo: { generationMode: "unavailable", reason } };
}

/**
 * Converts explicit server environment configuration into a provider. It never
 * performs I/O, never exposes the API key and never falls back from live to a
 * fixture provider.
 */
export function configureGenerationProvider(options: ConfigureGenerationProviderOptions): GenerationProviderConfiguration {
  const mode = trimmed(options.env.STUDIO_GENERATION_MODE);
  if (mode === "fixture") {
    const provider = options.fixtureProvider ?? createFixtureModelProvider();
    return {
      mode: "fixture",
      provider,
      publicInfo: { generationMode: "fixture", providerId: provider.providerId, model: provider.model },
    };
  }
  if (mode !== "live") return unavailable("mode_not_configured");

  const endpoint = trimmed(options.env.STUDIO_GENERATION_ENDPOINT);
  const model = trimmed(options.env.STUDIO_GENERATION_MODEL);
  const apiKey = trimmed(options.env.STUDIO_GENERATION_API_KEY);
  if (!endpoint || !model || !apiKey) return unavailable("live_configuration_incomplete");

  try {
    const provider = createOpenAICompatibleAdapter({
      endpoint,
      model,
      apiKey,
      fetch: options.fetch ?? globalThis.fetch,
      ...(trimmed(options.env.STUDIO_GENERATION_PROVIDER_ID)
        ? { providerId: trimmed(options.env.STUDIO_GENERATION_PROVIDER_ID)! }
        : {}),
    });
    return {
      mode: "live",
      provider,
      publicInfo: { generationMode: "live", providerId: provider.providerId, model: provider.model },
    };
  } catch {
    return unavailable("live_configuration_invalid");
  }
}
