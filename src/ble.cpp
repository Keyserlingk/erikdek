#include "ble.h"

#include <Arduino.h>
#include <NimBLEDevice.h>

#include "battery.h"
#include "ble_protocol.h"
#include "ota.h"
#include "sensor.h"

#ifndef ERKDEK_VERSION
#define ERKDEK_VERSION "unknown"  // set by tools/version.py
#endif

// Same values as data/bleprotocol.js.
static constexpr const char* kDeviceName = "Erkdek";
static constexpr const char* kServiceUuid = "9a0b0001-3d10-4e93-8657-4a72c5dd3311";
static constexpr const char* kSamplesUuid = "9a0b0002-3d10-4e93-8657-4a72c5dd3311";
static constexpr const char* kStatusUuid = "9a0b0003-3d10-4e93-8657-4a72c5dd3311";
static constexpr const char* kCommandUuid = "9a0b0004-3d10-4e93-8657-4a72c5dd3311";
static constexpr const char* kEventUuid = "9a0b0005-3d10-4e93-8657-4a72c5dd3311";
static constexpr const char* kOtaUuid = "9a0b0006-3d10-4e93-8657-4a72c5dd3311";

static constexpr uint32_t kSamplePushMs = 50;
static constexpr uint32_t kStatusPushMs = 1000;
static constexpr uint16_t kMtu = 247;
static constexpr size_t kMaxBatch = 32;  // samples drained per push (~3 pushes' worth)

static NimBLEServer* server = nullptr;
static NimBLECharacteristic* samplesChr = nullptr;
static NimBLECharacteristic* statusChr = nullptr;
static NimBLECharacteristic* eventChr = nullptr;
static NimBLECharacteristic* otaChr = nullptr;
static volatile uint16_t connHandle = BLE_HS_CONN_HANDLE_NONE;
static uint16_t seq = 0;

class ServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* s, NimBLEConnInfo& info) override {
    connHandle = info.getConnHandle();
    // Short connection interval (1.25 ms units: 7.5–15 ms) so 80 Hz streams smoothly.
    s->updateConnParams(info.getConnHandle(), 6, 12, 0, 400);
  }

  void onDisconnect(NimBLEServer*, NimBLEConnInfo&, int) override {
    connHandle = BLE_HS_CONN_HANDLE_NONE;  // advertising restarts (advertiseOnDisconnect)
  }
};

class CommandCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* c, NimBLEConnInfo&) override {
    const NimBLEAttValue& value = c->getValue();
    ble::ParsedCommand cmd;
    if (!ble::parseCommand(value.data(), value.size(), cmd)) return;
    switch (cmd.op) {
      case ble::CmdTare:
        sensorRequestTare();
        break;
      case ble::CmdCalibrate:
        sensorRequestCalibration(cmd.value);
        break;
      case ble::CmdCalReset:
        sensorResetCalibration();
        break;
      case ble::CmdSetCalibration:
        sensorSetCalibration(cmd.value);
        break;
    }
  }
};

class OtaCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* c, NimBLEConnInfo&) override {
    const NimBLEAttValue& value = c->getValue();
    otaHandleWrite(value.data(), value.size());
  }
};

void bleNotifyOta(const uint8_t* data, size_t len) {
  if (bleConnected()) otaChr->notify(data, len);
}

bool bleConnected() { return connHandle != BLE_HS_CONN_HANDLE_NONE; }

static void updateStatus(bool notify) {
  SensorStatus st = sensorStatus();
  uint8_t buf[ble::kStatusSize];
  size_t n = ble::encodeStatus(buf, st.tared, st.calibrated, st.rateHz, st.countsPerKg, millis(), st.tareNoise.rmsKg,
                               st.tareNoise.ppKg, batteryVolts());
  statusChr->setValue(buf, n);
  if (notify && bleConnected()) statusChr->notify();
}

void bleBegin() {
  NimBLEDevice::init(kDeviceName);
  NimBLEDevice::setMTU(kMtu);
  server = NimBLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());
  server->advertiseOnDisconnect(true);

  NimBLEService* service = server->createService(kServiceUuid);
  samplesChr = service->createCharacteristic(kSamplesUuid, NIMBLE_PROPERTY::NOTIFY);
  statusChr = service->createCharacteristic(kStatusUuid, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
  NimBLECharacteristic* commandChr =
      service->createCharacteristic(kCommandUuid, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
  commandChr->setCallbacks(new CommandCallbacks());
  eventChr = service->createCharacteristic(kEventUuid, NIMBLE_PROPERTY::NOTIFY);
  otaChr = service->createCharacteristic(kOtaUuid, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::NOTIFY);
  otaChr->setCallbacks(new OtaCallbacks());

  // Standard Device Information service: Firmware Revision String.
  NimBLEService* info = server->createService("180A");
  info->createCharacteristic("2A26", NIMBLE_PROPERTY::READ)->setValue(ERKDEK_VERSION);

  updateStatus(false);
  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->setName(kDeviceName);
  adv->addServiceUUID(kServiceUuid);
  adv->start();
  Serial.printf("BLE advertising as %s (firmware %s)\n", kDeviceName, ERKDEK_VERSION);
}

static ble::CalError calError(CalResult r) {
  switch (r) {
    case CalResult::BadWeight:
      return ble::CalErrBadWeight;
    case CalResult::Moving:
      return ble::CalErrMoving;
    default:
      return ble::CalErrTooSmall;
  }
}

void bleSendEvent(const SensorEvent& ev) {
  uint8_t buf[8];
  size_t n = 0;
  switch (ev.type) {
    case SensorEvent::Tared:
      n = ble::encodeTared(buf);
      break;
    case SensorEvent::Calibrated:
      n = ble::encodeCalibrated(buf, ev.calibration.calibrated, ev.calibration.countsPerKg, ev.noise.rmsKg);
      break;
    case SensorEvent::CalibrationFailed:
      n = ble::encodeCalError(buf, calError(ev.result), ev.noise.rmsKg);
      break;
  }
  if (bleConnected()) eventChr->notify(buf, n);
  updateStatus(true);
}

// Sends the buffered samples in as few notifications as the MTU allows.
static void sendSamples() {
  Sample buf[kMaxBatch];
  size_t n = sensorDrain(buf, kMaxBatch);
  if (n == 0 || !bleConnected()) return;  // drained anyway, so nothing piles up

  uint16_t mtu = max<uint16_t>(server->getPeerMTU(connHandle), 23);  // 23 = BLE minimum
  size_t perPacket = ble::samplesPerPacket(mtu - 3);
  if (perPacket == 0) return;
  // Average time between samples (µs); 80 Hz when there is only one.
  uint16_t dtUs = n > 1 ? (uint16_t)((buf[n - 1].ms - buf[0].ms) * 1000 / (n - 1)) : 12500;
  float kg[kMaxBatch];
  for (size_t i = 0; i < n; i++) kg[i] = buf[i].kg;

  uint8_t packet[ble::kSamplesHeader + 2 * kMaxBatch];
  for (size_t start = 0; start < n; start += perPacket) {
    size_t count = min(perPacket, n - start);
    size_t len = ble::encodeSamples(packet, seq++, buf[start].ms, dtUs, kg + start, count);
    samplesChr->notify(packet, len);
  }
}

void bleLoop() {
  static uint32_t lastSamples = 0;
  static uint32_t lastStatus = 0;
  uint32_t now = millis();

  if (now - lastSamples >= kSamplePushMs) {
    lastSamples = now;
    if (otaActive()) {
      // During a firmware update the link is for the update: drop the readings.
      Sample discard[kMaxBatch];
      while (sensorDrain(discard, kMaxBatch)) {
      }
    } else {
      sendSamples();
    }
  }
  if (now - lastStatus >= kStatusPushMs) {
    lastStatus = now;
    updateStatus(true);
  }
}
