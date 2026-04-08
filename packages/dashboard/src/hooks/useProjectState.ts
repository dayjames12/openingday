import { useState, useEffect, useCallback, useRef } from "react";
import type { DashboardState } from "../api/types.js";

interface UseProjectStateReturn {
  state: DashboardState | null;
  error: string | null;
  loading: boolean;
  pause: () => Promise<void>;
  kill: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useProjectState(intervalMs = 2000): UseProjectStateReturn {
  const [state, setState] = useState<DashboardState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch("/api/state");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as DashboardState;
      if (mountedRef.current) {
        setState(data);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void fetchState();
    const id = setInterval(() => void fetchState(), intervalMs);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [fetchState, intervalMs]);

  const pause = useCallback(async () => {
    try {
      await fetch("/api/pause", { method: "POST" });
      await fetchState();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to pause");
    }
  }, [fetchState]);

  const kill = useCallback(async () => {
    try {
      await fetch("/api/kill", { method: "POST" });
      await fetchState();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to kill");
    }
  }, [fetchState]);

  return { state, error, loading, pause, kill, refresh: fetchState };
}
