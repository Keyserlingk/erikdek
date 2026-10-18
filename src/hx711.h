#pragma once

#include <Arduino.h>

// Minimal HX711 driver: channel A, gain 128.
// The sample rate (10/80 Hz) is set in hardware by the RATE pin.
class HX711 {
 public:
  void begin(uint8_t doutPin, uint8_t sckPin);
  // DOUT goes low when a new conversion is ready.
  bool isReady() const { return digitalRead(dout_) == LOW; }
  // Call only when isReady(). Returns a signed 24-bit value.
  int32_t read();

 private:
  uint8_t dout_ = 0;
  uint8_t sck_ = 0;
};
