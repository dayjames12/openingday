import { describe, it, expect } from "vitest";
import { withRetry } from "./retry.js";

describe("withRetry", () => {
  it("returns immediately on first success", async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      return "ok";
    });
    expect(result).toBe("ok");
    expect(calls).toBe(1);
  });

  it("succeeds on second attempt after transient failure", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls === 1) throw new Error("transient");
        return "recovered";
      },
      { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 10 },
    );
    expect(result).toBe("recovered");
    expect(calls).toBe(2);
  });

  it("exhausts all attempts and throws last error", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error(`fail-${calls}`);
        },
        { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 10 },
      ),
    ).rejects.toThrow("fail-3");
    expect(calls).toBe(3);
  });

  it("wraps non-Error throws as Error", async () => {
    await expect(
      withRetry(
        async () => {
          throw "string error";
        },
        { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 10 },
      ),
    ).rejects.toThrow("string error");
  });

  it("respects maxDelayMs cap", async () => {
    let calls = 0;
    const start = Date.now();
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error("fail");
        },
        { maxAttempts: 3, baseDelayMs: 5, maxDelayMs: 10 },
      ),
    ).rejects.toThrow();
    // With baseDelay 5 and maxDelay 10, delays are 5ms and 10ms = 15ms total max
    // Should complete within reasonable time
    expect(Date.now() - start).toBeLessThan(500);
    expect(calls).toBe(3);
  });
});
