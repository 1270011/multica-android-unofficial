/**
 * Map backend auth errors to user-facing strings. The backend returns raw
 * English messages that are fine for logs but should not surface as-is —
 * we map the known shapes to friendlier copy and fall back to the caller's
 * default for anything unrecognised.
 */
type Translate = (key: string) => string;

export function mapAuthError(err: unknown, fallback: string, t?: Translate): string {
  if (!(err instanceof Error)) return fallback;
  // Cloudflare Access intercepted the request: the service token is
  // missing, wrong or revoked. Checked by name rather than instanceof so
  // this helper stays free of the data-layer import.
  if (err.name === "AccessBlockedError") {
    return t
      ? t("server.access_blocked")
      : "Cloudflare Access blocked the request. Check the service token in server settings.";
  }
  if (err.name === "ApiError" && /server not configured/i.test(err.message)) {
    return t
      ? t("server.not_configured")
      : "No server configured. Open server settings first.";
  }
  const msg = err.message.toLowerCase();
  if (/invalid|incorrect|wrong/.test(msg)) {
    return t ? t("verify.mismatch") : "That code didn't match. Double-check and try again.";
  }
  if (/expired/.test(msg)) {
    return t ? t("verify.expired") : "That code has expired. Tap resend to get a new one.";
  }
  if (/rate.?limit|too many|throttle/.test(msg)) {
    return t ? t("verify.rate_limited") : "Too many attempts. Wait a moment and try again.";
  }
  if (/network|fetch|timeout|unreachable/.test(msg)) {
    return t ? t("verify.network") : "Can't reach Multica. Check your connection and retry.";
  }
  return fallback;
}

/**
 * Debug token login: which message a
 * failed sign-in shows. Cloudflare Access blocking the request is not "the
 * server rejected this token" — the token was never checked. Network
 * trouble gets its own text too. Everything else stays generic: the
 * server's own message could echo the token.
 */
export function tokenLoginErrorKey(
  err: unknown,
): "server.access_blocked" | "verify.network" | "token_login.failed" {
  if (err instanceof Error && err.name === "AccessBlockedError") return "server.access_blocked";
  // data/api.ts reports a request timeout as ApiError with status 0
  // ("Request timed out after …"): no server answer, so a network problem
  // (review #33).
  if (err instanceof Error && err.name === "ApiError" && (err as { status?: unknown }).status === 0) {
    return "verify.network";
  }
  if (err instanceof Error && err.name !== "ApiError" && /network|fetch|time(d )?out|unreachable|abort/i.test(err.message)) {
    return "verify.network";
  }
  return "token_login.failed";
}
