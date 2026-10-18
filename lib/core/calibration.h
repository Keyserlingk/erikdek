#pragma once

#include <stddef.h>
#include <stdint.h>

// Converts raw HX711 counts to kg: kg = (raw - offset) / countsPerKg.
struct Calibration {
  // Rough default for a 300 kg, 2 mV/V cell at gain 128 and 3.3 V excitation.
  // Only good to within ~20 %; calibrate with a known weight.
  static constexpr float kDefaultCountsPerKg = 14300.0f;

  int32_t offset = 0;
  float countsPerKg = kDefaultCountsPerKg;
  bool calibrated = false;  // true once countsPerKg was measured with a known weight

  float toKg(int32_t raw) const { return (float)(raw - offset) / countsPerKg; }
};

// Averages a fixed number of raw readings, used for tare and calibration.
class RawAverager {
 public:
  explicit RawAverager(size_t target = 40) : target_(target) {}

  void reset(size_t target) {
    target_ = target;
    count_ = 0;
    sum_ = 0;
  }
  // Returns true when the target count has been reached.
  bool add(int32_t raw) {
    if (count_ < target_) {
      sum_ += raw;
      count_++;
    }
    return done();
  }
  bool done() const { return target_ > 0 && count_ >= target_; }
  int32_t average() const { return count_ ? (int32_t)(sum_ / (int64_t)count_) : 0; }

 private:
  size_t target_;
  size_t count_ = 0;
  int64_t sum_ = 0;
};
