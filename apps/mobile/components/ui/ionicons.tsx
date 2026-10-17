/**
 * `Ionicons` with screen-reader-safe defaults.
 *
 * @expo/vector-icons renders a glyph as a <Text> node. On Android, TalkBack
 * (and UIAutomator) concatenate every text child of a pressable into its
 * spoken label, so a row like `[icon] Inbox` was read as ", 2, Inbox" and
 * the help link as ", How do I get a service token?" — the glyph is a
 * private-use character with no name. Icons in this app are decorative:
 * every icon-only control already carries an `accessibilityLabel` on the
 * pressable. Hiding the glyph from the accessibility tree by default fixes
 * every call site at once; pass the props explicitly to opt back in.
 *
 * Drop-in: `import { Ionicons } from "@/components/ui/ionicons"` instead of
 * `@expo/vector-icons`. `glyphMap` is re-exposed for the `name` type.
 */
import type { ComponentProps } from "react";
import { Ionicons as BaseIonicons } from "@expo/vector-icons";

type Props = ComponentProps<typeof BaseIonicons>;

function DecorativeIonicons(props: Props) {
  return (
    <BaseIonicons
      importantForAccessibility="no"
      accessibilityElementsHidden
      {...props}
    />
  );
}

export const Ionicons = Object.assign(DecorativeIonicons, {
  glyphMap: BaseIonicons.glyphMap,
});
