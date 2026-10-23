// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  boardMoveNeighbours,
  defaultSortDirection,
  ISSUE_SORT_FIELDS,
  isSortBadRequest,
  MANUAL_SORT,
  parseStoredSort,
  serializeSort,
  sortForField,
  sortParams,
  withSortDirection,
} from "./issue-list-sort";

describe("issue list sort", () => {
  it("offers the web fields in web order", () => {
    expect(ISSUE_SORT_FIELDS).toEqual([
      "position", "status", "priority", "start_date", "due_date", "created_at", "updated_at", "title",
    ]);
  });

  it("uses web's default directions: created/updated descending, the rest ascending", () => {
    expect(defaultSortDirection("created_at")).toBe("desc");
    expect(defaultSortDirection("updated_at")).toBe("desc");
    expect(defaultSortDirection("priority")).toBe("asc");
    expect(sortForField("updated_at")).toEqual({ field: "updated_at", direction: "desc" });
    expect(sortForField("position")).toBe(MANUAL_SORT);
  });

  it("has no direction for Manual", () => {
    expect(withSortDirection(MANUAL_SORT, "desc")).toBe(MANUAL_SORT);
    expect(withSortDirection(sortForField("title"), "desc")).toEqual({ field: "title", direction: "desc" });
  });

  it("round-trips through storage; Manual stores nothing", () => {
    const sort = { field: "priority", direction: "desc" } as const;
    expect(parseStoredSort(serializeSort(sort))).toEqual(sort);
    expect(serializeSort(MANUAL_SORT)).toBeNull();
  });

  it("falls back to Manual for old, unknown or broken stored values", () => {
    expect(parseStoredSort(null)).toBe(MANUAL_SORT);
    expect(parseStoredSort("not json")).toBe(MANUAL_SORT);
    expect(parseStoredSort("[]")).toBe(MANUAL_SORT);
    expect(parseStoredSort('{"field":"last_activity","direction":"desc"}')).toBe(MANUAL_SORT);
    expect(parseStoredSort('{"field":"property:abc"}')).toBe(MANUAL_SORT);
    expect(parseStoredSort('"priority"')).toBe(MANUAL_SORT);
    // An unknown direction takes the field's default.
    expect(parseStoredSort('{"field":"created_at","direction":"up"}')).toEqual({
      field: "created_at",
      direction: "desc",
    });
  });

  it("sends nothing for Manual, so the default query key stays as before", () => {
    expect(sortParams(MANUAL_SORT)).toEqual({});
    expect(sortParams({ field: "due_date", direction: "asc" })).toEqual({
      sort_by: "due_date",
      sort_direction: "asc",
    });
  });

  it("recognises the server's sort errors", () => {
    expect(isSortBadRequest("invalid sort value")).toBe(true);
    expect(isSortBadRequest("400 invalid direction value")).toBe(true);
    expect(isSortBadRequest("invalid assignee_types")).toBe(false);
  });

  it("board: neighbour ids only with Manual", () => {
    const neighbours = { before_id: "a", after_id: "b" };
    expect(boardMoveNeighbours(MANUAL_SORT, neighbours)).toEqual(neighbours);
    for (const field of ISSUE_SORT_FIELDS.filter((f) => f !== "position")) {
      expect(boardMoveNeighbours(sortForField(field), neighbours)).toEqual({
        before_id: null,
        after_id: null,
      });
    }
  });
});
