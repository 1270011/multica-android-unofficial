/**
 * Runtime detail route. The
 * screen itself lives in `components/runtimes/runtime-detail.tsx` so the
 * tablet list shows the same view in its right pane.
 */
import { View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { RuntimeDetail, runtimeTitle } from "@/components/runtimes/runtime-detail";
import { runtimeListOptions } from "@/data/queries/runtimes";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useT } from "@/lib/i18n";

export default function RuntimeDetailPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useT("workspace");
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const runtimes = useQuery(runtimeListOptions(wsId));
  const runtime = runtimes.data?.find((r) => r.id === id);

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ title: runtimeTitle(runtime, t("runtime_list.title")) }} />
      <RuntimeDetail runtimeId={id} />
    </View>
  );
}
