#!/usr/bin/env bash
# Builds the Erkdek Android app; installs it on the phone connected over USB (USB
# debugging on) with --install.
#   tools/build_android.sh [--release] [--install]
# --release builds the signed release APK (key in android/keystore.properties);
# otherwise the debug APK. Debug and release are signed differently, so switching
# between them on the phone needs an uninstall first (which deletes the app's data).
set -euo pipefail
cd "$(dirname "$0")/.."

VARIANT=debug
INSTALL=0
for arg in "$@"; do
  case "$arg" in
    --release) VARIANT=release ;;
    --install) INSTALL=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done
if [[ $VARIANT == release && ! -f android/keystore.properties ]]; then
  echo "android/keystore.properties is missing (release signing key)" >&2
  exit 1
fi

# `npm run` sets npm_config_prefix (e.g. /usr/local from the system npm), which nvm
# refuses to work with; this script uses nvm's Node, so drop it here.
unset npm_config_prefix NPM_CONFIG_PREFIX
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm use >/dev/null  # Node from .nvmrc (Capacitor 8 needs >= 22)
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"

# Build info for the app: version (Settings → About) and variant (release builds always
# use the Bluetooth sensor). Git-ignored, regenerated each build.
printf 'window.ERKDEK_BUILD = { version: "%s", variant: "%s" };\n' \
  "$(git describe --always --dirty)" "$VARIANT" > data/buildinfo.js
node tools/vendor.mjs
npx cap sync android
TASK=assemble${VARIANT^}
(cd android && ./gradlew --quiet "$TASK")

APK=android/app/build/outputs/apk/$VARIANT/app-$VARIANT.apk
echo "APK: $APK ($(du -h "$APK" | cut -f1))"
if [[ $INSTALL == 1 ]]; then
  "$ANDROID_HOME/platform-tools/adb" install -r "$APK"
fi
