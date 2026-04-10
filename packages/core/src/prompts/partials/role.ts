/**
 * Wire-mode agent role framing. Shared across all AI-to-AI prompts.
 */
export function agentRole(taskType: string): string {
  return `role:${taskType}|mode:wire|respond:json-only`;
}
