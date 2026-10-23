/**
 * Actions for one wakeup row: the "⋯" menu, the
 * TalkBack actions and the on/off switch all run through `run()`, so they
 * behave the same. Rules live in lib/wakeup-actions.ts.
 *
 * - Switching off and deleting ask first. Delete waits for the
 *   server (mutateAsync); the row goes away with the refetch, not before.
 * - The switch flips optimistically and rolls back on error (data layer W1,
 *   `useToggleIssueWakeup`); here only the toast.
 * - Enabling an `at` rule whose time has passed opens the time sheet
 *   (`wakeup-reschedule`) instead of enabling.
 * - A 403 marks the row as "no rights" (`onForbidden`); only "view runs"
 *   stays (`issue/[id]/wakeups/[wakeupId]`).
 * - The workspace overview uses one hook per row with the
 *   row's `issue_id`; its rows carry no instruction, so the hook only reads
 *   the fields in `MenuWakeup`. `togglingTo` is the value the switch shows
 *   while the toggle is in flight (the optimistic patch only covers the
 *   issue's own list).
 */
import { Alert } from "react-native";
import { router } from "expo-router";
import {
  useDeleteIssueWakeup,
  useToggleIssueWakeup,
  useTriggerIssueWakeup,
} from "@/data/mutations/wakeups";
import type { MobileIssueWakeup } from "@/data/wakeup-schemas";
import { useWorkspaceStore } from "@/data/workspace-store";
import { showActionSheet } from "@/lib/action-sheet";
import { useT } from "@/lib/i18n";
import { ACTION_TOAST_DURATION_MS, showToast } from "@/lib/toast";
import {
  enableNeedsNewTime,
  wakeupErrorKind,
  type WakeupAction,
} from "@/lib/wakeup-actions";

type MenuWakeup = Pick<
  MobileIssueWakeup,
  "id" | "revision" | "agent_name" | "kind" | "enabled" | "next_fire_at" | "disabled_at" | "paused_reason"
>;

export function useWakeupMenu({
  issueId,
  onForbidden,
}: {
  issueId: string;
  onForbidden: (wakeupId: string) => void;
}) {
  const { t } = useT("issues");
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const toggle = useToggleIssueWakeup(issueId);
  const trigger = useTriggerIssueWakeup(issueId);
  const remove = useDeleteIssueWakeup(issueId);

  const labelOf = (action: WakeupAction) => t(`wakeups.actions.${action}`);
  const agentOf = (w: MenuWakeup) => w.agent_name || t("wakeups.agent_subject");

  const fail = (w: MenuWakeup, err: unknown, fallbackKey: string) => {
    const kind = wakeupErrorKind(err);
    if (kind === "forbidden") onForbidden(w.id);
    showToast(kind === "failed" ? t(fallbackKey) : t(`wakeups.toast.${kind}`));
  };

  const push = (route: "wakeup-instruction" | "wakeup-reschedule" | "runs", wid?: string) => {
    if (!wsSlug) return;
    router.push({
      pathname: `/[workspace]/issue/[id]/${route}`,
      params: wid ? { workspace: wsSlug, id: issueId, wid } : { workspace: wsSlug, id: issueId },
    });
  };

  const enable = (w: MenuWakeup) => {
    if (enableNeedsNewTime(w)) {
      push("wakeup-reschedule", w.id);
      return;
    }
    toggle.mutate(
      { wakeupId: w.id, enabled: true, revision: w.revision ?? 0 },
      {
        onSuccess: () => showToast(t("wakeups.toast.enabled")),
        onError: (err) => fail(w, err, "wakeups.toast.toggle_failed"),
      },
    );
  };

  const disable = (w: MenuWakeup) => {
    Alert.alert(
      t("wakeups.confirm.disable_title"),
      t("wakeups.confirm.disable_body"),
      [
        { text: t("common:actions.cancel"), style: "cancel" },
        {
          text: t("wakeups.actions.disable"),
          style: "destructive",
          onPress: () =>
            toggle.mutate(
              { wakeupId: w.id, enabled: false },
              {
                onSuccess: () => showToast(t("wakeups.toast.disabled")),
                onError: (err) => fail(w, err, "wakeups.toast.toggle_failed"),
              },
            ),
        },
      ],
      { cancelable: true },
    );
  };

  const run = (w: MenuWakeup, action: WakeupAction) => {
    switch (action) {
      case "trigger":
        trigger.mutate(w.id, {
          onSuccess: () =>
            showToast(t("wakeups.toast.triggered", { agent: agentOf(w) }), ACTION_TOAST_DURATION_MS, {
              label: t("wakeups.toast.view_run"),
              onPress: () => push("runs"),
            }),
          onError: (err) => fail(w, err, "wakeups.toast.trigger_failed"),
        });
        return;
      case "edit_instruction":
        push("wakeup-instruction", w.id);
        return;
      case "view_runs":
        if (wsSlug) {
          router.push({
            pathname: "/[workspace]/issue/[id]/wakeups/[wakeupId]",
            params: { workspace: wsSlug, id: issueId, wakeupId: w.id },
          });
        }
        return;
      case "enable":
      case "resume":
        enable(w);
        return;
      case "disable":
        disable(w);
        return;
      case "delete":
        Alert.alert(
          t("wakeups.confirm.delete_title"),
          t("wakeups.confirm.delete_body"),
          [
            { text: t("common:actions.cancel"), style: "cancel" },
            {
              text: t("wakeups.actions.delete"),
              style: "destructive",
              onPress: () => {
                // Waits for the server; mutateAsync, the menu may unmount.
                remove.mutateAsync(w.id).then(
                  () => showToast(t("wakeups.toast.deleted")),
                  (err: unknown) => fail(w, err, "wakeups.toast.delete_failed"),
                );
              },
            },
          ],
          { cancelable: true },
        );
        return;
    }
  };

  const open = (w: MenuWakeup, actions: WakeupAction[]) => {
    if (actions.length === 0) return;
    const deleteIndex = actions.indexOf("delete");
    showActionSheet(
      {
        options: [t("common:actions.cancel"), ...actions.map(labelOf)],
        cancelButtonIndex: 0,
        destructiveButtonIndex: deleteIndex >= 0 ? deleteIndex + 1 : undefined,
        title: t("wakeups.menu_title", { agent: agentOf(w) }),
      },
      (i) => {
        const action = actions[i - 1];
        if (i > 0 && action) run(w, action);
      },
    );
  };

  /** TalkBack custom actions for a row. */
  const accessibilityActionsFor = (actions: WakeupAction[]) =>
    actions.map((name) => ({ name, label: labelOf(name) }));

  const pending = toggle.isPending || remove.isPending;
  const togglingTo = toggle.isPending ? toggle.variables?.enabled : undefined;
  return {
    open,
    run,
    accessibilityActionsFor,
    pending,
    togglingTo,
    deletingId: remove.isPending ? remove.variables : null,
  };
}
