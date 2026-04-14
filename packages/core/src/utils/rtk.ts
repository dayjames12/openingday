import { execSync } from "node:child_process";

let _rtkAvailable: boolean | null = null;

/**
 * Check if the `rtk` CLI binary is available on PATH.
 * Result is cached for the lifetime of the process.
 */
export function isRtkAvailable(): boolean {
  if (_rtkAvailable !== null) return _rtkAvailable;
  try {
    execSync("which rtk", { stdio: "ignore" });
    _rtkAvailable = true;
  } catch {
    _rtkAvailable = false;
  }
  return _rtkAvailable;
}

/**
 * Wrap a shell command with `rtk` prefix if RTK is available.
 * Returns the command unchanged if RTK is not installed.
 */
export function wrapCommand(cmd: string): string {
  return isRtkAvailable() ? `rtk ${cmd}` : cmd;
}

/**
 * Get the RTK prefix args for use with execFile-style calls.
 * Returns `["rtk"]` if available, `[]` otherwise.
 */
export function rtkPrefix(): string[] {
  return isRtkAvailable() ? ["rtk"] : [];
}

/**
 * Reset the cached RTK availability check.
 * Only useful for testing.
 */
export function _resetRtkCache(): void {
  _rtkAvailable = null;
}

/**
 * Override the cached RTK availability.
 * Only useful for testing.
 */
export function _setRtkAvailable(available: boolean): void {
  _rtkAvailable = available;
}
