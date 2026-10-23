/**
 * Limited reading width for lists and forms on wide windows (tablet
 * layout): content stays at most READING_MAX_WIDTH_DP wide and
 * centred. Phones are narrower than the limit, so nothing changes there.
 * The board keeps the full width and does not use this.
 *
 * Lists and scroll views pass READING_WIDTH_STYLE as contentContainerStyle,
 * so the scroll area (and pull to refresh) stays full width; fixed parts
 * above a list are wrapped in <ReadingWidth>.
 */
import type { ViewStyle } from "react-native";
import { View } from "react-native";
import { READING_MAX_WIDTH_DP } from "@/lib/breakpoints";

export const READING_WIDTH_STYLE: ViewStyle = {
  width: "100%",
  maxWidth: READING_MAX_WIDTH_DP,
  alignSelf: "center",
};

export function ReadingWidth({ children }: { children: React.ReactNode }) {
  return <View style={READING_WIDTH_STYLE}>{children}</View>;
}
