#include "sensor.h"

#include <Arduino.h>

#include "hx711.h"
#include "rate_meter.h"
#include "ring_buffer.h"

static constexpr size_t kTareSamples = 40;         // 0.5 s at 80 Hz
static constexpr size_t kCalibrationSamples = 80;  // 1 s at 80 Hz

static HX711 hx;
static Calibration calibration;  // owned by the sensor task once started
static RingBuffer<Sample, 256> samples;  // ~3 s at 80 Hz
static RingBuffer<SensorEvent, 8> events;
static RingBuffer<RawSample, 64> monitor;  // only filled in fast mode
static volatile bool monitorOn = false;
static RateMeter rateMeter;
static RawAverager tareAverager;
static RawAverager calAverager{0};

// Requests from the network task, picked up by the sensor task.
static volatile bool tareRequested = false;
static volatile bool calRequested = false;
static volatile bool calResetRequested = false;
static volatile bool calSetRequested = false;
static volatile float calSetCountsPerKg = 0;
static volatile float calRequestKg = 0;
static volatile bool tared = false;
static volatile uint32_t samplesRead = 0;
static volatile int32_t lastRaw = 0;
static volatile float lastKg = 0;

static void handleRequests() {
  if (tareRequested) {
    tareRequested = false;
    tareAverager.reset(kTareSamples);
  }
  if (calRequested) {
    calRequested = false;
    calAverager.reset(kCalibrationSamples);
  }
  if (calResetRequested) {
    calResetRequested = false;
    calibration.countsPerKg = Calibration::kDefaultCountsPerKg;
    calibration.calibrated = false;
    events.push({SensorEvent::Calibrated, CalResult::Ok, calibration});
  }
  if (calSetRequested) {
    calSetRequested = false;
    calibration.countsPerKg = calSetCountsPerKg;
    calibration.calibrated = true;
    events.push({SensorEvent::Calibrated, CalResult::Ok, calibration});
  }
}

static void finishCalibration() {
  float cpk;
  CalResult result = computeCountsPerKg(calibration.offset, calAverager.average(), calRequestKg, cpk);
  if (result == CalResult::Ok) {
    calibration.countsPerKg = cpk;
    calibration.calibrated = true;
    events.push({SensorEvent::Calibrated, result, calibration});
  } else {
    events.push({SensorEvent::CalibrationFailed, result, calibration});
  }
}

static void sensorTask(void*) {
  for (;;) {
    if (!hx.isReady()) {
      vTaskDelay(1);
      continue;
    }
    int32_t raw = hx.read();
    uint32_t now = millis();
    rateMeter.tick(now);
    handleRequests();

    if (!tareAverager.done() && tareAverager.add(raw)) {
      calibration.offset = tareAverager.average();
      tared = true;
      events.push({SensorEvent::Tared, CalResult::Ok, calibration});
    }
    if (!calAverager.done() && calAverager.add(raw)) finishCalibration();

    float kg = calibration.toKg(raw);
    samples.push({now, kg});
    lastRaw = raw;
    lastKg = kg;
    samplesRead = samplesRead + 1;
    if (monitorOn) monitor.push({now, raw, kg});
  }
}

void sensorBegin(uint8_t doutPin, uint8_t sckPin, const Calibration& cal) {
  calibration = cal;
  hx.begin(doutPin, sckPin);
  sensorRequestTare();
  xTaskCreatePinnedToCore(sensorTask, "sensor", 4096, nullptr, 5, nullptr, 1);
}

void sensorRequestTare() { tareRequested = true; }

void sensorRequestCalibration(float kg) {
  calRequestKg = kg;
  calRequested = true;
}

void sensorResetCalibration() { calResetRequested = true; }

bool sensorSetCalibration(float countsPerKg) {
  // Reject implausible factors; negative is fine (swapped A+/A- wires).
  if (!isfinite(countsPerKg) || fabsf(countsPerKg) < 100.0f) return false;
  calSetCountsPerKg = countsPerKg;
  calSetRequested = true;
  return true;
}

size_t sensorDrain(Sample* out, size_t max) {
  size_t n = 0;
  while (n < max && samples.pop(out[n])) n++;
  return n;
}

bool sensorPollEvent(SensorEvent& out) { return events.pop(out); }

void sensorSetMonitor(bool on) { monitorOn = on; }

size_t sensorDrainMonitor(RawSample* out, size_t max) {
  size_t n = 0;
  while (n < max && monitor.pop(out[n])) n++;
  return n;
}

SensorStatus sensorStatus() {
  return {rateMeter.rateHz(), tared, calibration.calibrated, calibration.countsPerKg,
          samples.dropped(), samplesRead, lastRaw, lastKg};
}
