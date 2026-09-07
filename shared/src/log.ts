/**
 * Log line classification, shared so the API and the page colour the same
 * lines. Order matters: the first match wins, trouble before everything else.
 */
export const LOG_KINDS = [
  { kind: 'error', pattern: /\berror\b|misbehaving|disconnecting|Potential stale tip|corrupt/i },
  { kind: 'warn', pattern: /\bwarning\b/i },
  { kind: 'tip', pattern: /UpdateTip:/ },
] as const;

export type LogKind = (typeof LOG_KINDS)[number]['kind'];

/** Inside a classified line, one piece may stand out more. */
export const LOG_HIGHLIGHT: Partial<Record<LogKind, RegExp>> = {
  tip: /height=\d+/,
};

export function classifyLogLine(line: string): LogKind | null {
  for (const { kind, pattern } of LOG_KINDS) {
    if (pattern.test(line)) return kind;
  }
  return null;
}
