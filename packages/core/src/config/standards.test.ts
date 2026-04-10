import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadStandards } from "./standards.js";

describe("loadStandards", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "standards-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("loads a single standards file", async () => {
    await writeFile(
      join(dir, "simple.json"),
      JSON.stringify({
        name: "simple",
        rules: {
          testing: ["unit_tests", "integration_tests"],
        },
      }),
    );

    const result = await loadStandards(["simple"], dir);
    expect(result.rules.testing).toEqual(["unit_tests", "integration_tests"]);
  });

  it("merges standards with extends (child inherits parent rules)", async () => {
    await writeFile(
      join(dir, "parent.json"),
      JSON.stringify({
        name: "parent",
        rules: {
          security: ["no_secrets_in_code", "input_validation"],
        },
      }),
    );

    await writeFile(
      join(dir, "child.json"),
      JSON.stringify({
        name: "child",
        extends: ["parent"],
        rules: {
          performance: ["lazy_loading", "code_splitting"],
        },
      }),
    );

    const result = await loadStandards(["child"], dir);
    expect(result.rules.security).toEqual(["no_secrets_in_code", "input_validation"]);
    expect(result.rules.performance).toEqual(["lazy_loading", "code_splitting"]);
  });

  it("deduplicates rules when same category appears in parent and child", async () => {
    await writeFile(
      join(dir, "base.json"),
      JSON.stringify({
        name: "base",
        rules: {
          testing: ["unit_tests", "integration_tests"],
        },
      }),
    );

    await writeFile(
      join(dir, "extended.json"),
      JSON.stringify({
        name: "extended",
        extends: ["base"],
        rules: {
          testing: ["unit_tests", "e2e_tests"],
        },
      }),
    );

    const result = await loadStandards(["extended"], dir);
    expect(result.rules.testing).toEqual(["unit_tests", "integration_tests", "e2e_tests"]);
  });

  it("does not load the same file twice in a diamond dependency", async () => {
    await writeFile(
      join(dir, "root.json"),
      JSON.stringify({
        name: "root",
        rules: { core: ["rule_a"] },
      }),
    );

    await writeFile(
      join(dir, "left.json"),
      JSON.stringify({
        name: "left",
        extends: ["root"],
        rules: { left: ["rule_b"] },
      }),
    );

    await writeFile(
      join(dir, "right.json"),
      JSON.stringify({
        name: "right",
        extends: ["root"],
        rules: { right: ["rule_c"] },
      }),
    );

    // Load both left and right which both extend root
    const result = await loadStandards(["left", "right"], dir);
    expect(result.rules.core).toEqual(["rule_a"]);
    expect(result.rules.left).toEqual(["rule_b"]);
    expect(result.rules.right).toEqual(["rule_c"]);
  });

  it("handles multiple extends in order", async () => {
    await writeFile(
      join(dir, "a.json"),
      JSON.stringify({
        name: "a",
        rules: { shared: ["from_a"] },
      }),
    );

    await writeFile(
      join(dir, "b.json"),
      JSON.stringify({
        name: "b",
        rules: { shared: ["from_b"] },
      }),
    );

    await writeFile(
      join(dir, "c.json"),
      JSON.stringify({
        name: "c",
        extends: ["a", "b"],
        rules: { shared: ["from_c"] },
      }),
    );

    const result = await loadStandards(["c"], dir);
    expect(result.rules.shared).toEqual(["from_a", "from_b", "from_c"]);
  });
});
