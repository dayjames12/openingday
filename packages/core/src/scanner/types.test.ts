import { describe, it, expect } from "vitest";
import type { RepoMap, ScanDepth } from "./types.js";

describe("scanner types", () => {
  it("creates a valid RepoMap", () => {
    const map: RepoMap = {
      v: 1,
      scannedAt: "2026-04-08T10:00:00Z",
      depth: "standard",
      env: {
        pm: "pnpm",
        test: "vitest",
        lint: "eslint",
        ts: true,
        monorepo: true,
        workspaces: ["packages/*"],
        infra: "sst",
      },
      deps: ["hono", "electrodb"],
      modules: [
        {
          p: "packages/core",
          d: "core logic",
          fc: 12,
          k: ["auth", "db"],
          files: [
            {
              p: "packages/core/src/auth.ts",
              ex: [{ n: "auth", s: "() => void" }],
              im: [{ f: "./types", n: ["User"] }],
              loc: 45,
            },
          ],
        },
      ],
    };
    expect(map.v).toBe(1);
    expect(map.env.pm).toBe("pnpm");
    expect(map.modules[0]!.files[0]!.ex[0]!.n).toBe("auth");
  });

  it("validates scan depth values", () => {
    const depths: ScanDepth[] = ["lite", "standard", "deep"];
    expect(depths).toHaveLength(3);
  });
});
