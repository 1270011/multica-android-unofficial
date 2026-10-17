/**
 * Custom issue properties in the issue detail.
 * Pure helpers mirroring web's custom-property-picker.tsx and
 * issue-property-pills.tsx; value shapes are the server's:
 *
 *   text / url     string            number   number
 *   date           "YYYY-MM-DD"      checkbox boolean
 *   select         option id         multi_select  option id[]
 *   actor          "member:<user_id>"  multi_actor  such refs[] (max 20)
 *
 * `undefined` means "no value" (the write is a DELETE).
 */
import {
  MAX_ISSUE_PROPERTY_ACTOR_VALUES,
  actorRefValuesFromValue,
  formatActorRef,
  hasUnknownActorRef,
  parseActorRef,
  type IssueProperty,
  type IssuePropertyValue,
  type IssuePropertyValues,
} from "@multica/core/types";

export const EDITABLE_PROPERTY_TYPES = [
  "text",
  "number",
  "select",
  "multi_select",
  "date",
  "checkbox",
  "url",
  "actor",
  "multi_actor",
] as const;

/**
 * Rows for the detail: active properties by position, plus archived ones
 * that still carry a value on this issue (shown read-only, web parity).
 */
export function visibleProperties(
  properties: readonly IssueProperty[],
  values: IssuePropertyValues | undefined,
): IssueProperty[] {
  return properties
    .filter((p) => !p.archived || values?.[p.id] !== undefined)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}

/** Same three reasons as web's isCustomPropertyReadOnly. Clearing stays possible. */
export function isPropertyReadOnly(property: IssueProperty, value: IssuePropertyValue | undefined): boolean {
  if (property.archived) return true;
  if (!(EDITABLE_PROPERTY_TYPES as readonly string[]).includes(property.type)) return true;
  if (property.type === "actor" && hasUnknownActorRef(value)) return true;
  return false;
}

export interface FormatContext {
  yes: string;
  no: string;
  /** Display name of a member user id; unknown ids fall back to a short id. */
  memberName: (userId: string) => string | undefined;
}

/** One-line display of a value, or null when empty. */
export function formatPropertyValue(
  property: IssueProperty,
  value: IssuePropertyValue | undefined,
  ctx: FormatContext,
): string | null {
  if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) return null;
  const options = property.config?.options ?? [];
  const optionName = (id: string) => options.find((o) => o.id === id)?.name ?? id;
  switch (property.type) {
    case "select":
      return typeof value === "string" ? optionName(value) : null;
    case "multi_select":
      return Array.isArray(value) ? value.map(optionName).join(", ") : null;
    case "checkbox":
      return value === true ? ctx.yes : value === false ? ctx.no : null;
    case "actor":
    case "multi_actor": {
      const names = actorRefValuesFromValue(value).map((raw) => {
        const ref = parseActorRef(raw);
        if (!ref) return raw;
        return ctx.memberName(ref.id) ?? ref.id.slice(0, 8);
      });
      return names.length ? names.join(", ") : null;
    }
    default:
      return Array.isArray(value) ? value.join(", ") : String(value);
  }
}

export type ScalarInput =
  | { kind: "set"; value: string | number }
  | { kind: "clear" }
  | { kind: "invalid"; reason: "number" | "url" | "length" };

/** Longest text value (characters), as the server's maxTextValueLen. */
export const MAX_PROPERTY_TEXT = 2000;
/** Longest url value (UTF-8 bytes), as the server's maxURLValueLen. */
export const MAX_PROPERTY_URL_BYTES = 2048;

function utf8Length(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/**
 * The server's url rule (issueproperty/value.go): Go `url.Parse`, scheme
 * http or https, non-empty host. No stricter than that: a dotless
 * intranet host like `http://intranet/` is fine, and so is a space in the
 * path; Go only rejects control characters and spaces in the host.
 */
export function isPropertyUrl(text: string): boolean {
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(text)) return false;
  const m = /^(https?):\/\/([^/?#]*)/i.exec(text);
  if (!m) return false;
  const authority = m[2];
  const host = authority.slice(authority.lastIndexOf("@") + 1);
  return host.length > 0 && !/\s/.test(authority);
}

/**
 * Text / number / url input → write. Empty clears; a non-number, a URL
 * the server would reject, or text over the server limits is rejected
 * before the write, so the input stays in the sheet.
 */
export function parseScalarInput(type: string, raw: string): ScalarInput {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: "clear" };
  if (type === "number") {
    const n = Number(trimmed.replace(",", "."));
    return Number.isFinite(n) ? { kind: "set", value: n } : { kind: "invalid", reason: "number" };
  }
  if (type === "url") {
    if (utf8Length(trimmed) > MAX_PROPERTY_URL_BYTES) return { kind: "invalid", reason: "length" };
    if (!isPropertyUrl(trimmed)) return { kind: "invalid", reason: "url" };
    return { kind: "set", value: trimmed };
  }
  if ([...trimmed].length > MAX_PROPERTY_TEXT) return { kind: "invalid", reason: "length" };
  return { kind: "set", value: trimmed };
}

/** multi_select toggle; `undefined` when nothing is left (→ DELETE). */
export function toggleOption(value: IssuePropertyValue | undefined, optionId: string): string[] | undefined {
  const current = Array.isArray(value) ? value : [];
  const next = current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId];
  return next.length ? next : undefined;
}

export function memberRef(userId: string): string {
  return formatActorRef("member", userId);
}

/**
 * multi_actor toggle (web's toggleActorRef): unknown entries round-trip,
 * at most MAX_ISSUE_PROPERTY_ACTOR_VALUES refs; `undefined` when empty.
 */
export function toggleActor(value: IssuePropertyValue | undefined, userId: string): string[] | undefined {
  const current = actorRefValuesFromValue(value);
  const ref = memberRef(userId);
  let next: string[];
  if (current.includes(ref)) next = current.filter((r) => r !== ref);
  else if (current.length >= MAX_ISSUE_PROPERTY_ACTOR_VALUES) next = current;
  else next = [...current, ref];
  return next.length ? next : undefined;
}

/** Selected member user ids of an actor value. */
export function selectedMemberIds(value: IssuePropertyValue | undefined): string[] {
  return actorRefValuesFromValue(value)
    .map(parseActorRef)
    .filter((r): r is NonNullable<typeof r> => r !== null && r.kind === "member")
    .map((r) => r.id);
}

/**
 * Runs writes one after another in call order, also after a failure, so
 * the server sees rapid multi-select/multi-actor toggles in the order the
 * user made them (each PUT carries the whole list).
 */
export function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  };
}

/**
 * Value a toggle list shows and builds on. While own writes are in flight
 * the local value wins: a response or refetch for an earlier toggle must
 * not reset the mirror, or the next toggle would drop a selection.
 * With nothing pending the cache wins again, also after a rollback.
 */
export function toggleMirror<T>(local: T, cache: T, pending: number): T {
  return pending > 0 ? local : cache;
}

/**
 * Latest toggle value between renders: two taps before the
 * next render must build on each other, not both on the rendered value.
 * `sync` takes the rendered value, `apply` folds a tap into the latest one.
 */
export function createToggleChain<T>(initial: T) {
  let latest = initial;
  return {
    sync(value: T) {
      latest = value;
    },
    apply(update: (prev: T) => T): T {
      latest = update(latest);
      return latest;
    },
  };
}
