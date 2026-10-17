/**
 * Android presenter for `showActionSheet` (lib/action-sheet.ts).
 *
 * Mounted once in app/_layout.tsx. Renders the queued request as a bottom
 * sheet in a transparent `Modal`: title/message on top, one row per option,
 * the cancel option separated at the bottom, destructive rows in the
 * destructive colour. Tapping the scrim or the hardware back button
 * dismisses and reports `cancelButtonIndex` (or nothing when none exists),
 * matching what ActionSheetIOS does on swipe-to-dismiss.
 *
 * On iOS this component renders nothing — `showActionSheet` never queues.
 */
import { useEffect, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/components/ui/text";
import { Separator } from "@/components/ui/separator";
import {
  registerActionSheetPresenter,
  type ActionSheetRequest,
} from "@/lib/action-sheet";
import { cn } from "@/lib/utils";

export function ActionSheetHost() {
  const [request, setRequest] = useState<ActionSheetRequest | null>(null);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (Platform.OS === "ios") return;
    registerActionSheetPresenter((next) => {
      // A second sheet while one is open replaces it; the first one is
      // reported as cancelled so its caller can reset pressed state.
      setRequest((current) => {
        if (current?.options.cancelButtonIndex !== undefined) {
          current.callback(current.options.cancelButtonIndex);
        }
        return next;
      });
    });
    return () => registerActionSheetPresenter(null);
  }, []);

  if (Platform.OS === "ios" || !request) return null;

  const { options, callback } = request;
  const cancelIndex = options.cancelButtonIndex;
  const destructive = new Set(
    Array.isArray(options.destructiveButtonIndex)
      ? options.destructiveButtonIndex
      : options.destructiveButtonIndex !== undefined
        ? [options.destructiveButtonIndex]
        : [],
  );

  const finish = (index: number | undefined) => {
    setRequest(null);
    if (index !== undefined) callback(index);
  };
  const dismiss = () => finish(cancelIndex);

  const rows = options.options
    .map((label, index) => ({ label, index }))
    .filter((row) => row.index !== cancelIndex);

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={dismiss}
    >
      <Pressable
        className="flex-1 justify-end bg-black/50"
        onPress={dismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
      >
        <Pressable
          // Swallow taps inside the sheet so they don't reach the scrim.
          onPress={() => {}}
          className="px-2"
          style={{ paddingBottom: Math.max(insets.bottom, 8) }}
        >
          <View className="rounded-2xl bg-card overflow-hidden">
            {options.title || options.message ? (
              <>
                <View className="px-4 pt-4 pb-3 items-center gap-1">
                  {options.title ? (
                    <Text className="text-sm font-semibold text-muted-foreground text-center">
                      {options.title}
                    </Text>
                  ) : null}
                  {options.message ? (
                    <Text className="text-sm text-muted-foreground text-center">
                      {options.message}
                    </Text>
                  ) : null}
                </View>
                <Separator />
              </>
            ) : null}
            <ScrollView bounces={false} style={{ maxHeight: 420 }}>
              {rows.map((row, i) => (
                <View key={row.index}>
                  <Pressable
                    onPress={() => finish(row.index)}
                    className="px-4 py-4 active:bg-secondary"
                    accessibilityRole="button"
                  >
                    <Text
                      className={cn(
                        "text-base text-center",
                        destructive.has(row.index)
                          ? "text-destructive"
                          : "text-foreground",
                      )}
                      numberOfLines={2}
                    >
                      {row.label}
                    </Text>
                  </Pressable>
                  {i < rows.length - 1 ? <Separator /> : null}
                </View>
              ))}
            </ScrollView>
          </View>
          {cancelIndex !== undefined ? (
            <Pressable
              onPress={dismiss}
              className="mt-2 rounded-2xl bg-card px-4 py-4 active:bg-secondary"
              accessibilityRole="button"
            >
              <Text className="text-base font-semibold text-foreground text-center">
                {options.options[cancelIndex]}
              </Text>
            </Pressable>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
