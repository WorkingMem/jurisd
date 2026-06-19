/**
 * Simple token bucket rate limiter.
 * Tokens replenish at a fixed rate. Calls that exceed the rate
 * are queued (throttled) rather than rejected.
 */
export declare class RateLimiter {
    private tokens;
    private readonly maxTokens;
    private readonly refillIntervalMs;
    private readonly maxQueue;
    private lastRefill;
    private queue;
    private processing;
    constructor(requestsPerMinute: number, options?: {
        maxQueue?: number;
    });
    private refill;
    throttle(): Promise<void>;
    private processQueue;
}
/** Rate limiter for AustLII: 10 requests per minute */
export declare const austliiRateLimiter: RateLimiter;
/** Rate limiter for removed.invalid: 5 requests per minute */
export declare const upstreamRateLimiter: RateLimiter;
/** Rate limiter for Tavily fallback discovery: 5 requests per minute */
export declare const tavilyRateLimiter: RateLimiter;
//# sourceMappingURL=rate-limiter.d.ts.map