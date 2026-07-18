<div align="center">

<img src="https://raw.githubusercontent.com/LunarWerxs/YTSort/main/extension/icons/icon128.png" width="96" height="96" alt="Sort YouTube Playlist by Duration">

# Sort YouTube Playlist by Duration

**Reorder any playlist you own by video length — shortest or longest first — in seconds.**

[![Version](https://img.shields.io/badge/version-5.0.0-e03a24)](https://github.com/LunarWerxs/YTSort/releases)
[![License](https://img.shields.io/badge/license-GPL--2.0-blue)](LICENSE)
[![Userscript](https://img.shields.io/badge/install-Greasy%20Fork-670000)](https://greasyfork.org/en/scripts/552228)
[![Made by LunarWerx](https://img.shields.io/badge/made%20by-LunarWerx-7aa2ff)](https://lunarwerx.com)

<img src="https://raw.githubusercontent.com/LunarWerxs/YTSort/main/assets/marquee.jpg" width="820" alt="Sort YouTube Playlist by Duration">

</div>

---

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

### Option 3 — Chrome extension (unpacked)

1. [Download this repository](https://github.com/LunarWerxs/YTSort/archive/refs/heads/main.zip) and unzip it.
2. Go to `chrome://extensions` → turn on **Developer mode**.
3. Click **Load unpacked** → select the **`extension`** folder.

_(A one-click Chrome Web Store listing is on the way.)_

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

## 🙌 Credits

Built by **[LunarWerx](https://lunarwerx.com)** · [github.com/LunarWerxs](https://github.com/LunarWerxs)

## 📄 License

[GPL-2.0-only](LICENSE)
