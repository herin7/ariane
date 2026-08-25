/**
 * Screenshot the product at the four widths §37 names, using whatever Chrome is
 * already on the machine.
 *
 *   pnpm dev     # in one terminal
 *   pnpm shots   # in another
 *
 * Chrome's own `--screenshot --window-size` flag cannot be trusted here: on a
 * scaled Windows display it rendered a 430px window at 500 CSS pixels wide, so
 * a page that fit perfectly looked like it overflowed and a page that
 * overflowed would have looked fine. Driving the same browser over the
 * DevTools protocol and setting the metrics explicitly is the only way to know
 * what a 430px phone actually sees.
 *
 * No Playwright, no Puppeteer, no downloaded Chromium. Node 22 has a WebSocket
 * client built in and Chrome is already installed.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.SHOTS_BASE_URL ?? "http://localhost:3000";
const OUT = process.env.SHOTS_DIR ?? join(tmpdir(), "ariane-shots");

/** iPhone SE through desktop. §37. */
const WIDTHS = [375, 430, 768, 1440];

/** The three screens a citizen actually sees, plus the one that proves it. */
const PAGES = [
  ["home", "/"],
  ["journey", "/journey?goal=driving_licence"],
  ["scholarship", "/journey?goal=nsp_scholarship"],
  ["proof", "/admin/graph?goal=service:driving_licence"],
  ["coverage", "/admin/coverage"],
  ["browse", "/browse"],
];

const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((p) => existsSync(p));

if (!CHROME) {
  console.error("No Chrome or Edge found. Nothing to drive.");
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

const PORT = 9333;
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${join(OUT, "profile")}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Chrome takes a moment to open the port, and there is no event for it. */
const version = await (async () => {
  for (let i = 0; i < 40; i++) {
    try {
      return await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
    } catch {
      await sleep(250);
    }
  }
  throw new Error("Chrome never opened its debugging port");
})();

const socket = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let nextId = 0;
const waiting = new Map();
const events = [];

socket.addEventListener("message", (message) => {
  const frame = JSON.parse(message.data);
  if (frame.id !== undefined) {
    const pending = waiting.get(frame.id);
    waiting.delete(frame.id);
    if (pending) frame.error ? pending.reject(new Error(frame.error.message)) : pending.resolve(frame.result);
  } else {
    events.push(frame);
  }
});

const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    waiting.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

/** Poll the event log rather than wiring a listener per wait. */
const waitFor = async (method, sessionId, timeout = 20000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const at = events.findIndex((e) => e.method === method && e.sessionId === sessionId);
    if (at >= 0) return events.splice(at, 1)[0];
    await sleep(50);
  }
  return null;
};

const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Page.enable", {}, sessionId);

const report = [];

for (const [name, path] of PAGES) {
  for (const width of WIDTHS) {
    await send(
      "Emulation.setDeviceMetricsOverride",
      { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 },
      sessionId,
    );
    await send("Page.navigate", { url: BASE + path }, sessionId);
    await waitFor("Page.loadEventFired", sessionId);
    // The journey pages compile over HTTP after mount, so the useful screenshot
    // is the one taken after that lands, not the skeleton.
    await sleep(name.startsWith("home") || name === "browse" ? 400 : 2500);

    // The real check, and the reason this file exists: a page wider than the
    // phone is a bug you cannot see in a cropped screenshot.
    const { result } = await send(
      "Runtime.evaluate",
      { expression: "JSON.stringify([document.documentElement.scrollWidth, innerWidth, document.body.scrollHeight])", returnByValue: true },
      sessionId,
    );
    const [scrollWidth, innerWidth, height] = JSON.parse(result.value);
    const overflow = scrollWidth > innerWidth + 1;
    report.push({ name, width, scrollWidth, overflow });

    const shot = await send(
      "Page.captureScreenshot",
      { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: Math.min(height, 4000), scale: 1 } },
      sessionId,
    );
    writeFileSync(join(OUT, `${name}-${width}.png`), Buffer.from(shot.data, "base64"));
    console.log(`  ${name} @ ${width}${overflow ? `  OVERFLOWS to ${scrollWidth}px` : ""}`);
  }
}

socket.close();
chrome.kill();

const bad = report.filter((r) => r.overflow);
console.log(`\n${report.length} shots in ${OUT}`);
if (bad.length) {
  console.log(`${bad.length} of them scroll sideways, which on a phone is the whole page feeling broken:`);
  for (const b of bad) console.log(`  ${b.name} at ${b.width} lays out ${b.scrollWidth}`);
  process.exit(1);
}
console.log("Nothing scrolls sideways at any width.");
