# Changelog

All notable changes of this unofficial Android app are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).

The baseline is the upstream Multica mobile client (`apps/mobile`) at tag `v0.6.1` of <https://github.com/multica-ai/multica>, which supports iOS only.

## [1.0.0] – unreleased

First public release as a standalone repository. Earlier builds were private test builds; this release contains everything from them.

Supported server: Multica v0.6.1 (self-hosted). From this release on, the app has its own version numbers; the supported server version is stated per release.

### Added – Android platform
- Android build of the Expo / React Native client: app configuration, adaptive icon, Expo config plugins, build and release-signing scripts (`scripts/android-build.sh`, `scripts/build-release.sh`).
- Material bottom sheet as a drop-in replacement for `ActionSheetIOS`.
- Icons on Android: SF Symbols are mapped to the matching Ionicons glyph (tab bar, More menu, workspace switcher).
- Android date picker for due and start dates.
- Landscape support, breakpoints, a two-pane issue detail on tablets (detail on the left, chat or activity on the right).
- Route restore after Android recreates the activity (font size or display size change), including the back stack.
- Modal screens shown as bottom cards below the status bar; keyboard-aware login, chat and composer screens.
- Dialog accent colour follows the app theme.

### Added – Connection and sign-in
- Server URL configured at runtime on a setup screen, with a connection test (`/health`); no server address is built into the APK.
- Cloudflare Access mode: service-token headers on REST, uploads, the WebSocket upgrade and images of the configured origin, and a clear message when Access blocks a request instead of a silent logout.
- Direct / VPN mode that trusts user-installed CA certificates (private CAs without rebuilding the app).
- Paste buttons for URL and secrets (a copied header block fills both fields), optional clipboard clearing, `FLAG_SECURE` on secret screens, paste support for the e-mail login code.
- Debug builds only: sign-in with a personal access token for automated tests. Release builds do not contain this screen; the release build script checks for it.

### Added – Inbox and notifications
- Unread and archive views, row and bulk actions, filter sheet for status, priority and sender, "Done" action.
- Entries open the issue chat or the issue detail depending on the notification type and land on the triggering comment.
- On-device notifications without a push provider: an opt-in foreground service keeps one WebSocket for all enabled workspaces and shows local notifications with channels, a summary notification and mark-as-read. State survives process restarts and is deleted on logout.

### Added – Issues and projects
- Kanban board for All Issues, My Issues and project issues: status columns, status change with undo, TalkBack actions, drag and drop between columns in landscape and on tablets.
- List filters for project, label and due date, remembered per list and workspace; the filter button shows the number of active filters.
- Issue fields: start date, stage, parent (set and clear), mark as duplicate, custom properties (text, number, select, multi-select, date, checkbox, URL, member).
- Conflict protection when editing title or description: a "changed meanwhile" notice instead of silently overwriting other people's edits.
- Sub-issues grouped by stage with progress; parent chip.
- Issue chat: a chat-style view of the issue timeline, reachable from the issue header, the inbox and notifications.
- Subscribe and unsubscribe, subscriber list.
- Agent runs: read-only transcript with secret redaction, live updates, re-run with confirmation.
- Edit your own comments from the long-press menu.
- Offline bar, refresh toast, comments written offline are kept and sent automatically when the connection returns.

### Added – Agents, chat and workspaces
- Agents and squads, read-only, under More: status, runtime, recent runs, squad members and active issues.
- Accept or decline workspace invitations in the workspace switcher.
- Chat sessions: rename, pin, archive, restore, delete, archive view; sessions in the same order as the web app.
- Chat queue: write while an agent is answering, send now (steer) or clear the queue.

### Added – Languages and accessibility
- German translation.
- Screen-reader labels for icons, tabs, sheets and the back button; 48 dp touch targets for toolbar buttons, chips and filters.
- Layouts checked at 200 % font size.

### Changed
- "Copy link" and "Open in web" use the configured server URL instead of a build-time web URL.
- Status catalogue ordered as in the web app.
- Logging goes through one logger that redacts tokens, secrets, JWTs and similar values; verbose logs only in debug builds.
- Upgraded `react-native-keyboard-controller` to 1.21.5.

### Fixed
- Inbox no longer shows up empty when an entry contains numbers or `null` in its details; invalid entries are skipped one by one.
- Issue lists load all pages instead of stopping at 100 issues.
- Comment attachments survive composer remounts; chat and comment drafts are dropped on logout and workspace switch.
- Parent picker also finds done and cancelled issues.
- Android start crash and a crash on teardown in `react-native-screens` (backported upstream fixes as a pnpm patch).
- Start crash caused by a mismatched `fbjni` version (pinned to the React Native version).
- Expo dev launcher no longer appears in Android debug builds (dev client excluded from Android autolinking).

### Security
- No camera, microphone, storage, media or overlay permissions; Expo Clipboard's exported file provider removed.
- Session end clears all account data, cached filters, drafts and notification state.

[1.0.0]: ../../releases/tag/v1.0.0
