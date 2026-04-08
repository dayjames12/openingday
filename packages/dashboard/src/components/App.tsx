import { useProjectState } from "../hooks/useProjectState.js";
import { TopBar } from "./TopBar.js";
import { WorkTreePanel } from "./WorkTreePanel.js";
import { WorkersPanel } from "./WorkersPanel.js";
import { GatesPanel } from "./GatesPanel.js";
import { CostsPanel } from "./CostsPanel.js";

export function App() {
  const { state, error, loading, pause, kill } = useProjectState();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[var(--bg-primary)]">
        <p className="text-sm text-[var(--text-muted)] animate-pulse">
          Connecting to project...
        </p>
      </div>
    );
  }

  if (error && !state) {
    return (
      <div className="flex items-center justify-center h-screen bg-[var(--bg-primary)]">
        <div className="text-center">
          <p className="text-sm text-[var(--accent-red)] mb-2">Connection Error</p>
          <p className="text-xs text-[var(--text-muted)]">{error}</p>
          <p className="text-xs text-[var(--text-muted)] mt-2">
            Is the API server running on port 3001?
          </p>
        </div>
      </div>
    );
  }

  if (!state) return null;

  return (
    <div className="h-screen flex flex-col bg-[var(--bg-primary)]">
      <TopBar state={state} onPause={pause} onKill={kill} />

      {error && (
        <div className="px-4 py-1 bg-[var(--accent-red)]/10 border-b border-[var(--accent-red)]/20">
          <p className="text-xs text-[var(--accent-red)]">Polling error: {error}</p>
        </div>
      )}

      <div className="flex-1 grid grid-cols-2 grid-rows-2 gap-3 p-3 min-h-0">
        <WorkTreePanel milestones={state.workTree} />
        <WorkersPanel
          workers={state.workers}
          maxConcurrent={state.config.maxConcurrentWorkers}
        />
        <GatesPanel gates={state.gates} />
        <CostsPanel costs={state.costs} />
      </div>
    </div>
  );
}
