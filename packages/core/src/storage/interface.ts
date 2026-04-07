import type {
  ProjectConfig,
  ProjectState,
  WorkTree,
  CodeTree,
  WorkerOutput,
  GateResult,
} from "../types.js";

export interface Storage {
  readProjectConfig(): Promise<ProjectConfig>;
  writeProjectConfig(config: ProjectConfig): Promise<void>;
  readProjectState(): Promise<ProjectState>;
  writeProjectState(state: ProjectState): Promise<void>;
  readWorkTree(): Promise<WorkTree>;
  writeWorkTree(tree: WorkTree): Promise<void>;
  readCodeTree(): Promise<CodeTree>;
  writeCodeTree(tree: CodeTree): Promise<void>;
  writeWorkerOutput(taskId: string, output: WorkerOutput): Promise<void>;
  readWorkerOutput(taskId: string): Promise<WorkerOutput | null>;
  listWorkerOutputs(): Promise<string[]>;
  writeGateResult(taskId: string, result: GateResult): Promise<void>;
  readGateResults(taskId: string): Promise<GateResult[]>;
  readMemory(): Promise<string>;
  writeMemory(content: string): Promise<void>;
  appendMemory(entry: string): Promise<void>;
  writeSupervisorLog(entry: string): Promise<void>;
  readSupervisorLogs(): Promise<string[]>;
  exists(): Promise<boolean>;
  initialize(): Promise<void>;
}
