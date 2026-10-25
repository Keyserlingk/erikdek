#include "ads1220.h"

#include <driver/gpio.h>

#include "ads1220_config.h"

static const SPISettings kSpi(1000000, MSBFIRST, SPI_MODE1);
static constexpr uint32_t kReadyTimeoutMs = 100;  // longest conversion is 50 ms (20 SPS)

// The task waiting in waitReady(); set on its first call, notified on each DRDY edge.
static volatile TaskHandle_t drdyTask = nullptr;

static void IRAM_ATTR onDrdy() {
  TaskHandle_t task = drdyTask;
  if (!task) return;
  BaseType_t woken = pdFALSE;
  vTaskNotifyGiveFromISR(task, &woken);
  if (woken) portYIELD_FROM_ISR();
}

void Ads1220::command(uint8_t cmd) {
  spi_.beginTransaction(kSpi);
  digitalWrite(pins_.cs, LOW);
  spi_.transfer(cmd);
  digitalWrite(pins_.cs, HIGH);
  spi_.endTransaction();
}

void Ads1220::writeRegs(uint8_t first, const uint8_t* values, uint8_t count) {
  spi_.beginTransaction(kSpi);
  digitalWrite(pins_.cs, LOW);
  spi_.transfer(ads1220::cmdWriteReg(first, count));
  for (uint8_t i = 0; i < count; i++) spi_.transfer(values[i]);
  digitalWrite(pins_.cs, HIGH);
  spi_.endTransaction();
}

void Ads1220::readRegs(uint8_t first, uint8_t* out, uint8_t count) {
  spi_.beginTransaction(kSpi);
  digitalWrite(pins_.cs, LOW);
  spi_.transfer(ads1220::cmdReadReg(first, count));
  for (uint8_t i = 0; i < count; i++) out[i] = spi_.transfer(0x00);
  digitalWrite(pins_.cs, HIGH);
  spi_.endTransaction();
}

bool Ads1220::begin(const Pins& pins, uint16_t sps) {
  uint8_t config[4] = {ads1220::kConfig0, 0, ads1220::kConfig2, ads1220::kConfig3};
  if (!ads1220::config1ForRate(sps, config[1])) {
    sps = ads1220::kDefaultRate;
    ads1220::config1ForRate(sps, config[1]);
  }
  pins_ = pins;
  pinMode(pins_.cs, OUTPUT);
  digitalWrite(pins_.cs, HIGH);
  // Pull-up on DRDY: without a chip it stays "no data" instead of floating.
  pinMode(pins_.drdy, INPUT_PULLUP);
  spi_.begin(pins_.sck, pins_.miso, pins_.mosi, -1);
  // Without a chip MISO reads 0xFF instead of floating, so the readback can't match.
  gpio_pullup_en((gpio_num_t)pins_.miso);

  command(ads1220::kCmdReset);
  delay(1);  // reset takes ~50 µs
  writeRegs(0, config, 4);
  uint8_t readback[4] = {};
  readRegs(0, readback, 4);
  if (memcmp(config, readback, sizeof(config)) != 0) {
    spi_.end();
    return false;
  }
  rate_ = sps;
  attachInterrupt(digitalPinToInterrupt(pins_.drdy), onDrdy, FALLING);
  command(ads1220::kCmdStartSync);  // continuous mode: one START begins converting
  return true;
}

bool Ads1220::waitReady() {
  if (!drdyTask) drdyTask = xTaskGetCurrentTaskHandle();
  if (ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(kReadyTimeoutMs)) > 0) return true;
  // No edge for a while (e.g. right after start): read if data is waiting anyway.
  return digitalRead(pins_.drdy) == LOW;
}

int32_t Ads1220::read() {
  // Continuous mode: after DRDY falls the result is clocked out directly (no RDATA).
  uint8_t b[3];
  spi_.beginTransaction(kSpi);
  digitalWrite(pins_.cs, LOW);
  for (uint8_t& v : b) v = spi_.transfer(0x00);
  digitalWrite(pins_.cs, HIGH);
  spi_.endTransaction();
  return ads1220::signExtend24(b[0], b[1], b[2]);
}

bool Ads1220::setRate(uint16_t sps) {
  uint8_t config1;
  if (!ads1220::config1ForRate(sps, config1)) return false;
  writeRegs(1, &config1, 1);
  uint8_t readback = 0;
  readRegs(1, &readback, 1);
  if (readback != config1) return false;
  command(ads1220::kCmdStartSync);  // restart conversions at the new rate
  rate_ = sps;
  return true;
}
