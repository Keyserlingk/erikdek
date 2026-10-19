#pragma once

#include "calibration.h"

// Calibration in NVS (survives reflashing). Everything else is stored in the app.
void storageBegin();
Calibration storageLoadCalibration();
void storageSaveCalibration(const Calibration& cal);
