#!/usr/bin/env python3
"""Mock Tindek ESP32: serves data/ and speaks the same WebSocket protocol as the firmware.

Standard library only. Run:  python3 tools/mock_server.py [--port 8080]
then open http://localhost:8080 (or http://<laptop-ip>:8080 from the phone).
"""
import argparse
import base64
import hashlib
import json
import math
import os
import random
import re
import struct
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

SAMPLE_RATE_HZ = 80
PUSH_RATE_HZ = 20
TARE_SAMPLES = 40  # 0.5 s, same as firmware
CALIBRATION_SAMPLES = 80  # 1 s, same as firmware
MIN_CALIBRATION_COUNTS = 5000
MIN_BODYWEIGHT_KG, MAX_BODYWEIGHT_KG = 20, 250
MIN_REP_THRESHOLD_KG, MAX_REP_THRESHOLD_KG = 0.5, 50
# User lists stored as JSON array files on the device: name -> (max items, max bytes)
JSON_LISTS = {"routines": (50, 16384), "holdtypes": (50, 4096), "grips": (50, 4096)}

# The simulated cell is ~12 % off from the firmware's default factor, so calibration matters.
DEFAULT_COUNTS_PER_KG = 14300.0
TRUE_COUNTS_PER_KG = 16000.0
RAW_ZERO = 52000  # raw reading with no load
NOISE_COUNTS = 900  # ~0.06 kg

STATE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".mock_state.json")
SESSIONS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".mock_sessions")
SESSION_ID = re.compile(r"^[a-z0-9]{1,16}$")
MAX_SESSION_BYTES = 32768
FS_TOTAL_BYTES = 1441792  # LittleFS partition on the ESP32
FS_BASE_USED_BYTES = 160000  # web app + settings files


class SessionStore:
    """Same layout and rules as src/sessions.cpp: one file per session plus an NDJSON index."""

    def __init__(self):
        os.makedirs(SESSIONS_DIR, exist_ok=True)
        self.index_path = os.path.join(SESSIONS_DIR, "sessions.ndjson")
        self.lock = threading.Lock()

    def path(self, sid):
        return os.path.join(SESSIONS_DIR, f"{sid}.json")

    def used_bytes(self):
        return FS_BASE_USED_BYTES + sum(
            os.path.getsize(os.path.join(SESSIONS_DIR, f)) for f in os.listdir(SESSIONS_DIR)
        )

    def index(self):
        try:
            with open(self.index_path) as f:
                return f.read()
        except OSError:
            return ""

    def get(self, sid):
        """Returns (status, body)."""
        if not SESSION_ID.match(sid):
            return 400, {"error": "invalid id"}
        try:
            with open(self.path(sid)) as f:
                return 200, json.load(f)
        except OSError:
            return 404, {"error": "not found"}

    def save(self, body):
        if not isinstance(body, dict):
            return 400, {"error": "expected an object"}
        sid = body.get("id", "")
        if not isinstance(sid, str) or not SESSION_ID.match(sid):
            return 400, {"error": "invalid id"}
        data = json.dumps(body, separators=(",", ":"))
        with self.lock:
            if os.path.exists(self.path(sid)):
                return 409, {"error": "session exists"}
            if FS_TOTAL_BYTES - self.used_bytes() < 65536 + len(data):
                return 507, {"error": "storage full"}
            with open(self.path(sid), "w") as f:
                f.write(data)
            entry = {"id": sid, **{k: v for k, v in body.items() if k not in ("id", "curve", "reps")}}
            with open(self.index_path, "a") as f:
                f.write(json.dumps(entry, separators=(",", ":")) + "\n")
        return 201, entry

    def delete(self, sid):
        if not SESSION_ID.match(sid):
            return 400, {"error": "invalid id"}
        with self.lock:
            try:
                os.remove(self.path(sid))
            except OSError:
                pass
            prefix = '{"id":"%s"' % sid
            lines = [l for l in self.index().splitlines() if l and not l.startswith(prefix)]
            with open(self.index_path, "w") as f:
                f.write("".join(l + "\n" for l in lines))
        return 204, None


class SimulatedLoadCell:
    """Generates raw HX711 counts for a selectable scenario.

    workout: rest, ramp up, hold with tremor and fatigue, release (repeats)
    idle:    nothing hanging
    weight:  a fixed known weight, swinging a bit after it is hung
    """

    def __init__(self):
        self.lock = threading.Lock()
        self.drift = 0.0
        self.t = 0.0
        self.scenario = "workout"
        self.weight_kg = 20.0
        self.scenario_start = 0.0
        self._next_phase(start=0.0)

    def set_scenario(self, scenario, kg=None):
        with self.lock:
            self.scenario = scenario
            if kg is not None:
                self.weight_kg = kg
            self.scenario_start = self.t
            self._next_phase(start=self.t)

    def _next_phase(self, start):
        self.phase_start = start
        self.rest_s = random.uniform(3.0, 6.0)
        self.hold_s = random.uniform(4.0, 8.0)
        self.target_kg = random.uniform(15.0, 40.0)
        self.spike = random.random() < 0.25  # occasional explosive pull

    def _workout_force(self, t):
        dt = t - self.phase_start
        if dt < self.rest_s:
            return 0.0
        dt -= self.rest_s
        ramp = 0.12 if self.spike else 0.35
        if dt < ramp:
            peak = self.target_kg * (1.4 if self.spike else 1.0)
            return peak * (dt / ramp)
        dt -= ramp
        if dt < self.hold_s:
            fatigue = 1.0 - 0.08 * dt / self.hold_s
            tremor = 0.6 * math.sin(2 * math.pi * 7 * t) + 0.4 * math.sin(2 * math.pi * 1.3 * t)
            overshoot = 0.4 * self.target_kg * math.exp(-dt * 8) if self.spike else 0.0
            return self.target_kg * fatigue + tremor + overshoot
        dt -= self.hold_s
        if dt < 0.2:
            return self.target_kg * (1 - dt / 0.2)
        self._next_phase(start=t)
        return 0.0

    def _force(self, t):
        if self.scenario == "idle":
            return 0.0
        if self.scenario == "weight":
            dt = t - self.scenario_start
            swing = 0.25 * self.weight_kg * math.exp(-dt * 1.5) * math.sin(2 * math.pi * 1.8 * dt)
            return self.weight_kg + swing
        return self._workout_force(t)

    def next_raw(self):
        with self.lock:
            self.t += 1.0 / SAMPLE_RATE_HZ
            self.drift += random.gauss(0, 8)
            kg = self._force(self.t)
            return int(RAW_ZERO + self.drift + kg * TRUE_COUNTS_PER_KG + random.gauss(0, NOISE_COUNTS))


class RawAverager:
    def __init__(self):
        self.target, self.values = 0, []

    def reset(self, target):
        self.target, self.values = target, []

    def add(self, raw):
        """Returns True when this sample completes the average."""
        if len(self.values) >= self.target:
            return False
        self.values.append(raw)
        return len(self.values) == self.target

    def average(self):
        return int(sum(self.values) / len(self.values))


class Device:
    """Stands in for the firmware's sensor task and network loop."""

    def __init__(self):
        self.cell = SimulatedLoadCell()
        self.offset = 0
        self.counts_per_kg = DEFAULT_COUNTS_PER_KG
        self.calibrated = False
        self.settings = {"bodyweightKg": 0, "repThresholdKg": 2}
        self.lists = {name: [] for name in JSON_LISTS}
        self.sessions = SessionStore()
        self.cal_kg = 0.0
        self.tared = False
        self.tare_avg = RawAverager()
        self.cal_avg = RawAverager()
        self.clients = set()
        self.clients_lock = threading.Lock()
        self.boot = time.monotonic()
        self.rate_hz = 0.0
        self.load_state()
        self.tare_avg.reset(TARE_SAMPLES)  # firmware auto-tares on boot

    def load_state(self):
        """Calibration persists across restarts, like NVS on the ESP."""
        try:
            with open(STATE_FILE) as f:
                state = json.load(f)
            self.counts_per_kg = state["counts_per_kg"]
            self.calibrated = state["calibrated"]
            self.settings.update(state.get("settings", {}))
            for name in JSON_LISTS:
                self.lists[name] = state.get(name, [])
        except (OSError, ValueError, KeyError):
            pass

    def save_state(self):
        with open(STATE_FILE, "w") as f:
            json.dump(
                {
                    "counts_per_kg": self.counts_per_kg,
                    "calibrated": self.calibrated,
                    "settings": self.settings,
                    **self.lists,
                },
                f,
            )

    def update_settings(self, body):
        """Same rules as the firmware's PUT /api/settings. Returns an error string or None."""
        if "bodyweightKg" in body:
            bw = body["bodyweightKg"]
            if not isinstance(bw, (int, float)) or (bw != 0 and not MIN_BODYWEIGHT_KG <= bw <= MAX_BODYWEIGHT_KG):
                return "bodyweightKg out of range"
            self.settings["bodyweightKg"] = bw
        if "repThresholdKg" in body:
            thr = body["repThresholdKg"]
            if not isinstance(thr, (int, float)) or not MIN_REP_THRESHOLD_KG <= thr <= MAX_REP_THRESHOLD_KG:
                return "repThresholdKg out of range"
            self.settings["repThresholdKg"] = thr
        self.save_state()
        return None

    def replace_list(self, name, body):
        """Same rules as the firmware's PUT /api/<list>. Returns an error string or None."""
        if not isinstance(body, list):
            return "expected an array"
        if len(body) > JSON_LISTS[name][0]:
            return "too many items"
        self.lists[name] = body
        self.save_state()
        return None

    def millis(self):
        return int((time.monotonic() - self.boot) * 1000)

    def to_kg(self, raw):
        return (raw - self.offset) / self.counts_per_kg

    def finish_calibration(self):
        if not self.cal_kg > 0:
            self.broadcast({"t": "calError", "reason": "badWeight"})
            return
        delta = self.cal_avg.average() - self.offset
        if abs(delta) < MIN_CALIBRATION_COUNTS:
            self.broadcast({"t": "calError", "reason": "tooSmall"})
            return
        self.counts_per_kg = delta / self.cal_kg
        self.calibrated = True
        self.save_state()
        self.broadcast({"t": "calibrated", "calibrated": True, "cpk": self.counts_per_kg})

    def run(self):
        period = 1.0 / SAMPLE_RATE_HZ
        per_push = SAMPLE_RATE_HZ // PUSH_RATE_HZ
        batch, batch_ts, batch_te = [], 0, 0
        next_t = time.monotonic()
        rate_count, rate_start = 0, time.monotonic()
        last_status = 0.0
        while True:
            raw = self.cell.next_raw()
            if self.tare_avg.add(raw):
                self.offset = self.tare_avg.average()
                self.tared = True
                self.broadcast({"t": "tared"})
            if self.cal_avg.add(raw):
                self.finish_calibration()

            batch_te = self.millis()
            if not batch:
                batch_ts = batch_te
            batch.append(round(self.to_kg(raw), 3))
            if len(batch) >= per_push:
                self.broadcast({"t": "samples", "ts": batch_ts, "te": batch_te, "kg": batch})
                batch = []

            rate_count += 1
            now = time.monotonic()
            if now - rate_start >= 2.0:
                self.rate_hz = rate_count / (now - rate_start)
                rate_count, rate_start = 0, now
            if now - last_status >= 1.0:
                last_status = now
                self.broadcast(self.status())

            next_t += period
            time.sleep(max(0.0, next_t - time.monotonic()))

    def status(self):
        return {
            "t": "status",
            "rate": round(self.rate_hz, 1),
            "tared": self.tared,
            "calibrated": self.calibrated,
            "cpk": self.counts_per_kg,
            "uptime": self.millis(),
            "mock": True,
            "scenario": self.cell.scenario,
        }

    def broadcast(self, msg):
        data = json.dumps(msg, separators=(",", ":")).encode()
        with self.clients_lock:
            clients = list(self.clients)
        for c in clients:
            c.send_text(data)

    def handle_command(self, msg):
        cmd = msg.get("cmd")
        if cmd == "tare":
            self.tare_avg.reset(TARE_SAMPLES)
        elif cmd == "calibrate":
            self.cal_kg = float(msg.get("kg") or 0)
            self.cal_avg.reset(CALIBRATION_SAMPLES)
        elif cmd == "calReset":
            self.counts_per_kg = DEFAULT_COUNTS_PER_KG
            self.calibrated = False
            self.save_state()
            self.broadcast({"t": "calibrated", "calibrated": False, "cpk": self.counts_per_kg})
        elif cmd == "mock":  # simulator only: switch what is hanging on the cell
            self.cell.set_scenario(msg.get("scenario", "workout"), msg.get("kg"))
            self.broadcast(self.status())


class WebSocketConnection:
    def __init__(self, rfile, wfile):
        self.rfile, self.wfile = rfile, wfile
        self.write_lock = threading.Lock()
        self.alive = True

    def send_text(self, payload: bytes):
        header = bytearray([0x81])
        n = len(payload)
        if n < 126:
            header.append(n)
        elif n < 65536:
            header.append(126)
            header += struct.pack(">H", n)
        else:
            header.append(127)
            header += struct.pack(">Q", n)
        try:
            with self.write_lock:
                self.wfile.write(bytes(header) + payload)
                self.wfile.flush()
        except OSError:
            self.alive = False

    def recv(self):
        """Returns (opcode, payload) or None when the connection closes."""
        head = self.rfile.read(2)
        if len(head) < 2:
            return None
        opcode, n = head[0] & 0x0F, head[1] & 0x7F
        if n == 126:
            n = struct.unpack(">H", self.rfile.read(2))[0]
        elif n == 127:
            n = struct.unpack(">Q", self.rfile.read(8))[0]
        mask = self.rfile.read(4) if head[1] & 0x80 else b"\0\0\0\0"
        data = bytes(b ^ mask[i % 4] for i, b in enumerate(self.rfile.read(n)))
        return opcode, data


def make_handler(device):
    class Handler(SimpleHTTPRequestHandler):
        protocol_version = "HTTP/1.1"  # required for the WebSocket upgrade

        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=DATA_DIR, **kwargs)

        def log_message(self, fmt, *args):
            pass

        def end_headers(self):
            self.send_header("Cache-Control", "no-store")
            super().end_headers()

        def do_GET(self):
            if self.path == "/ws" and self.headers.get("Upgrade", "").lower() == "websocket":
                return self.serve_websocket()
            if self.path == "/api/settings":
                return self.send_json(200, device.settings)
            name = self.path.removeprefix("/api/")
            if name in JSON_LISTS:
                return self.send_json(200, device.lists[name])
            if self.path == "/api/sessions":
                return self.send_body(200, device.sessions.index().encode(), "application/x-ndjson")
            if self.path.startswith("/api/sessions/"):
                return self.send_json(*device.sessions.get(self.path.removeprefix("/api/sessions/")))
            if self.path == "/api/storage":
                return self.send_json(200, {"totalBytes": FS_TOTAL_BYTES, "usedBytes": device.sessions.used_bytes()})
            return super().do_GET()

        def do_POST(self):
            if self.path != "/api/sessions":
                return self.send_json(404, {"error": "not found"})
            length = int(self.headers.get("Content-Length", 0))
            if length > MAX_SESSION_BYTES:
                self.rfile.read(length)
                return self.send_json(413, {"error": "too large"})
            try:
                body = json.loads(self.rfile.read(length))
            except ValueError:
                return self.send_json(400, {"error": "invalid JSON"})
            return self.send_json(*device.sessions.save(body))

        def do_DELETE(self):
            if not self.path.startswith("/api/sessions/"):
                return self.send_json(404, {"error": "not found"})
            status, body = device.sessions.delete(self.path.removeprefix("/api/sessions/"))
            if body is None:
                return self.send_body(status, b"", "text/plain")
            return self.send_json(status, body)

        def do_PUT(self):
            length = int(self.headers.get("Content-Length", 0))
            name = self.path.removeprefix("/api/")
            if name in JSON_LISTS and length > JSON_LISTS[name][1]:
                return self.send_json(413, {"error": "too large"})
            try:
                body = json.loads(self.rfile.read(length))
            except ValueError:
                return self.send_json(400, {"error": "invalid JSON"})
            if self.path == "/api/settings":
                error = device.update_settings(body) if isinstance(body, dict) else "expected an object"
                result = device.settings
            elif name in JSON_LISTS:
                error = device.replace_list(name, body)
                result = device.lists[name]
            else:
                return self.send_json(404, {"error": "not found"})
            if error:
                return self.send_json(400, {"error": error})
            return self.send_json(200, result)

        def send_json(self, code, obj):
            self.send_body(code, json.dumps(obj).encode(), "application/json")

        def send_body(self, code, data, content_type):
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            if code != 204:
                self.wfile.write(data)

        def serve_websocket(self):
            key = self.headers["Sec-WebSocket-Key"]
            accept = base64.b64encode(hashlib.sha1((key + WS_GUID).encode()).digest()).decode()
            self.send_response_only(101, "Switching Protocols")
            self.send_header("Upgrade", "websocket")
            self.send_header("Connection", "Upgrade")
            self.send_header("Sec-WebSocket-Accept", accept)
            super().end_headers()
            self.wfile.flush()

            ws = WebSocketConnection(self.rfile, self.wfile)
            with device.clients_lock:
                device.clients.add(ws)
            ws.send_text(json.dumps(device.status(), separators=(",", ":")).encode())
            print(f"client connected: {self.client_address[0]}")
            try:
                while ws.alive:
                    frame = ws.recv()
                    if frame is None or frame[0] == 0x8:
                        break
                    if frame[0] == 0x1:
                        try:
                            device.handle_command(json.loads(frame[1]))
                        except json.JSONDecodeError:
                            pass
            except OSError:
                pass
            finally:
                with device.clients_lock:
                    device.clients.discard(ws)
                self.close_connection = True
                print(f"client disconnected: {self.client_address[0]}")

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--host", default="0.0.0.0")
    args = parser.parse_args()

    device = Device()
    threading.Thread(target=device.run, daemon=True).start()
    server = ThreadingHTTPServer((args.host, args.port), make_handler(device))
    server.daemon_threads = True
    print(f"Mock Tindek on http://localhost:{args.port}  (serving {os.path.normpath(DATA_DIR)})")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
