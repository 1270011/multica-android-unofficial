/**
 * Normalise the `details` object of an inbox item.
 *
 * The server stores `details` as raw JSON that different code paths build
 * from Go `map[string]any` values — not every value is a string:
 *   - `children_done` carries `total` / `stage` as numbers
 *     (server/internal/service/issue_wakeup_system.go, childDoneFacts)
 *   - delegated-failure exhaustion carries `max_attempts` as a number
 *     (server/internal/service/task.go)
 *   - quick-create failures carry `source_context_id`, which may be `null`
 *
 * The client type is `Record<string, string> | null`, and every consumer
 * (`details.comment_id`, `details.limit`, `details.identifier`, …) reads
 * strings. A strict `z.record(z.string(), z.string())` therefore rejected
 * such rows — and because the list is validated as a whole, ONE such row
 * made `GET /api/inbox` fall back to the empty list: the inbox looked empty
 * although the web client showed every notification.
 *
 * Rules: strings pass through; numbers / booleans / bigints become their
 * string form; `null` / `undefined` are dropped; nested objects and arrays
 * are JSON-encoded so nothing is silently lost.
 */
export function normalizeInboxDetails(
  input: unknown,
): Record<string, string> | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (value === null || value === undefined) continue;
    switch (typeof value) {
      case "string":
        out[key] = value;
        break;
      case "number":
      case "boolean":
      case "bigint":
        out[key] = String(value);
        break;
      case "object":
        try {
          out[key] = JSON.stringify(value);
        } catch {
          // Circular or otherwise unserialisable — drop the key, keep the row.
        }
        break;
      default:
        // functions / symbols cannot come out of JSON.parse; ignore.
        break;
    }
  }
  return out;
}
