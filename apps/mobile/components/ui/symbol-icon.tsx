/**
 * Platform-aware glyph for the few places that used SF Symbols directly.
 *
 * expo-image's `sf:` source scheme is iOS-only — on Android it renders an
 * empty box, so the bottom tab bar, the "More" menu and the workspace
 * switcher shipped WITHOUT icons in the Android build. On iOS we
 * keep the SF Symbol (same look as upstream); on Android the same name maps
 * to the closest Ionicon, which the rest of the app already uses.
 *
 * Add a mapping here whenever a new `sf:` glyph is introduced — the
 * fallback glyph is deliberately ugly so a missing entry is noticed.
 */
import type { ComponentProps } from "react";
import { Platform } from "react-native";
import { Image as ExpoImage } from "expo-image";
import { Ionicons } from "@/components/ui/ionicons";

type IoniconName = ComponentProps<typeof Ionicons>["name"];

export type SymbolName =
  | "tray"
  | "tray.fill"
  | "checklist.unchecked"
  | "checklist"
  | "bubble.left"
  | "bubble.left.fill"
  | "ellipsis"
  | "pin"
  | "list.bullet"
  | "square.stack"
  | "person.2"
  | "chevron.right"
  | "chevron.down"
  | "checkmark"
  | "bolt"
  | "server.rack"
  | "magnifyingglass"
  | "xmark.circle.fill"
  | "exclamationmark.triangle.fill";

const SF_TO_IONICON: Record<SymbolName, IoniconName> = {
  tray: "file-tray-outline",
  "tray.fill": "file-tray",
  "checklist.unchecked": "checkmark-circle-outline",
  checklist: "checkmark-circle",
  "bubble.left": "chatbubble-outline",
  "bubble.left.fill": "chatbubble",
  ellipsis: "ellipsis-horizontal",
  pin: "pin-outline",
  "list.bullet": "list-outline",
  "square.stack": "layers-outline",
  "person.2": "people-outline",
  "chevron.right": "chevron-forward",
  "chevron.down": "chevron-down",
  checkmark: "checkmark",
  bolt: "flash-outline",
  "server.rack": "server-outline",
  magnifyingglass: "search-outline",
  "xmark.circle.fill": "close-circle",
  "exclamationmark.triangle.fill": "warning",
};

interface Props {
  name: SymbolName;
  size: number;
  color: string;
}

export function SymbolIcon({ name, size, color }: Props) {
  if (Platform.OS === "ios") {
    return (
      <ExpoImage
        source={`sf:${name}`}
        tintColor={color}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <Ionicons
      name={SF_TO_IONICON[name] ?? "help-circle-outline"}
      size={size}
      color={color}
    />
  );
}
