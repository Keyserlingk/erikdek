#pragma once

// Erkdek Bluetooth LE protocol: byte layouts of the GATT characteristics. All values are
// little-endian. The app's data/bleprotocol.js implements the same layouts, and both
// sides are tested against the same byte vectors.
//
//   Samples (notify)   seq u16 | t0 u32 (ms of first sample) | dt u16 (µs per sample)
//                      | n × force i16 (10 g units, ±327.67 kg)
//   Status (read/notify) flags u8 (bit0 tared, bit1 calibrated) | rate u16 (0.1 Hz)
//                      | countsPerKg f32 | uptime u32 (ms)
//                      | tare noise rms u16 (g) | tare noise peak-to-peak u16 (g)
//                      | battery u16 (mV, 0xFFFF = not measured) | protocol version u8
//   Command (write)    opcode u8 [| value f32]
//   Event (notify)     tared:      1
//                      calibrated: 2 | calibrated u8 | countsPerKg f32 | noise rms u16 (g)
//                      calError:   3 | reason u8 | noise rms u16 (g)
// Noise values are 0xFFFF when not measured (e.g. a calibration reset).
//   Update (write/notify): firmware update over Bluetooth, see OtaOp / OtaEvent below.

#include <stddef.h>
#include <stdint.h>
#include <string.h>

namespace ble {

static constexpr size_t kSamplesHeader = 8;
static constexpr size_t kStatusSize = 18;
// Raised whenever a layout here changes; the app warns when the sensor's differs from
// its own (data/bleprotocol.js PROTOCOL_VERSION).
static constexpr uint8_t kProtocolVersion = 1;
static constexpr uint16_t kNoNoise = 0xFFFF;
static constexpr int16_t kForceMax = 32767;  // 327.67 kg

enum Command : uint8_t { CmdTare = 1, CmdCalibrate = 2, CmdCalReset = 3, CmdSetCalibration = 4 };
enum Event : uint8_t { EvTared = 1, EvCalibrated = 2, EvCalError = 3 };
enum CalError : uint8_t { CalErrBadWeight = 1, CalErrTooSmall = 2, CalErrMoving = 3 };

inline void putU16(uint8_t* p, uint16_t v) {
  p[0] = v & 0xFF;
  p[1] = v >> 8;
}

inline void putU32(uint8_t* p, uint32_t v) {
  for (int i = 0; i < 4; i++) p[i] = (v >> (8 * i)) & 0xFF;
}

inline void putF32(uint8_t* p, float v) {
  uint32_t bits;
  memcpy(&bits, &v, 4);
  putU32(p, bits);
}

inline uint32_t getU32(const uint8_t* p) {
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

inline float getF32(const uint8_t* p) {
  uint32_t bits = getU32(p);
  float v;
  memcpy(&v, &bits, 4);
  return v;
}

// kg -> 10 g units, rounded and clamped to the i16 range.
inline int16_t forceUnits(float kg) {
  float units = kg * 100.0f;
  if (units >= kForceMax) return kForceMax;
  if (units <= -kForceMax) return -kForceMax;
  return (int16_t)(units < 0 ? units - 0.5f : units + 0.5f);
}

// kg -> whole grams for the noise fields; kNoNoise for NAN, clamped below it.
inline uint16_t noiseGrams(float kg) {
  if (!(kg >= 0)) return kNoNoise;
  float g = kg * 1000.0f + 0.5f;
  return g >= kNoNoise ? (uint16_t)(kNoNoise - 1) : (uint16_t)g;
}

// Volts -> mV for the battery field; kNoNoise (0xFFFF) for NAN (no battery reading).
inline uint16_t batteryMillivolts(float volts) {
  if (!(volts >= 0)) return kNoNoise;
  float mv = volts * 1000.0f + 0.5f;
  return mv >= kNoNoise ? (uint16_t)(kNoNoise - 1) : (uint16_t)mv;
}

// Samples that fit in a notification of `payload` bytes (MTU - 3).
inline size_t samplesPerPacket(size_t payload) {
  return payload > kSamplesHeader ? (payload - kSamplesHeader) / 2 : 0;
}

// Writes a samples packet; returns its size.
inline size_t encodeSamples(uint8_t* out, uint16_t seq, uint32_t t0Ms, uint16_t dtUs, const float* kg, size_t n) {
  putU16(out, seq);
  putU32(out + 2, t0Ms);
  putU16(out + 6, dtUs);
  for (size_t i = 0; i < n; i++) putU16(out + kSamplesHeader + 2 * i, (uint16_t)forceUnits(kg[i]));
  return kSamplesHeader + 2 * n;
}

inline size_t encodeStatus(uint8_t* out, bool tared, bool calibrated, float rateHz, float countsPerKg, uint32_t uptimeMs,
                           float tareNoiseRmsKg, float tareNoisePpKg, float batteryVolts) {
  out[0] = (tared ? 1 : 0) | (calibrated ? 2 : 0);
  float r = rateHz * 10.0f + 0.5f;
  putU16(out + 1, r <= 0 ? 0 : r >= 65535 ? 65535 : (uint16_t)r);
  putF32(out + 3, countsPerKg);
  putU32(out + 7, uptimeMs);
  putU16(out + 11, noiseGrams(tareNoiseRmsKg));
  putU16(out + 13, noiseGrams(tareNoisePpKg));
  putU16(out + 15, batteryMillivolts(batteryVolts));
  out[17] = kProtocolVersion;
  return kStatusSize;
}

inline size_t encodeTared(uint8_t* out) {
  out[0] = EvTared;
  return 1;
}

inline size_t encodeCalibrated(uint8_t* out, bool calibrated, float countsPerKg, float noiseRmsKg) {
  out[0] = EvCalibrated;
  out[1] = calibrated ? 1 : 0;
  putF32(out + 2, countsPerKg);
  putU16(out + 6, noiseGrams(noiseRmsKg));
  return 8;
}

inline size_t encodeCalError(uint8_t* out, CalError reason, float noiseRmsKg) {
  out[0] = EvCalError;
  out[1] = reason;
  putU16(out + 2, noiseGrams(noiseRmsKg));
  return 4;
}

struct ParsedCommand {
  Command op;
  float value;  // kg for calibrate, counts per kg for set calibration
};

// Parses a command write; false for unknown opcodes or a missing value.
inline bool parseCommand(const uint8_t* data, size_t len, ParsedCommand& out) {
  if (len < 1) return false;
  out.op = (Command)data[0];
  out.value = 0;
  switch (out.op) {
    case CmdTare:
    case CmdCalReset:
      return true;
    case CmdCalibrate:
    case CmdSetCalibration:
      if (len < 5) return false;
      out.value = getF32(data + 1);
      return true;
    default:
      return false;
  }
}

// ---------------------------------------------------------------- firmware update
// Writes to the update characteristic (with response):
//   start  0x01 | size u32 | sha256 [32]
//   data   0x02 | offset u32 | bytes...    in order, offset = bytes received so far
//   end    0x03                            verify, switch to the new firmware, restart
//   abort  0x04
// Notifications: event u8 | code u8 | value u32
//   ready 1 (value: size), progress 2 (value: bytes received), done 3, error 4 (code)

enum OtaOp : uint8_t { OtaStart = 1, OtaData = 2, OtaEnd = 3, OtaAbort = 4 };
enum OtaEvent : uint8_t { OtaReady = 1, OtaProgress = 2, OtaDone = 3, OtaError = 4 };
enum OtaErrorCode : uint8_t {
  OtaOk = 0,
  OtaBadSize = 2,      // too large, or end before all bytes arrived
  OtaBeginFailed = 3,  // couldn't prepare the update slot
  OtaWriteFailed = 4,
  OtaBadOffset = 5,    // data out of order
  OtaBadChecksum = 6,  // SHA-256 doesn't match
  OtaEndFailed = 7,    // not a valid firmware image
  OtaNoSession = 8,    // data/end without start
  OtaBusy = 9,         // an update is already running
};
static constexpr size_t kOtaShaSize = 32;
static constexpr size_t kOtaEventSize = 6;
static constexpr size_t kOtaDataHeader = 5;

struct OtaCommand {
  OtaOp op;
  uint32_t size;  // start
  uint8_t sha256[kOtaShaSize];
  uint32_t offset;  // data
  const uint8_t* data;
  size_t length;
};

// Parses a write to the update characteristic; false when malformed.
inline bool parseOta(const uint8_t* in, size_t len, OtaCommand& out) {
  if (len < 1) return false;
  out.op = (OtaOp)in[0];
  out.data = nullptr;
  out.length = 0;
  switch (out.op) {
    case OtaStart:
      if (len != 1 + 4 + kOtaShaSize) return false;
      out.size = getU32(in + 1);
      memcpy(out.sha256, in + 5, kOtaShaSize);
      return true;
    case OtaData:
      if (len <= kOtaDataHeader) return false;
      out.offset = getU32(in + 1);
      out.data = in + kOtaDataHeader;
      out.length = len - kOtaDataHeader;
      return true;
    case OtaEnd:
    case OtaAbort:
      return len == 1;
    default:
      return false;
  }
}

inline size_t encodeOtaEvent(uint8_t* out, OtaEvent event, OtaErrorCode code, uint32_t value) {
  out[0] = event;
  out[1] = code;
  putU32(out + 2, value);
  return kOtaEventSize;
}

}  // namespace ble
