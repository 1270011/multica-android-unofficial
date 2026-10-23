/**
 * Root-mounted renderer for `showToast()` (lib/toast.ts). Sits above the
 * bottom safe area, ignores touches, and is a polite live region so
 * TalkBack / VoiceOver read the message once.
 */
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/components/ui/text";
import { pressToastAction, useToastStore, type ToastMessage } from "@/lib/toast";
import { useT } from "@/lib/i18n";

export function ToastHost() {
  const message = useToastStore((s) => s.message);
  const action = useToastStore((s) => s.action);
  const nonce = useToastStore((s) => s.nonce);
  const insets = useSafeAreaInsets();
  const { t } = useT("common");
  if (!message) return null;
  const resolve = (m: ToastMessage): string => (typeof m === "string" ? m : String(t(m.key, m.params)));
  const text = resolve(message);
  return (
    <View
      // Touches pass through, except on the action button.
      pointerEvents={action ? "box-none" : "none"}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: insets.bottom + 72,
        alignItems: "center",
      }}
    >
      <View
        key={nonce}
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
        className="max-w-[90%] flex-row flex-wrap items-center justify-center gap-x-3 rounded-full bg-foreground px-4 py-2.5 shadow-md shadow-black/20"
      >
        <Text className="text-sm text-background text-center">{text}</Text>
        {action ? (
          <Pressable
            onPress={pressToastAction}
            accessibilityRole="button"
            hitSlop={12}
            testID="toast-action"
            className="min-h-9 justify-center px-1"
          >
            <Text className="text-sm font-semibold text-background underline">{resolve(action.label)}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
