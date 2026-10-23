/**
 * "Clear clipboard after pasting" preference. Default on.
 * Not a secret, but kept in SecureStore like the other small device prefs
 * (lib/use-color-scheme.ts) to avoid another storage dependency.
 */
import { useEffect, useState } from "react";
import * as SecureStore from "expo-secure-store";
import * as Clipboard from "./clipboard";

const STORAGE_KEY = "rb.clipboard_clear_after_paste";

export function parseClearPref(saved: string | null): boolean {
  return saved !== "0";
}

export function useClearClipboardPref(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(true);

  useEffect(() => {
    let cancelled = false;
    SecureStore.getItemAsync(STORAGE_KEY)
      .then((saved) => {
        if (!cancelled) setOn(parseClearPref(saved));
      })
      .catch(() => {
        // Keep the safe default.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const set = (next: boolean) => {
    setOn(next);
    void SecureStore.setItemAsync(STORAGE_KEY, next ? "1" : "0");
  };

  return [on, set];
}

/** Empties the system clipboard. The keyboard's own clipboard history
 *  (e.g. Gboard) is out of reach for any app — the UI says so. */
export async function clearClipboard(): Promise<void> {
  try {
    await Clipboard.setStringAsync("");
  } catch {
    // Nothing useful to do; never surface clipboard contents.
  }
}
