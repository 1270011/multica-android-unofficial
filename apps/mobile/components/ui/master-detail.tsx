/**
 * Master-detail frame for list pages:
 * from 600 dp the list sits left (360 dp) and the detail right; below
 * that only the list is shown and rows push their detail route (stack).
 * W7 ships the frame with placeholders; A2/W8/R2 fill list and detail.
 */
import { useWindowDimensions, View } from "react-native";
import { Separator } from "@/components/ui/separator";
import { masterDetailLayout } from "@/lib/ai-team";

export function MasterDetail({
  list,
  detail,
}: {
  list: React.ReactNode;
  /** Shown only in the split layout. */
  detail: React.ReactNode;
}) {
  const { width } = useWindowDimensions();
  const layout = masterDetailLayout(width);
  if (!layout.split) return <View className="flex-1">{list}</View>;
  return (
    <View className="flex-1 flex-row" testID="master-detail-split">
      <View style={{ width: layout.listWidth ?? undefined }}>{list}</View>
      <Separator orientation="vertical" />
      <View className="flex-1">{detail}</View>
    </View>
  );
}
