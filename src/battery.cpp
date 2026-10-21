#include "battery.h"

#include <Arduino.h>

#ifdef ERKDEK_BATTERY_PIN

#ifndef ERKDEK_BATTERY_DIVIDER
#define ERKDEK_BATTERY_DIVIDER 2.0f
#endif

static constexpr int kReadings = 16;  // averaged, the ESP32 ADC is noisy

void batteryBegin() {
  analogReadResolution(12);
  analogSetPinAttenuation(ERKDEK_BATTERY_PIN, ADC_11db);  // up to ~3.1 V at the pin
}

float batteryVolts() {
  uint32_t sum = 0;
  // analogReadMilliVolts uses the chip's factory ADC calibration.
  for (int i = 0; i < kReadings; i++) sum += analogReadMilliVolts(ERKDEK_BATTERY_PIN);
  return (float)sum / kReadings / 1000.0f * ERKDEK_BATTERY_DIVIDER;
}

#else

void batteryBegin() {}
float batteryVolts() { return NAN; }

#endif
