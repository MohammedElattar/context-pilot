/**
 * Mask credentials before fetched content or provenance is returned to the
 * model, cached, or logged. Patterns cover the common high-signal secrets; it
 * is a safety net, not a guarantee — content is still treated as untrusted.
 */
const PATTERNS: { re: RegExp; replace: string }[] = [
  // Authorization / bearer headers and values.
  { re: /\b(authorization\s*[:=]\s*)(bearer\s+)?[A-Za-z0-9._~+/-]{8,}=*/gi, replace: '$1$2[REDACTED]' },
  { re: /\bbearer\s+[A-Za-z0-9._~+/-]{12,}=*/gi, replace: 'bearer [REDACTED]' },
  // Provider API keys.
  { re: /\bsk-[A-Za-z0-9]{16,}\b/g, replace: 'sk-[REDACTED]' },
  { re: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{16,}\b/g, replace: 'gh[REDACTED]' },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, replace: 'xox[REDACTED]' },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, replace: 'AKIA[REDACTED]' },
  { re: /\b(?:AIza)[A-Za-z0-9_-]{20,}\b/g, replace: 'AIza[REDACTED]' },
  // Generic key/password/token assignments.
  { re: /\b(api[_-]?key|secret|password|passwd|token|access[_-]?token)(\s*[:=]\s*["']?)[^\s"'&]{6,}/gi, replace: '$1$2[REDACTED]' },
  // Credentials embedded in a URL.
  { re: /(https?:\/\/)[^:/\s]+:[^@/\s]+@/gi, replace: '$1[REDACTED]@' },
];

export function redactSecrets(text: string): string {
  if (!text) return text;
  let out = text;
  for (const { re, replace } of PATTERNS) out = out.replace(re, replace);
  return out;
}
