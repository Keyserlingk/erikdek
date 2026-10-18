# Erkdek DIY – Plan

A DIY force gauge for climbing training (Tindeq Progressor style). An S-type load cell
feeds an HX711, which feeds an ESP32. The ESP32 serves a web app that runs in the
phone's browser and shows live force, graphs, timers, workout routines and progress history.

## Objective

Build a cheap, self-made alternative to the Tindeq Progressor for finger-strength and
pulling training. It should:

- **Measure force accurately:** 80 Hz sampling, calibrated with known weights, good
  enough to capture peak force and rate of force development.
- **Work from the phone with no extra app:** the ESP32 joins the phone's hotspot
  (with its own network as a fallback) and serves a web app to the phone's browser.
- **Support structured training:** live force and graph, work/rest timer, custom
  workout routines and standard tests (max pull, critical force, RFD).
- **Track progress over time:** results and personal bests stored on the device,
  with progress charts.
- **Keep the data accessible:** export sessions or everything as CSV/JSON, and
  restore from a backup.
- **Be developable without hardware:** a mock ESP server for the web app and
  PC-run unit tests for the logic.

## Hardware

| Part | Notes |
|---|---|
| S-type load cell, 300 kg | Has eyes for slings and carabiners; 4-wire full bridge |
| HX711 breakout | **Bridge RATE to VCC for 80 Hz** (most boards default to 10 Hz) |
| ESP32 NodeMCU WROOM-32 (USB-C, CH340) | 4 MB flash |
| Power | USB power bank or 18650 + charger/protection board |

### Wiring

| HX711 | ESP32 |
|---|---|
| VCC | 3.3V (keeps DOUT at 3.3 V logic) |
| GND | GND |
| DT / DOUT | GPIO 16 |
| SCK | GPIO 17 |

Load cell → HX711: red → E+, black → E−, white → A−, green → A+.
If force reads negative under load, swap white and green.

### Safety
Every shackle, sling and carabiner in the chain must be rated well above the
expected load. One-arm and dynamic pulls produce much higher peaks than a static hang.

## Sample rate: 80 Hz

- Peak force in a hard pull lasts about 100–200 ms; 10 Hz misses it.
- Rate of force development (RFD) needs high sample rates.
- At 300 kg range, 80 Hz noise is roughly ±50–100 g, which doesn't matter here.
- The ESP samples at 80 Hz and sends samples to the browser in batches at about 20 Hz.
  The big number on screen is smoothed; graphs and peak detection use raw data.
- On boot, the firmware measures the actual sample rate and reports it, which
  confirms whether the RATE mod worked.

## Networking

Goal: the ESP joins the **phone's hotspot**, so the phone keeps mobile internet.
The hard part is finding the ESP's IP: Android randomizes the hotspot subnet, and
`.local` (mDNS) names are unreliable on Android.

Connection order:
1. **Station mode:** join the configured hotspot SSID.
2. **Fallback AP mode:** if no known network is found within about 15 s, the ESP
   creates its own network `Erkdek` at `192.168.4.1`, with a captive-portal DNS
   so Android shows a "Sign in to network" popup.
   This mode is also used to enter hotspot credentials the first time.

Ways to find the ESP in station mode (several, because none of them is perfect alone):
- **Push notification via ntfy.sh:** the hotspot has internet, so on connect the ESP
  posts `Erkdek at http://<ip>` to a private ntfy topic. With the ntfy Android app,
  the notification is clickable and opens the page. Free, no account needed.
- **mDNS `http://erkdek.local`:** works on some Android/Chrome versions; free to add.
- **Remember the last IP:** the web app stores it, and the ESP asks DHCP for the same address.

The web app keeps the transport (WebSocket) behind a small interface so that
Bluetooth can be added later (see Future options).

## Architecture

```
Load cell ─► HX711 (80 Hz) ─► ESP32
                                ├─ Sensor task (core 1): read, tare/scale, ring buffer
                                ├─ Web server + WebSocket (core 0)
                                ├─ NVS: calibration, settings, WiFi credentials
                                └─ LittleFS: web app, routines, session history
Phone browser ◄── WebSocket / HTTP ──► live view, graph, timer, routines, history
```

### Firmware stack
- PlatformIO + Arduino framework
- HX711 read in a dedicated FreeRTOS task (interrupt/poll on DOUT ready)
- ESPAsyncWebServer + AsyncWebSocket, ArduinoJson, ESPmDNS, DNSServer
- Pure logic (filtering, rep detection, stats) in hardware-independent C++,
  unit tested with PlatformIO's `native` environment

### Web app
- Plain HTML/JS/CSS, no build step. Every asset served from the ESP (gzipped),
  no CDN, because AP mode has no internet.
- Charting: uPlot (about 40 KB), local copy.
- Audio cues via Web Audio (works over plain HTTP).
- Screen wake lock needs HTTPS; workaround is a hidden looping video (NoSleep-style),
  or turning up the phone's screen timeout.

### Protocol (initial draft)
- `GET /` → web app
- `WS /ws`
  - ESP → browser: `{"t":"samples","ts":<ms>,"kg":[..]}` at about 20 Hz,
    `{"t":"status","rate":80.1,"tared":true,...}`
  - Browser → ESP: `{"cmd":"tare"}`, `{"cmd":"calibrate","kg":20.0}`
- `GET/PUT /api/settings`
- `GET/PUT /api/routines` (custom routines as one JSON array; built-ins live in the web app)
- `GET/PUT /api/holdtypes`, `GET/PUT /api/grips` (the user's own holds/grips as JSON arrays; standard ones live in the web app)
- `GET /api/sessions` (index as NDJSON, one summary per line), `POST /api/sessions`,
  `GET/DELETE /api/sessions/<id>`, `GET /api/storage`
- Export/import is done in the browser from the APIs above (no firmware code or RAM
  needed): raw 80 Hz CSV right after a run, per-session CSV/JSON, all-sessions CSV,
  a full JSON backup restored item by item, and routine files (`erkdek-routines`,
  one or all routines) for sharing, imported as new routines. WebSocket `{"cmd":"setCalibration","cpk":..}`
  restores the scale factor.

## Storage

**On the ESP**
- NVS: calibration (offset and scale), settings (bodyweight, units, smoothing,
  rep threshold), WiFi credentials, ntfy topic.
- LittleFS (about 1.5 MB): routines, personal bests, session summaries with
  downsampled force curves.

**Downloads from the phone**
- Per session: CSV (raw 80 Hz data from the session just recorded) or JSON.
- Full backup: JSON with everything above. It can be re-imported after
  reflashing or onto a new board.

## Developing without hardware

- **Mock ESP server** (`tools/mock_server.py`): serves `data/` and implements the
  same HTTP API and WebSocket protocol, generating simulated force curves
  (hangs, pulls, noise, an occasional spike). The web app is identical against the
  mock and the real ESP.
- **Firmware:** written now and compiled with PlatformIO (no board needed to
  compile). Logic is unit tested on the PC (`pio test -e native`).
- **When the ESP arrives:** flash it, run the RATE check, calibrate, done.

## Project layout

```
erkdek/
├─ PLAN.md
├─ platformio.ini
├─ src/
│  ├─ main.cpp        setup, tasks
│  ├─ sensor.*        HX711 task, tare/calibration, ring buffer
│  ├─ net.*           STA/AP, captive DNS, mDNS, ntfy, web server, WebSocket
│  └─ storage.*       NVS + LittleFS
├─ lib/core/          hardware-independent logic (filters, rep detection, stats)
├─ test/              native unit tests
├─ data/              web app (index.html, app.js, style.css, uplot.min.js)
└─ tools/
   └─ mock_server.py  ESP simulator for web development
```

## Features

- **Live view:** large weight readout, rolling graph, peak hold, % of bodyweight, tare button.
- **Calibration wizard:** tare, hang a known weight, enter its mass, save. Optional multi-point. Auto-tare on boot.
- **Timer:** work/rest countdown with beeps and a set/rep counter.
- **Routines:** sets × reps × work/rest, optional target load band shown on the graph,
  user presets plus built-ins (7/3 repeaters, max hang, critical force).
- **Tests:** max pull (per hand), critical force (24 × 7/3, averaging the final reps), RFD.
- **History:** saved sessions, progress charts per test type, personal bests.
- **Settings:** WiFi/hotspot credentials, ntfy topic, bodyweight, units, smoothing, rep threshold.
- **Export/import:** CSV/JSON per session, full JSON backup and restore.

## Future options (not in planned work)

### OLED display
A 0.96" SSD1306 OLED (I²C, SDA → GPIO 21, SCL → GPIO 22) showing the IP address,
WiFi mode and live weight. Makes finding the device in hotspot mode trivial and gives
a readout without the phone.

### Bluetooth instead of WiFi (Web Bluetooth)
Chrome on Android can talk to BLE devices directly from a web page, so no Android app is needed.
- The web app must be served over HTTPS, so it would be hosted, for example on GitHub
  Pages, and installed as an offline-capable PWA. The ESP then only does BLE: no web
  server, no WiFi.
- Pros: no IP discovery, phone keeps its internet, proper screen wake lock,
  app updates without reflashing, lower power use.
- Cons: Chrome-based browsers only (no iPhone/Firefox), needs hosting, the user taps
  "Connect" and picks the device each session, and history would naturally move to the
  phone (IndexedDB) with calibration staying on the ESP.
- 80 Hz is easy over BLE: notifications at about 20 Hz with 4 samples each.
- Bonus idea: Tindeq has published the Progressor BLE protocol. Copying it might
  make the device usable from the official Tindeq app (unverified).

## Milestones

1. **Live weight:** mock server and web page showing live kg, a tare button and the
   sample rate; firmware skeleton with HX711 task and WebSocket.
2. **Calibration:** wizard in the UI, persisted in NVS.
3. **Live graph:** uPlot chart, peak hold, % bodyweight.
4. **Networking:** STA to hotspot with AP fallback, captive portal, mDNS, ntfy notification, WiFi settings page.
5. **Timer and routines:** beeps, rep detection, routine editor, built-in presets.
6. **Tests and history:** max/CF/RFD protocols, session storage, progress charts.
7. **Export/import:** CSV/JSON downloads, backup restore.
8. **Hardware bring-up:** flash, RATE check, calibrate, real-world tuning. Also:
   - **Web app size:** measured at 127 KB raw / 48 KB gzipped (19 files), about 9 % of
     the 1.38 MB LittleFS partition, so space is fine. To speed up the first load,
     gzip `data/` at `uploadfs` time with a PlatformIO extra script (the web server
     serves `.gz` automatically) and add cache headers for static files (with
     versioned file names, so updates aren't hidden by the cache). Measure load time
     on the real device before and after.
   - **Program space:** firmware is at ~68 % of the 1.25 MB app partition. If
     networking (HTTPS client for ntfy) makes it tight, switch to a partition
     table without the second OTA slot.
