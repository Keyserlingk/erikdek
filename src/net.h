#pragma once

// WiFi, web server (serves the web app from LittleFS) and the /ws WebSocket.
void netBegin();
// Call from loop(): streams buffered samples (~20 Hz) and status (1 Hz).
void netLoop();
