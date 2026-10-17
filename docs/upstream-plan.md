# Upstream plan: offering the Android changes to multica-ai/multica

Draft only. Nothing has been submitted. Before any PR is opened, the plan needs a go from the project owner, and ideally a short issue upstream that asks whether Android support for `apps/mobile` is welcome at all.

## Starting point

- Fork base: upstream tag `v0.6.1` (merge base `2ea01ae4e`, 2026-10-01).
- Fork diff: 207 non-merge commits, about 530 files, +40,500 / −1,300 lines. About 500 of those files are in `apps/mobile`; roughly 90 of them are end-to-end flows and UI checklists.
- Upstream has moved on: its `main` has already switched `apps/mobile` to **Expo SDK 57** (the fork is on SDK 55). Every PR below must be rebased onto current upstream `main` and re-tested there; patches for SDK 55 libraries (for example `react-native-screens@4.23.0`) may be obsolete.
- Fork-specific references in comments (review shorthand, release details) are removed from every PR before it is opened.
- Upstream rules that apply to every PR (`AGENTS.md`, `apps/mobile/AGENTS.md`): conventional commits, English code comments, Vitest tests beside the code, zod + `parseWithFallback` for every new API response, no internal compatibility shims, mobile checks `pnpm --filter @multica/mobile typecheck|lint|test`. Their mobile CI (`.github/workflows/mobile-verify.yml`) builds no native app, so for Android-only PRs we must describe how we verified on a device.

## What stays fork-specific (never upstream)

| Item | Where | Why |
| --- | --- | --- |
| Package id `net.recordingbeats.multica.unofficial` | `app.config.ts` | Upstream would use its own id (`ai.multica.mobile[.dev/.staging]`, like iOS). In PR 4 we propose that shape instead. |
| Version scheme `0.6.1-rbN`, `ANDROID_VERSION_*` | `app.config.ts`, release scripts | The fork's release numbering. |
| Release signing plugin, `build-release.sh`, `release-signer.sha256` | `apps/mobile/plugins/with-release-signing.js`, `apps/mobile/scripts/` | Tied to the fork's release key and release process. |
| Debug APK with bundled JS and `dev=false` | `plugins/with-bundled-debug-js.js` | Serves headless emulator testing; upstream develops with Metro. |
| German-language concept docs | the fork's Android, UX and technical concept documents (not part of this repository; only the ping-rule test vectors in `docs/technik/` are) | Internal decisions, partly German, internal references. |
| Default server URL and placeholders | `lib/server-config.ts` (`EXPO_PUBLIC_DEFAULT_SERVER_URL`), `locales/*/auth.json` (`url_placeholder_cloudflare`) | Build-time defaults of the fork. Upstream default is `multica.ai`. |

## Proposed PR series

Order = submission order. Each PR is self-contained, keeps iOS behaviour unchanged unless stated, and brings its own tests. "Risk" means risk for upstream (review effort, chance of rejection, regressions).

### Group A – bug fixes that also affect iOS (submit first, low risk)

**PR 1 – fix(mobile): inbox must not go blank on non-string `details` values**
- Purpose: `GET /api/inbox` returns numbers and `null` inside `details` (e.g. `children_done`). The mobile schema expected strings and validated the whole list, so one entry emptied the inbox. Normalise values and validate per row.
- Files: `apps/mobile/lib/inbox-details.ts` (+ test), `apps/mobile/data/schemas.ts`, `apps/mobile/data/inbox-schema.test.ts`; label for `children_done` stage text.
- Depends on: nothing. Risk: low. Check first whether upstream fixed it after v0.6.1.

**PR 2 – fix(mobile): issue lists load all pages**
- Purpose: lists stopped at the first 100 issues; with many done issues, open ones disappeared.
- Files: `apps/mobile/data/queries/list-pages.ts` (+ test), `data/queries/issues.ts`, `data/queries/my-issues.ts`.
- Depends on: nothing (the board/filter parts of our commit go with PR 15/16). Risk: low.

**PR 3 – fix(mobile): inbox jump lands on the triggering comment**
- Files: `apps/mobile/lib/timeline-thread.ts` (+ test), `components/issue/timeline-list.tsx`, `components/issue/issue-header-card.tsx`.
- Depends on: nothing. Risk: low.

Further small fixes that can ride as individual PRs if upstream likes Group A: status catalogue in web order (`lib/issue-status.ts`), parent picker includes done/cancelled issues, comment attachments surviving composer remounts, drafts dropped on logout/workspace switch.

### Group B – Android foundation (needed before anything Android-specific)

**PR 4 – feat(mobile): Android build configuration**
- Purpose: make `expo prebuild --platform android` produce a working app.
- Content: `android` block in `app.config.ts` with upstream-style ids (`ai.multica.mobile`, `.staging`, `.dev`), adaptive icon, `softwareKeyboardLayoutMode: "resize"`, `blockedPermissions` (camera, microphone, storage, overlay); `android:*` scripts in `apps/mobile/package.json`; a generic `scripts/android-build.sh` **without** fork-specific defaults; `plugins/with-fbjni-pin.js` only if SDK 57 still needs it.
- Not included: package id, signing, bundled debug JS, the fork's CI setup.
- Depends on: nothing. Risk: medium – upstream has to accept a second platform to maintain. Open an issue first.

**PR 5 – feat(mobile): cross-platform icons and action sheet**
- Purpose: SF Symbols do not render on Android (empty tab bar and menus); `ActionSheetIOS` does not exist on Android.
- Files: `components/ui/symbol-icon.tsx`, `components/nav/more-tab-dropdown.tsx`, `(tabs)/_layout.tsx`, `switch-workspace.tsx`; `lib/action-sheet.ts`, `components/ui/action-sheet-host.tsx` and its call sites (inbox, issue, project, profile, comment and chat long-press menus).
- Depends on: PR 4 (only to be testable). Risk: low – iOS keeps the native implementations behind `Platform.OS`.

**PR 6 – fix(mobile): Android pickers, modals and keyboard**
- Files: `components/issue/pickers/due-date-picker-body.tsx` (DateTimePickerAndroid), `lib/modal-presentation.ts` (+ test) and `[workspace]/_layout.tsx`, keyboard-aware login and chat composer, `react-native-keyboard-controller` bump if still needed on SDK 57.
- Depends on: PR 4. Risk: low–medium.

**PR 7 – feat(mobile): restore the open route after Android recreates the activity**
- Files: `lib/route-restore.ts` (+ test), `plugins/with-android-restore-route.js`, `app/_layout.tsx`, `app/index.tsx`; dependency `expo-file-system`.
- Depends on: PR 4. Risk: medium – touches app start and navigation; an upstream fix in React Native/Expo may make it unnecessary.

**PR 8 – fix(mobile): backport react-native-screens crash fixes**
- Only if upstream's current `react-native-screens` still lacks software-mansion/react-native-screens #4413 and #4834. Otherwise drop.
- Files: `patches/react-native-screens@*.patch`, root `package.json` (`patchedDependencies`), `scripts/check-native-patches.sh`.
- Risk: medium – upstream may prefer a version bump over a patch.

### Group C – cross-platform improvements (each independent, iOS benefits too)

**PR 9 – feat(mobile): accessibility – labels and 48 dp touch targets**
- Files: `components/ui/icon-button.tsx`, `components/issue/attribute-chip.tsx`, screen-reader labels in tabs, sheets, search, settings, chat list. Risk: low.

**PR 10 – feat(mobile): German locale**
- Files: `locales/de/*`, `lib/i18n/config.tsx`, `resources.ts`, `types.ts` (+ test), language picker. Risk: low, but upstream must accept maintaining a third language (their conventions require reviewing copy in all languages). Strings for later features come with those PRs.

**PR 11 – feat(mobile): offline banner and automatic resend of offline comments**
- Files: `components/ui/connectivity-banner.tsx`, `lib/comment-resend.ts` (+ test), `data/stores/failed-comments-store.ts`, `data/mutations/issues.ts`, `components/issue/comment-card.tsx`. Risk: medium (mutation and cache behaviour; matches the upstream rule "message sends use visible pending state and retry").

**PR 12 – feat(mobile): edit own comments from the long-press menu**
- Files: `components/issue/comment-context-menu.tsx`, `components/composer/message-composer.tsx`, `components/issue/inline-comment-composer.tsx`, `data/stores/edit-target-store.ts`. Risk: low.

**PR 13 – feat(mobile): runtime server URL (self-hosting)**
- Purpose: choose the server on the login screen instead of building one APK per server; "copy link"/"open in web" follow it.
- Files: `lib/server-config.ts` (URL part only, + test), `data/server-config-store.ts`, `data/api.ts`, `data/realtime/*`, `app/(auth)/server-setup.tsx`, `lib/web-links.ts` (+ test).
- Upstream default stays `multica.ai`. Risk: medium – product decision (their cloud is the default path).

**PR 14 – feat(mobile): optional Cloudflare Access service token**
- Files: header logic in `lib/server-config.ts`, `lib/image-source.ts`, `data/api.ts`, `data/realtime/ws-client.ts`, `components/ui/paste-field.tsx`, `lib/paste-parse.ts`.
- Depends on: PR 13. Risk: medium–high – niche feature for self-hosters behind Zero Trust; offer only if upstream welcomes it.

**PR 15 – feat(mobile): issue fields – start date, stage, parent, duplicate, conflict protection**
- Files: pickers `start-date`, `stage`, `parent`, `duplicate` under `app/(app)/[workspace]/issue/[id]/picker/`, `edit.tsx` with `title_base`/`description_base` and 409 handling, related `data/` mutations and schemas.
- Risk: medium (several fields; can be split in two: fields / conflict protection).

**PR 16 – feat(mobile): issue list filters (project, label, due date), persisted per list**
- Files: `data/stores/issue-list-filter-store.ts` (+ test), `issues-filter.tsx`, `components/issue/active-filter-chips.tsx`, `lib/issue-list-filters.ts`. Risk: low–medium.

**PR 17 – feat(mobile): Kanban board**
- Files: `components/issue/board/*`, `components/issue/view-mode-toggle.tsx`, `data/stores/issue-view-mode-store.ts`, `lib/board.ts`, `lib/board-dnd.ts` (+ tests).
- Depends on: PR 2, PR 16. Split: (a) board with status change and undo, (b) drag and drop in wide layouts. Risk: medium–high – visible product feature.

**PR 18 – feat(mobile): custom properties in the issue detail**
- Files: `lib/issue-properties.ts` (+ tests), `components/issue/issue-properties-section.tsx`, `picker/property.tsx`, `data/mutations/issue-properties.ts`. Risk: medium.

**PR 19 – feat(mobile): inbox filters and "Done" action**
- Files: `inbox-filter.tsx`, `data/stores/inbox-filter-store.ts`, `lib/inbox-filters.ts` (+ tests), inbox row menu. Risk: low–medium.

**PR 20 – feat(mobile): subscriptions, run transcript and re-run**
- Files: `issue/[id]/subscribers.tsx`, `runs.tsx`, `components/issue/run-transcript.tsx`, `run-row.tsx`, transcript redaction (+ tests). Risk: medium – the redaction rules need upstream review.

**PR 21 – feat(mobile): chat session management and queue**
- Files: `chat-session-rename.tsx`, `chat-sessions.tsx`, `components/chat/use-chat-session-menu.ts`, `components/chat/chat-queue.tsx`, `lib/chat-queue.ts`, `data/mutations/chat-sessions.ts`, `chat-queue` (+ tests). Can be split: (a) rename/pin/archive, (b) queue. Risk: medium.

**PR 22 – feat(mobile): agents and squads (read-only) and workspace invitations**
- Two PRs: (a) `more/agents.tsx`, `agent/[id].tsx`, `squad/[id].tsx`, `data/queries/agents.ts`; (b) `components/workspace/invitation-list.tsx`, `data/{queries,mutations}/invitations.ts`. Risk: low–medium each.

**PR 23 – feat(mobile): landscape and tablet layouts**
- Files: `lib/breakpoints.ts`, `lib/issue-detail-layout.ts` (+ tests), `components/issue/issue-summary-pane.tsx`, `orientation: "default"` in `app.config.ts`.
- Touches iOS as well (iPhone landscape). Depends on: PR 17 for the wide board. Risk: medium–high.

**PR 24 – chore(mobile): redacting logger and `no-console` lint rule**
- Files: `lib/logger.ts` (+ tests), `eslint.config.js`, all former `console.*` call sites. Risk: medium – touches many files; upstream may prefer their own approach.

**PR 25 – fix(mobile): session end clears all account data**
- Files: `data/session-end.ts` (+ tests), `data/auth-store.ts`. Risk: medium (logout path). Depends on: the features whose caches it clears; can also go early with a smaller scope.

### Group D – discuss before coding

- **Issue chat** (`app/(app)/[workspace]/issue/[id]/chat.tsx`, `components/issue-chat/*`): a mobile-only second view of the timeline. A product decision for upstream; propose as an issue with screenshots first.
- **On-device notifications without push** (`modules/rb-notify`, `plugins/with-rb-notify.js`, settings screens): native Android foreground service, Android-only, package name `com.recordingbeats.rbnotify` would need renaming. Upstream will more likely want real push for both platforms. Offer the design and the ping rule as input in an issue, not as a PR.
- **Trusting user CAs** (`plugins/with-android-network-security.js`): useful for self-hosters with private CAs but a security trade-off; propose as an opt-in build flag at most.
- **Deep-link scheme**: the app keeps `multica://` for now. Upstream has no official Android app, so a scheme collision on Android is not a real problem today; revisit only if upstream ships one.
- **Android manifest hardening** (`plugins/with-android-manifest-hardening.js`): small and generic, could join PR 4 if upstream agrees.

## Suggested next steps

1. Get a go for upstream contribution and for publishing under the Multica License.
2. Open one upstream issue: "Android support for apps/mobile – would you accept PRs?" with a link to the public fork.
3. Submit Group A right away (no dependency on the Android decision).
4. Depending on the answer: Group B, then Group C one by one, at most two open PRs at a time.
