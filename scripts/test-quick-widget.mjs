import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const hostPath = resolve(
  root,
  "apps",
  "desktop",
  "src-tauri",
  "target",
  "release",
  "lipit-native-host.exe",
);
const debugPort = 9333;

function desktopRunning() {
  const result = spawnSync(
    "tasklist.exe",
    ["/FI", "IMAGENAME eq lipit-desktop.exe", "/FO", "CSV", "/NH"],
    { encoding: "utf8", windowsHide: true },
  );
  return String(result.stdout ?? "").toLowerCase().includes("lipit-desktop.exe");
}

function frame(value) {
  const payload = Buffer.from(JSON.stringify(value));
  const length = Buffer.alloc(4);
  length.writeUInt32LE(payload.length);
  return Buffer.concat([length, payload]);
}

async function waitForWidget() {
  const deadline = Date.now() + 20_000;
  let lastTargets = [];
  let lastError = "debug endpoint unavailable";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const targets = await response.json();
      lastTargets = targets.map(({ type, title, url }) => ({ type, title, url }));
      const widget = targets.find(
        (target) =>
          target.type === "page" &&
          (target.url.endsWith("/widget.html") || target.title === "Lipit hızlı işlem"),
      );
      if (widget?.webSocketDebuggerUrl) return widget;
    } catch (cause) {
      lastError = cause instanceof Error ? cause.message : String(cause);
      // WebView2 starts the debug endpoint after the native window is ready.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  const running = desktopRunning();
  throw new Error(
    `Quick widget did not expose a WebView2 target. desktopRunning=${running}; ` +
      `lastError=${lastError}; targets=${JSON.stringify(lastTargets)}`,
  );
}

function readNativeResponse(host) {
  return new Promise((resolveResponse, reject) => {
    const chunks = [];
    const errors = [];
    host.stdout.on("data", (chunk) => chunks.push(chunk));
    host.stderr.on("data", (chunk) => errors.push(chunk));
    host.once("error", reject);
    host.once("exit", (code) => {
      const output = Buffer.concat(chunks);
      if (code !== 0 || output.length < 4) {
        reject(
          new Error(
            `Native host failed (exit ${code}): ${Buffer.concat(errors).toString("utf8")}`,
          ),
        );
        return;
      }
      const size = output.readUInt32LE(0);
      resolveResponse(JSON.parse(output.subarray(4, 4 + size).toString("utf8")));
    });
  });
}

function evaluate(webSocketDebuggerUrl, expression) {
  return new Promise((resolveValue, reject) => {
    const socket = new WebSocket(webSocketDebuggerUrl);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("CDP evaluation timed out."));
    }, 5_000);
    socket.addEventListener("open", () => {
      socket.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: { expression, returnByValue: true },
        }),
      );
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      clearTimeout(timer);
      socket.close();
      if (message.error) reject(new Error(message.error.message));
      else if (message.result?.exceptionDetails) {
        reject(new Error(message.result.exceptionDetails.text || "Widget evaluation failed."));
      } else {
        const remoteObject = message.result?.result ?? message.result;
        resolveValue(remoteObject?.value);
      }
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("Could not connect to the quick widget WebView."));
    });
  });
}

async function waitForDesktopExit() {
  const deadline = Date.now() + 8_000;
  while (desktopRunning() && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
}

if (desktopRunning()) {
  throw new Error("Close Lipit before running the quick widget integration test.");
}

const request = {
  protocolVersion: 1,
  type: "MEDIA_DETECTED",
  action: "quick_download",
  candidate: {
    id: `widget-smoke-${Date.now()}`,
    tabId: 1,
    pageUrl: "https://example.com/lipit-widget-smoke",
    pageTitle: "Lipit widget smoke test",
    source: "dom",
    protocol: "unknown",
    durationMs: 30_000,
    currentTimeMs: 0,
    referer: "https://example.com/lipit-widget-smoke",
    origin: "https://example.com",
    userAgent: "Lipit integration test",
    drm: false,
  },
};

const host = spawn(hostPath, [], {
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort}`,
  },
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});

try {
  const responsePromise = readNativeResponse(host);
  host.stdin.end(frame(request));
  const nativeResponse = await responsePromise;
  if (nativeResponse.type !== "MEDIA_ACCEPTED") {
    throw new Error(`Native host rejected candidate: ${JSON.stringify(nativeResponse)}`);
  }
  const widget = await waitForWidget();
  const renderDeadline = Date.now() + 8_000;
  let state = { text: "", background: "", rootChildren: 0, shell: false };
  while (Date.now() < renderDeadline) {
    state = JSON.parse(
      await evaluate(
        widget.webSocketDebuggerUrl,
        `JSON.stringify({
          text: document.body.innerText,
          background: getComputedStyle(document.documentElement).backgroundColor,
          rootChildren: document.getElementById("root")?.childElementCount ?? 0,
          shell: document.querySelector(".quick-widget-shell") != null
        })`,
      ),
    );
    if (state.shell && state.rootChildren >= 1 && state.text.includes("Hızlı indirme")) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  if (!state.shell || state.rootChildren < 1 || !state.text.includes("Hızlı indirme")) {
    throw new Error(`Quick widget did not render: ${JSON.stringify(state)}`);
  }
  if (state.background === "rgb(255, 255, 255)") {
    throw new Error("Quick widget still has a white document background.");
  }
  console.log(`Quick widget rendered: ${JSON.stringify(state)}`);
} finally {
  spawnSync("taskkill.exe", ["/IM", "lipit-desktop.exe", "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
  });
  await waitForDesktopExit();
}
