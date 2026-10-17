/**
 * Pure helpers behind the "Paste" buttons of the server setup.
 * No React, no native modules, unit-tested.
 *
 * Nothing here ever builds a message from the pasted value: callers get
 * kinds and lengths only, so a hint or toast cannot leak a secret.
 */

export type PasteTarget = "url" | "cfClientId" | "cfClientSecret" | "token" | "code";

const HEADER_PREFIX: Partial<Record<PasteTarget, RegExp>> = {
  cfClientId: /^CF[-_]Access[-_]Client[-_]Id\s*[:=]\s*/i,
  cfClientSecret: /^CF[-_]Access[-_]Client[-_]Secret\s*[:=]\s*/i,
};

/** Strip the decoration that comes along when copying a single value:
 *  surrounding whitespace/newlines, quotes, a `-H` from a curl line and a
 *  leading `CF-Access-Client-…:` header name for the matching field. */
export function cleanPasted(raw: string, target: PasteTarget): string {
  let value = raw.trim();
  value = value.replace(/^-H\s+/i, "").trim();
  value = stripQuotes(value);
  const prefix = HEADER_PREFIX[target];
  if (prefix) value = stripQuotes(value.replace(prefix, "").trim());
  if (target === "token") value = value.replace(/^Bearer\s+/i, "").trim();
  if (target === "code") value = value.replace(/\s+/g, "");
  return value;
}

function stripQuotes(value: string): string {
  const m = /^(["'`])([\s\S]*)\1$/.exec(value);
  return m ? m[2]!.trim() : value;
}

export interface CfHeaderBlock {
  cfClientId: string;
  cfClientSecret: string;
}

/**
 * Recognise both Cloudflare Access headers copied in one go — the two lines
 * from the Zero Trust dashboard, a curl command with two `-H` options,
 * env-style `CF_ACCESS_CLIENT_ID=…` lines or a JSON object. Returns null unless BOTH values
 * are present.
 */
export function parseCfHeaderBlock(raw: string): CfHeaderBlock | null {
  const pick = (name: "Id" | "Secret") => {
    const re = new RegExp(
      `CF[-_]?Access[-_]?Client[-_]?${name}["']?\\s*[:=]\\s*["']?([^\\s"',;}\\\\]+)`,
      "i",
    );
    return re.exec(raw)?.[1] ?? null;
  };
  const cfClientId = pick("Id");
  const cfClientSecret = pick("Secret");
  return cfClientId && cfClientSecret ? { cfClientId, cfClientSecret } : null;
}

export type FormatHint = "ok" | "empty" | "client_id_format" | "secret_format" | "url_format";

/** Non-blocking plausibility check (a warning, never a validation error). */
export function formatHint(target: PasteTarget, value: string): FormatHint {
  if (!value) return "empty";
  switch (target) {
    case "cfClientId":
      return /^[A-Za-z0-9]+\.access$/.test(value) ? "ok" : "client_id_format";
    case "cfClientSecret":
      return /^[A-Fa-f0-9]{32,}$/.test(value) ? "ok" : "secret_format";
    case "url":
      return /^(https?:\/\/)?[^\s/]+\.[^\s]+$/i.test(value) || /^https?:\/\//i.test(value)
        ? "ok"
        : "url_format";
    default:
      return "ok";
  }
}

/** Text that names the Client Secret header (any `-`/`_` spelling). Such
 *  text is always treated as a secret, whichever field it lands in. */
export function containsCfSecret(text: string | null | undefined): boolean {
  return /CF[-_]?Access[-_]?Client[-_]?Secret/i.test(text ?? "");
}

export type PasteResult =
  | { kind: "empty" }
  | { kind: "block"; values: CfHeaderBlock }
  | { kind: "value"; value: string; hint: FormatHint }
  /** The Client Secret header in a field that would show it unmasked. */
  | { kind: "secret_rejected" };

/**
 * Turn raw clipboard text into what the screen should apply. A header block
 * wins over the single value, so one copy fills both Cloudflare fields
 * whichever "Paste" button was tapped. Text naming the Client Secret never
 * lands in the URL or Client ID field: it is applied as a
 * block or rejected.
 */
export function interpretPaste(raw: string | null | undefined, target: PasteTarget): PasteResult {
  const text = raw ?? "";
  if (!text.trim()) return { kind: "empty" };
  const secret = containsCfSecret(text);
  if (target === "cfClientId" || target === "cfClientSecret" || secret) {
    const block = parseCfHeaderBlock(text);
    if (block) return { kind: "block", values: block };
  }
  if (secret && target !== "cfClientSecret") return { kind: "secret_rejected" };
  const value = cleanPasted(text, target);
  if (!value) return { kind: "empty" };
  return { kind: "value", value, hint: formatHint(target, value) };
}
