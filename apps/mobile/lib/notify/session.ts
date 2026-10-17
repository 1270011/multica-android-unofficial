/**
 * Session hand-over to the notification service (security T2,
 * docs/TECHNIK.md §1.5). One source of truth: JS passes the session only
 * after it is committed (login, restore, renewal) and clears the native
 * copy synchronously before any local teardown continues (logout,
 * clearToken, 401, server reset).
 */
import { getServerConfig } from "@/data/server-config-store";
import type { ServerConfig } from "@/lib/server-config";
import { rbNotify } from "./native";

/** Hand the committed session to the service; no-op while push is off. */
export function handOverSession(token: string | null | undefined): boolean {
  if (!token) return false;
  if (!rbNotify.getSettings().enabled) return false;
  const config = getServerConfig();
  if (!config?.baseUrl) return false;
  return rbNotify.setCredentials({
    baseUrl: config.baseUrl,
    token,
    cfClientId: config.mode === "cloudflare" ? config.cfClientId : "",
    cfClientSecret: config.mode === "cloudflare" ? config.cfClientSecret : "",
  });
}

/** Synchronous: when this returns, the native copy and the service are gone. */
export function clearNotifySession(): void {
  rbNotify.clearCredentials();
}

/**
 * Same server, new Cloudflare Access credentials (security N3): there is no
 * sign-out, but the service still holds the old CF secret and would run
 * into 403. True when only the CF pair changed.
 */
export function cfCredentialsChanged(previous: ServerConfig | null, next: ServerConfig): boolean {
  return (
    !!previous &&
    previous.baseUrl === next.baseUrl &&
    previous.mode === next.mode &&
    next.mode === "cloudflare" &&
    (previous.cfClientId !== next.cfClientId || previous.cfClientSecret !== next.cfClientSecret)
  );
}

/**
 * Call after the new config is saved: drop the native copy first, then hand
 * the session over again with the new CF headers. False when nothing changed.
 */
export function renewNotifySessionForConfig(
  previous: ServerConfig | null,
  next: ServerConfig,
  token: string | null | undefined,
): boolean {
  if (!cfCredentialsChanged(previous, next)) return false;
  clearNotifySession();
  handOverSession(token);
  return true;
}
