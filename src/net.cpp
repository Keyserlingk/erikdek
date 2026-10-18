#include "net.h"

#include <ArduinoJson.h>
#include <AsyncJson.h>
#include <ESPAsyncWebServer.h>
#include <LittleFS.h>
#include <WiFi.h>

#include "api_util.h"
#include "sensor.h"
#include "sessions.h"
#include "storage.h"

// Optional: include/wifi_secrets.h with
//   #define WIFI_SSID "my-hotspot"
//   #define WIFI_PASSWORD "secret"
// to join the phone hotspot. Without it (or if it fails) the ESP starts its own network.
// Replaced by WiFi settings in the web app in milestone 4.
#if __has_include("wifi_secrets.h")
#include "wifi_secrets.h"
#endif

static constexpr const char* kApSsid = "Tindek";
static constexpr const char* kApPassword = "tindek123";  // min 8 chars
static constexpr uint32_t kStaTimeoutMs = 15000;
static constexpr uint32_t kSamplePushMs = 50;
static constexpr uint32_t kStatusPushMs = 1000;

static AsyncWebServer server(80);
static AsyncWebSocket ws("/ws");
static Settings settings;

static void startWifi() {
#ifdef WIFI_SSID
  WiFi.mode(WIFI_STA);
  WiFi.setHostname("tindek");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("Joining %s", WIFI_SSID);
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < kStaTimeoutMs) {
    delay(250);
    Serial.print('.');
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("Connected: http://%s\n", WiFi.localIP().toString().c_str());
    return;
  }
  Serial.println("Hotspot not found, starting own network");
#endif
  WiFi.mode(WIFI_AP);
  WiFi.softAP(kApSsid, kApPassword);
  Serial.printf("AP '%s': http://%s\n", kApSsid, WiFi.softAPIP().toString().c_str());
}

static String statusJson() {
  SensorStatus st = sensorStatus();
  JsonDocument doc;
  doc["t"] = "status";
  doc["rate"] = roundf(st.rateHz * 10) / 10;
  doc["tared"] = st.tared;
  doc["calibrated"] = st.calibrated;
  doc["cpk"] = st.countsPerKg;
  doc["uptime"] = millis();
  doc["dropped"] = st.dropped;
  String out;
  serializeJson(doc, out);
  return out;
}

static void handleCommand(const char* data, size_t len) {
  JsonDocument doc;
  if (deserializeJson(doc, data, len)) return;
  const char* cmd = doc["cmd"] | "";
  if (strcmp(cmd, "tare") == 0) {
    sensorRequestTare();
  } else if (strcmp(cmd, "calibrate") == 0) {
    sensorRequestCalibration(doc["kg"] | 0.0f);
  } else if (strcmp(cmd, "calReset") == 0) {
    sensorResetCalibration();
  } else if (strcmp(cmd, "setCalibration") == 0) {
    sensorSetCalibration(doc["cpk"] | 0.0f);
  }
}

static const char* calResultName(CalResult r) {
  switch (r) {
    case CalResult::BadWeight: return "badWeight";
    case CalResult::TooSmall: return "tooSmall";
    default: return "ok";
  }
}

// Forwards tare/calibration results to the browsers and persists new calibrations.
static void handleSensorEvents() {
  SensorEvent ev;
  while (sensorPollEvent(ev)) {
    JsonDocument doc;
    switch (ev.type) {
      case SensorEvent::Tared:
        doc["t"] = "tared";
        break;
      case SensorEvent::Calibrated:
        storageSaveCalibration(ev.calibration);
        doc["t"] = "calibrated";
        doc["calibrated"] = ev.calibration.calibrated;
        doc["cpk"] = ev.calibration.countsPerKg;
        break;
      case SensorEvent::CalibrationFailed:
        doc["t"] = "calError";
        doc["reason"] = calResultName(ev.result);
        break;
    }
    String out;
    serializeJson(doc, out);
    ws.textAll(out);
  }
}

static void onWsEvent(AsyncWebSocket*, AsyncWebSocketClient* client, AwsEventType type, void* arg,
                      uint8_t* data, size_t len) {
  if (type == WS_EVT_CONNECT) {
    client->text(statusJson());
  } else if (type == WS_EVT_DATA) {
    auto* info = (AwsFrameInfo*)arg;
    if (info->final && info->index == 0 && info->len == len && info->opcode == WS_TEXT) {
      handleCommand((const char*)data, len);
    }
  }
}

static void settingsToJson(JsonObject obj) {
  obj["bodyweightKg"] = settings.bodyweightKg;
  obj["repThresholdKg"] = settings.repThresholdKg;
}


static void handleGetSettings(AsyncWebServerRequest* req) {
  auto* res = new AsyncJsonResponse();
  settingsToJson(res->getRoot().to<JsonObject>());
  res->setLength();
  req->send(res);
}

// PUT /api/settings with any subset of the fields; responds with the full settings.
static void handlePutSettings(AsyncWebServerRequest* req, JsonVariant& body) {
  Settings next = settings;
  if (body["bodyweightKg"].is<float>()) {
    float bw = body["bodyweightKg"];
    if (bw != 0 && (bw < kMinBodyweightKg || bw > kMaxBodyweightKg)) {
      return sendError(req, 400, "bodyweightKg out of range");
    }
    next.bodyweightKg = bw;
  }
  if (body["repThresholdKg"].is<float>()) {
    float thr = body["repThresholdKg"];
    if (thr < kMinRepThresholdKg || thr > kMaxRepThresholdKg) {
      return sendError(req, 400, "repThresholdKg out of range");
    }
    next.repThresholdKg = thr;
  }
  settings = next;
  storageSaveSettings(settings);
  handleGetSettings(req);
}

// A user list (custom routines, hold types) stored as one JSON array file. The web app
// owns the item format and replaces the whole list on every change; built-in entries
// live in the web app.
struct JsonListFile {
  const char* uri;
  const char* path;
  size_t maxItems;
  size_t maxBytes;
};

static constexpr JsonListFile kJsonLists[] = {
    {"/api/routines", "/routines.json", 50, 16384},
    {"/api/holdtypes", "/holdtypes.json", 50, 4096},
    {"/api/grips", "/grips.json", 50, 4096},
};

static void registerJsonList(const JsonListFile& list) {
  server.on(list.uri, HTTP_GET, [list](AsyncWebServerRequest* req) {
    String data;
    if (!storageReadFile(list.path, data) || data.isEmpty()) data = "[]";
    req->send(200, "application/json", data);
  });
  auto* put = new AsyncCallbackJsonWebHandler(list.uri, [list](AsyncWebServerRequest* req, JsonVariant& body) {
    if (!body.is<JsonArray>()) return sendError(req, 400, "expected an array");
    if (body.size() > list.maxItems) return sendError(req, 400, "too many items");
    String data;
    serializeJson(body, data);
    if (!storageWriteFile(list.path, data)) return sendError(req, 500, "write failed");
    req->send(200, "application/json", data);
  });
  put->setMethod(HTTP_PUT);
  put->setMaxContentLength(list.maxBytes);
  server.addHandler(put);
}

void netBegin() {
  settings = storageLoadSettings();
  startWifi();
  ws.onEvent(onWsEvent);
  server.addHandler(&ws);
  server.on("/api/settings", HTTP_GET, handleGetSettings);
  auto* putSettings = new AsyncCallbackJsonWebHandler("/api/settings", handlePutSettings);
  putSettings->setMethod(HTTP_PUT);
  server.addHandler(putSettings);
  for (const auto& list : kJsonLists) registerJsonList(list);
  sessionsRegister(server);
  server.serveStatic("/", LittleFS, "/").setDefaultFile("index.html");
  server.onNotFound([](AsyncWebServerRequest* req) { req->send(404, "text/plain", "Not found"); });
  server.begin();
}

void netLoop() {
  static uint32_t lastSamples = 0;
  static uint32_t lastStatus = 0;
  uint32_t now = millis();

  handleSensorEvents();

  if (now - lastSamples >= kSamplePushMs) {
    lastSamples = now;
    Sample buf[32];
    size_t n = sensorDrain(buf, 32);
    if (n > 0 && ws.count() > 0 && ws.availableForWriteAll()) {
      // {"t":"samples","ts":123,"te":160,"kg":[1.234,...]}  built by hand, it runs 20x per second.
      // ts/te: millis() of the first/last sample; the browser spaces the samples in between.
      String out;
      out.reserve(40 + n * 9);
      out += "{\"t\":\"samples\",\"ts\":";
      out += buf[0].ms;
      out += ",\"te\":";
      out += buf[n - 1].ms;
      out += ",\"kg\":[";
      for (size_t i = 0; i < n; i++) {
        if (i) out += ',';
        out += String(buf[i].kg, 3);
      }
      out += "]}";
      ws.textAll(out);
    }
  }

  if (now - lastStatus >= kStatusPushMs) {
    lastStatus = now;
    if (ws.count() > 0) ws.textAll(statusJson());
    ws.cleanupClients();
  }
}
