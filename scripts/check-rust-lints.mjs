import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
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

const result = spawnSync(
  cargo,
  [
    "clippy",
    "--release",
    "--locked",
    "--manifest-path",
    join(root, "apps", "desktop", "src-tauri", "Cargo.toml"),
    "--all-targets",
    "--offline",
    "--",
    "-D",
    "warnings",
  ],
  { cwd: root, env, stdio: "inherit" },
);
process.exit(result.status ?? 1);
