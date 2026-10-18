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
NOISE_KG = 0.06


class SimulatedLoadCell:
    """Generates a force signal: rest, ramp up, hold with tremor and fatigue, release."""

    def __init__(self):
        self.lock = threading.Lock()
        self.offset_kg = 1.4  # untared offset, like a real cell with a sling hanging on it
        self.drift_kg = 0.0
        self.t = 0.0
        self._next_phase(start=0.0)

    def _next_phase(self, start):
        self.phase_start = start
        self.rest_s = random.uniform(3.0, 6.0)
        self.hold_s = random.uniform(4.0, 8.0)
        self.target_kg = random.uniform(15.0, 40.0)
        self.spike = random.random() < 0.25  # occasional explosive pull

    def _force(self, t):
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

    def next_sample(self):
        """Returns the next raw reading in kg (before tare)."""
        with self.lock:
            self.t += 1.0 / SAMPLE_RATE_HZ
            self.drift_kg += random.gauss(0, 0.0005)
            return self._force(self.t) + self.offset_kg + self.drift_kg + random.gauss(0, NOISE_KG)


class Device:
    """Stands in for the firmware's sensor task: tare state and sample distribution."""

    def __init__(self):
        self.cell = SimulatedLoadCell()
        self.tare_kg = 0.0
        self.tared = False
        self.tare_pending = []  # samples collected for an ongoing tare
        self.tare_requested = False
        self.clients = set()
        self.clients_lock = threading.Lock()
        self.boot = time.monotonic()
        self.rate_hz = 0.0
        self.request_tare()  # firmware auto-tares on boot

    def millis(self):
        return int((time.monotonic() - self.boot) * 1000)

    def request_tare(self):
        self.tare_pending = []
        self.tare_requested = True

    def run(self):
        period = 1.0 / SAMPLE_RATE_HZ
        per_push = SAMPLE_RATE_HZ // PUSH_RATE_HZ
        batch, batch_ts = [], 0
        next_t = time.monotonic()
        rate_count, rate_start = 0, time.monotonic()
        last_status = 0.0
        while True:
            raw = self.cell.next_sample()
            if self.tare_requested:
                self.tare_pending.append(raw)
                if len(self.tare_pending) >= 40:  # 0.5 s average, same as firmware
                    self.tare_kg = sum(self.tare_pending) / len(self.tare_pending)
                    self.tared = True
                    self.tare_requested = False
            if not batch:
                batch_ts = self.millis()
            batch.append(round(raw - self.tare_kg, 3))
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
            "calibrated": True,
            "uptime": self.millis(),
            "mock": True,
        }

    def broadcast(self, msg):
        data = json.dumps(msg, separators=(",", ":")).encode()
        with self.clients_lock:
            clients = list(self.clients)
        for c in clients:
            c.send_text(data)

    def handle_command(self, msg):
        if msg.get("cmd") == "tare":
            self.request_tare()


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
