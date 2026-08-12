import { loadAdminApiConfig, createGitHubOAuthAdapter } from "./auth/index.js";
import { DatabaseAuditSink } from "./audit/index.js";
import { createPostgresClient, OperationsRepository, readSyncEvidence } from "./data/index.js";
import { createAdminApiServer } from "./server.js";

export * from "./auth/index.js";
export * from "./audit/index.js";
export * from "./data/index.js";
export * from "./http/index.js";
export * from "./security/index.js";
export * from "./server.js";

function isEntrypoint(): boolean {
  return process.argv[1] !== undefined && new URL(import.meta.url).pathname === process.argv[1];
}

if (isEntrypoint()) {
  const config = loadAdminApiConfig(process.env);
  const oauth = createGitHubOAuthAdapter({ clientId: config.githubClientId, clientSecret: config.githubClientSecret });
  const readClient = config.databaseUrl ? createPostgresClient(config.databaseUrl) : undefined;
  const auditClient = config.auditDatabaseUrl ? createPostgresClient(config.auditDatabaseUrl, { readOnly: false }) : undefined;
  const repository = readClient ? new OperationsRepository(readClient) : undefined;
  const audit = auditClient ? new DatabaseAuditSink(auditClient) : undefined;
  const server = createAdminApiServer({
    config,
    oauth,
    evidence: {
      ...(repository ? { operations: ({ signal }) => repository.readOperations(signal) } : {}),
      ...(repository ? { sync: ({ signal }) => readSyncEvidence(repository, signal) } : {}),
    },
    ...(readClient ? { readiness: () => readClient.ready() } : {}),
    ...(audit && config.auditHashKey ? {
      audit,
      auditHashKey: config.auditHashKey,
      onAuditFailure: (requestId: string) => {
        console.error(JSON.stringify({ event: "admin_api_audit_write_failed", requestId }));
      },
    } : {}),
  });
  const shutdown = (): void => {
    server.close(() => {
      void Promise.all([readClient?.close(), auditClient?.close()]).finally(() => process.exit(0));
    });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  server.listen(config.port, config.host, () => {
    console.log(`OpenDesign Admin API listening on http://${config.host}:${config.port}`);
  });
}
