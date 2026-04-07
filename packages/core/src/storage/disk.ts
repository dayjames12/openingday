import { readFile, writeFile, mkdir, readdir, access } from "node:fs/promises";
import { join } from "node:path";
import type {
  ProjectConfig,
  ProjectState,
  WorkTree,
  CodeTree,
  WorkerOutput,
  GateResult,
} from "../types.js";
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
    await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
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
    try {
      await access(this.path("project.json"));
    } catch {
      await this.writeJson(this.path("project.json"), {});
    }
    try {
      await access(this.path("memory.md"));
    } catch {
      await writeFile(this.path("memory.md"), "", "utf-8");
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

  async readMemory(): Promise<string> {
    try {
      return await readFile(this.path("memory.md"), "utf-8");
    } catch {
      return "";
    }
  }

  async writeMemory(content: string): Promise<void> {
    await writeFile(this.path("memory.md"), content, "utf-8");
  }

  async appendMemory(entry: string): Promise<void> {
    const existing = await this.readMemory();
    const updated = existing ? `${existing}\n${entry}` : entry;
    await this.writeMemory(updated);
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
}
