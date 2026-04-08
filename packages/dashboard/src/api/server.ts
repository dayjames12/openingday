import express from "express";
import { readFile, writeFile, readdir, access } from "node:fs/promises";
import { join } from "node:path";
import type {
  DashboardState,
  DashboardMilestone,
  DashboardWorker,
  DashboardGateEntry,
  DashboardCosts,
} from "./types.js";

const STATE_DIR = process.env["OPENINGDAY_STATE_DIR"] ?? join(process.cwd(), ".openingday");
const PORT = Number(process.env["PORT"] ?? 3001);

// === File Helpers ===

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

// === State Assembly ===

interface RawConfig {
  name?: string;
  limits?: { maxConcurrentWorkers?: number };
  budgets?: { project?: { usd?: number } };
}

interface RawState {
  status?: string;
  totalTokenSpend?: number;
  totalWorkersSpawned?: number;
  startedAt?: string;
  pausedAt?: string | null;
}

interface RawTask {
  id: string;
  name: string;
  status: string;
  tokenSpend: number;
  attemptCount: number;
  worker: string | null;
  gateResults?: RawGateResult[];
}

interface RawSlice {
  id: string;
  name: string;
  tasks: RawTask[];
}

interface RawMilestone {
  id: string;
  name: string;
  slices: RawSlice[];
}

interface RawWorkTree {
  milestones: RawMilestone[];
}

interface RawGateResult {
  layer: string;
  pass: boolean;
  issues: { severity: string; rule: string; file: string; note?: string }[];
  timestamp: string;
}

interface RawWorkerPool {
  sessions: {
    id: string;
    taskId: string;
    status: string;
    startedAt: string;
    lastActivityAt: string;
  }[];
  totalSpawned: number;
}

function buildWorkTree(raw: RawWorkTree | null): DashboardMilestone[] {
  if (!raw?.milestones) return [];
  return raw.milestones.map((m) => ({
    id: m.id,
    name: m.name,
    slices: m.slices.map((s) => ({
      id: s.id,
      name: s.name,
      tasks: s.tasks.map((t) => ({
        id: t.id,
        name: t.name,
        status: t.status as DashboardMilestone["slices"][0]["tasks"][0]["status"],
        tokenSpend: t.tokenSpend,
        attemptCount: t.attemptCount,
        worker: t.worker,
      })),
    })),
  }));
}

function buildWorkers(
  pool: RawWorkerPool | null,
  workTree: RawWorkTree | null,
): DashboardWorker[] {
  if (!pool?.sessions) return [];
  const taskNameMap = new Map<string, string>();
  if (workTree?.milestones) {
    for (const m of workTree.milestones) {
      for (const s of m.slices) {
        for (const t of s.tasks) {
          taskNameMap.set(t.id, t.name);
        }
      }
    }
  }
  return pool.sessions
    .filter((s) => s.status === "active")
    .map((s) => ({
      id: s.id,
      taskId: s.taskId,
      taskName: taskNameMap.get(s.taskId) ?? s.taskId,
      status: s.status as DashboardWorker["status"],
      startedAt: s.startedAt,
      tokensUsed: 0,
    }));
}

async function buildGates(
  workTree: RawWorkTree | null,
): Promise<DashboardGateEntry[]> {
  const entries: DashboardGateEntry[] = [];
  const gatesDir = join(STATE_DIR, "gates");

  if (!(await fileExists(gatesDir))) return entries;

  let files: string[];
  try {
    files = await readdir(gatesDir);
  } catch {
    return entries;
  }

  // Also build a task name map from work tree
  const taskNameMap = new Map<string, string>();
  if (workTree?.milestones) {
    for (const m of workTree.milestones) {
      for (const s of m.slices) {
        for (const t of s.tasks) {
          taskNameMap.set(t.id, t.name);
        }
      }
    }
  }

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const taskId = file.replace(".json", "");
    const results = await readJson<RawGateResult[]>(join(gatesDir, file));
    if (!results) continue;
    for (const r of results) {
      entries.push({
        taskId,
        taskName: taskNameMap.get(taskId) ?? taskId,
        layer: r.layer as DashboardGateEntry["layer"],
        pass: r.pass,
        issues: r.issues,
        timestamp: r.timestamp,
      });
    }
  }

  // Sort newest first
  entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return entries;
}

function buildCosts(
  config: RawConfig | null,
  state: RawState | null,
  workTree: RawWorkTree | null,
  gates: DashboardGateEntry[],
): DashboardCosts {
  const totalTokens = state?.totalTokenSpend ?? 0;
  // Rough token-to-USD: $3/MTok input, $15/MTok output — assume average $8/MTok
  const totalSpentUsd = totalTokens * 0.000008;
  const projectBudgetUsd = config?.budgets?.project?.usd ?? 50;
  const percentUsed = projectBudgetUsd > 0 ? (totalSpentUsd / projectBudgetUsd) * 100 : 0;

  // Gate pass rate
  const totalGates = gates.length;
  const passedGates = gates.filter((g) => g.pass).length;
  const gatePassRate = totalGates > 0 ? (passedGates / totalGates) * 100 : 100;

  // Spend by category (aggregate from work tree tasks)
  const spendByCategory: Record<string, number> = {};
  if (workTree?.milestones) {
    for (const m of workTree.milestones) {
      let milestoneSpend = 0;
      for (const s of m.slices) {
        for (const t of s.tasks) {
          milestoneSpend += t.tokenSpend;
        }
      }
      if (milestoneSpend > 0) {
        spendByCategory[m.name] = milestoneSpend * 0.000008;
      }
    }
  }

  // Project completion ratio for projection
  const allTasks: RawTask[] = [];
  if (workTree?.milestones) {
    for (const m of workTree.milestones) {
      for (const s of m.slices) {
        for (const t of s.tasks) {
          allTasks.push(t);
        }
      }
    }
  }
  const completedTasks = allTasks.filter((t) => t.status === "complete").length;
  const completionRatio = allTasks.length > 0 ? completedTasks / allTasks.length : 0;
  const projectedTotalUsd = completionRatio > 0.05
    ? totalSpentUsd / completionRatio
    : totalSpentUsd;

  return {
    totalSpentUsd,
    projectBudgetUsd,
    percentUsed,
    projectedTotalUsd,
    gatePassRate,
    spendByCategory,
  };
}

async function assembleDashboardState(): Promise<DashboardState> {
  const config = await readJson<RawConfig>(join(STATE_DIR, "project.json"));
  const state = await readJson<RawState>(join(STATE_DIR, "state.json"));
  const workTree = await readJson<RawWorkTree>(join(STATE_DIR, "work-tree.json"));
  const pool = await readJson<RawWorkerPool>(join(STATE_DIR, "worker-pool.json"));
  const gates = await buildGates(workTree);
  const workers = buildWorkers(pool, workTree);
  const costs = buildCosts(config, state, workTree, gates);

  return {
    config: {
      name: config?.name ?? "Unknown Project",
      maxConcurrentWorkers: config?.limits?.maxConcurrentWorkers ?? 4,
    },
    state: {
      status: state?.status ?? "idle",
      totalTokenSpend: state?.totalTokenSpend ?? 0,
      totalWorkersSpawned: state?.totalWorkersSpawned ?? 0,
      startedAt: state?.startedAt ?? new Date().toISOString(),
      pausedAt: state?.pausedAt ?? null,
    },
    workTree: buildWorkTree(workTree),
    workers,
    gates,
    costs,
  };
}

// === Express App ===

const app = express();
app.use(express.json());

app.get("/api/state", async (_req, res) => {
  try {
    const data = await assembleDashboardState();
    res.json(data);
  } catch (err) {
    console.error("Failed to read state:", err);
    res.status(500).json({ error: "Failed to read project state" });
  }
});

app.post("/api/pause", async (_req, res) => {
  try {
    const statePath = join(STATE_DIR, "state.json");
    const state = await readJson<RawState>(statePath);
    if (!state) {
      res.status(404).json({ error: "No state file found" });
      return;
    }
    state.status = "paused";
    state.pausedAt = new Date().toISOString();
    await writeFile(statePath, JSON.stringify(state, null, 2), "utf-8");
    res.json({ ok: true, status: "paused" });
  } catch (err) {
    console.error("Failed to pause:", err);
    res.status(500).json({ error: "Failed to pause" });
  }
});

app.post("/api/kill", async (_req, res) => {
  try {
    const statePath = join(STATE_DIR, "state.json");
    const state = await readJson<RawState>(statePath);
    if (!state) {
      res.status(404).json({ error: "No state file found" });
      return;
    }
    state.status = "failed";
    await writeFile(statePath, JSON.stringify(state, null, 2), "utf-8");
    res.json({ ok: true, status: "failed" });
  } catch (err) {
    console.error("Failed to kill:", err);
    res.status(500).json({ error: "Failed to kill" });
  }
});

app.listen(PORT, () => {
  console.log(`Dashboard API server listening on http://localhost:${PORT}`);
  console.log(`Reading state from: ${STATE_DIR}`);
});
