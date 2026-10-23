/**
 * 409 on a saved view: native dialog built from `viewConflictDialog`.
 */
import { Alert } from "react-native";
import { type ViewConflictAction, viewConflictDialog } from "@/lib/issue-view-edit";

export function showViewConflictDialog(
  t: (key: string) => string,
  context: "save" | "edit",
  handlers: Partial<Record<ViewConflictAction, () => void>>,
) {
  const dialog = viewConflictDialog(context);
  Alert.alert(
    t(dialog.titleKey),
    t(dialog.messageKey),
    dialog.buttons.map((b) => ({
      text: t(b.labelKey),
      style: b.style,
      onPress: handlers[b.action],
    })),
    { cancelable: true },
  );
}
