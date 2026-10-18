#include "storage.h"

#include <LittleFS.h>
#include <Preferences.h>

static Preferences prefs;

void storageBegin() {
  prefs.begin("erkdek", false);
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
  s.bodyweightKg = prefs.getFloat("bodyweight", s.bodyweightKg);
  s.repThresholdKg = prefs.getFloat("rep_thr", s.repThresholdKg);
  return s;
}

void storageSaveSettings(const Settings& s) {
  prefs.putFloat("bodyweight", s.bodyweightKg);
  prefs.putFloat("rep_thr", s.repThresholdKg);
}

bool storageReadFile(const char* path, String& out) {
  File f = LittleFS.open(path, "r");
  if (!f) return false;
  out = f.readString();
  f.close();
  return true;
}

bool storageWriteFile(const char* path, const String& data) {
  // Write to a temp file first so a power loss can't leave a half-written file.
  String tmp = String(path) + ".tmp";
  File f = LittleFS.open(tmp, "w");
  if (!f) return false;
  size_t written = f.print(data);
  f.close();
  if (written != data.length()) {
    LittleFS.remove(tmp);
    return false;
  }
  LittleFS.remove(path);
  return LittleFS.rename(tmp, path);
}
