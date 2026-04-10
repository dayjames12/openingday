import type { EnrichedContextPackage } from "../types.js";

const cache = new Map<string, { ctx: EnrichedContextPackage; timestamp: number }>();
const TTL = 5 * 60 * 1000; // 5 minutes

export function getCachedContext(taskId: string): EnrichedContextPackage | null {
  const entry = cache.get(taskId);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > TTL) {
    cache.delete(taskId);
    return null;
  }
  return entry.ctx;
}

export function setCachedContext(taskId: string, ctx: EnrichedContextPackage): void {
  cache.set(taskId, { ctx, timestamp: Date.now() });
}

export function invalidateContext(taskId: string): void {
  cache.delete(taskId);
}

export function clearContextCache(): void {
  cache.clear();
}
