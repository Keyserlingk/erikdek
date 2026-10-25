---
name: erkdek-app
description: Develop, test and check the Erkdek app (data/): run it in the browser with the simulated sensor, run the JS tests, check UI changes in headless Chrome with screenshots, and build or install the Android APK. Use for any change under data/, test/js/ or the Android build.
---

# Erkdek app

The app is plain ES modules in `data/` (no bundler). In a desktop browser it uses a
simulated sensor; in the Android app it talks to the sensor over Bluetooth LE.

## Run and test
```sh
npm test                               # all app tests (node --test test/js/), fast
python3 tools/serve.py --port 8765     # serves data/ + a dev buildinfo.js
python3 tools/serve.py --port 8765 --variant release   # behave like the release app (no touch steering in Play)
```
Use a free port when several agents may run servers. Stop the server by PID
(`ss -ltnp | grep 8765`), never with `pkill -f <pattern>` that matches your own shell.

## Check a UI change in headless Chrome
`tools/headless.py` drives a fresh Chrome profile at 390×760 (a phone) and runs JSON
steps (see its docstring). Typical check:
```sh
cat > /tmp/steps.json <<'EOF'
[
 {"wait": 2, "js": "window.confirm=()=>true; location.hash='#history'; 1"},
 {"wait": 0.5, "js": "document.querySelectorAll('.session-row').length", "print": "rows:"},
 {"shot": "history"}
]
EOF
python3 tools/headless.py http://localhost:8765/ /tmp/shots 0 < /tmp/steps.json   # 1 = dark
```
Then look at the screenshots. Check light and dark (`0`/`1`).

Useful in steps:
- Seed data through the stores (they are ES modules):
  `import('./sessions.js').then(({sessions}) => sessions.save({...}))`.
- Steer the simulated sensor:
  `import('./device.js').then(({device}) => device.send('mock', {scenario: 'pull', kg: 30}))`
  (scenarios: workout, idle, weight, pull). "Pull during each hang" (`#mockFollow`)
  makes it pull in every hang of a routine.
- `window.confirm = () => true` before actions that ask.
- To capture downloads, wrap `URL.createObjectURL` and read the Blob text.
- Each step is a separate evaluation: no `const` reuse across steps; promises aren't
  awaited (store on `window`, read in a later step).

## Android
Needs Node 22 (`nvm use`, from `.nvmrc`), JDK 21 and the Android SDK (see README).
```sh
npm run android:release            # signed APK: android/app/build/outputs/apk/release/app-release.apk
npm run android:release:install    # + install over USB debugging
npm run android                    # debug build (offers the simulated sensor)
```
`tools/build_android.sh` writes `data/buildinfo.js` (app + firmware version), bundles the
firmware (`tools/bundle_firmware.py`, needs PlatformIO), vendors the Capacitor plugins
(`tools/vendor.mjs`) and runs Gradle. Release signing uses `android/keystore.properties`
(git-ignored) – never commit it or the key.

## Where things are
- Screens: `live.js`, `runner.js` + `runsummary.js` (runs), `routinelist.js`,
  `routineeditor.js`, `workoutflow.js`, `testlist.js` (Train/Tests), `history.js`,
  `sessionview.js`, `sessioncompare.js`, `repcompare.js`, `settings.js`, `calibrate.js`.
- Data stores (no DOM, tested): `sessions.js`, `settingsstore.js`, `profiles.js`,
  `routines.js`, `workouts.js`, `tags.js`, `db.js` (IndexedDB, memory backend in tests).
- Analysis and per-kind results: `analysis.js`, `tests.js` (`KINDS`), `workout.js`
  (phases, engine, rep stats), `protocols.js` (test protocols).
- Sensor link: `device.js` picks the transport from `platform.js` `sensorMode()`:
  `bletransport.js` (Erkdek over Bluetooth), `tindeqtransport.js` (Tindeq Progressor,
  protocol in `tindeqprotocol.js`, verified details in PLAN.md) or `simdevice.js`
  (simulator). All share one interface (state/message events, connect, send).
  `bleprotocol.js` = Erkdek byte layouts (keep in step with the firmware).
- Play tab: `play.js` (screens) and `games/` (`pong.js`, `flappy.js`, `tug.js`, `common.js`,
  `playdata.js`); game logic is pure and tested in `test/js/games.test.js`.
- Online play by game code: `net.js` (Trystero over Nostr relays + WebRTC; tested with a
  fake network and manual clock in `test/js/net.test.js`). `hostGame({name, maxPlayers})`
  → `{code, room}`: a room of up to 6 phones (star, host in the middle) that emits `peer`
  with an open link per guest, `room.links`, `room.close()`; `joinGame(code, {name})` →
  one link. It loads `vendor/trystero.js`, which `npm run vendor` builds (git-ignored) –
  run that once before trying it in the browser. Live check: one script driving 3–4
  headless Chromes over CDP (one per player, page from `tools/serve.py`, then
  `import('./net.js')`); the host's code goes to the guests (see PLAN.md "Play: multiplayer").
- Play with a friend: `playduel.js` (lobby card, connection, messages) + each game's
  `duel` part in `play.js` (host runs Tug/Pong and sends the state, Flappy shares a seed).
  Check with two Chromes driven over CDP in one script: rename the profiles, host, read
  `.duel-code`, join, click "Play with …", compare `#playScore` on both.
- Sharing results with a friend: `share.js` (`buildShare`/`parseShare`/`importShare`;
  friend profiles in `profiles.js`, read-only, shown in History → Compare people).
- Same-Wi-Fi play by QR code: `netqr.js` (`hostOffline`/`joinOffline`, WebRTC with the
  offer/answer squeezed into ~100-character QR codes; same link interface as `net.js`;
  tested with SDP fixtures and a fake peer connection in `test/js/netqr.test.js`) and
  `qr.js` (`qrElement(text)`, `scanQr({check})` – camera + jsQR, paste field without a
  camera). Needs `npm run vendor` (`vendor/qr/`). Live check: two Chromes, pass
  `offer`/`answer` strings between them; Chrome's fake camera
  (`--use-fake-device-for-media-stream --use-file-for-fake-video-capture=qr.y4m`) tests
  the scanner.
- Tindeq from the laptop: `tools/tindeq_probe.py` (bleak venv; `--seconds 8 --tare-at 2
  --battery-at 5`). Never send 0x6E (sleep) or the calibration commands.
