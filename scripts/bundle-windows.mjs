import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
  console.error("The Lipit Windows setup must be produced on Windows.");
  process.exit(1);
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const desktop = join(root, "apps", "desktop");
const tauri = join(desktop, "src-tauri");
const resources = join(tauri, "resources");
const release = join(root, "release");
const cargoHome = join(root, ".toolchain", "cargo");
const rustupHome = join(root, ".toolchain", "rustup");
const npmCli = process.env.npm_execpath;
if (!npmCli) {
  console.error("Run this script through npm.");
  process.exit(2);
}

const env = { ...process.env };
const nodeDir = dirname(process.execPath);
env.CARGO_BUILD_JOBS ??= "2";
if (existsSync(join(cargoHome, "bin", "cargo.exe"))) {
  env.CARGO_HOME = cargoHome;
  env.RUSTUP_HOME = rustupHome;
  env.PATH = `${nodeDir};${join(cargoHome, "bin")};C:\\msys64\\ucrt64\\bin;${env.PATH ?? ""}`;
}

function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function rustHostTriple() {
  const rustc = existsSync(join(cargoHome, "bin", "rustc.exe"))
    ? join(cargoHome, "bin", "rustc.exe")
    : "rustc";
  const result = spawnSync(rustc, ["-vV"], { env, encoding: "utf8" });
  return result.stdout?.match(/^host:\s*(\S+)/m)?.[1] ?? "";
}

function stageResources(allowPlaceholder) {
  rmSync(resources, { recursive: true, force: true });
  mkdirSync(join(resources, "extension"), { recursive: true });
  const nativeHost = join(tauri, "target", "release", "lipit-native-host.exe");
  if (existsSync(nativeHost)) {
    copyFileSync(nativeHost, join(resources, "lipit-native-host.exe"));
  } else if (allowPlaceholder) {
    // Tauri validates configured resource paths during Rust checks. The real
    // host is built and staged again before the installer is bundled.
    writeFileSync(join(resources, "lipit-native-host.exe"), "", "utf8");
  } else {
    throw new Error("Native Messaging host was not produced by the release build.");
  }
  const webViewLoader = join(tauri, "target", "release", "WebView2Loader.dll");
  if (existsSync(webViewLoader)) {
    copyFileSync(webViewLoader, join(resources, "WebView2Loader.dll"));
  } else if (rustHostTriple().endsWith("-gnu")) {
    throw new Error("WebView2Loader.dll was not produced by the release build.");
  }
  const extension = join(root, "apps", "extension", "dist");
  if (existsSync(extension)) {
    cpSync(extension, join(resources, "extension"), { recursive: true });
  }
  writeFileSync(
    join(resources, "EXTENSION_INSTALL.txt"),
    [
      "Lipit Capture Chromium uzantisi",
      "",
      "1. Chrome, Edge veya Brave uzantilar sayfasinda Gelistirici modu'nu acin.",
      "2. Paketlenmemis oge yukle secenegiyle bu klasordeki extension dizinini secin.",
      "3. Video sayfasini yenileyin.",
      "",
      "Genel dagitimda bu adim tarayici magazasi surumuyle degistirilecektir.",
      "",
    ].join("\r\n"),
    "utf8",
  );
}

function ensureResourcePaths() {
  mkdirSync(join(resources, "extension"), { recursive: true });
  const stagedHost = join(resources, "lipit-native-host.exe");
  if (!existsSync(stagedHost)) writeFileSync(stagedHost, "", "utf8");
  const instructions = join(resources, "EXTENSION_INSTALL.txt");
  if (!existsSync(instructions)) writeFileSync(instructions, "Lipit Capture Chromium extension\r\n", "utf8");
}

function ensureWindowsSidecarNames() {
  const sidecars = join(tauri, "binaries");
  for (const name of ["yt-dlp", "ffmpeg", "ffprobe", "deno"]) {
    const source = join(sidecars, `${name}.exe`);
    if (!existsSync(source)) throw new Error(`Missing packaged engine: ${name}.exe`);
    for (const triple of ["x86_64-pc-windows-gnu", "x86_64-pc-windows-msvc"]) {
      const target = join(sidecars, `${name}-${triple}.exe`);
      if (!existsSync(target)) copyFileSync(source, target);
    }
  }
}

run([join(root, "scripts", "generate-third-party-licenses.mjs")]);
ensureWindowsSidecarNames();
ensureResourcePaths();
if (!process.argv.includes("--package-only")) {
  run([npmCli, "run", "check:release"]);
}
stageResources(false);

run([
  npmCli,
  "--prefix",
  desktop,
  "run",
  "tauri",
  "--",
  "bundle",
  "--bundles",
  "nsis",
]);

const bundleDirectory = join(tauri, "target", "release", "bundle", "nsis");
const built = readdirSync(bundleDirectory)
  .filter((name) => name.toLowerCase().endsWith("-setup.exe"))
  .map((name) => join(bundleDirectory, name))
  .sort((a, b) => statSync(b).size - statSync(a).size)[0];
if (!built) {
  console.error("Tauri did not produce an NSIS setup executable.");
  process.exit(1);
}

mkdirSync(release, { recursive: true });
const output = join(release, `Lipit-Capture-${version}-Windows-x64-unsigned-setup.exe`);
copyFileSync(built, output);
const digest = createHash("sha256").update(readFileSync(output)).digest("hex").toUpperCase();
writeFileSync(join(release, "SHA256SUMS.txt"), `${digest}  ${basename(output)}\n`, "utf8");
console.log(`Unsigned Windows setup: ${output}`);
console.log(`SHA-256: ${digest}`);
