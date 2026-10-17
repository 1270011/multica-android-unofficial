/** Start-date picker route for an existing issue. */
import { IssueDatePickerRoute } from "@/components/issue/pickers/issue-date-picker-route";
import { useT } from "@/lib/i18n";

export default function IssueStartDatePickerRoute() {
  const { t } = useT("issues");
  return <IssueDatePickerRoute field="start_date" title={t("fields.start_date")} />;
}
