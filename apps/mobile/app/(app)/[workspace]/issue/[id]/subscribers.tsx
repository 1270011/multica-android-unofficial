/**
 * Read-only list of an issue's subscribers.
 * Subscribing / unsubscribing yourself lives in the ⋮ menus of detail and
 * chat; this sheet only shows who gets notified and why.
 */
import { FlatList, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { issueSubscribersOptions } from "@/data/mutations/issue-chat";
import { useActorLookup } from "@/data/use-actor-name";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { subscriberRows } from "@/lib/issue-subscribers";
import { useT } from "@/lib/i18n";
import { useRefreshOnFocus } from "@/lib/use-refresh-on-focus";
import { issueScreenQueryKeys } from "@/data/queries/issue-keys";

export default function IssueSubscribersRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const me = useAuthStore((s) => s.user?.id ?? null);
  const { t } = useT("issues");
  const { getName } = useActorLookup();
  const { data = [], isLoading, error, refetch } = useQuery(issueSubscribersOptions(wsId, id));
  // Pushed over the issue screen, which is parked then: register the same
  // keys as focused so a reconnect refetches them here.
  useRefreshOnFocus(issueScreenQueryKeys(wsId, id));
  const rows = subscriberRows(data, me, (type, uid) => getName(type, uid));

  return (
    <View className="flex-1">
      <Text className="px-4 pt-4 pb-2 text-base font-semibold text-foreground">
        {t("subscribers.title", { count: rows.length })}
      </Text>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        testID="subscriber-list"
        ListEmptyComponent={
          isLoading ? null : error ? (
            <View className="items-start gap-2 px-4 py-6">
              <Text className="text-sm text-destructive">{t("subscribers.load_failed")}</Text>
              <Button variant="outline" onPress={() => refetch()}>
                <Text>{t("runs.load_retry")}</Text>
              </Button>
            </View>
          ) : (
            <Text className="px-4 py-6 text-sm text-muted-foreground">{t("subscribers.empty")}</Text>
          )
        }
        renderItem={({ item }) => (
          <View
            className="min-h-12 flex-row items-center gap-3 px-4 py-2"
            accessible
            accessibilityLabel={`${item.name}${item.isMe ? `, ${t("subscribers.you")}` : ""}, ${t(`subscribers.reason.${item.reason}`, { defaultValue: item.reason })}`}
          >
            <ActorAvatar type={item.type} id={item.id} size={28} />
            <View className="flex-1">
              <Text className="text-base text-foreground">
                {item.name}
                {item.isMe ? <Text className="text-muted-foreground"> · {t("subscribers.you")}</Text> : null}
              </Text>
              <Text className="text-xs text-muted-foreground">
                {t(`subscribers.reason.${item.reason}`, { defaultValue: item.reason })}
              </Text>
            </View>
          </View>
        )}
      />
    </View>
  );
}
