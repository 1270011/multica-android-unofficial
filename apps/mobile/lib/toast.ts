/**
 * Minimal in-app toast. One message at a time, auto-dismissed.
 *
 * Rendered by `ToastHost` (components/ui/toast-host.tsx) at the root so it
 * follows the app theme (light/dark) on every platform and is announced to
 * screen readers via `accessibilityLiveRegion`. Non-React callers (mutation
 * `onError`, refresh guards) call `showToast()` directly.
 */
import { create } from "zustand";

/** Either literal text or an i18n key (`"ns:path.to.key"`) that the host
 *  resolves at render time — so the data layer can raise toasts without
 *  pulling the i18n runtime (and React Native) into its import graph.
 *  `params` fill interpolations such as `{{count}}`. */
export type ToastMessage =
  | string
  | { key: string; params?: Record<string, string | number> };

/** Optional button in the toast, e.g. "Undo". */
export interface ToastAction {
  label: ToastMessage;
  onPress: () => void;
}

export interface ToastState {
  message: ToastMessage | null;
  action: ToastAction | null;
  /** Monotonic id so re-showing the same text restarts the timer. */
  nonce: number;
}

export const TOAST_DURATION_MS = 3200;

export const useToastStore = create<ToastState>(() => ({ message: null, action: null, nonce: 0 }));

/** Toasts with a button stay longer, so the button can be reached. */
export const ACTION_TOAST_DURATION_MS = 6000;

let hideTimer: ReturnType<typeof setTimeout> | null = null;

export function showToast(
  message: ToastMessage,
  durationMs: number = TOAST_DURATION_MS,
  action: ToastAction | null = null,
): void {
  if (hideTimer) clearTimeout(hideTimer);
  useToastStore.setState((s) => ({ message, action, nonce: s.nonce + 1 }));
  hideTimer = setTimeout(() => {
    hideTimer = null;
    useToastStore.setState({ message: null, action: null });
  }, durationMs);
}

/** Runs the toast's action once and closes the toast. */
export function pressToastAction(): void {
  const action = useToastStore.getState().action;
  hideToast();
  action?.onPress();
}

export function hideToast(): void {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = null;
  useToastStore.setState({ message: null, action: null });
}
