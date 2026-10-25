// Android's Back button (Capacitor's App plugin; without a listener it closes the app).
// It closes what is open on top (the QR scanner, the profile menu), then the current
// tab's sub-screen (an editor, a session, a game), then goes back to the previous page;
// on the first page the app goes to the background, like other Android apps.

import { isNativeApp } from "./platform.js";

const stack = []; // close functions of things open on top, newest last

// Registers `close` for something that opened on top; returns a function to call when it
// closes by itself.
export function pushBack(close) {
  stack.push(close);
  return () => {
    const i = stack.indexOf(close);
    if (i >= 0) stack.splice(i, 1);
  };
}

// pageBack(): closes the current tab's sub-screen; true when there was one (or when Back
// must do nothing, e.g. during a run).
export async function initBackButton(pageBack) {
  if (!isNativeApp()) return;
  const { App } = await import("./vendor/capacitor/app/index.js");
  App.addListener("backButton", ({ canGoBack }) => {
    const top = stack.pop();
    if (top) top();
    else if (pageBack()) return;
    else if (canGoBack) history.back();
    else App.minimizeApp();
  });
}
