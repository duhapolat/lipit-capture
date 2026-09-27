import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const desktopPath = resolve(
  root,
  "apps",
  "desktop",
  "src-tauri",
  "target",
  "release",
  "lipit-desktop.exe",
);
const debugPort = 9334;

function desktopRunning() {
  const result = spawnSync(
    "tasklist.exe",
    ["/FI", "IMAGENAME eq lipit-desktop.exe", "/FO", "CSV", "/NH"],
    { encoding: "utf8", windowsHide: true },
  );
  return String(result.stdout ?? "").toLowerCase().includes("lipit-desktop.exe");
}

async function waitForMain() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const targets = await response.json();
      const main = targets.find(
        (target) =>
          target.type === "page" &&
          target.url === "http://tauri.localhost/" &&
          target.webSocketDebuggerUrl,
      );
      if (main) return main;
    } catch {
      // Wait for WebView2.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  throw new Error("Main Lipit window did not expose a WebView2 target.");
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
          params: { expression, returnByValue: true, awaitPromise: true },
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
        reject(
          new Error(
            message.result.exceptionDetails.exception?.description ||
              message.result.exceptionDetails.text ||
              "UI evaluation failed.",
          ),
        );
      } else {
        const remoteObject = message.result?.result ?? message.result;
        resolveValue(remoteObject?.value);
      }
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("Could not connect to the Lipit WebView."));
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
  throw new Error("Close Lipit before running the UI resolver integration test.");
}

spawn(desktopPath, [], {
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort}`,
  },
  stdio: "ignore",
  windowsHide: true,
  detached: true,
}).unref();

try {
  const main = await waitForMain();
  const formDeadline = Date.now() + 8_000;
  while (Date.now() < formDeadline) {
    if (await evaluate(main.webSocketDebuggerUrl, `document.querySelector("#media-url") != null`)) {
      break;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  await evaluate(
    main.webSocketDebuggerUrl,
    `(() => {
      const input = document.querySelector("#media-url");
      const form = document.querySelector(".url-card");
      if (!(input instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) {
        throw new Error("Resolver form not found");
      }
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      form.requestSubmit();
      return true;
    })()`,
  );

  const deadline = Date.now() + 24_000;
  let lastState = null;
  while (Date.now() < deadline) {
    lastState = JSON.parse(
      await evaluate(
        main.webSocketDebuggerUrl,
        `JSON.stringify({
          title: document.querySelector(".media-info h3")?.textContent ?? null,
          error: document.querySelector(".error-banner")?.textContent?.trim() ?? null,
          resolving: document.body.innerText.includes("Çözümlemeyi durdur")
        })`,
      ),
    );
    if (lastState.title) {
      console.log(`UI resolver completed: ${JSON.stringify(lastState)}`);
      process.exitCode = 0;
      break;
    }
    if (lastState.error || !lastState.resolving) {
      throw new Error(`UI resolver stopped without media: ${JSON.stringify(lastState)}`);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 300));
  }
  if (!lastState?.title) {
    throw new Error(`UI resolver timed out: ${JSON.stringify(lastState)}`);
  }
} finally {
  spawnSync("taskkill.exe", ["/IM", "lipit-desktop.exe", "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
  });
  await waitForDesktopExit();
}
