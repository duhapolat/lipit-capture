import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { copyFile, mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const downloadDir = join(root, ".downloads");
const sourceDir = join(root, "native", "binaries");
const sidecarDir = join(root, "apps", "desktop", "src-tauri", "binaries");
const ytPath = join(sourceDir, "yt-dlp.exe");
const ffmpegZip = join(downloadDir, "ffmpeg-9.0.2-essentials_build.zip");
const denoZip = join(downloadDir, "deno-x86_64-pc-windows-msvc-2.9.7.zip");
const releases = [
  {
    path: ytPath,
    url: "https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp.exe",
    sha256: "66674953FE251B89F4D08C5F0E35E0728679BD67AB3D7D05C0562AF101DD3E7A",
  },
  {
    path: ffmpegZip,
    url: "https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip",
    sha256: "60F467265B1E312373DBCD92200C2618A74850F98D3D078E94296BB3FA2047BA",
  },
  {
    path: denoZip,
    url: "https://github.com/denoland/deno/releases/download/v2.9.7/deno-x86_64-pc-windows-msvc.zip",
    sha256: "A0C3101B4158D1DFB7D6A78A7BF0F3DE80C96BB423C152BEEC8BEB22786F2238",
  },
];

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex").toUpperCase();
}

async function ensureDownload(release) {
  if (
    existsSync(release.path) &&
    (await sha256(release.path)) === release.sha256
  )
    return;
  const response = await fetch(release.url);
  if (!response.ok || !response.body)
    throw new Error(`Download failed: ${response.status} ${release.url}`);
  const partial = `${release.path}.part`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
  if ((await sha256(partial)) !== release.sha256)
    throw new Error(`Checksum mismatch: ${release.url}`);
  await rename(partial, release.path);
}

function detectTarget() {
  if (process.argv[2]) return process.argv[2];
  const cargoHome = join(root, ".toolchain", "cargo");
  const rustupHome = join(root, ".toolchain", "rustup");
  const localRustc = join(cargoHome, "bin", "rustc.exe");
  const env = { ...process.env };
  if (existsSync(localRustc)) {
    env.CARGO_HOME = cargoHome;
    env.RUSTUP_HOME = rustupHome;
  }
  const output = spawnSync(
    existsSync(localRustc) ? localRustc : "rustc",
    ["-vV"],
    { env, encoding: "utf8" },
  );
  const host = output.stdout?.match(/^host:\s*(\S+)/m)?.[1];
  if (!host)
    throw new Error(
      "Rust host target could not be detected. Pass the target triple as an argument.",
    );
  return host;
}

const triple = detectTarget();
if (!["x86_64-pc-windows-msvc", "x86_64-pc-windows-gnu"].includes(triple)) {
  throw new Error(`Unsupported target triple: ${triple}`);
}
await Promise.all([
  mkdir(downloadDir, { recursive: true }),
  mkdir(sourceDir, { recursive: true }),
  mkdir(sidecarDir, { recursive: true }),
]);
for (const release of releases) await ensureDownload(release);

const expanded = join(downloadDir, "ffmpeg-extracted");
const buildDir = join(expanded, "ffmpeg-9.0.2-essentials_build", "bin");
if (
  !existsSync(join(buildDir, "ffmpeg.exe")) ||
  !existsSync(join(buildDir, "ffprobe.exe"))
) {
  await mkdir(expanded, { recursive: true });
  const result = spawnSync("tar.exe", ["-xf", ffmpegZip, "-C", expanded], {
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error("FFmpeg archive extraction failed.");
}
for (const name of ["ffmpeg", "ffprobe"]) {
  await copyFile(join(buildDir, `${name}.exe`), join(sourceDir, `${name}.exe`));
}
const denoExtracted = join(downloadDir, "deno-2.9.7");
if (!existsSync(join(denoExtracted, "deno.exe"))) {
  await mkdir(denoExtracted, { recursive: true });
  const result = spawnSync("tar.exe", ["-xf", denoZip, "-C", denoExtracted], {
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error("Deno archive extraction failed.");
}
await copyFile(join(denoExtracted, "deno.exe"), join(sourceDir, "deno.exe"));

for (const name of ["yt-dlp", "ffmpeg", "ffprobe", "deno"]) {
  const source = join(sourceDir, `${name}.exe`);
  await copyFile(source, join(sidecarDir, `${name}.exe`));
  // Tauri's NSIS bundler identifies the Windows installer target as MSVC even
  // when the application was compiled with the GNU Rust host. The upstream
  // tools are ordinary Windows x64 executables, so both target filenames use
  // the exact same checksum-verified file.
  for (const windowsTriple of ["x86_64-pc-windows-gnu", "x86_64-pc-windows-msvc"]) {
    await copyFile(source, join(sidecarDir, `${name}-${windowsTriple}.exe`));
  }
}
console.log(`Sidecar binaries are ready for Windows x64 (${triple} build host).`);
