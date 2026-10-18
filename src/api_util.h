#pragma once

#include <ArduinoJson.h>
#include <ESPAsyncWebServer.h>

// {"error":"..."} response.
inline void sendError(AsyncWebServerRequest* req, int code, const char* message) {
  JsonDocument doc;
  doc["error"] = message;
  String out;
  serializeJson(doc, out);
  req->send(code, "application/json", out);
}
