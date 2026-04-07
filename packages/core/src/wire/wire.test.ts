import { describe, it, expect } from "vitest";
import { toWirePrompt, fromWireResponse, toWireResponse } from "./wire.js";
import type { ContextPackage, WireResponse, WorkerOutput } from "../types.js";

describe("wire", () => {
  const sampleContext: ContextPackage = {
    task: {
      name: "JWT middleware",
      description: "Implement JWT auth middleware",
      acceptanceCriteria: ["Validates tokens", "Returns 401 on invalid token"],
    },
    interfaces: [
      {
        path: "src/auth/middleware.ts",
        description: "JWT middleware",
        exports: [
          { name: "authMiddleware", signature: "(opts: AuthOpts) => Middleware", description: "MW" },
        ],
        imports: [{ from: "src/auth/types", names: ["AuthOpts"] }],
        lastModifiedBy: null,
      },
    ],
    above: [
      {
        path: "src/auth/types.ts",
        description: "Auth types",
        exports: [
          { name: "AuthOpts", signature: "interface AuthOpts", description: "Options" },
        ],
        imports: [],
        lastModifiedBy: null,
      },
    ],
    below: [],
    memory: "Use jose library for JWT",
    rules: "strict mode",
    budget: { softLimit: 50000, hardLimit: 100000 },
  };

  describe("toWirePrompt", () => {
    it("converts context package to compact wire format", () => {
      const wire = toWirePrompt(sampleContext);

      expect(wire.task).toBe("JWT middleware: Implement JWT auth middleware");
      expect(wire.accept).toEqual(["Validates tokens", "Returns 401 on invalid token"]);
      expect(wire.memory).toBe("Use jose library for JWT");
      expect(wire.budget).toBe(50000);
    });

    it("maps interface files to compact format", () => {
      const wire = toWirePrompt(sampleContext);

      expect(wire.files["src/auth/middleware.ts"]).toBeDefined();
      expect(wire.files["src/auth/middleware.ts"].exports).toEqual([
        { n: "authMiddleware", sig: "(opts: AuthOpts) => Middleware" },
      ]);
    });

    it("maps above and below files into reads", () => {
      const wire = toWirePrompt(sampleContext);

      expect(wire.reads["src/auth/types.ts"]).toBeDefined();
      expect(wire.reads["src/auth/types.ts"].exports).toEqual([
        { n: "AuthOpts", sig: "interface AuthOpts" },
      ]);
    });
  });

  describe("fromWireResponse", () => {
    const sampleWire: WireResponse = {
      s: "ok",
      changed: ["src/auth/middleware.ts"],
      iface: [
        {
          f: "src/auth/middleware.ts",
          e: "authMiddleware",
          b: "(req: Request) => void",
          a: "(req: Request, res: Response) => void",
        },
      ],
      tests: { p: 5, f: 0 },
      t: 28000,
      n: "Added error handling",
    };

    it("converts wire response to worker output", () => {
      const output = fromWireResponse(sampleWire);

      expect(output.status).toBe("complete");
      expect(output.filesChanged).toEqual(["src/auth/middleware.ts"]);
      expect(output.tokensUsed).toBe(28000);
      expect(output.notes).toBe("Added error handling");
    });

    it("maps interface changes correctly", () => {
      const output = fromWireResponse(sampleWire);

      expect(output.interfacesModified).toHaveLength(1);
      expect(output.interfacesModified[0]).toEqual({
        file: "src/auth/middleware.ts",
        export: "authMiddleware",
        before: "(req: Request) => void",
        after: "(req: Request, res: Response) => void",
      });
    });

    it("maps test results", () => {
      const output = fromWireResponse(sampleWire);
      expect(output.testResults).toEqual({ pass: 5, fail: 0 });
    });

    it("handles partial status", () => {
      const wire: WireResponse = { ...sampleWire, s: "partial" };
      expect(fromWireResponse(wire).status).toBe("partial");
    });

    it("handles fail status", () => {
      const wire: WireResponse = { ...sampleWire, s: "fail" };
      expect(fromWireResponse(wire).status).toBe("failed");
    });
  });

  describe("toWireResponse", () => {
    it("converts worker output to wire response", () => {
      const output: WorkerOutput = {
        status: "complete",
        filesChanged: ["src/auth/middleware.ts"],
        interfacesModified: [
          {
            file: "src/auth/middleware.ts",
            export: "authMiddleware",
            before: "(req: Request) => void",
            after: "(req: Request, res: Response) => void",
          },
        ],
        testsAdded: ["src/auth/middleware.test.ts"],
        testResults: { pass: 5, fail: 0 },
        notes: "Done",
        tokensUsed: 28000,
      };

      const wire = toWireResponse(output);
      expect(wire.s).toBe("ok");
      expect(wire.changed).toEqual(["src/auth/middleware.ts"]);
      expect(wire.t).toBe(28000);
      expect(wire.n).toBe("Done");
      expect(wire.iface).toHaveLength(1);
      expect(wire.tests).toEqual({ p: 5, f: 0 });
    });

    it("roundtrips through toWireResponse and fromWireResponse", () => {
      const original: WorkerOutput = {
        status: "complete",
        filesChanged: ["a.ts", "b.ts"],
        interfacesModified: [
          { file: "a.ts", export: "foo", before: "() => void", after: "() => string" },
        ],
        testsAdded: [],
        testResults: { pass: 3, fail: 1 },
        notes: "Some notes",
        tokensUsed: 15000,
      };

      const wire = toWireResponse(original);
      const restored = fromWireResponse(wire);

      expect(restored.status).toBe(original.status);
      expect(restored.filesChanged).toEqual(original.filesChanged);
      expect(restored.interfacesModified).toEqual(original.interfacesModified);
      expect(restored.testResults).toEqual(original.testResults);
      expect(restored.tokensUsed).toBe(original.tokensUsed);
      expect(restored.notes).toBe(original.notes);
    });
  });
});
