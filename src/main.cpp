#include <Arduino.h>

#include "battery.h"
#include "ble.h"
#include "console.h"
#include "led.h"
#include "ota.h"
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
    if (ev.type != SensorEvent::CalibrationFailed) ledFlash();
  }
}

// Keep a new firmware on probation instead of the Arduino core marking it valid before
// setup(): it marks itself valid once Bluetooth runs (otaMarkValid), so a firmware that
// crashes on start is rolled back by the bootloader.
extern "C" bool verifyRollbackLater() { return true; }

void setup() {
  Serial.begin(115200);
  Serial.println("\nErkdek starting");
  storageBegin();
  batteryBegin();
  sensorBegin(kHxDoutPin, kHxSckPin, storageLoadCalibration());
  bleBegin();
  consoleBegin();
  ledBegin();
  otaBegin();
  otaMarkValid();  // got this far: sensor and Bluetooth are up
}

void loop() {
  handleSensorEvents();
  bleLoop();
  consoleLoop();
  otaLoop();
  SensorStatus st = sensorStatus();
  ledLoop(bleConnected(), st.samplesRead, st.lastKg);
  delay(5);
}
