/**
 * Activity entries in the issue chat (docs/UX.md §8.2 "Systemzeilen"):
 * one centred, muted line without a bubble. Status changes to `blocked` /
 * `in_review` are emphasised with the status colour and bold text. Runs of
 * plain lines fold into "N changes" and expand in place.
 *
 * Wording comes from `formatActivity`, the same helper the detail's
 * ActivityRow uses, so both views describe an event identically.
 */
import { Pressable, View } from "react-native";
import type { TimelineEntry } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { StatusIcon } from "@/components/ui/status-icon";
import { useActorLookup } from "@/data/use-actor-name";
import { formatActivity } from "@/lib/format-activity";
import { useIssueStatuses } from "@/lib/use-issue-statuses";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { formatChatTime } from "./format";

function useDescribe() {
  const { getName } = useActorLookup();
  const catalog = useIssueStatuses();
  const resolveName = (type: string | null | undefined, id: string | null | undefined) =>
    getName(type as "member" | "agent" | null | undefined, id);
  return {
    catalog,
    describe: (entry: TimelineEntry) => {
      const actor = entry.actor_name || resolveName(entry.actor_type, entry.actor_id);
      return `${actor} ${formatActivity(entry, resolveName, catalog.labelOf)}`;
    },
  };
}

export function SystemLine({ entry, emphasis }: { entry: TimelineEntry; emphasis: boolean }) {
  const { catalog, describe } = useDescribe();
  const to = (entry.details as Record<string, unknown> | undefined)?.to;
  const text = describe(entry);
  const time = formatChatTime(entry.created_at);
  return (
    <View
      className="flex-row items-center justify-center gap-1.5 px-8"
      accessible
      accessibilityLabel={`${text}, ${time}`}
    >
      {emphasis && typeof to === "string" ? (
        <StatusIcon
          status={to}
          category={catalog.categoryOf(to)}
          icon={catalog.iconOf(to)}
          color={catalog.colorOf(to)}
          size={12}
        />
      ) : null}
      <Text
        className={cn(
          "text-xs text-center shrink",
          emphasis ? "font-semibold text-foreground" : "text-muted-foreground",
        )}
        numberOfLines={2}
      >
        {text} · {time}
      </Text>
    </View>
  );
}

export function SystemGroup({
  entries,
  onExpand,
}: {
  entries: TimelineEntry[];
  onExpand: () => void;
}) {
  const { t } = useT("issues");
  return (
    <View className="items-center px-8">
      <Pressable
        onPress={onExpand}
        accessibilityRole="button"
        accessibilityLabel={t("chat.changes_expand", { count: entries.length })}
        className="min-h-[48px] justify-center px-3 active:opacity-60"
      >
        <Text className="text-xs text-muted-foreground underline">
          {t("chat.changes", { count: entries.length })}
        </Text>
      </Pressable>
    </View>
  );
}
