// @vitest-environment node
/**
 * 200 % font regressions from the smoke tests. Layout is
 * not unit-testable without a renderer, so these pin the source: the
 * issue key column never has a fixed width again, and the modal ✕ keeps
 * its gap to the Android title.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MODAL_CLOSE_TITLE_GAP_DP } from "./header-scale";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("issue key in list rows", () => {
  it("is one line with a minimum, not a fixed, width", () => {
    const src = read("components/issue/issue-identifier.tsx");
    expect(src).toContain("numberOfLines={1}");
    expect(src).toMatch(/min-w-16/);
    expect(src).not.toMatch(/[\s"]w-16/);
  });
  it.each(["components/issue/issue-row.tsx", "app/(app)/[workspace]/search.tsx"])(
    "%s uses IssueIdentifier",
    (path) => {
      const src = read(path);
      expect(src).toContain("<IssueIdentifier");
      expect(src).not.toMatch(/shrink-0 w-16/);
    },
  );
});

describe("modal ✕ next to the title", () => {
  it("keeps a gap", () => {
    expect(MODAL_CLOSE_TITLE_GAP_DP).toBeGreaterThanOrEqual(8);
    expect(read("components/ui/modal-close-button.tsx")).toContain("marginRight: MODAL_CLOSE_TITLE_GAP_DP");
  });
  it.each([
    "app/(app)/[workspace]/issue/[id]/edit.tsx",
    "app/(app)/[workspace]/project/new.tsx",
    "app/(app)/[workspace]/project/[id]/edit.tsx",
  ])("Cancel in %s keeps the same gap (J3b)", (path) => {
    expect(read(path)).toContain("marginRight: MODAL_CLOSE_TITLE_GAP_DP");
  });
});
