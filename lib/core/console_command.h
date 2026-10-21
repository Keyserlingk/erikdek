#pragma once

// Text commands typed on the USB serial port (pio device monitor), for testing the
// sensor without the app:
//   t          tare
//   c <kg>     calibrate with a known weight, e.g. "c 20"
//   r          reset the calibration to the default factor
//   f          fast mode on/off: print every reading
//   s          status line (once a second) on/off
//   h, ?       help

#include <ctype.h>
#include <stdlib.h>

enum class ConsoleOp { None, Tare, Calibrate, CalReset, Fast, Status, Help, Invalid };

struct ConsoleCommand {
  ConsoleOp op = ConsoleOp::None;
  float kg = 0;  // Calibrate
};

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
