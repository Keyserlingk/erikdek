// Two phones on the same Wi-Fi, no internet and no server: a WebRTC data channel whose
// offer and answer travel as QR codes (one each way). No STUN/TURN, so only host (LAN)
// candidates; non-trickle, so each side's whole description fits in one code.
//
//   host:  const { offer, link, acceptAnswer } = await hostOffline({ name });
//          show qrElement(offer); scan the guest's code; await acceptAnswer(text)
//   guest: const { answer, link } = await joinOffline(scannedOffer, { name });
//          show qrElement(answer)
// `link` has the same interface as the online one (see the top of net.js): events open,
// message, close, status, error; send(obj) -> boolean, ping(), close(); properties open,
// status, peerName, role ("host" | "guest") and code (always null here).

// "ERK" + format version. A code without it is someone else's QR; a different version is
// another Erkdek build.
const PREFIX = "ERK";
const VERSION = "1";
const KIND = { offer: 1, answer: 2 };
const GATHER_MS = 3000; // host candidates come within ms; mDNS names can take a moment
const CONNECT_MS = 20000; // host: from scanning the answer to connected
const GUEST_WAIT_MS = 180000; // guest: includes the host finding and scanning our code
const PING_MS = 2000; // keep-alive sent when nothing else went out for this long
const SILENT_MS = 6000; // nothing heard for this long: "reconnecting"
const DEAD_MS = 15000; // ... and for this long: gone for good
const PING_TIMEOUT_MS = 5000;
const NOT_REACHED = "Couldn't reach the other phone. Are both on the same Wi-Fi?";
const MAX_CANDIDATES = 8;
const ICE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// --- Compact codes ---------------------------------------------------------------------
// Only what differs between connections goes into the code: ICE ufrag/pwd, the DTLS
// fingerprint and the UDP host candidates. The rest of the SDP is the same every time
// (one data channel, negotiated id 0) and is rebuilt by expandSdp.
// Binary: kind, ufrag, pwd (length + 6-bit packed), 32-byte sha-256 fingerprint,
// candidate count, then per candidate: 4 (IPv4) | 6 (IPv6) | 0x6d (mDNS uuid), address, port.

const ADDR_V4 = 4, ADDR_V6 = 6, ADDR_MDNS = 0x6d;

function parseSdp(sdp) {
  const get = (key) => sdp.match(new RegExp(`^a=${key}:(.+?)\\s*$`, "m"))?.[1];
  const ufrag = get("ice-ufrag"), pwd = get("ice-pwd"), fp = get("fingerprint");
  if (!ufrag || !pwd || !fp) throw new Error("Connection details are incomplete.");
  const [algo, hex] = fp.split(" ");
  if (algo.toLowerCase() !== "sha-256") throw new Error("This device's connection type isn't supported.");
  const candidates = [];
  for (const [, line] of sdp.matchAll(/^a=candidate:(.+?)\s*$/gm)) {
    const f = line.split(" "); // foundation component transport priority address port typ type ...
    if (f[1] !== "1" || f[2].toLowerCase() !== "udp" || f[7] !== "host") continue;
    const addr = addressBytes(f[4]);
    if (addr) candidates.push({ addr, port: Number(f[5]) });
  }
  // IPv4 first: the usual way two phones on one Wi-Fi reach each other
  candidates.sort((a, b) => (a.addr[0] === ADDR_V4 ? 0 : 1) - (b.addr[0] === ADDR_V4 ? 0 : 1));
  return { ufrag, pwd, fingerprint: hex.split(":").map((h) => parseInt(h, 16)), candidates: candidates.slice(0, MAX_CANDIDATES) };
}

// [tag, ...bytes] for an address, or null for ones we can't carry (zone ids, hostnames)
function addressBytes(text) {
  let m = text.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) return [ADDR_V4, ...m.slice(1).map(Number)];
  m = text.match(/^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\.local$/i);
  if (m) return [ADDR_MDNS, ...hexBytes(m.slice(1).join(""))];
  if (/^[0-9a-f:]+$/i.test(text) && text.includes(":")) {
    const [head, tail] = text.split("::");
    const h = head ? head.split(":") : [], t = tail ? tail.split(":") : [];
    const groups = tail === undefined ? h : [...h, ...Array(8 - h.length - t.length).fill("0"), ...t];
    if (groups.length !== 8) return null;
    return [ADDR_V6, ...groups.flatMap((g) => [parseInt(g, 16) >> 8, parseInt(g, 16) & 255])];
  }
  return null;
}

function addressText(tag, b) {
  if (tag === ADDR_V4) return b.join(".");
  const hex = b.map((x) => x.toString(16).padStart(2, "0")).join("");
  if (tag === ADDR_MDNS) return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}.local`;
  return hex.match(/.{4}/g).map((g) => g.replace(/^0+(?=.)/, "")).join(":");
}

const hexBytes = (hex) => hex.match(/../g).map((h) => parseInt(h, 16));

function packIce(s) {
  const bits = [...s].map((c) => {
    const v = ICE_CHARS.indexOf(c);
    if (v < 0) throw new Error("Connection details are incomplete.");
    return v.toString(2).padStart(6, "0");
  }).join("");
  return [s.length, ...(bits.padEnd(Math.ceil(bits.length / 8) * 8, "0").match(/.{8}/g) || []).map((b) => parseInt(b, 2))];
}

function unpackIce(bytes, at) {
  const len = bytes[at], n = Math.ceil((len * 6) / 8);
  const bits = bytes.slice(at + 1, at + 1 + n).map((b) => b.toString(2).padStart(8, "0")).join("");
  if (n > bytes.length - at - 1) throw new Error("bad");
  let s = "";
  for (let i = 0; i < len; i++) s += ICE_CHARS[parseInt(bits.slice(i * 6, i * 6 + 6), 2)];
  return [s, at + 1 + n];
}

/** A local description as a short text for a QR code. kind: "offer" | "answer". */
export function encodeSignal(sdp, kind) {
  const p = parseSdp(sdp);
  if (!p.candidates.length) throw new Error("No Wi-Fi connection found. Turn on Wi-Fi and try again.");
  const bytes = [KIND[kind], ...packIce(p.ufrag), ...packIce(p.pwd), ...p.fingerprint, p.candidates.length];
  for (const c of p.candidates) bytes.push(...c.addr, c.port >> 8, c.port & 255);
  return PREFIX + VERSION + base64url(bytes);
}

/** Reads a code: { kind, ufrag, pwd, fingerprint, candidates: [{ address, port }] }.
 *  Throws an Error with a short message for anything that isn't a valid Erkdek code. */
export function decodeSignal(text) {
  text = String(text ?? "").trim();
  if (!text.startsWith(PREFIX)) throw new Error("This isn't an Erkdek code.");
  if (text[PREFIX.length] !== VERSION) throw new Error("This code is from a different Erkdek version. Update both phones.");
  try {
    const b = unbase64url(text.slice(PREFIX.length + 1));
    const kind = Object.keys(KIND).find((k) => KIND[k] === b[0]);
    let at = 1, ufrag, pwd;
    [ufrag, at] = unpackIce(b, at);
    [pwd, at] = unpackIce(b, at);
    const fingerprint = b.slice(at, at + 32);
    at += 32;
    const candidates = [];
    for (let n = b[at++]; n > 0; n--) {
      const tag = b[at], len = { [ADDR_V4]: 4, [ADDR_V6]: 16, [ADDR_MDNS]: 16 }[tag];
      if (!len) throw new Error("bad");
      candidates.push({ address: addressText(tag, b.slice(at + 1, at + 1 + len)), port: (b[at + 1 + len] << 8) | b[at + 2 + len] });
      at += 3 + len;
    }
    if (!kind || !ufrag || pwd.length < 22 || at !== b.length || !candidates.length || candidates.some((c) => !(c.port > 0))) throw new Error("bad");
    return { kind, ufrag, pwd, fingerprint, candidates };
  } catch {
    throw new Error("This code is damaged. Scan it again.");
  }
}

/** Full SDP from a decoded code (the fixed parts as Chrome writes them). */
export function expandSdp(sig) {
  const fp = sig.fingerprint.map((x) => x.toString(16).toUpperCase().padStart(2, "0")).join(":");
  return [
    "v=0",
    `o=- ${Date.now()} 2 IN IP4 127.0.0.1`,
    "s=-",
    "t=0 0",
    "a=group:BUNDLE 0",
    "a=msid-semantic: WMS",
    "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
    "c=IN IP4 0.0.0.0",
    ...sig.candidates.map((c, i) => `a=candidate:${i + 1} 1 udp ${2113937151 - i} ${c.address} ${c.port} typ host generation 0`),
    `a=ice-ufrag:${sig.ufrag}`,
    `a=ice-pwd:${sig.pwd}`,
    `a=fingerprint:sha-256 ${fp}`,
    `a=setup:${sig.kind === "offer" ? "actpass" : "active"}`,
    "a=mid:0",
    "a=sctp-port:5000",
    "a=max-message-size:262144",
    "",
  ].join("\r\n");
}

/** "" when text is a valid code of this kind, else a short message (for the scanner). */
export function checkCode(text, kind) {
  try {
    const sig = decodeSignal(text);
    if (sig.kind === kind) return "";
    return kind === "offer" ? "That's the other phone's reply code. Scan the code on the host's phone." : "That's your own code. Scan the code on the other phone.";
  } catch (e) {
    return e.message;
  }
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unbase64url(s) {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("bad");
  return [...atob(s.replace(/-/g, "+").replace(/_/g, "/"))].map((c) => c.charCodeAt(0));
}

// --- The connection --------------------------------------------------------------------

/** The shared link interface over one RTCPeerConnection + data channel. Exported for tests. */
export class QrLink extends EventTarget {
  constructor(pc, channel, { role, name, pingMs = PING_MS, silentMs = SILENT_MS, deadMs = DEAD_MS, connectMs = CONNECT_MS } = {}) {
    super();
    Object.assign(this, { pc, channel, role, name: String(name ?? "").slice(0, 40), pingMs, silentMs, deadMs, connectMs });
    this.code = null; // no game code: the QR codes are the handshake
    this.peerName = null;
    this.status = "waiting";
    this.error = "";
    this.everOpen = false;
    this.pings = new Map(); // id -> { t0, resolve, reject }
    this.lastHeard = this.lastSent = Date.now();
    channel.addEventListener("open", () => this.#raw({ t: "hello", name: this.name }));
    channel.addEventListener("message", (e) => this.#receive(e.data));
    channel.addEventListener("close", () => this.#fail("The connection was lost."));
    pc.addEventListener("connectionstatechange", () => {
      const s = pc.connectionState;
      if (s === "failed") this.#fail(this.everOpen ? "The connection was lost." : NOT_REACHED);
      else if (s === "disconnected" && this.open) this.#setStatus("reconnecting");
      else if (s === "connected" && this.status === "reconnecting") this.#setStatus("open");
    });
    this.timer = setInterval(() => this.#tick(), Math.min(pingMs / 2, 1000));
  }

  get open() {
    return this.status === "open";
  }

  /** The answer/offer is in; now waiting for the phones to find each other. */
  connecting(ms = this.connectMs) {
    if (this.status !== "waiting") return;
    this.connectBy = Date.now() + ms;
    this.#setStatus("connecting");
  }

  send(obj) {
    return this.open && this.#raw({ t: "msg", d: obj });
  }

  ping() {
    if (!this.open) return Promise.reject(new Error("Not connected"));
    const id = Math.random().toString(36).slice(2, 8);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.pings.delete(id) && reject(new Error("No answer")), PING_TIMEOUT_MS);
      this.pings.set(id, { t0: performance.now(), timer, resolve, reject });
      this.#raw({ t: "ping", id });
    });
  }

  close() {
    if (this.everOpen) this.#raw({ t: "bye" });
    this.#shutdown();
  }

  #raw(msg) {
    if (this.channel.readyState !== "open") return false;
    try {
      this.channel.send(JSON.stringify(msg));
      this.lastSent = Date.now();
      return true;
    } catch {
      return false;
    }
  }

  #receive(data) {
    let m;
    try {
      m = JSON.parse(data);
    } catch {
      return;
    }
    if (this.ended || !m || typeof m !== "object") return;
    this.lastHeard = Date.now();
    if (m.t === "hello") {
      this.peerName = String(m.name ?? "").slice(0, 40) || "Other player";
      this.#setStatus("open");
      if (!this.everOpen) {
        this.everOpen = true;
        this.dispatchEvent(new CustomEvent("open", { detail: { peerName: this.peerName } }));
      }
      return;
    }
    if (!this.everOpen) return;
    if (this.status === "reconnecting" && m.t !== "bye") this.#setStatus("open"); // heard again
    if (m.t === "msg") this.dispatchEvent(new CustomEvent("message", { detail: m.d }));
    else if (m.t === "ping") this.#raw({ t: "pong", id: m.id });
    else if (m.t === "pong") {
      const p = this.pings.get(m.id);
      if (p) this.pings.delete(m.id), clearTimeout(p.timer), p.resolve(Math.round(performance.now() - p.t0));
    } else if (m.t === "bye") this.#shutdown();
  }

  #tick() {
    const now = Date.now();
    if (this.status === "connecting" && now > this.connectBy) return this.#fail(NOT_REACHED);
    if (!this.everOpen) return;
    const quiet = now - this.lastHeard;
    if (quiet > this.deadMs) return this.#fail("The connection was lost.");
    if (quiet > this.silentMs && this.open) this.#setStatus("reconnecting");
    // keep-alive: Wi-Fi drops show up as silence, not as a close
    if (now - this.lastSent >= this.pingMs) this.#raw({ t: "ka" });
  }

  #setStatus(s) {
    if (this.status === s) return;
    this.status = s;
    this.dispatchEvent(new CustomEvent("status", { detail: s }));
  }

  #fail(text) {
    if (this.ended) return;
    this.error = text;
    this.dispatchEvent(new CustomEvent("error", { detail: text }));
    this.#shutdown();
  }

  #shutdown() {
    if (this.ended) return; // closing the channel below fires its "close" again
    this.ended = true;
    clearInterval(this.timer);
    for (const p of this.pings.values()) clearTimeout(p.timer), p.reject(new Error("Not connected"));
    this.pings.clear();
    this.#setStatus("closed");
    this.dispatchEvent(new Event("close"));
    // a moment for a "bye" to leave before the channel closes
    setTimeout(() => {
      try {
        this.channel.close();
        this.pc.close();
      } catch {}
    }, 300);
  }
}

function newPeer(RTC) {
  if (!RTC) throw new Error("This device can't make direct connections.");
  const pc = new RTC({ iceServers: [] });
  // negotiated: both sides open the same channel, no in-band announcement needed
  const channel = pc.createDataChannel("erkdek", { negotiated: true, id: 0, ordered: true });
  return { pc, channel };
}

// The local description once all candidates are in (or after GATHER_MS with what we have).
async function gathered(pc, ms) {
  if (pc.iceGatheringState !== "complete") {
    await new Promise((resolve) => {
      const done = () => pc.iceGatheringState === "complete" && resolve();
      pc.addEventListener("icegatheringstatechange", done);
      setTimeout(resolve, ms);
    });
  }
  return pc.localDescription.sdp;
}

/** Host side: { offer (text for the QR), link, acceptAnswer(text) }. */
export async function hostOffline({ name, gatherMs = GATHER_MS, RTCPeerConnection: RTC = globalThis.RTCPeerConnection, ...opts } = {}) {
  const { pc, channel } = newPeer(RTC);
  const link = new QrLink(pc, channel, { role: "host", name, ...opts });
  try {
    await pc.setLocalDescription(await pc.createOffer());
    const offer = encodeSignal(await gathered(pc, gatherMs), "offer");
    let accepted = false;
    async function acceptAnswer(text) {
      const err = checkCode(text, "answer");
      if (err) throw new Error(err);
      if (accepted) return;
      accepted = true;
      await pc.setRemoteDescription({ type: "answer", sdp: expandSdp(decodeSignal(text)) });
      link.connecting();
    }
    return { offer, link, acceptAnswer };
  } catch (e) {
    link.close();
    throw e;
  }
}

/** Guest side, from the host's scanned code: { answer (text for the QR), link }. */
export async function joinOffline(offerText, { name, gatherMs = GATHER_MS, RTCPeerConnection: RTC = globalThis.RTCPeerConnection, ...opts } = {}) {
  const err = checkCode(offerText, "offer");
  if (err) throw new Error(err);
  const { pc, channel } = newPeer(RTC);
  const link = new QrLink(pc, channel, { role: "guest", name, ...opts });
  try {
    await pc.setRemoteDescription({ type: "offer", sdp: expandSdp(decodeSignal(offerText)) });
    await pc.setLocalDescription(await pc.createAnswer());
    const answer = encodeSignal(await gathered(pc, gatherMs), "answer");
    link.connecting(GUEST_WAIT_MS); // the host connects once it has scanned our answer
    return { answer, link };
  } catch (e) {
    link.close();
    throw e;
  }
}
