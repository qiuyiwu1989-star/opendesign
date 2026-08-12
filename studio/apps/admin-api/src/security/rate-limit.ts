export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  consume(key: string, now?: number): RateLimitDecision;
}

interface Counter { count: number; resetAt: number }

export class FixedWindowRateLimiter implements RateLimiter {
  readonly #entries = new Map<string, Counter>();

  constructor(readonly limit: number, readonly windowMs: number, readonly maxKeys = 10_000) {
    if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1_000) {
      throw new Error("Invalid rate limit configuration");
    }
  }

  consume(key: string, now = Date.now()): RateLimitDecision {
    if (!key || key.length > 256) throw new Error("Invalid rate-limit key");
    if (this.#entries.size >= this.maxKeys && !this.#entries.has(key)) this.#prune(now);
    if (this.#entries.size >= this.maxKeys && !this.#entries.has(key)) {
      return { allowed: false, limit: this.limit, remaining: 0, retryAfterSeconds: Math.ceil(this.windowMs / 1_000) };
    }
    const current = this.#entries.get(key);
    const entry = !current || current.resetAt <= now ? { count: 0, resetAt: now + this.windowMs } : current;
    entry.count += 1;
    this.#entries.set(key, entry);
    const allowed = entry.count <= this.limit;
    return {
      allowed,
      limit: this.limit,
      remaining: Math.max(0, this.limit - entry.count),
      retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((entry.resetAt - now) / 1_000)),
    };
  }

  #prune(now: number): void {
    for (const [key, entry] of this.#entries) if (entry.resetAt <= now) this.#entries.delete(key);
  }
}
