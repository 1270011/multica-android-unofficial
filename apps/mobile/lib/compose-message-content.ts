/**
 * Outgoing markdown of a composer draft: mention chips first, then the
 * typed text. Shared by `MessageComposer` (send) and the comment trigger
 * preview, so the preview asks the server about exactly
 * the content that would be posted.
 */
import type { MentionChip } from "@/components/issue/composer-attachment-row";

/** Serialises mention chips into the markdown link form the backend
 *  regex parser recognises. The string lands at the START of the
 *  outgoing content; mobile can't position mentions inline because the
 *  TextInput is plain. Acceptable semantic difference vs web/desktop's
 *  rich editor (web supports anywhere-in-text). */
export function serializeMentionChips(chips: readonly MentionChip[]): string {
  return chips
    .map((m) => {
      const label =
        m.type === "issue"
          ? m.name
          : m.type === "all"
            ? "@all"
            : `@${m.name}`;
      return `[${label}](mention://${m.type}/${m.id})`;
    })
    .join(" ");
}

export function composeMessageContent(text: string, mentions: readonly MentionChip[]): string {
  const mentionMd = serializeMentionChips(mentions);
  const trimmed = text.trim();
  if (!mentionMd) return trimmed;
  return trimmed ? `${mentionMd} ${trimmed}` : mentionMd;
}
