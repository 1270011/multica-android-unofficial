/**
 * Server connection settings — pure helpers (no React, no native modules).
 *
 * The Android build does not bake the API origin into the
 * bundle. The user picks a connection mode on first launch (or later in
 * Settings → Server connection):
 *
 *   - `cloudflare` — the public origin sits behind Cloudflare Access. Every
 *     request (REST, WebSocket upgrade, image/attachment loads) carries the
 *     Access *service token* as `CF-Access-Client-Id` /
 *     `CF-Access-Client-Secret` headers. Access validates those at the edge
 *     and only then forwards the request to Multica, where the normal
 *     e-mail-code login takes over.
 *   - `direct` — LAN / VPN access to the server itself (e.g.
 *     `https://192.0.2.10`). No extra headers.
 *
 * The persisted values live in expo-secure-store (see
 * `data/server-config-store.ts`); this module only knows how to validate
 * and derive things from them so the logic can be unit-tested in plain
 * Node.
 *
 * `EXPO_PUBLIC_API_URL` is kept as a *prefill* for the URL field only. It
 * is never read at request time any more.
 */

export type ConnectionMode = "cloudflare" | "direct";

export interface ServerConfig {
  mode: ConnectionMode;
  /** Normalised origin (+ optional path prefix), no trailing slash. */
  baseUrl: string;
  /** Cloudflare Access service-token id. Only meaningful in `cloudflare` mode. */
  cfClientId: string;
  /** Cloudflare Access service-token secret. Only meaningful in `cloudflare` mode. */
  cfClientSecret: string;
}

/** Unsaved form state — every field is a raw string from a TextInput. */
export interface ServerConfigDraft {
  mode: ConnectionMode;
  baseUrl: string;
  cfClientId: string;
  cfClientSecret: string;
}

export const CF_CLIENT_ID_HEADER = "CF-Access-Client-Id";
export const CF_CLIENT_SECRET_HEADER = "CF-Access-Client-Secret";

/**
 * Prefill for the Cloudflare-mode URL field. Deliberately NOT
 * `EXPO_PUBLIC_API_URL`: Expo auto-loads the upstream `.env.production`
 * (api.multica.ai) into production bundles, and that is not our server.
 */
export const DEFAULT_CLOUDFLARE_URL =
  process.env.EXPO_PUBLIC_DEFAULT_SERVER_URL?.trim() || "";

/** Prefill for the direct-mode URL field (empty: the user types the LAN host). */
export const DEFAULT_DIRECT_URL = "";

export type ServerConfigError =
  | "url_missing"
  | "url_invalid"
  | "url_scheme"
  | "cf_client_id_missing"
  | "cf_client_secret_missing";

export type ValidationResult =
  | { ok: true; config: ServerConfig }
  | { ok: false; error: ServerConfigError };

/**
 * Normalise what the user typed into a base URL the API client can prefix
 * paths onto:
 *   - trims whitespace
 *   - defaults to `https://` when no scheme is given
 *   - drops query / hash, trailing slashes
 *   - keeps an explicit port and an optional path prefix
 *
 * Returns null when the input is empty or not an http(s) URL.
 */
export function normalizeServerUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!url.hostname) return null;
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.protocol}//${url.host}${path}`;
}

export function validateServerConfig(draft: ServerConfigDraft): ValidationResult {
  const raw = draft.baseUrl.trim();
  if (!raw) return { ok: false, error: "url_missing" };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) && !/^https?:\/\//i.test(raw)) {
    return { ok: false, error: "url_scheme" };
  }
  const baseUrl = normalizeServerUrl(raw);
  if (!baseUrl) return { ok: false, error: "url_invalid" };

  if (draft.mode === "cloudflare") {
    const cfClientId = draft.cfClientId.trim();
    const cfClientSecret = draft.cfClientSecret.trim();
    if (!cfClientId) return { ok: false, error: "cf_client_id_missing" };
    if (!cfClientSecret) return { ok: false, error: "cf_client_secret_missing" };
    return {
      ok: true,
      config: { mode: "cloudflare", baseUrl, cfClientId, cfClientSecret },
    };
  }
  return {
    ok: true,
    config: { mode: "direct", baseUrl, cfClientId: "", cfClientSecret: "" },
  };
}

/**
 * Headers Cloudflare Access needs on every request. Empty in direct mode or
 * when the token is incomplete — the request then simply hits Access
 * unauthenticated and the caller surfaces the block (see
 * `looksLikeAccessBlock`).
 */
export function cfAccessHeaders(
  config: Pick<ServerConfig, "mode" | "cfClientId" | "cfClientSecret"> | null,
): Record<string, string> {
  if (!config || config.mode !== "cloudflare") return {};
  if (!config.cfClientId || !config.cfClientSecret) return {};
  return {
    [CF_CLIENT_ID_HEADER]: config.cfClientId,
    [CF_CLIENT_SECRET_HEADER]: config.cfClientSecret,
  };
}

/** Origin (scheme + host + port) of an absolute URL, or null. */
export function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** True when `url` is served by the configured server (same origin). */
export function isServerUrl(url: string, baseUrl: string): boolean {
  const a = originOf(url);
  const b = originOf(baseUrl);
  return a !== null && b !== null && a === b;
}

/**
 * Headers to attach when loading an arbitrary URL (images, attachments).
 * The service token must only ever travel to *our* origin — an avatar on a
 * public CDN or an external image in a comment gets nothing.
 */
export function headersForUrl(
  url: string,
  config: ServerConfig | null,
): Record<string, string> {
  if (!config) return {};
  if (!isServerUrl(url, config.baseUrl)) return {};
  return cfAccessHeaders(config);
}

/** http(s)://host[/prefix] → ws(s)://host[/prefix]/ws */
export function wsUrlFor(baseUrl: string): string {
  return `${baseUrl.replace(/^http/, "ws")}/ws`;
}

/**
 * Human-friendly label for the current server, e.g. for the login screen.
 * Strips the scheme so `multica.example.com` reads cleanly.
 */
export function serverLabel(config: Pick<ServerConfig, "baseUrl"> | null): string {
  if (!config) return "";
  return config.baseUrl.replace(/^https?:\/\//, "");
}

export interface ResponseShape {
  /** HTTP status after redirects. */
  status: number;
  /** Final URL the fetch landed on (`Response.url`), if the runtime exposes it. */
  url?: string | null;
  /** `content-type` header of the final response. */
  contentType?: string | null;
  /** `server` header of the final response (Access pages say `cloudflare`). */
  server?: string | null;
  /** Beginning of the body when it is HTML (the Access login page names itself). */
  bodyStart?: string | null;
  /** The URL we asked for. */
  requestUrl: string;
}

/**
 * Did Cloudflare Access intercept this request?
 *
 * React Native's fetch follows redirects transparently, so the 302 Access
 * answers with becomes a 200 HTML login page from
 * `<team>.cloudflareaccess.com`. We therefore look at where the response
 * actually came from, not only at the status code:
 *
 *   - final URL on `cloudflareaccess.com` or under `/cdn-cgi/access/`
 *   - an HTML body that names Cloudflare Access / `/cdn-cgi/access/`
 *   - an HTML page served by `server: cloudflare` where Multica would have
 *     answered JSON (RN does not always expose the redirected URL)
 *   - a 302/401/403 whose body is HTML on a JSON API path
 *
 * An honest Multica 401/403 is JSON and stays a normal ApiError.
 */
export function looksLikeAccessBlock(res: ResponseShape): boolean {
  const finalUrl = res.url ?? "";
  if (finalUrl) {
    if (/\/\/[^/]*cloudflareaccess\.com\//i.test(finalUrl)) return true;
    if (/\/cdn-cgi\/access\//i.test(finalUrl)) return true;
    const finalOrigin = originOf(finalUrl);
    const requestOrigin = originOf(res.requestUrl);
    if (finalOrigin && requestOrigin && finalOrigin !== requestOrigin) return true;
  }
  const isHtml = /text\/html/i.test(res.contentType ?? "");
  if (!isHtml) return false;
  if (res.bodyStart && /cloudflare\s*access|cdn-cgi\/access/i.test(res.bodyStart)) {
    return true;
  }
  if (res.status === 302 || res.status === 401 || res.status === 403) return true;
  if (res.status === 200 && /cloudflare/i.test(res.server ?? "")) return true;
  return false;
}

/**
 * the setup screen never prefills the stored Cloudflare
 * secret. While the user keeps it ("Saved · Replace"), the draft's secret
 * stays empty and is filled from the stored config only for validation and
 * the connection test. Any other case returns the draft unchanged.
 */
export function withStoredSecret(
  draft: ServerConfigDraft,
  stored: ServerConfig | null,
  keepStored: boolean,
): ServerConfigDraft {
  if (
    keepStored &&
    draft.mode === "cloudflare" &&
    draft.cfClientSecret === "" &&
    stored?.mode === "cloudflare" &&
    stored.cfClientSecret
  ) {
    return { ...draft, cfClientSecret: stored.cfClientSecret };
  }
  return draft;
}
