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
- **Be a general climbing training app:** also routines that don't use the sensor
  (campus board, pull-ups and lock-offs to start with), timed or self-paced, with effort
  and added weight logged, mixed freely with sensor routines in workouts.
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

## Training types (beyond the sensor)

Decided 2026-10-19. Every routine gets a **type**; the existing timing structure (sets,
reps, rest between reps and sets, get-ready, beeps) stays the same for all of them.

| Type | Sensor | How a rep ends | Examples |
|---|---|---|---|
| **Hangboard** | yes | fixed time (countdown) | repeaters, max hangs, endurance (today's routines) |
| **Timed** | no | fixed time (countdown) | lock-offs, timed pull-up sets |
| **Self-paced** | no | the climber taps **Done** (the rep shows a stopwatch), then rest counts down | campus ladders, pull-up sets, bumps |

- **Instruction:** each routine has an instruction text shown big on the run screen,
  e.g. "1-3-5-7 on medium rungs". Optionally a different instruction per set, for
  routines that change during the session (e.g. ladder 1-3-5 → 1-4-7 → 1-5-9).
- **Logging, per set after its last rep (non-sensor routines):**
  - **Effort (RPE 1–10):** quick tap on a row of numbers; can be skipped.
  - **Added weight (kg):** for routines that use it (e.g. weighted pull-ups); set per
    routine in the editor, pre-filled from the routine and editable after each set
    (e.g. when you add a plate). Negative values mean assistance (band, pulley).
  - The climber counts moves/reps themselves; they aren't logged.
- **Run screen without the sensor:** no force box or graph; instead a large instruction,
  the countdown (timed) or stopwatch with a **Done** button (self-paced), set/rep
  progress and what's next. The sensor doesn't need to be connected.
- **Summary and History:** per set: duration, effort and added weight; totals: time,
  average and highest effort, highest added weight, volume (added weight × reps).
  History "Compare by" offers these for non-sensor routines (e.g. added weight over
  time for weighted pull-ups, effort for the same campus routine).
- **Workouts** can mix types (e.g. hangboard → campus → pull-ups); the sensor is only
  needed while a hangboard routine runs, and the app says so before it starts.
- **Templates by category** in the Templates tab, with category headings:
  - **Hangboard:** the existing three.
  - **Campus board:** ladders 1-3-5 / 1-4-7 (self-paced), bumps, max reach,
    campus endurance (timed).
  - **Pull-ups & lock-offs:** pull-up sets, weighted pull-ups (added weight), pyramid,
    lock-offs at 90° / 120° (timed), offset pull-ups.
  - Later: bouldering & endurance (4×4, limit, ARC), core, antagonist, mobility.
- **Tests** stay sensor-based (max pull, critical force, RFD).

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
| Status | `9a0b0003-…` | read, notify (1 Hz and after events) | flags u8 (bit0 tared, bit1 calibrated), rate u16 (0.1 Hz), counts per kg f32, uptime u32 ms, tare noise rms/peak-to-peak u16 g, battery u16 mV, protocol version u8 (2), ADC u8 (1 HX711, 2 ADS1220), ADS1220 rate u16 SPS (0 for the HX711) |
| Command | `9a0b0004-…` | write, write without response | opcode u8: 1 tare, 2 calibrate + kg f32, 3 reset calibration, 4 set calibration + counts per kg f32, 5 set ADS1220 rate + SPS f32 (20/45/90/175/330/600/1000/2000; saved on the sensor) |
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
- **Transport** (interface in `device.js`): three implementations:
  - Capacitor BLE (`@capacitor-community/bluetooth-le`) in the Android app,
  - a Tindeq Progressor over the same plugin (`tindeqtransport.js`),
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
├─ src/                  firmware: sensor task (sensor.*, ADC drivers adc.h, hx711.*, ads1220.*), BLE service (ble.*), NVS (storage.*)
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
- **How force results are worked out** (`data/analysis.js`, tested):
  - *Peak force* = the highest 50 ms average (`peakForce`), not the highest sample: a jerk
    at the top doesn't count in full, so HX711, ADS1220 and Tindeq agree. Also per rep.
    Best 1 s average next to it.
  - *RFD* (`rfdOfPull`): baseline = average over up to 250 ms before the pull (the runner
    keeps 250 ms before a force start); onset = baseline + max(1 kg, 3 × its noise),
    traced back down the rise on a 20 ms average to the last sample at the starting
    level. So a pull from a relaxed hang (not 0 kg) works. Reported: rise over 0–200 ms
    (headline) and 0–100 ms from onset, peak RFD (steepest 50 ms), time to 90 % of the
    way from baseline to peak. A baseline that moves more than max(0.5 kg, 3 % of the
    pull), or less than 100 ms of quiet before it, marks the attempt not still: its RFD
    is left out (unless all are) and the result says how many.
  - Checked against simulated pulls with known RFD at 80 Hz (HX711 with its ~50 ms
    settling, Tindeq) and 330/1000 Hz (ADS1220): within ~2 % for fast pulls and from a
    10 kg baseline; slow, gently starting pulls read ~5–15 % high (no sharp onset). The
    HX711 reads peak RFD ~10 % low on very fast pulls.
  - Sample spacing is measured from the sensor's timestamps over the run (pauses left
    out), not taken from the nominal rate. Max pull and RFD keep their rep curves at up
    to 400 Hz so editing a session gives the same results; sessions record the sensor
    (`sensor: {mode, adc, hz}`), shown in the session's details.
- **Summary and history:** hold %, work vs target, force retention, per-rep values,
  ⓘ explanations, progress charts per hand, personal bests, session details.
- **Settings:** bodyweight, rep threshold, own holds/grips, calibration, backup, About.
- **Export/import:** CSV/JSON per session, all sessions as CSV, routine files, backup.
- **Play:** Pong and Flappy steered by the pull (full range in kg or % bodyweight), best
  scores per profile; Pong has Easy / Normal / Hard (ball speed, computer skill), results
  per difficulty; touch fallback without a sensor. Tug of war against the computer
  (pulls compared in kg, % bodyweight or % of your max pull; the computer pulls a share
  of your max in waves), built so a second phone's level can replace the computer.

## Play: multiplayer

The connection layer, the lobby and two-phone Tug of war, Pong and Flappy are built. Single-player games live in
`data/games/` (pure logic) and `data/play.js` (UI). Two climbers, each with their own
phone and sensor, playing against each other.

**Connection options** – both give games the same connection object (events `open`
{peerName}, `message`, `close`, `status` waiting/connecting/open/reconnecting/closed,
`error` text; `send(obj)`, `ping()`, `close()`, `open`, `peerName`, `role`), so a game
doesn't care which one is used.
- *Game code over the internet* (`data/net.js`, built) – `hostGame({name})` gives a
  4-letter code (letters that can't be confused: `ACDEFGHJKMNPQRTUVWXY`), the friend
  types it into `joinGame(code, {name})`. Uses Trystero (pinned 0.25.4, vendored as one
  ES module `data/vendor/trystero.js` by `npm run vendor` with esbuild): public Nostr
  relays carry only the handshake, encrypted with the code as password (room
  `erkdek-play-v1` + code); then WebRTC runs directly between the phones with public
  STUN. No login, no server of our own. No TURN relay, so very strict networks (some
  mobile carriers, guest Wi-Fi) can fail to connect – the guest then gets "couldn't reach
  the other phone" after 20 s.
  - Exactly two per room: the host answers a third player's hello with "full", which
    closes it with "This game already has two players."
  - A hello carries the name, role and a protocol number (a different app version is
    refused). Everything goes over one Trystero action as `{k: hello|full|msg|ka|bye}`.
  - Keep-alive every 2 s when nothing else is sent; 6 s of silence or Trystero losing the
    peer → `reconnecting`; back within 10 s → `open` again (a reloaded app with a new id
    may take the slot), else `close`. `close()` sends "bye" so the other side closes at
    once. Errors: offline, no relay reachable after 10 s, no host after 20 s.
  - Checked live (two headless Chromes on one laptop, real relays): connected in 1–4 s,
    150 messages each way at 30/s all arrived, ping 0–3 ms (same machine; phones on
    different networks will be tens of ms).
- *QR codes on the same Wi-Fi* (`data/netqr.js` + `data/qr.js`, built) – no internet and
  no server: `hostOffline({name})` gives `{offer, link, acceptAnswer}`; the host shows
  `qrElement(offer)`, the guest scans it (`scanQr()`) into `joinOffline(text, {name})` →
  `{answer, link}` and shows the answer QR, which the host scans into `acceptAnswer`.
  WebRTC with `iceServers: []` (LAN host candidates only), non-trickle (3 s gathering cap).
  - Codes are `ERK1` + base64url of a binary digest (ICE ufrag/pwd 6-bit packed, sha-256
    fingerprint, up to 8 UDP host candidates as IPv4/IPv6/mDNS-uuid + port); the fixed
    rest of the SDP is rebuilt on the other side. 90–106 characters with one candidate
    (QR version 5–6, M). Other QR codes, other versions and the wrong side's code are
    refused with a plain message (and the scanner keeps scanning).
  - Data channel negotiated (id 0); hello with the name, keep-alive every 2 s, 6 s silent
    or ICE "disconnected" → `reconnecting`, 15 s silent or ICE "failed" → `error` +
    `close`; host gives up 20 s after scanning the answer, guest 3 min after showing it.
  - Scanner: `getUserMedia` + jsQR (pinned 1.4.0, Apache-2.0) on downscaled frames,
    `BarcodeDetector` instead where the browser has it (Android WebView doesn't). Encoder
    qrcode-generator (2.0.4, MIT). Both copied to `data/vendor/qr/` by `npm run vendor`.
    Android: CAMERA permission in the manifest; Capacitor's WebView asks for it at
    runtime when `getUserMedia` is first called. A "paste a code" field for the browser.
  - Checked live: two headless Chromes, offer → answer passed as text: connected in
    0.1 s, messages both ways, ping 0–5 ms; works with mDNS (`….local`) candidates on
    both sides, real IPs, and mixed. A rendered QR decodes again from a screenshot and
    from Chrome's fake camera.
  - Fragile: Chrome hides LAN IPs behind mDNS names unless camera access was granted; two
    phones then need multicast DNS on the Wi-Fi (some guest/corporate Wi-Fi block it, or
    isolate clients altogether – then nothing local works).

**Lobby and games (built)** – `data/playduel.js` + the `duel` part of each game in
`data/play.js`; pure helpers in `games/*.js` (tested).
- Play home has a "Play with a friend" card: Host a game (shows the code) / Join a game
  (type it), or "Same Wi-Fi, no internet?" → Show my code / Scan a code (two scans).
  Once connected both see "Connected to <name> · <ping> ms"; the host's game cards say
  "Play with <name>" and start the game on both phones with the host's settings
  (difficulty, scale); the guest waits for the host's pick.
- Messages `{t: hi | start | tick | leave}`: `hi` says whether the player has a
  bodyweight (% BW scale only when both do); `start {game, opts}`; `tick {d, ev}` ~30/s
  each way; `leave` ends the game for both (the lobby stays connected).
- *Tug of war* and *Pong*: the host runs the game with the guest's latest level and sends
  the state + events; the guest shows it turned round (`mirrorTug` / `mirrorPong`, events
  through `mirrorEvent`), so each sees themselves at the bottom. Each phone puts its own
  force on the scale (own full range / bodyweight / max), so different strengths are
  fair. Pong's guest moves the ball on between states (`coastPong`) and draws its own
  paddle at once from its sensor; the host decides hits (so the guest's paddle counts
  ~half a ping late).
- *Flappy*: the same seed and field width (80) on both phones, so each flies the same
  course on its own; the friend's bird is drawn faintly, the one that gets further wins
  (`flappyDuelResult`).
- No pause in a two-phone game; leaving the tab doesn't stop it. Results don't count
  towards the solo stats. The host's end screen has Play again.
- Checked with two headless Chromes (a script driving both over CDP): all
  three games to the end over game code, Tug of war over QR (pasted codes), play again,
  quitting, leaving.
- Not yet: a 3-2-1 countdown for Pong/Flappy, lag compensation (bigger guest hitbox),
  rematch requests from the guest.

**Later: two players on one phone** – the app connects to two sensors at once (two BLE
connections, one per player), Pong with paddles at both ends (each player's full range set
separately), Flappy with two birds. No networking, but needs multi-device BLE in
`bletransport.js` and a sensor picker per player.

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
Tindeq has published the Progressor BLE protocol. Copying it in the Erkdek firmware
might make the Erkdek usable from the official Tindeq app (unverified).

The app itself can use a real Progressor as its sensor (Settings → Sensor → Tindeq;
`data/tindeqprotocol.js`, `data/tindeqtransport.js`). Protocol as verified on
a Progressor with firmware 2.0.4 (2026-10-25, `tools/tindeq_probe.py`):
- Service `7e4e1701-1ea6-40c9-9dcc-13d34ffead57`: data `…1702` (notify), control point
  `…1703` (write, with or without response). Also a Nordic DFU service (`fe59`).
- Commands, one byte: `0x64` tare, `0x65` start weight, `0x66` stop weight,
  `0x6B` firmware version (`"2.0.4"`), `0x6C` error info (`deadbeef` = none),
  `0x6F` battery (u32 mV, e.g. `00 04 b4 0e 00 00` = 3764 mV), `0x70` device id (6 bytes:
  its Bluetooth address, reversed). Not tried: `0x6E` (sleep/off), `0x69`/`0x6A`
  (calibration). Older write-ups that put the battery at `0x6B` and the version at
  `0x70` are wrong for this firmware.
- Notifications: code u8 | length u8 | payload. Code 0 = reply to a query (it doesn't
  say which: one at a time). Code 1 = weight: n × (f32 kg, u32 µs), little-endian, e.g.
  `01 78 | 78 eb 45 be 02 d8 00 00 | …` = -0.193 kg at 55298 µs. Code 4 = low battery
  (not seen).
- Any command while measuring (tare, battery, …) stops the measurement: the app starts it
  again right after (a ~0.1 s gap). Tare itself sends no reply; it zeroes the reading
  (-0.19 → 0.00 kg) and the zero stays across connections.
- Timestamps: µs since the start command (first sample at ~55 ms), restarting at 0 on
  every start. After a command stopped the measurement, the last few samples from before
  come first in the next notification.
- Rate: sample period 11.61 ms (86.1 Hz), but about one sample per notification is
  skipped (a double-length step), so 80.6 Hz effective (240 s run: 19290 samples, no
  other gaps). 15 samples (120 bytes) per
  notification, one every ~186 ms (the link has a large MTU; with 23 bytes it would be
  2 per notification). Streams until stopped (tested 4 minutes).
- Units kg; noise ~4 g rms unloaded; drifted ~20 g in 4 minutes without load.

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
- **D. Android app (done; debug and signed release builds installed on the phone):** Capacitor project, BLE transport with scan/connect/auto-reconnect
  and permissions, keep-awake during runs, app name/icon. Build the APK and install it
  on the phone (with the simulated device until the hardware arrives).
- **F. Routine types (done):** type field (hangboard / timed / self-paced), instruction (per
  routine and optionally per set), added weight per routine, editor and routine list
  updated, routine files and backups carry the new fields. Existing routines are
  hangboard routines.
- **G. Run screen without the sensor (done):** instruction view, stopwatch + Done for
  self-paced reps, per-set effort (RPE) and added-weight entry, no sensor needed;
  workouts mixing types (connect the sensor only for hangboard parts).
- **H. Summary, History and templates (done):** non-sensor summaries and metrics (effort,
  added weight, volume, time), "Compare by" for them, category headings in Templates,
  campus board and pull-up/lock-off templates.
- **E. Hardware bring-up:** flash, RATE check, calibrate, BLE range and latency test,
  real-world tuning.
- **I. Firmware updates over Bluetooth (built 2026-10-23; to test on the phone):** update the sensor from the app,
  no USB cable.
  - *Firmware:* an update service on the BLE GATT server: start (size + SHA-256),
    data packets (write without response, MTU 247), end. Written to the second OTA
    slot with the ESP-IDF OTA API while the current firmware keeps running; the
    boot slot only switches after the whole image arrived and the checksum matches,
    then restart. Packet layout in `lib/core` with native tests, mirrored in
    `data/bleprotocol.js`. Check the partition table (two app slots; firmware is
    ~46 % of one).
  - *Protection:* first built with a BOOT-button window; removed on request (2026-10-23),
    so any app in range can update it. Only a complete, SHA-256-verified image is
    switched to, with rollback.
  - *Rollback:* check whether the Arduino/PlatformIO bootloader has
    `CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE`; if so, mark the new image valid once
    BLE is up, else USB stays the way back from a firmware that crashes on start.
  - *App:* every APK carries the firmware built from the same code:
    `tools/build_android.sh` also runs `pio run` and copies `firmware.bin` into
    `data/firmware/` (git-ignored) with its version (~0.6 MB, ~30 s more per build).
    Versions are content-based (`tools/fwversion.py`, done), so an app-only update
    doesn't offer a firmware update. Settings → Sensor shows "Firmware fw-… available
    (sensor has fw-…) → Update sensor" (optionally pick a .bin), with progress,
    cancel, retries, reconnect after the restart and a version check. The status's
    protocol version (done) marks a sensor that must be updated. The simulator gets
    a fake update for testing the screen.
  - ~600 KB at BLE speed: expect 30–60 s. Only testable on the board.
