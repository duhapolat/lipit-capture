import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const hostName = "com.lipit.capture";
const extensionId = "nhcgifoaikjkndkbnkkllknmlfbkdcbc";
const hostPath = resolve(
  root,
  "apps",
  "desktop",
  "src-tauri",
  "target",
  "release",
  "lipit-native-host.exe",
);

if (process.platform !== "win32") {
  console.error("This Phase 2 installer currently supports Windows only.");
  process.exit(1);
}
if (!existsSync(hostPath)) {
  console.error("Native host was not built. Run `npm run build` first.");
  process.exit(1);
}

const localData = process.env.LOCALAPPDATA;
if (!localData) {
  console.error("LOCALAPPDATA is unavailable.");
  process.exit(1);
}
const manifestDir = join(localData, "Lipit Capture", "NativeMessaging");
const chromiumManifestDir = join(manifestDir, "chromium");
const manifestPath = join(chromiumManifestDir, `${hostName}.json`);
const chromiumManifest = {
  name: hostName,
  description: "Lipit Capture native messaging bridge",
  path: hostPath,
  type: "stdio",
  allowed_origins: [`chrome-extension://${extensionId}/`],
};
await mkdir(chromiumManifestDir, { recursive: true });
await writeFile(
  manifestPath,
  `${JSON.stringify(chromiumManifest, null, 2)}\n`,
  "utf8",
);

const registryRoots = [
  "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts",
  "HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts",
  "HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts",
];
for (const registryRoot of registryRoots) {
  const result = spawnSync(
    "reg.exe",
    ["add", `${registryRoot}\\${hostName}`, "/ve", "/t", "REG_SZ", "/d", manifestPath, "/f"],
    { stdio: "pipe", encoding: "utf8" },
  );
  if (result.status !== 0) {
    console.error(`Native host registration failed for ${registryRoot}.`);
    process.exit(result.status ?? 1);
  }
}

const firefoxRegistryRoots = [
  "HKCU\\Software\\Mozilla\\NativeMessagingHosts",
  "HKCU\\Software\\WOW6432Node\\Mozilla\\NativeMessagingHosts",
];
for (const registryRoot of firefoxRegistryRoots) {
  spawnSync("reg.exe", ["delete", `${registryRoot}\\${hostName}`, "/f"], {
    stdio: "pipe",
    encoding: "utf8",
  });
}
await rm(join(manifestDir, "firefox"), { recursive: true, force: true });

console.log("Lipit browser bridge registered for Chrome, Edge, and Brave.");
console.log(`Extension ID: ${extensionId}`);
console.log(`Load unpacked extension from: ${join(root, "apps", "extension", "dist")}`);
