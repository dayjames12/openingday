import { describe, it, expect } from "vitest";
import { buildContractPrompt, parseContractResponse } from "./contracts.js";

describe("contract generation", () => {
  describe("buildContractPrompt", () => {
    it("includes spec text in prompt", () => {
      const prompt = buildContractPrompt("Build a baseball stats API with Player and Team entities");
      expect(prompt).toContain("baseball stats API");
      expect(prompt).toContain("Player");
    });

    it("includes existing types when repoMap provided", () => {
      const prompt = buildContractPrompt(
        "Add batting average to players",
        {
          v: 1, scannedAt: "", depth: "standard",
          env: { pm: "pnpm", test: "vitest", lint: "eslint", ts: true, monorepo: false, workspaces: [], infra: "none" },
          deps: [],
          modules: [{
            p: "src", d: "source", fc: 1, k: ["types"],
            files: [{
              p: "src/types.ts",
              ex: [{ n: "Player", s: "interface Player { name: string; team: string }" }],
              im: [],
              loc: 10,
            }],
          }],
        },
      );
      expect(prompt).toContain("Player");
      expect(prompt).toContain("existing-types:");
    });
  });

  describe("parseContractResponse", () => {
    it("extracts TypeScript from response", () => {
      const response = '```typescript\nexport interface Player {\n  name: string;\n  team: string;\n}\n```';
      const result = parseContractResponse(response);
      expect(result).toContain("export interface Player");
      expect(result).not.toContain("```");
    });

    it("handles raw TypeScript without fences", () => {
      const response = "export interface Player {\n  name: string;\n}";
      const result = parseContractResponse(response);
      expect(result).toContain("export interface Player");
    });

    it("returns empty string on garbage input", () => {
      const result = parseContractResponse("Sorry, I cannot generate contracts.");
      expect(result).toBe("");
    });
  });
});
