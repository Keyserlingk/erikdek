#!/usr/bin/env python3
"""Builds the sensor firmware and bundles it into the app: data/firmware/firmware.bin and
data/firmware/firmware.json ({version, size, sha256}), so the app can update the
sensor over Bluetooth (Settings → Sensor). Run by tools/build_android.sh.

Run:  python3 tools/bundle_firmware.py [--no-build]
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys

from fwversion import ROOT, firmware_version

PIO = shutil.which("pio") or os.path.expanduser("~/.local/bin/pio")
BUILT = os.path.join(ROOT, ".pio", "build", "esp32dev", "firmware.bin")
OUT = os.path.join(ROOT, "data", "firmware")


def main():
    if "--no-build" not in sys.argv:
        subprocess.run([PIO, "run", "-e", "esp32dev"], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
    with open(BUILT, "rb") as f:
        image = f.read()
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "firmware.bin"), "wb") as f:
        f.write(image)
    info = {"version": firmware_version(), "size": len(image), "sha256": hashlib.sha256(image).hexdigest()}
    with open(os.path.join(OUT, "firmware.json"), "w") as f:
        json.dump(info, f)
    print(f"firmware {info['version']}: {len(image)} bytes bundled in data/firmware/")


if __name__ == "__main__":
    main()
