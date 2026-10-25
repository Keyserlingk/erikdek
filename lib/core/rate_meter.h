#pragma once

#include <stdint.h>

// Measures the actual sample rate over a time window.
class RateMeter {
 public:
  explicit RateMeter(uint32_t windowMs = 2000) : windowMs_(windowMs) {}

  void tick(uint32_t nowMs) {
    if (count_ == 0 && !started_) {
      started_ = true;
      startMs_ = nowMs;
    }
    count_++;
    uint32_t elapsed = nowMs - startMs_;
    if (elapsed >= windowMs_) {
      rateHz_ = (float)count_ * 1000.0f / (float)elapsed;
      count_ = 0;
      startMs_ = nowMs;
    }
  }

  // After a rate change: report `expectedHz` until the next window has been measured.
  void restart(float expectedHz) {
    count_ = 0;
    started_ = false;
    rateHz_ = expectedHz;
  }

  float rateHz() const { return rateHz_; }

 private:
  uint32_t windowMs_;
  uint32_t startMs_ = 0;
  uint32_t count_ = 0;
  bool started_ = false;
  float rateHz_ = 0.0f;
};
