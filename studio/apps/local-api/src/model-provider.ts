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
  reason?: "mode_not_configured" | "live_configuration_incomplete" | "live_configuration_invalid" | "live_preset_unsupported";
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

type LiveProviderPreset = {
  endpoint: string;
  providerId: string;
  defaultModel: string;
};

export const KIMI_CHINA_CHAT_COMPLETIONS_ENDPOINT = "https://api.moonshot.cn/v1/chat/completions" as const;
export const KIMI_GLOBAL_CHAT_COMPLETIONS_ENDPOINT = "https://api.moonshot.ai/v1/chat/completions" as const;
export const KIMI_DEFAULT_MODEL = "kimi-k3" as const;

const LIVE_PROVIDER_PRESETS = {
  "kimi-cn": {
    endpoint: KIMI_CHINA_CHAT_COMPLETIONS_ENDPOINT,
    providerId: "kimi",
    defaultModel: KIMI_DEFAULT_MODEL,
  },
  "kimi-global": {
    endpoint: KIMI_GLOBAL_CHAT_COMPLETIONS_ENDPOINT,
    providerId: "kimi",
    defaultModel: KIMI_DEFAULT_MODEL,
  },
} as const satisfies Record<string, LiveProviderPreset>;

function preset(value: string | undefined): LiveProviderPreset | undefined | null {
  const name = trimmed(value);
  if (name === undefined) return undefined;
  return name in LIVE_PROVIDER_PRESETS ? LIVE_PROVIDER_PRESETS[name as keyof typeof LIVE_PROVIDER_PRESETS] : null;
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

  const selectedPreset = preset(options.env.STUDIO_GENERATION_PROVIDER);
  if (selectedPreset === null) return unavailable("live_preset_unsupported");
  const endpoint = selectedPreset?.endpoint ?? trimmed(options.env.STUDIO_GENERATION_ENDPOINT);
  const model = trimmed(options.env.STUDIO_GENERATION_MODEL) ?? selectedPreset?.defaultModel;
  const apiKey = trimmed(options.env.STUDIO_GENERATION_API_KEY);
  if (!endpoint || !model || !apiKey) return unavailable("live_configuration_incomplete");

  try {
    const configuredProviderId = selectedPreset?.providerId ?? trimmed(options.env.STUDIO_GENERATION_PROVIDER_ID);
    const provider = createOpenAICompatibleAdapter({
      endpoint,
      model,
      apiKey,
      fetch: options.fetch ?? globalThis.fetch,
      ...(configuredProviderId ? { providerId: configuredProviderId } : {}),
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
