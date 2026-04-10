export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
};

export function isRateLimitError(err: Error): boolean {
  return err.message?.includes("429") || err.message?.includes("rate_limit") || err.message?.includes("Rate limit");
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY,
  shouldRetry?: (err: Error) => boolean,
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (shouldRetry && !shouldRetry(lastError)) throw lastError;
      if (attempt < config.maxAttempts) {
        const isRL = isRateLimitError(lastError);
        const delay = isRL
          ? Math.max(30000, config.baseDelayMs * Math.pow(2, attempt - 1))
          : Math.min(config.baseDelayMs * Math.pow(2, attempt - 1), config.maxDelayMs);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError!;
}
