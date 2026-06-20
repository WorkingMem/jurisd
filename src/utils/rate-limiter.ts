/**
 * Simple token bucket rate limiter.
 * Tokens replenish at a fixed rate. Calls that exceed the rate
 * are queued (throttled) rather than rejected.
 */
export class RateLimiter {
  private tokens: number;
  private readonly maxTokens: number;
  private readonly refillIntervalMs: number;
  private readonly maxQueue: number;
  private lastRefill: number;
  private queue: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];
  private processing = false;

  constructor(requestsPerMinute: number, options: { maxQueue?: number } = {}) {
    if (!Number.isFinite(requestsPerMinute) || requestsPerMinute <= 0) {
      throw new Error("requestsPerMinute must be greater than zero");
    }
    this.maxTokens = requestsPerMinute;
    this.tokens = requestsPerMinute;
    this.refillIntervalMs = 60_000 / requestsPerMinute;
    this.maxQueue = options.maxQueue ?? 100;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const newTokens = Math.floor(elapsed / this.refillIntervalMs);
    if (newTokens > 0) {
      this.tokens = Math.min(this.maxTokens, this.tokens + newTokens);
      this.lastRefill = now;
    }
  }

  async throttle(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.queue.length >= this.maxQueue) {
        reject(new Error("Rate limiter queue is full"));
        return;
      }

      this.queue.push({ resolve, reject });
      this.processQueue();
    });
  }

  private processQueue(): void {
    if (this.processing) {
      return;
    }

    this.processing = true;
    this.refill();
    while (this.queue.length > 0 && this.tokens > 0) {
      this.tokens--;
      this.queue.shift()?.resolve();
    }

    if (this.queue.length === 0) {
      this.processing = false;
      return;
    }

    const elapsed = Date.now() - this.lastRefill;
    const waitMs = Math.max(this.refillIntervalMs - elapsed, 0);
    setTimeout(() => {
      this.processing = false;
      this.processQueue();
    }, waitMs);
  }
}

/** Rate limiter for AustLII: 10 requests per minute */
export const austliiRateLimiter = new RateLimiter(10);

/** Rate limiter for jade.io: 5 requests per minute */
export const jadeRateLimiter = new RateLimiter(5);

/** Rate limiter for Tavily fallback discovery: 5 requests per minute */
export const tavilyRateLimiter = new RateLimiter(5, { maxQueue: 20 });
