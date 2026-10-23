/**
 * Top-level GFM table. The splitter lifts tables out
 * of the enriched prose stream (see `table-model.ts` for why) and this
 * component lays them out as a row/column grid in a horizontal ScrollView:
 *
 *   ┌──────┬──────────┬────────────░
 *   │ VM   │ Befund   │ Pfad       ░  ← fade on the edge that has more
 *   ├──────┼──────────┼────────────░
 *   │ db-1 │ ok       │ /var/log/… ░
 *
 * - Columns get an estimated width (once per comment, no measure pass),
 *   scaled with the font scale. Narrow tables grow to the full width and
 *   wrap inside their cells; wide ones scroll.
 * - The ScrollView comes from react-native-gesture-handler so it takes the
 *   horizontal pan away from the issue chat's swipe-to-reply
 *   (`ReanimatedSwipeable`); its RN responder also cancels the bubble's
 *   `Pressable` long-press once the finger moves. A still long-press keeps
 *   opening the bubble menu (Copy).
 * - Cells are plain `<Text>` runs, so `selectable` follows the bubble's
 *   selection mode exactly like prose and code.
 */
import { memo, useCallback, useMemo, useState } from "react";
import {
  Text as RNText,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type TextStyle,
} from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { MOBILE_RADIUS } from "@/lib/radius";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";
import {
  estimateColumnWidths,
  TABLE_CELL_PADDING_H,
  TABLE_CELL_PADDING_V,
  type InlineRun,
  type TableAlign,
  type TableModel,
} from "./table-model";

interface Props {
  table: TableModel;
  selectable: boolean;
  onLinkPress: (e: { url: string }) => void;
}

const FONT_SIZE = 14;
const LINE_HEIGHT = 20;
const FADE_WIDTH = 20;
// Scroll offset (dp) below which an edge counts as reached.
const EDGE_SLOP = 2;

export const MarkdownTable = memo(function MarkdownTable({
  table,
  selectable,
  onLinkPress,
}: Props) {
  const { colorScheme } = useColorScheme();
  const t = THEME[colorScheme];
  const { fontScale } = useWindowDimensions();
  const baseWidths = useMemo(() => estimateColumnWidths(table), [table]);
  const widths = useMemo(
    () => baseWidths.map((w) => Math.round(w * Math.max(1, fontScale))),
    [baseWidths, fontScale],
  );

  // Edge cues. One enum, so scrolling re-renders only when an edge is
  // reached or left.
  const [viewW, setViewW] = useState(0);
  const [contentW, setContentW] = useState(0);
  const [edge, setEdge] = useState<"start" | "middle" | "end">("start");
  const overflow = contentW > viewW + EDGE_SLOP;

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => setViewW(e.nativeEvent.layout.width),
    [],
  );
  const onContentSizeChange = useCallback((w: number) => setContentW(w), []);
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
      const x = contentOffset.x;
      setEdge(
        x <= EDGE_SLOP
          ? "start"
          : x + layoutMeasurement.width >= contentSize.width - EDGE_SLOP
            ? "end"
            : "middle",
      );
    },
    [],
  );

  const runStyles = useMemo(
    () => ({
      base: { color: t.foreground, fontSize: FONT_SIZE, lineHeight: LINE_HEIGHT },
      header: { fontWeight: "600" as const },
      code: { fontFamily: "monospace", color: t.mutedForeground },
      link: { color: t.brand, textDecorationLine: "underline" as const },
      strike: { textDecorationLine: "line-through" as const, color: t.mutedForeground },
    }),
    [t],
  );

  const renderRow = (cells: InlineRun[][], header: boolean, key: string, last: boolean) => (
    <View
      key={key}
      style={{
        flexDirection: "row",
        backgroundColor: header ? t.surface2 : "transparent",
        borderBottomWidth: last ? 0 : 1,
        borderColor: t.border,
      }}
    >
      {cells.map((cell, col) => (
        <View
          key={col}
          style={{
            width: widths[col],
            flexGrow: widths[col],
            paddingHorizontal: TABLE_CELL_PADDING_H,
            paddingVertical: TABLE_CELL_PADDING_V,
            borderLeftWidth: col === 0 ? 0 : 1,
            borderColor: t.border,
          }}
        >
          <RNText
            selectable={selectable}
            style={[
              runStyles.base,
              header ? runStyles.header : null,
              { textAlign: textAlign(table.align[col]) },
            ]}
          >
            {cell.map((run, i) => (
              <Run
                key={i}
                run={run}
                styles={runStyles}
                onLinkPress={onLinkPress}
              />
            ))}
          </RNText>
        </View>
      ))}
    </View>
  );

  return (
    <View>
      {/* flexGrow 0: same reason as CodeBlock — a horizontal ScrollView
          defaults to flexGrow 1 and would outgrow a self-sized chat cell. */}
      <ScrollView
        horizontal
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ minWidth: "100%" }}
        showsHorizontalScrollIndicator={overflow}
        onLayout={onLayout}
        onContentSizeChange={onContentSizeChange}
        onScroll={overflow ? onScroll : undefined}
        scrollEventThrottle={64}
      >
        <View
          style={{
            flexGrow: 1,
            borderWidth: 1,
            borderColor: t.border,
            borderRadius: MOBILE_RADIUS.md,
            overflow: "hidden",
          }}
        >
          {renderRow(table.header, true, "h", table.rows.length === 0)}
          {table.rows.map((row, r) =>
            renderRow(row, false, String(r), r === table.rows.length - 1),
          )}
        </View>
      </ScrollView>
      {overflow && edge !== "start" ? <EdgeFade side="left" color={t.foreground} /> : null}
      {overflow && edge !== "end" ? <EdgeFade side="right" color={t.foreground} /> : null}
    </View>
  );
});

function textAlign(a: TableAlign): TextStyle["textAlign"] {
  return a === "center" ? "center" : a === "right" ? "right" : "left";
}

type RunStyles = {
  code: TextStyle;
  link: TextStyle;
  strike: TextStyle;
};

function Run({
  run,
  styles,
  onLinkPress,
}: {
  run: InlineRun;
  styles: RunStyles;
  onLinkPress: (e: { url: string }) => void;
}) {
  const style: TextStyle[] = [];
  if (run.bold) style.push({ fontWeight: "bold" });
  if (run.italic) style.push({ fontStyle: "italic" });
  if (run.strike) style.push(styles.strike);
  if (run.code) style.push(styles.code);
  if (run.href) style.push(styles.link);
  const href = run.href;
  return (
    <RNText
      style={style}
      onPress={href ? () => onLinkPress({ url: href }) : undefined}
      accessibilityRole={href ? "link" : undefined}
    >
      {run.text}
    </RNText>
  );
}

/**
 * Soft shadow on the edge that has more columns. Drawn in the foreground
 * colour at low opacity so it reads on every surface (page, muted bubble,
 * brand tint) in light and dark mode without knowing the background.
 */
function EdgeFade({ side, color }: { side: "left" | "right"; color: string }) {
  const id = `table-fade-${side}`;
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        width: FADE_WIDTH,
        [side]: 0,
      }}
    >
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient
            id={id}
            x1={side === "right" ? "0" : "1"}
            y1="0"
            x2={side === "right" ? "1" : "0"}
            y2="0"
          >
            <Stop offset="0" stopColor={color} stopOpacity={0} />
            <Stop offset="1" stopColor={color} stopOpacity={0.14} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}
