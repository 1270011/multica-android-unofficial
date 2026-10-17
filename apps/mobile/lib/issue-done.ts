/**
 * "Done": status first, archive only after it succeeded — a failed status
 * write must not archive the entry (review #12, same order as
 * useMarkInboxIssueDone). Returns whether the status write went through.
 */
export async function markIssueDoneInOrder(
  setDone: () => Promise<unknown>,
  archive: (inboxId: string) => void,
  inboxId: string | undefined,
): Promise<boolean> {
  try {
    await setDone();
  } catch {
    return false; // useUpdateIssue already rolled back and toasted
  }
  if (inboxId) archive(inboxId);
  return true;
}
