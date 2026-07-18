# YTSort2 rebuild spec (v5.0.0-alpha)

Every decision below traces to a confirmed finding (analysis/FINDINGS.md) or a live measurement
(analysis/SELECTOR_AUDIT.md). The harness (`harness/run.mjs --strict --script rebuild/ytsort2.user.js`)
is the acceptance gate.

## Product shape

Single-file userscript `rebuild/ytsort2.user.js` (Tampermonkey) + MV3 wrapper (`rebuild/manifest.json`,
`world: MAIN` so the script sees page context - required for the network confirmation signal).
No build step; the file is organized in labeled sections. Version line: 5.0.0-alpha.

## Architecture (finding → decision)

| Evidence | Decision |
|---|---|
| Owner view = old Polymer arch today, public = lockup; classes are a rename treadmill | `PlaylistAdapter` seam: `PolymerAdapter` (full support) + `LockupAdapter` (read-only: stats/export/dry-run; sorting reports "Cannot sort" loudly). All DOM knowledge lives in adapters |
| Live probe: 1-of-3 drags was a phantom (DOM moved, no server call) | **Verified moves**: after each drag, poll fresh DOM until the item sits at its target index; retry ≤3 with re-collected elements; then fail LOUDLY. No fixed-delay waiting anywhere (kills C3, H4, X1) |
| edit_playlist request observable per move | fetch/XHR observer in page context; advisory phantom counter (enabled only once ≥1 call has been seen, so emulators without network stay quiet) |
| v4.6.0 prints "Sort complete!" on 0 videos / partial sorts (C1, C6) | **Truth-only reporting**: final full verification pass re-reads the DOM and compares to the plan; success message only if verified; explicit partial/failed messages otherwise |
| Drag handles are display:none unless playlist sort = Manual (live finding) | Precondition check before sorting; loud instruction if not Manual |
| Double-click corruption (C4), global clobbering (H3, M4, M6) | Single `SortRun` state machine; per-run parameters (no mutated globals); Sort button disabled while running |
| Stats ReferenceError (C2), silent async deaths | Every entry point wrapped; errors land in the panel log, not just devtools |
| SPA check can never match (C5), observer stacking (M5) | `mountIfPlaylist()` idempotent; correct check (`pathname === '/playlist'` + `list` param); hooks: Navigation API `navigate`, YouTube's `yt-navigate-finish`, single deduped fallback observer |
| Dry-run used wrong sentinel (H1) | Dry-run preview and real sort share ONE planner |
| NaN settings (M1), string booleans | Typed settings schema with validation + clamping; migrates the legacy `yt_playlist_sorter_settings` key |
| README/panel mismatch (H5), invisible log (H6) | Sort mode + scope dropdowns live IN the panel; log auto-shows when a run starts; always-visible status line |
| 999…9 sentinel semantics (refuted as bug; oracle parity required) | Keep identical comparator semantics: sentinels, title tiebreaker (only when both titles non-empty), stable sort - byte-compatible with the harness oracle |

## Sort engine

Selection-sort with one verified move per step (YouTube only supports single-item drags), re-planned
from fresh DOM after every confirmed move - convergent even if a move double-applies or the list
re-renders. Global bound `n*3 + 20` moves → loud failure (livelock impossible). Loading engine polls
for growth instead of fixed sleeps (faster than v4.6.0), re-loads when the list collapses mid-sort,
and treats reported-count as advisory: within tolerance → proceed and report the delta honestly;
beyond → refuse loudly.

Terminal messages (harness markers): `Sort complete!` (only when verified), `Sort cancelled by user`,
`❌ Sort failed: …`, `Cannot sort: …`, `Sort stopped: move cap` (test mode `maxMovesPerRun`).

## Live-hardening findings (2026-07-18, found only by testing on real YouTube)

Neither of these is visible in the emulator - they were caught by the bounded live e2e on Watch
Later and are now baked into the implementation:

1. **Trusted Types**: YouTube enforces `require-trusted-types-for 'script'` - ANY `innerHTML`
   assignment throws `TrustedHTML` errors. The entire UI is built with `createElement`/`textContent`
   (`elt()` helper). Never reintroduce `innerHTML`/`insertAdjacentHTML`.
2. **Drop resolution is coordinate-sensitive**: the DESTINATION row must be scrolled into the
   viewport before firing the drag sequence - YouTube resolves the drop by viewport coordinates,
   while the dragged item rides on the event target. Scrolling the *source* into view instead
   makes the server move the video to whatever row occupies those coordinates (observed live:
   3 moves DOM-"verified" then reverted, one video landed in the wrong place). Additionally,
   Polymer applies drags optimistically and re-syncs from server data moments later, so the
   verified-move check re-confirms after a settle delay before trusting a landing.

Live e2e evidence: `analysis/fixtures/e2e-rebuild-*.json` - mount on real YouTube, 344 videos
loaded in ~4s, 3 verified moves (one auto-recovered from an optimistic revert), server-persisted
top-3 confirmed after reload. Full-playlist estimate for that WL: ~341 moves ≈ 6 min at default pacing.

## InnerTube API route - PROVEN LIVE (2026-07-18, harness/live/innertube-probe.mjs)

A direct authenticated fetch from page context performs playlist moves with zero DOM involvement.
Verified end to end on WL: `200 STATUS_SUCCEEDED`, move persisted server-side after reload
(evidence: `analysis/fixtures/innertube-probe-*.json`). The exact recipe:

1. **Item identity**: every playlist entry has a `setVideoId` (playlist-item id, distinct from the
   videoId). Source: `ytInitialData` → `playlistVideoRenderer.{videoId, setVideoId}` (and
   continuation responses for entries past the first chunk).
2. **Endpoint**: `POST https://www.youtube.com/youtubei/v1/browse/edit_playlist?prettyPrint=false`
   with `credentials: 'include'`.
3. **Auth**: `Authorization: SAPISIDHASH ${t}_${hex}` where `t` = epoch seconds and `hex` =
   SHA-1 of `"${t} ${SAPISID} https://www.youtube.com"` (the SAPISID cookie is page-readable;
   `crypto.subtle.digest` computes it in-page). Plus `X-Origin: https://www.youtube.com`.
4. **Body** (plain JSON works even though the official client gzips a compressed body):
   `{ context: ytcfg.data_.INNERTUBE_CONTEXT, playlistId, actions: [{ action: 'ACTION_MOVE_VIDEO_AFTER', setVideoId: <item to move>, movedSetVideoIdPredecessor: <item it goes after> }] }`
   (omit the predecessor to move to the top).
5. **Full-sort algorithm**: read all items once (scroll or continuation-walk), compute the target
   order, then walk it emitting one move per out-of-place item - no viewport constraints, no
   Polymer optimism, no lazy-load fights. Verification = re-fetch browse data and compare.
   Modest pacing (a few hundred ms) between calls to stay under throttling.

Phase 3 = implement this as the primary engine with the drag route as automatic fallback, behind
the same harness gate (FakeTube grows an edit_playlist emulation endpoint for it).

### Phase 3 — DONE + FULL-SORT PROVEN LIVE (2026-07-18)

Implemented as `YtApi` + `SortRun.executeApi()`; `engine: 'auto'` picks API when INNERTUBE is
available (scope=all) and falls back to drag transparently. Beyond the probe's single move:

- **Full item read via continuation-walking.** `ytInitialData` holds only the first ~100 items;
  the rest are behind continuation tokens. The reader follows them via `POST youtubei/v1/browse`
  `{context, continuation: token}`. **Token nesting is not fixed** — for Watch Later it sits at
  `continuationItemRenderer…commandExecutorCommand.commands[N].continuationCommand.token`, not the
  flat `continuationEndpoint.continuationCommand.token`. The harvester deep-searches the
  `continuationItemRenderer` subtree for any `continuationCommand.token`.
- **Self-healing outer loop.** Apply the plan, then RE-READ server truth and repeat until the
  server itself reports fully sorted (≤5 passes; abort if not converging). Absorbs phantom ACKs
  and server-side drift. Harness `api-phantom-detected` (35% phantom rate) converges 7→4→2→0.
- **FULL LIVE VALIDATION (the release gate, now passed):** entire real 344-video Watch Later
  sorted shortest-first via the API — **319 edit_playlist moves, 347s, server re-read confirmed
  fully ascending across all 344** (evidence: `analysis/fixtures/e2e-api-full-*.json`).
  No throttling at ~light pacing; pacing can be tuned faster later.

Harness: 6 API scenarios (`api-*`) added; FakeTube gained `cfg.api` (ytcfg mock, edit_playlist
endpoint, synthesized ytInitialData server read) + chaos (`apiFailProb`, `apiPhantomProb`) and a
`serverModel` distinct from the DOM so phantom/verify paths are testable. Full suite 28 SPEC / 4
bug-repros flipped, `--strict` green.

### Batched moves — 21× faster (2026-07-18)

Live probe (`harness/live/batch-probe.mjs`) proved `edit_playlist` applies MULTIPLE actions per
request, SEQUENTIALLY, including dependent chains (move X after Y, then Z after X in one body).
Cost is per-REQUEST, not per-move: a 6-action batch = ~940ms, same as a single move. So `apiPass`
now computes every action for the pass up front (simulating the sequential apply on a `live` copy
to keep predecessors correct) and sends them in `apiBatchSize` (default 40) chunks with `apiPacingMs`
between requests. **Full WL re-sort (343 moves) went from 347s → 16.1s in 9 requests** (evidence:
`analysis/fixtures/e2e-api-full-*.json`, `batch-probe-*.json`). Self-heal, stop, identity, and
move-cap checks all operate at batch granularity. New harness scenario `api-batching` asserts a
30-item shuffle sorts in ≤4 requests.

### API-engine code review (2026-07-18) — 5 confirmed, all fixed

A 13-agent adversarially-verified review of the API engine (`analysis/api-engine-review-result.json`):
5 confirmed (all fixed + re-verified live), 5 refuted (the refuters used this repo's own live
evidence — hundreds of authenticated calls — to prove the scary-sounding ones unreachable).

- **[critical] False "Sort complete!" on MAX_PASSES exhaustion.** If misplaced count strictly
  decreased each pass but never reached 0 in 5 passes, the loop fell through to an unconditional
  success log. Fixed: success is now gated on a final `bad === 0`; otherwise it fails loudly.
  New regression scenarios `api-phantom-heavy-no-false-success` (70% phantom) + hardened
  `api-phantom-detected` assert the server order actually matches any "complete" claim.
- **[critical] Partial continuation harvest looked complete.** A thrown/failed continuation fetch
  `break`s the walk and returned a short list with no signal. Fixed: `fetchServerItems` sets
  `items.truncated`, and `executeApi` refuses to sort a truncated list (falls back to drag).
- **[high] Nonsensical progress readout** (cumulative `moves` over pass-local denominator). Fixed:
  per-pass numerator (`120/343 this pass (120 total)`).
- **[high] Stop didn't cancel Stats/Export** (only the Sort run). Fixed: a shared `stoppableRun`
  the Stop button cancels for any task.
- **[medium] `engine:'api'` ignored scope.** Fixed: the API path requires `scope === 'all'`.

### Packaging — both formats verified (2026-07-18)

The single `ytsort2.user.js` ships as-is two ways, both smoke-tested:
- **Userscript**: standard `==UserScript==` header, no `GM_*` APIs → portable across Tampermonkey,
  Violentmonkey, and Greasemonkey (Firefox). GreasyFork-ready.
- **MV3 Chrome extension**: `manifest.json` (`world: MAIN`, `run_at: document_idle`). Verified by
  loading `rebuild/` unpacked via `--load-extension` - content script auto-injects and mounts the
  panel on a real YouTube playlist with zero manual paste (`harness/live/ext-smoke.mjs`).
  (Note: automating an unpacked-extension load needs bundled Chromium + a throwaway profile;
  `channel: chrome` on a shared profile silently drops the extension.)

## Explicitly deferred
- Lockup-arch sorting (no reorder affordance exists logged-out; revisit when the owner view migrates).
- GreasyFork/store release work (owner rule: only after "world's best" bar is met).

## Release gate — PASSED (2026-07-18)

The full, uncapped sort ran end to end on the real 344-video Watch Later via the API engine:
319 moves, 347s, server re-read confirmed fully ascending. The last technical gate before release
is cleared. Remaining before a public release is packaging/listing work (owner-gated), not
capability.

The FakeTube + Playwright harness is the acceptance gate for the rebuild, invoked as
`node run.mjs --script <rebuild>` (run from `harness/`, `<rebuild>` = the path to the userscript
under test, e.g. `rebuild/ytsort2.user.js`; add `--strict` for CI-mode pass/fail). All 22 SPEC
scenarios must pass `--strict` and all 4 BUG_REPRO scenarios must flip before any release build.
