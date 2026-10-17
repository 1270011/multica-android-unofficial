/**
 * Inbox segment from a link: the summary notification opens
 * `multica://<slug>/inbox?view=unread`. Only known segments are taken;
 * anything else keeps the screen's current segment.
 */
import type { InboxView } from "@/lib/inbox-display";

const VIEWS: readonly InboxView[] = ["all", "unread", "archived"];

export function inboxViewFromParam(value: string | string[] | undefined): InboxView | null {
  const v = Array.isArray(value) ? value[0] : value;
  return v && (VIEWS as readonly string[]).includes(v) ? (v as InboxView) : null;
}
