#include "sensor.h"

#include <Arduino.h>

#include "hx711.h"
#include "rate_meter.h"
#include "ring_buffer.h"

static constexpr size_t kTareSamples = 40;  // 0.5 s at 80 Hz

static HX711 hx;
static Calibration calibration;
static RingBuffer<Sample, 256> samples;  // ~3 s at 80 Hz
static RateMeter rateMeter;
static RawAverager tareAverager;
static volatile bool tareRequested = false;
static volatile bool tared = false;

static void sensorTask(void*) {
  for (;;) {
    if (!hx.isReady()) {
      vTaskDelay(1);
      continue;
    }
    int32_t raw = hx.read();
    uint32_t now = millis();
    rateMeter.tick(now);

    if (tareRequested) {
      tareRequested = false;
      tareAverager.reset(kTareSamples);
    }
    if (!tareAverager.done() && tareAverager.add(raw)) {
      calibration.offset = tareAverager.average();
      tared = true;
    }

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

size_t sensorDrain(Sample* out, size_t max) {
  size_t n = 0;
  while (n < max && samples.pop(out[n])) n++;
  return n;
}

SensorStatus sensorStatus() {
  return {rateMeter.rateHz(), tared, calibration.calibrated, samples.dropped()};
}
