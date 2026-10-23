#include "led.h"

#include <Arduino.h>

#ifndef ERKDEK_LED_PIN
#define ERKDEK_LED_PIN 2
#endif
#ifndef ERKDEK_LED_ACTIVE_LOW
#define ERKDEK_LED_ACTIVE_LOW 0
#endif

static constexpr uint32_t kSlowMs = 500;       // half period: waiting for the app
static constexpr uint32_t kFastMs = 100;       // half period: no HX711 readings
static constexpr uint32_t kFlashMs = 120;      // one flash of the double flash
static constexpr uint32_t kBurstMs = 1500;     // period of "3 blinks, pause"
static constexpr uint32_t kRateWindowMs = 500; // no new reading for this long = no HX711

static uint32_t flashStart = 0;
static bool flashing = false;
static uint32_t lastCount = 0;
static uint32_t lastReadingMs = 0;

static void write(bool on) { digitalWrite(ERKDEK_LED_PIN, (on != (bool)ERKDEK_LED_ACTIVE_LOW) ? HIGH : LOW); }

void ledBegin() {
  pinMode(ERKDEK_LED_PIN, OUTPUT);
  write(false);
}

void ledFlash() {
  flashing = true;
  flashStart = millis();
}

void ledLoop(bool appConnected, uint32_t samplesRead) {
  uint32_t now = millis();
  if (samplesRead != lastCount) {
    lastCount = samplesRead;
    lastReadingMs = now;
  }
  bool readings = now - lastReadingMs < kRateWindowMs && lastReadingMs != 0;

  if (flashing) {
    uint32_t t = now - flashStart;
    if (t < 4 * kFlashMs) {
      // Opposite of the current state, twice: visible whether the LED is on or off.
      bool base = appConnected && readings;
      write((t / kFlashMs) % 2 == 0 ? !base : base);
      return;
    }
    flashing = false;
  }
  if (!readings && appConnected) {
    // 3 blinks (100 ms on/off), then off for the rest of the 1.5 s period.
    uint32_t t = now % kBurstMs;
    write(t < 6 * kFastMs && (t / kFastMs) % 2 == 0);
  } else if (!readings) {
    write((now / kFastMs) % 2 == 0);
  } else if (appConnected) {
    write(true);
  } else {
    write((now / kSlowMs) % 2 == 0);
  }
}
