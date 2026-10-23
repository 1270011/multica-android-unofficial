/**
 * Fallback for links the app has no route for: a deep link from
 * an older or newer app version, or a typo. Expo Router showed its own
 * "Unmatched Route" page (English, no way back but "Go back"); the app goes
 * to the Inbox of the current workspace instead and says "Invalid link",
 * like an invalid issue id. Without a workspace the entry
 * redirect (app/index.tsx) decides.
 */
export const UNMATCHED_LINK_TOAST = "issues:chat.invalid_link";

export function unmatchedLinkTarget(slug: string | null | undefined): string {
  return slug ? `/${slug}/inbox` : "/";
}
