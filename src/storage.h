#pragma once

#include "calibration.h"

// Persistent settings in NVS (survive reflashing the web app).
void storageBegin();
Calibration storageLoadCalibration();
void storageSaveCalibration(const Calibration& cal);
