import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const hostPath =
  process.env.LIPIT_NATIVE_HOST_PATH ||
  resolve(
    root,
    "apps",
    "desktop",
    "src-tauri",
    "target",
    "release",
    "lipit-native-host.exe",
  );
const payload = Buffer.from(JSON.stringify({ protocolVersion: 1, type: "PING" }));
const length = Buffer.alloc(4);
length.writeUInt32LE(payload.length);

const host = spawn(hostPath, [], {
  env: {
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
  },
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});
const stdout = [];
const stderr = [];
host.stdout.on("data", (chunk) => stdout.push(chunk));
host.stderr.on("data", (chunk) => stderr.push(chunk));
host.stdin.end(Buffer.concat([length, payload]));

const exitCode = await new Promise((resolveExit, reject) => {
  const timer = setTimeout(() => {
    host.kill();
    reject(new Error("Native host PING timed out."));
  }, 5_000);
  host.once("error", reject);
  host.once("exit", (code) => {
    clearTimeout(timer);
    resolveExit(code);
  });
});

const response = Buffer.concat(stdout);
if (exitCode !== 0 || response.length < 4) {
  throw new Error(
    `Native host failed (exit ${exitCode}): ${Buffer.concat(stderr).toString("utf8")}`,
  );
}
const responseLength = response.readUInt32LE(0);
const message = JSON.parse(response.subarray(4, 4 + responseLength).toString("utf8"));
if (message.protocolVersion !== 1 || message.type !== "PONG") {
  throw new Error(`Unexpected native host response: ${JSON.stringify(message)}`);
}
console.log("Native host PING passed.");
