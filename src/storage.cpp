#include "storage.h"

#include <LittleFS.h>
#include <Preferences.h>

static Preferences prefs;

void storageBegin() {
  prefs.begin("tindek", false);
  if (!LittleFS.begin(true)) {
    Serial.println("LittleFS mount failed");
  }
}

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

Settings storageLoadSettings() {
  Settings s;
  s.bodyweightKg = prefs.getFloat("bodyweight", 0);
  return s;
}

void storageSaveSettings(const Settings& s) { prefs.putFloat("bodyweight", s.bodyweightKg); }
