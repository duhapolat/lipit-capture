# Security policy

## Supported version

Security fixes are provided for the latest public beta of Lipit Capture.

## Reporting a vulnerability

Do not publish a working exploit, private key, token, downloaded media, browser cookie, or a URL containing private credentials in a public issue. Use GitHub's private vulnerability reporting feature for the repository. Include the affected version, Windows version, reproduction steps and the observed impact.

## Security boundaries

- Lipit processes DRM free media that the user is authorized to access.
- Download and clipping run locally through packaged yt-dlp, FFmpeg, FFprobe and Deno executables.
- The browser extension does not collect cookies, authorization headers or page contents. Optional browser cookie compatibility is disabled by default and is executed locally by yt-dlp only after the user enables it.
- Localhost, private network, link local and credential bearing media URLs are rejected before a media engine starts.
- Existing destination files are never overwritten. Output is staged in the destination directory and committed with a no clobber operation.
- Remote EJS components and third party PO Token providers are disabled by default.

## Release key handling

Chrome extension private keys are local release secrets. They must never be committed, attached to an issue or included in a source archive. Only the public extension key in `apps/extension/manifest.json` belongs in the repository.
