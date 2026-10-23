/**
 * Bottom tab bar — JS `<Tabs>` from expo-router (react-navigation under the
 * hood). We tried NativeTabs first but its `canPreventDefault: false`
 * constraint makes "tap More → open something" impossible. JS Tabs
 * supports `listeners.tabPress + e.preventDefault()`, the canonical RN
 * pattern for tab-as-action.
 *
 * The "More" tab is **not a navigation target** — its press opens a
 * DropdownMenu popover anchored above the tab. The popover is rendered
 * by `<MoreTabDropdownAnchor />` as a sibling of `<Tabs>`, NOT as a
 * `tabBarButton` replacement: keeping the real tab button intact means
 * the icon + "More" label render identically to the other three tabs.
 * We just open the dropdown imperatively from `listeners.tabPress` via
 * the exposed `TriggerRef.open()`.
 *
 * The stub (tabs)/more.tsx file still exists only because expo-router
 * requires every Tabs.Screen to have a backing route file — the press
 * is preventDefault'd so we never actually navigate to it.
 *
 * From NAV_RAIL_MIN_DP (600 dp) the same tabs render as a
 * navigation rail on the left (bottom-tabs `tabBarPosition: "left"` with
 * the Material variant). The window width is read here, so rotation and
 * split screen switch live; the More popover follows via `navMode`.
 *
 * Active / inactive tint colors are derived from the current colour
 * scheme via THEME so dark mode picks contrasting values automatically.
 */
import { memo, useRef } from "react";
import { Tabs } from "expo-router";
import { SymbolIcon } from "@/components/ui/symbol-icon";
import { Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { TriggerRef } from "@rn-primitives/dropdown-menu";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import {
  useInboxUnreadCount,
  useChatUnreadMessageCount,
} from "@/lib/unread-counts";
import { MoreTabDropdownAnchor } from "@/components/nav/more-tab-dropdown";
import { useT } from "@/lib/i18n";
import { perfMark } from "@/lib/perf-mark";
import { NAV_RAIL_WIDTH, navModeFor } from "@/lib/nav-layout";

// Only override backgroundColor — @react-navigation/elements Badge internally
// sets borderRadius = size/2, height = size, minWidth = size, so a single
// character renders as a perfect circle. Overriding minWidth/fontSize here
// breaks that geometry. Text color is auto-derived from backgroundColor
// luminance by Badge itself (white on brand blue).
const BADGE_STYLE = {
  backgroundColor: THEME.light.brand,
};

// Memoized: a push onto the workspace Stack re-renders it, and the
// tab bar plus its screens must not re-render with it.
export default memo(function TabsLayout() {
  perfMark("render:tabs");
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const { t } = useT("navigation");
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const navMode = navModeFor(width);
  const rail = navMode === "rail";

  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const inboxUnread = useInboxUnreadCount(wsId);
  const chatUnread = useChatUnreadMessageCount(wsId);

  // Truncation aligned with web's sidebar badges: 99+ for both. `undefined`
  // makes React Navigation hide the badge, so zero-count is a free no-op.
  const inboxBadge =
    inboxUnread > 0 ? (inboxUnread > 99 ? "99+" : String(inboxUnread)) : undefined;
  const chatBadge =
    chatUnread > 0 ? (chatUnread > 99 ? "99+" : String(chatUnread)) : undefined;

  // Imperative handle into the More tab's dropdown — listeners.tabPress
  // calls .open(); the @rn-primitives Trigger measures itself inside
  // open() so the popover anchors to MoreTabDropdownAnchor's rect.
  const moreTriggerRef = useRef<TriggerRef>(null);

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: theme.foreground,
          tabBarInactiveTintColor: theme.mutedForeground,
          tabBarPosition: rail ? "left" : "bottom",
          tabBarVariant: rail ? "material" : "uikit",
          tabBarLabelPosition: rail ? "below-icon" : undefined,
          // The rail pads itself by the left inset, so add it to the width.
          tabBarStyle: rail
            ? { backgroundColor: theme.background, width: NAV_RAIL_WIDTH + insets.left }
            : { backgroundColor: theme.background },
          // 200 % font: the bar has a fixed height, so the label scales
          // only up to TAB_LABEL_MAX_FONT_SCALE and stays on one line; the
          // accessibility label keeps the full text for TalkBack.
          // In landscape bottom-tabs puts the label beside the icon; it then
          // needs the gap and weight its default label would have.
          // In the rail a long label ("Meine Issues") may wrap to two lines.
          tabBarLabel: ({ color, children, position }) => (
            <Text
              numberOfLines={rail ? 2 : 1}
              maxFontSizeMultiplier={TAB_LABEL_MAX_FONT_SCALE}
              style={{
                color,
                fontSize: position === "beside-icon" ? 13 : 11,
                fontWeight: "500",
                ...(rail ? { textAlign: "center" as const } : null),
                // bottom-tabs' own beside-icon label: gap to the icon, 12 dp end.
                ...(position === "beside-icon" ? { marginStart: 8, marginEnd: 12 } : null),
              }}
            >
              {children}
            </Text>
          ),
        }}
      >
        <Tabs.Screen
          name="inbox"
          options={{
            title: t("tabs.inbox"),
            // Explicit labels so TalkBack reads "Inbox, 2" instead of the
            // icon glyph + badge + title concatenation.
            tabBarAccessibilityLabel: tabLabel(t("tabs.inbox"), inboxBadge),
            tabBarBadge: inboxBadge,
            tabBarBadgeStyle: BADGE_STYLE,
            tabBarIcon: ({ color, size, focused }) => (
              <SymbolIcon name={focused ? "tray.fill" : "tray"} size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="my-issues"
          options={{
            title: t("tabs.my_issues"),
            tabBarAccessibilityLabel: t("tabs.my_issues"),
            tabBarIcon: ({ color, size, focused }) => (
              <SymbolIcon name={focused ? "checklist" : "checklist.unchecked"} size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="chat"
          options={{
            title: t("tabs.chat"),
            tabBarAccessibilityLabel: tabLabel(t("tabs.chat"), chatBadge),
            tabBarBadge: chatBadge,
            tabBarBadgeStyle: BADGE_STYLE,
            tabBarIcon: ({ color, size, focused }) => (
              <SymbolIcon name={focused ? "bubble.left.fill" : "bubble.left"} size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="more"
          options={{
            title: t("tabs.more"),
            tabBarAccessibilityLabel: t("tabs.more"),
            tabBarIcon: ({ color, size }) => (
              <SymbolIcon name="ellipsis" size={size} color={color} />
            ),
          }}
          listeners={() => ({
            tabPress: (e) => {
              // Don't navigate to the (stub) /more screen — open the
              // dropdown popover instead. The trigger is invisible and
              // mounted in MoreTabDropdownAnchor below; ref.open() also
              // measures its rect so the popover anchors correctly.
              e.preventDefault();
              moreTriggerRef.current?.open();
            },
          })}
        />
      </Tabs>

      <MoreTabDropdownAnchor triggerRef={moreTriggerRef} navMode={navMode} />
    </View>
  );
});

const TAB_LABEL_MAX_FONT_SCALE = 1.5;

function tabLabel(title: string, badge: string | undefined): string {
  return badge ? `${title}, ${badge}` : title;
}
