#include <Arduino.h>

#include "ble.h"
#include "sensor.h"
#include "storage.h"

static constexpr uint8_t kHxDoutPin = 16;
static constexpr uint8_t kHxSckPin = 17;

void setup() {
  Serial.begin(115200);
  Serial.println("\nErkdek starting");
  storageBegin();
  sensorBegin(kHxDoutPin, kHxSckPin, storageLoadCalibration());
  bleBegin();
}

void loop() {
  bleLoop();
  delay(5);
}
