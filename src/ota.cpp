#include "ota.h"

#include <Arduino.h>
#include <esp_ota_ops.h>
#include <mbedtls/sha256.h>

#include "ble.h"
#include "ble_protocol.h"

static constexpr uint32_t kProgressEvery = 16 * 1024; // progress notification interval

enum class State : uint8_t { Idle, Starting, Receiving, Finishing };

static volatile State state = State::Idle;
static const esp_partition_t* target = nullptr;
static esp_ota_handle_t handle = 0;
static uint32_t expectedSize = 0;
static uint8_t expectedSha[ble::kOtaShaSize];
static volatile uint32_t received = 0;
static uint32_t nextProgress = 0;
static mbedtls_sha256_context sha;

static void notify(ble::OtaEvent event, ble::OtaErrorCode code, uint32_t value) {
  uint8_t buf[ble::kOtaEventSize];
  bleNotifyOta(buf, ble::encodeOtaEvent(buf, event, code, value));
}

static void fail(ble::OtaErrorCode code) {
  if (state == State::Receiving || state == State::Finishing) esp_ota_abort(handle);
  if (state != State::Idle) mbedtls_sha256_free(&sha);
  state = State::Idle;
  Serial.printf("> update failed (code %u)\n", code);
  notify(ble::OtaError, code, 0);
}

bool otaActive() { return state != State::Idle; }

void otaBegin() {}

void otaMarkValid() {
  esp_ota_img_states_t st;
  const esp_partition_t* running = esp_ota_get_running_partition();
  if (esp_ota_get_state_partition(running, &st) == ESP_OK && st == ESP_OTA_IMG_PENDING_VERIFY) {
    esp_ota_mark_app_valid_cancel_rollback();
    Serial.println("> new firmware started fine: marked valid");
  }
}

// Runs in the Bluetooth task: data is written right away (the slot is erased by then);
// start and end are handed to otaLoop.
void otaHandleWrite(const uint8_t* data, size_t len) {
  ble::OtaCommand cmd;
  if (!ble::parseOta(data, len, cmd)) return;
  switch (cmd.op) {
    case ble::OtaStart:
      if (state != State::Idle) return notify(ble::OtaError, ble::OtaBusy, 0);
      target = esp_ota_get_next_update_partition(nullptr);
      if (!target || cmd.size == 0 || cmd.size > target->size) return notify(ble::OtaError, ble::OtaBadSize, 0);
      expectedSize = cmd.size;
      memcpy(expectedSha, cmd.sha256, sizeof(expectedSha));
      state = State::Starting;  // otaLoop erases the slot, then notifies "ready"
      return;
    case ble::OtaData:
      if (state != State::Receiving) return notify(ble::OtaError, ble::OtaNoSession, 0);
      if (cmd.offset != received) return fail(ble::OtaBadOffset);
      if (received + cmd.length > expectedSize) return fail(ble::OtaBadSize);
      if (esp_ota_write(handle, cmd.data, cmd.length) != ESP_OK) return fail(ble::OtaWriteFailed);
      mbedtls_sha256_update_ret(&sha, cmd.data, cmd.length);
      received = received + cmd.length;
      if (received >= nextProgress) {
        notify(ble::OtaProgress, ble::OtaOk, received);
        nextProgress += kProgressEvery;
      }
      return;
    case ble::OtaEnd:
      if (state != State::Receiving) return notify(ble::OtaError, ble::OtaNoSession, 0);
      if (received != expectedSize) return fail(ble::OtaBadSize);
      state = State::Finishing;
      return;
    case ble::OtaAbort:
      if (state != State::Idle) fail(ble::OtaOk);
      return;
  }
}

static void start() {
  Serial.printf("> update: erasing %u bytes in %s...\n", (unsigned)expectedSize, target->label);
  if (esp_ota_begin(target, expectedSize, &handle) != ESP_OK) {
    state = State::Idle;
    notify(ble::OtaError, ble::OtaBeginFailed, 0);
    return;
  }
  mbedtls_sha256_init(&sha);
  mbedtls_sha256_starts_ret(&sha, 0);
  received = 0;
  nextProgress = kProgressEvery;
  state = State::Receiving;
  Serial.println("> update: receiving");
  notify(ble::OtaReady, ble::OtaOk, expectedSize);
}

static void finish() {
  uint8_t sum[ble::kOtaShaSize];
  mbedtls_sha256_finish_ret(&sha, sum);
  if (memcmp(sum, expectedSha, sizeof(sum)) != 0) return fail(ble::OtaBadChecksum);
  mbedtls_sha256_free(&sha);
  if (esp_ota_end(handle) != ESP_OK) {  // checks the image
    state = State::Idle;
    notify(ble::OtaError, ble::OtaEndFailed, 0);
    return;
  }
  if (esp_ota_set_boot_partition(target) != ESP_OK) {
    state = State::Idle;
    notify(ble::OtaError, ble::OtaEndFailed, 0);
    return;
  }
  Serial.println("> update done, restarting into the new firmware");
  notify(ble::OtaDone, ble::OtaOk, received);
  delay(500);  // let the notification go out
  esp_restart();
}

void otaLoop() {
  if (state == State::Starting) start();
  if (state == State::Finishing) finish();
}
