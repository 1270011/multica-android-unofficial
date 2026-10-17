/**
 * Status sheet opened by a long press on a board card. Same
 * status list as the detail's status picker, but the change goes through
 * `/move` with an Undo toast (data/mutations/board-status.ts). The board
 * passes the card's status, so the sheet does not wait for the detail.
 */
import { useLocalSearchParams, router } from "expo-router";
import { StatusPickerBody } from "@/components/issue/pickers/status-picker-body";
import { useBoardStatusChange } from "@/data/mutations/board-status";
import { useIssueStatuses } from "@/lib/use-issue-statuses";
import { useT } from "@/lib/i18n";

export default function BoardStatusPickerRoute() {
  const { id, status } = useLocalSearchParams<{ id: string; status: string }>();
  const { t } = useT("issues");
  const catalog = useIssueStatuses();
  const change = useBoardStatusChange((label) => t("board.moved_to", { status: label }));

  return (
    <StatusPickerBody
      value={status ?? "todo"}
      onChange={(next) => {
        void change(id, status ?? next, next, catalog.labelOf(next));
        router.back();
      }}
    />
  );
}
