#include <Arduino.h>

#include "battery.h"
#include "ble.h"
#include "console.h"
#include "sensor.h"
#include "storage.h"

static constexpr uint8_t kHxDoutPin = 16;
static constexpr uint8_t kHxSckPin = 17;

// Tare/calibration results, whether requested by the app or the serial console:
// new calibrations are saved, and both the app and the console hear about it.
static void handleSensorEvents() {
  SensorEvent ev;
  while (sensorPollEvent(ev)) {
    if (ev.type == SensorEvent::Calibrated) storageSaveCalibration(ev.calibration);
    bleSendEvent(ev);
    consoleLogEvent(ev);
  }
}

void setup() {
  Serial.begin(115200);
  Serial.println("\nErkdek starting");
  storageBegin();
  batteryBegin();
  sensorBegin(kHxDoutPin, kHxSckPin, storageLoadCalibration());
  bleBegin();
  consoleBegin();
}

void loop() {
  handleSensorEvents();
  bleLoop();
  consoleLoop();
  delay(5);
}
