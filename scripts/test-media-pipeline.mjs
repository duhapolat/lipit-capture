import { spawn, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const desktopPath = resolve(root, "apps", "desktop", "src-tauri", "target", "release", "lipit-desktop.exe");
const ffprobePath = resolve(root, "apps", "desktop", "src-tauri", "binaries", "ffprobe.exe");
const ffmpegPath = resolve(root, "apps", "desktop", "src-tauri", "binaries", "ffmpeg.exe");
const debugPort = 9335;
const runRoot = join(tmpdir(), `lipit-beta-pipeline-${process.pid}-${Date.now()}`);
const outputPath = join(runRoot, "pipeline-smoke.mp4");

function desktopRunning() {
  const result = spawnSync("tasklist.exe", ["/FI", "IMAGENAME eq lipit-desktop.exe", "/FO", "CSV", "/NH"], {
    encoding: "utf8",
    windowsHide: true,
  });
  return String(result.stdout ?? "").toLowerCase().includes("lipit-desktop.exe");
}

async function waitForMain() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const targets = await response.json();
      const main = targets.find((target) => target.type === "page" && target.url === "http://tauri.localhost/" && target.webSocketDebuggerUrl);
      if (main) return main;
    } catch {
      // WebView2 is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  throw new Error("Main Lipit window did not expose a WebView2 target.");
}

function evaluate(webSocketDebuggerUrl, expression, timeoutMs = 30_000) {
  return new Promise((resolveValue, reject) => {
    const socket = new WebSocket(webSocketDebuggerUrl);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("CDP evaluation timed out."));
    }, timeoutMs);
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: { expression, returnByValue: true, awaitPromise: true },
      }));
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      clearTimeout(timer);
      socket.close();
      if (message.error) reject(new Error(message.error.message));
      else if (message.result?.exceptionDetails) {
        reject(new Error(message.result.exceptionDetails.exception?.description || message.result.exceptionDetails.text || "UI evaluation failed."));
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

if (desktopRunning()) throw new Error("Close Lipit before running the media pipeline test.");
await import("node:fs/promises").then(({ mkdir }) => mkdir(runRoot, { recursive: true }));

spawn(desktopPath, [], {
  env: {
    ...process.env,
    APPDATA: join(runRoot, "appdata"),
    LOCALAPPDATA: join(runRoot, "localappdata"),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort}`,
  },
  stdio: "ignore",
  windowsHide: true,
  detached: true,
}).unref();

try {
  const main = await waitForMain();
  const invokeDeadline = Date.now() + 10_000;
  let invokeReady = false;
  while (Date.now() < invokeDeadline) {
    invokeReady = await evaluate(
      main.webSocketDebuggerUrl,
      `typeof window.__TAURI_INTERNALS__?.invoke === "function"`,
      5_000,
    );
    if (invokeReady) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  if (!invokeReady) throw new Error("Tauri invoke did not become ready.");
  const result = JSON.parse(await evaluate(
    main.webSocketDebuggerUrl,
    `(async () => {
      const invoke = window.__TAURI_INTERNALS__?.invoke;
      if (typeof invoke !== "function") throw new Error("Tauri invoke unavailable");
      const media = await invoke("resolve_media", { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
      const job = await invoke("start_clip", { request: {
        url: media.url,
        qualityHeight: null,
        outputPath: ${JSON.stringify(outputPath)},
        direct: media.direct,
        refreshUrl: media.refreshUrl,
        startMs: 0,
        endMs: 5000,
        mode: "fast",
        knownDurationMs: media.durationMs,
        requestContext: media.requestContext
      }});
      return JSON.stringify({ jobId: job.id, title: media.title });
    })()`,
    40_000,
  ));

  const deadline = Date.now() + 180_000;
  let finalJob;
  while (Date.now() < deadline) {
    const jobs = JSON.parse(await evaluate(
      main.webSocketDebuggerUrl,
      `(async () => JSON.stringify(await window.__TAURI_INTERNALS__.invoke("list_jobs")))()`,
      10_000,
    ));
    finalJob = jobs.find((job) => job.id === result.jobId);
    if (finalJob && ["completed", "failed", "cancelled"].includes(finalJob.status)) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  if (finalJob?.status !== "completed" || !existsSync(outputPath)) {
    throw new Error(`Pipeline job failed: ${JSON.stringify(finalJob)}`);
  }

  const probe = spawnSync(ffprobePath, [
    "-v", "error", "-show_entries", "format=format_name,duration:stream=codec_type,codec_name",
    "-of", "json", outputPath,
  ], { encoding: "utf8", windowsHide: true, timeout: 20_000 });
  if (probe.status !== 0) throw new Error(`FFprobe failed: ${probe.stderr}`);
  const metadata = JSON.parse(probe.stdout);
  const duration = Number(metadata.format?.duration);
  const video = metadata.streams?.find((stream) => stream.codec_type === "video");
  if (!metadata.format?.format_name?.includes("mp4") || video?.codec_name !== "h264" || !(duration >= 4 && duration <= 7)) {
    throw new Error(`Unexpected pipeline output: ${probe.stdout}`);
  }
  const seek = spawnSync(ffmpegPath, ["-v", "error", "-ss", "3", "-i", outputPath, "-frames:v", "1", "-f", "null", "-"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 20_000,
  });
  if (seek.status !== 0) throw new Error(`Seek verification failed: ${seek.stderr}`);
  console.log(`Media pipeline completed: ${JSON.stringify({ title: result.title, duration, video: video.codec_name, seekable: true })}`);
} finally {
  spawnSync("taskkill.exe", ["/IM", "lipit-desktop.exe", "/T", "/F"], { stdio: "ignore", windowsHide: true });
  await waitForDesktopExit();
  if (dirname(runRoot) === tmpdir() && runRoot.startsWith(join(tmpdir(), "lipit-beta-pipeline-"))) {
    rmSync(runRoot, { recursive: true, force: true });
  }
}
