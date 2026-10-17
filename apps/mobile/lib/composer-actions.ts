/**
 * Trailing actions of the message composer.
 *
 * Web parity (packages/views/chat/components/chat-input.tsx): while an agent
 * run is in progress the user may keep writing; a message sent then joins
 * the run's queue — but only when the server says it supports follow-up
 * queues (`pendingTask.supports_queue === true`, `allowSubmitWhileRunning`).
 * Older servers stay stop-only.
 *
 * Phone layout: Send and Stop sit side by side instead of the
 * web's single swapping slot, so Stop stays one tap away while typing.
 */
export interface ComposerActionInput {
  isRunning: boolean;
  allowSubmitWhileRunning: boolean;
  /** A Stop control is offered for this run (chat: not for a queued head). */
  stopAvailable: boolean;
  hasContent: boolean;
  uploading: boolean;
  submitting: boolean;
  disabled: boolean;
}

export interface ComposerActions {
  showStop: boolean;
  showSend: boolean;
  canSend: boolean;
  /** Sending now puts the message into the run's queue. */
  queues: boolean;
}

export function composerActions(i: ComposerActionInput): ComposerActions {
  const ready = !i.disabled && !i.submitting && !i.uploading && i.hasContent;
  if (!i.isRunning) {
    return { showStop: false, showSend: true, canSend: ready, queues: false };
  }
  if (!i.allowSubmitWhileRunning) {
    // Stop-only (older server): the send slot shows Stop when there is one,
    // else a disabled Send as before.
    return { showStop: i.stopAvailable, showSend: !i.stopAvailable, canSend: false, queues: false };
  }
  return { showStop: i.stopAvailable, showSend: true, canSend: ready, queues: true };
}
