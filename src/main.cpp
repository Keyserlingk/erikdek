#include <Arduino.h>

#include "net.h"
#include "sensor.h"
#include "storage.h"

static constexpr uint8_t kHxDoutPin = 16;
static constexpr uint8_t kHxSckPin = 17;

void setup() {
  Serial.begin(115200);
  Serial.println("\nTindek starting");
  storageBegin();
  sensorBegin(kHxDoutPin, kHxSckPin, storageLoadCalibration());
  netBegin();
}

void loop() {
  netLoop();
  delay(5);
}
