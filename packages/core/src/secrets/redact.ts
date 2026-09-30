const PATTERNS: [RegExp, string][] = [
  // HTTP authorization header values, e.g. git's http.extraheader.
  [/(authorization:\s*(?:basic|bearer|token)\s+)[^\s"'\\]+/gi, "$1[redacted]"],
  // Credentials in URLs: https://user:secret@host
  [/(https?:\/\/)[^\s/@"']+:[^\s/@"']+@/gi, "$1[redacted]@"],
  // GitHub tokens: gho_, ghp_, ghs_, ghu_, ghr_ and fine-grained PATs.
  [/\bgh[opsur]_[A-Za-z0-9]{20,}\b/g, "[redacted]"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "[redacted]"],
  // Anthropic API keys and subscription OAuth tokens.
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/g, "[redacted]"],
];

/** Removes token-shaped strings before text is stored in the database or shown. */
export function redactSecrets(text: string): string {
  return PATTERNS.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);
}
