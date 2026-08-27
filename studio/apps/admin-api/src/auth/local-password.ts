import { scrypt, timingSafeEqual } from "node:crypto";
const FORMAT = "scrypt";
const KEY_BYTES = 32;
const MAX_PASSWORD_BYTES = 1024;
const MAX_MEMORY = 64 * 1024 * 1024;

export interface LocalPasswordVerifier {
  verify(password: string): Promise<boolean>;
}

interface ParsedPasswordHash {
  cost: number;
  blockSize: number;
  parallelization: number;
  salt: Buffer;
  digest: Buffer;
}

function positiveInteger(value: string): number | undefined {
  if (!/^[1-9]\d*$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function base64url(value: string): Buffer | undefined {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return undefined;
  try {
    return Buffer.from(value, "base64url");
  } catch {
    return undefined;
  }
}

export function parsePasswordHash(encoded: string): ParsedPasswordHash {
  const [format, rawCost, rawBlockSize, rawParallelization, rawSalt, rawDigest, ...extra] = encoded.split("$");
  const cost = rawCost ? positiveInteger(rawCost) : undefined;
  const blockSize = rawBlockSize ? positiveInteger(rawBlockSize) : undefined;
  const parallelization = rawParallelization ? positiveInteger(rawParallelization) : undefined;
  const salt = rawSalt ? base64url(rawSalt) : undefined;
  const digest = rawDigest ? base64url(rawDigest) : undefined;
  if (format !== FORMAT || extra.length || cost !== 32_768 || blockSize !== 8 || parallelization !== 1
      || !salt || salt.length !== 16 || !digest || digest.length !== KEY_BYTES) {
    throw new Error("ADMIN_API_PASSWORD_HASH must use the reviewed scrypt format");
  }
  return { cost, blockSize, parallelization, salt, digest };
}

export function createLocalPasswordVerifier(encoded: string): LocalPasswordVerifier {
  const parsed = parsePasswordHash(encoded);
  return {
    async verify(password) {
      if (typeof password !== "string" || Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES) return false;
      const derived = await new Promise<Buffer>((resolve, reject) => {
        scrypt(password, parsed.salt, KEY_BYTES, {
          N: parsed.cost,
          r: parsed.blockSize,
          p: parsed.parallelization,
          maxmem: MAX_MEMORY,
        }, (error, key) => error ? reject(error) : resolve(key));
      });
      return derived.length === parsed.digest.length && timingSafeEqual(derived, parsed.digest);
    },
  };
}
