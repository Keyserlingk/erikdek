#pragma once

#include <ESPAsyncWebServer.h>

// Saved training sessions and test results on LittleFS:
//   /s/<id>.json        full session (summary, reps, downsampled force curve)
//   /sessions.ndjson    index, one summary line per session (no curve/reps)
//
//   GET    /api/sessions        index as NDJSON
//   POST   /api/sessions        save a session (JSON object with "id")
//   GET    /api/sessions/<id>   full session
//   DELETE /api/sessions/<id>
//   GET    /api/storage         {"totalBytes", "usedBytes", "sessionsBytes", "listsBytes", "appBytes"}
void sessionsRegister(AsyncWebServer& server);
