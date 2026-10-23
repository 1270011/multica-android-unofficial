/**
 * Cross-platform action sheet with the `ActionSheetIOS` call signature.
 *
 * iOS keeps the native `ActionSheetIOS` (the pattern apps/mobile/AGENTS.md
 * prescribes). Android has no native equivalent in React Native — calling
 * `ActionSheetIOS` there is a no-op — so the same options render in a
 * bottom-sheet `Modal` hosted once at the root (`ActionSheetHost` in
 * components/ui/action-sheet-host.tsx), styled with the app's tokens so it
 * follows light/dark mode.
 *
 * Usage is a drop-in replacement:
 *
 *   showActionSheet({ options, cancelButtonIndex, destructiveButtonIndex, title }, (i) => ...)
 */
import { ActionSheetIOS, Platform } from "react-native";

export interface ActionSheetOptions {
  options: string[];
  cancelButtonIndex?: number;
  destructiveButtonIndex?: number | number[];
  title?: string;
  message?: string;
}

export type ActionSheetCallback = (buttonIndex: number) => void;

export interface ActionSheetRequest {
  options: ActionSheetOptions;
  callback: ActionSheetCallback;
}

type Presenter = (request: ActionSheetRequest) => void;

/**
 * Mounted hosts, newest last. A configuration change recreates the Activity
 * and the React surface remounts: the new host can mount before the old one
 * unmounts (font size, dark mode at once). A single slot
 * cleared on unmount then dropped the new host and every menu stayed shut
 * until the app restarted. Each host now removes only its own entry.
 */
const presenters: Presenter[] = [];

/**
 * Called by `ActionSheetHost` on mount; the returned function unregisters
 * this presenter only (call it on unmount). The newest host wins.
 */
export function registerActionSheetPresenter(fn: Presenter): () => void {
  presenters.push(fn);
  return () => {
    const index = presenters.lastIndexOf(fn);
    if (index >= 0) presenters.splice(index, 1);
  };
}

export function showActionSheet(
  options: ActionSheetOptions,
  callback: ActionSheetCallback,
): void {
  if (Platform.OS === "ios") {
    ActionSheetIOS.showActionSheetWithOptions(options, callback);
    return;
  }
  const presenter = presenters[presenters.length - 1];
  if (presenter) {
    presenter({ options, callback });
    return;
  }
  // No host mounted (should not happen in the app; keeps tests/headless
  // callers from hanging): behave like a dismissed sheet.
  if (options.cancelButtonIndex !== undefined) callback(options.cancelButtonIndex);
}
