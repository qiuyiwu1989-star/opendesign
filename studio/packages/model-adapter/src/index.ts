import {
  compileDesignDirector,
  validateDesignDirectorInput,
  type DesignDirectorAcceptedOutput,
  type DesignDirectorInput,
} from "@opendesign/studio-design-director";

export const MODEL_ADAPTER_CONTRACT_VERSION = "0.1.0" as const;

export type ModelUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type ModelGenerationRequest = {
  contractVersion: typeof MODEL_ADAPTER_CONTRACT_VERSION;
  requestId: string;
  input: DesignDirectorInput;
  signal?: AbortSignal;
};

export type ModelProviderRequest = Omit<ModelGenerationRequest, "signal"> & {
  signal: AbortSignal;
};

export type ModelProviderResponse = {
  candidate: unknown;
  providerRequestId?: string;
  usage?: ModelUsage;
};

export type ModelProvider = {
  readonly providerId: string;
  readonly model: string;
  generate(request: ModelProviderRequest): Promise<ModelProviderResponse>;
};

export type ModelAdapterErrorCode =
  | "request.invalid"
  | "request.aborted"
  | "provider.timeout"
  | "provider.http_error"
  | "provider.response_too_large"
  | "provider.response_invalid"
  | "provider.failure"
  | "candidate.too_large"
  | "candidate.schema_invalid"
  | "candidate.rejected";

export type ModelAdapterError = {
  code: ModelAdapterErrorCode;
  stage: "request" | "provider" | "candidate" | "compiler";
  retryable: boolean;
  message: string;
};

export type ModelGenerationAccepted = {
  contractVersion: typeof MODEL_ADAPTER_CONTRACT_VERSION;
  requestId: string;
  status: "accepted";
  provider: { id: string; model: string; requestId?: string };
  usage: ModelUsage;
  output: DesignDirectorAcceptedOutput;
};

export type ModelGenerationRejected = {
  contractVersion: typeof MODEL_ADAPTER_CONTRACT_VERSION;
  requestId: string;
  status: "rejected";
  provider: { id: string; model: string; requestId?: string };
  usage: ModelUsage;
  error: ModelAdapterError;
};

export type ModelGenerationResult = ModelGenerationAccepted | ModelGenerationRejected;

export type GenerateWithModelOptions = {
  timeoutMs?: number;
  maxCandidateBytes?: number;
};

type FailureOptions = {
  retryable?: boolean;
  cause?: unknown;
};

export class ModelProviderFailure extends Error {
  readonly code: ModelAdapterErrorCode;
  readonly retryable: boolean;

  constructor(code: ModelAdapterErrorCode, message: string, options: FailureOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ModelProviderFailure";
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_CANDIDATE_BYTES = 128 * 1024;
const MAX_CANDIDATE_BYTES = 512 * 1024;
const SAFE_ID = /^[a-z][a-z0-9_-]{2,63}$/u;
const SAFE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;
const EMPTY_USAGE: ModelUsage = Object.freeze({});

function byteLength(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function normalizeCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function normalizeUsage(value: ModelUsage | undefined): ModelUsage {
  if (!value) return {};
  const inputTokens = normalizeCount(value.inputTokens);
  const outputTokens = normalizeCount(value.outputTokens);
  const totalTokens = normalizeCount(value.totalTokens);
  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
  };
}

function safeProviderRequestId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const sanitized = value.replace(/[^A-Za-z0-9_.:-]/gu, "").slice(0, 128);
  return sanitized || undefined;
}

function sanitizeMessage(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  return value
    .replace(/((?:api[_-]?key|authorization|bearer|token|secret|password)\s*[:=]\s*)[^\s,;]+/giu, "$1[redacted]")
    .replace(/\b(?:sk|AKIA|AKID)[-_A-Za-z0-9]{12,}\b/gu, "[redacted]")
    .replace(/[\r\n\t]+/gu, " ")
    .slice(0, 240);
}

function rejected(
  requestId: string,
  provider: ModelProvider,
  error: ModelAdapterError,
  response?: Pick<ModelProviderResponse, "providerRequestId" | "usage">,
): ModelGenerationRejected {
  const providerRequestId = safeProviderRequestId(response?.providerRequestId);
  return {
    contractVersion: MODEL_ADAPTER_CONTRACT_VERSION,
    requestId,
    status: "rejected",
    provider: { id: provider.providerId, model: provider.model, ...(providerRequestId ? { requestId: providerRequestId } : {}) },
    usage: normalizeUsage(response?.usage),
    error,
  };
}

function requestError(message: string): ModelAdapterError {
  return { code: "request.invalid", stage: "request", retryable: false, message };
}

function abortReason(signal: AbortSignal, timedOut: boolean): ModelProviderFailure {
  return timedOut
    ? new ModelProviderFailure("provider.timeout", "The model provider exceeded the configured timeout", { retryable: true })
    : new ModelProviderFailure("request.aborted", "The model request was aborted", { cause: signal.reason });
}

/**
 * The sole public gate from an untrusted model candidate into Studio. A provider
 * may only return DesignDirectorInput JSON; this function then invokes the
 * existing compiler, which enforces source coverage and the HTML importer.
 */
export async function generateWithModel(
  provider: ModelProvider,
  request: ModelGenerationRequest,
  options: GenerateWithModelOptions = {},
): Promise<ModelGenerationResult> {
  const requestId = typeof request?.requestId === "string" ? request.requestId : "invalid_request";
  if (request?.contractVersion !== MODEL_ADAPTER_CONTRACT_VERSION) return rejected(requestId, provider, requestError("Unsupported model adapter contract version"));
  if (!SAFE_ID.test(requestId)) return rejected(requestId, provider, requestError("requestId must be a stable lowercase ID"));
  if (!SAFE_ID.test(provider.providerId) || !SAFE_MODEL.test(provider.model)) return rejected(requestId, provider, requestError("Provider identity or model is invalid"));
  const inputValidation = validateDesignDirectorInput(request.input);
  if (!inputValidation.ok) return rejected(requestId, provider, requestError("Input package failed Design Director validation"));

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxCandidateBytes = options.maxCandidateBytes ?? DEFAULT_MAX_CANDIDATE_BYTES;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) return rejected(requestId, provider, requestError(`timeoutMs must be between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}`));
  if (!Number.isSafeInteger(maxCandidateBytes) || maxCandidateBytes < 1 || maxCandidateBytes > MAX_CANDIDATE_BYTES) return rejected(requestId, provider, requestError(`maxCandidateBytes must be between 1 and ${MAX_CANDIDATE_BYTES}`));
  if (request.signal?.aborted) return rejected(requestId, provider, { code: "request.aborted", stage: "request", retryable: false, message: "The model request was aborted" });

  const controller = new AbortController();
  let timedOut = false;
  const onAbort = (): void => controller.abort(request.signal?.reason);
  request.signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("model provider timeout"));
  }, timeoutMs);

  let response: ModelProviderResponse;
  try {
    const providerPromise = provider.generate({
      contractVersion: request.contractVersion,
      requestId,
      input: structuredClone(inputValidation.value),
      signal: controller.signal,
    });
    const abortPromise = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener("abort", () => reject(abortReason(controller.signal, timedOut)), { once: true });
    });
    response = await Promise.race([providerPromise, abortPromise]);
    if (controller.signal.aborted) throw abortReason(controller.signal, timedOut);
  } catch (cause) {
    const failure = controller.signal.aborted
      ? abortReason(controller.signal, timedOut)
      : cause instanceof ModelProviderFailure
        ? cause
        : new ModelProviderFailure("provider.failure", "The model provider failed", { retryable: true, cause });
    return rejected(requestId, provider, {
      code: failure.code,
      stage: failure.code === "request.aborted" ? "request" : "provider",
      retryable: failure.retryable,
      message: sanitizeMessage(failure.message, "The model provider failed"),
    });
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener("abort", onAbort);
  }

  if (!response || typeof response !== "object" || !("candidate" in response)) {
    return rejected(requestId, provider, { code: "provider.response_invalid", stage: "provider", retryable: false, message: "Provider response did not contain a candidate" });
  }
  if (byteLength(response.candidate) > maxCandidateBytes) {
    return rejected(requestId, provider, { code: "candidate.too_large", stage: "candidate", retryable: false, message: `Candidate exceeds ${maxCandidateBytes} bytes` }, response);
  }
  const candidateValidation = validateDesignDirectorInput(response.candidate);
  if (!candidateValidation.ok) {
    return rejected(requestId, provider, { code: "candidate.schema_invalid", stage: "candidate", retryable: false, message: "Model candidate failed Design Director input validation" }, response);
  }
  const output = compileDesignDirector(candidateValidation.value);
  if (output.status !== "accepted") {
    return rejected(requestId, provider, { code: "candidate.rejected", stage: "compiler", retryable: false, message: "Model candidate was rejected by the Design Director compiler or HTML importer" }, response);
  }
  const providerRequestId = safeProviderRequestId(response.providerRequestId);
  return {
    contractVersion: MODEL_ADAPTER_CONTRACT_VERSION,
    requestId,
    status: "accepted",
    provider: { id: provider.providerId, model: provider.model, ...(providerRequestId ? { requestId: providerRequestId } : {}) },
    usage: normalizeUsage(response.usage),
    output,
  };
}

export type FixtureModelProviderOptions = {
  providerId?: string;
  model?: string;
  transform?: (input: DesignDirectorInput) => unknown;
};

/** Offline-only provider for deterministic tests and demos. */
export function createFixtureModelProvider(options: FixtureModelProviderOptions = {}): ModelProvider {
  return {
    providerId: options.providerId ?? "fixture",
    model: options.model ?? "design-director-fixture-v1",
    async generate(request) {
      if (request.signal.aborted) throw new ModelProviderFailure("request.aborted", "The fixture request was aborted");
      const candidate = options.transform ? options.transform(structuredClone(request.input)) : structuredClone(request.input);
      return { candidate, providerRequestId: `fixture:${request.requestId}`, usage: EMPTY_USAGE };
    },
  };
}

export type OpenAICompatibleAdapterOptions = {
  endpoint: string;
  apiKey: string;
  model: string;
  fetch: typeof globalThis.fetch;
  providerId?: string;
  maxResponseBytes?: number;
  extraHeaders?: Readonly<Record<string, string>>;
};

const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const FORBIDDEN_HEADERS = new Set(["authorization", "cookie", "host", "content-length", "transfer-encoding"]);

function validateHttpOptions(options: OpenAICompatibleAdapterOptions): URL {
  if (typeof options.fetch !== "function") throw new TypeError("fetch must be explicitly injected");
  if (!options.apiKey.trim()) throw new TypeError("apiKey must be explicitly injected");
  if (!options.model.trim()) throw new TypeError("model must be explicitly injected");
  let endpoint: URL;
  try {
    endpoint = new URL(options.endpoint);
  } catch {
    throw new TypeError("endpoint must be an absolute URL");
  }
  if (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && (endpoint.hostname === "127.0.0.1" || endpoint.hostname === "localhost"))) {
    throw new TypeError("endpoint must use HTTPS (HTTP is allowed only for loopback tests)");
  }
  if (endpoint.username || endpoint.password || endpoint.hash) throw new TypeError("endpoint must not contain credentials or a fragment");
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > MAX_RESPONSE_BYTES) throw new TypeError(`maxResponseBytes must be between 1 and ${MAX_RESPONSE_BYTES}`);
  for (const [name, value] of Object.entries(options.extraHeaders ?? {})) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(name)) throw new TypeError(`Header ${name} has an invalid name`);
    if (FORBIDDEN_HEADERS.has(name.toLowerCase())) throw new TypeError(`Header ${name} cannot be overridden`);
    if (/[^\t\x20-\x7e]/u.test(value)) throw new TypeError(`Header ${name} contains invalid characters`);
  }
  return endpoint;
}

async function readBoundedBody(response: Response, maximum: number): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > maximum) throw new ModelProviderFailure("provider.response_too_large", `Provider response exceeds ${maximum} bytes`);
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > maximum) {
        await reader.cancel("response too large");
        throw new ModelProviderFailure("provider.response_too_large", `Provider response exceeds ${maximum} bytes`);
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    throw new ModelProviderFailure("provider.response_invalid", "Provider response was not valid UTF-8", { cause });
  }
}

type OpenAIEnvelope = {
  id?: unknown;
  choices?: unknown;
  usage?: unknown;
};

function parseOpenAIEnvelope(text: string): ModelProviderResponse {
  let envelope: OpenAIEnvelope;
  try {
    envelope = JSON.parse(text) as OpenAIEnvelope;
  } catch (cause) {
    throw new ModelProviderFailure("provider.response_invalid", "Provider returned invalid JSON", { cause });
  }
  if (!envelope || typeof envelope !== "object" || !Array.isArray(envelope.choices) || envelope.choices.length !== 1) {
    throw new ModelProviderFailure("provider.response_invalid", "Provider response must contain exactly one choice");
  }
  const choice = envelope.choices[0];
  if (!choice || typeof choice !== "object" || !("message" in choice)) throw new ModelProviderFailure("provider.response_invalid", "Provider choice did not contain a message");
  const message = choice.message;
  if (!message || typeof message !== "object" || !("content" in message) || typeof message.content !== "string") throw new ModelProviderFailure("provider.response_invalid", "Provider message content must be a JSON string");
  let candidate: unknown;
  try {
    candidate = JSON.parse(message.content);
  } catch (cause) {
    throw new ModelProviderFailure("provider.response_invalid", "Provider message content was not strict JSON", { cause });
  }
  const usage = envelope.usage && typeof envelope.usage === "object" ? envelope.usage as Record<string, unknown> : {};
  const inputTokens = normalizeCount(usage.prompt_tokens);
  const outputTokens = normalizeCount(usage.completion_tokens);
  const totalTokens = normalizeCount(usage.total_tokens);
  const normalizedUsage: ModelUsage = {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
  };
  return {
    candidate,
    ...(typeof envelope.id === "string" ? { providerRequestId: envelope.id } : {}),
    usage: normalizedUsage,
  };
}

/** Explicitly configured adapter; construction performs no I/O and reads no environment variables. */
export function createOpenAICompatibleAdapter(options: OpenAICompatibleAdapterOptions): ModelProvider {
  const endpoint = validateHttpOptions(options);
  const maximum = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const providerId = options.providerId?.trim() || "openai-compatible";
  if (!SAFE_ID.test(providerId)) throw new TypeError("providerId must be a stable lowercase ID");
  if (!SAFE_MODEL.test(options.model)) throw new TypeError("model contains unsupported characters or is too long");
  return {
    providerId,
    model: options.model,
    async generate(request) {
      let response: Response;
      try {
        response = await options.fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            authorization: `Bearer ${options.apiKey}`,
            ...options.extraHeaders,
          },
          body: JSON.stringify({
            model: options.model,
            temperature: 0,
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content: "Return exactly one JSON object matching the OpenDesign DesignDirectorInput contract. Preserve every declared source and citation. Do not return Markdown, HTML, commentary, credentials, or unsupported fields.",
              },
              { role: "user", content: JSON.stringify(request.input) },
            ],
          }),
          signal: request.signal,
          redirect: "error",
        });
      } catch (cause) {
        if (request.signal.aborted) throw cause;
        throw new ModelProviderFailure("provider.failure", "Provider network request failed", { retryable: true, cause });
      }
      const text = await readBoundedBody(response, maximum);
      if (!response.ok) {
        throw new ModelProviderFailure("provider.http_error", `Provider returned HTTP ${response.status}`, { retryable: response.status === 408 || response.status === 429 || response.status >= 500 });
      }
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (!contentType.startsWith("application/json")) throw new ModelProviderFailure("provider.response_invalid", "Provider response content type must be application/json");
      return parseOpenAIEnvelope(text);
    },
  };
}
