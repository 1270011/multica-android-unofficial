/**
 * Contexts behind `content-width.ts`. A screen that splits its
 * width (issue detail with two panes) provides the pane width; the chat
 * bubble and the comment card turn it into the width their markdown gets.
 * Without a provider both fall back to the window width.
 */
import { createContext, useContext } from "react";
import { useWindowDimensions } from "react-native";
import { DEFAULT_MARKDOWN_INSET } from "./content-width";

const PaneWidthContext = createContext<number | null>(null);
/**
 * Long-press of the surface around the markdown (message menu). A link in a
 * table cell is a nested `<Text onPress>`; without its own `onLongPress`
 * RN fires `onPress` when a long hold is released, so a long-press on the
 * link would open it instead of the menu.
 */
const MarkdownLongPressContext = createContext<(() => void) | undefined>(undefined);
export const MarkdownLongPressProvider = MarkdownLongPressContext.Provider;
export function useMarkdownLongPress(): (() => void) | undefined {
  return useContext(MarkdownLongPressContext);
}
const MarkdownWidthContext = createContext<number | null>(null);
/** Comment the markdown belongs to (chat position after the full view). */
const MarkdownEntryIdContext = createContext<string | undefined>(undefined);
export const MarkdownEntryIdProvider = MarkdownEntryIdContext.Provider;
export function useMarkdownEntryId(): string | undefined {
  return useContext(MarkdownEntryIdContext);
}

export const PaneWidthProvider = PaneWidthContext.Provider;
export const MarkdownWidthProvider = MarkdownWidthContext.Provider;

/** Width of the pane that holds the comment list, in dp. */
export function usePaneWidth(): number {
  const { width } = useWindowDimensions();
  return useContext(PaneWidthContext) ?? width;
}

/** Width the current markdown content may use, in dp. */
export function useMarkdownWidth(): number {
  const { width } = useWindowDimensions();
  return useContext(MarkdownWidthContext) ?? Math.max(0, width - DEFAULT_MARKDOWN_INSET);
}
