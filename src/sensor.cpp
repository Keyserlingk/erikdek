#include "sensor.h"

#include <Arduino.h>

#include "adc.h"
#include "ads1220_config.h"
#include "rate_meter.h"
#include "ring_buffer.h"

static constexpr float kTareSeconds = 0.5f;
static constexpr float kCalibrationSeconds = 1.0f;
static constexpr float kAssumedHx711Hz = 80.0f;  // until the rate has been measured

static LoadCellAdc* adc = nullptr;
static Calibration calibration;  // owned by the sensor task once started
static RingBuffer<Sample, 6144> samples;  // ~3 s at 2000 SPS (48 KB)
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
static volatile uint16_t rateRequestSps = 0;  // 0 = none
static volatile bool tared = false;
static volatile uint32_t samplesRead = 0;
static volatile int32_t lastRaw = 0;
static volatile float lastKg = 0;
// Spread of the last tare in counts (written by the sensor task), converted with the
// current factor for the status, so it stays right after a calibration.
static volatile float tareNoiseRmsCounts = NAN;
static volatile float tareNoisePpCounts = NAN;

// Sample rate for counting tare/calibration readings: the configured one, or the
// measured one for the HX711 (its rate is set by a pin, 10 or ~80-90 Hz).
static float nominalRateHz() {
  if (adc->rateSps()) return adc->rateSps();
  float measured = rateMeter.rateHz();
  return measured > 0 ? measured : kAssumedHx711Hz;
}

static void handleRequests() {
  if (rateRequestSps) {
    uint16_t sps = rateRequestSps;
    rateRequestSps = 0;
    if (adc->setRate(sps)) {
      rateMeter.restart(sps);
      SensorEvent ev{SensorEvent::RateChanged, CalResult::Ok, calibration, Noise()};
      ev.rateSps = sps;
      events.push(ev);
    }
  }
  if (tareRequested) {
    tareRequested = false;
    tareAverager.reset(samplesFor(kTareSeconds, nominalRateHz()));
  }
  if (calRequested) {
    calRequested = false;
    calAverager.reset(samplesFor(kCalibrationSeconds, nominalRateHz()));
  }
  if (calResetRequested) {
    calResetRequested = false;
    calibration.countsPerKg = adcDefaultCountsPerKg(adc->type());
    calibration.calibrated = false;
    events.push({SensorEvent::Calibrated, CalResult::Ok, calibration, Noise()});
  }
  if (calSetRequested) {
    calSetRequested = false;
    calibration.countsPerKg = calSetCountsPerKg;
    calibration.calibrated = true;
    events.push({SensorEvent::Calibrated, CalResult::Ok, calibration, Noise()});
  }
}

static void finishCalibration() {
  float cpk;
  CalResult result = computeCountsPerKg(calibration.offset, calAverager.average(), calRequestKg, cpk);
  // Noise with the new factor when there is one, else with the current one.
  Noise noise = noiseKg(calAverager, result == CalResult::Ok ? cpk : calibration.countsPerKg);
  if (result == CalResult::Ok && calibrationMoving(noise.rmsKg, calRequestKg)) result = CalResult::Moving;
  if (result == CalResult::Ok) {
    calibration.countsPerKg = cpk;
    calibration.calibrated = true;
    events.push({SensorEvent::Calibrated, result, calibration, noise});
  } else {
    events.push({SensorEvent::CalibrationFailed, result, calibration, noise});
  }
}

static void sensorTask(void*) {
  for (;;) {
    if (!adc->waitReady()) continue;
    int32_t raw = adc->read();
    uint32_t now = millis();
    rateMeter.tick(now);
    handleRequests();

    if (!tareAverager.done() && tareAverager.add(raw)) {
      calibration.offset = tareAverager.average();
      tareNoiseRmsCounts = tareAverager.stdDev();
      tareNoisePpCounts = (float)tareAverager.peakToPeak();
      tared = true;
      events.push({SensorEvent::Tared, CalResult::Ok, calibration, noiseKg(tareAverager, calibration.countsPerKg)});
    }
    if (!calAverager.done() && calAverager.add(raw)) finishCalibration();

    float kg = calibration.toKg(raw);
    samples.push({now, kg});
    lastRaw = raw;
    lastKg = kg;
    samplesRead = samplesRead + 1;
    if (monitorOn) monitor.push({now, raw, kg});
    adc->afterRead();
  }
}

void sensorBegin(LoadCellAdc* a, const Calibration& cal) {
  adc = a;
  calibration = cal;
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

bool sensorSetRate(uint16_t sps) {
  if (adc->type() != AdcType::Ads1220 || !ads1220::isSupportedRate(sps)) return false;
  rateRequestSps = sps;
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
  Noise tareNoise;
  float cpk = fabsf(calibration.countsPerKg);
  tareNoise.rmsKg = tareNoiseRmsCounts / cpk;  // stays NAN until the first tare
  tareNoise.ppKg = tareNoisePpCounts / cpk;
  return {rateMeter.rateHz(), tared, calibration.calibrated, calibration.countsPerKg,
          samples.dropped(), samplesRead, lastRaw, lastKg, tareNoise, adc ? adc->type() : AdcType::None, adc ? adc->rateSps() : (uint16_t)0};
}
