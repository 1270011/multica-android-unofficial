/**
 * Generic attribute chip used in the issue-detail header. Each chip pairs
 * an icon node (any RN element — StatusIcon, PriorityIcon, ActorAvatar,
 * emoji, etc) with a textual label. Filled = the property has a value;
 * dimmed = empty placeholder ("Label", "Cycle", ...).
 *
 * The chip becomes a Pressable when `onPress` is provided. Without onPress
 * it renders as a plain View — used for read-only chips (e.g. project
 * chip while picker is deferred).
 */
import { Pressable, View } from "react-native";
import type { ReactNode } from "react";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

interface Props {
  icon: ReactNode;
  label: string;
  variant?: "filled" | "dimmed";
  onPress?: () => void;
  className?: string;
  testID?: string;
  /** TalkBack label when it should say more than the visible label. */
  accessibilityLabel?: string;
}

export function AttributeChip({
  icon,
  label,
  variant = "filled",
  onPress,
  className,
  testID,
  accessibilityLabel,
}: Props) {
  const containerClass = cn(
    "flex-row items-center gap-1.5 rounded-full border px-3 py-1.5 min-h-9",
    variant === "filled"
      ? "border-border bg-secondary/60"
      : "border-dashed border-muted-foreground/30 bg-transparent",
    className,
  );
  const labelClass = cn(
    "text-sm",
    variant === "filled"
      ? "text-foreground"
      : "text-muted-foreground/70",
  );

  const inner = (
    <>
      {icon}
      <Text className={cn(labelClass, "shrink")} numberOfLines={1}>
        {label}
      </Text>
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        className={cn(containerClass, "active:bg-secondary")}
        // 36 dp chip + 6 dp slop = 48 dp touch target (Android guideline).
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        testID={testID}
      >
        {inner}
      </Pressable>
    );
  }
  return (
    <View className={containerClass} testID={testID}>
      {inner}
    </View>
  );
}
