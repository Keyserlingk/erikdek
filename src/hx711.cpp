#include "hx711.h"

static portMUX_TYPE hxMux = portMUX_INITIALIZER_UNLOCKED;

void HX711::begin(uint8_t doutPin, uint8_t sckPin) {
  dout_ = doutPin;
  sck_ = sckPin;
  pinMode(dout_, INPUT);
  pinMode(sck_, OUTPUT);
  digitalWrite(sck_, LOW);  // SCK high for >60 us powers the HX711 down
}

int32_t HX711::read() {
  uint32_t value = 0;
  // Interrupts off: a long SCK-high pulse would corrupt the reading or power it down.
  portENTER_CRITICAL(&hxMux);
  for (int i = 0; i < 24; i++) {
    digitalWrite(sck_, HIGH);
    delayMicroseconds(1);
    value = (value << 1) | (uint32_t)digitalRead(dout_);
    digitalWrite(sck_, LOW);
    delayMicroseconds(1);
  }
  // 25th pulse selects channel A, gain 128 for the next conversion.
  digitalWrite(sck_, HIGH);
  delayMicroseconds(1);
  digitalWrite(sck_, LOW);
  portEXIT_CRITICAL(&hxMux);

  if (value & 0x800000) value |= 0xFF000000;  // sign-extend 24 -> 32 bits
  return (int32_t)value;
}
