# Unofficial Android app for Multica – AI agent task management on your phone

> **Unofficial.** This project is not affiliated with, endorsed by, or supported by Multica or Index Labs (Hong Kong) Limited. "Multica" and the Multica logo belong to their owners and are used here only as required by the [Multica License](LICENSE).

An Android client for [Multica](https://github.com/multica-ai/multica), the open-source platform where people and AI coding agents work on the same issues. The app is a fork of the official Expo / React Native mobile client (`apps/mobile`), which upstream ships for iOS only. This fork adds an Android build, Android-specific fixes, and mobile features for working with issues, agents and the inbox while you are away from your desk.

You need **your own Multica server** (self-hosted). The app has no backend of its own and contains no server address; you enter your server URL on first start.

<!-- Screenshots are added by the release tester. Keep file names stable. -->
| Inbox | Board | Issue | Issue chat | Agent chat |
| --- | --- | --- | --- | --- |
| ![Inbox](docs/screenshots/inbox.png) | ![Board](docs/screenshots/board.png) | ![Issue detail](docs/screenshots/issue-detail.png) | ![Issue chat](docs/screenshots/issue-chat.png) | ![Agent chat](docs/screenshots/agent-chat.png) |

## Features

**Inbox and notifications**
- Inbox with all notification types, live updates, unread and archive views, row and bulk actions.
- Filter by status, priority and sender; "Done" marks the issue done and archives its entries.
- Tapping an entry opens the issue chat or the issue detail depending on the type, and lands on the comment that triggered it.
- On-device notifications **without Firebase or Google Play Services**: an optional foreground service keeps one WebSocket connection to your server for all workspaces. Per-workspace switches, notification channels, mark-as-read from the notification. The service is off until you enable it.

**Issues**
- My Issues and All Issues with scopes, list grouped by status, and a **Kanban board** (status columns, status change with undo, drag and drop between columns in landscape and on tablets).
- Filters for status, priority, project, label and due date, remembered per list and workspace.
- Issue detail: title and description editing with conflict protection, status, priority, assignee, labels, project, start and due date, stage, parent, sub-issues grouped by stage with progress, mark as duplicate, custom properties.
- Comments with threads, reactions, resolve, edit and delete, mentions and attachments. Comments written offline are sent when the connection returns.
- **Issue chat**: a mobile-only, chat-style view of an issue's timeline next to the classic activity view.
- Subscribe/unsubscribe, subscriber list, agent runs with read-only transcripts (secrets redacted), cancel and re-run.
- Create issues, search issues and projects, pin issues and projects, copy link, open in web.

**Projects, agents and workspaces**
- Projects: list, detail, properties, resources, create, edit, delete, board and list of project issues.
- Agents and squads (read-only): status, runtime, recent runs, squad members and active issues.
- Workspace switcher, accept or decline workspace invitations.

**Chat with agents**
- Chat sessions with agent selection, attachments, mentions and stop.
- Rename, pin, archive, restore and delete sessions; archive view.
- Message queue while an agent is answering: send now (steer) or clear the queue.

**Android platform**
- Portrait and landscape, two-pane issue detail on tablets, usable at 200 % font size, TalkBack labels and 48 dp touch targets.
- Material bottom sheets instead of iOS action sheets, Android date picker, keyboard-aware screens.
- Returns to the open screen after Android recreates the activity (font or display size change).
- English, German and Simplified Chinese.

**Connecting and security**
- Server URL entered at runtime with a connection test; nothing server-specific is built into the APK.
- Optional **Cloudflare Access** service-token mode for servers behind Cloudflare Zero Trust (headers on REST, uploads, WebSocket and images of your own origin only).
- Direct / VPN mode; trusts CA certificates installed by the user on the device, so a private CA works without rebuilding the app.
- Secrets live in the Android Keystore (`expo-secure-store`), secret screens are protected against screenshots (`FLAG_SECURE`), the clipboard is cleared after pasting a secret, and logs redact tokens.
- No camera, microphone, storage or overlay permissions. Images use the system Photo Picker.

Not included on purpose: workspace administration, agent/skill/runtime/autopilot configuration, integrations, billing and analytics. Use the Multica web app for those.

## Requirements

- A self-hosted Multica server. The app was developed and tested against Multica **v0.6.1**; other server versions may work but are not tested.
- An Android phone or tablet. Development and CI testing use the Android 16 (API 36) emulator.

## Installation

Signed APKs will be published on the [Releases](../../releases) page. <!-- TODO: link once the first public release exists -->

1. Download `multica-unofficial-<version>.apk` and its `.sha256` from the release.
2. Check the checksum: `sha256sum -c multica-unofficial-<version>.apk.sha256`.
3. Allow installs from your browser or file manager when Android asks, then open the APK.

Updates install over the previous version as long as they are signed with the same key.

## Connecting to your server

1. On first start, choose the connection mode:
   - **Direct / VPN** – your server URL, e.g. `https://multica.example.com`.
   - **Cloudflare Access** – your server URL plus the client ID and secret of a Cloudflare Access *service token* (Zero Trust → Access → Service Auth → Service Tokens) that a *Service Auth* policy on your Access application allows.
2. Tap **Test connection**. The app calls `GET /health` and tells you whether the server answered, Access blocked the request, or the host is unreachable.
3. Sign in with your e-mail code as in the web app.

Using a private CA: install the CA certificate on the phone (Settings → Security → Encryption & credentials → Install a certificate → CA certificate). Plain HTTP is not allowed.

You can change or forget the server later under **Settings → Server connection**. Changing the server signs you out.

## Build from source

Requirements: Node.js 22, pnpm (version from `packageManager` in `package.json`, via `corepack enable`), JDK 17, Android SDK with platform 36, build-tools 36 and NDK 27.

```bash
git clone <this repository>
cd <repository>
pnpm install --frozen-lockfile

# Checks (the same as CI)
pnpm --filter @multica/mobile typecheck
pnpm --filter @multica/mobile lint
pnpm --filter @multica/mobile test

# Debug APK for the emulator (x86_64); use --archs arm64-v8a for a phone
export ANDROID_HOME=/path/to/android-sdk JAVA_HOME=/path/to/jdk-17
apps/mobile/scripts/android-build.sh debug
# -> apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

Notes:
- Always build through `scripts/android-build.sh`. It runs `expo prebuild` (the `android/` folder is generated, not committed), checks that the native patches in `patches/` were applied, and verifies them in the finished APK.
- Run `pnpm install --frozen-lockfile` again after every pull; the build stops if the patched native dependencies are out of date.
- A signed release build uses `apps/mobile/scripts/build-release.sh` with your own keystore: point `RB_SIGNING_ENV` at a private file with the `RB_RELEASE_*` values (see the script header) and put the SHA-256 of your signing certificate into `apps/mobile/release-signer.sha256`. Never commit a keystore or its passwords.

## Relationship to Multica

- Upstream project: <https://github.com/multica-ai/multica>
- This app is based on the upstream mobile client at tag **v0.6.1**. Changes are listed in [CHANGELOG.md](CHANGELOG.md).
- We want to offer generally useful changes back to upstream as small pull requests. Product decisions, support for the Multica server, and the official apps stay with the Multica team.
- Please report problems with this app here, not in the Multica repository.

## License

This project is distributed under the **Multica License**, the same license as the upstream code: the Apache License 2.0 together with additional conditions (Part I). The full text is in [LICENSE](LICENSE).

In particular:
- The Multica logo, the Multica product name and the copyright and attribution information shown in the user interface are kept **unchanged**, as condition 1(b) requires. "Unofficial" in this README and the repository name only describes the project; the app itself still shows Multica's name, logo and attribution.
- The license does not allow operating a Multica-based hosted service for third parties without a commercial license from Index Labs. This app is a client; each server operator is responsible for their own license.
- **Modification notice** (Apache 2.0, section 4(b)): the files in this repository have been modified from the upstream Multica source. Changed and added files are listed in [MODIFICATIONS.md](MODIFICATIONS.md), changed areas in [CHANGELOG.md](CHANGELOG.md); the full history is in the Git log.
- Contributions to this repository are accepted under the same Multica License.

Copyright for the upstream code: Index Labs (Hong Kong) Limited and Multica contributors. Copyright for the changes in this fork: their respective authors.
