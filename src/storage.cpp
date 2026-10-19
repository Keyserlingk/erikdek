#include "storage.h"

#include <Preferences.h>

static Preferences prefs;

void storageBegin() { prefs.begin("erkdek", false); }

Calibration storageLoadCalibration() {
  Calibration cal;
  cal.countsPerKg = prefs.getFloat("cal_cpk", Calibration::kDefaultCountsPerKg);
  cal.calibrated = prefs.getBool("cal_ok", false);
  return cal;
}

void storageSaveCalibration(const Calibration& cal) {
  prefs.putFloat("cal_cpk", cal.countsPerKg);
  prefs.putBool("cal_ok", cal.calibrated);
}
