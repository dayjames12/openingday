/**
 * Wire-mode budget and safety constraints.
 */
export function constraints(budget: number, rules: string[]): string {
  const parts = [`budget:$${budget.toFixed(2)}`];
  if (rules.length > 0) {
    parts.push(`rules:[${rules.join(",")}]`);
  }
  return parts.join("|");
}

/**
 * Standard constraint for digest-only prompts (no file modifications).
 */
export function digestConstraints(budget: number): string {
  return constraints(budget, ["no-file-access", "no-tools", "json-only"]);
}
