/**
 * "Properties" section of the issue detail: every workspace
 * property with this issue's value (lib/issue-properties.ts). Tapping a
 * row opens the editor sheet `issue/[id]/picker/property`. Hidden when the
 * workspace has no properties.
 */
import { useMemo } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { Issue } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { propertyListOptions } from "@/data/queries/properties";
import { memberListOptions } from "@/data/queries/members";
import { useWorkspaceStore } from "@/data/workspace-store";
import { formatPropertyValue, isPropertyReadOnly, visibleProperties } from "@/lib/issue-properties";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function usePropertyFormat() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { t } = useT("issues");
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  return useMemo(
    () => ({
      yes: t("properties.yes"),
      no: t("properties.no"),
      memberName: (userId: string) => members.find((m) => m.user_id === userId)?.name,
    }),
    [members, t],
  );
}

export function IssuePropertiesSection({ issue }: { issue: Issue }) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { t } = useT("issues");
  const { data: propertyList } = useQuery(propertyListOptions(wsId, true));
  const properties = propertyList?.properties ?? [];
  const ctx = usePropertyFormat();
  const rows = visibleProperties(properties, issue.properties);
  if (rows.length === 0) return null;

  return (
    <View className="gap-1" testID="issue-properties">
      <Text className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {t("detail.properties")}
      </Text>
      {rows.map((property) => {
        const value = issue.properties?.[property.id];
        const shown = formatPropertyValue(property, value, ctx);
        const readOnly = isPropertyReadOnly(property, value);
        return (
          <Pressable
            key={property.id}
            onPress={() =>
              wsSlug &&
              router.push({
                pathname: "/[workspace]/issue/[id]/picker/property",
                params: { workspace: wsSlug, id: issue.id, propertyId: property.id },
              })
            }
            accessibilityRole="button"
            accessibilityLabel={t("properties.row_a11y", {
              name: property.name,
              value: shown ?? t("properties.not_set"),
            })}
            accessibilityHint={readOnly ? t("properties.read_only") : undefined}
            testID={`property-row-${property.id}`}
            className="min-h-12 flex-row flex-wrap items-center gap-x-3 gap-y-1 rounded-md py-2 active:bg-secondary"
          >
            <Text className="min-w-[30%] text-sm text-muted-foreground">{property.name}</Text>
            <Text
              className={cn("flex-1 text-sm", shown ? "text-foreground" : "text-muted-foreground/60")}
              numberOfLines={3}
            >
              {shown ?? t("properties.not_set")}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
