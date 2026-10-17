/**
 * Pull-to-refresh guard. While offline TanStack Query pauses
 * the refetch, so the spinner would sit there with no feedback. Instead the
 * guard shows a toast and resolves at once, which also stops the
 * RefreshControl spinner.
 */
import { isOnline } from "@/lib/network-status";
import { showToast } from "@/lib/toast";

export async function guardedRefresh(refresh: () => unknown): Promise<void> {
  if (!isOnline()) {
    showToast({ key: "common:states.offline_refresh" });
    return;
  }
  await refresh();
}
