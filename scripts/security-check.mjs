import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const failures = [];

function requireCondition(condition, message) {
  if (!condition) failures.push(message);
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex").toUpperCase();
}

async function findSecretFiles(directory, relative = "") {
  // Distribution folders must be scanned: extension signing keys are commonly
  // generated beside the packaged extension and must never enter a release.
  const ignored = new Set(["node_modules", "target", ".toolchain", ".downloads"]);
  const entries = await readdir(directory, { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const nextRelative = join(relative, entry.name);
    const full = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await findSecretFiles(full, nextRelative)));
    else if (/\.(?:pem|key|pfx|p12)$/i.test(entry.name)) found.push(nextRelative);
  }
  return found;
}

const expectedBinaries = {
  "yt-dlp.exe": "66674953FE251B89F4D08C5F0E35E0728679BD67AB3D7D05C0562AF101DD3E7A",
  "ffmpeg.exe": "3256173F3F8BFFD7DF12227C68ADF68025EDB1832273A9530688A7BB1ED8EDEC",
  "ffprobe.exe": "F0D36ECBBDD3BCFAC3EFA078C96C7271C2E68B3810595552AC3B7F17E9A65C52",
  "deno.exe": "E020F3E232BD16E33768DEE528E5983349C962952051CED0A5D58AD42F5D9B33",
};

for (const [name, expected] of Object.entries(expectedBinaries)) {
  const path = join(root, "apps", "desktop", "src-tauri", "binaries", name);
  requireCondition(existsSync(path), `Missing packaged engine: ${name}`);
  if (existsSync(path)) requireCondition((await sha256(path)) === expected, `Hash mismatch: ${name}`);
}

const tauri = JSON.parse(await readFile(join(root, "apps", "desktop", "src-tauri", "tauri.conf.json"), "utf8"));
const csp = tauri.app?.security?.csp || "";
requireCondition(!csp.includes("'unsafe-eval'"), "Tauri CSP must not allow unsafe-eval");
requireCondition(csp.startsWith("default-src 'self'"), "Tauri CSP must default to self");
requireCondition(Array.isArray(tauri.app?.security?.assetProtocol?.scope) && tauri.app.security.assetProtocol.scope.length === 0, "Asset protocol must start with an empty scope");

const capability = JSON.parse(await readFile(join(root, "apps", "desktop", "src-tauri", "capabilities", "default.json"), "utf8"));
requireCondition(!capability.permissions.some((permission) => String(permission).startsWith("shell:")), "Frontend must not have shell permissions");

const extension = JSON.parse(await readFile(join(root, "apps", "extension", "manifest.json"), "utf8"));
const rootPackage = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const desktopPackage = JSON.parse(
  await readFile(join(root, "apps", "desktop", "package.json"), "utf8"),
);
const extensionPackage = JSON.parse(
  await readFile(join(root, "apps", "extension", "package.json"), "utf8"),
);
const cargoToml = await readFile(
  join(root, "apps", "desktop", "src-tauri", "Cargo.toml"),
  "utf8",
);
const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
for (const [source, version] of Object.entries({
  "desktop package": desktopPackage.version,
  "extension package": extensionPackage.version,
  "Tauri config": tauri.version,
  "Cargo package": cargoVersion,
})) {
  requireCondition(
    version === rootPackage.version,
    `${source} version ${version ?? "missing"} does not match ${rootPackage.version}`,
  );
}
const betaVersion = rootPackage.version.match(/^(\d+)\.(\d+)\.(\d+)-beta\.(\d+)$/);
requireCondition(Boolean(betaVersion), `Unsupported release version: ${rootPackage.version}`);
if (betaVersion) {
  requireCondition(
    extension.version === betaVersion.slice(1).join("."),
    "Extension numeric version does not match the release version",
  );
  requireCondition(
    extension.version_name === `${betaVersion[1]}.${betaVersion[2]} beta ${betaVersion[4]}`,
    "Extension display version does not match the release version",
  );
}
for (const forbidden of ["cookies", "downloads", "history", "clipboardRead", "management"]) {
  requireCondition(!extension.permissions.includes(forbidden), `Extension must not request ${forbidden}`);
}
requireCondition(Boolean(extension.key), "Extension public key is required for a stable native host ID");

const secretFiles = await findSecretFiles(root);
requireCondition(secretFiles.length === 0, `Private key files found in repository: ${secretFiles.join(", ")}`);

const defaults = await readFile(join(root, "apps", "desktop", "src-tauri", "src", "models.rs"), "utf8");
requireCondition(/cookies_enabled:\s*false/.test(defaults), "Browser cookies must be disabled by default");
requireCondition(/remote_ejs_enabled:\s*false/.test(defaults), "Remote EJS must be disabled by default");
requireCondition(/po_token_providers_enabled:\s*false/.test(defaults), "Third party token providers must be disabled by default");

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}
console.log("Security invariants and packaged engine hashes verified.");
