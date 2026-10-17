/**
 * Links into the Multica web UI, derived from the server the phone is
 * configured against — never from the build-time `EXPO_PUBLIC_WEB_URL`.
 *
 * Why: Expo auto-loads the upstream `.env.production` into release bundles,
 * where `EXPO_PUBLIC_WEB_URL=https://multica.ai`. "Copy link" / "Open on
 * web" in this Android build therefore pointed at multica.ai, and in
 * debug builds (variable unset) the menu entries were missing entirely.
 * A self-hosted Multica serves web UI and API from one origin, so the
 * configured server URL is the web URL.
 *
 * Pure functions — the store wrapper lives in data/server-config-store.ts.
 */

function trimSlashes(base: string): string {
  return base.replace(/\/+$/, "");
}

export function webIssueUrl(
  base: string | null,
  wsSlug: string | null | undefined,
  identifier: string | null | undefined,
): string | null {
  if (!base || !wsSlug || !identifier) return null;
  return `${trimSlashes(base)}/${wsSlug}/issue/${identifier}`;
}

export function webCommentUrl(
  base: string | null,
  wsSlug: string | null | undefined,
  identifier: string | null | undefined,
  commentId: string | null | undefined,
): string | null {
  const issue = webIssueUrl(base, wsSlug, identifier);
  if (!issue || !commentId) return null;
  return `${issue}#comment-${commentId}`;
}

export function webProjectUrl(
  base: string | null,
  wsSlug: string | null | undefined,
  projectId: string | null | undefined,
): string | null {
  if (!base || !wsSlug || !projectId) return null;
  return `${trimSlashes(base)}/${wsSlug}/projects/${projectId}`;
}

export function webSettingsUrl(
  base: string | null,
  wsSlug: string | null | undefined,
  tab: string,
): string | null {
  if (!base || !wsSlug) return null;
  return `${trimSlashes(base)}/${wsSlug}/settings?tab=${encodeURIComponent(tab)}`;
}
