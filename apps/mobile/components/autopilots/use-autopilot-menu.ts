/**
 * Row menu of the autopilot list. One implementation for the "⋯" button, long-press and the
 * TalkBack actions (`accessibilityActions`) of a row.
 *
 * - Run now waits for the server and toasts per run status
 *   (lib/autopilot-list.ts `runNowToast`); `skipped` is a warning with its
 *   reason, never success.
 * - Pause/resume flips optimistically (A1 mutation) and offers "Undo".
 * - Runs opens the runs list.
 * - Delete asks first and waits for the server; the detail
 * passes `onDeleted` to leave only after that.
 * Without write access (`can_write === false`) only "Läufe ansehen" is left.
 */
import { useState } from "react";
import { Alert } from "react-native";
import { router } from "expo-router";
import type { MobileAutopilot } from "@/data/autopilot-schemas";
import {
  useDeleteAutopilot,
  useSetAutopilotStatus,
  useTriggerAutopilot,
} from "@/data/mutations/autopilots";
import { useWorkspaceStore } from "@/data/workspace-store";
import { showActionSheet } from "@/lib/action-sheet";
import { deleteThenLeave } from "@/lib/autopilot-detail";
import { autopilotActions, runNowToast, type AutopilotAction } from "@/lib/autopilot-list";
import { autopilotRunsHref } from "@/lib/autopilot-runs";
import { useT } from "@/lib/i18n";
import { ACTION_TOAST_DURATION_MS, showToast, TOAST_DURATION_MS } from "@/lib/toast";

export function useAutopilotMenu(options: { onDeleted?: () => void } = {}) {
  const { onDeleted } = options;
  const { t } = useT("workspace");
  // Ids with a "run now" in flight: the detail button reads "Wird gestartet…".
  const [starting, setStarting] = useState<ReadonlySet<string>>(new Set());
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const trigger = useTriggerAutopilot();
  const setStatus = useSetAutopilotStatus();
  const remove = useDeleteAutopilot();

  const labelOf = (action: AutopilotAction) => t(`autopilot.actions.${action}`);

  const runNow = async (a: MobileAutopilot) => {
    showToast(t("autopilot.running_toast"));
    setStarting((prev) => new Set(prev).add(a.id));
    try {
      const result = await trigger.mutateAsync({ id: a.id });
      const toast = runNowToast(result);
      const p = toast.params;
      const text =
        toast.key === "skipped"
          ? t("autopilot.run_toast.skipped", { reason: t(`autopilot.reason.${p.reason ?? "generic"}`) })
          : toast.key === "failed"
            ? p.failure
              ? t("autopilot.run_toast.failed", { failure: p.failure })
              : t("autopilot.run_toast.failed_plain")
            : t(`autopilot.run_toast.${toast.key}`, { status: p.status });
      const issueId = result?.issue_id;
      if (toast.action === "open_issue" && issueId && wsSlug) {
        showToast(text, ACTION_TOAST_DURATION_MS, {
          label: t("autopilot.open_issue"),
          onPress: () => router.push(`/${wsSlug}/issue/${issueId}`),
        });
      } else {
        showToast(text, toast.tone === "success" ? TOAST_DURATION_MS : ACTION_TOAST_DURATION_MS);
      }
    } catch {
      showToast(t("autopilot.trigger_failed"), ACTION_TOAST_DURATION_MS);
    } finally {
      setStarting((prev) => {
        const next = new Set(prev);
        next.delete(a.id);
        return next;
      });
    }
  };

  const changeStatus = (a: MobileAutopilot, next: "active" | "paused", undoable: boolean) => {
    setStatus.mutate(
      { id: a.id, status: next },
      {
        onSuccess: () => {
          const text = t(next === "paused" ? "autopilot.paused_toast" : "autopilot.resumed_toast");
          if (!undoable) return showToast(text);
          showToast(text, ACTION_TOAST_DURATION_MS, {
            label: t("autopilot.undo"),
            onPress: () => changeStatus(a, next === "paused" ? "active" : "paused", false),
          });
        },
        // The A1 mutation already rolled the cache back.
        onError: () => showToast(t("autopilot.status_failed"), ACTION_TOAST_DURATION_MS),
      },
    );
  };

  const confirmDelete = (a: MobileAutopilot) => {
    Alert.alert(
      t("autopilot.delete_title"),
      t("autopilot.delete_message", { title: a.title }),
      [
        { text: t("common:actions.cancel"), style: "cancel" },
        {
          text: t("autopilot.delete_confirm"),
          style: "destructive",
          onPress: () => {
            // No optimistic removal: the row stays until the server agrees.
            void deleteThenLeave(
              () => remove.mutateAsync(a.id),
              () => {
                showToast(t("autopilot.deleted_toast"));
                onDeleted?.();
              },
              () => showToast(t("autopilot.delete_failed"), ACTION_TOAST_DURATION_MS),
            );
          },
        },
      ],
      { cancelable: true },
    );
  };

  const run = (a: MobileAutopilot, action: AutopilotAction) => {
    switch (action) {
      case "run":
        void runNow(a);
        return;
      case "pause":
        changeStatus(a, "paused", true);
        return;
      case "resume":
        changeStatus(a, "active", true);
        return;
      case "runs":
        if (wsSlug) router.push(autopilotRunsHref(wsSlug, a.id));
        return;
      case "delete":
        confirmDelete(a);
        return;
    }
  };

  const open = (a: MobileAutopilot) => {
    const actions = autopilotActions(a);
    const deleteIndex = actions.indexOf("delete");
    showActionSheet(
      {
        options: [t("common:actions.cancel"), ...actions.map(labelOf)],
        cancelButtonIndex: 0,
        destructiveButtonIndex: deleteIndex >= 0 ? deleteIndex + 1 : undefined,
        title: a.title,
      },
      (i) => {
        const action = actions[i - 1];
        if (i > 0 && action) run(a, action);
      },
    );
  };

  /** TalkBack / VoiceOver custom actions for a row. */
  const accessibilityActionsFor = (a: MobileAutopilot) =>
    autopilotActions(a).map((name) => ({ name, label: labelOf(name) }));

  const isStarting = (id: string) => starting.has(id);

  return { open, run, accessibilityActionsFor, isStarting };
}
