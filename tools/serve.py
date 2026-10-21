#!/usr/bin/env python3
"""Development server for the app: serves data/ and /buildinfo.js (git version, variant "dev").

The app uses its simulated sensor in the browser and stores its data in IndexedDB, so
this only serves files. Standard library only. Run:  python3 tools/serve.py [--port 8080]
then open http://localhost:8080 (or http://<laptop-ip>:8080 from the phone).
"""
import argparse
import json
import os
import subprocess
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
DATA_DIR = os.path.join(ROOT, "data")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fwversion import firmware_version  # noqa: E402  (the firmware that belongs to this app)


def git_version():
    """Short git SHA (with -dirty), shown as the app version under Settings → About."""
    try:
        out = subprocess.run(["git", "describe", "--always", "--dirty"], cwd=ROOT, capture_output=True, text=True)
        return out.stdout.strip() or "unknown"
    except OSError:
        return "unknown"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DATA_DIR, **kwargs)

    def log_message(self, fmt, *args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.path.split("?")[0] == "/buildinfo.js":
            info = json.dumps({"version": git_version(), "variant": "dev", "firmware": firmware_version()})
            data = f"window.ERKDEK_BUILD = {info};\n".encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/javascript")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        super().do_GET()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--host", default="0.0.0.0")
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.daemon_threads = True
    print(f"Erkdek dev server on http://localhost:{args.port}  (serving {DATA_DIR})")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
