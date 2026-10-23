/**
 * Wakeup chip in the issue-detail header (web
 * issue-wakeup-header-chip.tsx). Reads `GET /api/issue-wakeup-summaries`
 * and renders only while the issue has active wakeups (`active_count > 0`):
 * "⏰ 2 · in 3 h". Tapping jumps to the "Wakeups" section.
 */
import { useQuery } from "@tanstack/react-query";
import { AttributeChip } from "@/components/issue/attribute-chip";
import { Ionicons } from "@/components/ui/ionicons";
import { wakeupSummariesOptions } from "@/data/queries/wakeups";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { wakeupChip } from "@/lib/wakeup-text";

export function WakeupHeaderChip({ issueId, onPress }: { issueId: string; onPress?: () => void }) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { colorScheme } = useColorScheme();
  const { data } = useQuery(wakeupSummariesOptions(wsId));
  const chip = wakeupChip(data, issueId);
  if (!chip) return null;
  return (
    <AttributeChip
      icon={<Ionicons name="alarm-outline" size={14} color={THEME[colorScheme].foreground} />}
      label={chip.label}
      accessibilityLabel={chip.a11y}
      onPress={onPress}
      testID="issue-wakeup-chip"
    />
  );
}
