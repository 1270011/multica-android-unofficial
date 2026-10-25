/**
 * Text TalkBack reads for a message body (§3). Every
 * top-level table becomes `tableToSpeech` instead of raw `| a | b |` / `---`
 * markdown. Prose loses its heading, bold and italic markup, so TalkBack
 * reads "Stand …", not "## Stand …".
 */
import { getMarkdownSegments } from "./segment-cache";
import { GERMAN_TABLE_SPEECH, tableToSpeech, type TableSpeechWords } from "./table-model";

/** `# Title` / `## Title ##` → `Title`. */
const HEADING = /^ {0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/gm;
/** `**x**`, `__x__` → `x`; underscores only around whole words (snake_case stays). */
const BOLD = /\*\*(?=\S)(.+?)(?<=\S)\*\*|(?<![\w_])__(?=\S)(.+?)(?<=\S)__(?![\w_])/g;
/** `*x*`, `_x_` → `x`; a lone `*` (5 * 3) or `file_name` stays. */
const ITALIC = /(?<![*\w])\*(?=[^\s*])([^*\n]+?)(?<=[^\s*])\*(?![*\w])|(?<![\w_])_(?=[^\s_])([^_\n]+?)(?<=[^\s_])_(?![\w_])/g;

/** Heading, bold and italic markup removed from a prose segment. */
export function proseToSpeech(text: string): string {
  return text
    .replace(HEADING, "$1")
    .replace(BOLD, (_m, a?: string, b?: string) => a ?? b ?? "")
    .replace(ITALIC, (_m, a?: string, b?: string) => a ?? b ?? "");
}

export function markdownToSpeech(
  content: string,
  words: TableSpeechWords = GERMAN_TABLE_SPEECH,
): string {
  const segments = getMarkdownSegments(content);
  if (!segments.some((s) => s.type === "table")) return proseToSpeech(content);
  return segments
    .map((seg) => {
      switch (seg.type) {
        case "prose":
          return proseToSpeech(seg.content);
        case "code":
          return seg.code;
        case "table":
          return tableToSpeech(seg.table, words);
        case "image":
          return seg.alt;
      }
    })
    .filter(Boolean)
    .join("\n");
}
