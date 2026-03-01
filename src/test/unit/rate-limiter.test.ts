import { describe, it, expect } from "vitest";
import { RateLimiter } from "../../utils/rate-limiter.js";

describe("RateLimiter", () => {
  it("allows immediate calls within limit", async () => {
    const limiter = new RateLimiter(10);
    const start = Date.now();
    await limiter.throttle();
    await limiter.throttle();
    // Should not have waited
    expect(Date.now() - start).toBeLessThan(100);
  });

  it("creates austliiRateLimiter and upstreamRateLimiter singletons", async () => {
    const { austliiRateLimiter, upstreamRateLimiter } = await import("../../utils/rate-limiter.js");
    expect(austliiRateLimiter).toBeDefined();
    expect(upstreamRateLimiter).toBeDefined();
  });
});
