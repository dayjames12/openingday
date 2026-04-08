import type {
  CodeFile,
  ContextPackage,
  WirePrompt,
  WireResponse,
  WorkerOutput,
} from "../types.js";

/**
 * Convert a ContextPackage into a compact WirePrompt for LLM consumption.
 * This minimizes token usage while preserving all necessary information.
 */
export function toWirePrompt(ctx: ContextPackage): WirePrompt {
  const fileMap = (files: CodeFile[]): Record<string, { exports: { n: string; sig: string }[] }> => {
    const result: Record<string, { exports: { n: string; sig: string }[] }> = {};
    for (const file of files) {
      result[file.path] = {
        exports: file.exports.map((e) => ({ n: e.name, sig: e.signature })),
      };
    }
    return result;
  };

  return {
    task: `${ctx.task.name}: ${ctx.task.description}`,
    files: fileMap(ctx.interfaces),
    reads: fileMap([...ctx.above, ...ctx.below]),
    accept: ctx.task.acceptanceCriteria,
    memory: ctx.memory,
    budget: ctx.budget.softLimit,
    landscape: ctx.landscape,
    relevant: Object.fromEntries(
      ctx.relevant.map((f) => [f.p, { exports: f.ex.map((e) => ({ n: e.n, sig: e.s })) }])
    ),
  };
}

/**
 * Parse a compact WireResponse back into a full WorkerOutput.
 */
export function fromWireResponse(wire: WireResponse): WorkerOutput {
  const statusMap: Record<string, "complete" | "partial" | "failed"> = {
    ok: "complete",
    partial: "partial",
    fail: "failed",
  };

  return {
    status: statusMap[wire.s] ?? "failed",
    filesChanged: wire.changed,
    interfacesModified: wire.iface.map((i) => ({
      file: i.f,
      export: i.e,
      before: i.b,
      after: i.a,
    })),
    testsAdded: [],
    testResults: { pass: wire.tests.p, fail: wire.tests.f },
    notes: wire.n,
    tokensUsed: wire.t,
  };
}

/**
 * Convert a WorkerOutput into a compact WireResponse for storage/transmission.
 */
export function toWireResponse(output: WorkerOutput): WireResponse {
  const statusMap: Record<string, "ok" | "partial" | "fail"> = {
    complete: "ok",
    partial: "partial",
    failed: "fail",
  };

  return {
    s: statusMap[output.status] ?? "fail",
    changed: output.filesChanged,
    iface: output.interfacesModified.map((i) => ({
      f: i.file,
      e: i.export,
      b: i.before,
      a: i.after,
    })),
    tests: { p: output.testResults.pass, f: output.testResults.fail },
    t: output.tokensUsed,
    n: output.notes,
  };
}
