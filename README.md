# Erkdek DIY

A DIY climbing force gauge built from a load cell, an HX711 and an ESP32, used from an
Android app over Bluetooth. See [PLAN.md](PLAN.md).

## App in the browser (development)

```sh
python3 tools/serve.py                  # http://localhost:8080
npm test                                # app logic tests (Node 18+)
```

In the browser the app uses a **simulated sensor** (`data/simdevice.js`): hangs and
pulls at 80 Hz, tare and calibration, behaving like the firmware. Tap **SIM** in the
header to choose what hangs on it; "Pull during each hang" follows the workout timer.
To try it on the phone, open `http://<laptop-ip>:8080` (same WiFi).

The app stores its data (settings, routines, workouts, sessions) in IndexedDB, per
browser and per address: `localhost:8080` and `192.168.0.8:8080` are separate stores.

## Android app

Capacitor wraps `data/` into an Android app (`android/`) that talks to the sensor over
Bluetooth LE (`data/bletransport.js`). Needs Node 22 (`nvm use`), JDK 21 and the
Android SDK command-line tools (see PLAN.md → Toolchain).

```sh
npm run android           # build android/app/build/outputs/apk/debug/app-debug.apk
npm run android:install   # build and install on the phone (USB debugging on)
python3 tools/make_icons.py   # regenerate app icon and splash screens
```

The app starts with the simulated sensor; switch to **Erkdek (Bluetooth)** under
Settings → Sensor. The first connection shows Android's device picker; the chosen
sensor is remembered and reconnected automatically.

## Firmware

Requires PlatformIO (`pipx install platformio`). The ESP is a Bluetooth LE sensor
(`src/ble.cpp`, protocol in `lib/core/ble_protocol.h`); calibration is kept in NVS.

```sh
pio test -e native        # unit tests for lib/core on the PC
pio run                   # build firmware
pio run -t upload         # flash
pio device monitor        # serial log (BLE name and firmware version)
```

## Wiring

| HX711 | ESP32 |
|---|---|
| VCC | 3.3V |
| GND | GND |
| DT | GPIO 16 |
| SCK | GPIO 17 |

Bridge the HX711 RATE pin to VCC for 80 Hz. The web app warns if the measured rate is low.
