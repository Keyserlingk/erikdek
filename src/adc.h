#pragma once

#include <stdint.h>

#include "adc_type.h"

// The load cell ADC as the sensor task sees it (HX711 or ADS1220, detected in main.cpp).
// All calls come from the sensor task, except type() and rateSps().
class LoadCellAdc {
 public:
  virtual AdcType type() const = 0;
  // Waits (blocking, without starving other tasks) for a new conversion; false when none
  // came yet: call again.
  virtual bool waitReady() = 0;
  // Call after waitReady() returned true. Signed 24-bit value.
  virtual int32_t read() = 0;
  // Called after each reading.
  virtual void afterRead() {}
  // Configured data rate in SPS; 0 when set in hardware (HX711 RATE pin).
  virtual uint16_t rateSps() const { return 0; }
  // Changes the data rate; false when unsupported.
  virtual bool setRate(uint16_t) { return false; }
};
