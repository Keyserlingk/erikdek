#pragma once

// Text commands typed on the USB serial port (pio device monitor), for testing the
// sensor without the app:
//   t          tare
//   c <kg>     calibrate with a known weight, e.g. "c 20"
//   r          reset the calibration to the default factor
//   rate [sps] ADS1220 sample rate, e.g. "rate 330"; without a number: show the ADC
//   f          fast mode on/off: print every reading
//   s          status line (once a second) on/off
//   h, ?       help

#include <ctype.h>
#include <stdlib.h>
#include <string.h>

#include "ads1220_config.h"

enum class ConsoleOp { None, Tare, Calibrate, CalReset, Rate, Fast, Status, Help, Invalid };

struct ConsoleCommand {
  ConsoleOp op = ConsoleOp::None;
  float kg = 0;      // Calibrate
  uint16_t sps = 0;  // Rate: a supported ADS1220 rate, 0 = just show it
};

// "rate" or "rate <sps>" with a rate from ads1220::kRates.
inline void parseRate(const char* rest, ConsoleCommand& cmd) {
  if (!*rest) {
    cmd.op = ConsoleOp::Rate;
    return;
  }
  char* end = nullptr;
  long sps = strtol(rest, &end, 10);
  while (end && isspace((unsigned char)*end)) end++;
  if (end && !*end && sps > 0 && sps <= 65535 && ads1220::isSupportedRate((uint16_t)sps)) {
    cmd.op = ConsoleOp::Rate;
    cmd.sps = (uint16_t)sps;
  }
}

// Parses one line. Empty lines give None; unknown commands or a missing/invalid weight
// give Invalid.
inline ConsoleCommand parseConsoleLine(const char* line) {
  ConsoleCommand cmd;
  while (isspace((unsigned char)*line)) line++;
  if (!*line) return cmd;
  char c = (char)tolower((unsigned char)*line++);
  const char* rest = line;
  while (isspace((unsigned char)*rest)) rest++;
  bool noArgs = !*rest;
  cmd.op = ConsoleOp::Invalid;
  if (strncasecmp(line - 1, "rate", 4) == 0 && (!line[3] || isspace((unsigned char)line[3]))) {
    rest = line + 3;
    while (isspace((unsigned char)*rest)) rest++;
    parseRate(rest, cmd);
    return cmd;
  }
  if (*line && !isspace((unsigned char)*line)) return cmd;  // single-letter commands only
  switch (c) {
    case 't':
      if (noArgs) cmd.op = ConsoleOp::Tare;
      break;
    case 'r':
      if (noArgs) cmd.op = ConsoleOp::CalReset;
      break;
    case 'f':
      if (noArgs) cmd.op = ConsoleOp::Fast;
      break;
    case 's':
      if (noArgs) cmd.op = ConsoleOp::Status;
      break;
    case 'h':
    case '?':
      if (noArgs) cmd.op = ConsoleOp::Help;
      break;
    case 'c': {
      char* end = nullptr;
      float kg = strtof(rest, &end);
      while (end && isspace((unsigned char)*end)) end++;
      if (!noArgs && end && !*end && kg > 0 && kg <= 300) {
        cmd.op = ConsoleOp::Calibrate;
        cmd.kg = kg;
      }
      break;
    }
  }
  return cmd;
}
