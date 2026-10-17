/** Due-date picker route for an existing issue (see issue-date-picker-route). */
import { IssueDatePickerRoute } from "@/components/issue/pickers/issue-date-picker-route";
import { useT } from "@/lib/i18n";

export default function IssueDueDatePickerRoute() {
  const { t } = useT("issues");
  return <IssueDatePickerRoute field="due_date" title={t("common:fields.due_date")} />;
}
