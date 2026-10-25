import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { issueKeys } from "./issue-keys";
import { loadedIssueTitles } from "./loaded-issue-titles";

describe("loadedIssueTitles", () => {
  it("collects titles of all cached My Issues tabs, unique by id", () => {
    const client = new QueryClient();
    client.setQueryData([...issueKeys.myAll("ws1"), "all", {}], [
      { id: "1", title: "AUTO: a" },
      { id: "2", title: "Feature" },
    ]);
    client.setQueryData([...issueKeys.myAll("ws1"), "assigned", { assignee_id: "me" }], [
      { id: "2", title: "Feature" },
      { id: "3", title: "AUTO: b" },
      { id: 4, title: "bad" },
    ]);
    // Other workspace, detail entries and non-list data are ignored.
    client.setQueryData([...issueKeys.myAll("ws2"), "all", {}], [{ id: "9", title: "other" }]);
    client.setQueryData(issueKeys.detail("ws1", "1"), { id: "1", title: "AUTO: a" });
    client.setQueryData([...issueKeys.myAll("ws1"), "meta"], { total: 3 });

    expect(loadedIssueTitles(client, "ws1").sort()).toEqual(["AUTO: a", "AUTO: b", "Feature"]);
    expect(loadedIssueTitles(client, null)).toEqual([]);
    expect(loadedIssueTitles(new QueryClient(), "ws1")).toEqual([]);
  });
});
