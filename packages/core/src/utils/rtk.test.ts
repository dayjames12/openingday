import { describe, it, expect, beforeEach } from "vitest";
import { isRtkAvailable, wrapCommand, rtkPrefix, _resetRtkCache, _setRtkAvailable } from "./rtk.js";

describe("rtk utils", () => {
  beforeEach(() => {
    _resetRtkCache();
  });

  describe("isRtkAvailable", () => {
    it("returns a boolean", () => {
      const result = isRtkAvailable();
      expect(typeof result).toBe("boolean");
    });

    it("caches the result across calls", () => {
      const first = isRtkAvailable();
      const second = isRtkAvailable();
      expect(first).toBe(second);
    });

    it("can be overridden via _setRtkAvailable", () => {
      _setRtkAvailable(true);
      expect(isRtkAvailable()).toBe(true);

      _setRtkAvailable(false);
      expect(isRtkAvailable()).toBe(false);
    });
  });

  describe("wrapCommand", () => {
    it("prefixes with rtk when available", () => {
      _setRtkAvailable(true);
      expect(wrapCommand("npx tsc --noEmit")).toBe("rtk npx tsc --noEmit");
    });

    it("returns command unchanged when rtk unavailable", () => {
      _setRtkAvailable(false);
      expect(wrapCommand("npx tsc --noEmit")).toBe("npx tsc --noEmit");
    });

    it("handles empty command string", () => {
      _setRtkAvailable(true);
      expect(wrapCommand("")).toBe("rtk ");

      _setRtkAvailable(false);
      expect(wrapCommand("")).toBe("");
    });
  });

  describe("rtkPrefix", () => {
    it("returns ['rtk'] when available", () => {
      _setRtkAvailable(true);
      expect(rtkPrefix()).toEqual(["rtk"]);
    });

    it("returns [] when unavailable", () => {
      _setRtkAvailable(false);
      expect(rtkPrefix()).toEqual([]);
    });
  });
});
