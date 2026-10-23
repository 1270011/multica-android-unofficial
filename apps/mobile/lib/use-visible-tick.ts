import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { createVisibleTicker, VISIBLE_TICK_MS, type VisibleTicker } from "@/lib/visible-ticker";

/**
 * Returns `Date.now()` refreshed every 30 s while the calling screen is
 * focused and the app is in the foreground (see `lib/visible-ticker.ts`).
 * Use it as the `now` for `deriveRuntimeHealth` / `deriveAgentHangState` on
 * the runtime screens. No network requests are made here.
 */
export function useVisibleNow(intervalMs: number = VISIBLE_TICK_MS): number {
  const focused = useIsFocused();
  const [now, setNow] = useState(() => Date.now());
  const ticker = useRef<VisibleTicker | null>(null);

  useEffect(() => {
    const t = createVisibleTicker(() => setNow(Date.now()), {
      intervalMs,
      focused: false,
      appActive: AppState.currentState === "active",
    });
    ticker.current = t;
    const sub = AppState.addEventListener("change", (next) => t.setAppActive(next === "active"));
    return () => {
      sub.remove();
      t.dispose();
      ticker.current = null;
    };
  }, [intervalMs]);

  useEffect(() => {
    ticker.current?.setFocused(focused);
  }, [focused, intervalMs]);

  return now;
}
