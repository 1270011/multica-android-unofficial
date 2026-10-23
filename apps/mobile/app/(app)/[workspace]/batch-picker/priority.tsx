/**
 * Priority picker for the issue-list selection. See ./status.tsx.
 */
import { PriorityPickerBody } from "@/components/issue/pickers/priority-picker-body";
import { useBatchPicker } from "@/components/issue/pickers/use-batch-picker";
import { commonValue } from "@/lib/issue-batch";

export default function BatchPriorityPickerRoute() {
  const { issues, apply } = useBatchPicker();
  return (
    <PriorityPickerBody
      value={commonValue(issues, (issue) => issue.priority)}
      onChange={(priority) => apply({ priority })}
    />
  );
}
