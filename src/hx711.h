#pragma once

#include <Arduino.h>

#include "adc.h"

// Minimal HX711 driver: channel A, gain 128.
// The sample rate (10/80 Hz) is set in hardware by the RATE pin.
class HX711 : public LoadCellAdc {
 public:
  void begin(uint8_t doutPin, uint8_t sckPin);
  // DOUT goes low when a new conversion is ready.
  bool isReady() const { return digitalRead(dout_) == LOW; }
  // Call only when isReady(). Returns a signed 24-bit value.
  int32_t read() override;

  AdcType type() const override { return AdcType::Hx711; }
  // Polls DOUT; not ready: sleeps a tick so the task doesn't starve loop() on its core.
  bool waitReady() override {
    if (isReady()) return true;
    vTaskDelay(1);
    return false;
  }
  // Always yield after a reading (the next one is 12.5 ms away at 80 Hz): if DOUT
  // never goes high the sensor task must not starve setup()/loop() on the same core.
  void afterRead() override { vTaskDelay(1); }

 private:
  uint8_t dout_ = 0;
  uint8_t sck_ = 0;
};
