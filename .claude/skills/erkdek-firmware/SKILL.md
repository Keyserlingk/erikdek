---
name: erkdek-firmware
description: Build, test and flash the Erkdek ESP32 firmware (src/, lib/core/), read its serial console, check it over Bluetooth from the laptop, and change the Bluetooth protocol safely on both firmware and app. Use for any change under src/, lib/, platformio.ini or data/bleprotocol.js.
---

# Erkdek firmware

ESP32 (NodeMCU WROOM-32, CH340 USB serial), Arduino core 2.0.17 under PlatformIO,
NimBLE-Arduino. Load cell amplifier: HX711 on DT=GPIO16, SCK=GPIO17.

## Build and test
```sh
~/.local/bin/pio test -e native     # lib/core tests on the PC (protocol, calibration, console)
~/.local/bin/pio run                # build; prints "version: fw-xxxxxxxx"
```
Put hardware-free logic in `lib/core/` (header-only) so it gets native tests.

## Flash and read the serial console
Only when the task is about the hardware – the user may be using the board.
```sh
~/.local/bin/pio run -t upload --upload-port /dev/ttyUSB0
~/.local/bin/pio device monitor     # interactive; console commands: h for help
```
Reading the console non-interactively (e.g. right after flashing):
```sh
~/.local/share/pipx/venvs/platformio/bin/python - <<'EOF'
import serial, time
s = serial.Serial("/dev/ttyUSB0", 115200, timeout=0.2)
s.dtr = False; s.rts = True; time.sleep(0.1); s.rts = False   # reset into the app
end, buf = time.time() + 5, b""
while time.time() < end: buf += s.read(4096)
print(buf.decode(errors="replace"))
EOF
```
The status line (once a second) shows rate, raw counts, kg, tare/calibration, app
connection, battery and dropped samples, with hints for missing HX711 readings or a
10 Hz RATE pin. Console commands: `t` tare, `c <kg>` calibrate, `r` reset calibration,
`f` fast mode (every reading), `s` status line on/off.

## Bluetooth checks from the laptop
The laptop's Bluetooth may be off: `rfkill unblock bluetooth`. Use a venv with `bleak`
(`python3 -m venv /tmp/blevenv && /tmp/blevenv/bin/pip install bleak`). The Erkdek
advertises as "Erkdek" with service `9a0b0001-3d10-4e93-8657-4a72c5dd3311`
(characteristics 0002 samples, 0003 status, 0004 command, 0005 event, 0006 update).

## Changing the Bluetooth protocol
1. Change the layout in `lib/core/ble_protocol.h` and `data/bleprotocol.js` together.
2. Update the shared byte vectors in `test/test_core/test_main.cpp`,
   `test/js/bleprotocol.test.js` and `test/js/bletransport.test.js`.
3. Update the simulator (`data/simdevice.js`) to behave the same.
4. Raise `kProtocolVersion` and `PROTOCOL_VERSION` together (the app warns on mismatch).
5. Run both test suites, build, flash, check the console and the app.

## Versions and updates over Bluetooth
- `tools/fwversion.py` gives the content-based version (src/, lib/core/, platformio.ini).
- `tools/bundle_firmware.py` builds and copies `firmware.bin` + `firmware.json` into
  `data/firmware/` (git-ignored); the Android build runs it, so each APK can update the
  sensor (Settings → Sensor → Firmware; `src/ota.cpp`, second OTA slot, SHA-256 check,
  rollback if the new firmware doesn't start).
- After changing firmware, rebuild the APK so the bundled firmware matches.
