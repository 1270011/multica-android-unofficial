/**
 * "Starts: X" chips above the comment input (W1-P3b,
 * W1-3). Shows which agents the draft would
 * start when sent; a tap deselects an agent (sent as `suppress_agent_ids`)
 * and a second tap selects it again. Web counterpart:
 * packages/views/issues/components/comment-trigger-chips.tsx (without its
 * run-steering menu).
 *
 * Nobody starts, loading, an error or offline: the row is not rendered at
 * all, no error text, and sending is never blocked.
 */
import { Pressable, View } from "react-native";
import type { CommentTriggerPreviewAgent } from "@multica/core/types";
import { Ionicons } from "@/components/ui/ionicons";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { useT } from "@/lib/i18n";
import { triggerChips, triggerReasonSource } from "@/lib/comment-trigger-chips";

export function CommentTriggerChips({
  agents,
  suppressed,
  onToggle,
}: {
  agents: readonly CommentTriggerPreviewAgent[];
  suppressed: readonly string[];
  onToggle: (agentId: string) => void;
}) {
  const { t } = useT("issues");
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const chips = triggerChips(agents, suppressed);
  if (chips.length === 0) return null;

  return (
    <View
      className="flex-row flex-wrap items-center gap-x-2"
      accessibilityLabel={t("comments.trigger.row_label")}
      testID="comment-trigger-chips"
    >
      {chips.map(({ agent, suppressed: off }) => {
        const reasonSource = triggerReasonSource(agent.source);
        const reason = reasonSource ? t(`comments.trigger.reason.${reasonSource}`) : null;
        const label = off
          ? t("comments.trigger.wont_start", { name: agent.name })
          : t("comments.trigger.will_start", { name: agent.name });
        return (
          <Pressable
            key={agent.id}
            onPress={() => onToggle(agent.id)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: !off }}
            accessibilityLabel={reason ? `${label}, ${reason}` : label}
            accessibilityHint={
              off
                ? t("comments.trigger.hint_select", { name: agent.name })
                : t("comments.trigger.hint_deselect", { name: agent.name })
            }
            testID={`comment-trigger-chip-${agent.id}`}
            // 48 dp touch target; the visible pill stays compact.
            className="min-h-12 justify-center active:opacity-70"
          >
            <View
              className={cn(
                "flex-row items-center gap-1.5 rounded-full border px-3 py-1",
                off ? "border-border bg-transparent" : "border-primary/40 bg-primary/10",
              )}
            >
              <Ionicons
                name={off ? "close-circle-outline" : "flash-outline"}
                size={14}
                color={off ? theme.mutedForeground : theme.primary}
              />
              <Text
                className={cn(
                  "text-xs font-medium",
                  off ? "text-muted-foreground line-through" : "text-foreground",
                )}
                numberOfLines={1}
              >
                {label}
              </Text>
              {reason ? (
                <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                  · {reason}
                </Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
