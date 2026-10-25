# Contributing to Erkdek

Thanks for helping! Erkdek is a DIY climbing force gauge: an ESP32 sensor and an Android
app. This guide gets you from a fresh checkout to a tested change. README.md has the
setup commands; PLAN.md explains the design decisions and what's planned.

## What you need
- **App only:** Node 18+ for the tests, Python 3 for the dev server, Chrome for checks.
  No hardware needed: in the browser the app uses a simulated sensor.
- **Android app:** Node 22 (`nvm use`), JDK 21, the Android SDK command-line tools.
- **Firmware:** PlatformIO (`pipx install platformio`), an ESP32 NodeMCU board, an HX711
  and a load cell (wiring in README.md).

## Getting started
```sh
npm test                          # app tests
python3 tools/serve.py            # app at http://localhost:8080 (simulated sensor)
pio test -e native                # firmware logic tests (no board needed)
pio run                           # build the firmware
```
Tap **SIM** in the app's header to choose what hangs on the simulated sensor.

## How the code is organised
- `data/` – the app, plain ES modules (no build step, no framework). Each screen or
  concern is its own module; data stores have no DOM access and are tested under node.
- `src/` – firmware; `lib/core/` – the firmware's hardware-free logic (tested on the PC).
- `test/js/`, `test/test_core/` – tests for the app and the firmware logic.
- `tools/` – dev server, Android build, firmware version and bundling, headless checks.

## Making a change
1. **Talk about bigger changes first** (open an issue or describe the plan): the design
   is written down in PLAN.md and new features fit into it.
2. **Keep to the style around you:** small modules, short comments that explain why,
   plain English UI text, colours from the CSS variables so light and dark both work.
3. **No backward compatibility** while the project is in development: change data
   formats directly instead of adding migrations.
4. **Changing the Bluetooth protocol?** Change the firmware (`lib/core/ble_protocol.h`)
   and the app (`data/bleprotocol.js`) together, update the shared byte vectors in both
   test suites and the simulator, and raise the protocol version on both sides.
5. **Test:** `npm test` and `pio test -e native` must pass; add tests for new logic.
   Check UI changes in a browser (phone-sized, light and dark) – `tools/headless.py`
   can script that and take screenshots.
6. **Firmware changes:** build, flash, and check the serial console
   (`pio device monitor`, `h` for commands) and the app with the real sensor.
7. **Commit** small, focused commits with a message that says what and why.

## Using a coding agent
The repo has `CLAUDE.md` and skills in `.claude/skills/` (erkdek-app, erkdek-firmware)
that tell Claude Code how to build, test, check and flash. They're also a compact
reference for humans.

## Safety
The sensor holds climbers' weight: keep the mechanical side (load cell rating,
shackles, mounting) well within limits and never rely on the electronics for safety.
