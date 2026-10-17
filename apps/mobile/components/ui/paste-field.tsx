/**
 * Text field with a "Paste from clipboard" button and an optional eye toggle
 * for secrets.
 *
 * The paste button never focuses the field, so the keyboard stays closed.
 * Keyboard learning and autofill are off for every PasteField; a masked
 * secret additionally hides the copy/paste context menu, and a revealed one
 * switches to the `visible-password` keyboard so the IME does not learn it.
 * Plain fields default to `visible-password` too,
 * unless the caller picks a keyboard (the URL field uses `url`).
 *
 * `status` is announced politely to screen readers and must never contain
 * the value itself — callers pass lengths/kinds only.
 */
import { View, Pressable } from "react-native";
import { Ionicons } from "@/components/ui/ionicons";
import { Text } from "@/components/ui/text";
import { TextField, type TextFieldProps } from "@/components/ui/text-field";
import { useTheme } from "@react-navigation/native";
import { cn } from "@/lib/utils";

export interface PasteFieldStatus {
  text: string;
  tone: "ok" | "warn";
}

export interface PasteFieldProps extends Omit<TextFieldProps, "secureTextEntry"> {
  /** Accessible name of the paste button, e.g. "Paste from clipboard: Client ID". */
  pasteLabel: string;
  /** Visible label of the paste button. */
  pasteText: string;
  onPaste: () => void;
  /** Secret field: masked unless `revealed`, with an eye toggle. */
  secret?: boolean;
  revealed?: boolean;
  onToggleReveal?: () => void;
  revealLabel?: string;
  status?: PasteFieldStatus | null;
  disabled?: boolean;
  testID?: string;
}

export function PasteField({
  pasteLabel,
  pasteText,
  onPaste,
  secret = false,
  revealed = false,
  onToggleReveal,
  revealLabel,
  status,
  disabled,
  testID,
  className,
  ...field
}: PasteFieldProps) {
  const { colors } = useTheme();
  const masked = secret && !revealed;

  return (
    <View className="gap-1.5">
      <View className="flex-row flex-wrap items-center gap-2">
        <View className="flex-1 min-w-[60%] justify-center">
          <TextField
            {...field}
            testID={testID}
            editable={!disabled && field.editable !== false}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            autoComplete="off"
            importantForAutofill="no"
            textContentType="none"
            secureTextEntry={masked}
            contextMenuHidden={masked}
            keyboardType={
              secret
                ? masked
                  ? "default"
                  : "visible-password"
                : (field.keyboardType ?? "visible-password")
            }
            className={cn(secret ? "pr-12" : undefined, className)}
          />
          {secret && onToggleReveal ? (
            <Pressable
              onPress={onToggleReveal}
              disabled={disabled}
              accessibilityRole="switch"
              accessibilityLabel={revealLabel}
              accessibilityState={{ checked: revealed, disabled }}
              testID={testID ? `${testID}-reveal` : undefined}
              className="absolute right-0 h-12 w-12 items-center justify-center"
            >
              <Ionicons name={revealed ? "eye-off-outline" : "eye-outline"} size={20} color={colors.text} />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          onPress={onPaste}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={pasteLabel}
          accessibilityState={{ disabled }}
          testID={testID ? `${testID}-paste` : undefined}
          className={cn(
            "min-h-12 flex-row items-center gap-1.5 rounded-md border border-border px-3 active:bg-secondary",
            disabled && "opacity-50",
          )}
        >
          <Ionicons name="clipboard-outline" size={18} color={colors.text} />
          <Text className="text-sm text-foreground">{pasteText}</Text>
        </Pressable>
      </View>
      {status ? (
        <Text
          accessibilityLiveRegion="polite"
          testID={testID ? `${testID}-status` : undefined}
          className={cn(
            "text-xs px-1",
            status.tone === "ok" ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400",
          )}
        >
          {status.text}
        </Text>
      ) : null}
    </View>
  );
}
