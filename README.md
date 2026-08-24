<div align="center">

<img src="https://raw.githubusercontent.com/LunarWerxs/YTSort/main/extension/icons/icon128.png" width="96" height="96" alt="Sort YouTube Playlist by Duration">

# Sort YouTube Playlist by Duration

**Reorder any playlist you own by video length — shortest or longest first — in seconds.**

[![Version](https://img.shields.io/badge/version-5.2.2-e03a24)](https://github.com/LunarWerxs/YTSort/releases/latest)
[![Chrome Web Store](https://img.shields.io/badge/install-Chrome%20Web%20Store-4285F4)](https://chromewebstore.google.com/detail/sort-youtube-playlist-by/aibpphcngilopehffbmfjmiakmhfpgec)
[![Greasy Fork](https://img.shields.io/badge/install-Greasy%20Fork-670000)](https://greasyfork.org/en/scripts/552228)
[![Bookmarklet](https://img.shields.io/badge/install-Bookmarklet-f59e0b)](https://ytsort.github.io/)
[![License](https://img.shields.io/badge/license-GPL--2.0-blue)](LICENSE)
[![Made by LunarWerx](https://img.shields.io/badge/made%20by-LunarWerx-7aa2ff)](https://lunarwerx.com)

<img src="https://raw.githubusercontent.com/LunarWerxs/YTSort/main/assets/marquee.jpg" width="820" alt="Sort YouTube Playlist by Duration">

</div>

---

YTSort is a browser userscript and Chrome extension that reorders any YouTube playlist you own by
video duration, shortest or longest first, using YouTube's own playlist reorder API. It replaces
manual drag-and-drop, sorts a full playlist in seconds, and then re-reads the order from YouTube's
servers to confirm the sort actually applied.

YouTube lets you reorder a playlist by hand, one drag at a time — miserable on anything longer than
a few videos. **YTSort adds a small panel to your playlist page that sorts the whole thing by
duration for you, in seconds.**

It's a ground-up rebuild (v5) of the original script, engineered to be *fast* and *honest*: it
reorders through YouTube's own playlist API and then re-reads the result from YouTube's servers to
prove it actually worked.

## ✨ Features

- ⚡ **Fast.** Sorts through YouTube's own reorder API — a 300-video playlist finishes in seconds, not minutes.
- ✅ **Verified.** Re-reads the final order from YouTube's servers and only says "done" when it's actually sorted. It never silently half-finishes.
- 🔀 **Shortest-first or longest-first**, with an alphabetical tiebreaker for equal-length videos.
- 📃 **Whole playlist**, not just the videos currently loaded on screen.
- 🔍 **Dry Run** — preview the exact before/after order, then apply with one click.
- 🎯 **Duration filters** — only sort videos within a length range (the rest move to the end).
- 📊 **Stats** — total duration, average, shortest, and longest at a glance.
- 📥 **CSV export** — position, title, duration, and URL for the whole playlist.
- 🌗 **Native light & dark theme** — matches YouTube automatically.
- 🛟 **Drag-and-drop fallback** — used automatically if the fast path is ever unavailable.

## 📸 Screenshots

<div align="center">
<img src="https://raw.githubusercontent.com/LunarWerxs/YTSort/main/assets/panel.jpg" width="420" alt="Sorting panel">
&nbsp;
<img src="https://raw.githubusercontent.com/LunarWerxs/YTSort/main/assets/stats.jpg" width="420" alt="Playlist stats">
</div>

## 🚀 Install

### Option 1 — Bookmarklet (no install)

The lightest option: a bookmark that loads the latest version on the fly, so you never update
anything. Go to **[ytsort.github.io](https://ytsort.github.io/)**, drag the **Sort Playlist**
button to your bookmarks bar, then click it on any playlist you own.

### Option 2 — Userscript (recommended)

1. Install [Tampermonkey](https://www.tampermonkey.net/) (Chrome/Edge) or
   [Violentmonkey](https://violentmonkey.github.io/) / Greasemonkey (Firefox).
2. **[Click here to install from Greasy Fork »](https://greasyfork.org/en/scripts/552228)** — it
   updates automatically.
   <br>_Or_ open [`extension/ytsort2.user.js`](extension/ytsort2.user.js) → **Raw**, and your
   userscript manager will offer to install it.

### Option 3 — Chrome / Edge extension

**[Install from the Chrome Web Store »](https://chromewebstore.google.com/detail/sort-youtube-playlist-by/aibpphcngilopehffbmfjmiakmhfpgec)** — one click, auto-updates, and it declares zero permissions.

Prefer to load it yourself? Download `ytsort2-chrome-extension-v5.2.2.zip` from the
[latest release](https://github.com/LunarWerxs/YTSort/releases/latest) and unzip it, then go to
`chrome://extensions` → turn on **Developer mode** → **Load unpacked** → select the unzipped folder.

## ▶️ How to use

1. Open a playlist **you own** (or your **Watch Later**).
2. Set the playlist's **"Sort by" to Manual** — YouTube only allows reordering in Manual mode
   (the panel reminds you if you forget).
3. Expand the **"Sort playlist by duration"** panel below the playlist header.
4. Pick your order (shortest/longest) and scope, optionally turn on **Dry Run**, then hit **▶ Sort Videos**.
5. Watch the log — the final line tells you exactly what was verified.

> **Keep the playlist on "Manual" afterward.** Switching back to an automatic sort (Date added,
> etc.) discards your custom order.

## 🔧 How it works

YTSort reads your full playlist (following YouTube's pagination), computes the target order, and
sends batched reorder requests to YouTube's own `edit_playlist` endpoint using your existing
session — no dragging, no scrolling, no fighting lazy-loading. After the moves, it fetches the
playlist back from the server and compares it to the plan; if anything didn't stick, it re-applies
just the stragglers, then reports the verified result. If the API path is ever unavailable it
falls back to a carefully verified drag-and-drop engine.

## 🔒 Privacy

**YTSort collects no data.** Your settings live only in your browser, and the only network
requests it makes are to `youtube.com` — to read and reorder *your own* playlists, using *your*
login. Nothing is ever sent to us or any third party. Full policy: [PRIVACY.md](PRIVACY.md).

## 🧯 Troubleshooting

- **Panel missing?** Make sure you're on a `/playlist` page. Reload as a last resort.
- **"Cannot sort: drag handles are hidden"** → set the playlist's *Sort by* to **Manual**.
- **"Sort failed: move did not apply"** → YouTube is throttling or changed its layout; wait a
  moment and click Sort again. It resumes from wherever it verified.
- Anything unexpected? Grab the log with **Copy Log** and
  [open an issue](https://github.com/LunarWerxs/YTSort/issues).

## ❓ FAQ

- **Is YTSort free?** Yes. YTSort is free and open source under the GPL-2.0-only license. All
  three install options, the bookmarklet, the Greasy Fork userscript, and the Chrome Web Store
  extension, cost nothing and include the same features: dry run, duration filters, stats, and
  CSV export.
- **Does it work offline?** No. YTSort needs a live connection to youtube.com to read your
  playlist and send reorder requests through YouTube's own API, then verify the result. It runs
  entirely in your browser using your existing YouTube session, but it can't sort a playlist
  while you're offline.
- **What are the system requirements?** None beyond a browser. The Chrome Web Store extension
  needs Chrome or Edge. The userscript works in any browser with Tampermonkey, Violentmonkey, or
  Greasemonkey installed, including Firefox. The bookmarklet needs no install at all, just drag
  it to your bookmarks bar in any browser.
- **How is it different from other YouTube playlist sorters?** YTSort focuses narrowly on one
  job: verified duration sorting. KohGeek's Sort Youtube Playlist by Duration userscript covers
  similar ground, working client-side in the open tab. PocketTube is a broader subscription and
  playlist manager whose feature list includes filtering and sorting videos by duration, among
  much else. YTSort's distinct trait is re-reading the finished order from YouTube's servers
  before reporting success.
- **Is my data sent anywhere?** No. YTSort collects no data and has no backend of its own. The
  only network requests it makes are to youtube.com, to read and reorder your own playlists using
  your existing login. Nothing is sent to LunarWerx or any third party; see
  [PRIVACY.md](PRIVACY.md) for the full policy.
- **Does the Chrome extension need any special permissions?** No. Both the Chrome Web Store
  listing and the extension's manifest declare zero permissions. It runs only as a content script
  on youtube.com pages and talks to YouTube's own API using your already-open browser session, so
  there's nothing extra to grant.
- **What happens if a move doesn't apply?** YTSort logs it and resumes from the last verified
  position instead of failing silently. After every reorder pass it re-reads the playlist from
  YouTube's servers, and if a move didn't stick it re-applies just that straggler until the whole
  playlist matches the target order, then reports success.
- **Can I sort playlists I don't own?** No. YTSort can only reorder playlists you have edit
  rights to: playlists you created, or your Watch Later list. YouTube itself doesn't allow
  reordering playlists you don't own, and the playlist's "Sort by" must be set to Manual before
  YTSort can move anything.

## 🙌 Credits

Built by **[LunarWerx](https://lunarwerx.com)** · [github.com/LunarWerxs](https://github.com/LunarWerxs)

Made by [LunarWerx](https://lunarwerx.com), also behind [RepoYeti](https://repoyeti.com),
[SageThumbs](https://sagethumbs.lunarwerx.com), and
[QuickDictate](https://quickdictate.lunarwerx.com).

## 📄 License

[GPL-2.0-only](LICENSE)
