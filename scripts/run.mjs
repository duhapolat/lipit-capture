import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const mode = process.argv[2];
if (mode !== "dev" && mode !== "build") {
  console.error("Usage: node scripts/run.mjs dev|build");
  process.exit(2);
}

const env = { ...process.env };
const nodeDir = dirname(process.execPath);
// Keep release builds responsive on everyday Windows machines.
env.CARGO_BUILD_JOBS ??= "2";
const cargoHome = join(root, ".toolchain", "cargo");
const rustupHome = join(root, ".toolchain", "rustup");
if (existsSync(join(cargoHome, "bin", "cargo.exe"))) {
  env.CARGO_HOME = cargoHome;
  env.RUSTUP_HOME = rustupHome;
  env.PATH = `${nodeDir};${join(cargoHome, "bin")};${env.PATH ?? ""}`;
  if (existsSync("C:\\msys64\\ucrt64\\bin\\gcc.exe")) {
    env.PATH = `${nodeDir};C:\\msys64\\ucrt64\\bin;${env.PATH}`;
  }
}

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  console.error("Run this script through npm.");
  process.exit(2);
}
const extensionBuild = spawnSync(
  process.execPath,
  [join(root, "apps", "extension", "scripts", "build.mjs")],
  { env, stdio: "inherit" },
);
if (extensionBuild.status !== 0) process.exit(extensionBuild.status ?? 1);

const args = [
  npmCli,
  "--prefix",
  join(root, "apps", "desktop"),
  "run",
  "tauri",
  "--",
  mode,
];
if (mode === "build") args.push("--no-bundle");
const result = spawnSync(process.execPath, args, { env, stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);

const cargo = existsSync(join(cargoHome, "bin", "cargo.exe"))
  ? join(cargoHome, "bin", "cargo.exe")
  : "cargo";
const hostArgs = [
  "build",
  "--manifest-path",
  join(root, "apps", "desktop", "src-tauri", "Cargo.toml"),
  "--bin",
  "lipit-native-host",
];
if (mode === "build") hostArgs.push("--release");
const hostResult = spawnSync(cargo, hostArgs, { env, stdio: "inherit" });
process.exit(hostResult.status ?? 1);
