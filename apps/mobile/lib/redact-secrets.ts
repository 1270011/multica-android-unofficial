/**
 * Client-side redaction for agent transcripts.
 * Copy of web's packages/views/common/task-transcript/redact.ts — mobile
 * must not import packages/views (apps/mobile/AGENTS.md). Keep both lists
 * in sync; lib/redact-secrets.test.ts pins every pattern. The server
 * redacts first, this is the display safety net.
 *
 * Mobile additions that web and server
 * still lack: Multica tokens (`mul_…` PAT, `mat_…` task token), JSON
 * `"token": "…"`, `Authorization: token|Basic …`, `user:pw@` in http(s)
 * URLs and a PEM block without END line. Quantifiers are bounded and the
 * input is cut to MAX_REDACT_INPUT first (the JWT pattern backtracked
 * quadratically, 80 KB froze the JS thread for 1.5 s in Node).
 */

/** Longest text the patterns run on; transcripts show far less anyway. */
export const MAX_REDACT_INPUT = 64 * 1024;

const patterns: { re: RegExp; replacement: string }[] = [
  // AWS access key IDs
  { re: /\bAKIA[0-9A-Z]{16}\b/g, replacement: "[REDACTED AWS KEY]" },
  // AWS secret access keys
  { re: /(?:aws_secret_access_key|secret_?access_?key)\s*[=:]\s*[A-Za-z0-9/+=]{40}/gi, replacement: "[REDACTED AWS SECRET]" },
  // PEM private keys
  { re: /-----BEGIN[A-Z\s]*PRIVATE KEY-----[\s\S]*?-----END[A-Z\s]*PRIVATE KEY-----/g, replacement: "[REDACTED PRIVATE KEY]" },
  // PEM private key without END line (cut output): everything after BEGIN
  { re: /-----BEGIN[A-Z ]{0,40}PRIVATE KEY-----[\s\S]*$/g, replacement: "[REDACTED PRIVATE KEY]" },
  // GitHub OAuth / classic tokens (ghp_/gho_/ghu_/ghs_/ghr_)
  { re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,255}\b/g, replacement: "[REDACTED GITHUB TOKEN]" },
  // GitHub fine-grained PATs (github_pat_…, recommended since 2022)
  { re: /\bgithub_pat_[A-Za-z0-9_]{20,255}\b/g, replacement: "[REDACTED GITHUB TOKEN]" },
  // Google API keys (AIza…, e.g. Gemini / Maps / Firebase)
  { re: /\bAIza[0-9A-Za-z_-]{35}([^0-9A-Za-z_-]|$)/g, replacement: "[REDACTED GOOGLE API KEY]$1" },
  // GitLab personal access tokens
  { re: /\bglpat-[A-Za-z0-9_-]{20,}\b/g, replacement: "[REDACTED GITLAB TOKEN]" },
  // OpenAI / Anthropic API keys
  { re: /\bsk-[A-Za-z0-9_-]{20,}\b/g, replacement: "[REDACTED API KEY]" },
  // Slack tokens
  { re: /\bxox[bporas]-[A-Za-z0-9-]{10,}\b/g, replacement: "[REDACTED SLACK TOKEN]" },
  // JWT tokens (bounded segments)
  { re: /\bey[A-Za-z0-9_-]{10,2048}\.[A-Za-z0-9_-]{10,4096}\.[A-Za-z0-9_-]{10,2048}\b/g, replacement: "[REDACTED JWT]" },
  // Multica personal access tokens (mul_) and agent task tokens (mat_)
  { re: /\b(?:mul|mat)_[A-Za-z0-9_-]{8,256}/g, replacement: "[REDACTED MULTICA TOKEN]" },
  // Authorization header with a scheme other than Bearer (Forgejo `token`, Basic, Digest)
  { re: /\b(Authorization["']?\s*[:=]\s*["']?)(?:token|Basic|Digest)\s+[^\s"',;]{1,4096}/gi, replacement: "$1[REDACTED]" },
  // JSON (or YAML-like) secret fields: "token": "…", "api_key": "…"
  {
    re: /("[\w-]{0,32}(?:token|secret|password|passwd|api_?key|apikey|credential)[\w-]{0,32}"\s*:\s*")[^"\\]{1,4096}"/gi,
    replacement: '$1[REDACTED]"',
  },
  // user:password@ in http(s) URLs
  { re: /\b(https?:\/\/)[^\s:/@]{1,256}:[^\s@/]{1,256}@/gi, replacement: "$1[REDACTED]@" },
  // Bearer tokens
  { re: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, replacement: "Bearer [REDACTED]" },
  // Connection strings with embedded passwords
  { re: /(?:postgres|mysql|mongodb|redis|amqp)(?:ql)?:\/\/[^:\s]+:[^@\s]+@/gi, replacement: "[REDACTED CONNECTION STRING]@" },
  // Generic key=value secret env vars
  { re: /(?:API_KEY|API_SECRET|SECRET_KEY|SECRET|ACCESS_TOKEN|AUTH_TOKEN|PRIVATE_KEY|DATABASE_URL|DB_PASSWORD|DB_URL|REDIS_URL|PASSWORD|TOKEN)\s*[=:]\s*\S+/gi, replacement: "[REDACTED CREDENTIAL]" },
];

export function redactSecrets(text: string): string {
  let result = text.length > MAX_REDACT_INPUT ? text.slice(0, MAX_REDACT_INPUT) : text;
  for (const { re, replacement } of patterns) {
    result = result.replace(re, replacement);
  }
  return result;
}
