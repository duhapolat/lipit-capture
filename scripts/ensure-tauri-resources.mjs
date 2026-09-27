import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const resources = join(root, "apps", "desktop", "src-tauri", "resources");

mkdirSync(join(resources, "extension"), { recursive: true });

const nativeHost = join(resources, "lipit-native-host.exe");
if (!existsSync(nativeHost)) writeFileSync(nativeHost, "");

const instructions = join(resources, "EXTENSION_INSTALL.txt");
if (!existsSync(instructions)) {
  writeFileSync(instructions, "Lipit Capture Chromium extension\r\n", "utf8");
}

console.log("Tauri resource paths are ready.");
