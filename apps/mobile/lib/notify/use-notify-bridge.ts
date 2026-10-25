/**
 * Keeps the native notification service in line with the app while it runs
 *: UI strings in the in-app language,
 * the workspace list of the account, actor names for the notification
 * lines, the title-filter push mute of every workspace, and a
 * (re)start whenever the app comes to the foreground — the only moment
 * Android 12+ allows starting the foreground service besides boot.
 *
 * Mounted once in the workspace layout. Never asks for permissions.
 */
import { useEffect } from "react";
import { AppState } from "react-native";
import { useQueries, useQuery } from "@tanstack/react-query";
import { api } from "@/data/api";
import { workspaceListOptions } from "@/data/queries/workspaces";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useViewPrefsStore } from "@/data/stores/view-prefs-store";
import { i18n, useLocale } from "@/lib/i18n";
import { notifyAvailable, rbNotify } from "./native";
import { buildNativeStrings } from "./push-logic";
import { handOverSession } from "./session";
import { buildActorMap, notifyActorsOptions } from "./actors";
import { createTitleMuteMirror } from "./title-mute";

/** Start/re-sync the service if switched on; hand over the session if it lost it. */
export function ensureNotifyRunning(): void {
  if (!notifyAvailable) return;
  if (!rbNotify.getSettings().enabled) return;
  if (!rbNotify.hasCredentials()) handOverSession(api.getToken());
  rbNotify.start();
}

export function useNotifyBridge(): void {
  const locale = useLocale();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: workspaces } = useQuery({ ...workspaceListOptions(), enabled: notifyAvailable });
  // Names of every workspace, the open one first (a ping from another
  // workspace showed "Multica" as sender).
  const ordered = [...(workspaces ?? [])].sort((a, b) => (a.id === wsId ? -1 : b.id === wsId ? 1 : 0));
  const actorQueries = useQueries({
    queries: ordered.map((w) => ({ ...notifyActorsOptions(w), enabled: notifyAvailable })),
  });
  const actorLists = actorQueries.map((q) => q.data);
  const actorKey = actorQueries.map((q) => q.dataUpdatedAt).join(",");

  useEffect(() => {
    if (!notifyAvailable) return;
    rbNotify.setStrings(buildNativeStrings(i18n.t.bind(i18n)));
  }, [locale]);

  useEffect(() => {
    if (!notifyAvailable || !workspaces) return;
    rbNotify.setWorkspaces(
      workspaces.map((w) => ({ id: w.id, slug: w.slug, name: w.name, enabled: true })),
    );
    ensureNotifyRunning();
  }, [workspaces]);

  useEffect(() => {
    if (!notifyAvailable || actorLists.every((l) => !l)) return;
    rbNotify.setActors(buildActorMap(actorLists));
    // actorKey changes exactly when one of the lists changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorKey]);

  // Title filter push mute (W7): load every workspace's stored filter, not
  // only the open one, because the service notifies for all of them.
  const workspaceIds = (workspaces ?? []).map((w) => w.id).join(",");
  useEffect(() => {
    if (!notifyAvailable || !workspaceIds) return;
    const store = useViewPrefsStore.getState();
    for (const id of workspaceIds.split(",")) void store.hydrate(id);
  }, [workspaceIds]);

  useEffect(() => {
    if (!notifyAvailable) return;
    const mirror = createTitleMuteMirror((id, config) => rbNotify.setTitleMute(id, config));
    let generation = useViewPrefsStore.getState().generation;
    mirror.sync(useViewPrefsStore.getState().titleFilterByWorkspace);
    return useViewPrefsStore.subscribe((state) => {
      // Logout cleared the native copy with the session: push everything again.
      if (state.generation !== generation) {
        generation = state.generation;
        mirror.reset();
      }
      mirror.sync(state.titleFilterByWorkspace);
    });
  }, []);

  useEffect(() => {
    if (!notifyAvailable) return;
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") {
        ensureNotifyRunning();
        rbNotify.resumeForegroundIssue(); // chat still open → no pings for it
      } else rbNotify.pauseForegroundIssue();
    });
    return () => sub.remove();
  }, []);
}
