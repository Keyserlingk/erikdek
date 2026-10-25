import assert from "node:assert/strict";
import { test } from "node:test";

// Node 18 has no CustomEvent (browsers and Node 19+ do).
globalThis.CustomEvent ??= class extends Event {
  constructor(type, init) {
    super(type, init);
    this.detail = init?.detail;
  }
};

import { CODE_LETTERS, createLink, newCode, normalizeCode } from "../../data/net.js";

// Manual clock: timers run only when the test advances time.
function fakeClock() {
  let t = 0;
  let next = 1;
  const timers = new Map();
  const add = (fn, ms, interval) => {
    const id = next++;
    timers.set(id, { at: t + ms, fn, ms, interval });
    return id;
  };
  return {
    now: () => t,
    setTimeout: (fn, ms = 0) => add(fn, ms, false),
    setInterval: (fn, ms) => add(fn, ms, true),
    clearTimeout: (id) => timers.delete(id),
    clearInterval: (id) => timers.delete(id),
    advance(ms) {
      const end = t + ms;
      for (;;) {
        const due = [...timers].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, x] = due;
        t = x.at;
        if (x.interval) x.at += x.ms;
        else timers.delete(id);
        x.fn();
        net.flush();
      }
      t = end;
    },
  };
}

// Stand-in for Trystero: rooms with the same code see each other; messages queue
// until flushed. Peers can drop out (onPeerLeave) and come back.
let net;
function fakeNet() {
  const rooms = [];
  const queue = [];
  let ids = 0;
  const peersOf = (room) => rooms.filter((r) => r !== room && r.code === room.code && r.online);
  const self = {
    rooms,
    joinRoom(config, code) {
      const room = {
        id: `p${++ids}`,
        code,
        config,
        online: true,
        left: false,
        handler: null,
        sent: [],
        makeAction(ns, { onMessage }) {
          room.handler = onMessage;
          return {
            send(data, opts) {
              room.sent.push(data);
              if (room.muted || !room.online) return Promise.resolve();
              const targets = peersOf(room).filter((r) => !opts?.target || r.id === opts.target);
              for (const r of targets) queue.push(() => r.online && r.handler?.(structuredClone(data), { peerId: room.id }));
              return Promise.resolve();
            },
          };
        },
        ping: () => Promise.resolve(12),
        leave() {
          room.left = true;
          self.drop(room);
          return Promise.resolve();
        },
      };
      rooms.push(room);
      self.arrive(room);
      return room;
    },
    arrive(room) {
      room.online = true;
      for (const other of peersOf(room)) {
        queue.push(() => other.onPeerJoin?.(room.id));
        queue.push(() => room.onPeerJoin?.(other.id));
      }
    },
    drop(room) {
      if (!room.online) return;
      for (const other of peersOf(room)) queue.push(() => other.onPeerLeave?.(room.id));
      room.online = false;
    },
    flush() {
      while (queue.length) queue.shift()();
    },
  };
  return self;
}

function setup() {
  net = fakeNet();
  const clock = fakeClock();
  const make = (role, name, code = "ACDE") => {
    const link = createLink({ code, role, name, joinRoom: net.joinRoom, clock });
    const log = [];
    for (const type of ["open", "message", "close", "status", "error"]) {
      link.addEventListener(type, (e) => log.push([type, e.detail]));
    }
    link.log = log;
    link.of = (type) => log.filter(([t]) => t === type).map(([, d]) => d);
    return link;
  };
  return { clock, make };
}

test("codes: 4 easy letters, input normalised", () => {
  for (let i = 0; i < 200; i++) assert.match(newCode(), /^[ACDEFGHJKMNPQRTUVWXY]{4}$/);
  assert.equal(newCode(() => 0), "AAAA");
  assert.equal(newCode(() => 0.9999), "YYYY");
  for (const bad of "OIL0158BSZ") assert.ok(!CODE_LETTERS.includes(bad));
  assert.equal(normalizeCode(" ac de "), "ACDE");
  assert.equal(normalizeCode("kq-xy"), "KQXY");
  assert.equal(normalizeCode("ACD"), null);
  assert.equal(normalizeCode("ACDEF"), null);
  assert.equal(normalizeCode("ACDO"), null);
  assert.equal(normalizeCode(null), null);
});

test("host and guest exchange hellos, then messages flow both ways", async () => {
  const { clock, make } = setup();
  const host = make("host", "Ana");
  const guest = make("guest", "Bo");
  clock.advance(1);
  assert.equal(net.rooms[0].config.password, "ACDE");
  assert.equal(net.rooms[0].config.appId, "erkdek-play-v1");
  assert.deepEqual(host.of("status"), ["waiting", "open"]);
  assert.deepEqual(guest.of("status"), ["connecting", "open"]);
  assert.deepEqual(host.of("open"), [{ peerName: "Bo" }]);
  assert.deepEqual(guest.of("open"), [{ peerName: "Ana" }]);
  assert.ok(host.open && guest.open);
  assert.equal(host.role, "host");

  assert.equal(host.send({ kg: 12.5 }), true);
  guest.send({ kg: 3 });
  net.flush();
  assert.deepEqual(guest.of("message"), [{ kg: 12.5 }]);
  assert.deepEqual(host.of("message"), [{ kg: 3 }]);
  assert.equal(await guest.ping(), 12);
});

test("a third player is refused, the pair stays connected", () => {
  const { clock, make } = setup();
  const host = make("host", "Ana");
  const guest = make("guest", "Bo");
  clock.advance(1);
  const third = make("guest", "Cy");
  clock.advance(1);
  assert.deepEqual(third.of("error"), ["This game already has two players."]);
  assert.deepEqual(third.of("status"), ["connecting", "closed"]);
  assert.equal(third.of("close").length, 1);
  assert.equal(third.of("open").length, 0);
  assert.ok(host.open && guest.open);
  host.send({ n: 1 });
  net.flush();
  assert.deepEqual(guest.of("message"), [{ n: 1 }]);
});

test("guest without a host times out", () => {
  const { clock, make } = setup();
  const guest = make("guest", "Bo", "KQXY");
  clock.advance(19000);
  assert.equal(guest.of("error").length, 0);
  clock.advance(2000);
  assert.match(guest.of("error")[0], /No game found/);
  assert.deepEqual(guest.of("status"), ["connecting", "closed"]);
  assert.ok(net.rooms[0].left);
});

test("trouble reaching a found peer gives a better timeout message", () => {
  const { clock, make } = setup();
  net.joinRoom = ((join) => (config, code, callbacks) => {
    clock.setTimeout(() => callbacks.onJoinError({ error: "could not connect" }), 3000);
    return join(config, code);
  })(net.joinRoom);
  const host = createLink({ code: "ACDE", role: "host", name: "Ana", joinRoom: net.joinRoom, clock });
  const guest = createLink({ code: "KQXY", role: "guest", name: "Bo", joinRoom: net.joinRoom, clock });
  const errors = [];
  for (const l of [host, guest]) l.addEventListener("error", (e) => errors.push(e.detail));
  clock.advance(21000);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /couldn't reach the other phone/);
  assert.equal(host.status, "waiting");
});

test("a host keeps waiting", () => {
  const { clock, make } = setup();
  const host = make("host", "Ana");
  clock.advance(120000);
  assert.deepEqual(host.of("status"), ["waiting"]);
});

test("a dropped player is waited for and can come back", () => {
  const { clock, make } = setup();
  const host = make("host", "Ana");
  const guest = make("guest", "Bo");
  clock.advance(1);
  const guestRoom = net.rooms[1];
  net.drop(guestRoom);
  net.flush();
  assert.equal(host.status, "reconnecting");
  assert.equal(host.send({ x: 1 }), false);
  clock.advance(5000);
  net.arrive(guestRoom);
  net.flush();
  assert.equal(host.status, "open");
  assert.deepEqual(host.of("status"), ["waiting", "open", "reconnecting", "open"]);
  assert.equal(host.of("open").length, 1); // "open" event only once
  assert.equal(guest.status, "open");
});

test("a player gone for good closes the connection", () => {
  const { clock, make } = setup();
  const host = make("host", "Ana");
  make("guest", "Bo");
  clock.advance(1);
  net.drop(net.rooms[1]);
  net.flush();
  clock.advance(10001);
  assert.deepEqual(host.of("status"), ["waiting", "open", "reconnecting", "closed"]);
  assert.equal(host.of("close").length, 1);
});

test("silence counts as a lost connection; keep-alives prevent it", () => {
  const { clock, make } = setup();
  const host = make("host", "Ana");
  make("guest", "Bo");
  clock.advance(1);
  clock.advance(30000); // idle but connected: keep-alives flow
  assert.equal(host.status, "open");
  assert.ok(net.rooms[0].sent.some((f) => f.k === "ka"));
  // the guest's frames stop arriving, but Trystero doesn't notice
  net.rooms[1].muted = true;
  clock.advance(8000);
  assert.equal(host.status, "reconnecting");
  net.rooms[1].muted = false;
  clock.advance(2000); // next keep-alive from the guest restores it
  assert.equal(host.status, "open");
});

test("close() says bye: the other side closes at once", () => {
  const { clock, make } = setup();
  const host = make("host", "Ana");
  const guest = make("guest", "Bo");
  clock.advance(1);
  guest.close();
  net.flush();
  assert.deepEqual(host.of("status"), ["waiting", "open", "closed"]);
  assert.equal(host.of("close").length, 1);
  assert.deepEqual(guest.of("status"), ["connecting", "open", "closed"]);
  clock.advance(1000);
  assert.ok(net.rooms[1].left);
});

test("a different app version is refused", () => {
  const { clock, make } = setup();
  const host = make("host", "Ana");
  clock.advance(1);
  const room = net.joinRoom({}, "ACDE");
  room.makeAction("m", { onMessage: () => {} }).send({ k: "hello", v: 99, role: "guest", name: "Old" }, { target: "p1" });
  net.flush();
  assert.match(host.of("error")[0], /different app version/);
});

test("no relay reachable, or offline: said plainly", () => {
  const { clock } = setup();
  const errors = [];
  const sockets = { a: { readyState: 3 } };
  const host = createLink({ code: "ACDE", role: "host", name: "Ana", joinRoom: net.joinRoom, relaySockets: () => sockets, clock });
  host.addEventListener("error", (e) => errors.push(e.detail));
  clock.advance(10001);
  assert.match(errors[0], /Can't reach the internet servers/);
  assert.equal(host.status, "closed");

  const offline = createLink({ code: "ACDE", role: "host", name: "Ana", joinRoom: net.joinRoom, clock: { ...clock, navigator: { onLine: false } } });
  offline.addEventListener("error", (e) => errors.push(e.detail));
  clock.advance(1);
  assert.equal(errors[1], "No internet connection.");
});
