#pragma once

#include <stdint.h>

#include "calibration.h"

// Which ADC reads the load cell; detected at startup (ADS1220 first, else HX711).
// The values are sent in the BLE status (ble_protocol.h).
enum class AdcType : uint8_t { None = 0, Hx711 = 1, Ads1220 = 2 };

inline const char* adcName(AdcType t) {
  switch (t) {
    case AdcType::Hx711:
      return "HX711";
    case AdcType::Ads1220:
      return "ADS1220";
    default:
      return "none";
  }
}

// Rough counts per kg for a 300 kg, 2 mV/V cell at gain 128 with the bridge excitation
// as the reference (ratiometric, so independent of the supply), good to ~20 %:
//   HX711:   full scale ±0.5 × AVDD / 128 → 2^23 × 128 × 0.002 / (0.5 × 300) ≈ 14300
//   ADS1220: full scale ±VREF / 128       → 2^23 × 128 × 0.002 / 300         ≈ 7160
inline float adcDefaultCountsPerKg(AdcType t) {
  return t == AdcType::Ads1220 ? 7160.0f : Calibration::kDefaultCountsPerKg;
}
