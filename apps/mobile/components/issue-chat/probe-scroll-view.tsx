/**
 * Scroll component for the chat's FlashList that records the native scroll
 * values. FlashList drops scroll events while it corrects its
 * offset, and its JS offset stays stale after the initial scroll to the end
 *So the cover hand-over reads the values here instead.
 *
 * Every prop and event goes on to the ScrollView unchanged, including the
 * list's own `onScroll` (window, paging up, `onStartReached`); the probe
 * only looks at the values first. While anchored it also drops the list's
 * own `scrollToEnd` (bottom-follow). A window that gets shorter
 * at the end (keyboard, growing composer) keeps the end in view.
 * Create once per list (`useState`), a new
 * component per render would remount the list's content.
 */
import { forwardRef, useCallback, useRef } from "react";
import {
  ScrollView,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps,
} from "react-native";
import { endOffsetAfterShrink, type NativeScrollState } from "@/lib/chat-first-frame";
import { holdScrollToEnd } from "@/lib/chat-anchor";

export function createProbeScrollView(
  state: NativeScrollState,
  onChange: () => void,
  /** While true, `scrollToEnd` is dropped (anchored landing). */
  holdEnd: () => boolean = () => false,
  onHeldEnd?: () => void,
) {
  const ProbeScrollView = forwardRef<ScrollView, ScrollViewProps>(function ProbeScrollView(props, ref) {
    const { onScroll, onContentSizeChange, onLayout } = props;
    const own = useRef<ScrollView | null>(null);
    const setRef = useCallback(
      (inst: ScrollView | null) => {
        own.current = inst;
        if (inst) holdScrollToEnd(inst, holdEnd, onHeldEnd);
        if (typeof ref === "function") ref(inst);
        else if (ref) ref.current = inst;
      },
      [ref],
    );
    return (
      <ScrollView
        {...props}
        ref={setRef}
        onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
          const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
          state.scroll(contentOffset.y, layoutMeasurement.height, contentSize.height);
          onChange();
          onScroll?.(e);
        }}
        onContentSizeChange={(w: number, h: number) => {
          state.content = h;
          onChange();
          onContentSizeChange?.(w, h);
        }}
        onLayout={(e: LayoutChangeEvent) => {
          const prev = state.probe();
          state.viewport = e.nativeEvent.layout.height;
          // `scrollTo`, not `scrollToEnd`: the end is kept while anchored too.
          const y = endOffsetAfterShrink(prev, state.viewport);
          if (y !== null) {
            state.offset = y;
            own.current?.scrollTo({ y, animated: false });
          }
          onChange();
          onLayout?.(e);
        }}
      />
    );
  });
  return ProbeScrollView;
}
