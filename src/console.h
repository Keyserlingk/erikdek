#pragma once

#include "sensor.h"

// USB serial console (pio device monitor): a status line once a second, text commands
// (see lib/core/console_command.h) and a log of tare/calibration results.
void consoleBegin();
// Call from loop(): reads commands, prints the status line and fast-mode readings.
void consoleLoop();
void consoleLogEvent(const SensorEvent& ev);
