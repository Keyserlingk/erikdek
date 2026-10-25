#pragma once

#include <stddef.h>
#include <stdint.h>

#include "adc_type.h"
#include "calibration.h"

class LoadCellAdc;

struct Sample {
  uint32_t ms;  // millis() when the sample was read
  float kg;
};

// Every reading with its raw value, for the serial console's fast mode.
struct RawSample {
  uint32_t ms;
  int32_t raw;
  float kg;
};

struct SensorStatus {
  float rateHz;
  bool tared;
  bool calibrated;
  float countsPerKg;
  size_t dropped;
  uint32_t samplesRead;  // since start; for the serial log's rate over the last second
  int32_t lastRaw;       // last ADC reading (counts)
  float lastKg;
  Noise tareNoise;  // noise during the last tare (NAN until the first one)
  AdcType adc;
  uint16_t adcRateSps;  // configured rate; 0 for the HX711 (RATE pin)
};

// Results of tare/calibration and rate changes, reported from the sensor task to the
// network loop.
struct SensorEvent {
  enum Type : uint8_t { Tared, Calibrated, CalibrationFailed, RateChanged } type;
  CalResult result;
  Calibration calibration;  // new calibration for Calibrated
  Noise noise;              // spread of the tare/calibration readings (NAN for a reset)
  uint16_t rateSps;         // new ADC rate for RateChanged
};

// Starts the reading task on core 1 with a started ADC and auto-tares.
void sensorBegin(LoadCellAdc* adc, const Calibration& cal);
// Tare over the next 0.5 s; the load must be off.
void sensorRequestTare();
// Measures for 1 s with a known weight hanging and computes the scale factor.
void sensorRequestCalibration(float kg);
// Goes back to the uncalibrated default factor.
void sensorResetCalibration();
// Sets a known factor (restoring a backup). Returns false if the value is implausible.
bool sensorSetCalibration(float countsPerKg);
// Changes the ADC's data rate (ADS1220 only). Returns false when the ADC has no
// settable rate or doesn't support this one; a RateChanged event follows otherwise.
bool sensorSetRate(uint16_t sps);
// Copies up to max buffered samples into out; returns the count.
size_t sensorDrain(Sample* out, size_t max);
bool sensorPollEvent(SensorEvent& out);
// Fast mode: when on, every reading is also kept for sensorDrainMonitor().
void sensorSetMonitor(bool on);
size_t sensorDrainMonitor(RawSample* out, size_t max);
SensorStatus sensorStatus();
