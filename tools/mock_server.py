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

# The simulated cell is ~12 % off from the firmware's default factor, so calibration matters.
DEFAULT_COUNTS_PER_KG = 14300.0
TRUE_COUNTS_PER_KG = 16000.0
RAW_ZERO = 52000  # raw reading with no load
NOISE_COUNTS = 900  # ~0.06 kg

STATE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".mock_state.json")


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
        except (OSError, ValueError, KeyError):
            pass

    def save_state(self):
        with open(STATE_FILE, "w") as f:
            json.dump({"counts_per_kg": self.counts_per_kg, "calibrated": self.calibrated}, f)

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
        batch, batch_ts = [], 0
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

            if not batch:
                batch_ts = self.millis()
            batch.append(round(self.to_kg(raw), 3))
            if len(batch) >= per_push:
                self.broadcast({"t": "samples", "ts": batch_ts, "kg": batch})
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
            return super().do_GET()

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
