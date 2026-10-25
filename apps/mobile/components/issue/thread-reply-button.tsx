/**
 * Visible "Reply" button under a thread (W1-1). Sets the composer's
 * reply target to the thread root (`lib/thread-reply.ts`); the composer
 * expands and focuses on the new target. Long-press and swipe stay as they
 * are. Touch target ≥ 48 dp, label "Reply to <name>" for screen readers.
 */
import { Pressable } from "react-native";
import { Ionicons } from "@/components/ui/ionicons";
import { Text } from "@/components/ui/text";
import { setReplyTarget } from "@/data/stores/reply-target-store";
import { threadReplyTarget } from "@/lib/thread-reply";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

export function ThreadReplyButton({
  issueId,
  rootId,
  rootContent,
  actorName,
  className,
}: {
  issueId: string;
  rootId: string;
  rootContent: string | undefined;
  /** Author of the thread root, shown in the composer chip and the a11y label. */
  actorName: string;
  className?: string;
}) {
  const { t } = useT("issues");
  const { colorScheme } = useColorScheme();
  const name = actorName || t("comments.fallback_actor");
  return (
    <Pressable
      testID="thread-reply"
      accessibilityRole="button"
      accessibilityLabel={t("comments.reply_to", { name })}
      onPress={() =>
        setReplyTarget(issueId, threadReplyTarget({ id: rootId, content: rootContent }, name))
      }
      className={cn(
        "min-h-12 min-w-12 flex-row items-center gap-1.5 self-start px-2 rounded-lg active:opacity-60",
        className,
      )}
    >
      <Ionicons name="arrow-undo-outline" size={16} color={THEME[colorScheme].mutedForeground} />
      <Text className="text-sm font-medium text-muted-foreground">{t("comments.reply")}</Text>
    </Pressable>
  );
}
