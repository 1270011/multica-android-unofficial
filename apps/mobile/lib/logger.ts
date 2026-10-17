/**
 * Central logger. Every app log goes through
 * here instead of `console.*` (enforced by the `no-console` lint rule):
 *
 * - `debug` / `info` / `log` are verbose-only: dev bundles and the
 *   Android debug APK (`EXPO_PUBLIC_VERBOSE_LOGS=1`, set by
 *   `scripts/android-build.sh debug`). Release bundles drop them.
 * - `warn` / `error` always reach logcat, but every argument is passed
 *   through `redact()` first: values under secret-looking keys are replaced
 *   and bearer tokens / JWTs / PATs inside strings are masked, however deep
 *   they sit in an object (`body`, `err`, a parsed response …).
 *
 * The verbose gate spells out `process.env.EXPO_PUBLIC_VERBOSE_LOGS` here so
 * Metro can inline and fold it (see lib/debug-token-login.ts).
 */

const VERBOSE: boolean =
  (typeof __DEV__ !== "undefined" && __DEV__) ||
  process.env.EXPO_PUBLIC_VERBOSE_LOGS === "1";

export const REDACTED = "[redacted]";

/** Keys whose values are never logged, whatever they contain. */
const SECRET_KEY =
  /token|secret|password|passwd|authorization|cookie|credential|jwt|api_?key|^cf[-_]?(?:access|client)|^x-api-key$|^received$|^otp$|^(?:verification|login|auth)_?code$/i;

/** `code` is mostly an error code (`ECONNREFUSED`, 401, close code 1006);
 *  only a 6-digit string is an e-mail login code and gets masked. */
const OTP_SHAPE = /^\d{6}$/;

/** Array items / object keys logged per level; the rest is summarised. */
export const MAX_LOG_ITEMS = 100;

/** Longer strings are cut before matching: bounds the regex work per log
 *  call (review: a large logged body must not freeze the JS thread). */
export const MAX_LOG_STRING = 4000;
export const TRUNCATED = "…[truncated]";

/** Separator between a name and its value: `name: v`, `name=v`, `"name":"v"`
 *  and the escaped JSON form `\"name\":\"v\"`. */
const SEP = String.raw`\\?["']?\s*[:=]\s*`;
const BARE = String.raw`[^\s"'` + "`" + String.raw`,;}&\\]`;

/** group 1 = name + separator (kept), the value after it is masked. */
const named = (name: string, value: string) => new RegExp(`(${name}${SEP}\\\\?["']?)${value}`, "gi");

/** Names are bounded and anchored, so matching stays linear. */
const SECRET_NAME = String.raw`\b[\w-]{0,32}(?:token|secret|password|passwd)[\w-]{0,32}`;

/** Credential shapes inside free text. */
const SECRET_PATTERNS: RegExp[] = [
  /\bBearer\s+[^\s"',;]+/gi,
  /\beyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]*/g, // JWT
  /\bmul_[A-Za-z0-9_-]{8,}/g, // Multica personal access token
  // CF-Access-Client-Id/Secret in header, env (CF_ACCESS_CLIENT_SECRET=) and
  // JSON form: always masked, whatever the value looks like.
  named(String.raw`\bCF[-_]?Access[-_]?Client[-_]?(?:Id|Secret)`, `${BARE}+`),
  // Authorization with a known scheme, or a credential-looking value.
  named(String.raw`\bAuthorization`, String.raw`(?:(?:Bearer|Basic|Token|Digest)\s+${BARE}+|${BARE}{16,})`),
  /([?&](?:token|access_token)=)[^&\s"']+/gi,
  // Secret-named fields: quoted values (JSON) always, bare values only when
  // they look like a credential (16+ characters without spaces), so
  // "max_tokens=1000" or "secret: none configured" stay readable.
  new RegExp(`(${SECRET_NAME}${SEP}\\\\?["'])[^"'\\\\]{1,4000}`, "gi"),
  new RegExp(`(${SECRET_NAME}${SEP})${BARE}{16,}`, "gi"),
];

export function redactString(text: string): string {
  let out = text.length > MAX_LOG_STRING ? `${text.slice(0, MAX_LOG_STRING)}${TRUNCATED}` : text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (match, prefix?: unknown) =>
      typeof prefix === "string" ? `${prefix}${REDACTED}` : REDACTED,
    );
  }
  return out;
}

const isSecretEntry = (key: string, v: unknown) =>
  SECRET_KEY.test(key) || (key.toLowerCase() === "code" && typeof v === "string" && OTP_SHAPE.test(v));

/**
 * Deep copy with secrets masked. Depth and width are bounded; `[circular]`
 * marks only a real cycle (an object inside itself), not an object that is
 * referenced twice side by side.
 */
export function redact(value: unknown, depth = 0, ancestors = new Set<object>()): unknown {
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;
  if (depth > 6) return "[…]";
  if (ancestors.has(value)) return "[circular]";
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) };
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const items = value.slice(0, MAX_LOG_ITEMS).map((v) => redact(v, depth + 1, ancestors));
      if (value.length > MAX_LOG_ITEMS) items.push(`[… ${value.length - MAX_LOG_ITEMS} more]`);
      return items;
    }
    const entries = Object.entries(value);
    const out: Record<string, unknown> = {};
    for (const [key, v] of entries.slice(0, MAX_LOG_ITEMS)) {
      out[key] = isSecretEntry(key, v) ? REDACTED : redact(v, depth + 1, ancestors);
    }
    if (entries.length > MAX_LOG_ITEMS) out["…"] = `${entries.length - MAX_LOG_ITEMS} more keys`;
    return out;
  } finally {
    ancestors.delete(value);
  }
}

type Level = "debug" | "info" | "log" | "warn" | "error";

function emit(level: Level, args: unknown[]) {
  const safe = args.map((a) => redact(a));
  const sink = level === "warn" ? console.warn : level === "error" ? console.error : console.log;
  sink(...safe);
}

export const logger = {
  debug: (...args: unknown[]) => {
    if (VERBOSE) emit("debug", args);
  },
  info: (...args: unknown[]) => {
    if (VERBOSE) emit("info", args);
  },
  log: (...args: unknown[]) => {
    if (VERBOSE) emit("log", args);
  },
  warn: (...args: unknown[]) => emit("warn", args),
  error: (...args: unknown[]) => emit("error", args),
};

export type Logger = typeof logger;
