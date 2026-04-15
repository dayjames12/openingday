import { describe, expect, it } from "vitest";
import { validateContracts, extractContractExports } from "./contracts-gate.js";

describe("validateContracts", () => {
  it("passes when contracts are empty", () => {
    const result = validateContracts("", ["src/foo.ts"]);
    expect(result.pass).toBe(true);
  });

  it("passes when all exports are consumed", () => {
    const contracts = `export interface User { id: string; }\nexport type Role = "admin" | "user";`;
    const fileContents = { "src/foo.ts": `import type { User, Role } from "../contracts.js";` };
    const result = validateContracts(contracts, ["src/foo.ts"], fileContents);
    expect(result.pass).toBe(true);
  });

  it("warns on unused contract exports", () => {
    const contracts = `export interface User { id: string; }\nexport interface Orphan { x: number; }`;
    const fileContents = { "src/foo.ts": `import type { User } from "../contracts.js";` };
    const result = validateContracts(contracts, ["src/foo.ts"], fileContents);
    expect(result.pass).toBe(true); // warnings, not blockers
    expect(result.issues.some((i) => i.note?.includes("Orphan"))).toBe(true);
  });
});

describe("extractContractExports", () => {
  it("extracts interface, type, enum, const, function exports", () => {
    const source = `
export interface Foo { x: number; }
export type Bar = string;
export enum Baz { A, B }
export const QUX = 42;
export function doThing(): void {}
`;
    const names = extractContractExports(source);
    expect(names).toEqual(["Foo", "Bar", "Baz", "QUX", "doThing"]);
  });
});
