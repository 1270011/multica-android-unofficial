/**
 * Top-level GFM table. The splitter lifts tables out of the enriched prose
 * stream (see `table-model.ts` for why) and this component draws them
 * without any horizontal scrolling:
 *
 *   grid (columns stay readable)       cards (otherwise)
 *   ┌───────────┬──────────────┐       ┌──────────────────────────┐
 *   │ Teil      │ Stand        │       │ Welle 1: Live-Aktuali…   │
 *   ├───────────┼──────────────┤       │ Stand   fertig, alle …   │
 *   │ Welle 1:  │ fertig, alle │       ├──────────────────────────┤
 *   │ Live-…    │ Arbeitspak…  │       │ Tablet-Layout            │
 *
 * - `chooseTableLayout` decides from the width the surface provides
 *   (`useMarkdownWidth`, no measure pass) and the font scale. The grid lays
 *   its columns out as proportions of the real width, so a few dp off never
 *   clips a cell; long words and inline code wrap inside the cell.
 * - No ScrollView means no gesture of its own: a long-press anywhere opens
 *   the bubble's message menu, swipe-to-reply works on the table, and links
 *   in cells stay tappable as nested `<Text onPress>`.
 * - Cells are plain `<Text>` runs, so `selectable` follows the bubble's
 *   selection mode exactly like prose and code.
 */
import { memo, useEffect, useMemo, useRef } from "react";
import { Pressable, Text as RNText, View, useWindowDimensions, type TextStyle } from "react-native";
import { Ionicons } from "@/components/ui/ionicons";
import { useT } from "@/lib/i18n";
import { MOBILE_RADIUS } from "@/lib/radius";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";
import { useMarkdownEntryId, useMarkdownLongPress, useMarkdownWidth } from "./content-width-context";
import { useOpenTableView } from "./table-actions";
import { registerTableNode } from "./table-view-store";
import {
  chooseTableLayout,
  columnLabel,
  TABLE_CARD_PADDING,
  TABLE_CELL_PADDING_H,
  TABLE_CELL_PADDING_V,
  type InlineRun,
  type TableAlign,
  type TableModel,
  type TableSpeechWords,
} from "./table-model";

interface Props {
  table: TableModel;
  selectable: boolean;
  onLinkPress: (e: { url: string }) => void;
}

const FONT_SIZE = 14;
const LINE_HEIGHT = 20;
const LABEL_FONT_SIZE = 12;
const LABEL_LINE_HEIGHT = 16;

export const MarkdownTable = memo(function MarkdownTable({
  table,
  selectable,
  onLinkPress,
}: Props) {
  const { colorScheme } = useColorScheme();
  const t = THEME[colorScheme];
  const { fontScale } = useWindowDimensions();
  const width = useMarkdownWidth();
  const words = useTableSpeechWords();
  const onLinkLongPress = useMarkdownLongPress();
  const openTableView = useOpenTableView();
  const { t: tr } = useT("common");
  const layout = useMemo(
    () => chooseTableLayout(table, width, fontScale),
    [table, width, fontScale],
  );
  // The chat lands on this table after a rotation in its full view.
  const nodeRef = useRef<View>(null);
  const entryId = useMarkdownEntryId();
  useEffect(() => {
    const node = nodeRef.current;
    return node ? registerTableNode(table, node, entryId) : undefined;
  }, [table, layout.mode, entryId]);

  const runStyles = useMemo(
    () => ({
      base: {
        color: t.foreground,
        fontSize: FONT_SIZE,
        lineHeight: LINE_HEIGHT,
      },
      header: { fontWeight: "600" as const },
      label: {
        color: t.mutedForeground,
        fontSize: LABEL_FONT_SIZE,
        lineHeight: LABEL_LINE_HEIGHT,
        fontWeight: "600" as const,
      },
      code: { fontFamily: "monospace", color: t.mutedForeground },
      link: { color: t.brand, textDecorationLine: "underline" as const },
      strike: {
        textDecorationLine: "line-through" as const,
        color: t.mutedForeground,
      },
    }),
    [t],
  );

  const frame = {
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: MOBILE_RADIUS.md,
    overflow: "hidden" as const,
  };

  const cellText = (cell: InlineRun[], style: (TextStyle | null)[]) => (
    <RNText selectable={selectable} style={[runStyles.base, ...style]}>
      {cell.map((run, i) => (
        <Run
          key={i}
          run={run}
          styles={runStyles}
          onLinkPress={onLinkPress}
          onLinkLongPress={onLinkLongPress}
        />
      ))}
    </RNText>
  );

  if (layout.mode === "cards") {
    const pad = TABLE_CARD_PADDING * Math.max(1, fontScale);
    return (
      <View ref={nodeRef} testID="markdown-table-cards" collapsable={false} style={frame}>
        {table.rows.map((row, r) => (
          <View
            key={r}
            style={{
              padding: pad,
              gap: 8,
              borderTopWidth: r === 0 ? 0 : 1,
              borderColor: t.border,
            }}
          >
            {row[0]?.length ? cellText(row[0], [{ fontWeight: "bold" }]) : null}
            {row.slice(1).map((cell, i) => {
              const col = i + 1;
              if (cell.length === 0) return null;
              const label = (
                <RNText selectable={selectable} style={runStyles.label}>
                  {columnLabel(table, col, words)}
                </RNText>
              );
              return layout.sideBySide ? (
                <View key={col} style={{ flexDirection: "row", gap: 8 }}>
                  <View style={{ width: layout.labelWidth - 8, paddingTop: 2 }}>{label}</View>
                  <View style={{ flex: 1 }}>{cellText(cell, [])}</View>
                </View>
              ) : (
                <View key={col} style={{ gap: 2 }}>
                  {label}
                  {cellText(cell, [])}
                </View>
              );
            })}
          </View>
        ))}
        {/* The grid in its own screen. A long-press goes to the
            bubble's message menu like everywhere else on the table. */}
        <Pressable
          testID="markdown-table-open"
          onPress={() => openTableView(table)}
          onLongPress={onLinkLongPress ?? noop}
          delayLongPress={450}
          accessibilityRole="button"
          accessibilityLabel={tr("table.open_button")}
          // Static style: NativeWind's Pressable drops a style function.
          style={{
            minHeight: 48,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            paddingHorizontal: pad,
            paddingVertical: 8,
            borderTopWidth: 1,
            borderColor: t.border,
          }}
        >
          <Ionicons name="expand-outline" size={18} color={t.brand} />
          <RNText
            style={{
              flexShrink: 1,
              color: t.brand,
              fontSize: FONT_SIZE,
              lineHeight: LINE_HEIGHT,
              fontWeight: "600",
              textAlign: "center",
            }}
          >
            {tr("table.open_button")}
          </RNText>
        </Pressable>
      </View>
    );
  }

  const widths = layout.widths;
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
            // Proportions of the real width, not fixed dp (see header).
            flexGrow: widths[col],
            flexShrink: 1,
            flexBasis: 0,
            minWidth: 0,
            paddingHorizontal: TABLE_CELL_PADDING_H,
            paddingVertical: TABLE_CELL_PADDING_V,
            borderLeftWidth: col === 0 ? 0 : 1,
            borderColor: t.border,
          }}
        >
          {cellText(cell, [
            header ? runStyles.header : null,
            { textAlign: textAlign(table.align[col]) },
          ])}
        </View>
      ))}
    </View>
  );

  return (
    <View ref={nodeRef} testID="markdown-table-grid" collapsable={false} style={frame}>
      {renderRow(table.header, true, "h", table.rows.length === 0)}
      {table.rows.map((row, r) => renderRow(row, false, String(r), r === table.rows.length - 1))}
    </View>
  );
});

/** Localised words for `tableToSpeech` and the "Spalte n" fallback. */
export function useTableSpeechWords(): TableSpeechWords {
  const { t } = useT("common");
  return useMemo(
    () => ({
      table: (rows, cols) =>
        `${t("table.title")}, ${t("table.rows", { count: rows })}, ${t("table.cols", { count: cols })}`,
      row: (n) => t("table.row", { n }),
      column: (n) => t("table.column", { n }),
    }),
    [t],
  );
}

function noop() {}

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
  onLinkLongPress,
}: {
  run: InlineRun;
  styles: RunStyles;
  onLinkPress: (e: { url: string }) => void;
  onLinkLongPress?: () => void;
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
      // A long-press on a link opens the message menu, not the link.
      onLongPress={href ? (onLinkLongPress ?? noop) : undefined}
      accessibilityRole={href ? "link" : undefined}
    >
      {run.text}
    </RNText>
  );
}
