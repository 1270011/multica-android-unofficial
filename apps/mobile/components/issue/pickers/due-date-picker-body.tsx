/**
 * Pure picker body for due-date. The caller (a formSheet route) renders the
 * Done / Clear actions in its own header area — this body only handles the
 * date selection + the local draft state.
 *
 * iOS: the native inline UIDatePicker calendar, as upstream.
 *
 * Android: `display="inline"` does not exist there — the
 * component falls back to the system DatePickerDialog, and because the
 * dialog is a *rendered* element it reopened on every dismiss (CANCEL and
 * the Back key looped) and the sheet behind it stayed empty. The Android
 * path now uses the imperative `DateTimePickerAndroid.open()` instead: the
 * dialog opens once when the sheet appears, CANCEL / Back simply close it,
 * and the sheet shows the current day with a "Pick a date" button to reopen
 * the dialog. Done / Clear in the header commit as before.
 *
 * due_date is a calendar day (date-only "YYYY-MM-DD", no time/timezone — see
 * @multica/core/issues/date and GH #3618). Mirrors web's
 * packages/views/issues/components/pickers/due-date-picker.tsx: read the stored
 * day into a local-midnight Date for the spinner, write back the picked local
 * day as a date-only string.
 */
import {
  useState,
  useEffect,
  useImperativeHandle,
  forwardRef,
  useCallback,
  useRef,
} from "react";
import { Platform, Pressable, View } from "react-native";
import DateTimePicker, {
  DateTimePickerAndroid,
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { toDateOnly, dateOnlyToLocalDate } from "@multica/core/issues/date";
import { Ionicons } from "@/components/ui/ionicons";
import { Text } from "@/components/ui/text";
import { i18n, useT } from "@/lib/i18n";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";

interface Props {
  value: string | null;
}

export interface DueDatePickerBodyHandle {
  /** Returns the currently-displayed day as a date-only "YYYY-MM-DD" string. */
  getIso: () => string;
}

function toLocalDay(value: string | null): Date {
  return dateOnlyToLocalDate(value) ?? new Date();
}

/** Long, locale-aware label for the day shown on the Android sheet. */
export function formatDueDay(day: Date, locale: string | undefined): string {
  try {
    return day.toLocaleDateString(locale, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return toDateOnly(day);
  }
}

export const DueDatePickerBody = forwardRef<DueDatePickerBodyHandle, Props>(
  function DueDatePickerBody({ value }, ref) {
    const [draft, setDraft] = useState<Date>(() => toLocalDay(value));

    useEffect(() => {
      setDraft(toLocalDay(value));
    }, [value]);

    useImperativeHandle(ref, () => ({
      getIso: () => toDateOnly(draft),
    }));

    const locale = i18n.resolvedLanguage ?? i18n.language;

    if (Platform.OS === "android") {
      return <AndroidDayPicker draft={draft} onPick={setDraft} locale={locale} />;
    }

    return (
      <View className="flex-1 items-center pt-2">
        <DateTimePicker
          value={draft}
          mode="date"
          display="inline"
          locale={locale}
          onChange={(_event, selected) => {
            if (selected) setDraft(selected);
          }}
        />
      </View>
    );
  },
);

function AndroidDayPicker({
  draft,
  onPick,
  locale,
}: {
  draft: Date;
  onPick: (day: Date) => void;
  locale: string;
}) {
  const { t } = useT("issues");
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const openedOnce = useRef(false);

  const openDialog = useCallback(() => {
    DateTimePickerAndroid.open({
      value: draftRef.current,
      mode: "date",
      onChange: (event: DateTimePickerEvent, selected?: Date) => {
        // "dismissed" (CANCEL / Back) leaves the draft alone; the sheet
        // behind the dialog keeps showing the current day.
        if (event.type === "set" && selected) onPick(selected);
      },
    });
  }, [onPick]);

  // Open the system dialog once when the sheet appears so the flow stays
  // chip → dialog; after a dismiss the user reopens it from the button.
  useEffect(() => {
    if (openedOnce.current) return;
    openedOnce.current = true;
    const timer = setTimeout(openDialog, 150);
    return () => clearTimeout(timer);
  }, [openDialog]);

  return (
    <View className="px-4 pt-2 gap-3">
      <Text
        className="text-base text-foreground"
        accessibilityLiveRegion="polite"
        testID="due-date-draft"
      >
        {formatDueDay(draft, locale)}
      </Text>
      <Pressable
        onPress={openDialog}
        accessibilityRole="button"
        accessibilityLabel={t("picker.pick_date")}
        className="flex-row items-center justify-center gap-2 min-h-12 rounded-lg border border-border bg-secondary active:opacity-80"
      >
        <Ionicons name="calendar-outline" size={18} color={theme.foreground} />
        <Text className="text-sm font-medium text-foreground">
          {t("picker.pick_date")}
        </Text>
      </Pressable>
      <Text className="text-xs text-muted-foreground">
        {t("picker.pick_date_hint")}
      </Text>
    </View>
  );
}
