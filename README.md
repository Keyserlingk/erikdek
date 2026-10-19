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

## Firmware

Requires PlatformIO (`pipx install platformio`). The firmware still has the WiFi web
server; milestone C replaces it with Bluetooth.

```sh
pio test -e native        # unit tests for lib/core on the PC
pio run                   # build firmware
pio run -t upload         # flash
pio run -t uploadfs       # upload the web app (data/, gzipped) to LittleFS
pio device monitor        # serial log, shows the IP address
```

WiFi: copy `include/wifi_secrets.example.h` to `include/wifi_secrets.h` to join your
phone hotspot. Otherwise, or if the hotspot isn't found within 15 s, the ESP starts its
own network `Erkdek` (password `erkdek123`) at http://192.168.4.1.

## Wiring

| HX711 | ESP32 |
|---|---|
| VCC | 3.3V |
| GND | GND |
| DT | GPIO 16 |
| SCK | GPIO 17 |

Bridge the HX711 RATE pin to VCC for 80 Hz. The web app warns if the measured rate is low.
