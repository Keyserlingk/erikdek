#include "storage.h"

#include <Preferences.h>

#include "ads1220_config.h"

static Preferences prefs;

void storageBegin() { prefs.begin("erkdek", false); }

Calibration storageLoadCalibration(AdcType adc) {
  Calibration cal;
  cal.countsPerKg = adcDefaultCountsPerKg(adc);
  // Not calibrated yet, or with the other ADC: keep the defaults (reading a missing key
  // logs an error).
  if (!prefs.isKey("cal_cpk") || !prefs.isKey("cal_adc") || prefs.getUChar("cal_adc") != (uint8_t)adc) return cal;
  cal.countsPerKg = prefs.getFloat("cal_cpk", cal.countsPerKg);
  cal.calibrated = prefs.getBool("cal_ok", false);
  return cal;
}

void storageSaveCalibration(const Calibration& cal, AdcType adc) {
  prefs.putFloat("cal_cpk", cal.countsPerKg);
  prefs.putBool("cal_ok", cal.calibrated);
  prefs.putUChar("cal_adc", (uint8_t)adc);
}

uint16_t storageLoadRate() {
  if (!prefs.isKey("ads_rate")) return ads1220::kDefaultRate;
  uint16_t sps = prefs.getUShort("ads_rate", ads1220::kDefaultRate);
  return ads1220::isSupportedRate(sps) ? sps : ads1220::kDefaultRate;
}

void storageSaveRate(uint16_t sps) { prefs.putUShort("ads_rate", sps); }
