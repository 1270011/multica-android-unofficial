/**
 * Sort of the issue lists: the "Sort" section at the top of the filter sheet (radio
 * list + direction) and the "Sorted: Priority ↓" row above the list.
 * Fields in web order; the direction segment is hidden for "Manual".
 *
 * The section is one row "Sort: Manual" that expands to the radio list:
 * eight rows at the top would push every filter out of view, at 200 % by
 * several screens. The "Sorted: …" row opens the sheet expanded.
 */
import { useState } from "react";
import { Pressable, View } from "react-native";
import { Ionicons } from "@/components/ui/ionicons";
import { Text } from "@/components/ui/text";
import { SectionLabel } from "@/components/issue/filter-rows";
import {
  ISSUE_SORT_FIELDS,
  type IssueListSort,
  type IssueSortDirection,
  isManualSort,
  sortForField,
  withSortDirection,
} from "@/lib/issue-list-sort";
import { useT } from "@/lib/i18n";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

const DIRECTIONS: readonly IssueSortDirection[] = ["asc", "desc"];

export function SortSection({
  sort,
  onChange,
  initiallyExpanded = false,
}: {
  sort: IssueListSort;
  onChange: (sort: IssueListSort) => void;
  initiallyExpanded?: boolean;
}) {
  const { t } = useT("issues");
  const { colorScheme } = useColorScheme();
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const field = t(`sort.field_${sort.field}`);
  const summary = isManualSort(sort)
    ? field
    : `${field} ${sort.direction === "asc" ? "↑" : "↓"}`;
  return (
    <View testID="sort-section">
      <SectionLabel>{t("sort.title")}</SectionLabel>
      <Pressable
        testID="sort-toggle"
        onPress={() => setExpanded((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={t("sort.toggle_a11y", { value: summary })}
        className="flex-row items-center gap-3 px-4 py-2.5 min-h-12 active:bg-secondary"
      >
        <Text className="flex-1 text-sm text-foreground">{summary}</Text>
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={16}
          color={THEME[colorScheme].mutedForeground}
        />
      </Pressable>
      {expanded ? <SortChoices sort={sort} onChange={onChange} /> : null}
    </View>
  );
}

function SortChoices({
  sort,
  onChange,
}: {
  sort: IssueListSort;
  onChange: (sort: IssueListSort) => void;
}) {
  const { t } = useT("issues");
  return (
    <View>
      {/* Direction first: below eight rows it would sit off-screen at 200 %. */}
      {isManualSort(sort) ? null : (
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel={t("sort.direction")}
          // Wraps at 200 % instead of squeezing the two halves.
          className="flex-row flex-wrap gap-2 px-4 pt-1 pb-2"
        >
          {DIRECTIONS.map((direction) => {
            const selected = sort.direction === direction;
            return (
              <Pressable
                key={direction}
                testID={`sort-direction-${direction}`}
                onPress={() => {
                  if (!selected) onChange(withSortDirection(sort, direction));
                }}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={t(`sort.${direction}`)}
                className={cn(
                  "flex-grow items-center justify-center rounded-md border border-border px-3 py-2 min-h-12 active:opacity-60",
                  selected && "bg-accent",
                )}
              >
                <Text
                  className={cn(
                    "text-sm",
                    selected ? "text-accent-foreground font-medium" : "text-muted-foreground",
                  )}
                >
                  {direction === "asc" ? "↑ " : "↓ "}
                  {t(`sort.${direction}`)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
      <View accessibilityRole="radiogroup">
        {ISSUE_SORT_FIELDS.map((field) => {
          const selected = sort.field === field;
          return (
            <Pressable
              key={field}
              testID={`sort-field-${field}`}
              onPress={() => {
                if (!selected) onChange(sortForField(field));
              }}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={t(`sort.field_${field}`)}
              className={cn(
                "flex-row items-center gap-3 px-4 py-2.5 min-h-12 active:bg-secondary",
                selected && "bg-secondary/60",
              )}
            >
              <Text className="flex-1 text-sm text-foreground">
                {t(`sort.field_${field}`)}
              </Text>
              {selected ? (
                <Text className="text-sm text-primary font-semibold">✓</Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** "Sorted: Priority ↓" above the list; only when the sort is not "Manual". */
export function SortedByRow({
  sort,
  onPress,
}: {
  sort: IssueListSort;
  onPress: () => void;
}) {
  const { t } = useT("issues");
  if (isManualSort(sort)) return null;
  const field = t(`sort.field_${sort.field}`);
  return (
    <Pressable
      testID="sorted-by-row"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t("sort.sorted_by_a11y", {
        field,
        direction: t(`sort.${sort.direction}`),
      })}
      hitSlop={2}
      className="self-start mx-4 mb-2 min-h-11 justify-center active:opacity-60"
    >
      <Text className="text-xs text-muted-foreground">
        {t("sort.sorted_by", { field, arrow: sort.direction === "asc" ? "↑" : "↓" })}
      </Text>
    </Pressable>
  );
}
