"""Committed size at HEAD of what the extension ships. Prints extension_bytes=<n> and userscript_bytes=<n>."""
import subprocess

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
    if path.startswith("extension/"):
        extension += int(size)
    if path == "extension/ytsort2.user.js":
        userscript += int(size)
print(f"extension_bytes={extension}")
print(f"userscript_bytes={userscript}")
