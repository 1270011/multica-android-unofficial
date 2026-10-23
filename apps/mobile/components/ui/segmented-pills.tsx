/**
 * Horizontal pill segment used above lists (Inbox: All / Unread / Archived;
 * My Issues scopes). One selected value, optional count badge per pill.
 * Pills are at least 40 dp tall with 8 dp vertical padding around them so
 * the touch target reaches the 48 dp Android guideline.
 */
import { ScrollView, View } from "react-native";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

export interface SegmentItem<V extends string> {
  value: V;
  label: string;
  badge?: number;
  /** For Maestro when the label also appears elsewhere (e.g. header title). */
  testID?: string;
}

interface Props<V extends string> {
  items: SegmentItem<V>[];
  value: V;
  onChange: (value: V) => void;
  /** Trailing element (e.g. a filter button) kept outside the scroll area. */
  trailing?: React.ReactNode;
}

export function SegmentedPills<V extends string>({
  items,
  value,
  onChange,
  trailing,
}: Props<V>) {
  return (
    <View className="flex-row items-center px-4 py-2 gap-2">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="flex-row items-center gap-1.5"
        className="flex-1"
        keyboardShouldPersistTaps="handled"
      >
        {items.map((item) => {
          const active = item.value === value;
          return (
            <Button
              key={item.value}
              variant="outline"
              size="sm"
              onPress={() => onChange(item.value)}
              className={cn("min-h-10 px-3 rounded-full", active && "bg-accent border-accent")}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              testID={item.testID}
            >
              <View className="flex-row items-center gap-1.5">
                <Text
                  numberOfLines={1}
                  className={cn(
                    "text-sm",
                    active ? "text-accent-foreground font-medium" : "text-muted-foreground",
                  )}
                >
                  {item.label}
                </Text>
                {item.badge ? (
                  <View className="rounded-full bg-brand px-1.5 min-w-5 items-center">
                    <Text className="text-[11px] text-brand-foreground font-medium">
                      {item.badge > 99 ? "99+" : item.badge}
                    </Text>
                  </View>
                ) : null}
              </View>
            </Button>
          );
        })}
      </ScrollView>
      {trailing ? <View className="shrink-0">{trailing}</View> : null}
    </View>
  );
}
