#pragma once

// TI ADS1220 (24-bit delta-sigma ADC) register values for the load cell, and the
// supported data rates. Used by src/ads1220.cpp; kept here to be tested on the PC.
//
// Inputs: bridge signal + on AIN1, − on AIN2 (MUX 0011). Reference: the bridge
// excitation, + on REFP0 and − on REFN0 (ratiometric: supply drift cancels out).

#include <stddef.h>
#include <stdint.h>

namespace ads1220 {

// SPI commands
static constexpr uint8_t kCmdReset = 0x06;
static constexpr uint8_t kCmdStartSync = 0x08;
inline uint8_t cmdWriteReg(uint8_t reg, uint8_t count) { return 0x40 | (reg << 2) | (count - 1); }
inline uint8_t cmdReadReg(uint8_t reg, uint8_t count) { return 0x20 | (reg << 2) | (count - 1); }

// Register 0: MUX[7:4] = 0011 (AINP = AIN1, AINN = AIN2), GAIN[3:1] = 111 (128),
// PGA_BYPASS[0] = 0 (PGA on; needed for gains above 4).
static constexpr uint8_t kConfig0 = 0x3E;
// Register 2: VREF[7:6] = 01 (external REFP0/REFN0), 50/60[5:4] = 00 (no 50/60 Hz
// filter; it only works at 20 SPS), PSW[3] = 0, IDAC[2:0] = 000 (off).
static constexpr uint8_t kConfig2 = 0x40;
// Register 3: no IDAC routing, DRDYM[1] = 0 (data ready only on the DRDY pin).
static constexpr uint8_t kConfig3 = 0x00;

static constexpr uint16_t kRates[] = {20, 45, 90, 175, 330, 600, 1000, 2000};
static constexpr uint16_t kDefaultRate = 330;

inline bool isSupportedRate(uint16_t sps) {
  for (uint16_t r : kRates)
    if (r == sps) return true;
  return false;
}

// Register 1 for a data rate: DR[7:5], MODE[4:3] (00 normal, 10 turbo), CM[2] = 1
// (continuous conversion), TS[1] = 0, BCS[0] = 0. Normal mode has 20..1000 SPS
// (DR 000..110); 2000 SPS is DR 110 in turbo mode (turbo doubles the modulator clock).
// False for unsupported rates.
inline bool config1ForRate(uint16_t sps, uint8_t& out) {
  static constexpr uint16_t kNormal[] = {20, 45, 90, 175, 330, 600, 1000};
  static constexpr uint8_t kContinuous = 0x04;
  if (sps == 2000) {
    out = (6 << 5) | (2 << 3) | kContinuous;
    return true;
  }
  for (uint8_t dr = 0; dr < 7; dr++) {
    if (kNormal[dr] == sps) {
      out = (uint8_t)((dr << 5) | kContinuous);
      return true;
    }
  }
  return false;
}

// A 24-bit conversion result (MSB first) as a signed value.
inline int32_t signExtend24(uint8_t b0, uint8_t b1, uint8_t b2) {
  uint32_t v = ((uint32_t)b0 << 16) | ((uint32_t)b1 << 8) | b2;
  if (v & 0x800000) v |= 0xFF000000;
  return (int32_t)v;
}

}  // namespace ads1220
