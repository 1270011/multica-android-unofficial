/**
 * Autopilots page with the segments Autopilots | Wakeups. The Autopilots segment shows the list
 *Wakeups the workspace overview. A row
 * opens the detail: pushed on the phone, in the right pane
 * of the tablet split (`?selected=<id>`).
 *
 * The segment lives in the URL (`?tab=wakeups`), so deep links open it and
 * the route restore after an Activity recreation brings it back
 * (lib/route-restore.ts restorablePath). Wakeups have no menu entry of
 * their own, like the web's "Issue wakeups" tab.
 */
import { useWindowDimensions, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { AiTeamPlaceholder } from "@/components/ai-team/placeholder";
import { AutopilotDetail } from "@/components/autopilots/autopilot-detail";
import { AutopilotList } from "@/components/autopilots/autopilot-list";
import { useAiTeamGates } from "@/components/ai-team/use-ai-team-gates";
import { WorkspaceWakeups } from "@/components/wakeups/workspace-wakeups";
import { MasterDetail } from "@/components/ui/master-detail";
import { SegmentSwitch } from "@/components/ui/segment-switch";
import { useWorkspaceStore } from "@/data/workspace-store";
import { autopilotsTabFromParam, masterDetailLayout, type AutopilotsTab } from "@/lib/ai-team";
import { useT } from "@/lib/i18n";

export default function AutopilotsPage() {
  const { t } = useT("navigation");
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { tab: tabParam, selected } = useLocalSearchParams<{ tab?: string; selected?: string }>();
  const tab = autopilotsTabFromParam(tabParam);
  const gates = useAiTeamGates(wsId);
  const { width } = useWindowDimensions();
  const split = masterDetailLayout(width).split;
  const selectedId = split && tab === "autopilots" ? selected || null : null;

  const list =
    tab === "wakeups" ? (
      <WorkspaceWakeups />
    ) : gates.autopilots === "missing" ? (
      <AiTeamPlaceholder
        icon="bolt"
        title={t("ai_team.autopilots_title")}
        body={t("ai_team.feature_missing")}
        testID="autopilots-missing"
      />
    ) : (
      <AutopilotList
        selectedId={selectedId}
        onOpen={(a) => {
          if (split) router.setParams({ selected: a.id });
          else if (wsSlug) router.push(`/${wsSlug}/autopilots/${a.id}`);
        }}
      />
    );

  return (
    <View className="flex-1 bg-background">
      <SegmentSwitch<AutopilotsTab>
        items={[
          { value: "autopilots", label: t("ai_team.tab_autopilots"), testID: "segment-autopilots" },
          { value: "wakeups", label: t("ai_team.tab_wakeups"), testID: "segment-wakeups" },
        ]}
        value={tab}
        onChange={(next) => router.setParams({ tab: next })}
        label={t("ai_team.segment_label")}
        testID="autopilots-segments"
      />
      <MasterDetail
        list={list}
        detail={
          selectedId ? (
            <AutopilotDetail
              key={selectedId}
              id={selectedId}
              onDeleted={() => router.setParams({ selected: undefined })}
            />
          ) : (
          <AiTeamPlaceholder
            icon="chevron.right"
            title={t("ai_team.detail_empty_title")}
            body={t("ai_team.detail_empty_body")}
            testID="autopilots-detail-empty"
          />
          )
        }
      />
    </View>
  );
}
