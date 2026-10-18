#include "sessions.h"

#include <ArduinoJson.h>
#include <AsyncJson.h>
#include <LittleFS.h>

#include "api_util.h"

static constexpr const char* kIndexPath = "/sessions.ndjson";
static constexpr const char* kSessionDir = "/s";
static constexpr const char* kItemPrefix = "/api/sessions/";
static constexpr size_t kMaxIdLength = 16;
static constexpr size_t kMaxSessionBytes = 32768;
static constexpr size_t kMinFreeBytes = 65536;  // keep room for settings/routines

// Fields kept out of the index because they are large.
static const char* const kDetailOnlyFields[] = {"curve", "reps"};

static bool validId(const String& id) {
  if (id.isEmpty() || id.length() > kMaxIdLength) return false;
  for (char c : id) {
    if (!isdigit(c) && !(c >= 'a' && c <= 'z')) return false;
  }
  return true;
}

static String sessionPath(const String& id) { return String(kSessionDir) + "/" + id + ".json"; }

static String idFromUrl(AsyncWebServerRequest* req) { return req->url().substring(strlen(kItemPrefix)); }

// Index lines start with {"id":"<id>", because the entry is built with id first.
static String indexLinePrefix(const String& id) { return "{\"id\":\"" + id + "\""; }

static bool removeFromIndex(const String& id) {
  File in = LittleFS.open(kIndexPath, "r");
  if (!in) return true;
  String tmpPath = String(kIndexPath) + ".tmp";
  File out = LittleFS.open(tmpPath, "w");
  if (!out) return false;
  String prefix = indexLinePrefix(id);
  while (in.available()) {
    String line = in.readStringUntil('\n');
    if (line.isEmpty() || line.startsWith(prefix)) continue;
    out.print(line);
    out.print('\n');
  }
  in.close();
  out.close();
  LittleFS.remove(kIndexPath);
  return LittleFS.rename(tmpPath, kIndexPath);
}

static void handleList(AsyncWebServerRequest* req) {
  if (LittleFS.exists(kIndexPath)) {
    req->send(LittleFS, kIndexPath, "application/x-ndjson");
  } else {
    req->send(200, "application/x-ndjson", "");
  }
}

static void handleGet(AsyncWebServerRequest* req) {
  String id = idFromUrl(req);
  if (!validId(id)) return sendError(req, 400, "invalid id");
  String path = sessionPath(id);
  if (!LittleFS.exists(path)) return sendError(req, 404, "not found");
  req->send(LittleFS, path, "application/json");
}

static void handleDelete(AsyncWebServerRequest* req) {
  String id = idFromUrl(req);
  if (!validId(id)) return sendError(req, 400, "invalid id");
  LittleFS.remove(sessionPath(id));
  if (!removeFromIndex(id)) return sendError(req, 500, "index update failed");
  req->send(204);
}

static void handlePost(AsyncWebServerRequest* req, JsonVariant& body) {
  if (!body.is<JsonObject>()) return sendError(req, 400, "expected an object");
  String id = body["id"] | "";
  if (!validId(id)) return sendError(req, 400, "invalid id");
  String path = sessionPath(id);
  if (LittleFS.exists(path)) return sendError(req, 409, "session exists");
  if (LittleFS.totalBytes() - LittleFS.usedBytes() < kMinFreeBytes + measureJson(body)) {
    return sendError(req, 507, "storage full");
  }

  File f = LittleFS.open(path, "w");
  if (!f) return sendError(req, 500, "write failed");
  size_t expected = measureJson(body);
  size_t written = serializeJson(body, f);
  f.close();
  if (written != expected) {
    LittleFS.remove(path);
    return sendError(req, 500, "write failed");
  }

  JsonDocument entry;
  entry["id"] = id;  // first, see indexLinePrefix()
  for (JsonPair kv : body.as<JsonObject>()) {
    bool skip = kv.key() == "id";
    for (const char* field : kDetailOnlyFields) skip = skip || kv.key() == field;
    if (!skip) entry[kv.key()] = kv.value();
  }
  File index = LittleFS.open(kIndexPath, "a");
  if (!index) {
    LittleFS.remove(path);
    return sendError(req, 500, "index update failed");
  }
  serializeJson(entry, index);
  index.print('\n');
  index.close();

  String out;
  serializeJson(entry, out);
  req->send(201, "application/json", out);
}

static void handleStorage(AsyncWebServerRequest* req) {
  JsonDocument doc;
  doc["totalBytes"] = LittleFS.totalBytes();
  doc["usedBytes"] = LittleFS.usedBytes();
  String out;
  serializeJson(doc, out);
  req->send(200, "application/json", out);
}

void sessionsRegister(AsyncWebServer& server) {
  if (!LittleFS.exists(kSessionDir)) LittleFS.mkdir(kSessionDir);

  // Item routes first: "/api/sessions" also matches "/api/sessions/<id>".
  server.on("/api/sessions/*", HTTP_GET, handleGet);
  server.on("/api/sessions/*", HTTP_DELETE, handleDelete);
  server.on("/api/sessions", HTTP_GET, handleList);
  auto* post = new AsyncCallbackJsonWebHandler("/api/sessions", handlePost);
  post->setMethod(HTTP_POST);
  post->setMaxContentLength(kMaxSessionBytes);
  server.addHandler(post);
  server.on("/api/storage", HTTP_GET, handleStorage);
}
