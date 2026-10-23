#pragma once

#include <stddef.h>
#include <stdint.h>

// Firmware update over Bluetooth (layouts in lib/core/ble_protocol.h). Pressing the BOOT
// button opens a 30 s window in which the app may start an update. The new firmware
// goes into the other OTA slot while this one keeps running; only a complete image
// with the right SHA-256 is switched to. After the restart the new firmware is on
// probation until it marks itself valid (otaMarkValid); if it crashes before that,
// the bootloader goes back to the previous one.
void otaBegin();
// Call from loop(): BOOT button, and the slow steps (erasing the slot, finishing).
void otaLoop();
// A write to the update characteristic (from the Bluetooth task).
void otaHandleWrite(const uint8_t* data, size_t len);
// True while an update is being received (sample streaming pauses).
bool otaActive();
// Marks the running firmware as good (cancels a pending rollback).
void otaMarkValid();
