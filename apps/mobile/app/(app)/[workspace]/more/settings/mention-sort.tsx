/**
 * Settings › View › Sort @ suggestions (W6-P9):
 * "Most mentioned" (default) or
 * "Name", per device for all workspaces (view-prefs-store, kept on logout),
 * plus "Clear history" for the mention counts of the current workspace
 * (lib/mention-usage.ts, no confirmation, toast afterwards; disabled while
 * there is no history). The "Frequent" section in the @-sheet is P10.
 *
 * Debug builds also get "Seed test history" (Maestro flow
 * `mention-frequent`, W6-P10): two people get counts without sending a
 * comment; the name expected on top of "Frequent" is shown below it.
 */
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { READING_WIDTH_STYLE } from "@/components/ui/reading-width";
import { useT } from "@/lib/i18n";
import { showToast } from "@/lib/toast";
import { clearMentionUsage, mentionUsageKey, replaceMentionUsage } from "@/lib/mention-usage";
import { debugSeedUsage } from "@/lib/mention-frequent";
import { useVisibleActors } from "@/lib/use-visible-actors";
import { memberListOptions } from "@/data/queries/members";
import { useMentionUsage } from "@/lib/use-mention-usage";
import type { MentionSortMode } from "@/lib/view-prefs";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  useMentionSortMode,
  useViewPrefsHydration,
  useViewPrefsStore,
} from "@/data/stores/view-prefs-store";

const OPTIONS: MentionSortMode[] = ["frequency", "name"];

export default function MentionSortSettingsScreen() {
  const { t } = useT("settings");
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  useViewPrefsHydration(wsId);
  const mode = useMentionSortMode();
  const setMentionSort = useViewPrefsStore((s) => s.setMentionSort);
  const hasHistory = Object.keys(useMentionUsage(wsId)).length > 0;

  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const visibleActors = useVisibleActors(wsId);
  const [seededTop, setSeededTop] = useState<string | null>(null);
  const onDebugSeed = () => {
    if (!wsId) return;
    const { usage, top } = debugSeedUsage(
      members
        .filter((m) => !visibleActors.isHidden({ type: "member", id: m.user_id }))
        .map((m) => ({ key: mentionUsageKey("member", m.user_id), name: m.name })),
      Date.now(),
    );
    replaceMentionUsage(wsId, usage);
    setSeededTop(top);
  };

  const onClear = () => {
    if (!wsId) return;
    clearMentionUsage(wsId);
    showToast(t("view.mention_sort_reset_done"));
  };

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="px-4 py-4 gap-6"
      contentContainerStyle={READING_WIDTH_STYLE}
    >
      <View className="gap-2">
        <View className="rounded-md border border-border bg-card overflow-hidden">
          {/* Same two entry points as the theme picker in settings.tsx: the
              circle and the whole row both land in setMentionSort. */}
          <RadioGroup
            value={mode}
            onValueChange={(v) => setMentionSort(v as MentionSortMode)}
            className="gap-0"
          >
            {OPTIONS.map((opt, idx) => (
              <View key={opt}>
                <Pressable
                  testID={`mention-sort-${opt}`}
                  onPress={() => setMentionSort(opt)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: mode === opt }}
                  className="flex-row items-center px-4 py-3.5 active:bg-secondary gap-3"
                >
                  <RadioGroupItem value={opt} />
                  <View className="flex-1">
                    <Text className="text-base font-medium text-foreground">
                      {t(`view.mention_sort_${opt}`)}
                    </Text>
                    <Text className="text-sm text-muted-foreground mt-0.5">
                      {t(`view.mention_sort_${opt}_hint`)}
                    </Text>
                  </View>
                </Pressable>
                {idx < OPTIONS.length - 1 ? <Separator /> : null}
              </View>
            ))}
          </RadioGroup>
        </View>
        <Text className="text-xs text-muted-foreground px-1">
          {t("view.mention_sort_footer")}
        </Text>
      </View>

      <Button
        testID="mention-sort-reset"
        variant="outline"
        disabled={!hasHistory || !wsId}
        onPress={onClear}
        accessibilityState={{ disabled: !hasHistory || !wsId }}
      >
        <Text>{t("view.mention_sort_reset")}</Text>
      </Button>

      {/* Debug builds only; gate spelled out so Metro folds it away. */}
      {process.env.EXPO_PUBLIC_DEBUG_TOKEN_LOGIN === "1" ? (
        <View className="gap-2">
          <Button testID="mention-sort-debug-seed" variant="ghost" onPress={onDebugSeed}>
            <Text>{t("view.mention_sort_debug_seed")}</Text>
          </Button>
          {seededTop ? (
            <Text testID="mention-sort-debug-seed-top" className="text-xs text-muted-foreground px-1">
              {seededTop}
            </Text>
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}
