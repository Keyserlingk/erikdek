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
static RateMeter rateMeter;
static RawAverager tareAverager;
static RawAverager calAverager{0};

// Requests from the network task, picked up by the sensor task.
static volatile bool tareRequested = false;
static volatile bool calRequested = false;
static volatile bool calResetRequested = false;
static volatile float calRequestKg = 0;
static volatile bool tared = false;

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

    samples.push({now, calibration.toKg(raw)});
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

size_t sensorDrain(Sample* out, size_t max) {
  size_t n = 0;
  while (n < max && samples.pop(out[n])) n++;
  return n;
}

bool sensorPollEvent(SensorEvent& out) { return events.pop(out); }

SensorStatus sensorStatus() {
  return {rateMeter.rateHz(), tared, calibration.calibrated, calibration.countsPerKg, samples.dropped()};
}
