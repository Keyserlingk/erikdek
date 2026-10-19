#!/usr/bin/env bash
# Builds the Erkdek Android app (debug APK); with --install also installs it on the
# phone connected over USB (USB debugging on).
#   tools/build_android.sh [--install]
set -euo pipefail
cd "$(dirname "$0")/.."

export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm use >/dev/null  # Node from .nvmrc (Capacitor 8 needs >= 22)
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"

# App version shown under Settings → About (git-ignored, regenerated each build).
printf '{"version":"%s"}\n' "$(git describe --always --dirty)" > data/version.json
node tools/vendor.mjs
npx cap sync android
(cd android && ./gradlew --quiet assembleDebug)

APK=android/app/build/outputs/apk/debug/app-debug.apk
echo "APK: $APK ($(du -h "$APK" | cut -f1))"
if [[ "${1:-}" == "--install" ]]; then
  "$ANDROID_HOME/platform-tools/adb" install -r "$APK"
fi
