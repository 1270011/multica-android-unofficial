/**
 * Issue-list filter sheet — presented as a formSheet by the parent Stack.
 * Shared by My Issues, the workspace-wide Issues page and the project page;
 * which list's filters to read/write is selected by the `scope` URL param:
 *
 *   - /[workspace]/issues-filter?scope=my       →  My Issues
 *     (`&section=sort` opens with the sort expanded, D4)
 *   - /[workspace]/issues-filter?scope=all      →  workspace Issues
 *   - /[workspace]/issues-filter?scope=project  →  project page (no project
 *     section, the page is already one project)
 *
 * Sections: sort (My Issues only, "Clear" keeps it), assignee
 * and creator (My Issues only, hidden in Assigned resp. Created;
 * actor-filter-section.tsx), status, priority, project
 * (+ "No project"), label, due date. Filters are kept per list and workspace across restarts
 * (`useIssueListFilterStore`). Self-contained: reads/writes the store
 * directly, no callback passing.
 */
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Text } from "@/components/ui/text";
import { StatusIcon } from "@/components/ui/status-icon";
import { PriorityIcon } from "@/components/ui/priority-icon";
import { ProjectIcon } from "@/components/ui/project-icon";
import { Ionicons } from "@/components/ui/ionicons";
import { labelListOptions } from "@/data/queries/labels";
import { projectListOptions } from "@/data/queries/projects";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useMyIssuesScope } from "@/data/stores/my-issues-view-store";
import {
  showsAssigneeFilter,
  showsCreatorFilter,
} from "@/data/queries/my-issues";
import { useAuthStore } from "@/data/auth-store";
import { FilterRow, SectionLabel } from "@/components/issue/filter-rows";
import {
  ActorFilterPicker,
  ActorFilterSection,
} from "@/components/issue/actor-filter-section";
import type { FilterSection } from "@/lib/actor-filter-options";
import { SortSection } from "@/components/issue/sort-section";
import {
  type IssueFilterList,
  isIssueFilterList,
  useIssueListFilters,
  useIssueListFilterStore,
  useIssueListSort,
} from "@/data/stores/issue-list-filter-store";
import {
  DUE_FILTERS,
  type IssueListFilterDimension,
  issueListFilterCount,
} from "@/lib/issue-list-filters";
import { PRIORITY_LABEL, statusOptions } from "@/lib/issue-status";
import { useIssueStatuses } from "@/lib/use-issue-statuses";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { useT } from "@/lib/i18n";
import type { IssuePriority } from "@multica/core/types";

// Mirrors PRIORITY_ORDER in packages/core/issues/config/priority.ts.
const PRIORITY_ORDER: IssuePriority[] = [
  "urgent",
  "high",
  "medium",
  "low",
  "none",
];

const DUE_ICON = {
  overdue: "alert-circle-outline",
  this_week: "calendar-outline",
  none: "remove-circle-outline",
} as const;

export default function IssuesFilterRoute() {
  const { scope, section } = useLocalSearchParams<{ scope?: string; section?: string }>();
  const { t } = useT("issues");
  const { colorScheme } = useColorScheme();
  const list: IssueFilterList = isIssueFilterList(scope) ? scope : "my";
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const filters = useIssueListFilters(list, wsId);
  const sort = useIssueListSort(list, wsId);
  const showProjects = list !== "project";
  const [myScope] = useMyIssuesScope(list === "my" ? wsId : null);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  // "Show all (n)" of a section replaces the sheet content (D3b).
  const [picker, setPicker] = useState<FilterSection | null>(null);

  // Same option list the status picker offers, so every status a user can set
  // is also a status they can filter by. (MUL-6243)
  const catalog = useIssueStatuses();
  const statusChoices = statusOptions(catalog);
  const { data: projects = [] } = useQuery({
    ...projectListOptions(wsId),
    enabled: !!wsId && showProjects,
  });
  const { data: labels = [] } = useQuery(labelListOptions(wsId));

  if (!wsId) return null;
  const store = useIssueListFilterStore.getState();
  const toggle = (dimension: IssueListFilterDimension, value: string) =>
    store.toggle(list, wsId, dimension, value);
  const hasActive = issueListFilterCount(filters) > 0;
  const muted = THEME[colorScheme].mutedForeground;

  if (picker && list === "my") {
    return (
      <ActorFilterPicker
        section={picker}
        list={list}
        wsId={wsId}
        userId={userId}
        filters={filters}
        onBack={() => setPicker(null)}
      />
    );
  }

  return (
    <View className="flex-1">
      <View className="flex-row items-center justify-between px-4 pt-4 pb-3">
        <Text className="text-base font-semibold text-foreground">
          {t("filters.title")}
        </Text>
        {hasActive ? (
          <Pressable
            onPress={() => store.clear(list, wsId)}
            hitSlop={8}
            accessibilityRole="button"
            className="px-2 py-1 active:opacity-60"
          >
            <Text className="text-sm text-primary font-medium">
              {t("filters.clear")}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {list === "project" ? (
        // One remembered filter for every project page of the workspace
        //Say so instead of surprising on the next project.
        <Text className="px-4 pb-2 text-xs text-muted-foreground">
          {t("filters.project_scope_hint")}
        </Text>
      ) : null}
      {/* nestedScrollEnabled: on Android a swipe scrolls the content
          instead of dragging the formSheet. */}
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false} nestedScrollEnabled>
        {list === "my" ? (
          <>
            <SortSection
              sort={sort}
              onChange={(next) => store.setSort(list, wsId, next)}
              initiallyExpanded={section === "sort"}
            />
            <ActorFilterSection
              section="assignee"
              list={list}
              wsId={wsId}
              userId={userId}
              filters={filters}
              visible={showsAssigneeFilter(list, myScope)}
              onShowAll={() => setPicker("assignee")}
            />
            <ActorFilterSection
              section="creator"
              list={list}
              wsId={wsId}
              userId={userId}
              filters={filters}
              visible={showsCreatorFilter(list, myScope)}
              onShowAll={() => setPicker("creator")}
            />
          </>
        ) : null}

        <SectionLabel>{t("filters.status")}</SectionLabel>
        {statusChoices.map((option) => (
          <FilterRow
            key={option.key}
            checked={filters.statuses.includes(option.key)}
            label={catalog.labelOf(option.key)}
            onPress={() => toggle("statuses", option.key)}
            icon={
              <StatusIcon
                status={option.key}
                category={option.category}
                icon={option.icon}
                color={option.color}
                size={16}
              />
            }
          />
        ))}

        <SectionLabel>{t("filters.priority")}</SectionLabel>
        {PRIORITY_ORDER.map((priority) => (
          <FilterRow
            key={priority}
            checked={filters.priorities.includes(priority)}
            label={t(PRIORITY_LABEL[priority])}
            onPress={() => toggle("priorities", priority)}
            icon={<PriorityIcon priority={priority} />}
          />
        ))}

        {showProjects ? (
          <>
            <SectionLabel>{t("filters.project")}</SectionLabel>
            <FilterRow
              checked={filters.includeNoProject}
              label={t("filters.no_project")}
              onPress={() => store.toggleNoProject(list, wsId)}
              icon={<Ionicons name="remove-circle-outline" size={16} color={muted} />}
            />
            {projects.map((project) => (
              <FilterRow
                key={project.id}
                checked={filters.projects.includes(project.id)}
                label={project.title}
                onPress={() => toggle("projects", project.id)}
                icon={<ProjectIcon icon={project.icon} />}
              />
            ))}
          </>
        ) : null}

        {labels.length > 0 || filters.labels.length > 0 ? (
          <SectionLabel>{t("filters.label")}</SectionLabel>
        ) : null}
        {labels.map((label) => (
          <FilterRow
            key={label.id}
            checked={filters.labels.includes(label.id)}
            label={label.name}
            onPress={() => toggle("labels", label.id)}
            icon={
              <View
                className="size-3 rounded-full"
                style={{ backgroundColor: label.color }}
              />
            }
          />
        ))}

        <SectionLabel>{t("filters.due_date")}</SectionLabel>
        {DUE_FILTERS.map((due) => (
          <FilterRow
            key={due}
            checked={filters.due.includes(due)}
            label={t(`filters.due_${due}`)}
            onPress={() => toggle("due", due)}
            icon={<Ionicons name={DUE_ICON[due]} size={16} color={muted} />}
          />
        ))}
        <View className="h-6" />
      </ScrollView>
    </View>
  );
}
