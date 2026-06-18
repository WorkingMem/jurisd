/**
 * Simple token bucket rate limiter.
 * Tokens replenish at a fixed rate. Calls that exceed the rate
 * are queued (throttled) rather than rejected.
 */
export class RateLimiter {
    tokens;
    maxTokens;
    refillIntervalMs;
    lastRefill;
    constructor(requestsPerMinute) {
        this.maxTokens = requestsPerMinute;
        this.tokens = requestsPerMinute;
        this.refillIntervalMs = 60_000 / requestsPerMinute;
        this.lastRefill = Date.now();
    }
    refill() {
        const now = Date.now();
        const elapsed = now - this.lastRefill;
        const newTokens = Math.floor(elapsed / this.refillIntervalMs);
        if (newTokens > 0) {
            this.tokens = Math.min(this.maxTokens, this.tokens + newTokens);
            this.lastRefill = now;
        }
    }
    async throttle() {
        this.refill();
        if (this.tokens > 0) {
            this.tokens--;
            return;
        }
        // Wait for next token
        await new Promise((resolve) => setTimeout(resolve, this.refillIntervalMs));
        this.tokens--;
    }
}
/** Rate limiter for AustLII: 10 requests per minute */
export const austliiRateLimiter = new RateLimiter(10);
/** Rate limiter for removed.invalid: 5 requests per minute */
export const upstreamRateLimiter = new RateLimiter(5);
//# sourceMappingURL=rate-limiter.js.map