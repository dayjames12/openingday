import { describe, it, expect } from "vitest";
import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type { WirePrompt } from "../types.js";
import { buildSystemPrompt, buildUserPrompt, parseSpawnResult } from "./spawner.js";

describe("spawner", () => {
  describe("buildSystemPrompt", () => {
    it("contains wire mode instructions", () => {
      const prompt = buildSystemPrompt();
      expect(prompt).toContain("wire mode");
    });

    it("contains WireResponse schema reference", () => {
      const prompt = buildSystemPrompt();
      expect(prompt).toContain("WireResponse");
    });

    it("instructs JSON-only output", () => {
      const prompt = buildSystemPrompt();
      expect(prompt).toContain("JSON");
    });
  });

  describe("buildUserPrompt", () => {
    const sampleWire: WirePrompt = {
      task: "JWT middleware: Implement JWT auth",
      files: {
        "src/auth/middleware.ts": {
          exports: [{ n: "authMiddleware", sig: "(opts: AuthOpts) => Middleware" }],
        },
      },
      reads: {
        "src/auth/types.ts": {
          exports: [{ n: "AuthOpts", sig: "interface AuthOpts" }],
        },
      },
      accept: ["Validates tokens"],
      memory: "Use jose library",
      budget: 50000,
      landscape: { mc: 0, fc: 0, modules: [] },
      relevant: {},
    };

    it("contains the task name", () => {
      const prompt = buildUserPrompt(sampleWire);
      expect(prompt).toContain("JWT middleware");
    });

    it("contains file names from the wire prompt", () => {
      const prompt = buildUserPrompt(sampleWire);
      expect(prompt).toContain("src/auth/middleware.ts");
      expect(prompt).toContain("src/auth/types.ts");
    });

    it("produces valid JSON", () => {
      const prompt = buildUserPrompt(sampleWire);
      const parsed = JSON.parse(prompt) as WirePrompt;
      expect(parsed.task).toBe(sampleWire.task);
      expect(parsed.budget).toBe(50000);
    });
  });

  describe("parseSpawnResult", () => {
    const baseUsage = {
      input_tokens: 10000,
      output_tokens: 5000,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      server_tool_use_input_tokens: 0,
    };

    it("parses a successful result with wire JSON", () => {
      const wireJson = JSON.stringify({
        s: "ok",
        changed: ["src/auth/middleware.ts"],
        iface: [{ f: "src/auth/middleware.ts", e: "authMiddleware", b: "() => void", a: "() => string" }],
        tests: { p: 3, f: 0 },
        t: 8000,
        n: "Implemented JWT middleware",
      });

      const msg: SDKResultMessage = {
        type: "result",
        subtype: "success",
        result: wireJson,
        total_cost_usd: 0.12,
        num_turns: 5,
        is_error: false,
        duration_ms: 30000,
        duration_api_ms: 25000,
        usage: baseUsage,
        modelUsage: {},
        permission_denials: [],
        uuid: "test" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: "sess-123",
      };

      const result = parseSpawnResult(msg);
      expect(result.output.status).toBe("complete");
      expect(result.output.filesChanged).toEqual(["src/auth/middleware.ts"]);
      expect(result.output.testResults).toEqual({ pass: 3, fail: 0 });
      expect(result.output.notes).toBe("Implemented JWT middleware");
      expect(result.costUsd).toBe(0.12);
      expect(result.sessionId).toBe("sess-123");
    });

    it("handles partial status in wire response", () => {
      const wireJson = JSON.stringify({
        s: "partial",
        changed: ["a.ts"],
        iface: [],
        tests: { p: 1, f: 1 },
        t: 4000,
        n: "Partial progress",
      });

      const msg: SDKResultMessage = {
        type: "result",
        subtype: "success",
        result: wireJson,
        total_cost_usd: 0.08,
        num_turns: 3,
        is_error: false,
        duration_ms: 20000,
        duration_api_ms: 18000,
        usage: baseUsage,
        modelUsage: {},
        permission_denials: [],
        uuid: "test" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: "sess-456",
      };

      const result = parseSpawnResult(msg);
      expect(result.output.status).toBe("partial");
    });

    it("returns failed status on error subtype", () => {
      const msg: SDKResultMessage = {
        type: "result",
        subtype: "error_max_budget_usd",
        total_cost_usd: 2.0,
        num_turns: 20,
        is_error: true,
        duration_ms: 60000,
        duration_api_ms: 55000,
        usage: baseUsage,
        modelUsage: {},
        permission_denials: [],
        errors: ["Budget exceeded"],
        uuid: "test" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: "sess-789",
      };

      const result = parseSpawnResult(msg);
      expect(result.output.status).toBe("failed");
      expect(result.output.notes).toContain("error_max_budget_usd");
      expect(result.output.notes).toContain("Budget exceeded");
      expect(result.costUsd).toBe(2.0);
      expect(result.sessionId).toBe("sess-789");
    });

    it("returns failed status when result text is invalid JSON", () => {
      const msg: SDKResultMessage = {
        type: "result",
        subtype: "success",
        result: "not valid json at all",
        total_cost_usd: 0.05,
        num_turns: 2,
        is_error: false,
        duration_ms: 10000,
        duration_api_ms: 8000,
        usage: baseUsage,
        modelUsage: {},
        permission_denials: [],
        uuid: "test" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: "sess-bad",
      };

      const result = parseSpawnResult(msg);
      expect(result.output.status).toBe("failed");
      expect(result.output.notes).toContain("Failed to parse wire response");
      expect(result.costUsd).toBe(0.05);
    });

    it("uses structured_output when available", () => {
      const wireObj = {
        s: "ok" as const,
        changed: ["src/a.ts"],
        iface: [],
        tests: { p: 2, f: 0 },
        t: 5000,
        n: "Done via structured output",
      };

      const msg = {
        type: "result" as const,
        subtype: "success" as const,
        result: "some raw text",
        structured_output: wireObj,
        total_cost_usd: 0.10,
        num_turns: 3,
        is_error: false,
        duration_ms: 15000,
        duration_api_ms: 12000,
        usage: baseUsage,
        modelUsage: {},
        permission_denials: [],
        uuid: "test" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: "sess-structured",
      } as SDKResultMessage;

      const result = parseSpawnResult(msg);
      expect(result.output.status).toBe("complete");
      expect(result.output.notes).toBe("Done via structured output");
    });

    it("extracts JSON from markdown-wrapped response", () => {
      const wireJson = JSON.stringify({
        s: "ok",
        changed: ["src/b.ts"],
        iface: [],
        tests: { p: 1, f: 0 },
        t: 3000,
        n: "Extracted from markdown",
      });
      const wrapped = `Here is my response:\n\`\`\`json\n${wireJson}\n\`\`\`\nDone!`;

      const msg: SDKResultMessage = {
        type: "result",
        subtype: "success",
        result: wrapped,
        total_cost_usd: 0.06,
        num_turns: 2,
        is_error: false,
        duration_ms: 10000,
        duration_api_ms: 8000,
        usage: baseUsage,
        modelUsage: {},
        permission_denials: [],
        uuid: "test" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: "sess-md",
      };

      const result = parseSpawnResult(msg);
      expect(result.output.status).toBe("complete");
      expect(result.output.notes).toBe("Extracted from markdown");
    });

    it("extracts JSON from surrounding prose", () => {
      const wireJson = JSON.stringify({
        s: "partial",
        changed: ["src/c.ts"],
        iface: [],
        tests: { p: 0, f: 1 },
        t: 2000,
        n: "Partial from prose",
      });
      const wrapped = `I completed the task partially. ${wireJson} That is all.`;

      const msg: SDKResultMessage = {
        type: "result",
        subtype: "success",
        result: wrapped,
        total_cost_usd: 0.04,
        num_turns: 1,
        is_error: false,
        duration_ms: 5000,
        duration_api_ms: 4000,
        usage: baseUsage,
        modelUsage: {},
        permission_denials: [],
        uuid: "test" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: "sess-prose",
      };

      const result = parseSpawnResult(msg);
      expect(result.output.status).toBe("partial");
      expect(result.output.notes).toBe("Partial from prose");
    });

    it("fails gracefully on malformed JSON", () => {
      const msg: SDKResultMessage = {
        type: "result",
        subtype: "success",
        result: '{ "s": "ok", broken json here }}}',
        total_cost_usd: 0.03,
        num_turns: 1,
        is_error: false,
        duration_ms: 5000,
        duration_api_ms: 4000,
        usage: baseUsage,
        modelUsage: {},
        permission_denials: [],
        uuid: "test" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: "sess-malformed",
      };

      const result = parseSpawnResult(msg);
      expect(result.output.status).toBe("failed");
      expect(result.output.notes.length).toBeLessThanOrEqual(500);
    });

    it("truncates long error notes to 500 chars", () => {
      const msg: SDKResultMessage = {
        type: "result",
        subtype: "error_during_execution",
        total_cost_usd: 0.01,
        num_turns: 1,
        is_error: true,
        duration_ms: 1000,
        duration_api_ms: 800,
        usage: baseUsage,
        modelUsage: {},
        permission_denials: [],
        errors: ["x".repeat(1000)],
        uuid: "test" as `${string}-${string}-${string}-${string}-${string}`,
        session_id: "sess-long",
      };

      const result = parseSpawnResult(msg);
      expect(result.output.notes.length).toBeLessThanOrEqual(500);
    });
  });
});
