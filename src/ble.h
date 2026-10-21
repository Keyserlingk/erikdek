#pragma once

// Bluetooth LE service for the app (layouts in lib/core/ble_protocol.h):
//   samples (notify), status (read/notify), command (write), event (notify),
//   plus Device Information → Firmware Revision.
void bleBegin();
// Call from loop(): streams buffered samples (~20 Hz) and status (1 Hz).
void bleLoop();
// Forwards a tare/calibration result to the app.
struct SensorEvent;
void bleSendEvent(const SensorEvent& ev);
// Whether the app is connected.
bool bleConnected();
