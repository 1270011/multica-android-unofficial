/**
 * Edit a wakeup's instruction. formSheet route,
 * opened from the row menu (`useWakeupMenu`):
 *
 *   /[workspace]/issue/[id]/wakeup-instruction?wid=<wakeupId>
 *
 * The sheet keeps the rule it opened with as snapshot; Save sends its
 * `instruction` as `expected_instruction` plus its `revision`
 * (lib/wakeup-actions.ts `instructionPatch`). A 409 means someone changed
 * the rule meanwhile: the sheet reloads, takes the fresh row as the new
 * snapshot, keeps the draft and says so. Save waits for the server.
 */
import { useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { useEditIssueWakeupInstruction } from "@/data/mutations/wakeups";
import { issueWakeupsOptions } from "@/data/queries/wakeups";
import type { MobileIssueWakeup } from "@/data/wakeup-schemas";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useT } from "@/lib/i18n";
import { showToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import {
  checkWakeupInstruction,
  instructionPatch,
  snapshotAfterConflict,
  wakeupErrorKind,
} from "@/lib/wakeup-actions";

export default function WakeupInstructionRoute() {
  const { id: issueId, wid } = useLocalSearchParams<{ id: string; wid: string }>();
  const { t } = useT("issues");
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const query = useQuery(issueWakeupsOptions(wsId, issueId));
  const edit = useEditIssueWakeupInstruction(issueId);

  const [snapshot, setSnapshot] = useState<MobileIssueWakeup | null>(null);
  const [value, setValue] = useState("");
  const [notice, setNotice] = useState<"conflict" | "failed" | null>(null);

  // Seed once; later refetches must not replace the snapshot or the draft.
  useEffect(() => {
    if (snapshot) return;
    const row = query.data?.find((w) => w.id === wid);
    if (!row) return;
    setSnapshot(row);
    setValue(row.instruction);
  }, [query.data, wid, snapshot]);

  const check = checkWakeupInstruction(value, snapshot?.instruction ?? "");
  const invalid = !check.ok && check.reason !== "unchanged" && value.length > 0;
  const canSave = check.ok && !!snapshot && !edit.isPending;

  const onSave = async () => {
    if (!check.ok || !snapshot || edit.isPending) return;
    setNotice(null);
    try {
      await edit.mutateAsync({ wakeupId: snapshot.id, ...instructionPatch(snapshot, check.instruction) });
      showToast(t("wakeups.toast.instruction_saved"));
      router.back();
    } catch (err) {
      const kind = wakeupErrorKind(err);
      if (kind === "conflict" || kind === "gone") {
        const fresh = snapshotAfterConflict((await query.refetch()).data, snapshot.id);
        if (!fresh) {
          showToast(t("wakeups.toast.gone"));
          router.back();
          return;
        }
        setSnapshot(fresh);
        setNotice("conflict");
      } else if (kind === "forbidden") {
        showToast(t("wakeups.toast.forbidden"));
        router.back();
      } else {
        setNotice("failed");
      }
    }
  };

  return (
    <ScrollView className="flex-1" contentContainerClassName="px-4 pt-4 pb-8 gap-3" keyboardShouldPersistTaps="handled">
      <View className="flex-row items-center justify-between">
        <Text accessibilityRole="header" className="text-base font-semibold text-foreground">
          {t("wakeups.instruction.title")}
        </Text>
        <Pressable
          onPress={onSave}
          disabled={!canSave}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSave, busy: edit.isPending }}
          className={cn("min-h-[48px] px-2 justify-center active:opacity-60", !canSave && "opacity-40")}
          testID="wakeup-instruction-save"
        >
          <Text className="text-sm text-primary font-semibold">{t("wakeups.instruction.save")}</Text>
        </Pressable>
      </View>
      {!snapshot ? (
        <Text className="text-sm text-muted-foreground" accessibilityLiveRegion="polite">
          {query.isPending ? t("wakeups.loading") : t("wakeups.toast.gone")}
        </Text>
      ) : (
        <>
          <TextField
            value={value}
            onChangeText={(v) => {
              setValue(v);
              if (notice === "failed") setNotice(null);
            }}
            accessibilityLabel={t("wakeups.instruction.label")}
            multiline
            style={{ textAlignVertical: "top", minHeight: 160, paddingVertical: 8 }}
            autoFocus
            invalid={invalid}
            editable={!edit.isPending}
            testID="wakeup-instruction-input"
          />
          {invalid && !check.ok ? (
            <Text className="text-xs text-destructive" accessibilityLiveRegion="polite">
              {t(`wakeups.instruction.${check.reason}`)}
            </Text>
          ) : null}
          {notice === "conflict" ? (
            <View
              className="gap-1 rounded-md border border-border p-3"
              accessibilityLiveRegion="assertive"
              testID="wakeup-instruction-conflict"
            >
              <Text className="text-sm text-foreground">{t("wakeups.instruction.conflict")}</Text>
              <Text className="text-xs text-muted-foreground">{t("wakeups.instruction.server_text")}</Text>
              <Text className="text-sm text-foreground italic" selectable>
                {snapshot.instruction}
              </Text>
            </View>
          ) : notice === "failed" ? (
            <Text className="text-sm text-destructive" accessibilityLiveRegion="assertive">
              {t("wakeups.instruction.save_failed")}
            </Text>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}
