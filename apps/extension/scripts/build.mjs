import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const extensionRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = dirname(dirname(extensionRoot));
const output = join(extensionRoot, "dist");
const tsc = join(
  repositoryRoot,
  "apps",
  "desktop",
  "node_modules",
  "typescript",
  "bin",
  "tsc",
);

await rm(output, { recursive: true, force: true });
const compile = spawnSync(process.execPath, [tsc, "-p", join(extensionRoot, "tsconfig.json")], {
  cwd: repositoryRoot,
  stdio: "inherit",
});
if (compile.status !== 0) process.exit(compile.status ?? 1);

await mkdir(join(output, "icons"), { recursive: true });
const manifest = JSON.parse(await readFile(join(extensionRoot, "manifest.json"), "utf8"));
const extensionPackage = JSON.parse(
  await readFile(join(extensionRoot, "package.json"), "utf8"),
);
const versionMatch = extensionPackage.version.match(
  /^(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))$/,
);
if (!versionMatch) {
  throw new Error(`Unsupported extension package version: ${extensionPackage.version}`);
}
manifest.version = versionMatch.slice(1).join(".");
manifest.version_name = `${versionMatch[1]}.${versionMatch[2]} beta ${versionMatch[4]}`;
const keyDigest = createHash("sha256")
  .update(Buffer.from(manifest.key, "base64"))
  .digest()
  .subarray(0, 16);
const extensionId = [...keyDigest]
  .map((byte) => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15)))
  .join("");
if (extensionId !== "nhcgifoaikjkndkbnkkllknmlfbkdcbc") {
  throw new Error(`Unexpected extension ID: ${extensionId}`);
}
await writeFile(join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await cp(
  join(repositoryRoot, "apps", "desktop", "src-tauri", "icons", "32x32.png"),
  join(output, "icons", "icon32.png"),
);
await cp(
  join(repositoryRoot, "apps", "desktop", "src-tauri", "icons", "128x128.png"),
  join(output, "icons", "icon128.png"),
);

console.log(`Extension built at ${output}`);
