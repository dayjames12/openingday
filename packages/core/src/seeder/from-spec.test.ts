import { describe, it, expect } from "vitest";
import { buildSeederPrompt, parseSeederResponse } from "./from-spec.js";

describe("from-spec", () => {
  describe("buildSeederPrompt", () => {
    it("includes spec text in the prompt", () => {
      const prompt = buildSeederPrompt("Build a REST API", "my-api");
      expect(prompt).toContain("Build a REST API");
    });

    it("includes project name in the prompt", () => {
      const prompt = buildSeederPrompt("Build a REST API", "my-api");
      expect(prompt).toContain("my-api");
    });

    it("includes task description format guidance", () => {
      const prompt = buildSeederPrompt("Build a REST API", "my-api");
      expect(prompt).toContain("[Action] [what] in [file path]");
    });

    it("includes good/bad examples", () => {
      const prompt = buildSeederPrompt("Build a REST API", "my-api");
      expect(prompt).toContain("GOOD:");
      expect(prompt).toContain("BAD:");
    });

    it("includes 150k context window rule", () => {
      const prompt = buildSeederPrompt("Build a REST API", "my-api");
      expect(prompt).toContain("150k tokens");
    });

    it("includes wire-mode awareness", () => {
      const prompt = buildSeederPrompt("Build a REST API", "my-api");
      expect(prompt).toContain("under 200 chars");
    });
  });

  describe("parseSeederResponse", () => {
    it("parses valid JSON with workTree and codeTree", () => {
      const response = JSON.stringify({
        workTree: {
          milestones: [
            {
              id: "m1",
              name: "Setup",
              description: "Project setup",
              dependencies: [],
              slices: [
                {
                  id: "m1-s1",
                  name: "Init",
                  description: "Initialize project",
                  parentMilestoneId: "m1",
                  tasks: [
                    {
                      id: "m1-s1-t1",
                      name: "Create config",
                      description: "Set up project config in src/config.ts — exports Config type",
                      status: "pending",
                      dependencies: [],
                      touches: ["src/config.ts"],
                      reads: [],
                      worker: null,
                      tokenSpend: 0,
                      attemptCount: 0,
                      gateResults: [],
                      parentSliceId: "m1-s1",
                    },
                  ],
                },
              ],
            },
          ],
        },
        codeTree: {
          modules: [
            {
              path: "src",
              description: "Source code",
              files: [
                {
                  path: "src/config.ts",
                  description: "Configuration",
                  exports: [{ name: "config", signature: "const config: Config", description: "App config" }],
                  imports: [],
                  lastModifiedBy: null,
                },
              ],
            },
          ],
        },
      });

      const { output, warnings } = parseSeederResponse(response);
      expect(output).not.toBeNull();
      expect(output!.workTree.milestones).toHaveLength(1);
      expect(output!.codeTree.modules).toHaveLength(1);
      expect(output!.workTree.milestones[0]!.slices[0]!.tasks[0]!.id).toBe("m1-s1-t1");
      expect(warnings).toHaveLength(0);
    });

    it("returns null output for invalid JSON", () => {
      const { output } = parseSeederResponse("not json at all");
      expect(output).toBeNull();
    });

    it("returns null output for JSON missing workTree", () => {
      const response = JSON.stringify({
        codeTree: { modules: [] },
      });
      const { output } = parseSeederResponse(response);
      expect(output).toBeNull();
    });

    it("returns null output for JSON missing codeTree", () => {
      const response = JSON.stringify({
        workTree: { milestones: [] },
      });
      const { output } = parseSeederResponse(response);
      expect(output).toBeNull();
    });

    it("handles JSON wrapped in markdown fences", () => {
      const json = JSON.stringify({
        workTree: { milestones: [] },
        codeTree: { modules: [] },
      });
      const response = "```json\n" + json + "\n```";
      const { output } = parseSeederResponse(response);
      expect(output).not.toBeNull();
      expect(output!.workTree.milestones).toEqual([]);
      expect(output!.codeTree.modules).toEqual([]);
    });

    it("warns on short task descriptions", () => {
      const response = JSON.stringify({
        workTree: {
          milestones: [{
            id: "m1", name: "M1", description: "M1", dependencies: [],
            slices: [{
              id: "m1-s1", name: "S1", description: "S1", parentMilestoneId: "m1",
              tasks: [{
                id: "t1", name: "T1", description: "Short",
                status: "pending", dependencies: [], touches: ["a.ts"], reads: [],
                worker: null, tokenSpend: 0, attemptCount: 0, gateResults: [], parentSliceId: "m1-s1",
              }],
            }],
          }],
        },
        codeTree: { modules: [] },
      });

      const { warnings } = parseSeederResponse(response);
      expect(warnings.some((w) => w.message.includes("too short"))).toBe(true);
    });

    it("warns on empty touches", () => {
      const response = JSON.stringify({
        workTree: {
          milestones: [{
            id: "m1", name: "M1", description: "M1", dependencies: [],
            slices: [{
              id: "m1-s1", name: "S1", description: "S1", parentMilestoneId: "m1",
              tasks: [{
                id: "t1", name: "T1", description: "A sufficiently long description here",
                status: "pending", dependencies: [], touches: [], reads: [],
                worker: null, tokenSpend: 0, attemptCount: 0, gateResults: [], parentSliceId: "m1-s1",
              }],
            }],
          }],
        },
        codeTree: { modules: [] },
      });

      const { warnings } = parseSeederResponse(response);
      expect(warnings.some((w) => w.message.includes("No files in touches"))).toBe(true);
    });

    it("warns on independent tasks touching the same file", () => {
      const response = JSON.stringify({
        workTree: {
          milestones: [{
            id: "m1", name: "M1", description: "M1", dependencies: [],
            slices: [{
              id: "m1-s1", name: "S1", description: "S1", parentMilestoneId: "m1",
              tasks: [
                {
                  id: "t1", name: "T1", description: "Add feature A in src/shared.ts — exports featureA",
                  status: "pending", dependencies: [], touches: ["src/shared.ts"], reads: [],
                  worker: null, tokenSpend: 0, attemptCount: 0, gateResults: [], parentSliceId: "m1-s1",
                },
                {
                  id: "t2", name: "T2", description: "Add feature B in src/shared.ts — exports featureB",
                  status: "pending", dependencies: [], touches: ["src/shared.ts"], reads: [],
                  worker: null, tokenSpend: 0, attemptCount: 0, gateResults: [], parentSliceId: "m1-s1",
                },
              ],
            }],
          }],
        },
        codeTree: { modules: [] },
      });

      const { warnings } = parseSeederResponse(response);
      expect(warnings.some((w) => w.message.includes("both touch") && w.message.includes("no dependency"))).toBe(true);
    });
  });
});
