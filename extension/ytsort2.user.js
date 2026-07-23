// ==UserScript==
// @name              Sort YouTube Playlist by Duration
// @namespace         https://github.com/L0garithmic/ytsort/
// @version           5.2.0
// @description       Sort any playlist you own by video length (shortest or longest first) in seconds, via YouTube's own reorder API with a drag-and-drop fallback.
// @author            LunarWerx
// @license           GPL-2.0-only
// @homepageURL       https://github.com/LunarWerxs/YTSort
// @supportURL        https://github.com/LunarWerxs/YTSort/issues
// @icon              https://raw.githubusercontent.com/LunarWerxs/YTSort/main/extension/icons/icon48.png
// @downloadURL       https://raw.githubusercontent.com/LunarWerxs/YTSort/main/extension/ytsort2.user.js
// @updateURL         https://raw.githubusercontent.com/LunarWerxs/YTSort/main/extension/ytsort2.user.js
// @match             http://*.youtube.com/*
// @match             https://*.youtube.com/*
// @grant             none
// @run-at            document-idle
// ==/UserScript==

/*
 * YTSort2 rebuild. Design: rebuild/REBUILD_SPEC.md. Acceptance: harness/run.mjs --strict.
 * Core rules: every move is VERIFIED against the DOM (no fixed-delay trust), the final report
 * only says "Sort complete!" after a full re-verification pass, and every failure is loud.
 */
(() => {
  'use strict';
  const VERSION = '5.2.0';
  if (window.__ytsort2Loaded) return; // idempotent across double-injection
  window.__ytsort2Loaded = true;

  // ======================================================================== settings
  const SETTINGS_KEY = 'ytsort2.settings';
  const LEGACY_KEY = 'yt_playlist_sorter_settings';
  const SENTINEL_LAST = 999999999999999999; // parity with v4.x + harness oracle

  const DEFAULTS = Object.freeze({
    sortMode: 'asc',          // 'asc' | 'desc'
    scope: 'all',             // 'all' | 'loaded'
    pacing: 400,              // ms base unit for scroll/poll pacing (>=100)
    tolerancePct: 10,         // acceptable missing % vs reported count (0-100)
    dryRun: false,
    filterEnabled: false,
    filterMinSec: 0,
    filterMaxSec: 36000,
    logVisible: true,
    maxMovesPerRun: 0,        // 0 = unlimited (test hook)
    engine: 'auto',          // 'auto' (API if available, else drag) | 'api' | 'drag'
    apiBatchSize: 40,        // moves per edit_playlist request (batching proven live 2026-07-18)
    apiPacingMs: 250,        // delay between batch requests
    reloadAfterSort: true,   // refresh the page after a successful sort so the new order is visible
  });

  const num = (v, dflt, lo, hi) => {
    const n = typeof v === 'string' ? parseInt(v, 10) : v;
    if (typeof n !== 'number' || !Number.isFinite(n)) return dflt;
    return Math.min(hi, Math.max(lo, n));
  };
  const bool = (v, dflt) => (typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : dflt);

  const validateSettings = (raw) => {
    const out = {
      sortMode: raw.sortMode === 'desc' ? 'desc' : 'asc',
      scope: raw.scope === 'loaded' ? 'loaded' : 'all',
      pacing: num(raw.pacing, DEFAULTS.pacing, 100, 5000),
      tolerancePct: num(raw.tolerancePct, DEFAULTS.tolerancePct, 0, 100),
      dryRun: bool(raw.dryRun, DEFAULTS.dryRun),
      filterEnabled: bool(raw.filterEnabled, DEFAULTS.filterEnabled),
      filterMinSec: num(raw.filterMinSec, DEFAULTS.filterMinSec, 0, 360000),
      filterMaxSec: num(raw.filterMaxSec, DEFAULTS.filterMaxSec, 0, 360000),
      logVisible: bool(raw.logVisible, DEFAULTS.logVisible),
      maxMovesPerRun: num(raw.maxMovesPerRun, 0, 0, 100000),
      engine: ['auto', 'api', 'drag'].includes(raw.engine) ? raw.engine : 'auto',
      apiBatchSize: num(raw.apiBatchSize, DEFAULTS.apiBatchSize, 1, 100),
      apiPacingMs: num(raw.apiPacingMs, DEFAULTS.apiPacingMs, 0, 10000),
      reloadAfterSort: bool(raw.reloadAfterSort, DEFAULTS.reloadAfterSort),
    };
    if (out.filterMinSec > out.filterMaxSec) [out.filterMinSec, out.filterMaxSec] = [out.filterMaxSec, out.filterMinSec];
    return out;
  };

  const loadSettings = () => {
    try {
      const stored = localStorage.getItem(SETTINGS_KEY);
      if (stored) return validateSettings({ ...DEFAULTS, ...JSON.parse(stored) });
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        const l = JSON.parse(legacy);
        return validateSettings({
          ...DEFAULTS,
          sortMode: l.sortMode,
          scope: bool(l.autoScrollInitialVideoList, true) ? 'all' : 'loaded',
          pacing: l.scrollLoopTime,
          tolerancePct: l.mismatchTolerancePercent,
          dryRun: l.dryRunEnabled,
          filterEnabled: l.filterEnabled,
          filterMinSec: l.filterMinDuration,
          filterMaxSec: l.filterMaxDuration,
          logVisible: l.logVisible,
          maxMovesPerRun: l.maxMovesPerRun,
        });
      }
    } catch (e) { console.error('[YTSort2] settings load failed:', e); }
    return { ...DEFAULTS };
  };
  const saveSettings = (s) => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { console.error('[YTSort2] settings save failed:', e); }
  };
  let settings = loadSettings();

  // ======================================================================== utils
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const ts = () => {
    const d = new Date();
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map((x) => String(x).padStart(2, '0')).join(':');
  };

  const parseDurationText = (text) => {
    const t = (text || '').trim();
    if (!/^\d+:\d{1,2}(:\d{1,2})?$/.test(t)) return null; // LIVE / SHORTS / empty → null
    const parts = t.split(':').reverse();
    let sec = parseInt(parts[0], 10) || 0;
    if (parts[1]) sec += (parseInt(parts[1], 10) || 0) * 60;
    if (parts[2]) sec += (parseInt(parts[2], 10) || 0) * 3600;
    return sec;
  };
  const fmtDuration = (s) => {
    if (s === null || s === undefined) return 'N/A';
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
  };
  const fmtLong = (s) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h > 0 ? `${h}h ${m}m ${sec}s` : m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  };

  // DOM builder - NEVER use innerHTML: YouTube enforces Trusted Types (TrustedHTML) and any
  // innerHTML assignment throws. Discovered live 2026-07-18; also safer with hostile titles.
  const elt = (tag, attrs = {}, ...children) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'checked') e.checked = !!v;
      else if (k === 'value') e.value = v;
      else e.setAttribute(k, String(v));
    }
    for (const c of children) if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    return e;
  };

  // Poll a predicate; resolves true when it passes, false on timeout or abort.
  const pollUntil = async (pred, timeoutMs, intervalMs, isAborted) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (isAborted && isAborted()) return false;
      let ok = false;
      try { ok = !!pred(); } catch { /* transient DOM churn */ }
      if (ok) return true;
      if (Date.now() >= deadline) return false;
      await wait(intervalMs);
    }
  };

  // ======================================================================== logging
  let logEl = null;
  let statusEl = null;
  const logEntries = [];
  const MAX_LOG = 1000;

  const renderLog = () => { // full rebuild - only used when a fresh panel adopts an existing log
    if (!logEl) return;
    logEl.textContent = '';
    for (const e of logEntries) logEl.appendChild(elt('div', { class: 'yts2-log-line', text: e.line }));
    if (!logEntries.length) logEl.textContent = '[Ready]';
    logEl.scrollTop = logEl.scrollHeight;
  };
  const log = (msg) => {
    const line = `[${ts()}] ${msg}`; // timestamped in BOTH console and panel
    console.log(line);
    logEntries.push({ line });
    if (logEntries.length > MAX_LOG) logEntries.shift();
    if (logEl) { // O(1) append instead of rebuilding the whole log each call
      if (logEntries.length === 1) logEl.textContent = '';
      logEl.appendChild(elt('div', { class: 'yts2-log-line', text: line }));
      while (logEl.childElementCount > MAX_LOG) logEl.removeChild(logEl.firstChild);
      logEl.scrollTop = logEl.scrollHeight;
    }
  };
  const setStatus = (msg) => { if (statusEl) statusEl.textContent = msg; };
  const showLog = () => {
    if (logEl) logEl.style.display = 'block';
    const details = document.querySelector('.sort-playlist-details');
    if (details && !details.open) details.open = true;
  };

  // ======================================================================== network signal
  // Advisory phantom-move detector: counts the page's own edit_playlist calls. Only consulted
  // once at least one call has been observed (so DOM-only environments stay silent).
  const netSignal = { calls: 0, everSeen: false };
  const hookNetwork = () => {
    try {
      const origFetch = window.fetch;
      if (origFetch) {
        window.fetch = function (...a) {
          try {
            const u = typeof a[0] === 'string' ? a[0] : (a[0] && a[0].url) || '';
            if (u.includes('edit_playlist')) { netSignal.calls++; netSignal.everSeen = true; }
          } catch { /* never break the page */ }
          return origFetch.apply(this, a);
        };
      }
      const origOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (m, u, ...rest) {
        try { if (String(u).includes('edit_playlist')) { netSignal.calls++; netSignal.everSeen = true; } } catch { /* noop */ }
        return origOpen.call(this, m, u, ...rest);
      };
    } catch (e) { console.warn('[YTSort2] network hook unavailable:', e); }
  };

  // ======================================================================== adapters
  // All DOM knowledge lives here. entry: { el, handle, id, title, durSec }
  const readReportedCount = () => {
    // current camelCase view-model rows, then legacy selectors
    const texts = [];
    for (const el of document.querySelectorAll('.ytContentMetadataViewModelMetadataRow span')) texts.push(el.textContent);
    for (const el of document.querySelectorAll('ytd-playlist-byline-renderer .metadata-stats span, .metadata-stats span.yt-formatted-string')) texts.push(el.textContent);
    for (const t of texts) {
      // locale-tolerant: grouping may be "," "." NBSP or thin space ("1.234 Videos", "1 234 vidéos")
      const m = (t || '').match(/(\d[\d.,\s  ]*)\s*videos?/i);
      if (m) {
        const n = parseInt(m[1].replace(/\D/g, ''), 10);
        if (Number.isFinite(n)) return n;
      }
    }
    return null;
  };

  const currentListId = () => (location.pathname === '/playlist' ? new URLSearchParams(location.search).get('list') : null);

  // Is this playlist reorderable by the current user? Owned/editable playlists expose a "Sort by"
  // menu that offers a "Manual" option (and render drag handles in Manual mode). Playlists you don't
  // own have neither, so we say so clearly instead of failing with a confusing error.
  const playlistIsEditable = () => {
    const menu = document.querySelector('yt-sort-filter-sub-menu-renderer, ytd-sort-filter-sub-menu-renderer');
    if (menu && /manual/i.test(menu.textContent || '')) return true;
    if (document.querySelector('ytd-playlist-video-renderer yt-icon#reorder')) return true;
    return false;
  };

  const PolymerAdapter = {
    name: 'polymer',
    present: () => !!document.querySelector('ytd-playlist-video-renderer'),
    canSort: true,
    collect() {
      const scope = document.querySelector('ytd-playlist-video-list-renderer') || document;
      const out = [];
      let i = 0;
      for (const el of scope.querySelectorAll('ytd-playlist-video-renderer')) {
        const handle = el.querySelector('yt-icon#reorder');
        const anchor = el.querySelector('a#thumbnail');
        const idm = anchor && anchor.href ? anchor.href.match(/[?&]v=([A-Za-z0-9_-]+)/) : null;
        const durEl = anchor && anchor.querySelector('#text');
        const titleEl = el.querySelector('#video-title');
        const data = el.data || el.__data || null; // Polymer element data carries setVideoId (playlist-item id)
        out.push({
          el, handle,
          id: idm ? idm[1] : `__idx${i}`,
          setVideoId: (data && (data.setVideoId || (data.playlistVideoRenderer && data.playlistVideoRenderer.setVideoId))) || null,
          title: titleEl ? titleEl.textContent.trim() : '',
          durSec: durEl ? parseDurationText(durEl.innerText || durEl.textContent) : null,
          url: anchor && anchor.href ? anchor.href : '',
        });
        i++;
      }
      return out;
    },
    manualSortActive() {
      const h = document.querySelector('ytd-playlist-video-renderer yt-icon#reorder');
      if (!h) return null;
      return h.offsetParent !== null && getComputedStyle(h).display !== 'none';
    },
    reportedCount: readReportedCount,
  };

  const LockupAdapter = {
    name: 'lockup',
    present: () => !!document.querySelector('yt-lockup-view-model'),
    canSort: false, // no reorder affordance exists in this view (2026-07 capture)
    collect() {
      const out = [];
      let i = 0;
      for (const el of document.querySelectorAll('yt-lockup-view-model')) {
        const badge = el.querySelector('badge-shape');
        const titleEl = el.querySelector('h3.ytLockupMetadataViewModelHeadingReset a, a.ytLockupMetadataViewModelTitle, h3');
        const anchor = el.querySelector('a');
        const idm = anchor && anchor.href ? anchor.href.match(/[?&]v=([A-Za-z0-9_-]+)/) : null;
        out.push({
          el, handle: null,
          id: idm ? idm[1] : `__idx${i}`,
          title: titleEl ? titleEl.textContent.trim() : '',
          durSec: badge ? parseDurationText(badge.textContent) : null,
          url: anchor && anchor.href ? anchor.href : '',
        });
        i++;
      }
      return out;
    },
    manualSortActive: () => null,
    reportedCount: readReportedCount,
  };

  const detectAdapter = () => {
    if (PolymerAdapter.present()) return PolymerAdapter;
    if (LockupAdapter.present()) return LockupAdapter;
    return null;
  };

  // ======================================================================== planner (oracle-parity)
  const sortKey = (entry, s) => {
    const passes = !s.filterEnabled ? true
      : entry.durSec === null ? false
        : entry.durSec >= s.filterMinSec && entry.durSec <= s.filterMaxSec;
    if (!passes || entry.durSec === null) return s.sortMode === 'asc' ? SENTINEL_LAST : -1;
    return entry.durSec;
  };
  const planOrder = (entries, s) => {
    const keyed = entries.map((e, i) => ({ e, key: sortKey(e, s), i }));
    keyed.sort((a, b) => {
      if (a.key !== b.key) return s.sortMode === 'asc' ? a.key - b.key : b.key - a.key;
      if (a.e.title && b.e.title) return a.e.title.localeCompare(b.e.title);
      return 0; // stable sort preserves relative order
    });
    return keyed.map((k) => k.e);
  };
  const misplacedCount = (entries, target) => {
    let bad = 0;
    for (let i = 0; i < target.length; i++) if (entries[i] && entries[i].id !== target[i].id) bad++;
    return bad;
  };

  // ======================================================================== InnerTube API engine (proven live 2026-07-18)
  // Reorders via YouTube's own edit_playlist endpoint - no DOM drags, no viewport constraints,
  // no lazy-load fighting. Requires: playlist-item ids (setVideoId), an INNERTUBE_CONTEXT, and
  // page-context SAPISIDHASH auth. Verification reads server truth from a fresh page fetch.
  const YtApi = {
    available() {
      const d = window.ytcfg && window.ytcfg.data_;
      return !!(d && d.INNERTUBE_CONTEXT);
    },
    async sapisidHash() {
      const get = (n) => (document.cookie.split('; ').find((c) => c.startsWith(n + '=')) || '').split('=')[1];
      const sapisid = get('SAPISID') || get('__Secure-3PAPISID') || get('__Secure-1PAPISID');
      if (!sapisid) return null;
      const t = Math.floor(Date.now() / 1000);
      const origin = 'https://www.youtube.com';
      const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`${t} ${sapisid} ${origin}`));
      const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
      return `SAPISIDHASH ${t}_${hex}`;
    },
    extractInitialData(html) {
      const m = html.match(/ytInitialData\s*=\s*(\{.*?\});<\/script>/s) || html.match(/ytInitialData"?\]?\s*=\s*(\{.*?\});/s);
      try { return m ? JSON.parse(m[1]) : (window.ytInitialData || null); } catch { return null; }
    },
    // token nesting varies (continuationEndpoint.continuationCommand.token OR
    // ...commandExecutorCommand.commands[N].continuationCommand.token) - deep-search the subtree
    findToken(x) {
      if (!x || typeof x !== 'object') return null;
      if (x.continuationCommand && x.continuationCommand.token) return x.continuationCommand.token;
      for (const k in x) { const t = this.findToken(x[k]); if (t) return t; }
      return null;
    },
    // Harvest playlistVideoRenderer items AND the video-list continuation token. CRITICAL: a
    // playlist page can have MULTIPLE continuationItemRenderers (video list + related sections);
    // the RIGHT token is the one that is a SIBLING of the playlistVideoRenderer items. Grabbing any
    // continuationItemRenderer (e.g. a related-playlists section) yields a token YouTube answers
    // with an empty page, so only 100 videos ever load. (Live-confirmed bug, 2026-07-18.)
    harvest(root, items) {
      let token = null;
      const walk = (o) => {
        if (!o || typeof o !== 'object') return;
        if (Array.isArray(o)) {
          let hasVideos = false, sibToken = null;
          for (const el of o) {
            if (el && el.playlistVideoRenderer) hasVideos = true;
            if (el && el.continuationItemRenderer) { const t = this.findToken(el.continuationItemRenderer); if (t) sibToken = t; }
          }
          if (hasVideos && sibToken) token = sibToken; // only trust a token that sits WITH the videos
          for (const el of o) walk(el);
          return;
        }
        if (o.playlistVideoRenderer && o.playlistVideoRenderer.videoId) {
          const r = o.playlistVideoRenderer;
          const title = (r.title && (r.title.simpleText || (r.title.runs && r.title.runs.map((x) => x.text).join('')))) || '';
          let durSec = r.lengthSeconds ? parseInt(r.lengthSeconds, 10) : null;
          if (!Number.isFinite(durSec)) durSec = null;
          items.push({ id: r.videoId, setVideoId: r.setVideoId || null, title, durSec });
          return;
        }
        for (const k in o) walk(o[k]);
      };
      walk(root);
      return token;
    },
    // Read the FULL item list (id, setVideoId, title, durSec) - initial page data then every
    // continuation page. This is the authoritative, fully-loaded list with no DOM scrolling.
    async fetchServerItems(listId) {
      const res = await fetch(`https://www.youtube.com/playlist?list=${listId}`, { credentials: 'include' });
      const data = this.extractInitialData(await res.text());
      if (!data) return null;
      const items = [];
      let token = this.harvest(data, items);
      const context = window.ytcfg.data_.INNERTUBE_CONTEXT;
      const key = window.ytcfg.data_.INNERTUBE_API_KEY;
      let guard = 0, truncated = false;
      while (token && guard < 80) {
        guard++;
        const auth = await this.sapisidHash();
        let cjson = null;
        try {
          const cres = await fetch('https://www.youtube.com/youtubei/v1/browse' + (key ? `?key=${key}` : '?prettyPrint=false'), {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json', 'Authorization': auth, 'X-Origin': 'https://www.youtube.com' },
            body: JSON.stringify({ context, continuation: token }),
          });
          if (!cres.ok) { truncated = true; break; } // a failed continuation = incomplete list
          cjson = await cres.json();
        } catch { truncated = true; break; }
        const nextToken = this.harvest(cjson, items);
        if (nextToken === token) { truncated = true; break; } // stuck: didn't advance
        token = nextToken;
      }
      if (guard >= 80 && token) truncated = true; // hit the page cap with more to read
      // truncated marks a list that is NOT known-complete - callers must not treat it as authoritative
      items.truncated = truncated;
      return items;
    },
    // Send a BATCH of actions in one edit_playlist request. The server applies them sequentially,
    // including dependent chains (proven live 2026-07-18: a 6-move batch costs the same ~940ms as
    // a single move - the request, not the move, is the unit of cost).
    async sendActions(listId, context, actions) {
      const auth = await this.sapisidHash();
      if (!auth) return { ok: false, error: 'no-sapisid' };
      const t0 = Date.now();
      let res;
      try {
        res = await fetch('https://www.youtube.com/youtubei/v1/browse/edit_playlist?prettyPrint=false', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'Authorization': auth, 'X-Origin': 'https://www.youtube.com' },
          body: JSON.stringify({ context, playlistId: listId, actions }),
        });
      } catch (e) { return { ok: false, error: 'network: ' + (e && e.message ? e.message : e) }; }
      let j = null; try { j = await res.json(); } catch { /* non-json */ }
      const succeeded = res.ok && (!j || !j.status || j.status === 'STATUS_SUCCEEDED');
      return { ok: succeeded, ms: Date.now() - t0, httpStatus: res.status, apiStatus: j && j.status, error: !succeeded ? (j && j.error && (j.error.message || j.error)) || ('http ' + res.status) : null };
    },
  };

  // ======================================================================== drag (proven sequence, live 2026-07-18)
  const fireMouse = (type, elem, cx, cy) => {
    elem.dispatchEvent(new MouseEvent(type, { view: window, bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
  };
  const simulateDrag = (elemDrag, elemDrop) => {
    let p = elemDrag.getBoundingClientRect();
    const c1x = Math.floor((p.left + p.right) / 2), c1y = Math.floor((p.top + p.bottom) / 2);
    p = elemDrop.getBoundingClientRect();
    const c2x = Math.floor((p.left + p.right) / 2), c2y = Math.floor((p.top + p.bottom) / 2);
    fireMouse('mousemove', elemDrag, c1x, c1y); fireMouse('mouseenter', elemDrag, c1x, c1y);
    fireMouse('mouseover', elemDrag, c1x, c1y); fireMouse('mousedown', elemDrag, c1x, c1y);
    fireMouse('dragstart', elemDrag, c1x, c1y); fireMouse('drag', elemDrag, c1x, c1y);
    fireMouse('mousemove', elemDrag, c1x, c1y); fireMouse('drag', elemDrag, c2x, c2y);
    fireMouse('mousemove', elemDrop, c2x, c2y); fireMouse('mouseenter', elemDrop, c2x, c2y);
    fireMouse('dragenter', elemDrop, c2x, c2y); fireMouse('mouseover', elemDrop, c2x, c2y);
    fireMouse('dragover', elemDrop, c2x, c2y); fireMouse('drop', elemDrop, c2x, c2y);
    fireMouse('dragend', elemDrag, c2x, c2y); fireMouse('mouseup', elemDrag, c2x, c2y);
  };

  // ======================================================================== loading engine
  const scrollToBottom = () => { const se = document.scrollingElement; if (se) se.scrollTop = se.scrollHeight; };
  const scrollToTop = () => { const se = document.scrollingElement; if (se) se.scrollTop = 0; };

  // Loads until no growth for 3 stable checks (or reported count reached). Poll-based, no fixed sleeps.
  const loadAll = async (adapter, run, reported) => {
    let entries = adapter.collect();
    let stable = 0, guard = 0;
    while (!run.stopRequested && stable < 3 && guard < 80) {
      const before = entries.length;
      if (reported !== null && before >= reported) break;
      scrollToBottom();
      const grew = await pollUntil(() => adapter.collect().length > before, run.pacing * 6, Math.max(100, run.pacing / 2), () => run.stopRequested);
      entries = adapter.collect();
      if (grew && entries.length > before) {
        stable = 0;
        log(`Loaded ${entries.length}${reported ? ' / ' + reported : ''} videos…`);
      } else stable++;
      guard++;
    }
    scrollToTop();
    await wait(Math.max(120, run.pacing / 3));
    return adapter.collect();
  };

  // ======================================================================== sort controller
  let activeRun = null;

  class SortRun {
    constructor(adapter, s) {
      this.adapter = adapter;
      this.s = { ...s };            // frozen per-run copy — globals are never mutated (H3/M4)
      this.pacing = this.s.pacing;
      this.stopRequested = false;
      this.moves = 0;
      this.phantomSuspects = 0;
      this.listId = currentListId(); // the playlist this run belongs to - re-checked every iteration
    }
    stop() { this.stopRequested = true; }
    async waitAbortable(ms) { // Stop must be able to preempt settle delays
      const end = Date.now() + ms;
      while (Date.now() < end && !this.stopRequested) await wait(Math.min(60, end - Date.now()));
    }
    // After an API sort the reorder is on YouTube's servers but the on-screen list is still the old
    // order - refresh so the user sees the result. Guarded to real youtube.com so the test harness
    // (127.0.0.1) never reloads (which would reset the emulator).
    maybeReload() {
      if (this.s.reloadAfterSort && /(^|\.)youtube\.com$/i.test(location.hostname)) {
        log('🔄 Refreshing the page to show the sorted order…');
        setTimeout(() => { try { location.reload(); } catch { /* ignore */ } }, 1500);
      }
    }

    async execute() {
      const { adapter, s } = this;
      const reported = adapter.reportedCount();
      // Editability precondition (applies to both engines): only playlists you own can be reordered.
      if (!playlistIsEditable()) {
        return this.fail('Cannot sort this playlist. You can only reorder a playlist you own (or your Watch Later). Nothing was changed.');
      }
      if (s.filterEnabled) log(`🎯 Filter: ${Math.floor(s.filterMinSec / 60)}-${Math.floor(s.filterMaxSec / 60)} min (outside range → end of list)`);

      // ---- engine selection: API is primary when available (instant, no DOM), drag is fallback ----
      // API engine sorts the WHOLE server playlist, so it only applies to scope 'all' (even when
      // explicitly requested). scope 'loaded' always uses the DOM drag engine.
      const wantApi = s.scope === 'all' && this.listId && (s.engine === 'api' || (s.engine === 'auto' && YtApi.available()));
      if (wantApi) {
        if (!YtApi.available()) return this.fail('❌ Sort failed: API engine requested but INNERTUBE_CONTEXT is unavailable on this page.');
        const apiResult = await this.executeApi();
        if (apiResult) return apiResult; // null → API not viable (e.g. no setVideoIds); fall through to drag
        log('ℹ️ API engine unavailable for this playlist - falling back to drag engine.');
      }

      // ---- load phase ----
      let entries = s.scope === 'all' ? await loadAll(adapter, this, reported) : adapter.collect();
      if (this.stopRequested) return this.cancelled();
      if (entries.length === 0) return this.fail(`Cannot sort: found 0 videos on this page (adapter: ${adapter.name}). Nothing was changed.`);

      // ---- preconditions ----
      if (!adapter.canSort) {
        return this.fail(`Cannot sort: this playlist view (${adapter.name} layout) has no reorder handles. Stats, Export and Dry Run still work. Nothing was changed.`);
      }
      const manual = adapter.manualSortActive();
      if (manual === false) {
        return this.fail('Cannot sort: drag handles are hidden because the playlist "Sort by" is not set to Manual. Switch it to Manual and try again. Nothing was changed.');
      }
      const missing = reported !== null ? Math.max(0, reported - entries.length) : 0;
      if (reported !== null && missing > 0) {
        const allowed = Math.ceil((s.tolerancePct / 100) * reported);
        if (missing > allowed) {
          return this.fail(`❌ Sort failed: only ${entries.length} of ${reported} reported videos loaded (missing ${missing}, tolerance allows ${allowed}). Increase tolerance in Settings or retry. Nothing was sorted.`);
        }
        log(`⚠️ Proceeding with ${entries.length} of ${reported} reported videos (${missing} unavailable/not loaded, within ${s.tolerancePct}% tolerance).`);
      }

      const totalPlanned = misplacedCount(entries, planOrder(entries, s));
      log(`📊 ${entries.length} videos loaded, ~${totalPlanned} moves needed.`);
      if (totalPlanned === 0) {
        log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        log('✅ Sort complete! Playlist was already in order (0 moves).');
        setStatus('Done - already sorted');
        return { ok: true, moves: 0 };
      }

      // ---- move loop: one VERIFIED move per iteration, replanned from fresh DOM ----
      const maxSeen = { n: entries.length };
      let moveCap = entries.length * 3 + 20; // grows with maxSeen (late-loading playlists)
      const startNetCalls = netSignal.calls;

      for (;;) {
        if (this.stopRequested) return this.cancelled();
        // identity + precondition re-checks: SPA navigation mid-run must never sort another playlist
        if (currentListId() !== this.listId) {
          return this.fail(`❌ Sort failed: the page navigated away from the playlist mid-sort (${this.listId} → ${currentListId() || 'not a playlist'}). ${this.moves} verified moves were applied before stopping. Nothing on the new page was touched.`);
        }
        if (adapter.manualSortActive() === false) {
          return this.fail(`❌ Sort failed: the playlist "Sort by" left Manual mode mid-run - drag handles are hidden. Switch back to Manual and run Sort again. ${this.moves} verified moves were applied.`);
        }
        if (s.maxMovesPerRun > 0 && this.moves >= s.maxMovesPerRun) {
          log(`Sort stopped: move cap ${s.maxMovesPerRun} reached (test mode). ${this.moves} verified moves applied.`);
          setStatus('Stopped at move cap');
          return { ok: false, capped: true, moves: this.moves };
        }
        if (this.moves >= moveCap) {
          return this.fail(`❌ Sort failed: exceeded the safety bound of ${moveCap} moves without converging - aborting to avoid a livelock. ${this.moves} moves were applied; verify the playlist manually.`);
        }

        entries = adapter.collect();
        // list collapsed mid-sort (lazy unload)? confirm it is not a transient render dip first
        if (s.scope === 'all' && entries.length < maxSeen.n) {
          await this.waitAbortable(Math.max(200, this.pacing / 2));
          entries = adapter.collect();
        }
        if (s.scope === 'all' && entries.length < maxSeen.n) {
          log(`⚠️ List collapsed to ${entries.length}/${maxSeen.n} - re-loading…`);
          entries = await loadAll(adapter, this, reported);
          if (this.stopRequested) return this.cancelled();
          if (entries.length < maxSeen.n) {
            const allowed = Math.ceil((s.tolerancePct / 100) * maxSeen.n);
            if (maxSeen.n - entries.length > allowed) {
              return this.fail(`❌ Sort failed: playlist collapsed to ${entries.length} of ${maxSeen.n} loaded videos and would not re-load (tolerance ${allowed}). ${this.moves} moves were applied before the failure.`);
            }
            log(`⚠️ Continuing with ${entries.length} of ${maxSeen.n} (within tolerance).`);
            maxSeen.n = entries.length;
          }
        }
        if (entries.length > maxSeen.n) {
          maxSeen.n = entries.length;
          moveCap = Math.max(moveCap, maxSeen.n * 3 + 20);
        }

        const target = planOrder(entries, s);
        let j = 0;
        while (j < target.length && entries[j] && entries[j].id === target[j].id) j++;
        if (j >= target.length) break; // fully ordered

        const wantId = target[j].id;
        const srcIdx = entries.findIndex((e) => e.id === wantId);
        if (srcIdx === -1 || !entries[srcIdx].handle || !entries[j].handle) {
          return this.fail(`❌ Sort failed: lost track of video "${target[j].title}" (or its drag handle) while sorting. ${this.moves} moves were applied.`);
        }

        const ok = await this.verifiedMove(entries[srcIdx], j, wantId);
        if (ok) this.moves++; // count BEFORE the stop-check so a cancel report reflects DOM reality
        if (this.stopRequested) return this.cancelled();
        if (!ok) {
          return this.fail(`❌ Sort failed: the move for "${target[j].title}" did not apply after 3 attempts - YouTube is not accepting reorders right now (wrong sort mode, throttling, or a layout change). ${this.moves} verified moves were applied before stopping.`);
        }
        log(`🔄 Moved "${target[j].title.slice(0, 40)}" → #${j + 1}  (${this.moves}/~${totalPlanned})`);
        setStatus(`Sorting… ${this.moves}/~${totalPlanned} moves`);
        await this.waitAbortable(Math.max(80, this.pacing / 4)); // brief settle; correctness comes from verification, not waiting
      }

      // ---- final verification pass (truth-only reporting) ----
      const finalEntries = adapter.collect();
      const bad = misplacedCount(finalEntries, planOrder(finalEntries, s));
      scrollToTop();
      log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      if (bad === 0) {
        const netMoves = netSignal.calls - startNetCalls;
        log(`✅ Sort complete! ${this.moves} moves applied and re-verified in final order (${finalEntries.length} videos${reported !== null && finalEntries.length < reported ? ` of ${reported} reported - the rest are unavailable/hidden` : ''}).`);
        if (netSignal.everSeen && netMoves < this.moves) {
          log(`⚠️ Only ${netMoves} of ${this.moves} moves produced a server save call - reload the page once to confirm YouTube kept the order.`);
        }
        log('⚠️ Keep the playlist sort on "Manual" - switching to an automatic sort discards this order.');
        setStatus(`Done - ${this.moves} moves, verified`);
        this.maybeReload();
        return { ok: true, moves: this.moves };
      }
      return this.fail(`❌ Sort failed final verification: ${bad} of ${finalEntries.length} videos are out of place. ${this.moves} moves were applied; run Sort again to finish.`);
    }

    // API engine: read full item list from server, compute target order, emit one edit_playlist
    // move per out-of-place item, verify against a fresh server read. Returns a result object,
    // or null if the API route isn't viable for this playlist (caller falls back to drag).
    async executeApi() {
      const { s } = this;
      const context = window.ytcfg.data_.INNERTUBE_CONTEXT;
      log('⚡ Reading playlist…');
      let items;
      try { items = await YtApi.fetchServerItems(this.listId); }
      catch (e) { log('⚠️ API read failed (' + (e && e.message ? e.message : e) + ').'); return null; }
      if (!items || items.length === 0) { log('⚠️ API returned no items.'); return null; }
      if (items.some((it) => !it.setVideoId)) { log(`⚠️ ${items.filter((it) => !it.setVideoId).length}/${items.length} items lack a setVideoId - API cannot address them.`); return null; }
      // A truncated harvest is NOT the authoritative full list - never sort against it (it would
      // reposition the never-read tail). Fall back to the DOM-verified drag engine instead.
      if (items.truncated) { log(`⚠️ API read was cut short (${items.length} of an unknown total) - not sorting a partial list.`); return null; }

      const reported = this.adapter.reportedCount();
      if (reported !== null && items.length < reported) {
        const allowed = Math.ceil((s.tolerancePct / 100) * reported);
        if (reported - items.length > allowed) return this.fail(`❌ Sort failed: server returned ${items.length} of ${reported} videos (missing ${reported - items.length}, tolerance ${allowed}). Nothing was changed.`);
      }
      log(`📊 ${items.length} videos. Sorting…`);

      // Self-healing outer loop: apply the plan, then RE-READ server truth and repeat until the
      // server itself reports fully sorted. This absorbs phantom ACKs and any server-side drift -
      // each pass only needs to fix whatever the previous pass didn't actually land.
      const MAX_PASSES = 5;
      let lastBad = Infinity;
      let bad = misplacedCount(items, planOrder(items, s));
      for (let pass = 1; pass <= MAX_PASSES && bad > 0; pass++) {
        const target = planOrder(items, s);
        if (pass > 1) log(`🔁 Pass ${pass}: ${bad} still out of place - correcting…`);

        const passResult = await this.apiPass(items, target, context);
        if (passResult) return passResult; // stop/cancel/fail terminal from within the pass

        // re-read server truth for the next pass / final check
        try { items = await YtApi.fetchServerItems(this.listId); }
        catch (e) { items = null; }
        if (!items || !items.length) {
          log(`✅ Sort complete! ${this.moves} API moves applied (could not re-read the server to double-check - reload to confirm).`);
          setStatus(`Done (API) - ${this.moves} moves`);
          this.maybeReload();
          return { ok: true, moves: this.moves, engine: 'api', unverified: true };
        }
        const prevBad = bad;
        bad = misplacedCount(items, planOrder(items, s));
        if (bad === 0) break; // verified sorted
        if (bad >= prevBad) { // not converging - stop rather than spin
          return this.fail(`❌ Sort failed: the server keeps reverting moves (${bad} of ${items.length} still out of place after pass ${pass}). ${this.moves} moves applied; YouTube may be throttling - try again shortly.`);
        }
        lastBad = bad;
      }

      // ONLY report success if the server-verified misplaced count is actually 0. Exhausting
      // MAX_PASSES while still improving (bad>0) is a FAILURE, not a silent success.
      log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      if (bad === 0) {
        log(`✅ Sort complete! ${this.moves} API moves applied and re-verified against the server (${items.length} videos).`);
        log('⚠️ Keep the playlist sort on "Manual" to preserve this order.');
        setStatus(`Done (API) - ${this.moves} moves, verified`);
        this.maybeReload();
        return { ok: true, moves: this.moves, engine: 'api' };
      }
      return this.fail(`❌ Sort failed: ${bad} of ${items.length} videos still out of place after ${MAX_PASSES} passes. ${this.moves} moves applied; run Sort again to finish.`);
    }

    // One pass of the plan: compute EVERY needed move up front (simulating sequential apply -
    // matching the server's proven batch semantics), then send them in batches of apiBatchSize.
    // Returns a terminal result object to abort the whole sort, or null when the pass finished.
    async apiPass(items, target, context) {
      const { s } = this;
      const live = [...items];
      const actions = [];
      for (let j = 0; j < target.length; j++) {
        if (live[j] && live[j].setVideoId === target[j].setVideoId) continue; // already in place
        const a = { action: 'ACTION_MOVE_VIDEO_AFTER', setVideoId: target[j].setVideoId };
        if (j > 0) a.movedSetVideoIdPredecessor = target[j - 1].setVideoId;
        actions.push(a);
        const from = live.findIndex((it) => it.setVideoId === target[j].setVideoId);
        if (from !== -1) { const [m] = live.splice(from, 1); live.splice(j, 0, m); }
      }
      if (!actions.length) return null;

      let passMoves = 0; // pass-local, so the progress readout denominator is honest
      for (let i = 0; i < actions.length; i += s.apiBatchSize) {
        if (this.stopRequested) return this.cancelledApi();
        if (currentListId() !== this.listId) return this.fail(`❌ Sort failed: navigated away from the playlist mid-sort. ${this.moves} API moves were applied.`);
        let chunk = actions.slice(i, i + s.apiBatchSize);
        if (s.maxMovesPerRun > 0) { // test hook: trim to the remaining allowance
          const allowance = s.maxMovesPerRun - this.moves;
          if (allowance <= 0) break;
          if (chunk.length > allowance) chunk = chunk.slice(0, allowance);
        }

        let res, ok = false;
        for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
          if (this.stopRequested) return this.cancelledApi();
          res = await YtApi.sendActions(this.listId, context, chunk);
          ok = res.ok;
          if (!ok) { log(`⚠️ API batch attempt ${attempt}/3 failed (${res.error}) - retrying…`); await this.waitAbortable(Math.max(400, this.pacing)); }
        }
        if (!ok) return this.fail(`❌ Sort failed: an API batch of ${chunk.length} moves failed after 3 attempts (${res && res.error}). ${this.moves} moves applied; run Sort again to finish.`);

        this.moves += chunk.length;
        passMoves += chunk.length;
        log(`⚡ ${passMoves}/${actions.length} this pass (${this.moves} total, batch of ${chunk.length} in ${res.ms}ms)`);
        setStatus(`Sorting (API)… ${passMoves}/${actions.length}`);
        if (s.maxMovesPerRun > 0 && this.moves >= s.maxMovesPerRun) {
          log(`Sort stopped: move cap ${s.maxMovesPerRun} reached (test mode). ${this.moves} API moves applied.`);
          setStatus('Stopped at move cap');
          return { ok: false, capped: true, moves: this.moves, engine: 'api' };
        }
        await this.waitAbortable(s.apiPacingMs);
      }
      return null;
    }

    cancelledApi() {
      log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      log(`⛔ Sort cancelled by user. ${this.moves} API moves were applied before stopping.`);
      setStatus('Cancelled');
      return { ok: false, cancelled: true, moves: this.moves, engine: 'api' };
    }

    // Fire the drag, then poll fresh DOM until the item occupies the target slot. Retry ≤3.
    async verifiedMove(srcEntry, targetIdx, wantId) {
      const moveTimeout = Math.max(5000, this.pacing * 8);
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (this.stopRequested) return false;
        // re-resolve elements fresh each attempt (re-renders stale old references)
        const cur = this.adapter.collect();
        const src = cur.find((e) => e.id === wantId);
        const dst = cur[targetIdx];
        if (!src || !dst || !src.handle || !dst.handle) return false;
        if (cur[targetIdx].id === wantId) return true; // already landed (late apply)
        const snapshot = cur.map((e) => e.id).join(',');
        // CRITICAL (live finding 2026-07-18): YouTube's drop handling is coordinate-sensitive -
        // the DESTINATION row must be visible or the server resolves the drop to whatever row
        // occupies those viewport coordinates. The dragged item rides on the event target, so
        // scroll the TARGET into view, never the source.
        try { dst.el.scrollIntoView({ behavior: 'auto', block: 'center' }); } catch { /* non-fatal */ }
        await wait(60); // let layout settle before reading rects
        simulateDrag(src.handle, dst.handle);
        const landed = await pollUntil(() => {
          const now = this.adapter.collect();
          return now[targetIdx] && now[targetIdx].id === wantId;
        }, moveTimeout, Math.max(120, this.pacing / 2), () => this.stopRequested);
        if (landed) {
          // Polymer applies drags optimistically and re-syncs from server data moments later -
          // a wrong server-side move REVERTS the DOM. Re-check after a settle before trusting it.
          await this.waitAbortable(Math.max(250, this.pacing / 2));
          const now = this.adapter.collect();
          if (now[targetIdx] && now[targetIdx].id === wantId) return true;
          log(`⚠️ Move looked applied but was reverted by the page (attempt ${attempt}/3) - retrying…`);
          continue;
        }
        const nowSnapshot = this.adapter.collect().map((e) => e.id).join(',');
        if (nowSnapshot !== snapshot) return true; // order changed some other way - let the outer loop replan
        log(`⚠️ Move attempt ${attempt}/3 did not apply - retrying…`);
      }
      return false;
    }

    cancelled() {
      log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      log(`⛔ Sort cancelled by user. ${this.moves} verified moves were applied before stopping.`);
      setStatus('Cancelled');
      return { ok: false, cancelled: true, moves: this.moves };
    }
    fail(msg) {
      log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      log(msg.startsWith('❌') || msg.startsWith('Cannot sort') ? msg : '❌ ' + msg);
      setStatus('Failed - see log');
      return { ok: false, moves: this.moves };
    }
  }

  // ======================================================================== features
  // One page-scrolling task at a time: Stats/Export drive the same scroll loop the sorter uses,
  // so running them concurrently with a sort would corrupt drag verification.
  let activeTask = null;
  let stoppableRun = null; // the SortRun the Stop button should cancel (Sort OR Stats/Export)
  const claimTask = (name, run) => {
    if (activeTask) { showLog(); log(`⚠️ ${name} unavailable: a ${activeTask} is already running - wait for it to finish (or press Stop).`); return false; }
    activeTask = name;
    stoppableRun = run || null;
    return true;
  };

  const runStats = async () => {
    const adapter = detectAdapter();
    if (!adapter) { showLog(); log('❌ Stats failed: no playlist detected on this page.'); return; }
    const run = new SortRun(adapter, settings); // reuse loading engine (and its stop flag)
    if (!claimTask('stats run', run)) return;
    try {
    showLog();
    log('📊 Analyzing playlist…');
    const entries = settings.scope === 'all' ? await loadAll(adapter, run, adapter.reportedCount()) : adapter.collect();
    const durations = entries.map((e) => e.durSec).filter((d) => d !== null);
    const unavailable = entries.length - durations.length;
    if (durations.length === 0) { log('❌ No videos with parseable durations found.'); return; }
    const total = durations.reduce((a, b) => a + b, 0);
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    log('📊 PLAYLIST ANALYSIS');
    log(`📹 Videos analyzed: ${durations.length}${unavailable ? `  (⚠️ ${unavailable} unavailable/live)` : ''}`);
    log(`⏱️ Total duration: ${fmtLong(total)}`);
    log(`   Average length: ${fmtLong(Math.floor(total / durations.length))}`);
    log(`   Shortest: ${fmtDuration(Math.min(...durations))}   Longest: ${fmtDuration(Math.max(...durations))}`);
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    } finally { activeTask = null; stoppableRun = null; }
  };

  const runExport = async () => {
    const adapter = detectAdapter();
    if (!adapter) { showLog(); log('❌ Export failed: no playlist detected on this page.'); return; }
    const run = new SortRun(adapter, settings);
    if (!claimTask('export run', run)) return;
    try {
    showLog();
    log('📤 Exporting playlist…');
    const entries = settings.scope === 'all' ? await loadAll(adapter, run, adapter.reportedCount()) : adapter.collect();
    if (entries.length === 0) { log('❌ Export failed: 0 videos found.'); return; }
    let csv = 'Position,Title,Duration,URL\n';
    entries.forEach((e, i) => {
      const title = '"' + (e.title || 'Unknown').replace(/"/g, '""') + '"';
      const dur = e.durSec === null ? 'N/A'
        : `${String(Math.floor(e.durSec / 3600)).padStart(2, '0')}:${String(Math.floor((e.durSec % 3600) / 60)).padStart(2, '0')}:${String(e.durSec % 60).padStart(2, '0')}`;
      const idm = (e.url || '').match(/[?&]v=([A-Za-z0-9_-]+)/);
      const url = idm ? `https://www.youtube.com/watch?v=${idm[1]}` : '';
      csv += `${i + 1},${title},${dur},${url}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    const listm = location.search.match(/list=([^&]+)/);
    const d = new Date();
    a.href = URL.createObjectURL(blob);
    a.download = `youtube_playlist_${listm ? listm[1] : 'export'}_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.csv`;
    a.style.display = 'none';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(a.href);
    log(`✅ Exported ${entries.length} videos to ${a.download}`);
    } finally { activeTask = null; stoppableRun = null; }
  };

  const showDryRunPreview = (entries, onApply) => {
    const target = planOrder(entries, settings); // SAME planner as the real sort (H1)
    const overlay = elt('div', { class: 'yts2-overlay' });
    const modal = elt('div', { class: 'yts2-modal ' + themeClass() });
    const mkCol = (heading, list) => elt('div', {}, elt('h4', { text: heading }),
      ...list.map((e, i) => elt('div', { class: 'yts2-row' },
        `${i + 1}. ${(e.title || '?').slice(0, 44)} `, elt('span', { text: `(${fmtDuration(e.durSec)})` }))));
    modal.appendChild(elt('h3', { text: `🔍 Dry Run - preview (${settings.sortMode === 'asc' ? 'Shortest First' : 'Longest First'})` }));
    modal.appendChild(elt('div', { class: 'yts2-cols' }, mkCol('Current', entries), mkCol('After sort', target)));
    modal.appendChild(elt('div', { class: 'yts2-btns' },
      elt('button', { class: 'yts2-btn', 'data-act': 'cancel', text: 'Cancel' }),
      elt('button', { class: 'yts2-btn yts2-primary', 'data-act': 'apply', text: '✓ Apply Sort' })));
    const close = () => { overlay.remove(); modal.remove(); };
    modal.addEventListener('click', (ev) => {
      const act = ev.target && ev.target.getAttribute && ev.target.getAttribute('data-act');
      if (act === 'cancel') { close(); log('🚫 Dry run cancelled - no changes made.'); }
      if (act === 'apply') { close(); Promise.resolve().then(onApply).catch((e) => { log('❌ ' + (e && e.message ? e.message : e)); console.error('[YTSort2]', e); }); }
    });
    overlay.addEventListener('click', () => { close(); log('🚫 Dry run cancelled - no changes made.'); });
    document.body.appendChild(overlay);
    document.body.appendChild(modal);
  };

  // ======================================================================== sort entry point
  let sortButton = null;
  const setRunningUi = (running) => {
    if (sortButton) { sortButton.disabled = running; sortButton.style.opacity = running ? '0.5' : '1'; }
  };

  const startSort = async ({ skipDryRun = false } = {}) => {
    if (activeRun) { log('⚠️ A sort is already running - ignoring the extra click.'); return; }
    showLog();
    const adapter = detectAdapter();
    if (!adapter) { log('Cannot sort: no playlist detected on this page.'); setStatus('No playlist found'); return; }

    if (settings.dryRun && !skipDryRun && adapter.canSort) {
      const entries = adapter.collect();
      if (entries.length === 0) { log('Cannot sort: found 0 videos on this page. Nothing was changed.'); return; }
      log('🔍 Dry Run enabled - showing preview (no changes yet).');
      showDryRunPreview(entries, () => startSort({ skipDryRun: true }));
      return;
    }

    activeRun = new SortRun(adapter, settings);
    if (!claimTask('sort', activeRun)) { activeRun = null; return; }
    setRunningUi(true);
    setStatus('Sorting…');
    try {
      await activeRun.execute();
    } catch (e) {
      log(`❌ Sort failed: unexpected error - ${e && e.message ? e.message : e}`);
      console.error('[YTSort2]', e);
      setStatus('Failed - see log');
    } finally {
      activeRun = null;
      activeTask = null;
      stoppableRun = null;
      setRunningUi(false);
    }
  };

  // ======================================================================== UI
  // Theme-aware: the panel and modals carry a `yts2-light`/`yts2-dark` class and read colors from
  // CSS variables set per theme, so they match YouTube's own light/dark surfaces natively (solid
  // backgrounds - no translucent ambient bleed) and follow the theme when the user toggles it.
  const CSS = `
    .sort-playlist-wrapper, .yts2-modal {
      --s-text:#f1f1f1; --s-text2:#aaa; --s-surface:#212121; --s-border:rgba(255,255,255,.15);
      --s-btn:rgba(255,255,255,.1); --s-btn-hover:rgba(255,255,255,.2); --s-link:#3ea6ff;
      --s-log-bg:#0f0f0f; --s-log-text:#f1f1f1; --s-scheme:dark;
    }
    .sort-playlist-wrapper.yts2-light, .yts2-modal.yts2-light {
      --s-text:#0f0f0f; --s-text2:#606060; --s-surface:#ffffff; --s-border:rgba(0,0,0,.12);
      --s-btn:rgba(0,0,0,.05); --s-btn-hover:rgba(0,0,0,.1); --s-link:#065fd4;
      --s-log-bg:#f8f8f8; --s-log-text:#0f0f0f; --s-scheme:light;
    }
    .sort-playlist-wrapper { margin-top: 12px; font-family: Roboto, Arial, sans-serif; }
    .sort-playlist-details { border: 1px solid var(--s-border); border-radius: 12px; background: var(--s-surface); color: var(--s-text); overflow: hidden; }
    .sort-playlist-summary { list-style: none; padding: 10px 16px; font-weight: 600; cursor: pointer; display: flex; justify-content: space-between; user-select: none; font-size: 14px; color: var(--s-text); }
    .sort-playlist-summary::-webkit-details-marker { display: none; }
    .yts2-version { font-size: 11px; color: var(--s-text2); font-weight: 500; }
    .sort-playlist-content { padding: 10px 16px 14px; color: var(--s-text); }
    .sort-playlist-button { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
    .yts2-btn { border: 1px solid var(--s-border); border-radius: 16px; padding: 7px 14px; cursor: pointer; font-size: 13px; font-weight: 500; background: var(--s-btn); color: var(--s-text); transition: background .15s ease; }
    .yts2-btn:hover { background: var(--s-btn-hover); }
    .yts2-btn:disabled { cursor: default; opacity: .5; }
    .yts2-btn.yts2-icon { padding: 7px 11px; font-size: 15px; line-height: 1; }
    .yts2-stop { color: #f33; }
    .yts2-primary { font-weight: 600; }
    .yts2-selects { display: flex; gap: 8px; margin-bottom: 8px; }
    /* color-scheme makes the NATIVE dropdown (option list) render in the right theme instead of
       white-on-white in dark mode; option colors are a belt-and-suspenders fallback. */
    .yts2-select { border: 1px solid var(--s-border); border-radius: 8px; padding: 6px 8px; font-size: 12.5px; background: var(--s-btn); color: var(--s-text); color-scheme: var(--s-scheme); }
    .yts2-select option { background: var(--s-surface); color: var(--s-text); }
    .yts2-status { font-size: 12px; color: var(--s-text2); margin: 4px 0 6px; min-height: 15px; }
    .yts2-log { padding: 10px; border-radius: 8px; background: var(--s-log-bg); color: var(--s-log-text); border: 1px solid var(--s-border); font: 11.5px/1.5 ui-monospace, Menlo, Consolas, monospace; max-height: 220px; overflow-y: auto; white-space: pre-wrap; word-break: break-word; }
    .yts2-brand { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--s-border); font-size: 11px; color: var(--s-text2); text-align: center; }
    .yts2-brand-link { color: var(--s-link); text-decoration: none; font-weight: 600; }
    .yts2-brand-link:hover { text-decoration: underline; }
    .yts2-brand-sep { opacity: .5; }
    .yts2-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.6); z-index: 99998; }
    .yts2-modal { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%); background: var(--s-surface); color: var(--s-text); border: 1px solid var(--s-border); border-radius: 12px; padding: 20px; z-index: 99999; max-width: 760px; width: 92%; max-height: 82vh; overflow-y: auto; font-size: 13px; font-family: Roboto, Arial, sans-serif; }
    .yts2-modal h3 { margin: 0 0 10px; } .yts2-modal h4 { margin: 8px 0 6px; }
    .yts2-modal .yts2-btn { background: var(--s-btn); color: var(--s-text); border: 1px solid var(--s-border); }
    .yts2-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; max-height: 46vh; overflow-y: auto; border: 1px solid var(--s-border); border-radius: 8px; padding: 8px; }
    .yts2-row { padding: 3px 4px; border-bottom: 1px solid var(--s-border); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .yts2-row span { color: var(--s-text2); }
    .yts2-btns { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 16px; }
    .yts2-btns-right { display: flex; gap: 8px; }
    .yts2-modal.yts2-modal-narrow { max-width: 430px; }
    .yts2-sec { font-size: 11px; font-weight: 600; letter-spacing: .07em; text-transform: uppercase; color: var(--s-text2); margin: 16px 0 6px; padding-top: 12px; border-top: 1px solid var(--s-border); }
    .yts2-sec.yts2-sec-first { border-top: none; padding-top: 2px; margin-top: 6px; }
    .yts2-settings-row { display: flex; justify-content: space-between; align-items: center; margin: 7px 0; gap: 16px; }
    .yts2-settings-row label { color: var(--s-text); flex: 1; min-width: 0; }
    .yts2-settings-row input[type=number] { width: 92px; flex: none; background: var(--s-btn); color: var(--s-text); border: 1px solid var(--s-border); border-radius: 6px; padding: 4px 6px; }
    .yts2-settings-row input:disabled { cursor: not-allowed; }
    .yts2-settings-row.yts2-dependent label { padding-left: 16px; position: relative; }
    .yts2-settings-row.yts2-dependent label::before { content: '↳'; position: absolute; left: 2px; color: var(--s-text2); }
    .yts2-settings-row.yts2-off { opacity: .42; }
  `;

  const injectCss = () => {
    if (document.getElementById('yts2-style')) return;
    const el = document.createElement('style');
    el.id = 'yts2-style';
    el.textContent = CSS;
    document.head.appendChild(el);
  };

  // ---- theme detection (YouTube's own light/dark) ----
  let panelWrapper = null;
  const isDarkTheme = () => {
    // 1. YouTube's authoritative signal: a `dark` attribute on <html> (or ytd-app)
    if (document.documentElement.hasAttribute('dark')) return true;
    const app = document.querySelector('ytd-app');
    if (app && app.hasAttribute('dark')) return true;
    // 2. luminance of the first OPAQUE surface background (a transparent rgba(0,0,0,0) is NOT dark)
    for (const node of [document.documentElement, document.body, app]) {
      if (!node) continue;
      const m = (getComputedStyle(node).backgroundColor || '').match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?/);
      if (m && (m[4] === undefined || parseFloat(m[4]) > 0.1)) {
        return (0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3]) < 128;
      }
    }
    // 3. last resort: OS/browser preference
    try { return window.matchMedia('(prefers-color-scheme: dark)').matches; } catch { return false; }
  };
  const themeClass = () => (isDarkTheme() ? 'yts2-dark' : 'yts2-light');
  const applyPanelTheme = () => {
    if (!panelWrapper) return;
    const d = isDarkTheme();
    panelWrapper.classList.toggle('yts2-dark', d);
    panelWrapper.classList.toggle('yts2-light', !d);
  };
  let themeWatchSet = false;
  const watchTheme = () => {
    // re-detect shortly after mount: YouTube's theme/background can settle a beat after the panel
    // renders (background is briefly transparent during load)
    setTimeout(applyPanelTheme, 500);
    setTimeout(applyPanelTheme, 1500);
    if (themeWatchSet) return;
    themeWatchSet = true;
    try {
      // watch YouTube's own dark toggle (html[dark] / ytd-app[dark]) and OS preference changes
      new MutationObserver(applyPanelTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['dark'] });
      const app = document.querySelector('ytd-app');
      if (app) new MutationObserver(applyPanelTheme).observe(app, { attributes: true, attributeFilter: ['dark'] });
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyPanelTheme);
    } catch { /* observers unavailable */ }
  };

  const isVisible = (el) => !!el && el.offsetParent !== null; // hidden duplicate headers have offsetParent === null
  const findMountPoint = () => {
    // NEW arch: insert after the VISIBLE actions row. YouTube renders hidden duplicate headers,
    // so we must NOT fall back to a hidden row (the panel would render inside a display:none header).
    // If a row exists but isn't visible yet, return null so the observer retries once it is.
    const rows = [...document.querySelectorAll('.ytFlexibleActionsViewModelActionRow')];
    if (rows.length) {
      const visRow = rows.find(isVisible);
      if (visRow) return { el: visRow, mode: 'after' };
    }
    // OLD arch fallbacks (owner/editable view) - also require visibility
    const oldCandidates = [
      document.querySelector('ytd-playlist-header-renderer #actions'),
      document.querySelector('ytd-playlist-header-renderer #container'),
      document.querySelector('ytd-playlist-header-renderer'),
      document.querySelector('ytd-playlist-sidebar-primary-info-renderer #menu'),
    ];
    const oldActions = oldCandidates.find(isVisible);
    if (oldActions) return { el: oldActions, mode: 'append' };
    return null;
  };

  const buildPanel = () => {
    const wrapper = document.createElement('div');
    wrapper.className = 'sort-playlist-wrapper ' + themeClass();
    panelWrapper = wrapper;
    watchTheme();
    const details = document.createElement('details');
    details.className = 'sort-playlist-details';
    details.appendChild(elt('summary', { class: 'sort-playlist-summary' },
      elt('span', { text: 'Sort playlist by duration' }),
      elt('span', { class: 'yts2-version', text: 'v' + VERSION })));
    const content = document.createElement('div');
    content.className = 'sort-playlist-content';

    // dropdowns IN the panel (H5)
    const selects = document.createElement('div');
    selects.className = 'yts2-selects';
    const modeSel = elt('select', { class: 'yts2-select' },
      elt('option', { value: 'asc', text: 'Shortest First' }),
      elt('option', { value: 'desc', text: 'Longest First' }));
    modeSel.value = settings.sortMode;
    modeSel.onchange = () => { settings.sortMode = modeSel.value === 'desc' ? 'desc' : 'asc'; saveSettings(settings); };
    const scopeSel = elt('select', { class: 'yts2-select' },
      elt('option', { value: 'all', text: 'Sort all' }),
      elt('option', { value: 'loaded', text: 'Sort only loaded' }));
    scopeSel.value = settings.scope;
    scopeSel.onchange = () => { settings.scope = scopeSel.value === 'loaded' ? 'loaded' : 'all'; saveSettings(settings); };
    selects.appendChild(modeSel); selects.appendChild(scopeSel);
    content.appendChild(selects);

    const btnRow = document.createElement('div');
    btnRow.className = 'sort-playlist-button';
    const mkBtn = (label, cls, fn, title) => {
      const b = document.createElement('button');
      b.className = 'yts2-btn' + (cls ? ' ' + cls : '');
      b.innerText = label;
      if (title) { b.title = title; b.setAttribute('aria-label', title); }
      b.onclick = () => { Promise.resolve().then(fn).catch((e) => { log('❌ ' + (e && e.message ? e.message : e)); console.error('[YTSort2]', e); }); };
      btnRow.appendChild(b);
      return b;
    };
    // Primary actions keep their labels; utility actions are icon-only with hover tooltips.
    sortButton = mkBtn('▶ Sort Videos', 'yts2-primary', () => startSort());
    mkBtn('🛑 Stop Sort', 'yts2-stop', () => { if (stoppableRun) { stoppableRun.stop(); log('⏹ Stopping…'); } else log('Nothing to stop.'); }, 'Stop the current sort');
    mkBtn('📊', 'yts2-icon', runStats, 'Playlist stats (total, average, shortest, longest)');
    mkBtn('📥', 'yts2-icon', runExport, 'Export playlist as CSV');
    mkBtn('⚙️', 'yts2-icon', showSettingsModal, 'Settings');
    mkBtn('📋', 'yts2-icon', async () => {
      await navigator.clipboard.writeText(logEntries.map((e) => e.line).join('\n'));
      log('✅ Log copied to clipboard.');
    }, 'Copy log to clipboard');
    content.appendChild(btnRow);

    statusEl = document.createElement('div');
    statusEl.className = 'yts2-status';
    statusEl.textContent = 'Ready.';
    content.appendChild(statusEl);

    logEl = document.createElement('div');
    logEl.className = 'yts2-log';
    logEl.style.display = settings.logVisible ? 'block' : 'none';
    logEl.textContent = '[Ready]';
    content.appendChild(logEl);
    renderLog();

    // "Made by LunarWerx" byline - always visible when the panel is open
    const brand = elt('div', { class: 'yts2-brand' },
      elt('span', { text: 'Made by ' }),
      elt('a', { class: 'yts2-brand-link', href: 'https://lunarwerx.com/', target: '_blank', rel: 'noopener noreferrer', text: 'LunarWerx' }),
      elt('span', { class: 'yts2-brand-sep', text: ' · ' }),
      elt('a', { class: 'yts2-brand-link', href: 'https://github.com/LunarWerxs', target: '_blank', rel: 'noopener noreferrer', text: 'GitHub' }));
    content.appendChild(brand);

    details.appendChild(content);
    wrapper.appendChild(details);
    return wrapper;
  };

  const showSettingsModal = () => {
    const overlay = elt('div', { class: 'yts2-overlay' });
    const modal = elt('div', { class: 'yts2-modal yts2-modal-narrow ' + themeClass() });
    const row = (label, input, cls) => elt('div', { class: 'yts2-settings-row' + (cls ? ' ' + cls : '') }, elt('label', { text: label }), input);
    const sec = (title, first) => elt('div', { class: 'yts2-sec' + (first ? ' yts2-sec-first' : ''), text: title });
    const g = (id) => modal.querySelector('#' + id);
    modal.appendChild(elt('h3', { text: '⚙️ Settings' }));

    // --- Sorting: what to sort and what happens when it finishes ---
    modal.appendChild(sec('Sorting', true));
    modal.appendChild(row('Dry run (preview before sorting)', elt('input', { type: 'checkbox', id: 'yts2-dry', checked: settings.dryRun })));
    modal.appendChild(row('Refresh page after sorting', elt('input', { type: 'checkbox', id: 'yts2-reload', checked: settings.reloadAfterSort })));
    modal.appendChild(row('Only sort videos within a length range', elt('input', { type: 'checkbox', id: 'yts2-filt', checked: settings.filterEnabled })));
    modal.appendChild(row('Min length (minutes)', elt('input', { type: 'number', id: 'yts2-fmin', min: 0, step: 1, value: Math.floor(settings.filterMinSec / 60) }), 'yts2-dependent'));
    modal.appendChild(row('Max length (minutes)', elt('input', { type: 'number', id: 'yts2-fmax', min: 0, step: 1, value: Math.floor(settings.filterMaxSec / 60) }), 'yts2-dependent'));

    // --- Advanced: performance + technical knobs most people never touch ---
    modal.appendChild(sec('Advanced'));
    modal.appendChild(row('Pacing (ms, lower = faster)', elt('input', { type: 'number', id: 'yts2-pacing', min: 100, max: 5000, step: 50, value: settings.pacing })));
    modal.appendChild(row('API batch size (moves per request)', elt('input', { type: 'number', id: 'yts2-batch', min: 1, max: 100, step: 1, value: settings.apiBatchSize })));
    modal.appendChild(row('Missing-video tolerance (%)', elt('input', { type: 'number', id: 'yts2-tol', min: 0, max: 100, step: 1, value: settings.tolerancePct })));
    modal.appendChild(row('Show log by default', elt('input', { type: 'checkbox', id: 'yts2-logv', checked: settings.logVisible })));

    modal.appendChild(elt('div', { class: 'yts2-btns' },
      elt('button', { class: 'yts2-btn', 'data-act': 'reset', text: '↺ Reset to defaults' }),
      elt('div', { class: 'yts2-btns-right' },
        elt('button', { class: 'yts2-btn', 'data-act': 'cancel', text: 'Cancel' }),
        elt('button', { class: 'yts2-btn yts2-primary', 'data-act': 'save', text: 'Save Settings' }))));

    // length inputs only matter when the range filter is on - dim + disable them otherwise
    const syncDependents = () => {
      const on = !!g('yts2-filt').checked;
      ['yts2-fmin', 'yts2-fmax'].forEach((id) => { const el = g(id); if (el) el.disabled = !on; });
      modal.querySelectorAll('.yts2-dependent').forEach((r) => r.classList.toggle('yts2-off', !on));
    };
    g('yts2-filt').addEventListener('change', syncDependents);
    syncDependents();

    const close = () => { overlay.remove(); modal.remove(); };
    modal.addEventListener('click', (ev) => {
      const act = ev.target && ev.target.getAttribute && ev.target.getAttribute('data-act');
      if (act === 'cancel') close();
      if (act === 'reset') {
        // repopulate the form with defaults; not persisted until Save (so Cancel still backs out)
        const set = (id, v) => { const el = g(id); if (!el) return; if (el.type === 'checkbox') el.checked = v; else el.value = v; };
        set('yts2-dry', DEFAULTS.dryRun);
        set('yts2-reload', DEFAULTS.reloadAfterSort);
        set('yts2-filt', DEFAULTS.filterEnabled);
        set('yts2-fmin', Math.floor(DEFAULTS.filterMinSec / 60));
        set('yts2-fmax', Math.floor(DEFAULTS.filterMaxSec / 60));
        set('yts2-pacing', DEFAULTS.pacing);
        set('yts2-batch', DEFAULTS.apiBatchSize);
        set('yts2-tol', DEFAULTS.tolerancePct);
        set('yts2-logv', DEFAULTS.logVisible);
        syncDependents();
      }
      if (act === 'save') {
        settings = validateSettings({
          ...settings,
          pacing: g('yts2-pacing').value,
          apiBatchSize: g('yts2-batch').value,
          tolerancePct: g('yts2-tol').value,
          dryRun: g('yts2-dry').checked,
          filterEnabled: g('yts2-filt').checked,
          filterMinSec: (parseInt(g('yts2-fmin').value, 10) || 0) * 60,
          filterMaxSec: (parseInt(g('yts2-fmax').value, 10) || 600) * 60,
          reloadAfterSort: g('yts2-reload').checked,
          logVisible: g('yts2-logv').checked,
        });
        saveSettings(settings);
        if (logEl) logEl.style.display = settings.logVisible ? 'block' : 'none';
        log('✅ Settings saved.');
        close();
      }
    });
    overlay.addEventListener('click', close);
    document.body.appendChild(overlay);
    document.body.appendChild(modal);
  };

  // ======================================================================== lifecycle
  let mountObserver = null; // single deduped fallback observer (M5)

  const isPlaylistPage = () => location.pathname === '/playlist' && new URLSearchParams(location.search).has('list');

  // ?ytsort=1 on a playlist URL → auto-run the sort ONCE, headless (no button click), after an
  // auth check. The landing site (site/index.html) turns a ?url=<playlist> into exactly this URL,
  // so a shared/bookmarked link sorts on load — but ONLY from a browser signed in to YouTube:
  // without a SAPISID session the InnerTube writes can't be authorized, so we say so plainly
  // instead of failing silently ("check auth first; if no, error"). The trigger is stripped from
  // the URL the instant it fires, so a reload or an in-app re-mount never re-sorts.
  const AUTOSORT_PARAM = 'ytsort';
  let autoSortPending = false;
  const maybeAutoSort = () => {
    const params = new URLSearchParams(location.search);
    if (!params.get(AUTOSORT_PARAM) || autoSortPending) return;
    autoSortPending = true;
    params.delete(AUTOSORT_PARAM);
    const qs = params.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
    (async () => {
      try {
        const authed = YtApi.available() && !!(await YtApi.sapisidHash());
        if (!authed) {
          showLog();
          log('❌ Auto-sort needs you signed in to YouTube — no account session was found on this page. Sign in, then open the link again.');
          setStatus('Not signed in');
          return;
        }
        log('▶ Auto-sort requested by the link — sorting this playlist now…');
        // Let the playlist finish its first paint so the adapter/engine act on a live page, then
        // sort FOR REAL (skip the dry-run preview: a URL trigger means "do it", not "preview it").
        await new Promise((r) => setTimeout(r, 700));
        await startSort({ skipDryRun: true });
      } finally {
        autoSortPending = false;
      }
    })();
  };

  const mountIfPlaylist = () => {
    try {
      if (!isPlaylistPage()) return;
      const existing = document.querySelector('.sort-playlist-wrapper');
      if (existing && existing.isConnected) return; // already mounted
      const mount = findMountPoint();
      if (!mount) {
        // header not rendered yet - one shared observer; instance-local capture so a stale
        // 60s timeout (or success path) can never disconnect a NEWER observer
        if (!mountObserver) {
          const obs = new MutationObserver(() => {
            if (!isPlaylistPage()) return;
            if (findMountPoint()) {
              obs.disconnect();
              if (mountObserver === obs) mountObserver = null;
              mountIfPlaylist();
            }
          });
          mountObserver = obs;
          obs.observe(document.documentElement, { childList: true, subtree: true });
          setTimeout(() => { obs.disconnect(); if (mountObserver === obs) mountObserver = null; }, 60000);
        }
        return;
      }
      injectCss();
      const panel = buildPanel();
      if (mount.mode === 'after') mount.el.insertAdjacentElement('afterend', panel);
      else mount.el.appendChild(panel);
      if (activeRun) { // a remount mid-run must reflect the run, not reset to idle
        setRunningUi(true);
        setStatus(`Sorting… ${activeRun.moves} moves so far`);
      }
      console.log(`[YTSort2] v${VERSION} ready (${detectAdapter() ? detectAdapter().name : 'no'} layout).`); // console only - not user-facing panel noise
      maybeAutoSort(); // fire the URL-triggered auto-sort now that the panel + playlist are live
    } catch (e) {
      console.error('[YTSort2] mount failed:', e);
    }
  };

  hookNetwork();
  mountIfPlaylist();

  // SPA navigation: YouTube's own event + Navigation API with a CORRECT check (C5 fix).
  // A navigation away from the run's playlist also stops the active sort immediately
  // (the run's own per-iteration identity check is the backstop).
  const onNavigate = () => {
    if (activeRun && currentListId() !== activeRun.listId) activeRun.stop();
    mountIfPlaylist();
  };
  document.addEventListener('yt-navigate-finish', () => setTimeout(onNavigate, 300));
  if (window.navigation && typeof window.navigation.addEventListener === 'function') {
    window.navigation.addEventListener('navigate', () => setTimeout(onNavigate, 800));
  }
  window.addEventListener('popstate', () => setTimeout(onNavigate, 800));
})();
