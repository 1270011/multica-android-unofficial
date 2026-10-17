/**
 * Issue search list for the parent and duplicate pickers.
 * A plain TextInput above the list (not in ListHeaderComponent, which loses
 * focus on re-render) drives a debounced `api.searchIssues`. With an empty
 * query the list shows `initialQuery` results (e.g. issues with the same
 * title for the duplicate picker) or a hint.
 *
 * `filter` removes candidates that may not be picked; `leading` renders an
 * optional first row (e.g. "Remove parent").
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, FlatList, Pressable, TextInput, View } from "react-native";
import type { SearchIssueResult } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { StatusIcon } from "@/components/ui/status-icon";
import { MOBILE_PLACEHOLDER_COLOR } from "@/components/ui/input-tokens";
import { api } from "@/data/api";
import { useIssueStatuses } from "@/lib/use-issue-statuses";
import { useT } from "@/lib/i18n";

interface Props {
  title: string;
  placeholder: string;
  /** Search run while the box is empty; omit for "type to search". */
  initialQuery?: string;
  includeClosed?: boolean;
  filter: (results: SearchIssueResult[]) => SearchIssueResult[];
  onPick: (issue: SearchIssueResult) => void;
  leading?: ReactNode;
  testID?: string;
}

export function IssueSearchPickerBody({
  title,
  placeholder,
  initialQuery,
  includeClosed = false,
  filter,
  onPick,
  leading,
  testID,
}: Props) {
  const { t } = useT("issues");
  const { categoryOf, colorOf, iconOf } = useIssueStatuses();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchIssueResult[]>([]);
  const [loading, setLoading] = useState(false);

  const effective = query.trim() || initialQuery?.trim() || "";

  useEffect(() => {
    if (!effective) {
      setResults([]);
      setLoading(false);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      void api
        .searchIssues(
          { q: effective, limit: 20, include_closed: includeClosed },
          { signal: ac.signal },
        )
        .then((res) => setResults(res.issues))
        .catch(() => setResults([]))
        .finally(() => {
          if (!ac.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      ac.abort();
      clearTimeout(timer);
    };
  }, [effective, includeClosed]);

  const rows = useMemo(() => filter(results), [filter, results]);

  return (
    <View className="flex-1">
      <Text className="px-4 pt-4 pb-2 text-base font-semibold text-foreground">{title}</Text>
      <View className="px-4 pb-2">
        <TextInput
          testID={testID ? `${testID}-search` : undefined}
          value={query}
          onChangeText={setQuery}
          placeholder={placeholder}
          placeholderTextColor={MOBILE_PLACEHOLDER_COLOR}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel={placeholder}
          style={{ fontSize: 14, includeFontPadding: false }}
          className="rounded-md px-3 min-h-12 text-foreground bg-secondary/50"
        />
      </View>
      {leading}
      <FlatList
        data={rows}
        keyboardShouldPersistTaps="handled"
        keyExtractor={(row) => row.id}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => onPick(item)}
            accessibilityRole="button"
            accessibilityLabel={`${item.identifier} ${item.title}`}
            className="flex-row items-center gap-3 px-4 min-h-12 py-2 active:bg-secondary"
          >
            <StatusIcon
              status={item.status}
              category={categoryOf(item.status)}
              icon={iconOf(item.status)}
              color={colorOf(item.status)}
              size={16}
            />
            <Text className="text-xs text-muted-foreground">{item.identifier}</Text>
            <Text className="flex-1 text-base text-foreground" numberOfLines={2}>
              {item.title}
            </Text>
          </Pressable>
        )}
        ListEmptyComponent={
          <View className="px-4 py-8 items-center">
            {loading ? (
              <ActivityIndicator />
            ) : (
              <Text className="text-sm text-muted-foreground text-center">
                {effective ? t("picker.no_matches") : t("picker.type_to_search")}
              </Text>
            )}
          </View>
        }
      />
    </View>
  );
}
