# PlatformIO pre-script: bakes the git version into the firmware as ERKDEK_VERSION
# (reported in the WebSocket status as "fw").

import subprocess

Import("env")  # noqa: F821 (provided by PlatformIO)


def git_version(cwd):
    """Short git SHA, with -dirty when there are uncommitted changes."""
    try:
        out = subprocess.run(["git", "describe", "--always", "--dirty"], cwd=cwd, capture_output=True, text=True)
        return out.stdout.strip() or "unknown"
    except OSError:
        return "unknown"


version = git_version(env.subst("$PROJECT_DIR"))  # noqa: F821
env.Append(CPPDEFINES=[("ERKDEK_VERSION", env.StringifyMacro(version))])  # noqa: F821
print(f"version: {version}")
