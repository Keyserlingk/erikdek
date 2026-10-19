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
  float countsPerKg;
  size_t dropped;
  uint32_t samplesRead;  // since start; for the serial log's rate over the last second
  int32_t lastRaw;       // last HX711 reading (counts)
  float lastKg;
};

// Results of tare/calibration, reported from the sensor task to the network loop.
struct SensorEvent {
  enum Type : uint8_t { Tared, Calibrated, CalibrationFailed } type;
  CalResult result;
  Calibration calibration;  // new calibration for Calibrated
};

// Starts the HX711 reading task on core 1 and auto-tares.
void sensorBegin(uint8_t doutPin, uint8_t sckPin, const Calibration& cal);
// Tare over the next 0.5 s; the load must be off.
void sensorRequestTare();
// Measures for 1 s with a known weight hanging and computes the scale factor.
void sensorRequestCalibration(float kg);
// Goes back to the uncalibrated default factor.
void sensorResetCalibration();
// Sets a known factor (restoring a backup). Returns false if the value is implausible.
bool sensorSetCalibration(float countsPerKg);
// Copies up to max buffered samples into out; returns the count.
size_t sensorDrain(Sample* out, size_t max);
bool sensorPollEvent(SensorEvent& out);
SensorStatus sensorStatus();
