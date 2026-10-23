/**
 * Expo config plugin: ship an app baseline profile.
 *
 * `androidx.profileinstaller` is in the APK and writes assets/dexopt/
 * baseline.prof on first start, but the profile AGP merged from the
 * libraries covered only androidx (fragment/appcompat). React Native, Expo
 * modules and kotlin-reflect — most of the cold-start work on the JS thread
 * — were not in it, so compiling with the profile changed little for them.
 * AGP picks up `app/src/main/baseline-prof.txt` of the app module and
 * merges it with the library profiles (task mergeReleaseArtProfile).
 *
 * The rules live in plugins/baseline-prof.txt, so a change re-triggers
 * prebuild (scripts/prebuild-stamp.sh hashes plugins/).
 *
 * Sideloaded APKs (users install the APK, no Play Store): assets/dexopt/
 * is only read by ProfileInstaller on first start, and ART compiles that
 * profile at the next idle maintenance (charging + idle, often overnight).
 * Until then the app runs as `verify`, cold start ~2x slower.
 * ART Service (Android 15+, checked on API 36) also reads an embedded
 * profile at install time from `assets/art-profile/baseline.prof`, but
 * only in ART's own binary format, not the ProfileInstaller encoding in
 * assets/dexopt/ ("wrong format", EXTENDED_BAD_EXTERNAL_PROFILE). AGP
 * already writes that format into the dex metadata (.dm) of
 * compileReleaseArtProfile; the Gradle block below copies its
 * primary.prof (version 015, Android 12+) into the release assets, so a
 * fresh `adb install` / package-installer install is `speed-profile`
 * right away.
 */
const fs = require("fs");
const path = require("path");
const { withAppBuildGradle, withDangerousMod } = require("expo/config-plugins");

const SOURCE = require.resolve("./baseline-prof.txt");
const TARGET = "app/src/main/baseline-prof.txt";

function writeBaselineProfile(platformProjectRoot) {
  const target = path.join(platformProjectRoot, TARGET);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(SOURCE, target);
  return target;
}

const GRADLE_MARKER = "// rb-embedded-art-profile";

const GRADLE_BLOCK = `
${GRADLE_MARKER}: ship ART's install-time profile, see plugins/with-baseline-profile.js.
abstract class RbEmbedArtProfileTask extends DefaultTask {
    @InputDirectory abstract DirectoryProperty getDmDir()
    @OutputDirectory abstract DirectoryProperty getOutputDir()

    @TaskAction
    void run() {
        // ART binary profile header: "pro\\0" + version "015\\0" (Android 12+).
        byte[] want = [0x70, 0x72, 0x6f, 0, 0x30, 0x31, 0x35, 0] as byte[]
        byte[] prof = null
        dmDir.get().asFileTree.matching { include "**/*.dm" }.each { File dm ->
            new java.util.zip.ZipFile(dm).withCloseable { z ->
                def e = z.getEntry("primary.prof")
                def bytes = e ? z.getInputStream(e).bytes : null
                if (bytes != null && bytes.length > want.length && Arrays.equals(Arrays.copyOf(bytes, want.length), want)) prof = bytes
            }
        }
        if (prof == null) throw new GradleException("baseline profile: no ART profile (015) in " + dmDir.get())
        def out = outputDir.get().dir("art-profile").asFile
        out.mkdirs()
        new File(out, "baseline.prof").bytes = prof
    }
}

androidComponents {
    onVariants(selector().withBuildType("release")) { variant ->
        def cap = variant.name.capitalize()
        def embed = tasks.register("rbEmbedArtProfile\${cap}", RbEmbedArtProfileTask) {
            dependsOn("compile\${cap}ArtProfile")
            dmDir.set(layout.buildDirectory.dir("intermediates/dex_metadata_directory/\${variant.name}/compile\${cap}ArtProfile"))
        }
        variant.sources.assets.addGeneratedSourceDirectory(embed, { it.outputDir } as kotlin.jvm.functions.Function1)
    }
}
`;

function addEmbedBlock(contents) {
  return contents.includes(GRADLE_MARKER) ? contents : contents + GRADLE_BLOCK;
}

function withBaselineProfile(config) {
  config = withAppBuildGradle(config, (c) => {
    c.modResults.contents = addEmbedBlock(c.modResults.contents);
    return c;
  });
  return withDangerousMod(config, [
    "android",
    async (c) => {
      writeBaselineProfile(c.modRequest.platformProjectRoot);
      return c;
    },
  ]);
}

module.exports = withBaselineProfile;
module.exports.writeBaselineProfile = writeBaselineProfile;
module.exports.SOURCE = SOURCE;
module.exports.TARGET = TARGET;
module.exports.addEmbedBlock = addEmbedBlock;
module.exports.GRADLE_MARKER = GRADLE_MARKER;
