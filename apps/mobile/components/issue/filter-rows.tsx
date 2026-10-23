/**
 * Rows of the issue filter sheet (issues-filter.tsx), shared with the
 * assignee/creator sections (actor-filter-section.tsx).
 */
import { Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

export function FilterRow({
  checked,
  label,
  icon,
  onPress,
  disabled = false,
  a11yLabel,
  hint,
  testID,
}: {
  checked: boolean;
  label: string;
  icon: React.ReactNode;
  onPress: () => void;
  disabled?: boolean;
  /** TalkBack text when it says more than `label` ("Ana, Member, selected"). */
  a11yLabel?: string;
  /** Second line, e.g. the actor kind. */
  hint?: string;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      accessibilityLabel={a11yLabel ?? label}
      className={cn(
        "flex-row items-center gap-3 px-4 py-2.5 min-h-12 active:bg-secondary",
        checked && "bg-secondary/60",
        disabled && "opacity-40",
      )}
    >
      {icon}
      <View className="flex-1">
        <Text className="text-sm text-foreground">{label}</Text>
        {hint ? (
          <Text className="text-xs text-muted-foreground">{hint}</Text>
        ) : null}
      </View>
      <CheckMark checked={checked} />
    </Pressable>
  );
}

export function SectionLabel({ children }: { children: string }) {
  return (
    <View className="px-4 pt-3 pb-1.5">
      <Text
        accessibilityRole="header"
        className="text-xs uppercase tracking-wider text-muted-foreground font-medium"
      >
        {children}
      </Text>
    </View>
  );
}

function CheckMark({ checked }: { checked: boolean }) {
  if (!checked) return null;
  return <Text className="text-sm text-primary font-semibold">✓</Text>;
}
