# Third-party notices

Lipit Studio 1.0 beta 1 bundles or invokes the following third-party components in the Windows package.

## FFmpeg and FFprobe

- Version/build: FFmpeg 9.0.2 essentials build from gyan.dev
- Project: https://ffmpeg.org/
- Build source: https://www.gyan.dev/ffmpeg/builds/
- License: GNU General Public License version 3 or later for the selected build (`--enable-gpl`, `--enable-version3`, `--enable-libx264`)
- Corresponding upstream source: https://github.com/FFmpeg/FFmpeg/tree/n9.0.2

The distributed FFmpeg build includes GPL components such as libx264. The installer includes the GPLv3 license text. The public release page must keep the exact build source and corresponding source links available beside the binary download.

## yt-dlp

- Bundled version: 2026.08.19
- Project and source: https://github.com/yt-dlp/yt-dlp
- Release source: https://github.com/yt-dlp/yt-dlp/tree/2026.08.19
- License: the yt-dlp source is Unlicense; the bundled Windows executable contains GPLv3+ components and the combined executable is GPLv3+

The installer includes yt-dlp's Unlicense and `THIRD_PARTY_LICENSES.txt`. The optional in-app update action contacts yt-dlp's configured release source. Lipit keeps a local backup and restores it when the update cannot be verified.

## Deno

- Bundled version: 2.9.7
- Project and source: https://github.com/denoland/deno
- Release source: https://github.com/denoland/deno/tree/v2.9.7
- License: MIT

## Rust, Tauri, React and JavaScript dependencies

Their exact versions are recorded in `apps/desktop/src-tauri/Cargo.lock` and `apps/desktop/package-lock.json`. The generated `licenses/DEPENDENCY_LICENSES.txt` inventory and discovered license texts are included in the Windows installer.
