# Studio public generation v0.7 operations

## Required server configuration

Create `/etc/opendesign/studio-api.env` as root, mode `0600`, owned by root. Do not commit its values.

```dotenv
STUDIO_PUBLIC_SESSION_SECRET=<at-least-32-random-bytes>
STUDIO_GENERATION_MODE=live
STUDIO_GENERATION_ENDPOINT=https://provider.example/v1/chat/completions
STUDIO_GENERATION_MODEL=<model-id>
STUDIO_GENERATION_API_KEY=<server-side-key>
STUDIO_GENERATION_PROVIDER_ID=<lowercase-provider-id>
```

`STUDIO_GENERATION_MODE=fixture` is allowed only for an explicitly labelled non-production demo. Missing or invalid live configuration becomes `generationMode=unavailable`; it never silently falls back to fixture.

## Preflight

1. Verify the env file is `0600` and never print its contents.
2. Build the immutable Studio release and run the repository release gate.
3. Start the candidate API on a spare loopback port with the same service user and data directory copy.
4. Confirm `/api/health` reports the intended `generationMode` without a credential.
5. Use two independent cookie jars. Create one project and one fixture/mock job in jar A; jar B must receive `404` for both IDs and an empty project list.
6. Confirm the first response sets `HttpOnly; Secure; SameSite=Lax; Path=/` and a seven-day `Max-Age`.

## Runtime evidence

- Generation states are persisted under `sessions/<scope>/generation-jobs`; the public response never contains the scope or submitted content.
- Projects, revisions, reviews, assets and exports are stored under the same server-derived scope.
- The active-task ceiling is two per scope. A third task returns `429`.
- Anonymous data expires after seven idle days and can never outlive thirty days from creation.

## Cleanup

Run the cleanup function first with `dryRun: true` and archive only its structural summary (scope hash, counts, bytes, action). A real cleanup refuses malformed scopes, symlinks and mismatched metadata. Do not delete a user-supplied path.

## Rollback

Use the existing Studio pointer rollback. Keep `/var/lib/opendesign-studio/sessions` intact: rolling back code must not delete anonymous data. If the previous release does not understand scoped storage, it may show an empty list but must not migrate data into the legacy shared directory.
