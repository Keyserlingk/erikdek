# Erkdek DIY – Plan

A DIY force gauge for climbing training (Tindeq Progressor style). An S-type load cell
feeds an HX711, which feeds an ESP32. The ESP32 streams force over **Bluetooth Low
Energy** to an **Android app** (the web app packaged with Capacitor), which shows live
force, graphs, timers, routines, workouts, tests and progress history.

## Objective

Build a cheap, self-made alternative to the Tindeq Progressor for finger-strength and
pulling training. It should:

- **Measure force accurately:** 80 Hz sampling, calibrated with known weights, good
  enough to capture peak force and rate of force development.
- **Work as an Android app over Bluetooth:** no WiFi, hotspot or IP addresses; the
  phone keeps its normal internet. The ESP32 is a sensor; the app does the rest.
- **Support structured training:** live force and graph, work/rest timer, custom
  routines, workouts (routines in a row) and standard tests (max pull, critical force, RFD).
- **Track progress over time:** results and personal bests stored in the app, with
  progress charts.
- **Keep the data accessible:** export sessions or everything as CSV/JSON, and
  restore from a backup.
- **Be developable without hardware:** a simulated device in the app for development
  on the computer, and PC-run unit tests for the logic.

## Decisions (2026-10-19)

- **Capacitor** wraps the existing HTML/JS app into an Android app (APK), installed
  directly on the phone (no Play Store).
- **Bluetooth Low Energy only.** The ESP's WiFi, web server and LittleFS storage go
  away; the firmware keeps the sensor task, calibration (NVS) and a BLE service.
- **Data lives on the phone** (IndexedDB inside the app): settings, routines,
  workouts, holds/grips and sessions. Calibration stays on the ESP.
- **The computer is only for development:** the web app runs in a desktop browser
  with a simulated device. No Web Bluetooth on desktop.
- **No iPhone for now:** Capacitor supports iOS, but building needs a Mac and Apple's
  signing (see Future options).

## Hardware

| Part | Notes |
|---|---|
| S-type load cell, 300 kg | Has eyes for slings and carabiners; 4-wire full bridge |
| HX711 breakout | **Bridge RATE to VCC for 80 Hz** (most boards default to 10 Hz) |
| ESP32 NodeMCU WROOM-32 (USB-C, CH340) | 4 MB flash, Bluetooth LE |
| Power | USB power bank or 18650 + charger/protection board |

### Wiring

| HX711 | ESP32 |
|---|---|
| VCC | 3.3V (keeps DOUT at 3.3 V logic) |
| GND | GND |
| DT / DOUT | GPIO 16 |
| SCK | GPIO 17 |

Load cell → HX711: red → E+, black → E−, white → A−, green → A+. Swapped A+/A−
wires are handled by calibration (negative scale factor).

### Safety
Every shackle, sling and carabiner in the chain must be rated well above the
expected load. One-arm and dynamic pulls produce much higher peaks than a static hang.

## Sample rate: 80 Hz

- Peak force in a hard pull lasts about 100–200 ms; 10 Hz misses it.
- Rate of force development (RFD) needs high sample rates.
- At 300 kg range, 80 Hz noise is roughly ±50–100 g, which doesn't matter here.
- The ESP samples at 80 Hz and sends them in batches at about 20 Hz. The big number
  on screen is smoothed; graphs, peaks and analysis use every sample.
- On boot, the firmware measures the actual sample rate and reports it, which
  confirms whether the RATE mod worked.

## Bluetooth

80 samples/s as 2-byte values is 160 B/s, a few percent of what BLE handles even with
default settings. Notifications every ~50 ms with ~4 samples give the same 20 Hz
screen updates as before, with ~20–60 ms latency. BLE retransmits lost packets while
connected; sequence numbers detect gaps after a reconnect. Range ~10 m indoors.

### GATT service

Custom service `9a0b0001-3d10-4e93-8657-4a72c5dd3311` (characteristics `9a0b0002…0005`,
same suffix), advertised with the name `Erkdek`. All values little-endian.

| Characteristic | UUID | Properties | Content |
|---|---|---|---|
| Samples | `9a0b0002-…` | notify | `seq` u16, `t0` u32 (ms of first sample), `dt` u16 (µs per sample), then n × i16 force in 10 g units (±327.67 kg). 6 samples fit the default 23-byte MTU; the firmware asks for MTU 247. |
| Status | `9a0b0003-…` | read, notify (1 Hz and after events) | flags u8 (bit0 tared, bit1 calibrated), rate u16 (0.1 Hz), counts per kg f32, uptime u32 ms |
| Command | `9a0b0004-…` | write, write without response | opcode u8: 1 tare, 2 calibrate + kg f32, 3 reset calibration, 4 set calibration + counts per kg f32 |
| Event | `9a0b0005-…` | notify | 1 tared · 2 calibrated + u8 calibrated + counts per kg f32 · 3 calibration failed + u8 reason (1 bad weight, 2 too small) |
| Firmware Revision | `2A26` in Device Information `180A` | read | git version, e.g. `27d90cf` |

- The firmware asks for a 7.5–15 ms connection interval and sends samples every 50 ms.
- Encoding/decoding: `lib/core/ble_protocol.h` (firmware) and `data/bleprotocol.js`
  (app), both tested against the same byte vectors.
- The app remembers the device and reconnects automatically (milestone D).

## Architecture

```
Load cell ─► HX711 (80 Hz) ─► ESP32
                                ├─ Sensor task (core 1): read, tare/scale, ring buffer
                                ├─ BLE service (NimBLE): samples, status, commands, events
                                └─ NVS: calibration
Android app (Capacitor) ◄── BLE ──► live view, graph, timer, routines, workouts,
                                     tests, history, settings
                                     └─ IndexedDB: settings, routines, workouts,
                                        holds/grips, sessions
```

### App
- The existing web app (plain HTML/JS/CSS, no build step) is the app's UI. Capacitor
  packages it; only the connection and storage layers change.
- **Transport** (interface in `device.js`): two implementations:
  - Capacitor BLE (`@capacitor-community/bluetooth-le`) in the Android app,
  - simulated sensor (`simdevice.js`) in a desktop browser for development.
- **Storage:** the stores the screens already use (settings, routines, workouts,
  holds/grips, sessions) keep their interfaces but read/write IndexedDB instead of
  the ESP's HTTP API. Backup/restore and routine files keep working unchanged.
- Charting: uPlot (local copy). Beeps via Web Audio. Screen kept on during runs with
  a keep-awake plugin.

### Firmware stack
- PlatformIO + Arduino framework
- HX711 read in a dedicated FreeRTOS task
- NimBLE-Arduino 2.5 for the BLE service; Preferences (NVS) for calibration
- Program space: ~46 % of the 1.25 MB app partition (was ~69 % with WiFi and the web server)
- Pure logic (calibration, rate meter, ring buffer, BLE packet encoding) in
  hardware-independent C++, unit tested with PlatformIO's `native` environment

## Storage

**In the app (phone)**
- IndexedDB: settings (bodyweight, rep threshold), routines, workouts, own holds and
  grips, sessions (summary, per-rep stats, compressed force curve).
- Kept until the app is uninstalled or its data is cleared, so **backups matter**:
  Settings → Backup downloads everything as one JSON file.

**On the ESP**
- NVS: calibration (counts per kg). Tare happens on boot and on request.

**Downloads from the app**
- Per session: CSV (raw 80 Hz data right after a run) or JSON; all sessions as CSV.
- Routine files for sharing; full backup and restore.

## Development

- **On the computer:** `python3 tools/serve.py` and open the app in a desktop browser;
  it uses the simulated sensor. No hardware needed.
- **Tests:** `npm test` (app logic), `pio test -e native` (firmware logic).
- **Firmware:** compiled with PlatformIO (no board needed to compile).
- **Android app:** built from the terminal with the Android command-line tools and
  installed with `adb` over USB.

### Toolchain
| Tool | Version | Notes |
|---|---|---|
| Node.js | ≥ 22 (via nvm) | Capacitor 8 requires it; system Node 18 stays untouched |
| Capacitor | 8.5.x | `@capacitor/core`, `@capacitor/cli`, `@capacitor/android` |
| BLE plugin | `@capacitor-community/bluetooth-le` 8.x | |
| JDK | 21 | already installed |
| Android SDK | command-line tools, platform-tools, platform 36, build-tools 36 | in `~/Android/Sdk`; compileSdk/targetSdk 36, minSdk 24 (Android 7) |
| PlatformIO | | firmware, `pipx install platformio` |

Phone: enable Developer options and USB debugging, then `adb install`.

## Project layout

```
erkdek/
├─ PLAN.md
├─ platformio.ini        firmware build
├─ src/                  firmware: sensor task (sensor.*, hx711.*), BLE service (ble.*), NVS (storage.*)
├─ lib/core/             hardware-independent firmware logic
├─ test/                 native firmware tests, test/js app tests
├─ data/                 the app UI (HTML/JS/CSS), Capacitor's web dir
├─ android/              Capacitor Android project (generated, then committed)
├─ capacitor.config.json
├─ package.json
└─ tools/                dev server (serve.py), firmware build scripts
```

## Features (built, tested against the mock)

- **Live view:** large weight readout, rolling graph, peak hold and reset, % of
  bodyweight, tap-to-set target, tare.
- **Calibration wizard:** tare, hang a known weight, enter its mass, save. Auto-tare on boot.
- **Routines:** sets × reps × hang/rest, get-ready, target (kg or % bodyweight), hold,
  grip, hands (both, left, right, alternating with change-hand rests), templates,
  editor, download/import.
- **Workouts:** routines in a row with a confirmation before each next routine.
- **Run screen:** countdown, one beep per phase change, live hold %, target band.
- **Tests:** max pull, critical force (24 × 7:3), RFD; per hand, hold and grip.
- **Summary and history:** hold %, work vs target, force retention, per-rep values,
  ⓘ explanations, progress charts per hand, personal bests, session details.
- **Settings:** bodyweight, rep threshold, own holds/grips, calibration, backup, About.
- **Export/import:** CSV/JSON per session, all sessions as CSV, routine files, backup.

## Future options (not in planned work)

### OLED display
A 0.96" SSD1306 OLED (I²C, SDA → GPIO 21, SCL → GPIO 22) showing live weight and
connection state, as a readout without the phone.

### iPhone
Capacitor and the BLE plugin support iOS, but building needs a Mac with Xcode, and
installing needs an Apple ID (free: re-install every 7 days) or the Apple Developer
Program (~$99/year).

### WiFi web page as a fallback
Keep the ESP's web server so any browser (iPhone, computer) can use it without the
app. Costs firmware space (likely a partition change) and splits data between the
phone and the ESP. The WiFi version of the firmware is in git history (up to the
switch to BLE).

### Tindeq protocol
Tindeq has published the Progressor BLE protocol. Copying it might make the device
usable from the official Tindeq app (unverified).

## Milestones

Done (web app and WiFi firmware, tested against the mock server):
1. Live weight · 2. Calibration · 3. Live graph · 5. Timer and routines ·
6. Tests and history · 7. Export/import · plus workouts, hands, holds/grips,
granular rep metrics, gzip bundle and About.
(4. WiFi networking was dropped in favour of Bluetooth.)

Next:
- **A. App storage (done):** move settings, routines, workouts, holds/grips and sessions from
  the ESP's HTTP API to IndexedDB behind the existing store interfaces. Backup,
  restore and exports keep working. Storage info under Settings → About reflects the
  phone.
- **B. Simulated device in JS (done):** port the mock's force simulation (including "pull
  during each hang") into a transport, so the app runs in a desktop browser with no
  server. Retire `tools/mock_server.py`.
- **C. BLE protocol and firmware (done, compile-tested):** packet encoding in `lib/core` with tests, NimBLE
  service on the ESP, remove WiFi/web server/LittleFS. Compile-tested.
- **D. Android app:** Capacitor project, BLE transport with scan/connect/auto-reconnect
  and permissions, keep-awake during runs, app name/icon. Build the APK and install it
  on the phone (with the simulated device until the hardware arrives).
- **E. Hardware bring-up:** flash, RATE check, calibrate, BLE range and latency test,
  real-world tuning.
