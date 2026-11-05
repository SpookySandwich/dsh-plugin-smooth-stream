# Official DSH 0.2.2-rc.1 implementation validation

Event: `compatibility:dsh-plugin-smooth-stream:dsh-0.2.2-rc.1`, 2026-11-05.
Implementation base: `a84d963a351b827c563996cf11f242c3b9a1a040` (published plugin 1.5.0).
Task branch: `maint-20261105-smooth-stream-1f1b3227`.

## Official target and scope

- [Official npm release](https://www.npmjs.com/package/@deepseek-ai/dsh/v/0.2.2-rc.1).
- [Official source tag](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.2-rc.1).
  `git ls-remote` independently returned `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`.
- Live `npm view @deepseek-ai/dsh dist-tags engines --json` returned latest/next
  `0.2.2-rc.1`, alpha `0.2.2-alpha.3`, and Node `>=24.9.0`.
- Target package integrity:
  `sha512-ijR9UEVYkG15Q/Q79JzvzLBzQOQfc63VLr9n6flpwHPhr5IKn2UxthnSoto/P9l7qGd7pPvI1Ra6TW7LH3oKpg==`.

This implementation updates compatibility and restores an existing file-link
integration. Package version, READMEs and release notes are reserved for the
Writer. No publication was performed.

## Reproduced problems and changes

1. **npm peer resolution:** the original packed 1.5.0 manifest fails strict npm
   installation with DSH 0.2.2-rc.1 (`ERESOLVE`). The expanded semver regression
   fails at `npm must accept 0.2.2-rc.1` before the fix. Append the exact
   `|| 0.2.2-rc.1` arm to peers and `engines.dsh`, and regenerate root lockfile
   metadata. Retain the existing ranges. Tests cover all four verified hosts,
   reject unverified alpha/next prereleases with npm's default semantics, and
   check manifest/lock agreement. Strict resolution succeeds after the change.
2. **Closing-turn file links:** the new host no longer supplies `fileMentions`
   in `ChatNodeOwnerProps`; it binds the resolver in its native assistant entry.
   Smooth Stream replaces that entry. The unchanged plugin consequently renders
   a delivered `smooth-qa.txt` mention as an inert `<code>` inside a paragraph.
   The real-host baseline run timed out waiting for its file button, while the
   fixed plugin renders the actionable mention before and after restart.
   Bind `chatFileMentions.forClosing(owner, sessionId)` through Smooth Stream's
   own entry injection. Prefer the older owner callback when present; preserve
   closing-turn identity checks and tolerate an unavailable optional service.
   Rebuild `lib/client.js`. The component regression failed before the bridge
   and passes for current, retained-owner, nonclosing and missing-service cases.
3. Extend the existing official-host acceptance fixture for delivered file
   mentions, durable assistant images, interruption/error partial output,
   English/Chinese layouts and the current host's whole-page signature checks.
   Add Windows Node 24 to the existing CI matrix.

## Targeted published API inspection

Compared installed official 0.2.1-rc.5 and 0.2.2-rc.1 packages, rather than relying
on the truncated repository-wide comparison:

- `dsh-client-ui-chat/lib/types/client/contract/slots.d.ts` removes the shared
  owner `fileMentions` field. `chat/AssistantNodeView.d.ts` adds
  `AssistantNodeInjected`. The new `lib/client.js` assistant registration at
  lines 9268–9287 injects its session-scoped resolver, calling
  `chatFileMentions.forClosing`. Smooth Stream now supplies that existing
  capability from its own replacement entry.
- `dsh-client-ui-deliverables/lib/client.js` lines 2684–2688 retain the
  `forClosing(owner, sessionId, getFileTriggerProps?)` service. The optional
  gesture argument supplies the host's file context menu; the existing `openFile`
  callback works without it (lines 1275–1289). Round one omitted that optional
  callback and lost native menu interactions. The round-two correction below
  preserves both ordinary links and native gestures.
- Chat `assistant-content.d.ts` and `turn-process.d.ts` are byte-identical.
  `groupPart`, node blocks/status, `useTurnData`, `loadImage` and the
  `conversation.chat.node` slot remain available. `renderMessageImages` is still
  absent from that owner contract; the plain image fallback remains intentional.
- Published chat `reasoningText()` (lines 8126–8138) still hides partial/complete
  leading signature envelopes and skips following LF/CRLF. Native display rows
  suppress empty prepared content. Existing plugin preparation remains valid.
- Renderer `registry.d.ts` and client-modules `client/index.d.ts` are
  byte-identical. Settings adds an optional icon slot, leaving `settings.section`
  unchanged. Locale registration widens to additional language dictionaries;
  baseline English/Chinese registration and binding remain valid.
- The actual host still supplies native `MarkdownText`, code labels, tables,
  and `[data-conversation-scroll]`; real browser checks exercise these APIs.
- `dsh-app-boot/lib/index.js` lines 1070–1122 still gives `engines.dsh` precedence
  and uses `includePrerelease: true`. The old host engine check accepted the
  target; the range change fixes npm resolution, not a runtime boot rejection.

## Owned environment and reproduction

Scratch root:
`<task-temp>/dsh-20261105-1f1b3227-smooth-stream`.
All relative paths below are from its `repo` worktree. No applicable AGENTS.md
was found in the checkout or checked ancestors. The existing acceptance helper,
tests, package check and prior validation record were read first.

- Official Windows x64 Node `24.22.2`, npm `11.19.1`:
  `../runtime-node/node-v24.22.2-win-x64`.
- Node archive downloaded from nodejs.org and checked against its official
  `SHASUMS256.txt`; SHA-256
  `ca1bff5d8ead13c9f2ea404a176db46bd430704d5b5113734049fa365e7799e2`.
  Metadata retained in `../runtime-node/verified.json`.
- Official DSH prefixes: `../runtime-022rc1`, `../runtime-021rc5`,
  `../runtime-021rc2`; the unchanged repository lock installs 0.2.0-rc.2 in
  `./node_modules`.
- Headless Microsoft Edge `156.0.4314.50`, isolated browser contexts. Temporary
  browser/host/package files use `../qa-tmp`; registry cache is `../npm-cache`.
- Model is the deterministic local `qa-local` / `qa-model` adapter. It runs
  through the actual official CLI, session store, stream pipeline and web app.
  File tests append a deterministic `deliverables/presented` event to the real
  session. Image tests save a 160×80 PNG through the real attachment store.

```powershell
$env:PATH = "$((Resolve-Path ../runtime-node/node-v24.22.2-win-x64).Path);$env:PATH"
$env:TEMP = (Resolve-Path ../qa-tmp).Path
$env:TMP = $env:TEMP
npm ci --cache ../npm-cache --no-audit --no-fund
npm install --prefix ../runtime-022rc1 @deepseek-ai/dsh@0.2.2-rc.1 --cache ../npm-cache --no-audit --no-fund
# Retained prefixes: repeat with runtime-021rc5 / 0.2.1-rc.5 and runtime-021rc2 / 0.2.1-rc.2.
npm install --package-lock-only --ignore-scripts --no-audit --no-fund --cache ../npm-cache
npm test
node --test scripts/npm-publish.test.mjs
npm run check:package
git diff --check
```

npm 11 reported unapproved dependency install scripts; no global npm policy was
changed. The tested official web/session/image paths start and pass. Subprocess
tools and native desktop paths were not exercised.

Strict npm reproduction used an unchanged base tarball in `../peer-before`;
the fixed package resolves in `../peer-after`, without force or legacy peers:

```powershell
npm pack --pack-destination ../peer-after --json --silent
npm install --prefix ../peer-after --package-lock-only --ignore-scripts --strict-peer-deps --no-audit --no-fund --cache ../npm-cache @deepseek-ai/dsh@0.2.2-rc.1 ./../peer-after/dsh-plugin-smooth-stream-1.5.0.tgz
```

Actual-host acceptance:

```powershell
$env:DSH_QA_MODULES = (Resolve-Path ../runtime-022rc1/node_modules).Path
$env:DSH_QA_TMP = $env:TEMP
$env:DSH_QA_ARTIFACTS = (Resolve-Path ../artifacts/final).Path
$env:DSH_QA_SIGNATURES = '1'
$env:DSH_QA_SETTINGS = '1'
$env:DSH_QA_FILES = '1'
$env:DSH_QA_LAYOUT = '1'
$env:DSH_QA_IMAGES = '1'
$env:DSH_QA_EDGE_CASES = '1'
node scripts/run-dsh-acceptance.mjs
```

Retained-host runs use signatures/settings with the four new optional switches
unset. For the broken baseline, set `DSH_QA_PLUGIN` to
`../peer-before/unpacked/package` (absolute path), use the current runner/fixture,
and enable `DSH_QA_FILES=1`. The runner otherwise loads the current worktree.

## Results and resource ledger

Passing local checks:

- Node 24.22.2: `npm ci`, `npm test` (6/6), syntax checks for runner and
  fixture, `npm run check:package` (8 package files), and `git diff --check`.
- Node 22.19.0: unit suite 6/6. This checks plugin unit compatibility, not
  execution of the Node-24-only new DSH host.
- Publication-script fixtures: 10/10; these are isolated fixture tests, with no
  publication. Their source did not change during this implementation.
- Strict packed-package npm resolution succeeds with target 0.2.2-rc.1.
- Generated `lib/client.js` matches a fresh build. Lockfile changes are limited
  to the two root compatibility fields; no dependency versions changed.

Official-host acceptance passed fresh and after restart on all four targets:

| Target / run | Fresh PID / port | Restart PID / port | Home suffix | Result |
| --- | --- | --- | --- | --- |
| 0.2.0-rc.2, signatures/settings | 42060 / 54595 | 34608 / 54150 | XhXEQK | PASS |
| 0.2.1-rc.2, signatures/settings | 77240 / 65353 | 82184 / 57214 | 6QjEy6 | PASS |
| 0.2.1-rc.5, signatures/settings | 89800 / 51252 | 34548 / 64824 | iLgRRE | PASS |
| 0.2.2-rc.1, initial signatures/settings | 84708 / 63743 | 95616 / 60708 | 3JiwEl | PASS |
| 0.2.2-rc.1, file-link bridge | 65364 / 53123 | 104016 / 61159 | mu7Vi5 | PASS |
| 0.2.2-rc.1, final extended acceptance | 48224 / 60394 | 81748 / 50173 | 2U4QOz | PASS |

Each home is exactly `../qa-tmp/smooth-stream-dsh-qa-<suffix>`. All listed
processes were stopped by the runner; all browser contexts/instances were
closed and these homes removed. No user DSH home or browser profile was used.
Runtime prefixes, npm cache, tarballs, logs and screenshots remain owned beneath
the scratch root for Attacker reuse. Host-generated helper/cache directories
under `../qa-tmp` remain; no broad cleanup or deletion through directory links
was performed.

The final extended acceptance log is `../artifacts/final/run.log`. It verifies:

- Saved and live reasoning/response seats contain one answer and one displayable
  reasoning row per turn, with no signature-only rows or leaked envelopes.
  Current rc.1 and rc.5 sample the entire page for signature leaks; older hosts
  sample plugin output because their native live previews expose raw reasoning.
- Real native highlighted code, Copy controls, tables, actionable file mentions,
  and durable image loading; images render once in the response seat as plain
  images, retaining the known gallery limitation.
- All eight settings choices use expected normal animation names and suppress
  animation/overlay motion under reduced motion. Live reduced-motion samples
  counted 92/95 reveal nodes and 165/142 active follow states, fresh/restart.
- Disable/reload/re-enable persists the selected Rise setting. Host restart
  resumes the saved session with prior streamed output and file/image data.
  Settings are browser-local; browser reload and server restart persistence are
  distinct checks. Host language is persisted separately and remains Chinese
  after the locale check, so restart also validates translated disclosures.
- Chat and English/Chinese settings fit 1400×1000, 800×900 and 390×844 viewports.
  Captured screenshots were visually inspected: readable code/table/file links,
  wrapped animation choices, accessible controls and no horizontal clipping of
  the plugin content. A 4px tolerance accommodates measured 2px native
  range-input border overflow in the settings panel.
- During cancellation and intentional adapter failure, streamed partial answers
  remain in the response seat. After reload, cancellation retains its partial
  output and stop marker; the failed uncommitted attempt is removed by the host
  and its failure card remains. No browser page/console errors occurred.

Screenshots retained in `../artifacts/final` include `chat-0.2.2-rc.1-390.png`,
`settings-0.2.2-rc.1-{en,zh}-{1400,800,390}.png`,
`acceptance-0.2.2-rc.1-restart.png`, and `edge-cases-0.2.2-rc.1.png`.
These are owned QA artifacts, not published assets.
The final source tarball and strict-resolution lock are retained in
`../peer-final`; its command/output is `../artifacts/peer-final.log`.

Expected reproduction and test-development failures (not counted as passes):

| Run | PIDs / ports | Home suffix | Observation |
| --- | --- | --- | --- |
| Base tarball file mention | 43072 / 49321 | TCCrPW | Inert inline code; missing link reproduced |
| First layout assertion | 112608 / 49322 | yGpPU8 | Native range border overflow measured 2px; tolerance corrected |
| Locale layout extension | 78144 / 65034; 105616 / 53278 | 4RQlaf | Fresh checks passed; restart selector assumed English after switching to Chinese |
| Locale reset attempt | 85588 / 54440; 60208 / 60693 | 8eQZr2 | Same persisted-language selector issue; runner now accepts translated completion disclosure |
| First error assertion | 25780 / 63947; 4560 / 64280 | dO02ec | Expected failed partial persistence incorrectly; host removes uncommitted failures |

All these owned hosts/browser instances/homes were also stopped and cleaned up.
The baseline HTML in `../artifacts/baseline-files` confirms `smooth-qa.txt` was
a CODE child of P. Failure HTML/logs remain in `layout`, `extended`,
`extended-final` and `acceptance-complete` beneath `../artifacts` for audit.

## Limits

No paid/remote model, native desktop app, remote-access mode, macOS/Linux, real
mobile device, or native image gallery is claimed. Small layouts are desktop
Edge viewports, not touch-device tests. All eight reveal styles are checked in
the real settings preview under normal/reduced motion; live streaming samples
exercise Fade under reduced motion. No subjective animation-quality rating or
exhaustive scroll takeover test is claimed. Round-two file checks exercise native
context-menu display and left-click preview; external-editor launch is untested.
Quote and context-menu gestures were verified in English; Chinese gesture
interactions were not independently tested, and Japanese preview remains unconfirmed
(English fallback is verified for the Smooth settings panel in Japanese). Live
directory changes were verified only in unit and fuzz testing, not on a running host.
The prior signature-only final-block
settle-underline observation remains outside scope.

## Round-two renderer interaction correction

Round-one review rejected `5bac448de84be7db077b2a2a0be99bf95dbabd66` because
the replacement renderer omitted native Quote and file-menu integration. These
are compatibility obligations of the replaced renderer. The earlier limitation
excluding those gestures was too narrow and is superseded by this correction.

Before changing the client, the actual 0.2.2-rc.1 browser recorded a real selected
reply and expanded reasoning, both without a Quote button; right-click had no
menu, while left-click preview worked. The final pointer-drag reproduction of
the round-one tarball is retained in `../artifacts/round2-baseline-scoped`.
Its JSON has reply Quote false, reasoning Quote false, menu false, preview true.
The expanded unit regression also failed before the fix at the missing reply
`textInteractionSource` prop.

Target API evidence, from the published chat `lib/client.js`:

- Line 8438 enables interactions only when `data.status === 'settled'` and
  `data.finalNode.messageId` is present. Line 8326 forwards that flag to native
  `MarkdownText`. Smooth Stream now uses that exact eligibility for replies.
- Lines 8224–8226 put `data-text-interaction-source` on the expanded reasoning
  body when eligible and not running. Smooth Stream now marks its expanded body,
  including both stable and newly revealed text, using the same rules.
- Lines 8394–8405 call the globally injected `useContextMenu`, bind
  `getTriggerProps` to a deferred `{ kind: 'file', value: { sessionId, path } }`,
  and resolve the path when the gesture begins. Line 8423 passes this callback
  into `fileMentions`; registration lines 9282–9285 forward it to `forClosing`.
  Smooth Stream now preserves this complete chain.
- Lines 181–186 resolve from the live session `workingDirectory` projection,
  falling back to the session list's workspace cwd. Lines 44–66 define the small
  browser-safe Windows/UNC/POSIX path resolver, bundled internally by the host.
  The plugin follows those semantics and guards unavailable optional services.

The regression verifies reply and expanded reasoning eligibility, excludes
running/interrupted/unidentified messages, checks deferred directory changes,
absolute Windows/UNC/POSIX paths, workspace fallback and missing menu/session
services. Previous host-owned file resolvers still take precedence.

`scripts/check-dsh-interactions.mjs` uses real mouse selection and checks that
Quote inserts selected text into the composer. It tests both reply and expanded
reasoning, file preview, and the host menu. It is enabled in the existing runner
with `DSH_QA_INTERACTIONS=1`, together with `DSH_QA_FILES=1` and
`DSH_QA_SIGNATURES=1`. The separate owned `../round2-native.mjs` uses the same
fixture and checks with the native renderer to compare behavior.

The existing `pathImages` lead was inspected: both rc.5 and rc.1 already have the
same native fallback, while the normal Chat view also supplies `fileImages`.
An optional `DSH_QA_PATH_IMAGES=1` fixture tests an authored local PNG in native
and Smooth Stream rendering. No new path-image implementation was added.

### Retained review logs and older hosts

The Attacker's `run3.log` files were read directly. rc.5 passed fresh/restart
(PIDs 48040/31820); 0.2.0-rc.2 passed (5052/96568). rc.2 failed with an empty
computed animation name for Focus (113780); the batch's final exit zero did not
establish a pass. Its log is not counted as passing. The old-host
`file-early.log` independently records a visible preview (PID 59988).

The preview timer replaces DOM nodes between batches. Acceptance now queries a
connected current preview node and its computed styles atomically, then waits
for the expected style. It still requires `none` in reduced motion and each
style's actual animation name normally; no production CSS change was made.
All three retained hosts passed the corrected full fresh/restart test:

| Version | Fresh PID / port | Restart PID / port | Home suffix |
| --- | --- | --- | --- |
| 0.2.0-rc.2 | 36624 / 50940 | 96016 / 51079 | gahheI |
| 0.2.1-rc.2 | 119332 / 63285 | 43340 / 57206 | 2BPs4X |
| 0.2.1-rc.5 | 44540 / 52984 | 100432 / 54450 | f9L50j |

Using the reviewer's existing early-delivery fixture read-only against the
updated plugin, file mentions also rendered and opened on each retained host:
0.2.0-rc.2 PID 113368/home x5HbZM; rc.2 PID 105908/home 2SmDgp; rc.5 PID
36616/home ERPYRe. Logs are `../artifacts/round2-{020rc2,021rc2,021rc5}/file-preview.log`.
The invoking script checked the reported preview result and absence of an error,
not just the probe's process exit status. Those hosts were stopped and homes
removed. Reviewer's scratch files were not edited.

### Native menu limitation and stable acceptance

Native and Smooth Stream both produced six-action menus (Open in sidebar,
Open in floating panel, Show in folder, Open in Notepad, Copy file path,
Download), and both also produced Download-only menus. For example,
`round2-native-parity` failed the earlier six-action expectation, while
`round2-native-preview-first` successfully exercised all six actions fresh and
after restart. Smooth examples include `round2-fixed` (six actions) and
`round2-fixed-preview-first` (Download only). These observations establish that
requiring six actions on every invocation is not a stable native contract here.

The official context-menu provider has a default 1000ms resolution deadline
(`dsh-client-ui-context-menu/lib/client.js`, lines 1023–1035 and 1258).
The open-in-app provider awaits desktop availability, workspace stat and Windows
file associations before returning its group (lines 165–171 in its client).
While this is a plausible factor, the cause is not conclusively established.
Independent sample runs observed Download-only in 5/30 cases for Smooth Stream vs
1/30 cases for native DSH, a small and inconclusive sample.
The menu always opens and typically recovers full actions later.
A 10000ms isolated profile experiment passed Smooth's full extended suite
(`round2-final-configured`, PIDs 89860/58968), but native still produced Download only
(`round2-native-configured`, PID 23484). Raising the deadline is therefore not claimed
as a fix or a reliable workaround. The optional timeout experiment was removed from
the final runner. Official installed runtime files and production host settings were
not changed.

Final default-host comparison (`round2-final-parity` and
`round2-native-final-parity`) observed matching menus in that specific run:

| Renderer / phase | Cold / warm items | Host PID / port | Home suffix |
| --- | --- | --- | --- |
| Native fresh | 1 / 6 | 107088 / 54487 | J4rrJj |
| Native restart | 6 / 6 | 57208 / 64357 | J4rrJj |
| Smooth fresh | 1 / 6 | 52000 / 54488 | mPMM5I |
| Smooth restart | 6 / 6 | 76220 / 58756 | mPMM5I |

These cold 1/6 and warm 6/6 runs are valid observations from specific test runs,
not a global parity guarantee.

Each phase passed reply/reasoning Quote insertion, file preview and local PNG
loading, with no browser errors. Smooth additionally passed durable images,
live signature filtering, settings, reduced motion and interruption/error checks.
The layout screenshot review found the preview panel obscured the chat at narrow
widths; the runner now closes it and explicitly requires visible nonzero-width
chat content before checking layout. The final visible-layout rerun is recorded
below. Earlier hidden-chat measurements are not counted as layout evidence.

`../artifacts/round2-final-visible/run.log` is the final full target acceptance:
fresh PID 22012/port 62583 and restart PID 56032/port 55643, home suffix
`nKxs9w`. It passed with default host settings and cold/warm menus 1/6 and 6/6.
Both Quote sources reached the composer, both file gestures worked, and local
Markdown PNGs plus durable assistant images loaded. It passed saved/live seat
filtering, all eight settings choices, normal/reduced-motion preview checks,
disable/reload persistence, host restart, interruption/error behavior and zero
browser errors. Live reduced-motion sampling covered 114/108 reveal nodes and
141/139 scroll states fresh/restart. Chat and English/Chinese settings fit
1400×1000, 800×900 and 390×844; screenshots were visually inspected, including
the now-visible narrow chat and Chinese settings. Both hosts and the isolated
browser were closed, and the home removed.

To reproduce from the owned root's `repo` worktree, use
`../round2-interactions.ps1 round2-<new-label>` with `DSH_QA_LAYOUT`,
`DSH_QA_IMAGES` and `DSH_QA_EDGE_CASES` set to `1`. That launcher sets signatures,
files, path images, interactions and settings to `1` using the owned Node 24 and
official target prefix. A label containing `native` selects the same fixture and
gesture helper with the native renderer. Use a new artifact label to preserve
the recorded evidence.

The final shared gesture helper checks cold right-click before preview, opens
the file with a left click, then checks a warm right-click. It requires an actual
host menu containing its Download action on both gestures. It records all labels,
item counts and whether the asynchronous path actions appeared; when those appear,
it also checks the provider supplied its opening/path group. This still rejects
the round-one missing-menu defect. The unit regression independently verifies the
full deferred file-target callback, session ID and resolved path, rather than
accepting an unrelated generic browser menu. No synthetic DOM/menu replacement
is used in final acceptance.

An intermittent `Session reference ... is released` browser error occurred
with the native renderer (`round2-native-preview-first` restart) and Smooth
(`round2-menu-timing` restart). In independent testing on retained DSH `0.2.1-rc.2`,
one of four runs failed with `Sidebar Session opening failed: session reference released`
in the host `SidebarSessionView.dispose` stack (with no Smooth Stream frames); three
reruns passed cleanly. There is no proof this is a pre-existing defect. Those runs
are retained as failed overall even when their gesture assertions passed. Earlier
diagnostic response instrumentation was removed; its runs are not the final
unmodified-host acceptance evidence.

Round-two package checks passed with owned Node 24.22.2: clean `npm ci`, unit
suite 6/6, publication-script fixture suite 10/10, real npm package check (8 files),
syntax checks, exact generated-client rebuild comparison and `git diff --check`.
`npm install --package-lock-only` leaves the committed lock unchanged. A first
shell hash check used an unavailable PowerShell cmdlet; the unchanged lock was
then verified directly with `git diff --exit-code -- package-lock.json`.
The new tarball in `../peer-round2` resolves the official target under npm's
strict peer rules, without force/legacy flags. No publication occurred.

### Round-two resources

The complete per-run PID/port/home-suffix and cleanup ledger is retained in
`../artifacts/round2-resources.json`, generated from each owned run's log by
`../round2-ledger.mjs`. It includes failed reproductions and diagnostic runs;
they are not silently counted as passes. Each home is beneath
`../qa-tmp/smooth-stream-dsh-qa-<suffix>` and each run closes its isolated Edge
instance and stops its own host. Final process verification uses command lines
matching the exact task root, not historical PID numbers.

One diagnostic route callback aborted before normal cleanup (`round2-menu-diagnostic`).
Its PID 79640 was confirmed absent and no process referenced its isolated home;
only `../qa-tmp/smooth-stream-dsh-qa-95OddV` was then removed explicitly. That
manual cleanup is recorded in the run log and ledger. This failed diagnostic is
not counted as an acceptance pass.
The final exact-root Node/Edge/Chrome process scan returned no owned QA process.

Retained for the next Attacker: `../runtime-node`, `../runtime-022rc1`,
`../runtime-021rc5`, `../runtime-021rc2`, repository `node_modules`,
`../npm-cache`, `../qa-tmp` host helper caches, `../peer-before`, `../peer-after`,
`../peer-final` (round one), `../peer-round2` (corrected package),
`../round2-baseline`, `../artifacts`, `../round2-native.mjs`,
`../round2-interactions.ps1`, and `../round2-ledger.mjs`. The pre-existing
`../attacker` tree remains unedited. No user profile or unrelated process was
used or removed. Runtime/model/platform limits stated above still apply.
