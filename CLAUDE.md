# Erkdek – notes for coding agents

Erkdek is a DIY climbing force gauge: load cell → amplifier (HX711) → ESP32 sensor →
Bluetooth LE → Android app (Capacitor wrapping a plain-JS web app). PLAN.md is the plan
of record (decisions, protocol, milestones); README.md has setup and commands;
CONTRIBUTING.md is the human guide.

Skills with step-by-step recipes: `.claude/skills/erkdek-app` (app: run, test, check
in headless Chrome, build the APK) and `.claude/skills/erkdek-firmware` (firmware:
build, test, flash, serial console, Bluetooth checks, protocol changes).

## Layout
- `data/` – the app: ES modules, no bundler, no framework. One module per screen or
  concern (`live.js`, `runner.js`, `history.js`, …); stores (`sessions.js`,
  `settingsstore.js`, `routines.js`, `profiles.js`) are DOM-free and tested under node.
  `bleprotocol.js` mirrors the firmware's byte layouts; `simdevice.js` is the simulated
  sensor used in the browser.
- `src/` – ESP32 firmware (Arduino core 2.0.17, NimBLE). `lib/core/` – hardware-free
  firmware logic (protocol codec, calibration, console parsing) with native tests.
- `test/js/` – app tests (`npm test`); `test/test_core/` – firmware tests
  (`pio test -e native`).
- `tools/` – dev server, Android build, firmware version/bundling, headless browser check.
- `android/` – Capacitor project (generated parts are committed; build output isn't).

## Conventions
- **No backward compatibility**: the app is in development. Change formats, names and
  layouts directly; no migration code or shims.
- **Bluetooth protocol changes** happen on both sides at once: `lib/core/ble_protocol.h`
  and `data/bleprotocol.js`, with the same byte vectors in both test suites, the
  simulator updated, and `kProtocolVersion` / `PROTOCOL_VERSION` raised together.
- Match the surrounding code: short comments that say why, small focused modules, the
  `create`/`el` DOM helper style, colours from CSS variables (light and dark themes).
- UI text: short, plain English, no jargon.
- Keep tests green and add tests for new logic. Check UI changes in headless Chrome
  (light and dark) before calling them done.
- Data is per profile (sessions, settings incl. bodyweight log); routines, tests,
  workouts, holds/grips/hangboards, calibration and display settings are shared.
- Commits end with a `Co-Authored-By:` trailer naming the model that made them.

## Hardware cautions
- The ESP32 is on `/dev/ttyUSB0`. Don't flash or open the serial port unless the task
  is about the hardware – the user may be using it.
- The firmware version is content-based (`tools/fwversion.py`): it changes whenever
  `src/`, `lib/core/` or `platformio.ini` change. Android builds bundle that firmware so
  the app can update the sensor over Bluetooth.
