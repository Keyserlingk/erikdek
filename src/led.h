#pragma once

#include <stdint.h>

// Status LED (the board's user LED, GPIO2 on most ESP32 NodeMCU boards; see
// ERKDEK_LED_PIN in platformio.ini):
//   brightness         the force: 0 kg off .. 2 kg full (so the load cell can be checked
//                      without the phone), over a faint state signal:
//     low breathing    waiting for the app (Bluetooth advertising)
//     faint glow       the app is connected
//   fast blink         waiting for the app, and no readings from the HX711 (wiring)
//   3 blinks, pause    the app is connected, but no readings from the HX711
//   double flash       a tare or calibration finished
void ledBegin();
// Call from loop() with what the LED should show (kg: the latest force reading).
void ledLoop(bool appConnected, uint32_t samplesRead, float kg);
void ledFlash();
