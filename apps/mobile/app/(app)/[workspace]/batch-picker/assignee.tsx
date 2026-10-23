/**
 * Assignee picker for the issue-list selection, incl.
 * "Unassigned". Assigning an agent can start a run on every issue, like on
 * a single issue, so the sheet says so above the list. Native
 * search bar as in `issue/[id]/picker/assignee.tsx`. See ./status.tsx.
 */
import { View } from "react-native";
import { AssigneePickerBody } from "@/components/issue/pickers/assignee-picker-body";
import { useBatchPicker } from "@/components/issue/pickers/use-batch-picker";
import { commonValue } from "@/lib/issue-batch";
import { Text } from "@/components/ui/text";
import { useNativeSearchBar } from "@/lib/use-native-search-bar";
import { useT } from "@/lib/i18n";

export default function BatchAssigneePickerRoute() {
  const { t } = useT("issues");
  const { count, issues, apply } = useBatchPicker();
  const query = useNativeSearchBar(t("picker.search_people"), { autoFocus: false });
  const key = commonValue(issues, (issue) =>
    issue.assignee_type && issue.assignee_id ? `${issue.assignee_type}:${issue.assignee_id}` : "",
  );
  // Mixed assignees: no check mark; all unassigned: "Unassigned" checked.
  const shared = key ? issues[0] : undefined;
  const value =
    key === null
      ? undefined
      : shared?.assignee_type && shared.assignee_id
        ? { type: shared.assignee_type, id: shared.assignee_id }
        : null;

  return (
    <View className="flex-1">
      <Text className="px-4 pt-3 pb-1 text-xs text-muted-foreground" testID="batch-assignee-hint">
        {t("selection.assign_hint", { count })}
      </Text>
      <AssigneePickerBody
        value={value}
        query={query}
        onChange={(next) =>
          apply(
            next === null
              ? { assignee_type: null, assignee_id: null }
              : { assignee_type: next.type, assignee_id: next.id },
          )
        }
      />
    </View>
  );
}
