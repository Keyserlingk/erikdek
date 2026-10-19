# Erkdek DIY

A DIY climbing force gauge built from a load cell, an HX711 and an ESP32. See [PLAN.md](PLAN.md).

## Web app without hardware

```sh
python3 tools/mock_server.py            # http://localhost:8080
```

To use it from your phone, open `http://<laptop-ip>:8080` (same WiFi).
The mock simulates the sensor (hangs and pulls at 80 Hz, tare, calibration) using the
same protocol as the firmware. The app stores its own data (settings, routines,
workouts, sessions) in the browser's IndexedDB, per browser and per address:
`localhost:8080` and `192.168.0.8:8080` are separate stores.

The ESP stores the web app gzipped (`tools/gzip_data.py` runs on `buildfs`/`uploadfs`)
and serves `foo.js.gz` for `/foo.js`. To test that exact bundle with the mock:

```sh
pio run -t buildfs
python3 tools/mock_server.py --gzip .pio/build/esp32dev/data_gz
```

## Firmware

Requires PlatformIO (`pipx install platformio`).

Web app logic tests (Node 18+): `npm test`

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
