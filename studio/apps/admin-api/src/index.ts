import { loadAdminApiConfig, createGitHubOAuthAdapter } from "./auth/index.js";
import { createAdminApiServer } from "./server.js";

export * from "./auth/index.js";
export * from "./http/index.js";
export * from "./server.js";

function isEntrypoint(): boolean {
  return process.argv[1] !== undefined && new URL(import.meta.url).pathname === process.argv[1];
}

if (isEntrypoint()) {
  const config = loadAdminApiConfig(process.env);
  const oauth = createGitHubOAuthAdapter({ clientId: config.githubClientId, clientSecret: config.githubClientSecret });
  const server = createAdminApiServer({ config, oauth });
  server.listen(config.port, config.host, () => {
    console.log(`OpenDesign Admin API listening on http://${config.host}:${config.port}`);
  });
}
