#include <Arduino.h>

#include "ble.h"
#include "sensor.h"
#include "storage.h"

static constexpr uint8_t kHxDoutPin = 16;
static constexpr uint8_t kHxSckPin = 17;
static constexpr uint32_t kReportMs = 1000;

// One status line per second on the USB serial port (pio device monitor), so the
// wiring and the 80 Hz RATE mod can be checked without the app.
static void serialReport() {
  static uint32_t lastMs = 0;
  static uint32_t lastCount = 0;
  uint32_t now = millis();
  if (now - lastMs < kReportMs) return;
  SensorStatus st = sensorStatus();
  float hz = (st.samplesRead - lastCount) * 1000.0f / (now - lastMs);
  lastMs = now;
  lastCount = st.samplesRead;

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

void setup() {
  Serial.begin(115200);
  Serial.println("\nErkdek starting");
  storageBegin();
  sensorBegin(kHxDoutPin, kHxSckPin, storageLoadCalibration());
  bleBegin();
}

void loop() {
  bleLoop();
  serialReport();
  delay(5);
}
