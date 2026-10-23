#pragma once

#include <stdint.h>

// Status LED (the board's user LED, GPIO2 on most ESP32 NodeMCU boards; see
// ERKDEK_LED_PIN in platformio.ini):
//   slow pulse         waiting for the app (Bluetooth advertising), breathing (PWM)
//   on (dimmed)        the app is connected
//   fast blink         waiting for the app, and no readings from the HX711 (wiring)
//   3 blinks, pause    the app is connected, but no readings from the HX711
//   double flash       a tare or calibration finished
void ledBegin();
// Call from loop() with what the LED should show.
void ledLoop(bool appConnected, uint32_t samplesRead);
void ledFlash();
