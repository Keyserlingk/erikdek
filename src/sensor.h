#pragma once

#include <stddef.h>
#include <stdint.h>

#include "calibration.h"

struct Sample {
  uint32_t ms;  // millis() when the sample was read
  float kg;
};

struct SensorStatus {
  float rateHz;
  bool tared;
  bool calibrated;
  size_t dropped;
};

// Starts the HX711 reading task on core 1 and auto-tares.
void sensorBegin(uint8_t doutPin, uint8_t sckPin, const Calibration& cal);
// Tare over the next 0.5 s; the load must be off.
void sensorRequestTare();
// Copies up to max buffered samples into out; returns the count.
size_t sensorDrain(Sample* out, size_t max);
SensorStatus sensorStatus();
