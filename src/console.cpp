#include "console.h"

#include <Arduino.h>

#include "ble.h"
#include "console_command.h"

static constexpr uint32_t kReportMs = 1000;
static constexpr size_t kMaxLine = 32;

static bool statusOn = true;
static bool fastOn = false;
static char line[kMaxLine + 1];
static size_t lineLen = 0;

static void printHelp() {
  Serial.println("Commands (then Enter):");
  Serial.println("  t        tare (nothing hanging)");
  Serial.println("  c <kg>   calibrate with a known weight hanging, e.g. c 20");
  Serial.println("  r        reset the calibration to the default factor");
  Serial.println("  f        fast mode on/off: every reading (ms, raw, kg)");
  Serial.println("  s        status line on/off");
  Serial.println("  h        this help");
}

static void run(const ConsoleCommand& cmd) {
  switch (cmd.op) {
    case ConsoleOp::None:
      break;
    case ConsoleOp::Tare:
      Serial.println("> taring (0.5 s, keep it unloaded)...");
      sensorRequestTare();
      break;
    case ConsoleOp::Calibrate:
      Serial.printf("> calibrating with %.2f kg (1 s, keep it still)...\n", cmd.kg);
      sensorRequestCalibration(cmd.kg);
      break;
    case ConsoleOp::CalReset:
      Serial.println("> calibration reset to the default factor");
      sensorResetCalibration();
      break;
    case ConsoleOp::Fast:
      fastOn = !fastOn;
      sensorSetMonitor(fastOn);
      Serial.printf("> fast mode %s\n", fastOn ? "on (ms raw kg)" : "off");
      break;
    case ConsoleOp::Status:
      statusOn = !statusOn;
      Serial.printf("> status line %s\n", statusOn ? "on" : "off");
      break;
    case ConsoleOp::Help:
      printHelp();
      break;
    case ConsoleOp::Invalid:
      Serial.printf("> unknown command \"%s\" (h for help)\n", line);
      break;
  }
}

static void readCommands() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      line[lineLen] = '\0';
      if (lineLen) run(parseConsoleLine(line));
      lineLen = 0;
    } else if (lineLen < kMaxLine) {
      line[lineLen++] = c;
    }
  }
}

// One line per second, so the wiring and the 80 Hz RATE mod can be checked without the app.
static void statusReport() {
  static uint32_t lastMs = 0;
  static uint32_t lastCount = 0;
  uint32_t now = millis();
  if (now - lastMs < kReportMs) return;
  SensorStatus st = sensorStatus();
  float hz = (st.samplesRead - lastCount) * 1000.0f / (now - lastMs);
  lastMs = now;
  lastCount = st.samplesRead;
  if (!statusOn) return;

  Serial.printf("%6lu s  %5.1f Hz  raw %9ld  %7.2f kg  tared %s  cal %s (%.0f/kg)  app %s  dropped %u\n",
                (unsigned long)(now / 1000), hz, (long)st.lastRaw, st.lastKg, st.tared ? "yes" : "no",
                st.calibrated ? "yes" : "no", st.countsPerKg, bleConnected() ? "connected" : "-",
                (unsigned)st.dropped);
  if (hz < 1.0f) {
    Serial.println("  ! no readings from the HX711: check VCC 3.3V, GND, DT -> GPIO16, SCK -> GPIO17");
  } else if (hz < 20.0f) {
    Serial.println("  ! HX711 at ~10 Hz: the RATE pin is low; bridge RATE to VCC for 80 Hz");
  }
}

static void printFast() {
  RawSample buf[16];
  size_t n;
  while ((n = sensorDrainMonitor(buf, 16)) > 0) {
    for (size_t i = 0; i < n; i++) Serial.printf("%lu %ld %.3f\n", (unsigned long)buf[i].ms, (long)buf[i].raw, buf[i].kg);
  }
}

void consoleBegin() { Serial.println("Type h and Enter for commands."); }

void consoleLoop() {
  readCommands();
  statusReport();
  if (fastOn) printFast();
}

void consoleLogEvent(const SensorEvent& ev) {
  switch (ev.type) {
    case SensorEvent::Tared:
      Serial.printf("> tared (offset %ld)\n", (long)ev.calibration.offset);
      break;
    case SensorEvent::Calibrated:
      if (ev.calibration.calibrated) {
        Serial.printf("> calibrated: %.1f counts/kg, saved\n", ev.calibration.countsPerKg);
      } else {
        Serial.printf("> calibration reset: %.1f counts/kg (default), saved\n", ev.calibration.countsPerKg);
      }
      break;
    case SensorEvent::CalibrationFailed:
      Serial.println(ev.result == CalResult::BadWeight
                         ? "> calibration failed: the weight must be more than 0 kg"
                         : "> calibration failed: the reading barely changed (weight hanging freely? wiring?)");
      break;
  }
}
