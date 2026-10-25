#pragma once

#include <math.h>
#include <stddef.h>
#include <stdint.h>

// Converts raw ADC counts to kg: kg = (raw - offset) / countsPerKg.
struct Calibration {
  // Rough default for a 300 kg, 2 mV/V cell on the HX711 (adc_type.h has the one per
  // ADC). Only good to within ~20 %; calibrate with a known weight.
  static constexpr float kDefaultCountsPerKg = 14300.0f;

  int32_t offset = 0;
  float countsPerKg = kDefaultCountsPerKg;
  bool calibrated = false;  // true once countsPerKg was measured with a known weight

  float toKg(int32_t raw) const { return (float)(raw - offset) / countsPerKg; }
};

enum class CalResult { Ok, BadWeight, TooSmall, Moving };

// Smallest accepted change in raw counts between tare and known load
// (~0.35 kg with the default factor, well above HX711 noise).
static constexpr int32_t kMinCalibrationCounts = 5000;

// Computes counts per kg from the tare offset and the averaged raw reading under a known
// weight. A negative factor is allowed: it means A+/A- are swapped, and kg still come out
// positive, so swapped wires need no rewiring.
inline CalResult computeCountsPerKg(int32_t offset, int32_t loadedRaw, float kg, float& out) {
  if (!(kg > 0.0f)) return CalResult::BadWeight;
  int32_t delta = loadedRaw - offset;
  if (delta > -kMinCalibrationCounts && delta < kMinCalibrationCounts) return CalResult::TooSmall;
  out = (float)delta / kg;
  return CalResult::Ok;
}

// Readings in `seconds` at `rateHz`, so tare (0.5 s) and calibration (1 s) take the same
// time at any sample rate; at least 4 for a usable average and spread.
inline size_t samplesFor(float seconds, float rateHz) {
  float n = seconds * rateHz + 0.5f;
  return n < 4 ? 4 : (size_t)n;
}

// Averages a fixed number of raw readings, used for tare and calibration, and measures
// their spread (the sensor's noise, or movement of the load).
class RawAverager {
 public:
  explicit RawAverager(size_t target = 40) : target_(target) {}

  void reset(size_t target) {
    target_ = target;
    count_ = 0;
    sum_ = 0;
    sumSq_ = 0;
  }
  // Returns true when the target count has been reached.
  bool add(int32_t raw) {
    if (count_ < target_) {
      if (count_ == 0) first_ = min_ = max_ = raw;
      // Sums of differences from the first reading keep the squares small.
      int64_t d = (int64_t)raw - first_;
      sum_ += d;
      sumSq_ += d * d;
      if (raw < min_) min_ = raw;
      if (raw > max_) max_ = raw;
      count_++;
    }
    return done();
  }
  bool done() const { return target_ > 0 && count_ >= target_; }
  int32_t average() const { return count_ ? (int32_t)(first_ + sum_ / (int64_t)count_) : 0; }
  // Standard deviation (rms noise) in counts.
  float stdDev() const {
    if (count_ < 2) return 0;
    double mean = (double)sum_ / count_;
    double var = (double)sumSq_ / count_ - mean * mean;
    return var > 0 ? (float)sqrt(var) : 0;
  }
  int32_t peakToPeak() const { return count_ ? max_ - min_ : 0; }

 private:
  size_t target_;
  size_t count_ = 0;
  int32_t first_ = 0;
  int32_t min_ = 0;
  int32_t max_ = 0;
  int64_t sum_ = 0;
  int64_t sumSq_ = 0;
};

// Noise of a tare or calibration in kg: rms and peak-to-peak.
struct Noise {
  float rmsKg = NAN;  // NAN: not measured
  float ppKg = NAN;
};

inline Noise noiseKg(const RawAverager& avg, float countsPerKg) {
  float cpk = fabsf(countsPerKg);
  Noise n;
  if (!avg.done() || !(cpk > 0)) return n;
  n.rmsKg = avg.stdDev() / cpk;
  n.ppKg = (float)avg.peakToPeak() / cpk;
  return n;
}

// A calibration is refused when its readings spread more than this: the weight was
// swinging or touched. Same limits as the app's "Stable" indicator (calibrate.js).
static constexpr float kMovingRmsKg = 0.15f;
static constexpr float kMovingRmsShare = 0.005f;

inline bool calibrationMoving(float rmsKg, float kg) {
  float limit = kg * kMovingRmsShare;
  return rmsKg > (limit > kMovingRmsKg ? limit : kMovingRmsKg);
}
