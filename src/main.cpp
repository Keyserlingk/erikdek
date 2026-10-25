#include <Arduino.h>

#include "ads1220.h"
#include "battery.h"
#include "ble.h"
#include "console.h"
#include "hx711.h"
#include "led.h"
#include "ota.h"
#include "sensor.h"
#include "storage.h"

static constexpr uint8_t kHxDoutPin = 16;
static constexpr uint8_t kHxSckPin = 17;
// ADS1220 on VSPI: SCK, MISO (DOUT), MOSI (DIN), CS, DRDY.
static constexpr Ads1220::Pins kAdsPins = {18, 19, 23, 5, 4};

static Ads1220 ads;
static HX711 hx;
static LoadCellAdc* adc = &hx;

// The ADS1220 if one answers on the SPI bus, else the HX711. Neither hangs when its
// chip is missing (the HX711 then just never has a reading).
static LoadCellAdc* detectAdc() {
  if (ads.begin(kAdsPins, storageLoadRate())) {
    Serial.printf("ADC: ADS1220 at %u SPS\n", ads.rateSps());
    return &ads;
  }
  hx.begin(kHxDoutPin, kHxSckPin);
  Serial.println("ADC: HX711");
  return &hx;
}

// Tare/calibration results and rate changes, whether requested by the app or the serial
// console: new calibrations and rates are saved, and both the app and the console hear
// about it.
static void handleSensorEvents() {
  SensorEvent ev;
  while (sensorPollEvent(ev)) {
    if (ev.type == SensorEvent::Calibrated) storageSaveCalibration(ev.calibration, adc->type());
    if (ev.type == SensorEvent::RateChanged) storageSaveRate(ev.rateSps);
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
  adc = detectAdc();
  sensorBegin(adc, storageLoadCalibration(adc->type()));
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
