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
                      description: "Set up project config",
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

      const result = parseSeederResponse(response);
      expect(result).not.toBeNull();
      expect(result!.workTree.milestones).toHaveLength(1);
      expect(result!.codeTree.modules).toHaveLength(1);
      expect(result!.workTree.milestones[0]!.slices[0]!.tasks[0]!.id).toBe("m1-s1-t1");
    });

    it("returns null for invalid JSON", () => {
      expect(parseSeederResponse("not json at all")).toBeNull();
    });

    it("returns null for JSON missing workTree", () => {
      const response = JSON.stringify({
        codeTree: { modules: [] },
      });
      expect(parseSeederResponse(response)).toBeNull();
    });

    it("returns null for JSON missing codeTree", () => {
      const response = JSON.stringify({
        workTree: { milestones: [] },
      });
      expect(parseSeederResponse(response)).toBeNull();
    });

    it("handles JSON wrapped in markdown fences", () => {
      const json = JSON.stringify({
        workTree: { milestones: [] },
        codeTree: { modules: [] },
      });
      const response = "```json\n" + json + "\n```";
      const result = parseSeederResponse(response);
      expect(result).not.toBeNull();
      expect(result!.workTree.milestones).toEqual([]);
      expect(result!.codeTree.modules).toEqual([]);
    });
  });
});
