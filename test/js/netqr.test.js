import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Node 18 has no CustomEvent (browsers and Node 19+ do).
globalThis.CustomEvent ??= class extends Event {
  constructor(type, init) {
    super(type, init);
    this.detail = init?.detail;
  }
};

import { QrLink, checkCode, decodeSignal, encodeSignal, expandSdp, hostOffline, joinOffline } from "../../data/netqr.js";

const SDP = JSON.parse(readFileSync(new URL("./fixtures/netqr-sdp.json", import.meta.url), "utf8"));
const attr = (sdp, key) => sdp.match(new RegExp(`^a=${key}:(.+?)\\r?$`, "m"))?.[1];
const hostCandidates = (sdp) =>
  [...sdp.matchAll(/^a=candidate:\S+ 1 udp \d+ (\S+) (\d+) typ host/gm)].map((m) => `${m[1]} ${m[2]}`);

test("codes from real Chrome SDP are short and expand to the same connection details", () => {
  for (const sample of ["mdns", "ip"]) {
    for (const kind of ["offer", "answer"]) {
      const sdp = SDP[sample][kind];
      const code = encodeSignal(sdp, kind);
      assert.match(code, /^ERK1[A-Za-z0-9_-]+$/);
      assert.ok(code.length <= 110, `${sample} ${kind}: ${code.length} chars`);
      const sig = decodeSignal(code);
      assert.equal(sig.kind, kind);
      const full = expandSdp(sig);
      for (const key of ["ice-ufrag", "ice-pwd", "fingerprint"]) assert.equal(attr(full, key), attr(sdp, key), key);
      assert.equal(attr(full, "setup"), attr(sdp, "setup"));
      assert.deepEqual(hostCandidates(full), hostCandidates(sdp));
      assert.equal(encodeSignal(full, kind), code); // stable round trip
    }
  }
});

test("only UDP host candidates are carried, IPv4 first, IPv6 kept", () => {
  const sig = decodeSignal(encodeSignal(SDP.multi.offer, "offer"));
  assert.deepEqual(
    sig.candidates.map((c) => `${c.address} ${c.port}`),
    ["192.168.0.8 38819", "10.0.0.12 41234", "2001:db8:85a3:0:0:8a2e:370:7334 50001"],
  );
});

test("bad input is rejected with a plain message", () => {
  const code = encodeSignal(SDP.ip.offer, "offer");
  assert.throws(() => decodeSignal("https://example.com"), /isn't an Erkdek code/);
  assert.throws(() => decodeSignal(""), /isn't an Erkdek code/);
  assert.throws(() => decodeSignal("ERK2" + code.slice(4)), /different Erkdek version/);
  assert.throws(() => decodeSignal(code.slice(0, -6)), /damaged/);
  assert.throws(() => decodeSignal(code + "AAAA"), /damaged/);
  assert.throws(() => decodeSignal(code.slice(0, 20) + "!" + code.slice(21)), /damaged/);
  assert.equal(checkCode(code, "offer"), "");
  assert.match(checkCode(code, "answer"), /your own code/);
  assert.match(checkCode(encodeSignal(SDP.ip.answer, "answer"), "offer"), /reply code/);
  assert.throws(() => encodeSignal(SDP.ip.offer.replace(/^a=candidate.*\r\n/gm, ""), "offer"), /No Wi-Fi/);
});

// --- Fakes: a data channel pair and a peer connection that hands out canned SDP ---------

class FakeChannel extends EventTarget {
  readyState = "connecting";
  other = null;
  send(text) {
    if (this.readyState !== "open") throw new Error("not open");
    const other = this.other;
    queueMicrotask(() => other.readyState === "open" && other.dispatchEvent(Object.assign(new Event("message"), { data: text })));
  }
  close() {
    if (this.readyState === "closed") return;
    this.readyState = "closed";
    this.dispatchEvent(new Event("close"));
    this.other?.close();
  }
}

function openPair(a, b) {
  a.other = b;
  b.other = a;
  a.readyState = b.readyState = "open";
  a.dispatchEvent(new Event("open"));
  b.dispatchEvent(new Event("open"));
}

class FakePC extends EventTarget {
  static made = [];
  iceGatheringState = "complete";
  connectionState = "new";
  constructor(config) {
    super();
    assert.deepEqual(config.iceServers, []);
    FakePC.made.push(this);
  }
  createDataChannel(label, opts) {
    assert.equal(opts.negotiated, true);
    return (this.channel = new FakeChannel());
  }
  async createOffer() {
    return { type: "offer", sdp: SDP.mdns.offer };
  }
  async createAnswer() {
    return { type: "answer", sdp: SDP.mdns.answer };
  }
  async setLocalDescription(d) {
    this.localDescription = d;
  }
  async setRemoteDescription(d) {
    this.remoteDescription = d;
  }
  setState(s) {
    this.connectionState = s;
    this.dispatchEvent(new Event("connectionstatechange"));
  }
  close() {
    this.closed = true;
  }
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const record = (link) => {
  const log = [];
  for (const e of ["open", "message", "close", "status", "error"]) link.addEventListener(e, (ev) => log.push([e, ev.detail ?? null]));
  return log;
};

async function connectedPair(opts = {}) {
  const host = await hostOffline({ name: "Ann", RTCPeerConnection: FakePC, ...opts });
  const guest = await joinOffline(host.offer, { name: "Bo", RTCPeerConnection: FakePC, ...opts });
  await host.acceptAnswer(guest.answer);
  const [a, b] = [host.link, guest.link];
  const logs = [record(a), record(b)];
  openPair(a.channel, b.channel);
  await tick();
  return { host, guest, a, b, logs };
}

test("host and guest exchange codes, say hello, then talk both ways", async () => {
  const { host, guest, a, b, logs } = await connectedPair();
  assert.match(host.offer, /^ERK1/);
  assert.equal(decodeSignal(guest.answer).kind, "answer");
  assert.match(a.pc.remoteDescription.sdp, /a=setup:active/);
  assert.match(b.pc.remoteDescription.sdp, /a=setup:actpass/);
  assert.equal(a.open && b.open, true);
  assert.equal(a.peerName, "Bo");
  assert.equal(a.role, "host");
  assert.equal(b.role, "guest");
  assert.equal(a.code, null);
  assert.equal(b.peerName, "Ann");
  assert.deepEqual(logs[0].slice(0, 2), [["status", "open"], ["open", { peerName: "Bo" }]]);
  assert.equal(a.send({ move: 3 }), true);
  b.send({ score: [1, 2] });
  await tick();
  assert.deepEqual(logs[1].at(-1), ["message", { move: 3 }]);
  assert.deepEqual(logs[0].at(-1), ["message", { score: [1, 2] }]);
  assert.equal(typeof (await a.ping()), "number");
  b.close();
  await tick();
  assert.equal(a.open, false);
  assert.deepEqual(logs[0].slice(-2), [["status", "closed"], ["close", null]]); // leaving isn't an error
  assert.equal(a.send({ late: true }), false);
  await assert.rejects(a.ping(), /Not connected/);
});

test("acceptAnswer refuses the wrong code and keeps waiting", async () => {
  const host = await hostOffline({ name: "Ann", RTCPeerConnection: FakePC });
  assert.equal(host.link.status, "waiting");
  await assert.rejects(host.acceptAnswer(host.offer), /your own code/);
  await assert.rejects(host.acceptAnswer("hello"), /isn't an Erkdek code/);
  assert.equal(host.link.status, "waiting");
  await assert.rejects(joinOffline("ERK9xyz", { RTCPeerConnection: FakePC }), /different Erkdek version/);
  await assert.rejects(hostOffline({ RTCPeerConnection: undefined }), /can't make direct connections/);
  host.link.close();
});

test("a silent peer, a failed connection or no connection at all ends in close", async () => {
  // Silence: keep-alive replies stop coming
  let { a, b, logs } = await connectedPair({ pingMs: 20, silentMs: 60, deadMs: 300 });
  b.channel.send = () => {}; // b goes quiet without closing
  await tick(150);
  assert.equal(a.status, "reconnecting");
  assert.equal(a.open, false);
  await tick(1000);
  assert.equal(a.status, "closed");
  assert.deepEqual(logs[0].slice(-3), [["error", "The connection was lost."], ["status", "closed"], ["close", null]]);
  b.close();

  // ICE reports a temporary loss, then gives up
  ({ a, b, logs } = await connectedPair());
  a.pc.setState("disconnected");
  assert.equal(a.status, "reconnecting");
  a.pc.setState("connected");
  assert.equal(a.status, "open");
  a.pc.setState("failed");
  assert.equal(a.status, "closed");
  assert.deepEqual(logs[0].slice(-3), [["error", "The connection was lost."], ["status", "closed"], ["close", null]]);
  b.close();

  // The phones never find each other
  const host = await hostOffline({ name: "Ann", RTCPeerConnection: FakePC, connectMs: 50 });
  const guest = await joinOffline(host.offer, { name: "Bo", RTCPeerConnection: FakePC });
  await host.acceptAnswer(guest.answer);
  assert.equal(host.link.status, "connecting");
  await tick(1100);
  assert.equal(host.link.status, "closed");
  assert.match(host.link.error, /same Wi-Fi/);
  guest.link.close();
});

test("messages that aren't JSON or arrive before hello are ignored", async () => {
  const pc = new FakePC({ iceServers: [] });
  const link = new QrLink(pc, pc.createDataChannel("x", { negotiated: true }), { role: "host", name: "A" });
  const log = record(link);
  const peer = new FakeChannel();
  openPair(link.channel, peer);
  peer.send("not json");
  peer.send(JSON.stringify({ t: "msg", d: 1 }));
  peer.send(JSON.stringify({ t: "hello", name: "B".repeat(100) }));
  await tick();
  assert.deepEqual(log.map((e) => e[0]), ["status", "open"]);
  assert.equal(link.peerName.length, 40);
  link.close();
});
