/**
 * Title filter for an overview list: stored settings of
 * the workspace → matcher → visible issues and hidden count, plus the
 * temporary "Show" of this screen. See lib/issue-title-filter.ts.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigation, useRoute } from "@react-navigation/native";
import {
  useTitleFilterSettings,
  useViewPrefsHydration,
} from "@/data/stores/view-prefs-store";
import { getTitleFilterMatcher, type TitleFilterIssue, type TitleFilterMatcher } from "./title-filter";
import {
  applyTitleFilter,
  revealEndsOnBlur,
  type TitleFilteredList,
} from "./issue-title-filter";

/** The workspace's matcher; inactive until the stored settings are loaded. */
export function useTitleFilterMatcher(wsId: string | null): TitleFilterMatcher {
  useViewPrefsHydration(wsId);
  const settings = useTitleFilterSettings(wsId);
  return useMemo(() => getTitleFilterMatcher(settings), [settings]);
}

/**
 * "Show" in the hint row: holds while the user stays on this screen (also
 * across opening an issue), ends on another bottom tab, on unmount and on a
 * workspace change. The setting itself stays on.
 */
export function useTitleFilterReveal(wsId: string | null) {
  const [revealed, setRevealed] = useState(false);
  const navigation = useNavigation();
  const route = useRoute();
  useEffect(
    () =>
      navigation.addListener("blur", () => {
        if (revealEndsOnBlur(navigation.getState(), route.key)) setRevealed(false);
      }),
    [navigation, route.key],
  );
  useEffect(() => setRevealed(false), [wsId]);
  const toggle = useCallback(() => setRevealed((r) => !r), []);
  return { revealed, toggle };
}

export interface TitleFilteredScreenList<T> extends TitleFilteredList<T> {
  revealed: boolean;
  toggleReveal: () => void;
}

/** Title filter as the last step after `filterIssueList`. */
export function useTitleFilteredIssues<T extends TitleFilterIssue>(
  wsId: string | null,
  issues: T[],
): TitleFilteredScreenList<T> {
  const matcher = useTitleFilterMatcher(wsId);
  const { revealed, toggle } = useTitleFilterReveal(wsId);
  const result = useMemo(
    () => applyTitleFilter(issues, matcher, revealed),
    [issues, matcher, revealed],
  );
  return { ...result, revealed, toggleReveal: toggle };
}
