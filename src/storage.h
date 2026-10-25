#pragma once

#include <stdint.h>

#include "adc_type.h"
#include "calibration.h"

// Calibration and the ADS1220 rate in NVS (survive reflashing). Everything else is
// stored in the app.
void storageBegin();
// The saved calibration if it was made with this ADC, else the ADC's default (a factor
// from the other ADC would be off by ~2x).
Calibration storageLoadCalibration(AdcType adc);
void storageSaveCalibration(const Calibration& cal, AdcType adc);
// The saved ADS1220 rate (SPS), or the default.
uint16_t storageLoadRate();
void storageSaveRate(uint16_t sps);
