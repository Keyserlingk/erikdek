# Tindek DIY

A DIY climbing force gauge built from a load cell, an HX711 and an ESP32. See [PLAN.md](PLAN.md).

## Web app without hardware

```sh
python3 tools/mock_server.py            # http://localhost:8080
```

To use it from your phone, open `http://<laptop-ip>:8080` (same WiFi).
The mock simulates hangs and pulls at 80 Hz using the same protocol as the firmware.

## Firmware

Requires PlatformIO (`pipx install platformio`).

Web app logic tests (Node 18+): `npm test`

```sh
pio test -e native        # unit tests for lib/core on the PC
pio run                   # build firmware
pio run -t upload         # flash
pio run -t uploadfs       # upload the web app (data/) to LittleFS
pio device monitor        # serial log, shows the IP address
```

WiFi: copy `include/wifi_secrets.example.h` to `include/wifi_secrets.h` to join your
phone hotspot. Otherwise, or if the hotspot isn't found within 15 s, the ESP starts its
own network `Tindek` (password `tindek123`) at http://192.168.4.1.

## Wiring

| HX711 | ESP32 |
|---|---|
| VCC | 3.3V |
| GND | GND |
| DT | GPIO 16 |
| SCK | GPIO 17 |

Bridge the HX711 RATE pin to VCC for 80 Hz. The web app warns if the measured rate is low.
