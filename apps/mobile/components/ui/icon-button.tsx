/**
 * Icon-only button — RNR `<Button variant="ghost" size="icon">` wrapping an
 * Ionicon. The icon color falls back to the active navigation theme's
 * foreground (via `useTheme()`), so dark mode flips automatically without
 * anyone passing a color prop.
 *
 * Use everywhere we'd otherwise hand-write
 *   <Pressable className="size-9 active:bg-secondary"><Ionicons color="#3f3f46" /></Pressable>
 * — that pattern hardcodes a light-mode hex and reinvents button chrome RNR
 * already ships.
 */
import { type ComponentProps } from "react";
import { Ionicons } from "@/components/ui/ionicons";
import { useTheme } from "@react-navigation/native";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props extends Omit<ButtonProps, "children" | "size"> {
  name: ComponentProps<typeof Ionicons>["name"];
  /** Glyph size in points. Default 20 matches iOS toolbar icons. */
  iconSize?: number;
  /** Override the icon color. Defaults to NAV_THEME[scheme].text. */
  color?: string;
}

export function IconButton({
  name,
  iconSize = 20,
  color,
  className,
  ...buttonProps
}: Props) {
  const { colors } = useTheme();
  return (
    // 44 dp box + 4 dp hit slop = the 48 dp Android touch-target minimum
    // (Material / WCAG 2.5.5) without visibly bulking up the toolbar.
    <Button
      variant="ghost"
      size="icon"
      hitSlop={4}
      className={cn("h-11 w-11", className)}
      {...buttonProps}
    >
      <Ionicons name={name} size={iconSize} color={color ?? colors.text} />
    </Button>
  );
}
