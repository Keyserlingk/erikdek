# PlatformIO pre-script: bakes the firmware version into the firmware as ERKDEK_VERSION
# (reported over Bluetooth as the Firmware Revision). The version comes from the
# firmware's content, see tools/fwversion.py.

import os
import sys

Import("env")  # noqa: F821 (provided by PlatformIO)

sys.path.insert(0, os.path.join(env.subst("$PROJECT_DIR"), "tools"))  # noqa: F821
from fwversion import firmware_version  # noqa: E402

version = firmware_version(env.subst("$PROJECT_DIR"))  # noqa: F821
env.Append(CPPDEFINES=[("ERKDEK_VERSION", env.StringifyMacro(version))])  # noqa: F821
print(f"version: {version}")
