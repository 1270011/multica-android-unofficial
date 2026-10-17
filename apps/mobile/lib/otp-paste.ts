/**
 * "Paste" for the e-mail code: the code from the clipboard,
 * without focusing the field. Like the server-setup paste buttons the
 * text is trimmed and only digits are taken over.
 *
 * Accepted: exactly `length` digits as one block or as two halves
 * ("123 456", "123-456"),
 * on their own or inside a short text such as the e-mail line "Your code is
 * 123456". Several separate codes or a longer number are ambiguous → null,
 * so the field never fills with a wrong code.
 */
export function extractOtpCode(raw: string | null | undefined, length = 6): string | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  // Digit runs, allowing single spaces/dashes between digits.
  const runs = text.match(/\d(?:[  -]?\d)*/g) ?? [];
  // Only a solid block or two equal halves ("123 456"); "2026 10" from a
  // date is not a code.
  const half = length / 2;
  const grouped = Number.isInteger(half)
    ? new RegExp(`^\\d{${half}}[ \\u00a0-]\\d{${half}}$`)
    : null;
  const codes = runs
    .filter((run) => new RegExp(`^\\d{${length}}$`).test(run) || !!grouped?.test(run))
    .map((run) => run.replace(/\D/g, ""));
  const unique = [...new Set(codes)];
  return unique.length === 1 ? unique[0]! : null;
}
