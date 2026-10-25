#!/usr/bin/env python3
"""Probe a Tindeq Progressor over Bluetooth LE (checks the protocol used by
data/tindeqtransport.js; findings are in PLAN.md, "Tindeq protocol").

Needs bleak (pip install bleak). Run from a computer with Bluetooth:

    python tools/tindeq_probe.py                  # services, version, battery, id
    python tools/tindeq_probe.py --seconds 6 --tare-at 2 --battery-at 4 --raw raw.txt

Streams weight for --seconds, optionally tares / asks for the battery while
streaming (each stops the measurement, so it is started again right after, as the
app does), prints the measured sample rate and per-notification statistics, and
writes every notification as hex (one per line, "<host time s> <hex>") to --raw.

Only harmless commands are sent: never 0x6E (sleep/off) or the calibration ones
(0x69, 0x6A).
"""

import argparse
import asyncio
import struct
import time

from bleak import BleakClient, BleakScanner

SERVICE = "7e4e1701-1ea6-40c9-9dcc-13d34ffead57"
DATA = "7e4e1702-1ea6-40c9-9dcc-13d34ffead57"
CONTROL = "7e4e1703-1ea6-40c9-9dcc-13d34ffead57"

# As verified on firmware 2.0.4 (some older write-ups swap 0x6B/0x6F/0x70).
TARE, START, STOP = 0x64, 0x65, 0x66
VERSION, ERROR_INFO, BATTERY, DEVICE_ID = 0x6B, 0x6C, 0x6F, 0x70
RES_CMD, RES_WEIGHT, RES_LOW_POWER = 0x00, 0x01, 0x04


async def find(name_prefix, timeout):
    found = await BleakScanner.discover(timeout=timeout, return_adv=True)
    for dev, adv in found.values():
        name = adv.local_name or dev.name or ""
        if name.startswith(name_prefix) or SERVICE in adv.service_uuids:
            return dev, name
    raise SystemExit("No Progressor found (is it switched on?)")


def decode_weights(payload):
    """(kg float32 LE, µs uint32 LE) pairs."""
    return [struct.unpack_from("<fI", payload, i) for i in range(0, len(payload) - 7, 8)]


class Probe:
    def __init__(self, client):
        self.client = client
        self.packets = []  # (host time, bytes)
        self.responses = asyncio.Queue()

    def on_data(self, _, data):
        data = bytes(data)
        self.packets.append((time.monotonic(), data))
        if data[0] != RES_WEIGHT:
            self.responses.put_nowait(data)

    async def command(self, code, wait=True):
        await self.client.write_gatt_char(CONTROL, bytes([code]), response=True)
        if wait:
            try:
                return await asyncio.wait_for(self.responses.get(), 2)
            except asyncio.TimeoutError:
                return None


def describe_response(code, data):
    if data is None:
        return "no response"
    payload = data[2:2 + data[1]]
    text = f"{data.hex()} (code {data[0]}, len {data[1]})"
    if code == BATTERY and len(payload) == 4:
        text += f" -> battery {struct.unpack('<I', payload)[0]} mV"
    elif code == VERSION:
        text += f" -> {payload.decode(errors='replace')!r}"
    elif code == DEVICE_ID:
        text += f" -> id {payload[::-1].hex(':')} (the Bluetooth address)"
    return text


async def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--name", default="Progressor", help="advertised name prefix")
    ap.add_argument("--seconds", type=float, default=0, help="stream weight this long")
    ap.add_argument("--tare-at", type=float, help="send tare after this many seconds of streaming")
    ap.add_argument("--battery-at", type=float, help="ask for the battery while streaming")
    ap.add_argument("--raw", help="write all notifications (hex) to this file")
    args = ap.parse_args()

    dev, name = await find(args.name, 10)
    print(f"Found {name} at {dev.address}")
    async with BleakClient(dev) as client:
        for service in client.services:
            print(f"service {service.uuid} {service.description}")
            for ch in service.characteristics:
                print(f"  char {ch.uuid} [{','.join(ch.properties)}] handle {ch.handle}")
        print(f"MTU {client.mtu_size}")
        probe = Probe(client)
        await client.start_notify(DATA, probe.on_data)
        for code in (VERSION, BATTERY, DEVICE_ID, ERROR_INFO):
            print(f"command 0x{code:02x}: {describe_response(code, await probe.command(code))}")

        if args.seconds:
            probe.packets.clear()
            await probe.command(START, wait=False)
            t0 = time.monotonic()
            events = sorted(
                [(args.tare_at, "tare"), (args.battery_at, "battery")],
                key=lambda e: e[0] if e[0] is not None else 1e9,
            )
            for at, what in events:
                if at is None:
                    continue
                await asyncio.sleep(max(0, t0 + at - time.monotonic()))
                # Either command stops the measurement: start it again.
                if what == "tare":
                    await probe.command(TARE, wait=False)
                    print(f"tare sent at {time.monotonic() - t0:.2f} s")
                else:
                    reply = await probe.command(BATTERY)
                    print(f"battery while streaming: {describe_response(BATTERY, reply)}")
                await probe.command(START, wait=False)
            await asyncio.sleep(max(0, t0 + args.seconds - time.monotonic()))
            await probe.command(STOP, wait=False)
            await asyncio.sleep(0.5)
            report(probe.packets, t0)
            if args.raw:
                with open(args.raw, "w") as f:
                    for t, data in probe.packets:
                        f.write(f"{t - t0:.4f} {data.hex()}\n")
                print(f"wrote {len(probe.packets)} notifications to {args.raw}")
        await client.stop_notify(DATA)


def report(packets, t0):
    weights = [(t, d) for t, d in packets if d[0] == RES_WEIGHT]
    others = [(t, d) for t, d in packets if d[0] != RES_WEIGHT]
    samples = []
    sizes = {}
    for t, d in weights:
        pairs = decode_weights(d[2:2 + d[1]])
        sizes[len(pairs)] = sizes.get(len(pairs), 0) + 1
        samples += pairs
    print(f"{len(weights)} weight notifications, samples per notification: {sizes}")
    for t, d in others:
        print(f"other notification at {t - t0:.2f} s: {d.hex()}")
    if len(samples) < 2:
        return
    ts = [us for _, us in samples]
    steps = [b - a for a, b in zip(ts, ts[1:])]
    # Timestamps start again at each start command: rate over the increasing runs only.
    runs = sum(1 for s in steps if s <= 0)
    span = sum(s for s in steps if s > 0) / 1e6
    good = sorted(s for s in steps if s > 0)
    median = good[len(good) // 2]
    missing = sum(round(s / median) - 1 for s in good if s > 1.5 * median)
    print(f"{len(samples)} samples over {span:.2f} s (device clock, {runs} restarts) = {(len(samples) - 1 - runs) / span:.1f} Hz")
    print(f"sample period {median} µs ({1e6 / median:.1f} Hz), {missing} samples skipped")
    print(f"timestamps µs: first {ts[0]} last {ts[-1]}")
    kg = [w for w, _ in samples]
    print(f"weight kg: min {min(kg):.3f} max {max(kg):.3f} first {kg[0]:.3f} last {kg[-1]:.3f}")
    host = (weights[-1][0] - weights[0][0]) / max(1, len(weights) - 1)
    print(f"notification interval (host): {host * 1000:.1f} ms")


if __name__ == "__main__":
    asyncio.run(main())
