import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputPath = join(root, "licenses", "DEPENDENCY_LICENSES.txt");
const cargoHome = join(root, ".toolchain", "cargo");
const rustupHome = join(root, ".toolchain", "rustup");
const localCargo = join(cargoHome, "bin", "cargo.exe");
const cargo = existsSync(localCargo) ? localCargo : "cargo";
const env = { ...process.env };
if (existsSync(localCargo)) {
  env.CARGO_HOME = cargoHome;
  env.RUSTUP_HOME = rustupHome;
  env.PATH = `${join(cargoHome, "bin")};C:\\msys64\\ucrt64\\bin;${env.PATH ?? ""}`;
}

const licenseNames = /^(?:license|licence|copying|unlicense)(?:[._-].*)?$/i;
const packages = [];
const texts = new Map();

function addText(label, directory) {
  let entries = [];
  try {
    entries = Array.from(new Set(
      readdirSync(directory).filter((name) => licenseNames.test(name)),
    )).sort();
  } catch {
    return;
  }
  for (const name of entries) {
    let value;
    try {
      value = readFileSync(join(directory, name), "utf8").trim();
    } catch {
      continue;
    }
    if (!value) continue;
    const hash = createHash("sha256").update(value).digest("hex");
    const item = texts.get(hash) ?? { text: value, labels: new Set() };
    item.labels.add(`${label} (${name})`);
    texts.set(hash, item);
  }
}

const cargoResult = spawnSync(
  cargo,
  ["metadata", "--locked", "--format-version", "1", "--manifest-path", join(root, "apps", "desktop", "src-tauri", "Cargo.toml")],
  { cwd: root, env, encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
);
if (cargoResult.status !== 0) {
  process.stderr.write(cargoResult.stderr || "Cargo metadata failed.\n");
  process.exit(cargoResult.status ?? 1);
}
const cargoMetadata = JSON.parse(cargoResult.stdout);
for (const item of cargoMetadata.packages
  .filter((item) => item.name !== "lipit-desktop")
  .sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`))) {
  const label = `Rust ${item.name}@${item.version}`;
  packages.push({ ecosystem: "Rust", name: item.name, version: item.version, license: item.license ?? "UNKNOWN", source: item.repository ?? item.homepage ?? item.source ?? "" });
  addText(label, dirname(item.manifest_path));
}

const desktop = join(root, "apps", "desktop");
const lock = JSON.parse(readFileSync(join(desktop, "package-lock.json"), "utf8"));
for (const [relative, locked] of Object.entries(lock.packages ?? {})
  .filter(([relative]) => relative.startsWith("node_modules/"))
  .sort(([a], [b]) => a.localeCompare(b))) {
  const directory = resolve(desktop, relative);
  let manifest = {};
  try {
    manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
  } catch {
    // package-lock remains the authoritative fallback.
  }
  const name = manifest.name ?? basename(relative);
  const version = manifest.version ?? locked.version ?? "UNKNOWN";
  const license = typeof manifest.license === "string" ? manifest.license : locked.license ?? "UNKNOWN";
  const repository = typeof manifest.repository === "string" ? manifest.repository : manifest.repository?.url;
  packages.push({ ecosystem: "JavaScript", name, version, license, source: manifest.homepage ?? repository ?? locked.resolved ?? "" });
  addText(`JavaScript ${name}@${version}`, directory);
}

packages.sort((a, b) => `${a.ecosystem}:${a.name}@${a.version}`.localeCompare(`${b.ecosystem}:${b.name}@${b.version}`));
const lines = [
  "LIPIT CAPTURE - DEPENDENCY LICENSE INVENTORY",
  "Generated from Cargo.lock and package-lock.json. Build-only packages may be included.",
  "",
  "PACKAGE INVENTORY",
  "=================",
];
for (const item of packages) {
  lines.push(`${item.ecosystem} | ${item.name} | ${item.version} | ${item.license}${item.source ? ` | ${item.source}` : ""}`);
}
lines.push("", "LICENSE TEXTS", "=============", "");
for (const item of Array.from(texts.values()).sort((a, b) => Array.from(a.labels)[0].localeCompare(Array.from(b.labels)[0]))) {
  lines.push("Used by:", ...Array.from(item.labels).sort().map((label) => `- ${label}`), "", item.text, "", "--------------------------------------------------------------------------------", "");
}
const output = `${lines.join("\n")}\n`;
if (!existsSync(outputPath) || readFileSync(outputPath, "utf8") !== output) {
  writeFileSync(outputPath, output, "utf8");
}
console.log(`Dependency license inventory generated: ${outputPath} (${packages.length} packages, ${texts.size} unique texts)`);
