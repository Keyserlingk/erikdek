#!/usr/bin/env python3
"""Firmware version from the firmware's own content: "fw-" + 8 hex digits of a SHA-256 over
the firmware sources (src/, lib/core/, platformio.ini). It only changes when the firmware
does, not with app-only commits, so the app can tell whether the sensor runs the firmware
that belongs to it. Used by tools/version.py (baked into the firmware), and by
tools/build_android.sh and tools/serve.py (the app's buildinfo).

Run:  python3 tools/fwversion.py   prints the version
"""
import hashlib
import os

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
SOURCES = ["src", "lib/core", "platformio.ini"]


def firmware_version(root=ROOT):
    digest = hashlib.sha256()
    files = []
    for source in SOURCES:
        path = os.path.join(root, source)
        if os.path.isfile(path):
            files.append(path)
        for folder, _, names in os.walk(path):
            files.extend(os.path.join(folder, n) for n in names)
    for path in sorted(files):
        digest.update(os.path.relpath(path, root).replace(os.sep, "/").encode() + b"\0")
        with open(path, "rb") as f:
            digest.update(f.read() + b"\0")
    return "fw-" + digest.hexdigest()[:8]


if __name__ == "__main__":
    print(firmware_version())
