# PlatformIO pre-script: the LittleFS image is built from a gzipped copy of data/.
#
# For buildfs/uploadfs, every file in data/ is written as <name>.gz to
# .pio/build/<env>/data_gz and the filesystem image is made from that folder. The
# ESP web server serves foo.js.gz for /foo.js with "Content-Encoding: gzip", so the
# browser unpacks it transparently. data/ itself stays uncompressed (source, mock).

import gzip
import os
import shutil

from SCons.Script import COMMAND_LINE_TARGETS

Import("env")  # noqa: F821 (provided by PlatformIO)

FS_TARGETS = {"buildfs", "uploadfs", "uploadfsota"}


def gzip_data_dir(src, dst):
    if os.path.isdir(dst):
        shutil.rmtree(dst)
    raw_total = gz_total = 0
    for root, _, files in os.walk(src):
        for name in files:
            source = os.path.join(root, name)
            target = os.path.join(dst, os.path.relpath(source, src)) + ".gz"
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with open(source, "rb") as f:
                data = f.read()
            # mtime=0 keeps the output identical for identical input
            packed = gzip.compress(data, compresslevel=9, mtime=0)
            with open(target, "wb") as f:
                f.write(packed)
            raw_total += len(data)
            gz_total += len(packed)
    print(f"gzip_data: {src} -> {dst}: {raw_total // 1024} KB -> {gz_total // 1024} KB")


if FS_TARGETS & set(COMMAND_LINE_TARGETS):
    src = env.subst("$PROJECT_DATA_DIR")  # noqa: F821
    dst = os.path.join(env.subst("$BUILD_DIR"), "data_gz")  # noqa: F821
    gzip_data_dir(src, dst)
    env.Replace(PROJECT_DATA_DIR=dst)  # noqa: F821
