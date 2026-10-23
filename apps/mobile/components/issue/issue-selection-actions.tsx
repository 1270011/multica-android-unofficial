/**
 * Bottom bar while the issue list is in selection mode:
 *
 *   ◷ Status   ▲ Priority   👤 Assign   🗑 Delete
 *
 * Each button opens the existing picker as a sheet (`batch-picker/*`), which
 * runs `useBatchUpdateIssues` on the selected ids. While that request runs
 * every button is disabled and the chosen one shows a spinner. At 200 % or
 * below 360 dp the buttons show only the icon; the label stays for
 * TalkBack. On tablets the bar floats centred, at most 560 dp wide.
 *
 * Delete (D7) asks first ("3 Issues löschen? …", `batchDeleteDialog`) and
 * then runs `useBatchDeleteIssues`; cancelling the dialog changes nothing.
 */
import { type ComponentProps } from "react";
import { ActivityIndicator, Alert, Pressable, View, useWindowDimensions } from "react-native";
import { useMutationState } from "@tanstack/react-query";
import { useTheme } from "@react-navigation/native";
import { router } from "expo-router";
import { Ionicons } from "@/components/ui/ionicons";
import { Text } from "@/components/ui/text";
import {
  BATCH_DELETE_MUTATION_KEY,
  BATCH_UPDATE_MUTATION_KEY,
  useBatchDeleteIssues,
  type BatchUpdateVariables,
} from "@/data/mutations/issue-move-batch";
import {
  confirmBatchDelete,
  batchFieldOf,
  selectionActionsIconsOnly,
  type BatchAction,
} from "@/lib/issue-batch";
import { useIssueSelectionStore } from "@/data/stores/issue-selection-store";
import { useT } from "@/lib/i18n";

const ACTIONS: { field: BatchAction; icon: ComponentProps<typeof Ionicons>["name"] }[] = [
  { field: "status", icon: "ellipse-outline" },
  { field: "priority", icon: "flag-outline" },
  { field: "assignee", icon: "person-outline" },
  { field: "delete", icon: "trash-outline" },
];

interface Props {
  wsSlug: string | null | undefined;
}

export function IssueSelectionActions({ wsSlug }: Props) {
  const { t } = useT("issues");
  const { colors } = useTheme();
  const { width, fontScale } = useWindowDimensions();
  const count = useIssueSelectionStore((s) => s.ids.length);
  const pending = useMutationState({
    filters: { mutationKey: BATCH_UPDATE_MUTATION_KEY, status: "pending" },
    select: (m) => batchFieldOf(m.state.variables as BatchUpdateVariables | undefined),
  });
  const deleting = useMutationState({
    filters: { mutationKey: BATCH_DELETE_MUTATION_KEY, status: "pending" },
  }).length > 0;
  const batchDelete = useBatchDeleteIssues();
  const busy = pending.length > 0 || deleting;
  const busyField: BatchAction | null = deleting ? "delete" : (pending[0] ?? null);
  const iconsOnly = selectionActionsIconsOnly(width, fontScale);

  const confirmDelete = () =>
    confirmBatchDelete(Alert.alert, t, useIssueSelectionStore.getState().ids, (ids) =>
      batchDelete.mutate(ids),
    );

  const open = (field: BatchAction) => {
    if (field === "delete") return confirmDelete();
    if (!wsSlug) return;
    useIssueSelectionStore.getState().setPickerOpen(true);
    router.push(`/${wsSlug}/batch-picker/${field}`);
  };

  return (
    <View
      className="w-full max-w-[560px] self-center flex-row border-t border-border bg-background"
      testID="selection-actions"
    >
      {ACTIONS.map(({ field, icon }) => {
        const disabled = busy || count === 0;
        const label = t(`selection.action_${field}`);
        return (
          <Pressable
            key={field}
            onPress={() => open(field)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ disabled, busy: busyField === field }}
            testID={`selection-action-${field}`}
            className="flex-1 min-h-12 flex-row items-center justify-center gap-2 px-2 py-2 active:bg-secondary"
            style={{ opacity: disabled && busyField !== field ? 0.4 : 1 }}
          >
            {busyField === field ? (
              <ActivityIndicator size="small" color={colors.text} />
            ) : (
              <Ionicons name={icon} size={20} color={colors.text} />
            )}
            {iconsOnly ? null : (
              <Text className="text-sm text-foreground" numberOfLines={1}>
                {label}
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}
