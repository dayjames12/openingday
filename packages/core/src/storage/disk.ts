import { readFile, writeFile, rename, unlink, mkdir, readdir, access } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type {
  ProjectConfig,
  ProjectState,
  WorkTree,
  CodeTree,
  WorkerOutput,
  GateResult,
  TaskDigest,
  StageResult,
} from "../types.js";
import type { RepoMap } from "../scanner/types.js";
import type { Storage } from "./interface.js";

export class DiskStorage implements Storage {
  constructor(private readonly baseDir: string) {}

  private path(...segments: string[]): string {
    return join(this.baseDir, ...segments);
  }

  private async readJson<T>(filePath: string): Promise<T> {
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content) as T;
  }

  private async writeJson<T>(filePath: string, data: T): Promise<void> {
    const tmpFile = `${filePath}.${randomBytes(8).toString("hex")}.tmp`;
    try {
      await writeFile(tmpFile, JSON.stringify(data, null, 2), "utf-8");
      await rename(tmpFile, filePath);
    } catch (err) {
      try {
        await unlink(tmpFile);
      } catch {}
      throw err;
    }
  }

  private async writeText(filePath: string, content: string): Promise<void> {
    const tmpFile = `${filePath}.${randomBytes(8).toString("hex")}.tmp`;
    try {
      await writeFile(tmpFile, content, "utf-8");
      await rename(tmpFile, filePath);
    } catch (err) {
      try {
        await unlink(tmpFile);
      } catch {}
      throw err;
    }
  }

  async exists(): Promise<boolean> {
    try {
      await access(this.path("project.json"));
      return true;
    } catch {
      return false;
    }
  }

  async initialize(): Promise<void> {
    await mkdir(this.path("workers"), { recursive: true });
    await mkdir(this.path("gates"), { recursive: true });
    await mkdir(this.path("supervisor"), { recursive: true });
    await mkdir(this.path("digests"), { recursive: true });
    await mkdir(this.path("stages"), { recursive: true });
    try {
      await access(this.path("project.json"));
    } catch {
      await this.writeJson(this.path("project.json"), {});
    }
    try {
      await access(this.path("memory.md"));
    } catch {
      await this.writeText(this.path("memory.md"), "");
    }
  }

  async readProjectConfig(): Promise<ProjectConfig> {
    return this.readJson(this.path("project.json"));
  }

  async writeProjectConfig(config: ProjectConfig): Promise<void> {
    await this.writeJson(this.path("project.json"), config);
  }

  async readProjectState(): Promise<ProjectState> {
    return this.readJson(this.path("state.json"));
  }

  async writeProjectState(state: ProjectState): Promise<void> {
    await this.writeJson(this.path("state.json"), state);
  }

  async readWorkTree(): Promise<WorkTree> {
    return this.readJson(this.path("work-tree.json"));
  }

  async writeWorkTree(tree: WorkTree): Promise<void> {
    await this.writeJson(this.path("work-tree.json"), tree);
  }

  async readCodeTree(): Promise<CodeTree> {
    return this.readJson(this.path("code-tree.json"));
  }

  async writeCodeTree(tree: CodeTree): Promise<void> {
    await this.writeJson(this.path("code-tree.json"), tree);
  }

  async writeWorkerOutput(taskId: string, output: WorkerOutput): Promise<void> {
    await this.writeJson(this.path("workers", `${taskId}.json`), output);
  }

  async readWorkerOutput(taskId: string): Promise<WorkerOutput | null> {
    try {
      return await this.readJson(this.path("workers", `${taskId}.json`));
    } catch {
      return null;
    }
  }

  async listWorkerOutputs(): Promise<string[]> {
    const files = await readdir(this.path("workers"));
    return files.filter((f) => f.endsWith(".json")).map((f) => f.replace(".json", ""));
  }

  async writeGateResult(taskId: string, result: GateResult): Promise<void> {
    const filePath = this.path("gates", `${taskId}.json`);
    let existing: GateResult[] = [];
    try {
      existing = await this.readJson(filePath);
    } catch {
      // File doesn't exist yet
    }
    existing.push(result);
    await this.writeJson(filePath, existing);
  }

  async readGateResults(taskId: string): Promise<GateResult[]> {
    try {
      return await this.readJson(this.path("gates", `${taskId}.json`));
    } catch {
      return [];
    }
  }

  async readRepoMap(): Promise<RepoMap | null> {
    try {
      return await this.readJson(this.path("repo-map.json"));
    } catch {
      return null;
    }
  }

  async writeRepoMap(map: RepoMap): Promise<void> {
    await this.writeJson(this.path("repo-map.json"), map);
  }

  async readMemory(): Promise<string> {
    try {
      return await readFile(this.path("memory.md"), "utf-8");
    } catch {
      return "";
    }
  }

  async writeMemory(content: string): Promise<void> {
    await this.writeText(this.path("memory.md"), content);
  }

  async appendMemory(entry: string): Promise<void> {
    const existing = await this.readMemory();
    const lines = existing.split("\n").filter(Boolean);
    lines.push(entry);
    // Keep last 50 entries to prevent unbounded growth
    const trimmed = lines.slice(-50);
    await this.writeMemory(trimmed.join("\n"));
  }

  async writeSupervisorLog(entry: string): Promise<void> {
    const filePath = this.path("supervisor", "logs.json");
    let existing: string[] = [];
    try {
      existing = await this.readJson(filePath);
    } catch {
      // File doesn't exist yet
    }
    existing.push(entry);
    await this.writeJson(filePath, existing);
  }

  async readSupervisorLogs(): Promise<string[]> {
    try {
      return await this.readJson(this.path("supervisor", "logs.json"));
    } catch {
      return [];
    }
  }

  async writeDigest(taskId: string, digest: TaskDigest): Promise<void> {
    await this.writeJson(this.path("digests", `${taskId}.json`), digest);
  }

  async readDigests(): Promise<TaskDigest[]> {
    try {
      const files = await readdir(this.path("digests"));
      const digests: TaskDigest[] = [];
      for (const f of files) {
        if (f.endsWith(".json")) {
          const digest = await this.readJson<TaskDigest>(this.path("digests", f));
          digests.push(digest);
        }
      }
      return digests;
    } catch {
      return [];
    }
  }

  async writeContracts(content: string): Promise<void> {
    await this.writeText(this.path("contracts.ts"), content);
  }

  async readContracts(): Promise<string> {
    try {
      return await readFile(this.path("contracts.ts"), "utf-8");
    } catch {
      return "";
    }
  }

  async writeStageResult(taskId: string, result: StageResult): Promise<void> {
    const filePath = this.path("stages", `${taskId}.json`);
    let existing: StageResult[] = [];
    try {
      existing = await this.readJson(filePath);
    } catch {
      // File doesn't exist yet
    }
    existing.push(result);
    await this.writeJson(filePath, existing);
  }

  async readStageResults(taskId: string): Promise<StageResult[]> {
    try {
      return await this.readJson(this.path("stages", `${taskId}.json`));
    } catch {
      return [];
    }
  }
}
