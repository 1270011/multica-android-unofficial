/**
 * Time and day labels for the issue chat. Locale follows the in-app language
 * (i18n singleton), like `getInboxDisplayTitle`'s date formatting.
 */
import { i18n } from "@/lib/i18n/singleton";
import { localDayKey } from "@/lib/issue-chat";

function locale(): string {
  return i18n.resolvedLanguage ?? i18n.language ?? "en";
}

export function formatChatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale(), { timeStyle: "short" }).format(d);
}

/** "Today" / "Yesterday" / medium date for a `localDayKey` value. */
export function formatChatDay(day: string, now: Date = new Date()): string {
  const today = localDayKey(now.toISOString());
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (day === today) return i18n.t("issues:chat.today");
  if (day === localDayKey(y.toISOString())) return i18n.t("issues:chat.yesterday");
  const [yy, mm, dd] = day.split("-").map(Number);
  if (!yy || !mm || !dd) return day;
  return new Intl.DateTimeFormat(locale(), { dateStyle: "medium" }).format(
    new Date(yy, mm - 1, dd),
  );
}
