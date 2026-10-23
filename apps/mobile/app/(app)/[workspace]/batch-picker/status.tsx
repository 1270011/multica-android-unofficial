/**
 * Status picker for the issue-list selection: sets the chosen
 * status on every selected issue in one `batch-update`. See
 * components/issue/pickers/use-batch-picker.ts.
 */
import { StatusPickerBody } from "@/components/issue/pickers/status-picker-body";
import { useBatchPicker } from "@/components/issue/pickers/use-batch-picker";
import { commonValue } from "@/lib/issue-batch";

export default function BatchStatusPickerRoute() {
  const { issues, apply } = useBatchPicker();
  return (
    <StatusPickerBody
      value={commonValue(issues, (issue) => issue.status)}
      onChange={(status) => apply({ status })}
    />
  );
}
