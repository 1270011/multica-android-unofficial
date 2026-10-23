/**
 * Cached `Intl.DateTimeFormat` instances.
 *
 * Building a formatter is expensive on Hermes/Android: every construction
 * resolves the locale through ICU over JNI. The chat built one per bubble
 * (time) and per day separator, the inbox and lists one per row — about 7 %
 * of the JS time when opening a long chat. Formatters are immutable, so one
 * instance per locale + options is kept for the app's lifetime; the set of
 * combinations is small and fixed (a handful of call sites × UI languages).
 *
 * `date.toLocaleDateString(locale, opts)` with at least one date field in
 * `opts` formats exactly like `new Intl.DateTimeFormat(locale, opts)` (no
 * defaults are added), so call sites can switch without changing output.
 */
const cache = new Map<string, Intl.DateTimeFormat>();

export function dateTimeFormat(
  locale: string | undefined,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${locale ?? ""}|${JSON.stringify(options)}`;
  let fmt = cache.get(key);
  if (!fmt) {
    // Throws for an invalid locale tag, like the uncached constructor did;
    // nothing is cached in that case.
    fmt = new Intl.DateTimeFormat(locale, options);
    cache.set(key, fmt);
  }
  return fmt;
}

/** Test hook: number of distinct formatters built so far. */
export function dateTimeFormatCacheSize(): number {
  return cache.size;
}
