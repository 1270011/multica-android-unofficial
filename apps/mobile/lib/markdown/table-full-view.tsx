/**
 * Full view of one table ("Vollansicht", rows 14–16).
 * Own stack screen (`[workspace]/table-view`), opened by the "Als Tabelle
 * öffnen" button under cards or the bubble's TalkBack action:
 *
 *   ┌ ✕  Tabelle (6 Zeilen, 2 Spalten)          ⧉ ┐
 *   │ Teil          │ Stand                      │  ← header row stays on top
 *   │ Welle 1: …    │ fertig, alle …             │
 *
 * - Always a grid, by the same rule as in the bubble but on the full
 *   window width (`fullViewTableLayout`), following rotation. Horizontal
 *   scrolling only here and only when even the minimum column widths do
 *   not fit; a soft fade on the edge that has more columns shows it. No
 *   message menu lives on this screen, so the pan has nothing to fight.
 * - TalkBack: the title is a heading, ✕ is "Schließen", every body row is
 *   one stop ("Zeile 2 von 6. Teil: …; Stand: …") with its links as
 *   actions. Cells stay selectable for touch users.
 * - "Kopieren" puts the table on the clipboard as markdown.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  Text as RNText,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type TextStyle,
} from "react-native";
import { router } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { Ionicons } from "@/components/ui/ionicons";
import { Text } from "@/components/ui/text";
import * as Haptics from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { THEME } from "@/lib/theme";
import { showToast } from "@/lib/toast";
import { useColorScheme } from "@/lib/use-color-scheme";
import { useMarkdownLinkPress } from "./link-press";
import { markTableViewRotated } from "./table-view-store";
import { useTableSpeechWords } from "./markdown-table";
import {
  columnLabel,
  fullViewTableLayout,
  rowLinks,
  tableRowToSpeech,
  tableToMarkdown,
  TABLE_CELL_PADDING_H,
  TABLE_CELL_PADDING_V,
  type InlineRun,
  type TableAlign,
  type TableModel,
} from "./table-model";

const FONT_SIZE = 14;
const LINE_HEIGHT = 20;
const FADE_WIDTH = 24;
/** Space around the grid on the screen, both sides together. */
const SCREEN_INSET = 2 * 12;

export function TableFullView({ table }: { table: TableModel | undefined }) {
  const { t } = useT("common");
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const insets = useSafeAreaInsets();
  // A rotation here re-lays out the chat underneath (see table-view-store).
  const { width: winWidth } = useWindowDimensions();
  const firstWidth = useRef(winWidth);
  useEffect(() => {
    if (winWidth !== firstWidth.current) markTableViewRotated();
  }, [winWidth]);
  const cols = table?.align.length ?? 0;
  const rows = table?.rows.length ?? 0;
  const title = table
    ? t("table.full_title", {
        rows: t("table.rows", { count: rows }),
        cols: t("table.cols", { count: cols }),
      })
    : t("table.title");

  const onCopy = useCallback(() => {
    if (!table) return;
    Clipboard.setStringAsync(tableToMarkdown(table)).catch(() => {});
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    showToast({ key: "common:table.copied" });
  }, [table]);

  return (
    <View
      testID="table-full-view"
      style={{
        flex: 1,
        backgroundColor: theme.background,
        paddingTop: insets.top,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          minHeight: 56,
          paddingLeft: Math.max(4, insets.left),
          paddingRight: Math.max(4, insets.right),
          borderBottomWidth: 1,
          borderColor: theme.border,
          gap: 4,
        }}
      >
        <HeaderButton
          testID="table-full-view-close"
          icon="close"
          label={t("actions.close")}
          color={theme.foreground}
          onPress={() => router.back()}
        />
        <Text
          accessibilityRole="header"
          className="flex-1 text-base font-semibold text-foreground"
          numberOfLines={2}
        >
          {title}
        </Text>
        {table ? (
          <HeaderButton
            testID="table-full-view-copy"
            icon="copy-outline"
            label={t("actions.copy")}
            color={theme.foreground}
            onPress={onCopy}
          />
        ) : null}
      </View>
      {table ? (
        <FullGrid table={table} />
      ) : (
        <Text className="p-4 text-sm text-muted-foreground">{t("table.gone")}</Text>
      )}
    </View>
  );
}

function HeaderButton({
  testID,
  icon,
  label,
  color,
  onPress,
}: {
  testID: string;
  icon: "close" | "copy-outline";
  label: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      // Static style: NativeWind's Pressable drops a style function.
      style={{
        width: 48,
        height: 48,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Ionicons name={icon} size={22} color={color} />
    </Pressable>
  );
}

const FullGrid = memo(function FullGrid({ table }: { table: TableModel }) {
  const { t: tr } = useT("common");
  const { colorScheme } = useColorScheme();
  const t = THEME[colorScheme];
  const { width, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const words = useTableSpeechWords();
  const onLinkPress = useMarkdownLinkPress();
  const W = Math.max(0, width - insets.left - insets.right - SCREEN_INSET);
  const layout = useMemo(() => fullViewTableLayout(table, W, fontScale), [table, W, fontScale]);
  const rowWords = useMemo(
    () => ({
      ...words,
      rowOf: (n: number, total: number) => tr("table.row_of", { n, total }),
    }),
    [words, tr],
  );

  // Which edges have hidden columns (only while scrolling sideways).
  const [edge, setEdge] = useState<"start" | "middle" | "end">("start");
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const x = contentOffset.x;
    const max = contentSize.width - layoutMeasurement.width;
    setEdge(x <= 1 ? "start" : x >= max - 1 ? "end" : "middle");
  }, []);

  const runStyles = useMemo(
    () => ({
      base: {
        color: t.foreground,
        fontSize: FONT_SIZE,
        lineHeight: LINE_HEIGHT,
      },
      header: { fontWeight: "600" as const },
      code: { fontFamily: "monospace", color: t.mutedForeground },
      link: { color: t.brand, textDecorationLine: "underline" as const },
      strike: {
        textDecorationLine: "line-through" as const,
        color: t.mutedForeground,
      },
    }),
    [t],
  );

  const renderCells = (cells: InlineRun[][], header: boolean) =>
    cells.map((cell, col) => (
      <View
        key={col}
        style={{
          width: layout.widths[col],
          paddingHorizontal: TABLE_CELL_PADDING_H,
          paddingVertical: TABLE_CELL_PADDING_V,
          borderLeftWidth: col === 0 ? 0 : 1,
          borderColor: t.border,
        }}
      >
        <RNText
          selectable
          style={[
            runStyles.base,
            header ? runStyles.header : null,
            { textAlign: textAlign(table.align[col]) },
          ]}
        >
          {cell.map((run, i) => (
            <FullRun key={i} run={run} styles={runStyles} onLinkPress={onLinkPress} />
          ))}
        </RNText>
      </View>
    ));

  // The sticky wrapper takes over its child's style and gives the child a
  // plain "fill" style, so the row sits in an unstyled View of its own.
  const headerRow = (
    <View collapsable={false}>
      <View
        testID="table-full-view-header"
        collapsable={false}
        accessible
        accessibilityLabel={table.header.map((_, c) => columnLabel(table, c, words)).join(", ")}
        style={{
          flexDirection: "row",
          width: layout.contentWidth,
          backgroundColor: t.surface2,
          borderBottomWidth: 1,
          borderColor: t.border,
        }}
      >
        {renderCells(table.header, true)}
      </View>
    </View>
  );

  const grid = (
    <ScrollView
      // Header row stays visible while the rows scroll.
      stickyHeaderIndices={[0]}
      style={layout.scroll ? { width: layout.contentWidth } : undefined}
      contentContainerStyle={{
        paddingHorizontal: layout.scroll ? 0 : SCREEN_INSET / 2,
        paddingBottom: 24,
      }}
    >
      {headerRow}
      {table.rows.map((row, r) => {
        const links = rowLinks(table, r);
        return (
          <View
            key={r}
            testID={`table-full-view-row-${r + 1}`}
            collapsable={false}
            accessible
            accessibilityLabel={tableRowToSpeech(table, r, rowWords)}
            accessibilityActions={links.map((l, i) => ({
              name: `link_${i}`,
              label: tr("table.open_link_a11y", { link: l.text }),
            }))}
            onAccessibilityAction={(e) => {
              const i = Number(e.nativeEvent.actionName.replace("link_", ""));
              const link = links[i];
              if (link) onLinkPress({ url: link.href });
            }}
            style={{
              flexDirection: "row",
              width: layout.contentWidth,
              borderBottomWidth: 1,
              borderColor: t.border,
            }}
          >
            {renderCells(row, false)}
          </View>
        );
      })}
    </ScrollView>
  );

  if (!layout.scroll) return grid;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        testID="table-full-view-hscroll"
        horizontal
        onScroll={onScroll}
        scrollEventThrottle={64}
        contentContainerStyle={{ paddingHorizontal: SCREEN_INSET / 2 }}
      >
        {grid}
      </ScrollView>
      {edge !== "start" ? <EdgeFade side="left" color={t.foreground} /> : null}
      {edge !== "end" ? <EdgeFade side="right" color={t.foreground} /> : null}
    </View>
  );
});

function textAlign(a: TableAlign): TextStyle["textAlign"] {
  return a === "center" ? "center" : a === "right" ? "right" : "left";
}

function FullRun({
  run,
  styles,
  onLinkPress,
}: {
  run: InlineRun;
  styles: { code: TextStyle; link: TextStyle; strike: TextStyle };
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
 * Soft shadow on the edge that has more columns (as in the bubble table
 * before). Drawn in the foreground colour at low opacity so it
 * reads in light and dark mode without knowing the background.
 */
function EdgeFade({ side, color }: { side: "left" | "right"; color: string }) {
  const id = `table-full-fade-${side}`;
  return (
    <View
      testID={`table-full-view-fade-${side}`}
      collapsable={false}
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
            <Stop offset="1" stopColor={color} stopOpacity={0.18} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}
