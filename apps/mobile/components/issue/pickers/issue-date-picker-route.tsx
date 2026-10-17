/**
 * Date picker route body for an existing issue's calendar-day fields
 * (`due_date`, `start_date`). Extracted from the due-date route
 * so start date shares the same Done / Clear header and Android dialog
 * handling (see due-date-picker-body.tsx).
 *
 * Diverges from the other single-select pickers because the native
 * UIDatePicker needs a confirmation step — the user spins to a date but
 * doesn't auto-commit on every onChange. Done / Clear buttons live in a
 * mini header row inside the route body (the parent Stack hides its own
 * header per the formSheet config), and on submit we fire the mutation +
 * router.back().
 */
import { useRef } from "react";
import { Pressable, View } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Text } from "@/components/ui/text";
import {
  DueDatePickerBody,
  type DueDatePickerBodyHandle,
} from "@/components/issue/pickers/due-date-picker-body";
import { issueDetailOptions } from "@/data/queries/issues";
import { useUpdateIssue } from "@/data/mutations/issues";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useT } from "@/lib/i18n";

export type IssueDateField = "due_date" | "start_date";

export function IssueDatePickerRoute({
  field,
  title,
}: {
  field: IssueDateField;
  title: string;
}) {
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: issue } = useQuery(issueDetailOptions(wsId, id));
  const updateIssue = useUpdateIssue(id);
  const ref = useRef<DueDatePickerBodyHandle>(null);

  const value = issue?.[field] ?? null;

  return (
    <View className="flex-1">
      <DateHeader
        title={title}
        hasValue={!!value}
        onDone={() => {
          const iso = ref.current?.getIso();
          if (iso) updateIssue.mutate({ [field]: iso });
          router.back();
        }}
        onClear={() => {
          updateIssue.mutate({ [field]: null });
          router.back();
        }}
      />
      <DueDatePickerBody ref={ref} value={value} />
    </View>
  );
}

export function DateHeader({
  title,
  hasValue,
  onDone,
  onClear,
}: {
  title: string;
  hasValue: boolean;
  onDone: () => void;
  onClear: () => void;
}) {
  const { t } = useT("issues");
  return (
    <View className="flex-row items-center justify-between px-4 pt-4 pb-2">
      <Text className="text-base font-semibold text-foreground">{title}</Text>
      <View className="flex-row items-center gap-1">
        {hasValue ? (
          <Pressable
            onPress={onClear}
            hitSlop={6}
            accessibilityRole="button"
            className="min-h-12 justify-center px-2 rounded-md active:bg-secondary"
          >
            <Text className="text-sm text-destructive">
              {t("picker.clear")}
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={onDone}
          hitSlop={6}
          accessibilityRole="button"
          className="min-h-12 justify-center px-2 rounded-md active:bg-secondary"
        >
          <Text className="text-sm font-medium text-primary">
            {t("common:actions.done")}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
