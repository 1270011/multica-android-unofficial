import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { writeBaselineProfile, addEmbedBlock, GRADLE_MARKER, SOURCE, TARGET } =
  require("../plugins/with-baseline-profile.js") as {
    writeBaselineProfile: (platformProjectRoot: string) => string;
    addEmbedBlock: (contents: string) => string;
    GRADLE_MARKER: string;
    SOURCE: string;
    TARGET: string;
  };

const rules = fs
  .readFileSync(SOURCE, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));

describe("baseline profile plugin", () => {
  it("copies the profile to the app module, where AGP merges it", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rb-prof-"));
    try {
      const out = writeBaselineProfile(root);
      expect(out).toBe(path.join(root, "app/src/main/baseline-prof.txt"));
      expect(TARGET).toBe("app/src/main/baseline-prof.txt");
      expect(fs.readFileSync(out, "utf8")).toBe(fs.readFileSync(SOURCE, "utf8"));
      // Idempotent: android/ is kept between prebuilds.
      writeBaselineProfile(root);
      expect(fs.readFileSync(out, "utf8")).toBe(fs.readFileSync(SOURCE, "utf8"));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("covers the cold-start paths from the measured profile", () => {
    for (const pkg of ["com/facebook/react", "com/facebook/hermes", "expo/modules", "kotlin"]) {
      expect(rules).toContain(`L${pkg}/**;`);
      expect(rules).toContain(`HSPL${pkg}/**->**(**)**`);
    }
  });

  it("only holds well-formed profgen rules", () => {
    for (const rule of rules) {
      expect(rule).toMatch(/^(L[\w/$*]+;|H?S?P?L[\w/$*]+;?->\*\*\(\*\*\)\*\*)$/);
    }
  });
});

describe("embedded ART profile (install-time speed-profile)", () => {
  const gradle = "android {\n}\n";

  it("adds the embed task for release variants only", () => {
    const out = addEmbedBlock(gradle);
    expect(out.startsWith(gradle)).toBe(true);
    expect(out).toContain(GRADLE_MARKER);
    expect(out).toContain('selector().withBuildType("release")');
    expect(out).toContain('dependsOn("compile${cap}ArtProfile")');
    expect(out).toContain("variant.sources.assets.addGeneratedSourceDirectory(embed");
    // ART Service reads exactly this asset at install time.
    expect(out).toContain('dir("art-profile")');
    expect(out).toContain('"baseline.prof"');
  });

  it("selects ART's own profile format (version 015), not the ProfileInstaller one", () => {
    const out = addEmbedBlock(gradle);
    expect(out).toContain("[0x70, 0x72, 0x6f, 0, 0x30, 0x31, 0x35, 0] as byte[]");
    expect(out).toContain("throw new GradleException");
  });

  it("is idempotent across repeated prebuilds", () => {
    const once = addEmbedBlock(gradle);
    expect(addEmbedBlock(once)).toBe(once);
    expect(once.split(GRADLE_MARKER)).toHaveLength(2);
  });
});
