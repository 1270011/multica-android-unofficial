# Known issues – v2.0.0

The points below are known in v2.0.0. Most testing ran on emulators against one server version, so rough edges are still possible. If you hit something that is not listed, please [open an issue](../../issues).

## Open issues

### App behaviour

- **Offline indicator is unreliable.** The offline bar and the connection state are not always accurate and can lag behind or differ from the real network state. Pull to refresh if the content looks stale. Comments written offline are still kept and sent later. (Improved in v2.0.0: lists show an offline state instead of an empty list.)
- **"Paste" button can be hidden by the keyboard.** On some screens and screen sizes the paste button next to an input field ends up under the on-screen keyboard. Close the keyboard to reach it, or paste with a long press into the field.
- **"Unknown Agent" in the issue chat.** In the issue chat view, the author of some messages is shown as "Unknown Agent" instead of the agent's name. The classic activity view shows the correct author.
- **Placeholder in "Local / VPN" mode.** The server URL field in "Local / VPN" mode shows the placeholder `https://multica.example.lan`. It is only an example; enter your real server URL (any `https://` address works).

### Platform and distribution

- **ARM only.** The release APK contains native libraries for `arm64-v8a` and `armeabi-v7a` only. It does not run on x86 / x86_64 devices or on x86 emulators. For an x86_64 emulator, build a debug APK from source.
- **APK signature scheme v2 only.** The APK is signed with APK Signature Scheme v2, not v3. This is fully sufficient for Android 7.0+ (minSdk 24); it only means that key rotation via v3 is not available.
- **Sign-in by e-mail code only.** Release builds sign in with the e-mail code, as in the web app. There is no sign-in with a personal access token in release builds (that screen exists only in debug builds for automated tests).
- **Tested against one server version.** Development and testing used a self-hosted Multica server v0.6.1. Newer server versions and Multica Cloud have not been tested.
- **Tablet layout mostly tested on emulators.** The navigation rail and the two-column issue view were tested mainly on emulators; behaviour on specific real tablets may differ.
- **Limited real-device testing.** Most testing ran on Android emulators; behaviour on specific vendor ROMs (battery optimisation, notification handling) may differ. If notifications stop in the background, exclude the app from battery optimisation.

## Fixed in v2.0.0

- **Inbox jump / scroll position.** Opening an issue from the inbox now lands on the triggering comment.

## Next

No dates yet. Planned:

- **Settings and management closer to the web app.**
- **Fixes for the issues above.**
- **More end-to-end tests** on emulators and real devices, so that regressions are caught before a release.

Changes per release are listed in [CHANGELOG.md](CHANGELOG.md).
