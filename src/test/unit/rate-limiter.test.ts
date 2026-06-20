import { describe, it, expect, vi } from "vitest";
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

  it("creates austliiRateLimiter and jadeRateLimiter singletons", async () => {
    const { austliiRateLimiter, jadeRateLimiter } = await import("../../utils/rate-limiter.js");
    expect(austliiRateLimiter).toBeDefined();
    expect(jadeRateLimiter).toBeDefined();
  });

  it("refills tokens after the refill interval elapses", async () => {
    vi.useFakeTimers();
    try {
      const limiter = new RateLimiter(1); // refillIntervalMs = 60 000ms
      await limiter.throttle(); // consume the single token

      // Advance past the refill interval so refill() adds a new token
      vi.advanceTimersByTime(60_001);

      // Second call should succeed without waiting (token was refilled)
      const done = vi.fn();
      const p = limiter.throttle().then(done);
      // The throttle() call is synchronous up to the first await — it won't need
      // the setTimeout path because a token was refilled by the time-advance above.
      await vi.runAllTimersAsync();
      await p;
      expect(done).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits refillIntervalMs when tokens are exhausted", async () => {
    vi.useFakeTimers();
    try {
      const limiter = new RateLimiter(1); // refillIntervalMs = 60 000ms
      await limiter.throttle(); // use the one token

      let resolved = false;
      const secondCall = limiter.throttle().then(() => {
        resolved = true;
      });

      // Not yet resolved — waiting in setTimeout
      expect(resolved).toBe(false);

      // Advance time past the wait period
      await vi.advanceTimersByTimeAsync(60_000);
      await secondCall;

      expect(resolved).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not add tokens when elapsed time is less than refillIntervalMs", async () => {
    vi.useFakeTimers();
    try {
      const limiter = new RateLimiter(2); // refillIntervalMs = 30 000ms
      await limiter.throttle(); // tokens: 1
      await limiter.throttle(); // tokens: 0

      // Advance by only half the refill interval — no tokens should be added
      vi.advanceTimersByTime(15_000);

      // Next call should wait (tokens still 0 after partial advance)
      let resolved = false;
      const waitCall = limiter.throttle().then(() => {
        resolved = true;
      });
      expect(resolved).toBe(false);

      // Advance remaining time to fully satisfy the wait
      await vi.advanceTimersByTimeAsync(30_000);
      await waitCall;
      expect(resolved).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("serializes concurrent waiters instead of releasing them in one refill", async () => {
    vi.useFakeTimers();
    try {
      const limiter = new RateLimiter(1);
      await limiter.throttle();

      let firstResolved = false;
      let secondResolved = false;
      const first = limiter.throttle().then(() => {
        firstResolved = true;
      });
      const second = limiter.throttle().then(() => {
        secondResolved = true;
      });

      await vi.advanceTimersByTimeAsync(60_000);
      await first;
      expect(firstResolved).toBe(true);
      expect(secondResolved).toBe(false);

      await vi.advanceTimersByTimeAsync(60_000);
      await second;
      expect(secondResolved).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects when the queue cap is reached", async () => {
    vi.useFakeTimers();
    try {
      const limiter = new RateLimiter(1, { maxQueue: 1 });
      await limiter.throttle();

      const queued = limiter.throttle();
      await expect(limiter.throttle()).rejects.toThrow("Rate limiter queue is full");

      await vi.advanceTimersByTimeAsync(60_000);
      await queued;
    } finally {
      vi.useRealTimers();
    }
  });
});
