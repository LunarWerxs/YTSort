# YTSort

> Sorts a YouTube playlist you own by video length via YouTube's own reorder API, verified move by move, in seconds instead of drag-and-drop.

<!-- odin:about HAND-OWNED above the GENERATED marker. Edit freely; `odin codex about --ingest` carries it back into Odin's Codex. -->

## What it is

A userscript and Chrome extension that reorders YouTube playlists by video duration—shortest or longest first—in seconds using YouTube's InnerTube API. It replaces manual drag-and-drop, supports duration filtering and dry-run preview, and verifies every move server-side before confirming success.

## Things not to forget

_The intricacies worth remembering: the gotchas, the half-built parts, the decisions whose
reason lives nowhere else. Odin never overwrites this section._

- The InnerTube API engine re-reads server state after every batch and re-plans up to MAX_PASSES=5 times; if the list still is not converged after 5 passes it fails loudly rather than reporting a silent partial success, so a stuck sort always ends with an honest error, not a false done. anchors: `extension/ytsort2.user.js:800`
- Every UI element is built with createElement/textContent and innerHTML is never assigned, because YouTube enforces Trusted Types (require-trusted-types-for) and an innerHTML write throws there - this was discovered live and doubles as XSS protection against hostile playlist/video titles. anchors: `extension/ytsort2.user.js:147`
- Mid-run guard checks re-verify the current playlist id and that 'Manual' sort mode is still active on every loop iteration, so an SPA navigation away from the playlist during a sort aborts cleanly instead of silently reordering whatever page the user navigated to. anchors: `extension/ytsort2.user.js:640`
- The userscript header uses @grant none deliberately (no GM_* APIs anywhere in the script) so the exact same file runs unmodified as a Tampermonkey/Violentmonkey/Greasemonkey userscript, a Chrome MV3 extension content script, and a bookmarklet loader target - do not add a GM_* call without re-checking all three delivery paths. anchors: `extension/ytsort2.user.js:15`
- LockupAdapter (YouTube's newer public/logged-out playlist UI) is intentionally read-only - stats, export and dry-run work but sorting is disabled because that UI has no drag handles at all, which is a platform limitation, not a missing feature. anchors: `extension/ytsort2.user.js:322`
- InnerTube batch size defaults to 40 moves per edit_playlist request, a number the code comment says was 'proven live' on a real playlist, not chosen arbitrarily - changing it without re-testing against a large real playlist risks the phantom-move/verification logic behaving differently. anchors: `extension/ytsort2.user.js:59`
- The persistent event log is hard-capped at MAX_LOG=1000 entries (oldest entries shifted out, both in-memory and in the sessionStorage-backed copy), so very long-running or repeated sort sessions will silently lose earlier log lines rather than growing storage unbounded. anchors: `extension/ytsort2.user.js:179`

<!-- odin:about GENERATED BEGIN - rewritten by `odin codex about --publish`; edit the Codex, not this -->

## What Odin knows about this project

Everything from here down is generated from this project's Codex dossier
(`codex/projects/ytsort2-upstream.md` in the Odin clone) and is **rewritten on every publish** -
edit the dossier, not this block. Everything ABOVE the marker is yours.

### At a glance

- **Ships as:** Chrome extension (Chrome Web Store), Userscript (Greasy Fork via Tampermonkey/Violentmonkey/Greasemonkey), Bookmarklet (via GitHub Pages)
- **Live at:** https://ytsort.github.io/
- **Written in:** JavaScript (3 files), Shell (3 files)
- **CI:** `ci.yml`
- **Domain:** YouTube playlist sorting, video duration, InnerTube API, userscript platform compatibility, browser extension deployment, Trusted Types compliance, drag-and-drop simulation, DOM adapter patterns
- **Remote:** https://github.com/L0garithmic/ytsort

### Architecture

- `extension/ytsort2.user.js` - Main userscript source—~3000 lines, single-file architecture; contains all UI, sorting logic, API handlers, and adapters.
- `extension/yt.js` - Build artifact copy of ytsort2.user.js (identical content).
- `bookmarklet/` - Bookmarklet loader (30 lines)—fetches and injects the latest userscript from CDN.
- `extension/manifest.json` - Chrome MV3 manifest; declares the userscript as MV3 content script with world:MAIN for page context access.
- `assets/` - Extension icon and marketing images (marquee, panel screenshots, stats).
- `docs/REBUILD_SPEC.md` - Specification and architecture decisions; full release gate gate documentation and live test fixtures.
- `.claude/codemap/` - Generated symbol index of the userscript (2 modules, 1196 symbols).

### Features

22 recorded - 22 shipped, 0 partial, 0 planned. Each `path:line` is where the feature is DEFINED, checked by `odin codex check`.

**Shipped**

- **Sort by duration (shortest-first or longest-first)** _(free)_ - User selects sort mode (shortest or longest first) from dropdown; engine computes target order with alphabetical tiebreaker for equal-length videos. - `extension/ytsort2.user.js:48`, `extension/ytsort2.user.js:1248`
- **Entire-playlist loading and sorting** _(free)_ - Bypasses lazy-loading by walking continuation tokens to fetch all playlist items (including beyond the first ~100 on-screen), then sorts the full list. - `extension/ytsort2.user.js:452`, `extension/ytsort2.user.js:528`
- **InnerTube API engine (fast, verified)** _(free)_ - Primary engine using YouTube's authenticated InnerTube POST endpoint; batches up to 40 moves per request (~16s for 343 moves); re-reads server state to verify each pass; falls back to drag-and-drop if API unavailable. - `extension/ytsort2.user.js:381`, `extension/ytsort2.user.js:777`, `extension/ytsort2.user.js:875`
- **Drag-and-drop fallback engine** _(free)_ - Selection-sort with verified single-item drags; polls fresh DOM after every move to confirm placement; auto-activates if InnerTube endpoint is unavailable or user lacks API access. - `extension/ytsort2.user.js:505`, `extension/ytsort2.user.js:692`, `extension/ytsort2.user.js:751`
- **Duration filter scope** _(free)_ - User can restrict sorting to videos within a min/max duration range (in seconds); videos outside the range are moved to the end, preserving their relative order. - `extension/ytsort2.user.js:53`, `extension/ytsort2.user.js:1318`, `extension/ytsort2.user.js:1324`
- **Dry-run preview** _(free)_ - Shows the exact before/after order in a modal (position, title, duration columns) using the same planner logic as the live sort; user can cancel or proceed. - `extension/ytsort2.user.js:1035`, `extension/ytsort2.user.js:1064`
- **Playlist statistics** _(free)_ - Displays total duration, average video length, shortest, and longest video in the playlist or filtered scope. - `extension/ytsort2.user.js:980`
- **CSV export** _(free)_ - Exports playlist to CSV with columns: position, title, duration (formatted), URL. User can import the CSV elsewhere for record-keeping. - `extension/ytsort2.user.js:1003`
- **Light/dark theme matching** _(free)_ - Panel CSS uses CSS custom properties; theme detection via YouTube's document attribute and MutationObserver; automatically adapts to system or user preference. - `extension/ytsort2.user.js:1166`, `extension/ytsort2.user.js:1183`, `extension/ytsort2.user.js:1190`
- **Persistent event log and recovery** _(free)_ - All sort operations, moves, and errors logged to localStorage (capped at 1000 entries); log survives page reloads; user can copy log to clipboard for debugging or issue reports. - `extension/ytsort2.user.js:181`, `extension/ytsort2.user.js:212`, `extension/ytsort2.user.js:222`
- **Trusted Types enforcement (anti-XSS)** _(free)_ - UI built entirely with createElement/textContent; no innerHTML assignment. Complies with YouTube's require-trusted-types-for CSP, preventing XSS. - `extension/ytsort2.user.js:1228`
- **Multi-adapter DOM support (Polymer + Lockup)** _(free)_ - PolymerAdapter supports YouTube's current owner-view playlist UI; LockupAdapter provides read-only stats/export/dry-run for YouTube's newer lockup UI (sorting disabled for non-owners). - `extension/ytsort2.user.js:287`, `extension/ytsort2.user.js:322`, `extension/ytsort2.user.js:349`
- **Settings modal with validation and clamping** _(free)_ - User can configure pacing (ms between moves), batch size, tolerance, auto-reload, and test parameters. Schema validation prevents NaN and out-of-range values. - `extension/ytsort2.user.js:1305`, `extension/ytsort2.user.js:71`
- **Automatic re-sort with scope/mode recall** _(free)_ - Optional param autosort=1 can trigger sorting on navigation with a pre-selected mode; skips dry-run if explicitly requested. - `extension/ytsort2.user.js:1396`, `extension/ytsort2.user.js:1398`
- **Phantom move detection and recovery** _(free)_ - Tracks InnerTube move confirmations vs. server state; if a move doesn't persist, resumes from the last verified position instead of silently half-finishing. - `extension/ytsort2.user.js:236`, `extension/ytsort2.user.js:732`
- **Precondition checks (Manual sort mode, edit rights)** _(free)_ - Warns user if playlist is not set to Manual sort mode (YouTube prerequisite for reordering) or if user lacks edit rights; displays modal with clear instructions. - `extension/ytsort2.user.js:280`, `extension/ytsort2.user.js:1064`
- **Userscript header with manager directives** _(free)_ - Standard ==UserScript== header with version, namespace, match pattern, and grant directives; no GM_* API usage, so compatible across Tampermonkey, Violentmonkey, Greasemonkey. - `extension/ytsort2.user.js:1`
- **Self-healing outer loop** _(free)_ - API engine applies moves, re-reads server state, and iterates until the list matches the target order or 5 passes expire. Absorbs phantom ACKs and server-side drift; bounded by MAX_PASSES with loud failure messaging. - `extension/ytsort2.user.js:875`, `extension/ytsort2.user.js:640`
- **Platform-specific deployment (Extension, Userscript, Bookmarklet)** _(free)_ - Single ytsort2.user.js ships unchanged to Chrome Web Store (wrapped in manifest.json), Greasy Fork (standard userscript), and as a bookmarklet loader. MV3 manifest auto-injects on youtube.com. - `extension/manifest.json:1`, `bookmarklet/index.html:1`
- **Playlist mount detection and idempotent panel injection** _(free)_ - Detects /playlist page via pathname + list param; hooks Navigation API and YouTube's internal yt-navigate-finish; panel mounts only once per session, with deduping to prevent stacking. - `extension/ytsort2.user.js:1455`, `extension/ytsort2.user.js:1478`, `extension/ytsort2.user.js:1427`
- **Alphabetical tiebreaker for equal-duration videos** _(free)_ - When two videos have the same duration, the sort comparator uses title (alphabetically) as the tiebreaker; only applies if both titles are non-empty. - `extension/ytsort2.user.js:363`
- **Stop / cancel a running sort** _(free)_ - User can abort an in-progress sort, stats run, or export mid-flight; the run stops after its current verified step and reports how many moves were already applied, and a Sort/Stats/Export cannot be started while another is active. - `extension/ytsort2.user.js:561`, `extension/ytsort2.user.js:973`

### Where to add a new one

- **A new YouTube UI layout (Polymer variant, Lockup variant, or entirely new)** - Create a new adapter class (e.g., NewLayoutAdapter) implementing the handle/anchor/data/durEl/titleEl properties; register it in detectAdapter() and update the harness FakeTube mock to match the DOM structure. anchors: `extension/ytsort2.user.js:349`
- **A new move engine (alternative to InnerTube API and drag-and-drop)** - Add a method to SortRun (e.g., executeNewEngine()); update tryApiEngine() and execute() to branch on engine config; add harness scenarios under harness/run.mjs. anchors: `extension/ytsort2.user.js:751`, `extension/ytsort2.user.js:777`
- **A new filter type or scope option** - Add a property to the settings schema (validateSettings); add a dropdown in showSettingsModal() or buildPanel(); update planOrder() to filter entries based on the new criterion. anchors: `extension/ytsort2.user.js:71`, `extension/ytsort2.user.js:1305`
- **A new export format (CSV already supported)** - Add a new button in buildPanel() and a handler similar to runExport(); generate the file content and trigger a blob download. anchors: `extension/ytsort2.user.js:1003`
- **A new sort criteria (beyond duration with alphabetical tiebreaker)** - Extend the sortMode dropdown in buildPanel(); implement a new comparator in planOrder() alongside the existing duration + title logic. anchors: `extension/ytsort2.user.js:363`, `extension/ytsort2.user.js:1248`
- **A new theme or dark/light variant** - Modify CSS in injectCss() using CSS custom properties; add color vars to applyPanelTheme() or watchTheme() to detect and apply the new scheme. anchors: `extension/ytsort2.user.js:1100`, `extension/ytsort2.user.js:1183`

### Gaps and wants

_Withheld: this repository is public, and the gap list is not published outside the private index._
_Read it with `python odin.py codex brief ytsort2-upstream` in the Odin clone._

---

_Generated by `odin codex about --publish ytsort2-upstream` on 2026-09-09 from a Codex dossier stamped 2026-09-04. Regenerate after the product moves; `odin codex about` reports drift._
<!-- odin:about GENERATED END sha=920ea80892fd -->
