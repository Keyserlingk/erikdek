#pragma once

// Bluetooth LE service for the app (layouts in lib/core/ble_protocol.h):
//   samples (notify), status (read/notify), command (write), event (notify),
//   plus Device Information → Firmware Revision.
void bleBegin();
// Call from loop(): streams buffered samples (~20 Hz), status (1 Hz) and events.
void bleLoop();
