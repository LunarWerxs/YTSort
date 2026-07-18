// YTSort loader bookmarklet (readable source).
//
// A tiny "always-latest" loader: it fetches the current ytsort2.user.js from the GitHub repo and
// runs it in the YouTube page. Users add this once; they always get the newest version without
// reinstalling anything.
//
// Why this works on YouTube (which has a strict CSP + Trusted Types):
//   - GitHub raw sends `Access-Control-Allow-Origin: *`, so the cross-origin fetch is allowed.
//   - YouTube's CSP includes `'unsafe-eval'`, so eval() may run the fetched code.
//   - `require-trusted-types-for 'script'` is satisfied by wrapping the code in a Trusted Types
//     policy (allowed because YouTube sets no `trusted-types` allowlist directive).
//
// The minified one-line `javascript:` form is in bookmarklet.txt / index.html.
(function () {
  var U = 'https://raw.githubusercontent.com/LunarWerxs/YTSort/main/extension/ytsort2.user.js';
  fetch(U, { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
    .then(function (code) {
      var run = code;
      try {
        if (window.trustedTypes && trustedTypes.createPolicy) {
          run = trustedTypes
            .createPolicy('ytsort-loader-' + Date.now(), { createScript: function (s) { return s; } })
            .createScript(code);
        }
      } catch (e) { /* if TT policy can't be made, fall back to the raw string */ }
      (0, eval)(run);
    })
    .catch(function (e) { alert('YTSort failed to load: ' + e.message); });
})();
