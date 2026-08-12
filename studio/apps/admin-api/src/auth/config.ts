export interface AdminApiConfig {
  publicOrigin: string;
  adminUsername: string;
  passwordHash: string;
  signingSecret: string;
  host: "127.0.0.1";
  port: number;
  sessionTtlSeconds: number;
  databaseUrl?: string;
  auditDatabaseUrl?: string;
  auditHashKey?: string;
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new ConfigurationError(`${name} is required`);
  return value;
}

function integer(value: string | undefined, name: string, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  if (!/^\d+$/.test(value)) throw new ConfigurationError(`${name} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ConfigurationError(`${name} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function parsePublicOrigin(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigurationError("ADMIN_API_PUBLIC_ORIGIN must be a valid absolute URL");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new ConfigurationError("ADMIN_API_PUBLIC_ORIGIN must be an HTTPS origin without credentials, path, query, or fragment");
  }
  return url.origin;
}

export function loadAdminApiConfig(env: NodeJS.ProcessEnv): AdminApiConfig {
  const host = env.ADMIN_API_HOST?.trim() || "127.0.0.1";
  if (host !== "127.0.0.1") throw new ConfigurationError("ADMIN_API_HOST must be 127.0.0.1");
  const adminUsername = required(env, "ADMIN_API_ADMIN_USERNAME");
  if (adminUsername !== "admin") throw new ConfigurationError("ADMIN_API_ADMIN_USERNAME must be admin");
  const passwordHash = required(env, "ADMIN_API_PASSWORD_HASH");
  if (passwordHash.length > 512) throw new ConfigurationError("ADMIN_API_PASSWORD_HASH is too long");

  const signingSecret = required(env, "ADMIN_API_SIGNING_SECRET");
  if (Buffer.byteLength(signingSecret, "utf8") < 32) {
    throw new ConfigurationError("ADMIN_API_SIGNING_SECRET must contain at least 32 bytes");
  }

  const databaseUrl = env.ADMIN_DATABASE_URL?.trim();
  const auditDatabaseUrl = env.ADMIN_AUDIT_DATABASE_URL?.trim();
  const auditHashKey = env.ADMIN_API_AUDIT_HASH_KEY?.trim();
  if ((databaseUrl || auditDatabaseUrl || auditHashKey) && !(databaseUrl && auditDatabaseUrl && auditHashKey)) {
    throw new ConfigurationError("ADMIN_DATABASE_URL, ADMIN_AUDIT_DATABASE_URL and ADMIN_API_AUDIT_HASH_KEY must be configured together");
  }
  if (auditHashKey && Buffer.byteLength(auditHashKey, "utf8") < 32) {
    throw new ConfigurationError("ADMIN_API_AUDIT_HASH_KEY must contain at least 32 bytes");
  }
  return {
    publicOrigin: parsePublicOrigin(required(env, "ADMIN_API_PUBLIC_ORIGIN")),
    adminUsername,
    passwordHash,
    signingSecret,
    host,
    port: integer(env.ADMIN_API_PORT, "ADMIN_API_PORT", 8790, 1, 65_535),
    sessionTtlSeconds: integer(env.ADMIN_API_SESSION_TTL_SECONDS, "ADMIN_API_SESSION_TTL_SECONDS", 900, 60, 3_600),
    ...(databaseUrl ? { databaseUrl } : {}),
    ...(auditDatabaseUrl ? { auditDatabaseUrl } : {}),
    ...(auditHashKey ? { auditHashKey } : {}),
  };
}
