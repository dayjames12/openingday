/**
 * Wire-mode output format instructions.
 * @param schema - Compact schema description for the expected JSON shape
 */
export function outputFormat(schema: string): string {
  return `out:{${schema}}|no-prose|no-markdown-fences`;
}

/**
 * Standard error list output format used by feedback and review prompts.
 */
export function errorListFormat(): string {
  return outputFormat('"errors":[{"f":file,"l":line,"e":desc,"fix":suggestion}]');
}

/**
 * Review output format with approved flag.
 */
export function reviewFormat(): string {
  return outputFormat('"approved":bool,"issues":[{"f":file,"l":line,"e":desc,"fix":suggestion}]');
}

/**
 * Quality review output format.
 */
export function qualityFormat(): string {
  return outputFormat(
    '"pass":bool,"issues":[{"rule":string,"file":string,"note":string,"severity":"high"|"low"}]',
  );
}
