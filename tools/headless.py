#!/usr/bin/env python3
"""Headless-Chrome check of the app: runs steps against a page and prints values or takes
screenshots. Used to check UI changes without a phone (with the simulated sensor).

Run (with tools/serve.py running, e.g. --port 8765):
    python3 tools/headless.py http://localhost:8765/ <screenshot dir> <dark 0|1> < steps.json

steps.json is a list of steps, each with any of:
    {"wait": 1.5}                      wait (seconds) before the rest of the step
    {"js": "expr", "print": "label"}   evaluate JS in the page; print its value
    {"shot": "name"}                   screenshot to <dir>/name.png (390x760 phone)
    {"file": ["#input", "/path"]}      set a file input
    {"cdp": "Method", "params": {}}    raw DevTools call
Gotchas: each step is a separate evaluation, so a "const" declared in one step errors in
the next (use window.x); promises aren't awaited (store the result on window and read it
in a later step). Every run starts with a fresh browser profile (empty app data).
Needs google-chrome and the "websockets" Python package.
"""
import asyncio, base64, json, socket, subprocess, sys, time, urllib.request, websockets, tempfile

url, outdir, dark = sys.argv[1], sys.argv[2], sys.argv[3] == "1"
steps = json.load(sys.stdin)

def free_port():
    # A port of its own, so checks running in parallel (several agents) don't share a Chrome.
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]

async def main():
    port = free_port()
    prof = tempfile.mkdtemp()
    chrome = subprocess.Popen(["google-chrome", "--headless=new", "--disable-gpu", "--no-sandbox",
        f"--remote-debugging-port={port}", f"--user-data-dir={prof}", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            try:
                targets = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json")); break
            except OSError: time.sleep(0.2)
        page = [t for t in targets if t["type"] == "page"][0]
        async with websockets.connect(page["webSocketDebuggerUrl"], max_size=None) as ws:
            n = 0
            async def call(method, **params):
                nonlocal n; n += 1; my = n
                await ws.send(json.dumps({"id": my, "method": method, "params": params}))
                while True:
                    m = json.loads(await ws.recv())
                    if m.get("method") == "Runtime.exceptionThrown":
                        print("JS EXCEPTION:", m["params"]["exceptionDetails"].get("exception", {}).get("description"))
                    if m.get("method") == "Runtime.consoleAPICalled" and m["params"]["type"] == "error":
                        print("CONSOLE ERROR:", m["params"]["args"])
                    if m.get("id") == my: return m.get("result", {})
            await call("Runtime.enable")
            await call("Emulation.setDeviceMetricsOverride", width=390, height=760, deviceScaleFactor=1, mobile=True)
            await call("Emulation.setEmulatedMedia", features=[{"name": "prefers-color-scheme", "value": "dark" if dark else "light"}])
            await call("Page.navigate", url=url)
            for step in steps:
                if "wait" in step: 
                    t0=time.time()
                    while time.time()-t0 < step["wait"]:
                        await call("Runtime.evaluate", expression="1")
                        await asyncio.sleep(0.1)
                if "cdp" in step:
                    r = await call(step["cdp"], **step.get("params", {}))
                if "file" in step:  # [selector, path]: set a file input
                    doc = await call("DOM.getDocument")
                    node = await call("DOM.querySelector", nodeId=doc["root"]["nodeId"], selector=step["file"][0])
                    await call("DOM.setFileInputFiles", nodeId=node["nodeId"], files=[step["file"][1]])
                if "js" in step:
                    r = await call("Runtime.evaluate", expression=step["js"], returnByValue=True)
                    if "print" in step: print(step["print"], r.get("result", {}).get("value"))
                if "shot" in step:
                    r = await call("Page.captureScreenshot", format="png")
                    open(f"{outdir}/{step['shot']}.png", "wb").write(base64.b64decode(r["data"]))
    finally:
        chrome.kill()

asyncio.run(main())
