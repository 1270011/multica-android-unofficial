// @vitest-environment node
import i18next from "i18next";
import { describe, expect, it, vi } from "vitest";

import commonDe from "../locales/de/common.json";
import commonEn from "../locales/en/common.json";
import commonZh from "../locales/zh-Hans/common.json";
import issuesDe from "../locales/de/issues.json";
import issuesEn from "../locales/en/issues.json";
import issuesZh from "../locales/zh-Hans/issues.json";
import { batchDeleteDialog, confirmBatchDelete, type AlertFn } from "./issue-batch";

async function translator(lng: string) {
  const i18n = i18next.createInstance();
  await i18n.init({
    lng,
    resources: {
      de: { common: commonDe, issues: issuesDe },
      en: { common: commonEn, issues: issuesEn },
      "zh-Hans": { common: commonZh, issues: issuesZh },
    },
    interpolation: { escapeValue: false },
  });
  return (key: string, params?: Record<string, unknown>) => i18n.t(key, params);
}

describe("batchDeleteDialog", () => {
  it("uses the wording of spec §3 (de)", async () => {
    const t = await translator("de");
    expect(batchDeleteDialog(t, 3)).toEqual({
      title: "3 Issues löschen?",
      message:
        "Das lässt sich nicht rückgängig machen. Laufende Agent-Läufe werden abgebrochen.",
      cancel: "Abbrechen",
      confirm: "Löschen",
    });
    expect(batchDeleteDialog(t, 1).title).toBe("1 Issue löschen?");
  });

  it("is translated in en and zh-Hans", async () => {
    const en = batchDeleteDialog(await translator("en"), 2);
    expect(en).toEqual({
      title: "Delete 2 issues?",
      message: "This can't be undone. Running agent tasks will be cancelled.",
      cancel: "Cancel",
      confirm: "Delete",
    });
    const zh = batchDeleteDialog(await translator("zh-Hans"), 2);
    expect(zh.title).toBe("删除 2 个事项？");
    expect(zh.confirm).toBe("删除");
  });
});

describe("confirmBatchDelete", () => {
  const t = (key: string, params?: Record<string, unknown>) =>
    `${key}${params?.count !== undefined ? `:${params.count}` : ""}`;
  const buttonsOf = (alert: ReturnType<typeof vi.fn>) =>
    alert.mock.calls[0]![2] as Parameters<AlertFn>[2];

  it("asks first; cancel changes nothing", () => {
    const alert = vi.fn();
    const onConfirm = vi.fn();
    confirmBatchDelete(alert, t, ["a", "b"], onConfirm);

    expect(alert).toHaveBeenCalledWith(
      "issues:selection.delete_title:2",
      "issues:selection.delete_message:2",
      expect.any(Array),
    );
    const [cancel] = buttonsOf(alert);
    expect(cancel).toMatchObject({ text: "common:actions.cancel", style: "cancel" });
    cancel!.onPress?.();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("deletes the ids chosen when the dialog opened", () => {
    const alert = vi.fn();
    const onConfirm = vi.fn();
    const ids = ["a", "b"];
    confirmBatchDelete(alert, t, ids, onConfirm);
    ids.push("c");

    const [, confirm] = buttonsOf(alert);
    expect(confirm).toMatchObject({ text: "common:actions.delete", style: "destructive" });
    confirm!.onPress?.();
    expect(onConfirm).toHaveBeenCalledWith(["a", "b"]);
  });

  it("shows no dialog without a selection", () => {
    const alert = vi.fn();
    confirmBatchDelete(alert, t, [], vi.fn());
    expect(alert).not.toHaveBeenCalled();
  });
});
