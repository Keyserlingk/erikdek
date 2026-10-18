#pragma once

#include <Arduino.h>

#include "calibration.h"

// Persistent settings in NVS (survive reflashing the web app).
void storageBegin();
Calibration storageLoadCalibration();
void storageSaveCalibration(const Calibration& cal);

struct Settings {
  float bodyweightKg = 0;     // 0 = not set
  float repThresholdKg = 2;   // load that counts as "hanging" when a routine has no target
};

static constexpr float kMinBodyweightKg = 20;
static constexpr float kMaxBodyweightKg = 250;
static constexpr float kMinRepThresholdKg = 0.5;
static constexpr float kMaxRepThresholdKg = 50;

Settings storageLoadSettings();
void storageSaveSettings(const Settings& settings);

// Whole-file helpers for JSON documents on LittleFS.
bool storageReadFile(const char* path, String& out);
bool storageWriteFile(const char* path, const String& data);
