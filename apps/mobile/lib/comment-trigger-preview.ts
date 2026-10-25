/**
 * Pure helpers for the comment trigger preview (W1-P3a,
 * W1-3). Mirrors web
 * packages/views/issues/hooks/use-comment-trigger-preview.ts: the server
 * answer only depends on the mention set (plus issue, reply target and live
 * queue state), so plain typing must not refetch — only a changed set of
 * mentions does.
 */
import { parseMentions } from "@multica/core/issues/comment-trigger-outcomes";
import type {
  CommentTriggerOutcome,
  CommentTriggerPreview,
  CommentTriggerPreviewAgent,
} from "@multica/core/types";

/** UX doc W1-3: "entprellt (≈ 400 ms)". */
export const COMMENT_TRIGGER_PREVIEW_DEBOUNCE_MS = 400;

/** Signature of a draft that needs no request (empty or `/note`). */
export const EMPTY_PREVIEW_SIGNATURE = "empty";

const NOTE_COMMAND_RE = /^\/note(?:$|\s)/i;

/** `/note …` posts a comment that never starts an agent. */
export function isNoteCommentDraft(content: string): boolean {
  return NOTE_COMMAND_RE.test(content.replace(/^[ \t\r\n]+/, ""));
}

/**
 * Stable key for "what the server would be asked". Issue links are no
 * triggers and are ignored; duplicate mentions count once; order of first
 * appearance is kept (same as web).
 */
export function commentTriggerPreviewSignature(content: string): string {
  if (!content.trim() || isNoteCommentDraft(content)) return EMPTY_PREVIEW_SIGNATURE;

  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const { type, id } of parseMentions(content)) {
    if (type === "issue") continue;
    const token = `${type}:${id}`;
    if (seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
  }
  return `nonempty|${tokens.join(",")}`;
}

/** A structured @all mention notifies members but never starts agents. */
export function hasAllMembersMention(content: string): boolean {
  return parseMentions(content).some(({ type, id }) => type === "all" && id === "all");
}

/**
 * Status codes that mean "this server has no trigger-preview endpoint"
 * (older or trimmed server). The answer is kept for the session so the
 * composer does not ask again on every mention change.
 */
export function isPreviewUnsupportedError(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  return status === 404 || status === 405 || status === 501;
}

export interface CommentTriggerPreviewResult {
  agents: CommentTriggerPreviewAgent[];
  /** Explicit @agent/@squad mentions that would NOT trigger as posted. */
  blocked: CommentTriggerOutcome[];
  hasAllMembersMention: boolean;
  /**
   * Whether `agents` answers the draft's current mentions. While a changed
   * mention set is still debouncing or loading, the previous answer is
   * shown; nothing destructive (e.g. suppress chips in P3b) may act on it.
   */
  isCurrent: boolean;
}

/**
 * Maps the hook's inputs to its result. Loading, errors and a missing
 * endpoint all surface as "no agents": the preview is an enhancement and
 * must never block or break sending (UX doc W1-3).
 */
export function deriveCommentTriggerPreview(input: {
  signature: string;
  debouncedSignature: string;
  allMembers: boolean;
  data: CommentTriggerPreview | undefined;
  isSuccess: boolean;
  isPlaceholderData: boolean;
}): CommentTriggerPreviewResult {
  const { signature, debouncedSignature, allMembers, data } = input;
  if (signature === EMPTY_PREVIEW_SIGNATURE || debouncedSignature === EMPTY_PREVIEW_SIGNATURE) {
    return {
      agents: [],
      blocked: [],
      hasAllMembersMention: allMembers,
      isCurrent: signature === EMPTY_PREVIEW_SIGNATURE,
    };
  }
  return {
    agents: data?.agents ?? [],
    blocked: data?.blocked ?? [],
    hasAllMembersMention: allMembers,
    isCurrent: signature === debouncedSignature && input.isSuccess && !input.isPlaceholderData,
  };
}

/**
 * Debounce step used by the hook's effect: an empty signature applies at
 * once (clears the preview without delay), anything else after `delayMs`.
 * Returns the cleanup that cancels a pending update.
 */
export function scheduleSignatureUpdate(
  signature: string,
  apply: (signature: string) => void,
  delayMs: number = COMMENT_TRIGGER_PREVIEW_DEBOUNCE_MS,
): () => void {
  if (signature === EMPTY_PREVIEW_SIGNATURE) {
    apply(EMPTY_PREVIEW_SIGNATURE);
    return () => {};
  }
  const timer = setTimeout(() => apply(signature), delayMs);
  return () => clearTimeout(timer);
}
