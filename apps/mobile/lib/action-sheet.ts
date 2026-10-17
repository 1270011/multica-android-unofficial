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

let presenter: Presenter | null = null;

/** Called by `ActionSheetHost` on mount/unmount. */
export function registerActionSheetPresenter(fn: Presenter | null) {
  presenter = fn;
}

export function showActionSheet(
  options: ActionSheetOptions,
  callback: ActionSheetCallback,
): void {
  if (Platform.OS === "ios") {
    ActionSheetIOS.showActionSheetWithOptions(options, callback);
    return;
  }
  if (presenter) {
    presenter({ options, callback });
    return;
  }
  // No host mounted (should not happen in the app; keeps tests/headless
  // callers from hanging): behave like a dismissed sheet.
  if (options.cancelButtonIndex !== undefined) callback(options.cancelButtonIndex);
}
