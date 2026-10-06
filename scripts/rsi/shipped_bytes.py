"""Committed size at HEAD of what the extension ships. Prints extension_bytes=<n> and userscript_bytes=<n>.

extension_bytes: everything under extension/ (manifest.json, icons/, ytsort2.user.js), the folder users
install. It excludes extension/yt.js, a legacy userscript update mirror (see scripts/legacy-mirror.sh) that the
manifest never loads. It must not be deleted, and counting it would count the userscript twice.
userscript_bytes: extension/ytsort2.user.js, the content script injected into every YouTube page.
"""
import subprocess

EXCLUDED = {"extension/yt.js"}

listing = subprocess.run(["git", "ls-tree", "-r", "-l", "-z", "HEAD"], capture_output=True, check=True).stdout
extension = 0
userscript = 0
for entry in listing.split(b"\0"):
    if not entry:
        continue
    meta, path = entry.decode("utf-8", "replace").split("\t", 1)
    size = meta.split()[3]
    if size == "-":
        continue
    if path.startswith("extension/") and path not in EXCLUDED:
        extension += int(size)
    if path == "extension/ytsort2.user.js":
        userscript += int(size)
print(f"extension_bytes={extension}")
print(f"userscript_bytes={userscript}")
