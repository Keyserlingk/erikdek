#pragma once

#include "calibration.h"

// Persistent settings in NVS (survive reflashing the web app).
void storageBegin();
Calibration storageLoadCalibration();
void storageSaveCalibration(const Calibration& cal);

struct Settings {
  float bodyweightKg = 0;  // 0 = not set
};

static constexpr float kMinBodyweightKg = 20;
static constexpr float kMaxBodyweightKg = 250;

Settings storageLoadSettings();
void storageSaveSettings(const Settings& settings);
