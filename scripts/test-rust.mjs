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

// Release mode removes unused Windows UI imports from the Rust test harness.
// The application build itself is tested separately by the Tauri smoke tests.
const result = spawnSync(
  cargo,
  [
    "test",
    "--release",
    "--locked",
    "--manifest-path",
    join(root, "apps", "desktop", "src-tauri", "Cargo.toml"),
    "--lib",
  ],
  { cwd: root, env, stdio: "inherit" },
);
process.exit(result.status ?? 1);
