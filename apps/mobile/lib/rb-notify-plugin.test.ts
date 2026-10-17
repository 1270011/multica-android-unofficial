import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { applyBackupRules, BACKUP, EXTRACTION } = require("../plugins/with-rb-notify.js") as {
  applyBackupRules: (m: unknown) => { manifest: { application: { $: Record<string, string> }[] } };
  BACKUP: string;
  EXTRACTION: string;
};

describe("with-rb-notify backup rules", () => {
  it("points both Auto Backup attributes at the module's rules, also over expo-secure-store's", () => {
    const manifest = {
      manifest: {
        $: {},
        application: [
          {
            $: {
              "android:name": ".MainApplication",
              "android:fullBackupContent": "@xml/secure_store_backup_rules",
              "android:dataExtractionRules": "@xml/secure_store_data_extraction_rules",
            },
          },
        ],
      },
    };
    const out = applyBackupRules(manifest);
    const app = out.manifest.application[0]!.$;
    expect(app["android:fullBackupContent"]).toBe(BACKUP);
    expect(app["android:dataExtractionRules"]).toBe(EXTRACTION);
  });

  it("keeps the SecureStore exclusion and excludes the notification prefs", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = path.resolve(__dirname, "../modules/rb-notify/android/src/main/res/xml");
    for (const file of ["rb_notify_backup_rules.xml", "rb_notify_data_extraction_rules.xml"]) {
      const xml = fs.readFileSync(path.join(dir, file), "utf8");
      expect(xml).toContain('exclude domain="sharedpref" path="SecureStore"');
      expect(xml).toContain('exclude domain="sharedpref" path="rb_notify.xml"');
    }
    const extraction = fs.readFileSync(path.join(dir, "rb_notify_data_extraction_rules.xml"), "utf8");
    // Cloud backup AND device transfer.
    expect(extraction.match(/rb_notify\.xml/g)).toHaveLength(2);
  });
});
