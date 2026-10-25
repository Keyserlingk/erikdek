#pragma once

#include <Arduino.h>
#include <SPI.h>

#include "adc.h"

// TI ADS1220 on the VSPI bus (SPI mode 1, 1 MHz): AIN1 − AIN2 at gain 128, external
// reference on REFP0/REFN0 (ratiometric), continuous conversion. Register values and
// rates in lib/core/ads1220_config.h. A falling edge on DRDY (new data) wakes the
// sensor task through a task notification, so nothing polls.
class Ads1220 : public LoadCellAdc {
 public:
  struct Pins {
    uint8_t sck, miso, mosi, cs, drdy;
  };

  // Resets the chip, writes the configuration and reads it back: false (and the bus
  // released) when no ADS1220 answers. Starts conversions at `sps` otherwise.
  bool begin(const Pins& pins, uint16_t sps);

  AdcType type() const override { return AdcType::Ads1220; }
  bool waitReady() override;
  int32_t read() override;
  uint16_t rateSps() const override { return rate_; }
  bool setRate(uint16_t sps) override;

 private:
  void command(uint8_t cmd);
  void writeRegs(uint8_t first, const uint8_t* values, uint8_t count);
  void readRegs(uint8_t first, uint8_t* out, uint8_t count);

  SPIClass spi_{VSPI};
  Pins pins_{};
  volatile uint16_t rate_ = 0;
};
