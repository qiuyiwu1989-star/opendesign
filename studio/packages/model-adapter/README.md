# Studio Model Adapter

Provider-neutral boundary for model-assisted Studio generation. The package is
offline by default: it reads no environment variables, imports no credentials,
and makes no request unless a caller explicitly constructs an HTTP provider and
injects `endpoint`, `apiKey`, `model`, and `fetch`.

## Stable exports

- `generateWithModel(provider, request, options)` is the only candidate admission
  gate. A provider returns untrusted `DesignDirectorInput` JSON; the gate validates
  it and calls the existing `compileDesignDirector`, including source coverage and
  Structured HTML importer checks.
- `createFixtureModelProvider()` is deterministic and network-free.
- `createOpenAICompatibleAdapter(options)` implements a bounded, abortable
  chat-completions-style HTTP adapter using explicit runtime configuration.
- Request/result/error/usage contracts and `ModelProvider` allow another provider
  to be implemented without leaking vendor fields into Studio domain objects.

Providers cannot submit a prebuilt accepted output or HTML. Timeout, caller abort,
HTTP failure, non-JSON content, malformed envelopes, response/candidate size
limits, unknown fields, invalid Design Packs, incomplete source coverage, and
import failure all return a rejected result with no accepted output.

## Intentional limits

- No real-provider smoke test is run without separately supplied runtime
  configuration and authorization.
- Token counts are telemetry only; cost is not inferred because provider pricing
  is external and time-varying.
- The adapter does not persist drafts, approve candidates, publish, or retry.
  Those are caller-owned workflow decisions.
