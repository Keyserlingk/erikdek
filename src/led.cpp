#include "led.h"

#include <Arduino.h>

#ifndef ERKDEK_LED_PIN
#define ERKDEK_LED_PIN 2
#endif
#ifndef ERKDEK_LED_ACTIVE_LOW
#define ERKDEK_LED_ACTIVE_LOW 0
#endif

// PWM on an LEDC channel, so the LED can fade: calm states breathe, warnings blink.
static constexpr uint8_t kChannel = 0;
static constexpr uint32_t kPwmHz = 5000;
static constexpr uint8_t kPwmBits = 10;
static constexpr uint32_t kMaxDuty = (1u << kPwmBits) - 1;

static constexpr uint32_t kBreathMs = 2000;    // period of the breathing: waiting for the app
static constexpr float kConnectedLevel = 0.4f; // steady brightness while connected
static constexpr uint32_t kFastMs = 100;       // half period: no HX711 readings
static constexpr uint32_t kFlashMs = 120;      // one flash of the double flash
static constexpr uint32_t kBurstMs = 1500;     // period of "3 blinks, pause"
static constexpr uint32_t kRateWindowMs = 500; // no new reading for this long = no HX711

static uint32_t flashStart = 0;
static bool flashing = false;
static uint32_t lastCount = 0;
static uint32_t lastReadingMs = 0;

// Brightness 0..1, through a gamma curve so fades look even to the eye.
static void level(float b) {
  b = b < 0 ? 0 : b > 1 ? 1 : b;
  uint32_t duty = (uint32_t)(powf(b, 2.2f) * kMaxDuty + 0.5f);
  ledcWrite(kChannel, ERKDEK_LED_ACTIVE_LOW ? kMaxDuty - duty : duty);
}

static void write(bool on) { level(on ? 1.0f : 0.0f); }

void ledBegin() {
  ledcSetup(kChannel, kPwmHz, kPwmBits);
  ledcAttachPin(ERKDEK_LED_PIN, kChannel);
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
      write((t / kFlashMs) % 2 == 0); // two full-brightness flashes
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
    level(kConnectedLevel);
  } else {
    // Breathing: a slow cosine fade up and down.
    level((1.0f - cosf(2.0f * PI * (now % kBreathMs) / kBreathMs)) / 2.0f);
  }
}
