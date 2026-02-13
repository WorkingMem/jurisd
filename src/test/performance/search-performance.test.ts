import { describe, it, expect } from "vitest";
import { searchAustLii } from "../../services/austlii.js";

describe("Search Performance", () => {
  it("should complete a simple case search within 10 seconds", async () => {
    const startTime = Date.now();
    
    const results = await searchAustLii("negligence", { 
      type: "case",
      limit: 10 
    });
    
    const duration = Date.now() - startTime;
    expect(results.length).toBeGreaterThan(0);
    expect(duration).toBeLessThan(10000);
  }, 15000);

  it("should complete a legislation search within 10 seconds", async () => {
    const startTime = Date.now();
    
    const results = await searchAustLii("privacy", { 
      type: "legislation",
      limit: 5 
    });
    
    const duration = Date.now() - startTime;
    expect(results.length).toBeGreaterThan(0);
    expect(duration).toBeLessThan(10000);
  }, 15000);

  it("should handle concurrent searches within 15 seconds", async () => {
    const searches = [
      searchAustLii("negligence", { type: "case", limit: 5 }),
      searchAustLii("contract breach", { type: "case", limit: 5 }),
      searchAustLii("privacy act", { type: "legislation", limit: 5 }),
    ];

    const startTime = Date.now();
    const results = await Promise.all(searches);
    const duration = Date.now() - startTime;

    expect(results).toHaveLength(3);
    results.forEach((r) => expect(r.length).toBeGreaterThan(0));
    expect(duration).toBeLessThan(15000);
  }, 20000);

  it("should handle large result sets efficiently", async () => {
    const startTime = Date.now();
    
    const results = await searchAustLii("law", { 
      type: "case",
      limit: 50 
    });
    
    const duration = Date.now() - startTime;
    expect(results.length).toBeGreaterThan(0);
    expect(duration).toBeLessThan(15000);
  }, 20000);
});
